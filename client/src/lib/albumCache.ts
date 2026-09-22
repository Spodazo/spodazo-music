import type { PublicAlbum } from "@shared/types";
import { fetchAlbum } from "./api";
import { LIST_THUMB_WIDTH, prefetchCachedImages, withImageWidth } from "./images";

export const ALBUM_CACHE_PREFIX = "spodazo-album-v1:";

const inflight = new Map<string, Promise<PublicAlbum>>();

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function cacheKey(slug: string): string {
  return `${ALBUM_CACHE_PREFIX}${slug}`;
}

export function albumThumbUrls(album: PublicAlbum): string[] {
  return [
    album.heroUrl,
    album.thumbUrl,
    album.artistUrl,
    album.tracks[0]?.imageUrl,
    ...album.tracks.map((track) => withImageWidth(track.imageUrl, LIST_THUMB_WIDTH)),
  ].filter(Boolean);
}

export function prefetchAlbumImages(album: PublicAlbum) {
  prefetchCachedImages(albumThumbUrls(album));
}

export function readCachedAlbum(slug: string): PublicAlbum | null {
  if (!slug) return null;
  try {
    const raw = storage()?.getItem(cacheKey(slug));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PublicAlbum;
    if (!parsed || parsed.slug !== slug || !Array.isArray(parsed.tracks)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeCachedAlbum(album: PublicAlbum) {
  try {
    storage()?.setItem(cacheKey(album.slug), JSON.stringify(album));
  } catch {
    /* private mode */
  }
}

function keepStableImageUrls(prev: PublicAlbum | null, next: PublicAlbum): PublicAlbum {
  if (!prev || prev.id !== next.id) return next;
  const prevTracks = new Map(prev.tracks.map((track) => [track.id, track]));
  return {
    ...next,
    heroUrl: prev.heroPortrait === next.heroPortrait && prev.heroUrl ? prev.heroUrl : next.heroUrl,
    thumbUrl: prev.thumb === next.thumb && prev.thumbUrl ? prev.thumbUrl : next.thumbUrl,
    artistUrl: prev.artistThumb === next.artistThumb && prev.artistUrl ? prev.artistUrl : next.artistUrl,
    tracks: next.tracks.map((track) => {
      const cached = prevTracks.get(track.id);
      if (cached && cached.img === track.img && cached.imageUrl) {
        return { ...track, imageUrl: cached.imageUrl };
      }
      return track;
    }),
  };
}

export function cacheAlbumFromNetwork(next: PublicAlbum): PublicAlbum {
  const merged = keepStableImageUrls(readCachedAlbum(next.slug), next);
  writeCachedAlbum(merged);
  prefetchAlbumImages(merged);
  return merged;
}

export function prefetchAlbum(slug: string): Promise<PublicAlbum> {
  const cached = readCachedAlbum(slug);
  if (cached) prefetchAlbumImages(cached);
  let pending = inflight.get(slug);
  if (!pending) {
    pending = fetchAlbum(slug)
      .then(cacheAlbumFromNetwork)
      .finally(() => {
        inflight.delete(slug);
      });
    inflight.set(slug, pending);
  }
  return pending;
}

export function prefetchAlbums(slugs: string[]) {
  for (const slug of slugs) {
    if (slug) void prefetchAlbum(slug);
  }
}
