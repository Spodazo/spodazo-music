import { useEffect, useState } from "react";
import type { AlbumListItem, PublicAlbum, PublicTrack } from "@shared/types";
import {
  adminLogin,
  adminLogout,
  adminMe,
  createAlbum,
  createTrack,
  deleteAlbum,
  deleteTrack,
  fetchAlbum,
  fetchAlbums,
  updateAlbum,
  updateTrack,
} from "../lib/api";

export default function AdminPage() {
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [albums, setAlbums] = useState<AlbumListItem[]>([]);
  const [selected, setSelected] = useState<PublicAlbum | null>(null);

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

  return (
    <main className="admin">
      <h1>Spodazo Music Admin</h1>
      <p>
        Add albums and songs here. No index file rewrite.{" "}
        <a href="/" className="ghost" style={{ display: "inline-block", textDecoration: "none" }}>View site</a>
        <button
          className="ghost"
          onClick={async () => {
            await adminLogout();
            setAuthed(false);
          }}
        >
          Sign out
        </button>
      </p>
      {error ? <p className="error">{error}</p> : null}

      <div className="card">
        <h2>Albums</h2>
        {albums.map((album) => (
          <button
            key={album.id}
            className={selected?.id === album.id ? "" : "ghost"}
            onClick={async () => setSelected(await fetchAlbum(album.slug))}
          >
            {album.title}
          </button>
        ))}
      </div>

      <AlbumForm
        onSaved={async () => {
          setSelected(null);
          await refresh();
        }}
      />

      {selected ? (
        <>
          <AlbumForm
            album={selected}
            onSaved={async (slug) => {
              const list = await fetchAlbums();
              setAlbums(list);
              setSelected(await fetchAlbum(slug));
            }}
            onDeleted={async () => {
              setSelected(null);
              await refresh();
            }}
          />
          <TrackAdmin album={selected} onChange={async () => setSelected(await fetchAlbum(selected.slug))} />
        </>
      ) : null}
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
        const form = new FormData(event.currentTarget);
        try {
          const saved = album ? await updateAlbum(album.id, form) : await createAlbum(form);
          await onSaved(saved.slug);
          if (!album) event.currentTarget.reset();
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
          <label>Thumbnail</label>
          <input name="thumb" type="file" accept="image/*" />
        </div>
      </div>
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

function TrackAdmin({ album, onChange }: { album: PublicAlbum; onChange: () => Promise<void> }) {
  const [editing, setEditing] = useState<PublicTrack | null>(null);
  return (
    <section className="card">
      <h2>Tracks — {album.title}</h2>
      {album.tracks.map((track) => (
        <div className="track-admin" key={track.id}>
          <div>{String(track.n).padStart(2, "0")}</div>
          {track.imageUrl ? <img src={track.imageUrl} alt="" /> : <div />}
          <div>
            <strong>{track.title}</strong>
            <div>{track.scripture}</div>
          </div>
          <div>
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
        const form = new FormData(event.currentTarget);
        try {
          if (track) await updateTrack(track.id, form);
          else await createTrack(albumId, form);
          await onSaved();
          event.currentTarget.reset();
        } catch (err) {
          setError(err instanceof Error ? err.message : "Save failed");
        }
      }}
    >
      <h3>{track ? `Edit ${track.title}` : "Add song"}</h3>
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
      <label>Lyrics</label>
      <textarea name="lyrics" defaultValue={track?.lyrics} />
      <div className="row-2">
        <div>
          <label>Audio file</label>
          <input name="audio" type="file" accept="audio/*" />
        </div>
        <div>
          <label>Artwork</label>
          <input name="artwork" type="file" accept="image/*" />
        </div>
      </div>
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
