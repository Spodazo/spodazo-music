import type { AlbumListItem } from "@shared/types";

const ALBUMS_KEY = "spodazo-home-albums-v2";

export function readCachedAlbums(): AlbumListItem[] {
  try {
    const raw = sessionStorage.getItem(ALBUMS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is AlbumListItem => {
      return Boolean(item && typeof item === "object" && typeof (item as AlbumListItem).id === "string");
    });
  } catch {
    return [];
  }
}

export function writeCachedAlbums(albums: AlbumListItem[]) {
  try {
    sessionStorage.setItem(ALBUMS_KEY, JSON.stringify(albums));
  } catch {
    /* private mode */
  }
}
