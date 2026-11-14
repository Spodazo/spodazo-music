import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { Link, useLocation, useRoute } from "wouter";
import {
  assignSrc,
  dropLegacyAudioCaches,
  isMobilePlayback,
  isPrematureTrackEnd,
  pipelineIsDead,
  playSong,
  releaseOutputForRouteChange,
  restoreMobileOutput,
  sameSong,
  setPlaybackSession,
  settleRoutePlayback,
  startBackgroundPlaybackGuard,
  trustedSongDuration,
  unlockAudio,
  watchPlaybackRoute,
} from "../lib/audioCache";
import { adminMe, fetchAlbums } from "../lib/api";
import { prefetchAlbum, readCachedAlbum } from "../lib/albumCache";
import { loadHomeAlbums, readCachedAlbums } from "../lib/homeCache";
import { parseDurationLabel } from "../lib/listeningTime";
import { imageIsHot, LIST_THUMB_WIDTH, revealLoadedImage, withImageWidth } from "../lib/images";
import {
  addPlaylistSong,
  albumsForPlaylistPicker,
  createPlaylist,
  deletePlaylist,
  playlistSongFromTrack,
  readPlaylists,
  removePlaylistSong,
  renamePlaylist,
  replacePlaylistSongs,
  subscribePlaylists,
  type PlaylistSongRef,
  type UserPlaylist,
} from "../lib/playlists";
import type { AlbumListItem, PublicAlbum } from "@shared/types";

const VOLUME = 0.85;

function sameSongList(left: PlaylistSongRef[], right: PlaylistSongRef[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((song, index) => {
    const other = right[index];
    return song.trackId === other.trackId
      && song.audioUrl === other.audioUrl
      && song.imageUrl === other.imageUrl
      && song.title === other.title
      && song.durationLabel === other.durationLabel;
  });
}

function refreshFromCache(songs: PlaylistSongRef[]): PlaylistSongRef[] {
  return songs.map((song) => {
    const album = readCachedAlbum(song.albumSlug);
    const track = album?.tracks.find((item) => item.id === song.trackId);
    if (!album || !track) return song;
    return playlistSongFromTrack(album, track);
  });
}

export default function PlaylistsPage() {
  const [, params] = useRoute("/playlists/:id");
  if (params?.id) return <PlaylistDetail key={params.id} id={params.id} />;
  return <PlaylistIndex />;
}

function PlaylistIndex() {
  const [playlists, setPlaylists] = useState<UserPlaylist[]>(() => readPlaylists());
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  useEffect(() => subscribePlaylists(() => setPlaylists(readPlaylists())), []);

  function onCreate(event: FormEvent) {
    event.preventDefault();
    const result = createPlaylist(name);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setName("");
    setError("");
    setPlaylists(readPlaylists());
  }

  return (
    <main className="home playlist-index">
      <Link href="/" className="albums-back playlist-back">Albums</Link>
      <div className="playlist-index-main">
        <h1>Your playlists</h1>
        <p className="playlist-device-note">Saved on this device. No account needed.</p>
        <form className="playlist-create" onSubmit={onCreate}>
          <input
            value={name}
            maxLength={60}
            placeholder="Playlist name"
            aria-label="Playlist name"
            onChange={(event) => setName(event.target.value)}
          />
          <button type="submit" className="btn-play-all">Create</button>
        </form>
        {error ? <p className="error">{error}</p> : null}
        {playlists.length ? (
          <ul className="playlist-index-list">
            {playlists.map((playlist) => (
              <li key={playlist.id}>
                <Link href={`/playlists/${playlist.id}`}>
                  <span>{playlist.name}</span>
                  <span>{playlist.songs.length} {playlist.songs.length === 1 ? "song" : "songs"}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="playlist-device-note">Create a playlist, then add songs from any album.</p>
        )}
      </div>
    </main>
  );
}

function PlaylistDetail({ id }: { id: string }) {
  const [, navigate] = useLocation();
  const [playlist, setPlaylist] = useState<UserPlaylist | null>(() => readPlaylists().find((item) => item.id === id) || null);
  const [name, setName] = useState(playlist?.name || "");
  const [adding, setAdding] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [active, setActive] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [repeatAll, setRepeatAll] = useState(false);
  const [phoneRestartNote, setPhoneRestartNote] = useState(false);
  const [playError, setPlayError] = useState("");
  const [audioGen, setAudioGen] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const songsRef = useRef<PlaylistSongRef[]>(playlist?.songs || []);
  const activeRef = useRef<number | null>(null);
  const wantPlayingRef = useRef(false);
  const currentUrlRef = useRef("");
  const repeatAllRef = useRef(false);
  const rerouteRef = useRef<{ time: number; playing: boolean; keepAudible?: boolean } | null>(null);
  const stopRouteSettleRef = useRef<(() => void) | null>(null);
  const wakeRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    songsRef.current = playlist?.songs || [];
  }, [playlist]);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    repeatAllRef.current = repeatAll;
  }, [repeatAll]);

  useEffect(() => {
    let cancelled = false;
    const merged = refreshFromCache(songsRef.current);
    if (!sameSongList(merged, songsRef.current)) {
      songsRef.current = merged;
      const next = replacePlaylistSongs(id, merged);
      if (next && !cancelled) setPlaylist(next);
    }
    const slugs = [...new Set(songsRef.current.map((song) => song.albumSlug))];
    void Promise.all(slugs.map((slug) => prefetchAlbum(slug).catch(() => null))).then((albums) => {
      if (cancelled) return;
      const bySlug = new Map(albums.filter((album): album is PublicAlbum => Boolean(album)).map((album) => [album.slug, album]));
      const refreshed = songsRef.current.map((song) => {
        const album = bySlug.get(song.albumSlug);
        const track = album?.tracks.find((item) => item.id === song.trackId);
        if (!album || !track) return song;
        return playlistSongFromTrack(album, track);
      });
      if (sameSongList(refreshed, songsRef.current)) return;
      const next = replacePlaylistSongs(id, refreshed);
      if (next) setPlaylist(next);
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  function markPhonePlayFailed() {
    if (!isMobilePlayback()) return;
    setPhoneRestartNote(true);
  }

  async function acquireWake() {
    try {
      if ("wakeLock" in navigator) wakeRef.current = await navigator.wakeLock.request("screen");
    } catch {
      /* denied */
    }
  }

  function releaseWake() {
    void wakeRef.current?.release().catch(() => undefined);
    wakeRef.current = null;
  }

  function warm() {
    unlockAudio(audioRef.current);
  }

  function playAt(index: number, keepAudible = false) {
    const song = songsRef.current[index];
    const audio = audioRef.current;
    if (!song?.audioUrl || !audio) return;
    currentUrlRef.current = song.audioUrl;
    setActive(index);
    setPlayError("");
    setPhoneRestartNote(false);
    wantPlayingRef.current = true;
    const force = Boolean(audio.src) && (pipelineIsDead(audio) || !sameSong(audio, song.audioUrl));
    void playSong(audio, song.audioUrl, 0, force, VOLUME, keepAudible)
      .then(() => {
        setPlaying(true);
        window.setTimeout(() => void acquireWake(), 400);
      })
      .catch(() => {
        wantPlayingRef.current = false;
        setPlaying(false);
        setPlayError("This song could not be played.");
        markPhonePlayFailed();
      });
  }

  function togglePlay() {
    const audio = audioRef.current;
    const url = currentUrlRef.current;
    if (!audio || !url) return;
    if (!audio.paused) {
      wantPlayingRef.current = false;
      audio.pause();
      setPlaying(false);
      releaseWake();
      return;
    }
    const resumeTime = audio.currentTime > 0.15 ? audio.currentTime : 0;
    unlockAudio(audio);
    wantPlayingRef.current = true;
    const fromStart = resumeTime < 0.2;
    const play = fromStart
      ? playSong(audio, url, 0, pipelineIsDead(audio), VOLUME, false)
      : pipelineIsDead(audio)
        ? playSong(audio, url, resumeTime, true, VOLUME)
        : audio.play().then(() => undefined);
    void play.then(() => {
      setPlaying(true);
      void acquireWake();
    }).catch(() => {
      wantPlayingRef.current = false;
      setPlaying(false);
      markPhonePlayFailed();
    });
  }

  function rebuildAudioAfterRouteChange(time: number, shouldPlay: boolean) {
    rerouteRef.current = { time, playing: shouldPlay, keepAudible: true };
    releaseOutputForRouteChange(audioRef.current);
    audioRef.current?.pause();
    setAudioGen((value) => value + 1);
  }

  useEffect(() => {
    setPlaybackSession();
    void dropLegacyAudioCaches();
    const onVisibility = () => {
      if (document.hidden) return;
      const audio = audioRef.current;
      const url = currentUrlRef.current;
      if (wantPlayingRef.current && audio && url) {
        restoreMobileOutput(audio, VOLUME);
        if (audio.paused) {
          void audio.play().then(() => setPlaying(true)).catch(() => undefined);
        }
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    const stopRoute = watchPlaybackRoute(
      () => audioRef.current,
      (snapshot) => {
        rebuildAudioAfterRouteChange(snapshot.time, snapshot.playing || wantPlayingRef.current);
      },
      () => VOLUME,
    );
    const stopGuard = startBackgroundPlaybackGuard(
      () => audioRef.current,
      () => wantPlayingRef.current,
      () => VOLUME,
    );
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stopRoute();
      stopGuard();
      stopRouteSettleRef.current?.();
      wantPlayingRef.current = false;
      currentUrlRef.current = "";
      const audio = audioRef.current;
      releaseOutputForRouteChange(audio);
      if (audio) {
        audio.pause();
        audio.removeAttribute("src");
      }
      releaseWake();
    };
  }, []);

  useEffect(() => {
    const pending = rerouteRef.current;
    const audio = audioRef.current;
    const url = currentUrlRef.current;
    if (!pending || !audio || !url) return;
    rerouteRef.current = null;
    if (!pending.playing) {
      assignSrc(audio, url, pending.time);
      return;
    }
    wantPlayingRef.current = true;
    void playSong(audio, url, pending.time, true, VOLUME, pending.keepAudible)
      .then(() => {
        restoreMobileOutput(audio, VOLUME);
        setPlaying(true);
        void acquireWake();
        if (pending.keepAudible) {
          stopRouteSettleRef.current?.();
          stopRouteSettleRef.current = settleRoutePlayback(
            () => audioRef.current,
            () => wantPlayingRef.current,
            () => VOLUME,
          );
        }
      })
      .catch(() => {
        wantPlayingRef.current = false;
        setPlaying(false);
        markPhonePlayFailed();
      });
  }, [audioGen]);

  function onEnded() {
    const audio = audioRef.current;
    const index = activeRef.current;
    const song = index === null ? null : songsRef.current[index];
    const known = trustedSongDuration(audio?.duration || duration, parseDurationLabel(song?.durationLabel));
    if (audio && isPrematureTrackEnd(audio.currentTime, known)) {
      markPhonePlayFailed();
      return;
    }
    if (index === null) return;
    if (index < songsRef.current.length - 1) {
      playAt(index + 1, true);
      return;
    }
    if (repeatAllRef.current && songsRef.current.length) {
      playAt(0, true);
      return;
    }
    wantPlayingRef.current = false;
    setPlaying(false);
    releaseWake();
  }

  function seek(event: MouseEvent<HTMLDivElement>) {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const rect = event.currentTarget.getBoundingClientRect();
    audio.currentTime = ((event.clientX - rect.left) / rect.width) * duration;
  }

  function onRemove(trackId: string) {
    const current = songsRef.current;
    const removedAt = current.findIndex((song) => song.trackId === trackId);
    const next = removePlaylistSong(id, trackId);
    if (!next) return;
    const playingIndex = activeRef.current;
    if (playingIndex !== null && removedAt === playingIndex) {
      wantPlayingRef.current = false;
      currentUrlRef.current = "";
      audioRef.current?.pause();
      setActive(null);
      setPlaying(false);
      setCurrentTime(0);
      releaseWake();
    } else if (playingIndex !== null && removedAt > -1 && removedAt < playingIndex) {
      setActive(playingIndex - 1);
    }
    setPlaylist(next);
  }

  function onRename() {
    if (!playlist) return;
    const result = renamePlaylist(id, name);
    if ("error" in result) {
      setName(playlist.name);
      return;
    }
    setPlaylist(result.playlist);
    setName(result.playlist.name);
  }

  if (!playlist) {
    return (
      <main className="home">
        <Link href="/playlists" className="albums-back playlist-back">Playlists</Link>
        <p className="error">That playlist is not on this device.</p>
      </main>
    );
  }

  const songs = playlist.songs;

  return (
    <div className="layout playlist-layout">
      <audio
        key={`${id}-${audioGen}`}
        ref={audioRef}
        preload="none"
        playsInline
        onTimeUpdate={(event) => {
          const time = event.currentTarget.currentTime;
          setCurrentTime(time);
          if (!event.currentTarget.paused) setPlaying(true);
          if (time > 2) setPhoneRestartNote(false);
        }}
        onDurationChange={(event) => setDuration(event.currentTarget.duration || 0)}
        onEnded={onEnded}
        onError={() => {
          setPlayError("This song could not be played.");
          markPhonePlayFailed();
        }}
        onPlay={() => setPlaying(true)}
        onPause={(event) => {
          if (!event.currentTarget.paused) return;
          setPlaying(false);
        }}
      />
      <section className="track-panel playlist-panel">
        <div className="album-head">
          <div className="album-head-nav">
            <Link href="/" className="playlist-nav-link">Albums</Link>
            <Link href="/playlists" className="playlist-nav-link">Playlists</Link>
          </div>
          <form
            className="playlist-name-form"
            onSubmit={(event) => {
              event.preventDefault();
              onRename();
            }}
          >
            <input
              value={name}
              maxLength={60}
              aria-label="Playlist name"
              onChange={(event) => setName(event.target.value)}
              onBlur={onRename}
            />
          </form>
          <p className="alb-tag">{songs.length} {songs.length === 1 ? "song" : "songs"} · saved on this device</p>
        </div>
        <div className="album-hero">
          <div className="hero-play">
            <button
              type="button"
              className="btn-play-all"
              disabled={!songs.length}
              onPointerDown={warm}
              onClick={() => {
                if (active !== null && currentUrlRef.current) {
                  togglePlay();
                  return;
                }
                playAt(0, false);
              }}
            >
              {playing ? "Pause" : "Play"}
            </button>
            <button
              type="button"
              className={`btn-repeat-all${repeatAll ? " on" : ""}`}
              aria-pressed={repeatAll}
              onClick={() => setRepeatAll((value) => !value)}
            >
              All
            </button>
            <button type="button" className="playlist-text-btn" onClick={() => setAdding((value) => !value)}>
              {adding ? "Close" : "Add songs"}
            </button>
            {confirmDelete ? (
              <button
                type="button"
                className="playlist-text-btn danger"
                onClick={() => {
                  deletePlaylist(id);
                  navigate("/playlists");
                }}
              >
                Delete playlist
              </button>
            ) : (
              <button type="button" className="playlist-text-btn" onClick={() => setConfirmDelete(true)}>
                Delete
              </button>
            )}
          </div>
          {phoneRestartNote ? (
            <p className="phone-restart-note" role="status">If this keeps happening, restart your phone once.</p>
          ) : null}
          {playError ? <p className="error">{playError}</p> : null}
          {active !== null && songs[active] ? (
            <div className="playlist-now">
              <span>{songs[active].title}</span>
              <div className="progress-wrap">
                <span className="time">{formatTime(currentTime)}</span>
                <div className="prog-bar" onClick={seek}>
                  <div className="prog-fill" style={{ width: duration ? `${(currentTime / duration) * 100}%` : "0%" }} />
                </div>
                <span className="time">{formatTime(duration)}</span>
              </div>
            </div>
          ) : null}
        </div>
        <div className="tracks">
          {adding ? (
            <SongAdder
              playlist={playlist}
              onChange={(next) => {
                setPlaylist(next);
                setName(next.name);
              }}
            />
          ) : null}
          {songs.map((song, index) => (
            <PlaylistRow
              key={song.trackId}
              song={song}
              index={index}
              active={active === index}
              isPlaying={active === index && playing}
              onWarm={warm}
              onOpen={() => {
                if (active === index && currentUrlRef.current) {
                  togglePlay();
                  return;
                }
                playAt(index, false);
              }}
              onRemove={() => onRemove(song.trackId)}
            />
          ))}
          {!songs.length && !adding ? (
            <p className="playlist-empty">This playlist is empty. Add songs from any album.</p>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function PlaylistRow({
  song,
  index,
  active,
  isPlaying,
  onWarm,
  onOpen,
  onRemove,
}: {
  song: PlaylistSongRef;
  index: number;
  active: boolean;
  isPlaying: boolean;
  onWarm: () => void;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const thumbSrc = song.imageUrl ? withImageWidth(song.imageUrl, LIST_THUMB_WIDTH) : "";
  return (
    <div
      className={`track-row${active ? " active" : ""}${isPlaying ? " playing" : ""}`}
      onPointerDown={onWarm}
      onClick={onOpen}
    >
      <span className="t-num">{String(index + 1).padStart(2, "0")}</span>
      {thumbSrc ? (
        <div className="t-thumb">
          <img
            className={imageIsHot(thumbSrc) ? "is-hot" : undefined}
            src={thumbSrc}
            alt=""
            decoding="async"
            ref={(img) => revealLoadedImage(img, thumbSrc)}
            onLoad={(event) => revealLoadedImage(event.currentTarget, thumbSrc)}
          />
        </div>
      ) : (
        <div className="t-thumb" />
      )}
      <div className="t-info">
        <div className="t-title">{song.title}</div>
        <div className="t-subtitle">{song.albumTitle}</div>
      </div>
      <span className="t-dur">{song.durationLabel || "—"}</span>
      <button
        type="button"
        className="playlist-text-btn"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onRemove();
        }}
      >
        Remove
      </button>
    </div>
  );
}

function SongAdder({
  playlist,
  onChange,
}: {
  playlist: UserPlaylist;
  onChange: (playlist: UserPlaylist) => void;
}) {
  const [albums, setAlbums] = useState<AlbumListItem[]>(() => albumsForPlaylistPicker(readCachedAlbums(), false));
  const [album, setAlbum] = useState<PublicAlbum | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let admin = false;
      try {
        admin = (await adminMe()).admin;
      } catch {
        admin = false;
      }
      if (cancelled) return;
      try {
        const list = admin ? await fetchAlbums() : await loadHomeAlbums();
        if (!cancelled) setAlbums(albumsForPlaylistPicker(list, admin));
      } catch (err) {
        if (!cancelled && albumsForPlaylistPicker(readCachedAlbums(), false).length === 0) {
          setError(err instanceof Error ? err.message : "Could not load albums");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function choose(slug: string) {
    setError("");
    const cached = readCachedAlbum(slug);
    setAlbum(cached);
    void prefetchAlbum(slug)
      .then((next) => setAlbum(next))
      .catch((err: Error) => setError(err.message));
  }

  function addTrack(track: PublicAlbum["tracks"][number]) {
    if (!album) return;
    const result = addPlaylistSong(playlist.id, playlistSongFromTrack(album, track));
    if ("error" in result) {
      setError(result.error);
      return;
    }
    onChange(result.playlist);
  }

  function removeTrack(trackId: string) {
    const next = removePlaylistSong(playlist.id, trackId);
    if (next) onChange(next);
  }

  return (
    <div className="song-adder">
      <p className="song-adder-label">Albums</p>
      <div className="song-adder-albums">
        {albums.map((item) => (
          <button
            key={item.id}
            type="button"
            className={album?.slug === item.slug ? "on" : ""}
            onClick={() => choose(item.slug)}
          >
            {item.title}
            {item.hidden ? <span className="hidden-badge">Hidden</span> : null}
          </button>
        ))}
      </div>
      {error ? <p className="error">{error}</p> : null}
      {album ? (
        <ul className="song-adder-tracks">
          {album.tracks.map((track) => {
            const included = playlist.songs.some((song) => song.trackId === track.id);
            return (
              <li key={track.id}>
                <span>{track.title}</span>
                <button type="button" onClick={() => (included ? removeTrack(track.id) : addTrack(track))}>
                  {included ? "Added" : "Add"}
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="playlist-device-note">Choose an album to add its songs.</p>
      )}
    </div>
  );
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
