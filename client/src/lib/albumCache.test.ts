import assert from "node:assert/strict";
import test from "node:test";
import type { PublicAlbum, PublicTrack } from "@shared/types";
import {
  ALBUM_CACHE_PREFIX,
  albumThumbUrls,
  cacheAlbumFromNetwork,
  readCachedAlbum,
} from "./albumCache";
import { LIST_THUMB_WIDTH } from "./images";

const memory = new Map<string, string>();

const localStorageMock = {
  getItem(key: string) {
    return memory.get(key) ?? null;
  },
  setItem(key: string, value: string) {
    memory.set(key, value);
  },
  removeItem(key: string) {
    memory.delete(key);
  },
  clear() {
    memory.clear();
  },
  key() {
    return null;
  },
  get length() {
    return memory.size;
  },
};

class ImageMock {
  onload: (() => void) | null = null;
  src = "";
}

Object.defineProperty(globalThis, "localStorage", { value: localStorageMock, configurable: true });
Object.defineProperty(globalThis, "window", {
  value: { localStorage: localStorageMock },
  configurable: true,
});
Object.defineProperty(globalThis, "Image", { value: ImageMock, configurable: true });

function track(partial: Partial<PublicTrack> = {}): PublicTrack {
  return {
    id: "t1",
    albumId: "echoes",
    n: 1,
    title: "Echoes of the Storm",
    scripture: "Job 5",
    file: "Echoes of the Storm.mp3",
    img: "Echoes of the Storm.webp",
    key: "",
    lyrics: "",
    introduction: "",
    instrumental: false,
    slug: "echoes-of-the-storm",
    archived: false,
    imageUrl: "/media/images/Echoes%20of%20the%20Storm.webp?v=old",
    audioUrl: "/media/songs/Echoes%20of%20the%20Storm.mp3?v=old",
    ...partial,
  };
}

function album(partial: Partial<PublicAlbum> = {}): PublicAlbum {
  return {
    id: "echoes",
    slug: "echoes-of-storms",
    title: "Echoes of Storms",
    tagline: "",
    credits: "",
    artists: "Brody Vale",
    copyright: "",
    heroPortrait: "Echoes Background.webp",
    thumb: "Echoes of Storms.webp",
    artistThumb: "",
    color: "navy",
    sortOrder: 1,
    hidden: false,
    heroUrl: "/media/images/Echoes%20Background.webp?v=old",
    thumbUrl: "/media/images/Echoes%20of%20Storms.webp?v=old",
    artistUrl: "",
    tracks: [track()],
    archivedTracks: [],
    ...partial,
  };
}

test("album cache keeps song image URLs when only the deploy stamp changes", () => {
  memory.clear();
  cacheAlbumFromNetwork(album());
  const next = cacheAlbumFromNetwork(
    album({
      heroUrl: "/media/images/Echoes%20Background.webp?v=new",
      thumbUrl: "/media/images/Echoes%20of%20Storms.webp?v=new",
      tracks: [track({ imageUrl: "/media/images/Echoes%20of%20the%20Storm.webp?v=new" })],
    }),
  );
  assert.equal(next.thumbUrl, "/media/images/Echoes%20of%20Storms.webp?v=old");
  assert.equal(next.tracks[0].imageUrl, "/media/images/Echoes%20of%20the%20Storm.webp?v=old");
  assert.equal(readCachedAlbum("echoes-of-storms")?.tracks[0].imageUrl, next.tracks[0].imageUrl);
  assert.ok(memory.get(`${ALBUM_CACHE_PREFIX}echoes-of-storms`));
});

test("album cache replaces a song image when the file changes", () => {
  memory.clear();
  cacheAlbumFromNetwork(album());
  const next = cacheAlbumFromNetwork(
    album({
      tracks: [
        track({
          img: "New Song.webp",
          imageUrl: "/media/images/New%20Song.webp?v=new",
        }),
      ],
    }),
  );
  assert.equal(next.tracks[0].imageUrl, "/media/images/New%20Song.webp?v=new");
});

test("album thumb URLs include the list size for each song", () => {
  const urls = albumThumbUrls(album());
  assert.ok(urls.includes(`/media/images/Echoes%20of%20the%20Storm.webp?v=old&w=${LIST_THUMB_WIDTH}`));
});
