import { useEffect, useRef, useState, type MouseEvent, type RefObject } from "react";
import type { AlbumListItem, PublicAlbum, PublicTrack } from "@shared/types";
import {
  adminLogin,
  adminLogout,
  adminMe,
  createAlbum,
  createTrack,
  createTracksBulk,
  deleteAlbum,
  deleteTrack,
  fetchAlbum,
  fetchAlbums,
  reorderAlbums,
  reorderTracks,
  setAlbumHidden,
  updateAlbum,
  updateTrack,
} from "../lib/api";

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
  const [queue, setQueue] = useState<AdminQueue | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const current = queue?.tracks[queue.index] ?? null;

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!current?.audioUrl) {
      audio.pause();
      audio.removeAttribute("src");
      delete audio.dataset.trackId;
      audio.load();
      setPlaying(false);
      setCurrentTime(0);
      setDuration(0);
      return;
    }
    if (audio.dataset.trackId === current.id) return;
    audio.dataset.trackId = current.id;
    audio.src = current.audioUrl;
    setCurrentTime(0);
    setDuration(0);
    audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  }, [current]);

  function toggle() {
    const audio = audioRef.current;
    if (!audio || !current) return;
    if (audio.paused) {
      audio.play().then(() => setPlaying(true)).catch(() => undefined);
    } else {
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
      const index = album.tracks.findIndex((track) => track.id === playingId);
      if (!album.tracks.length) return null;
      return {
        albumId: album.id,
        albumTitle: album.title,
        tracks: album.tracks,
        index: index >= 0 ? index : 0,
      };
    });
  }

  function skip(delta: number) {
    if (!queue) return;
    if (delta > 0) {
      const found = queue.tracks.findIndex((track, index) => index > queue.index && track.audioUrl);
      if (found >= 0) setQueue({ ...queue, index: found });
      return;
    }
    for (let index = queue.index - 1; index >= 0; index -= 1) {
      if (queue.tracks[index]?.audioUrl) {
        setQueue({ ...queue, index });
        return;
      }
    }
  }

  function onEnded() {
    if (!queue) return;
    const next = queue.tracks.findIndex((track, index) => index > queue.index && track.audioUrl);
    if (next >= 0) {
      setQueue({ ...queue, index: next });
      return;
    }
    setPlaying(false);
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
    syncQueue,
    toggle,
    skip,
    seek,
    stop,
    onEnded,
    setCurrentTime,
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
      <h1>Spodazo Music Admin</h1>
      <p>
        <a href="/" className="ghost" style={{ display: "inline-block", textDecoration: "none" }}>View site</a>
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
      </p>
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
            onPlay={(trackId) => {
              const index = selected.tracks.findIndex((track) => track.id === trackId);
              if (index >= 0) player.playAlbumTracks(selected, index);
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
          <button type="button" className={selectedId === album.id ? "" : "ghost"} onClick={() => void onSelect(album.slug)}>
            {album.title}
            {album.hidden ? <span className="hidden-badge">Hidden</span> : null}
          </button>
          <button
            type="button"
            className={album.hidden ? "" : "ghost"}
            onClick={async () => {
              await setAlbumHidden(album.id, !album.hidden);
              await onChanged();
            }}
          >
            {album.hidden ? "Show on site" : "Hide from site"}
          </button>
          <button type="button" className={playingId === album.id ? "" : "ghost"} onClick={() => void onPlay(album.slug)}>
            {playingId === album.id && playing ? "Pause" : "Play"}
          </button>
        </div>
      ))}
    </div>
  );
}

function TrackAdmin({
  album,
  currentTrackId,
  playing,
  onPlay,
  onPlayAll,
  onChange,
}: {
  album: PublicAlbum;
  currentTrackId: string | null;
  playing: boolean;
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
          <button type="button" className="ghost" onClick={onPlayAll} disabled={!album.tracks.some((track) => track.audioUrl)}>
            {currentTrackId && album.tracks.some((track) => track.id === currentTrackId) && playing ? "Pause" : "Play all"}
          </button>
          <BulkTrackUpload albumId={album.id} onSaved={onChange} />
        </div>
      </div>
      <p className="hint">Drag the handle to reorder songs. Play a track here without leaving Admin.</p>
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
          <div>{String(index + 1).padStart(2, "0")}</div>
          {track.imageUrl ? <img src={track.imageUrl} alt="" /> : <div className="track-admin-placeholder">No cover</div>}
          <div>
            <strong>{track.title}</strong>
            <div>{track.scripture || (track.lyrics ? "" : "Add scripture, lyrics, and cover later")}</div>
          </div>
          <div className="track-admin-actions">
            <button
              type="button"
              className={`ghost admin-track-play${currentTrackId === track.id && playing ? " on" : ""}`}
              onClick={() => onPlay(track.id)}
              disabled={!track.audioUrl}
              title={track.audioUrl ? (currentTrackId === track.id && playing ? "Pause" : "Play") : "No audio file"}
              aria-label={`${currentTrackId === track.id && playing ? "Pause" : "Play"} ${track.title}`}
            >
              {currentTrackId === track.id && playing ? <IconPause /> : <IconPlay />}
            </button>
            <button type="button" className="ghost" onClick={() => setEditing(track)}>Edit</button>
            <button
              type="button"
              className="danger"
              onClick={async () => {
                if (!confirm(`Remove ${track.title}?`)) return;
                await deleteTrack(track.id);
                await onChange();
              }}
            >
              Remove
            </button>
          </div>
        </div>
      ))}
      <TrackForm
        key={editing?.id || "new"}
        albumId={album.id}
        track={editing}
        nextNumber={album.tracks.length + 1}
        onSaved={async () => {
          setEditing(null);
          await onChange();
        }}
        onCancel={() => setEditing(null)}
      />
    </section>
  );
}

function BulkTrackUpload({ albumId, onSaved }: { albumId: string; onSaved: () => Promise<void> }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState(0);
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
        name="audio"
        type="file"
        accept="audio/mpeg,audio/*"
        multiple
        aria-label="Choose multiple MP3s"
        onChange={(event) => setPicked(event.currentTarget.files?.length || 0)}
      />
      <button type="submit" disabled={busy}>
        {busy ? "Uploading…" : picked ? `Upload ${picked} song${picked === 1 ? "" : "s"}` : "Upload songs"}
      </button>
      {error ? <p className="error">{error}</p> : null}
    </form>
  );
}

function TrackForm({
  albumId,
  track,
  nextNumber,
  onSaved,
  onCancel,
}: {
  albumId: string;
  track: PublicTrack | null;
  nextNumber: number;
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
      <h3>{track ? `Edit ${track.title}` : "Add one song"}</h3>
      <div className="row-2">
        <div>
          <label>Title</label>
          <input name="title" defaultValue={track?.title} required />
        </div>
        <div>
          <label>Scripture</label>
          <input name="scripture" defaultValue={track?.scripture} />
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
      <label>Lyrics</label>
      <textarea name="lyrics" defaultValue={track?.lyrics} />
      <label>
        <input name="instrumental" type="checkbox" value="true" defaultChecked={track?.instrumental} /> Instrumental
      </label>
      <input type="hidden" name="n" value={track?.n || nextNumber} />
      <button type="submit">{track ? "Save song" : "Add song"}</button>
      {track ? <button type="button" className="ghost" onClick={onCancel}>Cancel</button> : null}
      {error ? <p className="error">{error}</p> : null}
    </form>
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
