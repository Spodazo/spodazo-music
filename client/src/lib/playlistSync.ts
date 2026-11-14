import { adminMe } from "./api";
import {
  mergePlaylists,
  readPlaylistRecords,
  readPlaylists,
  sanitizePlaylists,
  setPlaylistWriteHook,
  writePlaylistRecords,
  type UserPlaylist,
} from "./playlists";

let adminState: Promise<boolean> | null = null;
let pushTimer = 0;
let syncing: Promise<UserPlaylist[] | null> | null = null;

function loggedIn(): Promise<boolean> {
  if (!adminState) {
    adminState = adminMe()
      .then((result) => result.admin)
      .catch(() => false);
    void adminState.then((ok) => {
      if (!ok) adminState = null;
    });
  }
  return adminState;
}

function schedulePush() {
  window.clearTimeout(pushTimer);
  pushTimer = window.setTimeout(() => {
    void pushAdminPlaylists();
  }, 300);
}

async function loadAccountPlaylists(): Promise<UserPlaylist[] | null> {
  const response = await fetch("/api/admin/playlists", { cache: "no-store" });
  if (response.status === 401) {
    adminState = null;
    return null;
  }
  if (!response.ok) throw new Error("Could not load playlists");
  const body = (await response.json()) as { playlists?: unknown };
  return sanitizePlaylists(body.playlists);
}

async function saveAccountPlaylists(playlists: UserPlaylist[]): Promise<UserPlaylist[] | null> {
  const response = await fetch("/api/admin/playlists", {
    method: "PUT",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playlists }),
  });
  if (response.status === 401) {
    adminState = null;
    return null;
  }
  if (!response.ok) throw new Error("Could not save playlists");
  const body = (await response.json()) as { playlists?: unknown };
  return sanitizePlaylists(body.playlists);
}

async function pushAdminPlaylists() {
  if (!(await loggedIn())) return;
  try {
    const saved = await saveAccountPlaylists(readPlaylistRecords());
    if (!saved) return;
    if (JSON.stringify(saved) !== JSON.stringify(readPlaylistRecords())) writePlaylistRecords(saved);
  } catch {
    /* keep the local copy and try again on the next edit */
  }
}

async function syncNow(): Promise<UserPlaylist[] | null> {
  if (!(await loggedIn())) return null;
  setPlaylistWriteHook(schedulePush);
  try {
    const remote = await loadAccountPlaylists();
    if (!remote) return null;
    const merged = mergePlaylists(readPlaylistRecords(), remote);
    let next = merged;
    if (JSON.stringify(merged) !== JSON.stringify(remote)) {
      const saved = await saveAccountPlaylists(merged);
      if (saved) next = saved;
    }
    if (JSON.stringify(next) !== JSON.stringify(readPlaylistRecords())) writePlaylistRecords(next);
    return readPlaylists();
  } catch {
    return null;
  }
}

/** Pull the logged-in account's playlists and upload anything saved only on this device. */
export function syncAdminPlaylists(): Promise<UserPlaylist[] | null> {
  if (!syncing) {
    syncing = syncNow().finally(() => {
      syncing = null;
    });
  }
  return syncing;
}
