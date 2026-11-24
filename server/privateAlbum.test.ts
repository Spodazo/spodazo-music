import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { AddressInfo } from "node:net";
import express from "express";
import { enforceAdminOnlyAlbums, enforceLinkOnlyAlbums } from "./privateAlbums";
import { songsDir } from "./paths";
import { registerRoutes } from "./routes";
import { sessionMiddleware } from "./session";
import { getStore, resetStoreForTests } from "./storage";

function mp3(): Buffer {
  const data = Buffer.alloc(2048, 1);
  data[0] = 0xff;
  data[1] = 0xfb;
  return data;
}

test("a hidden album and its song stay off the public site", async () => {
  const previous = {
    data: process.env.MUSIC_DATA_DIR,
    db: process.env.DATABASE_URL,
    password: process.env.ADMIN_PASSWORD,
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spodazo-private-album-"));
  process.env.MUSIC_DATA_DIR = dir;
  delete process.env.DATABASE_URL;
  process.env.ADMIN_PASSWORD = "private-album-test";
  resetStoreForTests();

  const app = express();
  app.use(express.json());
  app.use(sessionMiddleware());
  registerRoutes(app);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const port = (server.address() as AddressInfo).port;
  const api = `http://127.0.0.1:${port}`;

  try {
    const store = await getStore();
    const album = await store.createAlbum({ slug: "heart-songs", title: "Heart Songs", hidden: false });
    const track = await store.createTrack({
      albumId: album.id,
      title: "Private Song",
      file: "private-song.mp3",
      slug: "private-song",
    });
    fs.writeFileSync(path.join(songsDir(), track.file), mp3());
    assert.equal((await fetch(`${api}/api/albums/heart-songs`)).status, 200);

    await enforceAdminOnlyAlbums();
    const hidden = await store.getAlbumBySlug("heart-songs");
    assert.equal(hidden?.hidden, true);
    assert.equal((await fetch(`${api}/api/albums/heart-songs`)).status, 404);
    const list = (await (await fetch(`${api}/api/albums`)).json()) as { slug: string }[];
    assert.equal(list.some((item) => item.slug === "heart-songs"), false);
    assert.equal((await fetch(`${api}/media/audio/${encodeURIComponent(track.file)}/play`)).status, 404);
    assert.equal((await fetch(`${api}/media/songs/${encodeURIComponent(track.file)}`)).status, 404);
    const shared = await fetch(`${api}/api/songs/heart-songs/private-song`);
    assert.equal(shared.status, 200);
    const body = await shared.json() as { tracks?: unknown; track: { playUrl: string; title: string } };
    assert.equal(body.tracks, undefined);
    assert.equal(body.track.title, "Private Song");
    assert.equal(body.track.playUrl, "/api/songs/heart-songs/private-song/play");
    assert.equal(JSON.stringify(body).includes("private-song.mp3"), false);
    assert.equal((await fetch(`${api}${body.track.playUrl}`)).status, 200);

    const login = await fetch(`${api}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "private-album-test" }),
    });
    assert.equal(login.status, 200);
    const cookie = (login.headers.getSetCookie?.() || []).map((item) => item.split(";")[0]).join("; ");
    assert.equal((await fetch(`${api}/api/albums/heart-songs`, { headers: { Cookie: cookie } })).status, 200);
    assert.equal((await fetch(`${api}/media/audio/${encodeURIComponent(track.file)}/play`, { headers: { Cookie: cookie } })).status, 200);
  } finally {
    server.close();
    if (previous.data === undefined) delete process.env.MUSIC_DATA_DIR;
    else process.env.MUSIC_DATA_DIR = previous.data;
    if (previous.db === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous.db;
    if (previous.password === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = previous.password;
    resetStoreForTests();
  }
});

test("Josh stays off the home page and opens from its link", async () => {
  const previous = {
    data: process.env.MUSIC_DATA_DIR,
    db: process.env.DATABASE_URL,
    password: process.env.ADMIN_PASSWORD,
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spodazo-link-album-"));
  process.env.MUSIC_DATA_DIR = dir;
  delete process.env.DATABASE_URL;
  process.env.ADMIN_PASSWORD = "link-album-test";
  resetStoreForTests();

  const app = express();
  app.use(express.json());
  app.use(sessionMiddleware());
  registerRoutes(app);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const port = (server.address() as AddressInfo).port;
  const api = `http://127.0.0.1:${port}`;

  try {
    const store = await getStore();
    const album = await store.createAlbum({ slug: "josh-drafts", title: "Josh", hidden: false });
    const track = await store.createTrack({
      albumId: album.id,
      title: "For Josh",
      file: "for-josh.mp3",
      slug: "for-josh",
    });
    fs.writeFileSync(path.join(songsDir(), track.file), mp3());

    await enforceLinkOnlyAlbums();
    assert.equal((await store.getAlbumBySlug("josh-drafts"))?.hidden, true);
    const list = (await (await fetch(`${api}/api/albums`)).json()) as { slug: string }[];
    assert.equal(list.some((item) => item.slug === "josh-drafts"), false);
    assert.equal((await fetch(`${api}/api/albums/josh-drafts`)).status, 200);
    assert.equal((await fetch(`${api}/media/audio/${encodeURIComponent(track.file)}/play`)).status, 200);

    const unhide = await fetch(`${api}/api/admin/albums/${album.id}/visibility`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hidden: false }),
    });
    assert.equal(unhide.status, 401);

    const login = await fetch(`${api}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "link-album-test" }),
    });
    const cookie = (login.headers.getSetCookie?.() || []).map((item) => item.split(";")[0]).join("; ");
    const adminList = (await (await fetch(`${api}/api/albums`, { headers: { Cookie: cookie } })).json()) as {
      slug: string;
    }[];
    assert.equal(adminList.some((item) => item.slug === "josh-drafts"), true);
    const kept = await fetch(`${api}/api/admin/albums/${album.id}/visibility`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ hidden: false }),
    });
    const body = (await kept.json()) as { hidden: boolean };
    assert.equal(body.hidden, true);
  } finally {
    server.close();
    if (previous.data === undefined) delete process.env.MUSIC_DATA_DIR;
    else process.env.MUSIC_DATA_DIR = previous.data;
    if (previous.db === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous.db;
    if (previous.password === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = previous.password;
    resetStoreForTests();
  }
});
