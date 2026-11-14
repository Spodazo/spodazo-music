import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { syncAdminPlaylists } from "../lib/playlistSync";
import {
  addPlaylistSong,
  cleanPlaylistName,
  createPlaylist,
  readPlaylists,
  removePlaylistSong,
  subscribePlaylists,
  type PlaylistSongRef,
  type UserPlaylist,
} from "../lib/playlists";

function stop(event: PointerEvent | MouseEvent) {
  event.stopPropagation();
}

export default function AddToPlaylist({ song }: { song: PlaylistSongRef }) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [playlists, setPlaylists] = useState<UserPlaylist[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [box, setBox] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (!open) return;
    const refresh = () => setPlaylists(readPlaylists());
    refresh();
    void syncAdminPlaylists().then((list) => {
      if (list) setPlaylists(list);
    });
    return subscribePlaylists(refresh);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function placeMenu() {
    const anchor = buttonRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const width = Math.min(280, window.innerWidth - 16);
    const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
    const below = rect.bottom + 8;
    const top = window.innerHeight - below < 200 ? Math.max(8, rect.top - 248) : below;
    setBox({ top, left });
  }

  function toggle(event: MouseEvent<HTMLButtonElement>) {
    stop(event);
    setError("");
    if (open) {
      setOpen(false);
      return;
    }
    setPlaylists(readPlaylists());
    setOpen(true);
    placeMenu();
  }

  function toggleSong(playlist: UserPlaylist) {
    setError("");
    const already = playlist.songs.some((item) => item.trackId === song.trackId);
    if (already) {
      removePlaylistSong(playlist.id, song.trackId);
      return;
    }
    const result = addPlaylistSong(playlist.id, song);
    if ("error" in result) setError(result.error);
  }

  function createAndAdd(event: MouseEvent<HTMLButtonElement>) {
    stop(event);
    const created = createPlaylist(name);
    if ("error" in created) {
      setError(created.error);
      return;
    }
    const added = addPlaylistSong(created.playlist.id, song);
    if ("error" in added) {
      setError(added.error);
      return;
    }
    setName("");
    setError("");
  }

  const menu = open
    ? createPortal(
      <div
        className="playlist-menu"
        style={{ top: box.top, left: box.left }}
        onPointerDown={stop}
        onClick={stop}
      >
        <p className="playlist-menu-title">Add to a playlist</p>
        <p className="playlist-menu-note">Saved on this device. Your login also keeps them on your other devices.</p>
        {playlists.length ? (
          <ul className="playlist-menu-list">
            {playlists.map((playlist) => {
              const included = playlist.songs.some((item) => item.trackId === song.trackId);
              return (
                <li key={playlist.id}>
                  <button type="button" onClick={() => toggleSong(playlist)} aria-pressed={included}>
                    <span>{playlist.name}</span>
                    <span>{included ? "Added" : "Add"}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="playlist-menu-empty">No playlists yet.</p>
        )}
        <form className="playlist-menu-create" onSubmit={(event) => event.preventDefault()}>
          <input
            value={name}
            maxLength={60}
            placeholder="New playlist"
            aria-label="New playlist name"
            onChange={(event) => setName(event.target.value)}
          />
          <button type="button" onClick={createAndAdd} disabled={!cleanPlaylistName(name)}>
            Create
          </button>
        </form>
        {error ? <p className="playlist-menu-error">{error}</p> : null}
      </div>,
      document.body,
    )
    : null;

  return (
    <div className="t-add-wrap" onPointerDown={stop} onClick={stop}>
      <button
        ref={buttonRef}
        type="button"
        className={`t-add${open ? " on" : ""}`}
        title="Add to a playlist"
        aria-label={`Add ${song.title} to a playlist`}
        aria-expanded={open}
        onClick={toggle}
      >
        <IconPlus />
      </button>
      {menu}
    </div>
  );
}

function IconPlus() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z" />
    </svg>
  );
}
