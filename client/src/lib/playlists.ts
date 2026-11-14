import type { PublicAlbum, PublicTrack } from "@shared/types";
import {
  cleanPlaylistName,
  MAX_PLAYLIST_NAME,
  MAX_PLAYLIST_SONGS,
  MAX_PLAYLISTS,
  sanitizePlaylists,
  type PlaylistSongRef,
  type UserPlaylist,
} from "@shared/playlists";

export {
  cleanPlaylistName,
  MAX_PLAYLIST_NAME,
  MAX_PLAYLIST_SONGS,
  MAX_PLAYLISTS,
  type PlaylistSongRef,
  type UserPlaylist,
} from "@shared/playlists";
export { mergePlaylists, sanitizePlaylists } from "@shared/playlists";

export const PLAYLISTS_KEY = "spodazo-playlists-v1";
export const PLAYLISTS_CHANGED_EVENT = "spodazo-playlists-changed";

export type PlaylistResult = { playlist: UserPlaylist } | { error: string };

let onWrite: (() => void) | null = null;

export function setPlaylistWriteHook(hook: (() => void) | null) {
  onWrite = hook;
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function emit() {
  try {
    window.dispatchEvent(new Event(PLAYLISTS_CHANGED_EVENT));
  } catch {
    /* no window in tests that skip events */
  }
}

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `pl-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function albumsForPlaylistPicker<T extends { hidden?: boolean }>(albums: T[], admin: boolean): T[] {
  return admin ? albums : albums.filter((album) => !album.hidden);
}

export function playlistSongFromTrack(
  album: Pick<PublicAlbum, "slug" | "title">,
  track: Pick<PublicTrack, "id" | "title" | "scripture" | "instrumental" | "imageUrl" | "audioUrl" | "durationLabel">,
): PlaylistSongRef {
  return {
    trackId: track.id,
    albumSlug: album.slug,
    title: track.title,
    albumTitle: album.title,
    scripture: track.scripture || "",
    instrumental: Boolean(track.instrumental),
    imageUrl: track.imageUrl || "",
    audioUrl: track.audioUrl,
    durationLabel: track.durationLabel || "",
  };
}

export function hasPlaylistRecord(): boolean {
  try {
    return Boolean(storage()?.getItem(PLAYLISTS_KEY));
  } catch {
    return false;
  }
}

export function readPlaylistRecords(): UserPlaylist[] {
  try {
    const raw = storage()?.getItem(PLAYLISTS_KEY);
    if (!raw) return [];
    return sanitizePlaylists(JSON.parse(raw) as unknown);
  } catch {
    return [];
  }
}

export function readPlaylists(): UserPlaylist[] {
  return readPlaylistRecords().filter((playlist) => !playlist.deleted);
}

function writeRecords(records: UserPlaylist[], sync = true) {
  storage()?.setItem(PLAYLISTS_KEY, JSON.stringify(sanitizePlaylists(records)));
  emit();
  if (sync) onWrite?.();
}

function saveVisible(playlists: UserPlaylist[]) {
  const tombstones = readPlaylistRecords().filter((playlist) => playlist.deleted);
  const ids = new Set(playlists.map((playlist) => playlist.id));
  writeRecords([...playlists, ...tombstones.filter((playlist) => !ids.has(playlist.id))]);
}

/** Replace the local copy with the account copy without sending it straight back. */
export function writePlaylistRecords(records: UserPlaylist[]) {
  writeRecords(records, false);
}

export function subscribePlaylists(listener: () => void): () => void {
  window.addEventListener(PLAYLISTS_CHANGED_EVENT, listener);
  return () => window.removeEventListener(PLAYLISTS_CHANGED_EVENT, listener);
}

export function createPlaylist(name: string): PlaylistResult {
  const cleaned = cleanPlaylistName(name);
  if (!cleaned) return { error: "Name the playlist first." };
  const playlists = readPlaylists();
  if (playlists.length >= MAX_PLAYLISTS) return { error: "You have as many playlists as this device can keep." };
  const playlist: UserPlaylist = { id: newId(), name: cleaned, updatedAt: Date.now(), songs: [] };
  try {
    saveVisible([playlist, ...playlists]);
  } catch {
    return { error: "This device could not save the playlist." };
  }
  return { playlist };
}

export function renamePlaylist(id: string, name: string): PlaylistResult {
  const cleaned = cleanPlaylistName(name);
  if (!cleaned) return { error: "Name the playlist first." };
  const playlists = readPlaylists();
  const index = playlists.findIndex((playlist) => playlist.id === id);
  if (index < 0) return { error: "That playlist is no longer on this device." };
  const playlist = { ...playlists[index], name: cleaned, updatedAt: Date.now() };
  playlists[index] = playlist;
  try {
    saveVisible(playlists);
  } catch {
    return { error: "This device could not save the playlist." };
  }
  return { playlist };
}

export function deletePlaylist(id: string) {
  try {
    const records = readPlaylistRecords();
    const index = records.findIndex((playlist) => playlist.id === id && !playlist.deleted);
    if (index < 0) return;
    records[index] = { ...records[index], deleted: true, updatedAt: Date.now(), songs: [] };
    writeRecords(records);
  } catch {
    /* private mode */
  }
}

export function addPlaylistSong(id: string, song: PlaylistSongRef): PlaylistResult {
  if (!song.audioUrl?.startsWith("/") || !song.trackId || !song.albumSlug) return { error: "That song could not be added." };
  const playlists = readPlaylists();
  const index = playlists.findIndex((playlist) => playlist.id === id);
  if (index < 0) return { error: "That playlist is no longer on this device." };
  const current = playlists[index];
  if (current.songs.some((item) => item.trackId === song.trackId)) return { playlist: current };
  if (current.songs.length >= MAX_PLAYLIST_SONGS) return { error: "This playlist is full." };
  const playlist: UserPlaylist = {
    ...current,
    updatedAt: Date.now(),
    songs: [...current.songs, song],
  };
  playlists[index] = playlist;
  try {
    saveVisible(playlists);
  } catch {
    return { error: "This device could not save the playlist." };
  }
  return { playlist };
}

export function removePlaylistSong(id: string, trackId: string): UserPlaylist | null {
  const playlists = readPlaylists();
  const index = playlists.findIndex((playlist) => playlist.id === id);
  if (index < 0) return null;
  const playlist: UserPlaylist = {
    ...playlists[index],
    updatedAt: Date.now(),
    songs: playlists[index].songs.filter((item) => item.trackId !== trackId),
  };
  playlists[index] = playlist;
  try {
    saveVisible(playlists);
  } catch {
    return null;
  }
  return playlist;
}

export function replacePlaylistSongs(id: string, songs: PlaylistSongRef[]): UserPlaylist | null {
  const playlists = readPlaylists();
  const index = playlists.findIndex((playlist) => playlist.id === id);
  if (index < 0) return null;
  const playlist: UserPlaylist = {
    ...playlists[index],
    songs: songs.filter((song) => song.audioUrl?.startsWith("/") && song.trackId).slice(0, MAX_PLAYLIST_SONGS),
  };
  playlists[index] = playlist;
  try {
    saveVisible(playlists);
  } catch {
    return null;
  }
  return playlist;
}
