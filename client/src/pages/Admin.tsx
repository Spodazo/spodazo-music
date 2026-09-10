import { useEffect, useId, useRef, useState, type MouseEvent, type ReactNode, type RefObject } from "react";
import type { AlbumListItem, PublicAlbum, PublicTrack } from "@shared/types";
import {
  adminLogin,
  adminLogout,
  adminMe,
  createAlbum,
  createTrack,
  createTracksBulk,
  deleteAlbum,
  fetchAlbum,
  fetchAlbums,
  reorderAlbums,
  reorderTracks,
  setAlbumHidden,
  setTrackArchived,
  trackFileUrl,
  updateAlbum,
  updateTrack,
} from "../lib/api";
import { assignSrc, pipelineIsDead, playSong, unlockAudio } from "../lib/audioCache";

type AdminQueue = {
  albumId: string;
  albumTitle: string;
  tracks: PublicTrack[];
  index: number;
};

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function useAdminPlayer() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const currentUrlRef = useRef("");
  const resumeTimeRef = useRef(0);
  const [queue, setQueue] = useState<AdminQueue | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const current = queue?.tracks[queue.index] ?? null;

  function startTrack(track: PublicTrack) {
    unlockAudio();
    const audio = audioRef.current;
    if (!audio || !track.audioUrl) return;
    currentUrlRef.current = track.audioUrl;
    resumeTimeRef.current = 0;
    if (audio.dataset.trackId !== track.id) {
      audio.dataset.trackId = track.id;
      assignSrc(audio, track.audioUrl);
      setCurrentTime(0);
      setDuration(0);
    }
    void audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  }

  function warmTrack(track: PublicTrack) {
    unlockAudio();
    const audio = audioRef.current;
    if (!audio || !track.audioUrl || !audio.paused) return;
    if (audio.dataset.trackId === track.id) return;
    audio.dataset.trackId = track.id;
    currentUrlRef.current = track.audioUrl;
    assignSrc(audio, track.audioUrl);
  }

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!current?.audioUrl) {
      audio.pause();
      audio.removeAttribute("src");
      delete audio.dataset.trackId;
      currentUrlRef.current = "";
      audio.load();
      setPlaying(false);
      setCurrentTime(0);
      setDuration(0);
    }
  }, [current]);

  function toggle() {
    const audio = audioRef.current;
    const url = currentUrlRef.current || current?.audioUrl;
    if (!audio || !current || !url) return;
    if (audio.paused) {
      const resumeTime = audio.currentTime > 0.15 ? audio.currentTime : resumeTimeRef.current;
      const play = pipelineIsDead(audio)
        ? playSong(audio, url, resumeTime, true)
        : audio.play().then(() => undefined);
      void play.then(() => setPlaying(true)).catch(() => undefined);
    } else {
      if (audio.currentTime > 0.15) resumeTimeRef.current = audio.currentTime;
      audio.pause();
      setPlaying(false);
    }
  }

  function playAlbumTracks(album: PublicAlbum, index: number, toggleSame = true) {
    const track = album.tracks[index];
    if (!track?.audioUrl) return;
    if (toggleSame && current?.id === track.id) {
      toggle();
      return;
    }
    setQueue({
      albumId: album.id,
      albumTitle: album.title,
      tracks: album.tracks,
      index,
    });
    startTrack(track);
  }

  function playAlbum(album: PublicAlbum) {
    if (queue?.albumId === album.id && current) {
      toggle();
      return;
    }
    const index = album.tracks.findIndex((track) => track.audioUrl);
    if (index >= 0) playAlbumTracks(album, index, false);
  }

  function syncQueue(album: PublicAlbum) {
    setQueue((currentQueue) => {
      if (!currentQueue || currentQueue.albumId !== album.id) return currentQueue;
      const playingId = currentQueue.tracks[currentQueue.index]?.id;
      const liveIndex = album.tracks.findIndex((track) => track.id === playingId);
      if (liveIndex >= 0) {
        return {
          albumId: album.id,
          albumTitle: album.title,
          tracks: album.tracks,
          index: liveIndex,
        };
      }
      const archived = album.archivedTracks || [];
      const archivedIndex = archived.findIndex((track) => track.id === playingId);
      if (archivedIndex >= 0) {
        return {
          albumId: album.id,
          albumTitle: `${album.title} (Archive)`,
          tracks: archived,
          index: archivedIndex,
        };
      }
      return null;
    });
  }

  function skip(delta: number) {
    if (!queue) return;
    if (delta > 0) {
      const found = queue.tracks.findIndex((track, index) => index > queue.index && track.audioUrl);
      if (found >= 0) {
        setQueue({ ...queue, index: found });
        startTrack(queue.tracks[found]);
      }
      return;
    }
    for (let index = queue.index - 1; index >= 0; index -= 1) {
      if (queue.tracks[index]?.audioUrl) {
        setQueue({ ...queue, index });
        startTrack(queue.tracks[index]);
        return;
      }
    }
  }

  function onEnded() {
    if (!queue) return;
    const next = queue.tracks.findIndex((track, index) => index > queue.index && track.audioUrl);
    if (next >= 0) {
      setQueue({ ...queue, index: next });
      startTrack(queue.tracks[next]);
      return;
    }
    setPlaying(false);
  }

  function restart() {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = 0;
    setCurrentTime(0);
  }

  function seek(event: MouseEvent<HTMLDivElement>) {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const rect = event.currentTarget.getBoundingClientRect();
    audio.currentTime = ((event.clientX - rect.left) / rect.width) * duration;
  }

  function stop() {
    const audio = audioRef.current;
    audio?.pause();
    if (audio) {
      audio.removeAttribute("src");
      delete audio.dataset.trackId;
      audio.load();
    }
    currentUrlRef.current = "";
    setQueue(null);
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
  }

  return {
    audioRef,
    queue,
    current,
    playing,
    currentTime,
    duration,
    playAlbum,
    playAlbumTracks,
    warmTrack,
    syncQueue,
    toggle,
    skip,
    restart,
    seek,
    stop,
    onEnded,
    setCurrentTime: (time: number) => {
      setCurrentTime(time);
      if (time > 0.15) resumeTimeRef.current = time;
    },
    setDuration,
    setPlaying,
  };
}

export default function AdminPage() {
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [albums, setAlbums] = useState<AlbumListItem[]>([]);
  const [selected, setSelected] = useState<PublicAlbum | null>(null);
  const player = useAdminPlayer();

  async function refresh() {
    const list = await fetchAlbums();
    setAlbums(list);
    if (selected) {
      const next = await fetchAlbum(selected.slug);
      setSelected(next);
    } else if (list[0]) {
      setSelected(await fetchAlbum(list[0].slug));
    }
  }

  useEffect(() => {
    adminMe()
      .then(async (me) => {
        setAuthed(me.admin);
        if (me.admin) await refresh();
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setReady(true));
  }, []);

  if (!ready) return <main className="admin"><p>Loading…</p></main>;

  if (!authed) {
    return (
      <main className="admin">
        <h1>Spodazo Music Admin</h1>
        <p>The public player stays open. This password only unlocks adding albums, songs, artwork, and lyrics.</p>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setError("");
            try {
              await adminLogin(password);
              setAuthed(true);
              await refresh();
            } catch (err) {
              setError(err instanceof Error ? err.message : "Login failed");
            }
          }}
        >
          <label htmlFor="password">Admin password</label>
          <input id="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          <button type="submit">Sign in</button>
          {error ? <p className="error">{error}</p> : null}
        </form>
      </main>
    );
  }

  async function loadAlbum(slug: string): Promise<PublicAlbum> {
    const album = await fetchAlbum(slug);
    setSelected(album);
    player.syncQueue(album);
    return album;
  }

  return (
    <main className={`admin${player.current ? " has-player" : ""}`}>
      <header className="admin-top">
        <h1>Spodazo Music Admin</h1>
        <div className="admin-top-actions">
          <a href="/" className="ghost">View site</a>
          <button
            className="ghost"
            onClick={async () => {
              player.stop();
              await adminLogout();
              setAuthed(false);
            }}
          >
            Sign out
          </button>
        </div>
      </header>
      {error ? <p className="error">{error}</p> : null}

      <AlbumList
        albums={albums}
        selectedId={selected?.id || null}
        playingId={player.queue?.albumId || null}
        playing={player.playing}
        onSelect={async (slug) => { await loadAlbum(slug); }}
        onPlay={async (slug) => {
          const album = selected?.slug === slug ? selected : await loadAlbum(slug);
          player.playAlbum(album);
        }}
        onReordered={setAlbums}
        onChanged={async () => {
          const list = await fetchAlbums();
          setAlbums(list);
          if (selected) await loadAlbum(selected.slug);
        }}
      />

      {selected ? (
        <>
          <TrackAdmin
            album={selected}
            currentTrackId={player.current?.id || null}
            playing={player.playing}
            onWarm={(trackId) => {
              const track =
                selected.tracks.find((item) => item.id === trackId) ||
                selected.archivedTracks?.find((item) => item.id === trackId);
              if (track) player.warmTrack(track);
            }}
            onPlay={(trackId) => {
              const liveIndex = selected.tracks.findIndex((track) => track.id === trackId);
              if (liveIndex >= 0) {
                player.playAlbumTracks(selected, liveIndex);
                return;
              }
              const archived = selected.archivedTracks || [];
              const archivedIndex = archived.findIndex((track) => track.id === trackId);
              if (archivedIndex >= 0) {
                player.playAlbumTracks({ ...selected, tracks: archived }, archivedIndex);
              }
            }}
            onPlayAll={() => player.playAlbum(selected)}
            onChange={async () => { await loadAlbum(selected.slug); }}
          />
          <AlbumForm
            key={selected.id}
            album={selected}
            onSaved={async (slug) => {
              const list = await fetchAlbums();
              setAlbums(list);
              await loadAlbum(slug);
            }}
            onDeleted={async () => {
              if (player.queue?.albumId === selected.id) player.stop();
              setSelected(null);
              await refresh();
            }}
          />
        </>
      ) : null}

      <AlbumForm
        onSaved={async () => {
          setSelected(null);
          await refresh();
        }}
      />

      <AdminPlayer
        audioRef={player.audioRef}
        current={player.current}
        albumTitle={player.queue?.albumTitle || ""}
        playing={player.playing}
        currentTime={player.currentTime}
        duration={player.duration}
        onToggle={player.toggle}
        onSkip={player.skip}
        onRestart={player.restart}
        onSeek={player.seek}
        onStop={player.stop}
        onEnded={player.onEnded}
        onTimeUpdate={player.setCurrentTime}
        onDurationChange={player.setDuration}
        onPlayingChange={player.setPlaying}
      />
    </main>
  );
}

function AlbumForm({
  album,
  onSaved,
  onDeleted,
}: {
  album?: PublicAlbum;
  onSaved: (slug: string) => Promise<void>;
  onDeleted?: () => Promise<void>;
}) {
  const [error, setError] = useState("");
  return (
    <form
      className="card"
      onSubmit={async (event) => {
        event.preventDefault();
        setError("");
        const formEl = event.currentTarget;
        const form = new FormData(formEl);
        try {
          const saved = album ? await updateAlbum(album.id, form) : await createAlbum(form);
          await onSaved(saved.slug);
          if (!album) formEl.reset();
        } catch (err) {
          setError(err instanceof Error ? err.message : "Save failed");
        }
      }}
    >
      <h2>{album ? `Edit ${album.title}` : "New album"}</h2>
      <div className="row-2">
        <div>
          <label>Title</label>
          <input name="title" defaultValue={album?.title} required />
        </div>
        <div>
          <label>URL slug</label>
          <input name="slug" defaultValue={album?.slug} placeholder="echoes" />
        </div>
      </div>
      <label>Artists</label>
      <input name="artists" defaultValue={album?.artists} />
      <label>Tagline</label>
      <input name="tagline" defaultValue={album?.tagline} />
      <label>Credits</label>
      <input name="credits" defaultValue={album?.credits} />
      <label>Copyright</label>
      <textarea name="copyright" defaultValue={album?.copyright} />
      <div className="row-2">
        <div>
          <label>Hero portrait</label>
          <input name="hero" type="file" accept="image/*" />
        </div>
        <div>
          <label>Album cover</label>
          <input name="thumb" type="file" accept="image/*" />
        </div>
      </div>
      <label>Artist photo (player thumbnail)</label>
      <input name="artist" type="file" accept="image/*" />
      <label>
        <input name="hidden" type="checkbox" value="true" defaultChecked={album ? album.hidden : true} /> Hide from the
        public site. You can still play it while signed in as admin.
      </label>
      <div className="form-actions">
        <button type="submit">{album ? "Save album" : "Create album"}</button>
        {album && onDeleted ? (
          <button
            type="button"
            className="danger"
            onClick={async () => {
              if (!confirm(`Delete ${album.title}?`)) return;
              await deleteAlbum(album.id);
              await onDeleted();
            }}
          >
            Delete album
          </button>
        ) : null}
      </div>
      {error ? <p className="error">{error}</p> : null}
    </form>
  );
}

function moveById<T extends { id: string }>(items: T[], fromId: string, toId: string): T[] {
  if (fromId === toId) return items;
  const from = items.findIndex((item) => item.id === fromId);
  const to = items.findIndex((item) => item.id === toId);
  if (from < 0 || to < 0) return items;
  const next = items.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function AlbumList({
  albums,
  selectedId,
  playingId,
  playing,
  onSelect,
  onPlay,
  onReordered,
  onChanged,
}: {
  albums: AlbumListItem[];
  selectedId: string | null;
  playingId: string | null;
  playing: boolean;
  onSelect: (slug: string) => Promise<void>;
  onPlay: (slug: string) => Promise<void>;
  onReordered: (albums: AlbumListItem[]) => void;
  onChanged: () => Promise<void>;
}) {
  const [rows, setRows] = useState(albums);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  useEffect(() => {
    setRows(albums);
  }, [albums]);

  async function dropOn(fromId: string | null, targetId: string) {
    setDraggingId(null);
    if (!fromId) return;
    const next = moveById(rows, fromId, targetId);
    if (next === rows) return;
    setRows(next);
    try {
      onReordered(await reorderAlbums(next.map((album) => album.id)));
    } catch {
      setRows(albums);
    }
  }

  return (
    <div className="card">
      <h2>Albums</h2>
      <p className="hint">Drag to reorder. Hidden albums stay off the public homepage.</p>
      {rows.map((album) => (
        <div
          className={`album-admin${selectedId === album.id ? " selected" : ""}${draggingId === album.id ? " dragging" : ""}`}
          key={album.id}
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
          }}
          onDrop={(event) => {
            event.preventDefault();
            void dropOn(event.dataTransfer.getData("text/plain") || draggingId, album.id);
          }}
        >
          <button
            type="button"
            className="drag-handle"
            draggable
            title="Drag to reorder"
            aria-label={`Reorder ${album.title}`}
            onDragStart={(event) => {
              setDraggingId(album.id);
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", album.id);
            }}
            onDragEnd={() => setDraggingId(null)}
          >
            ⋮⋮
          </button>
          <button
            type="button"
            className={`album-admin-select${selectedId === album.id ? " selected" : ""}`}
            onClick={() => void onSelect(album.slug)}
          >
            <span className="album-admin-name">{album.title}</span>
            {album.hidden ? <span className="hidden-badge">Hidden</span> : null}
          </button>
          <button
            type="button"
            className={`album-admin-visibility${album.hidden ? "" : " ghost"}`}
            onClick={async () => {
              await setAlbumHidden(album.id, !album.hidden);
              await onChanged();
            }}
          >
            {album.hidden ? (
              <>
                <span className="label-full">Show on site</span>
                <span className="label-short">Show</span>
              </>
            ) : (
              <>
                <span className="label-full">Hide from site</span>
                <span className="label-short">Hide</span>
              </>
            )}
          </button>
          <button
            type="button"
            className={`album-admin-play${playingId === album.id ? "" : " ghost"}`}
            onClick={() => void onPlay(album.slug)}
          >
            {playingId === album.id && playing ? "Pause" : "Play"}
          </button>
        </div>
      ))}
    </div>
  );
}

function TrackDownload({ track }: { track: PublicTrack }) {
  if (!track.file) {
    return (
      <span className="ghost" aria-disabled="true" title="No audio file">
        Download
      </span>
    );
  }
  return (
    <a className="ghost" href={trackFileUrl(track.id)} download={track.file} title={`Download ${track.title}`}>
      Download
    </a>
  );
}

function TrackAdmin({
  album,
  currentTrackId,
  playing,
  onWarm,
  onPlay,
  onPlayAll,
  onChange,
}: {
  album: PublicAlbum;
  currentTrackId: string | null;
  playing: boolean;
  onWarm: (trackId: string) => void;
  onPlay: (trackId: string) => void;
  onPlayAll: () => void;
  onChange: () => Promise<void>;
}) {
  const [editing, setEditing] = useState<PublicTrack | null>(null);
  const [rows, setRows] = useState(album.tracks);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  useEffect(() => {
    setRows(album.tracks);
  }, [album.tracks]);

  async function dropOn(fromId: string | null, targetId: string) {
    setDraggingId(null);
    if (!fromId) return;
    const next = moveById(rows, fromId, targetId);
    if (next === rows) return;
    setRows(next);
    try {
      await reorderTracks(album.id, next.map((track) => track.id));
      await onChange();
    } catch {
      setRows(album.tracks);
    }
  }

  return (
    <section className="card">
      <div className="track-head">
        <h2>Tracks — {album.title}</h2>
        <div className="track-head-actions">
          <button
            type="button"
            className="ghost"
            onPointerDown={() => {
              if (album.tracks[0]) onWarm(album.tracks[0].id);
            }}
            onClick={onPlayAll}
            disabled={!album.tracks.some((track) => track.audioUrl)}
          >
            {currentTrackId && album.tracks.some((track) => track.id === currentTrackId) && playing ? "Pause" : "Play all"}
          </button>
          <BulkTrackUpload albumId={album.id} onSaved={onChange} />
        </div>
      </div>
      <p className="hint">
        Drag the handle to reorder songs. Play a track here, or download the live MP3 to keep a copy.
      </p>
      {rows.map((track, index) => (
        <div
          className={`track-admin${draggingId === track.id ? " dragging" : ""}${currentTrackId === track.id ? " playing" : ""}`}
          key={track.id}
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
          }}
          onDrop={(event) => {
            event.preventDefault();
            void dropOn(event.dataTransfer.getData("text/plain") || draggingId, track.id);
          }}
        >
          <button
            type="button"
            className="drag-handle"
            draggable
            title="Drag to reorder"
            aria-label={`Reorder ${track.title}`}
            onDragStart={(event) => {
              setDraggingId(track.id);
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", track.id);
            }}
            onDragEnd={() => setDraggingId(null)}
          >
            ⋮⋮
          </button>
          <div className="track-admin-num">{String(index + 1).padStart(2, "0")}</div>
          {track.imageUrl ? <img src={track.imageUrl} alt="" /> : <div className="track-admin-placeholder">No cover</div>}
          <div className="track-admin-info">
            <strong>{track.title}</strong>
            <div>{track.scripture || (track.lyrics ? "" : "Add subtitle, lyrics, and cover later")}</div>
          </div>
          <div className="track-admin-actions">
            <button
              type="button"
              className={`ghost admin-track-play${currentTrackId === track.id && playing ? " on" : ""}`}
              onPointerDown={() => onWarm(track.id)}
              onClick={() => onPlay(track.id)}
              disabled={!track.audioUrl}
              title={track.audioUrl ? (currentTrackId === track.id && playing ? "Pause" : "Play") : "No audio file"}
              aria-label={`${currentTrackId === track.id && playing ? "Pause" : "Play"} ${track.title}`}
            >
              {currentTrackId === track.id && playing ? <IconPause /> : <IconPlay />}
            </button>
            <button type="button" className="ghost" onClick={() => setEditing(track)}>Edit</button>
            <TrackDownload track={track} />
            <button
              type="button"
              className="danger"
              onClick={async () => {
                if (!confirm(`Archive ${track.title}? You can restore it later from Archive.`)) return;
                await setTrackArchived(track.id, true);
                await onChange();
              }}
            >
              Archive
            </button>
          </div>
        </div>
      ))}
      <TrackForm
        key="new"
        albumId={album.id}
        track={null}
        nextNumber={album.tracks.length + 1}
        onSaved={onChange}
        onCancel={() => undefined}
      />
      <ArchiveList
        tracks={album.archivedTracks || []}
        currentTrackId={currentTrackId}
        playing={playing}
        onWarm={onWarm}
        onPlay={onPlay}
        onRestore={async (track) => {
          await setTrackArchived(track.id, false);
          await onChange();
        }}
        onEdit={setEditing}
      />
      {editing ? (
        <AdminDialog title={`Edit ${editing.title}`} onClose={() => setEditing(null)}>
          <TrackForm
            key={editing.id}
            albumId={album.id}
            track={editing}
            nextNumber={editing.n}
            heading={false}
            onSaved={async () => {
              setEditing(null);
              await onChange();
            }}
            onCancel={() => setEditing(null)}
          />
        </AdminDialog>
      ) : null}
    </section>
  );
}

function ArchiveList({
  tracks,
  currentTrackId,
  playing,
  onWarm,
  onPlay,
  onRestore,
  onEdit,
}: {
  tracks: PublicTrack[];
  currentTrackId: string | null;
  playing: boolean;
  onWarm: (trackId: string) => void;
  onPlay: (trackId: string) => void;
  onRestore: (track: PublicTrack) => Promise<void>;
  onEdit: (track: PublicTrack) => void;
}) {
  return (
    <div className="archive-block">
      <h3>Archive</h3>
      <p className="hint">
        {tracks.length
          ? "These songs are hidden from the album. Restore one to put it back live."
          : "Archived songs will appear here so you can restore them later."}
      </p>
      {tracks.map((track) => (
        <div
          className={`track-admin archive-row${currentTrackId === track.id ? " playing" : ""}`}
          key={track.id}
        >
          {track.imageUrl ? <img src={track.imageUrl} alt="" /> : <div className="track-admin-placeholder">No cover</div>}
          <div className="track-admin-info">
            <strong>{track.title}</strong>
            <div>{track.scripture || "Archived"}</div>
          </div>
          <div className="track-admin-actions">
            <button
              type="button"
              className={`ghost admin-track-play${currentTrackId === track.id && playing ? " on" : ""}`}
              onPointerDown={() => onWarm(track.id)}
              onClick={() => onPlay(track.id)}
              disabled={!track.audioUrl}
              title={track.audioUrl ? (currentTrackId === track.id && playing ? "Pause" : "Play") : "No audio file"}
              aria-label={`${currentTrackId === track.id && playing ? "Pause" : "Play"} ${track.title}`}
            >
              {currentTrackId === track.id && playing ? <IconPause /> : <IconPlay />}
            </button>
            <button type="button" className="ghost" onClick={() => onEdit(track)}>Edit</button>
            <TrackDownload track={track} />
            <button type="button" onClick={() => void onRestore(track)}>Restore</button>
          </div>
        </div>
      ))}
    </div>
  );
}

function BulkTrackUpload({ albumId, onSaved }: { albumId: string; onSaved: () => Promise<void> }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState(0);
  const inputId = useId();
  return (
    <form
      className="bulk-upload-inline"
      onSubmit={async (event) => {
        event.preventDefault();
        setError("");
        const formEl = event.currentTarget;
        const form = new FormData(formEl);
        const files = form.getAll("audio").filter((item) => item instanceof File && item.size > 0);
        if (!files.length) {
          setError("Choose one or more MP3 files");
          return;
        }
        setBusy(true);
        try {
          await createTracksBulk(albumId, form);
          await onSaved();
          formEl.reset();
          setPicked(0);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Upload failed");
        } finally {
          setBusy(false);
        }
      }}
    >
      <input
        id={inputId}
        className="file-input-hidden"
        name="audio"
        type="file"
        accept="audio/mpeg,audio/*"
        multiple
        onChange={(event) => setPicked(event.currentTarget.files?.length || 0)}
      />
      <label htmlFor={inputId} className="ghost file-pick">
        {picked ? `${picked} selected` : "Choose files"}
      </label>
      <button type="submit" disabled={busy}>
        {busy ? "Uploading…" : picked ? `Upload ${picked}` : "Upload"}
      </button>
      {error ? <p className="error">{error}</p> : null}
    </form>
  );
}

function TrackForm({
  albumId,
  track,
  nextNumber,
  heading = true,
  onSaved,
  onCancel,
}: {
  albumId: string;
  track: PublicTrack | null;
  nextNumber: number;
  heading?: boolean;
  onSaved: () => Promise<void>;
  onCancel: () => void;
}) {
  const [error, setError] = useState("");
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        setError("");
        const formEl = event.currentTarget;
        const form = new FormData(formEl);
        try {
          if (track) await updateTrack(track.id, form);
          else await createTrack(albumId, form);
          await onSaved();
          formEl.reset();
        } catch (err) {
          setError(err instanceof Error ? err.message : "Save failed");
        }
      }}
    >
      {heading ? <h3>{track ? `Edit ${track.title}` : "Add one song"}</h3> : null}
      <div className="row-2">
        <div>
          <label>Title</label>
          <input name="title" defaultValue={track?.title} required />
        </div>
        <div>
          <label>Subtitle</label>
          <input name="scripture" defaultValue={track?.scripture} placeholder="Shown under the song title" />
        </div>
      </div>
      <div className="row-2">
        <div>
          <label>{track ? "Replace MP3" : "Audio file"}</label>
          <input name="audio" type="file" accept="audio/mpeg,audio/*" />
          {track?.file ? <p className="hint">Current file: {track.file}. Leave empty to keep it.</p> : null}
        </div>
        <div>
          <label>{track ? "Replace artwork" : "Artwork"}</label>
          <input name="artwork" type="file" accept="image/*" />
        </div>
      </div>
      <label>Introduction</label>
      <textarea name="introduction" defaultValue={track?.introduction} placeholder="Optional. Shown above the lyrics." />
      <label>Lyrics</label>
      <textarea name="lyrics" defaultValue={track?.lyrics} />
      <label>
        <input name="instrumental" type="checkbox" value="true" defaultChecked={track?.instrumental} /> Instrumental
      </label>
      <input type="hidden" name="n" value={track?.n || nextNumber} />
      <div className="form-actions">
        <button type="submit">{track ? "Save song" : "Add song"}</button>
        {track ? <button type="button" className="ghost" onClick={onCancel}>Cancel</button> : null}
      </div>
      {error ? <p className="error">{error}</p> : null}
    </form>
  );
}

function AdminDialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    const focusable = panelRef.current?.querySelector<HTMLElement>("input:not([type='hidden']), textarea, select");
    focusable?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div className="admin-dialog-backdrop" onClick={onClose} role="presentation">
      <div
        ref={panelRef}
        className="admin-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="admin-dialog-head">
          <h3>{title}</h3>
          <button type="button" className="ghost admin-dialog-close" onClick={onClose} aria-label="Close">
            <IconClose />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function AdminPlayer({
  audioRef,
  current,
  albumTitle,
  playing,
  currentTime,
  duration,
  onToggle,
  onSkip,
  onRestart,
  onSeek,
  onStop,
  onEnded,
  onTimeUpdate,
  onDurationChange,
  onPlayingChange,
}: {
  audioRef: RefObject<HTMLAudioElement>;
  current: PublicTrack | null;
  albumTitle: string;
  playing: boolean;
  currentTime: number;
  duration: number;
  onToggle: () => void;
  onSkip: (delta: number) => void;
  onRestart: () => void;
  onSeek: (event: MouseEvent<HTMLDivElement>) => void;
  onStop: () => void;
  onEnded: () => void;
  onTimeUpdate: (time: number) => void;
  onDurationChange: (duration: number) => void;
  onPlayingChange: (playing: boolean) => void;
}) {
  return (
    <>
      {current ? (
        <div className="admin-player" role="region" aria-label="Admin player">
          {current.imageUrl ? (
            <img className="admin-player-art" src={current.imageUrl} alt="" />
          ) : (
            <div className="admin-player-art placeholder" aria-hidden="true" />
          )}
          <div className="admin-player-meta">
            <div className="admin-player-title">{current.title}</div>
            <div className="admin-player-album">{albumTitle}</div>
          </div>
          <div className="admin-player-controls">
            <button type="button" className="ghost admin-player-ctrl" onClick={onRestart} title="Back to beginning" aria-label="Back to beginning">
              <IconRestart />
            </button>
            <button type="button" className="ghost admin-player-ctrl" onClick={() => onSkip(-1)} title="Previous" aria-label="Previous">
              <IconPrev />
            </button>
            <button
              type="button"
              className="admin-player-play"
              onClick={onToggle}
              title={playing ? "Pause" : "Play"}
              aria-label={playing ? "Pause" : "Play"}
            >
              {playing ? <IconPause /> : <IconPlay />}
            </button>
            <button type="button" className="ghost admin-player-ctrl" onClick={() => onSkip(1)} title="Next" aria-label="Next">
              <IconNext />
            </button>
            <button type="button" className="ghost admin-player-ctrl" onClick={onStop} title="Close player" aria-label="Close player">
              <IconClose />
            </button>
          </div>
          <div className="admin-player-progress">
            <span className="time">{formatTime(currentTime)}</span>
            <div className="prog-bar" onClick={onSeek}>
              <div className="prog-fill" style={{ width: duration ? `${(currentTime / duration) * 100}%` : "0%" }} />
            </div>
            <span className="time">{formatTime(duration)}</span>
          </div>
        </div>
      ) : null}
      <audio
        ref={audioRef}
        preload="auto"
        playsInline
        onTimeUpdate={(event) => onTimeUpdate(event.currentTarget.currentTime)}
        onDurationChange={(event) => onDurationChange(event.currentTarget.duration || 0)}
        onEnded={onEnded}
        onPlay={() => onPlayingChange(true)}
        onPause={() => onPlayingChange(false)}
      />
    </>
  );
}

function IconPlay() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
  );
}

function IconPause() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>
  );
}

function IconRestart() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z" />
    </svg>
  );
}

function IconPrev() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" /></svg>
  );
}

function IconNext() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 18l8.5-6L6 6v12zm2-8.14L11.03 12 8 14.14V9.86zM16 6h2v12h-2z" /></svg>
  );
}

function IconClose() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" /></svg>
  );
}
