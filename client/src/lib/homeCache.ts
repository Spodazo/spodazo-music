import type { AlbumListItem, PlayerSetup } from "@shared/types";
import { prefetchAlbums } from "./albumCache";
import { fetchAlbums, fetchPlayerSetup } from "./api";
import { applySiteIcons } from "./siteIcons";

export const HOME_ALBUMS_KEY = "spodazo-home-albums-v3";
export const HOME_SETUP_KEY = "spodazo-home-setup-v1";

const decodedSrcs = new Set<string>();
let albumsInFlight: Promise<AlbumListItem[]> | null = null;
let setupInFlight: Promise<PlayerSetup> | null = null;

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function isImageDecoded(src: string): boolean {
  return Boolean(src) && decodedSrcs.has(src);
}

export function markImageDecoded(src: string) {
  if (src) decodedSrcs.add(src);
}

export function readCachedAlbums(): AlbumListItem[] {
  try {
    const raw = storage()?.getItem(HOME_ALBUMS_KEY);
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
    storage()?.setItem(HOME_ALBUMS_KEY, JSON.stringify(albums));
  } catch {
    /* private mode */
  }
}

export function readCachedSetup(): PlayerSetup | null {
  try {
    const raw = storage()?.getItem(HOME_SETUP_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PlayerSetup;
    if (!parsed || typeof parsed !== "object" || typeof parsed.appName !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeCachedSetup(setup: PlayerSetup) {
  try {
    storage()?.setItem(HOME_SETUP_KEY, JSON.stringify(setup));
  } catch {
    /* private mode */
  }
}

export function cacheAlbumsFromNetwork(next: AlbumListItem[]): AlbumListItem[] {
  const prev = readCachedAlbums();
  const prevById = new Map(prev.map((album) => [album.id, album]));
  const merged = next.map((album) => {
    const cached = prevById.get(album.id);
    if (cached && cached.thumb === album.thumb && cached.heroPortrait === album.heroPortrait) {
      return { ...album, thumbUrl: cached.thumbUrl, heroUrl: cached.heroUrl };
    }
    return album;
  });
  writeCachedAlbums(merged);
  return merged;
}

export function cacheSetupFromNetwork(next: PlayerSetup): PlayerSetup {
  const prev = readCachedSetup();
  if (!prev) {
    writeCachedSetup(next);
    return next;
  }
  const merged: PlayerSetup = {
    ...next,
    logoUrl: prev.logo === next.logo && prev.logoUrl ? prev.logoUrl : next.logoUrl,
    collectionCoverUrl:
      prev.collectionCover === next.collectionCover && prev.collectionCoverUrl
        ? prev.collectionCoverUrl
        : next.collectionCoverUrl,
    footerImageUrl:
      prev.footerImage === next.footerImage && prev.footerImageUrl ? prev.footerImageUrl : next.footerImageUrl,
    faviconUrl: prev.favicon === next.favicon && prev.faviconUrl ? prev.faviconUrl : next.faviconUrl,
  };
  applySiteIcons(merged);
  writeCachedSetup(merged);
  return merged;
}

export function loadHomeAlbums(): Promise<AlbumListItem[]> {
  if (!albumsInFlight) {
    albumsInFlight = fetchAlbums()
      .then(cacheAlbumsFromNetwork)
      .catch((err) => {
        albumsInFlight = null;
        throw err;
      });
  }
  return albumsInFlight;
}

export function loadHomeSetup(): Promise<PlayerSetup> {
  if (!setupInFlight) {
    setupInFlight = fetchPlayerSetup()
      .then(cacheSetupFromNetwork)
      .catch((err) => {
        setupInFlight = null;
        throw err;
      });
  }
  return setupInFlight;
}

export function prefetchHome() {
  void loadHomeAlbums()
    .then((albums) => {
      prefetchAlbums(albums.map((album) => album.slug));
    })
    .catch(() => undefined);
  void loadHomeSetup();
}
