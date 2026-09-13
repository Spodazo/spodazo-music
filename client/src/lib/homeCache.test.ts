import assert from "node:assert/strict";
import test from "node:test";
import type { AlbumListItem, PlayerSetup } from "@shared/types";
import {
  cacheAlbumsFromNetwork,
  cacheSetupFromNetwork,
  HOME_ALBUMS_KEY,
  HOME_SETUP_KEY,
  isImageDecoded,
  markImageDecoded,
  readCachedAlbums,
  readCachedSetup,
} from "./homeCache";

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

Object.defineProperty(globalThis, "localStorage", { value: localStorageMock, configurable: true });
Object.defineProperty(globalThis, "window", {
  value: { localStorage: localStorageMock },
  configurable: true,
});

function album(partial: Partial<AlbumListItem>): AlbumListItem {
  return {
    id: "echoes",
    slug: "echoes-of-storms",
    title: "Echoes of Storms",
    tagline: "",
    credits: "",
    artists: "Brody Vale with Eden Blue",
    copyright: "",
    heroPortrait: "Echoes Background.webp",
    thumb: "Echoes of Storms.webp",
    artistThumb: "",
    color: "navy",
    sortOrder: 1,
    hidden: false,
    heroUrl: "/media/images/Echoes%20Background.webp?v=old&w=720",
    thumbUrl: "/media/images/Echoes%20of%20Storms.webp?v=old&w=720",
    trackCount: 12,
    ...partial,
  };
}

function setup(partial: Partial<PlayerSetup> = {}): PlayerSetup {
  return {
    appName: "SPODAZO MUSIC",
    theme: "Theme",
    credits: "",
    copyright: "",
    collectionCover: "",
    collectionCoverUrl: "",
    logo: "Logo.webp",
    logoUrl: "/media/images/Logo.webp?v=old",
    footerImage: "",
    footerImageUrl: "",
    collectionColor: "navy",
    ...partial,
  };
}

test("home cache keeps last-known image URLs when only the deploy stamp changes", () => {
  memory.clear();
  const cached = cacheAlbumsFromNetwork([album({})]);
  const next = cacheAlbumsFromNetwork([
    album({
      title: "Echoes of Storms",
      artists: "Brody Vale with Eden Blue",
      heroUrl: "/media/images/Echoes%20Background.webp?v=new&w=720",
      thumbUrl: "/media/images/Echoes%20of%20Storms.webp?v=new&w=720",
    }),
  ]);
  assert.equal(next[0].thumbUrl, cached[0].thumbUrl);
  assert.equal(next[0].heroUrl, cached[0].heroUrl);
  assert.equal(readCachedAlbums()[0].thumbUrl, cached[0].thumbUrl);
  assert.ok(memory.get(HOME_ALBUMS_KEY));
});

test("home cache replaces image URLs when the cover file changes", () => {
  memory.clear();
  cacheAlbumsFromNetwork([album({})]);
  const next = cacheAlbumsFromNetwork([
    album({
      thumb: "New Cover.webp",
      thumbUrl: "/media/images/New%20Cover.webp?v=new&w=720",
    }),
  ]);
  assert.equal(next[0].thumbUrl, "/media/images/New%20Cover.webp?v=new&w=720");
});

test("home setup cache keeps the logo URL across deploys", () => {
  memory.clear();
  cacheSetupFromNetwork(setup());
  const next = cacheSetupFromNetwork(setup({ logoUrl: "/media/images/Logo.webp?v=new" }));
  assert.equal(next.logoUrl, "/media/images/Logo.webp?v=old");
  assert.equal(readCachedSetup()?.logoUrl, "/media/images/Logo.webp?v=old");
  assert.ok(memory.get(HOME_SETUP_KEY));
});

test("decoded home images stay marked for the rest of the visit", () => {
  assert.equal(isImageDecoded("/cover.webp"), false);
  markImageDecoded("/cover.webp");
  assert.equal(isImageDecoded("/cover.webp"), true);
});
