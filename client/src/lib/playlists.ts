import type { PublicAlbum, PublicTrack } from "@shared/types";

export const PLAYLISTS_KEY = "spodazo-playlists-v1";
export const PLAYLISTS_CHANGED_EVENT = "spodazo-playlists-changed";
export const MAX_PLAYLISTS = 40;
export const MAX_PLAYLIST_SONGS = 300;
export const MAX_PLAYLIST_NAME = 60;

export type PlaylistSongRef = {
  trackId: string;
  albumSlug: string;
  title: string;
  albumTitle: string;
  scripture: string;
  instrumental: boolean;
  imageUrl: string;
  audioUrl: string;
  durationLabel: string;
};

export type UserPlaylist = {
  id: string;
  name: string;
  updatedAt: number;
  songs: PlaylistSongRef[];
};

export type PlaylistResult = { playlist: UserPlaylist } | { error: string };

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

export function cleanPlaylistName(name: string): string {
  return name.replace(/\s+/g, " ").trim().slice(0, MAX_PLAYLIST_NAME);
}

function isSong(value: unknown): value is PlaylistSongRef {
  if (!value || typeof value !== "object") return false;
  const song = value as PlaylistSongRef;
  return typeof song.trackId === "string"
    && song.trackId.length > 0
    && typeof song.albumSlug === "string"
    && song.albumSlug.length > 0
    && typeof song.title === "string"
    && typeof song.albumTitle === "string"
    && typeof song.audioUrl === "string"
    && song.audioUrl.startsWith("/");
}

function isPlaylist(value: unknown): value is UserPlaylist {
  if (!value || typeof value !== "object") return false;
  const playlist = value as UserPlaylist;
  return typeof playlist.id === "string"
    && playlist.id.length > 0
    && typeof playlist.name === "string"
    && Array.isArray(playlist.songs);
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

export function readPlaylists(): UserPlaylist[] {
  try {
    const raw = storage()?.getItem(PLAYLISTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isPlaylist).map((playlist) => ({
      id: playlist.id,
      name: cleanPlaylistName(playlist.name) || "Playlist",
      updatedAt: Number.isFinite(playlist.updatedAt) ? playlist.updatedAt : 0,
      songs: playlist.songs.filter(isSong).slice(0, MAX_PLAYLIST_SONGS),
    }));
  } catch {
    return [];
  }
}

function writePlaylists(playlists: UserPlaylist[]) {
  storage()?.setItem(PLAYLISTS_KEY, JSON.stringify(playlists));
  emit();
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
    writePlaylists([playlist, ...playlists]);
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
    writePlaylists(playlists);
  } catch {
    return { error: "This device could not save the playlist." };
  }
  return { playlist };
}

export function deletePlaylist(id: string) {
  try {
    writePlaylists(readPlaylists().filter((playlist) => playlist.id !== id));
  } catch {
    /* private mode */
  }
}

export function addPlaylistSong(id: string, song: PlaylistSongRef): PlaylistResult {
  if (!isSong(song)) return { error: "That song could not be added." };
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
    writePlaylists(playlists);
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
    songs: playlists[index].songs.filter((song) => song.trackId !== trackId),
  };
  playlists[index] = playlist;
  try {
    writePlaylists(playlists);
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
    songs: songs.filter(isSong).slice(0, MAX_PLAYLIST_SONGS),
  };
  playlists[index] = playlist;
  try {
    writePlaylists(playlists);
  } catch {
    return null;
  }
  return playlist;
}
