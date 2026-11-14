export const MAX_PLAYLISTS = 40;
export const MAX_PLAYLIST_SONGS = 300;
export const MAX_PLAYLIST_NAME = 60;
const MAX_TOMBSTONES = 40;

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
  deleted?: boolean;
};

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

export function sanitizePlaylists(value: unknown): UserPlaylist[] {
  if (!Array.isArray(value)) return [];
  const visible: UserPlaylist[] = [];
  const deleted: UserPlaylist[] = [];
  for (const item of value) {
    if (!isPlaylist(item)) continue;
    const playlist: UserPlaylist = {
      id: item.id,
      name: cleanPlaylistName(item.name) || "Playlist",
      updatedAt: Number.isFinite(item.updatedAt) ? item.updatedAt : 0,
      songs: item.deleted ? [] : item.songs.filter(isSong).slice(0, MAX_PLAYLIST_SONGS),
      ...(item.deleted ? { deleted: true } : {}),
    };
    if (playlist.deleted) deleted.push(playlist);
    else visible.push(playlist);
  }
  return [...visible.slice(0, MAX_PLAYLISTS), ...deleted.slice(0, MAX_TOMBSTONES)];
}

/** Keep the newer copy of each playlist so a save on one device does not wipe the other. */
export function mergePlaylists(local: UserPlaylist[], remote: UserPlaylist[]): UserPlaylist[] {
  const byId = new Map<string, UserPlaylist>();
  for (const playlist of [...remote, ...local]) {
    const existing = byId.get(playlist.id);
    if (!existing || playlist.updatedAt >= existing.updatedAt) byId.set(playlist.id, playlist);
  }
  return sanitizePlaylists([...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt));
}
