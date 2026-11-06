import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { AddressInfo } from "node:net";
import express from "express";
import { TEMP_MUSIC_SLUG } from "../shared/tempMusic";
import { syncTempMusicFolder } from "../script/temp-music-sync";
import { registerRoutes } from "./routes";
import { sessionMiddleware } from "./session";
import { getStore, resetStoreForTests } from "./storage";

const TOKEN = "d".repeat(64);

function mp3(fill = 1): Buffer {
  const data = Buffer.alloc(2048, fill);
  data[0] = 0xff;
  data[1] = 0xfb;
  return data;
}

function cookieHeader(res: Response): string {
  const list = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  return list.map((item) => item.split(";")[0]).join("; ");
}

test("admin can move songs onto an existing album or a new one", async () => {
  const previous = {
    data: process.env.MUSIC_DATA_DIR,
    db: process.env.DATABASE_URL,
    token: process.env.TEMP_MUSIC_SYNC_TOKEN,
    password: process.env.ADMIN_PASSWORD,
    nodeEnv: process.env.NODE_ENV,
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spodazo-move-tracks-"));
  const folder = path.join(dir, "Temp Music");
  fs.mkdirSync(folder);
  process.env.MUSIC_DATA_DIR = dir;
  delete process.env.DATABASE_URL;
  process.env.TEMP_MUSIC_SYNC_TOKEN = TOKEN;
  process.env.ADMIN_PASSWORD = "move-tracks-test-password";
  process.env.NODE_ENV = "development";
  resetStoreForTests();

  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use(sessionMiddleware());
  registerRoutes(app);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const api = `http://127.0.0.1:${portOf(server)}`;

  try {
    const store = await getStore();
    const source = await store.createAlbum({ slug: "move-source", title: "Move Source" });
    const other = await store.createAlbum({ slug: "move-other", title: "Move Other" });
    const first = await store.createTrack({ albumId: source.id, n: 1, title: "First Song", slug: "first-song" });
    const second = await store.createTrack({ albumId: source.id, n: 2, title: "Second Song", slug: "second-song" });
    await store.createTrack({ albumId: source.id, n: 3, title: "Stays Here", slug: "stays-here" });
    await store.createTrack({ albumId: other.id, n: 1, title: "Already There", slug: "first-song" });

    const login = await fetch(`${api}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "move-tracks-test-password" }),
    });
    assert.equal(login.status, 200);
    const cookie = cookieHeader(login);
    const headers = { Cookie: cookie, "Content-Type": "application/json" };

    const moved = await fetch(`${api}/api/admin/tracks/move`, {
      method: "POST",
      headers,
      body: JSON.stringify({ trackIds: [second.id, first.id], albumId: other.id }),
    });
    assert.equal(moved.status, 200);
    const vision = await store.getAlbumBySlug("move-other");
    assert.deepEqual(
      vision?.tracks.map((track) => track.title),
      ["Already There", "Second Song", "First Song"],
    );
    assert.equal(vision?.tracks.find((track) => track.title === "First Song")?.slug, "first-song-2");
    const echoes = await store.getAlbumBySlug("move-source");
    assert.deepEqual(echoes?.tracks.map((track) => ({ n: track.n, title: track.title })), [{ n: 1, title: "Stays Here" }]);

    const created = await fetch(`${api}/api/admin/tracks/move`, {
      method: "POST",
      headers,
      body: JSON.stringify({ trackIds: [first.id], albumTitle: "Collected" }),
    });
    assert.equal(created.status, 200);
    const body = (await created.json()) as { albumSlug: string };
    assert.equal(body.albumSlug, "collected");
    const collected = await store.getAlbumBySlug("collected");
    assert.deepEqual(collected?.tracks.map((track) => track.title), ["First Song"]);

    fs.writeFileSync(path.join(folder, "Folder Song.mp3"), mp3(4));
    const synced = await syncTempMusicFolder({ api, token: TOKEN, folder, settleMs: 20 });
    assert.equal(synced.ok, true);
    const temp = await store.getAlbumBySlug(TEMP_MUSIC_SLUG);
    const tempTrack = temp?.tracks[0];
    assert.ok(tempTrack);
    const out = await fetch(`${api}/api/admin/tracks/move`, {
      method: "POST",
      headers,
      body: JSON.stringify({ trackIds: [tempTrack.id], albumId: other.id }),
    });
    assert.equal(out.status, 200);
    const blocked = await fetch(`${api}/api/admin/tracks/move`, {
      method: "POST",
      headers,
      body: JSON.stringify({ trackIds: [second.id], albumId: temp?.id }),
    });
    assert.equal(blocked.status, 400);
    const again = await syncTempMusicFolder({ api, token: TOKEN, folder, settleMs: 20 });
    assert.equal(again.ok, true);
    const tempAfter = await store.getAlbumBySlug(TEMP_MUSIC_SLUG);
    const visionAfter = await store.getAlbumBySlug("move-other");
    assert.equal(tempAfter?.tracks.length, 1);
    assert.notEqual(tempAfter?.tracks[0]?.id, tempTrack.id);
    assert.ok(visionAfter?.tracks.some((track) => track.id === tempTrack.id));
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
    if (previous.data === undefined) delete process.env.MUSIC_DATA_DIR;
    else process.env.MUSIC_DATA_DIR = previous.data;
    if (previous.db === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous.db;
    if (previous.token === undefined) delete process.env.TEMP_MUSIC_SYNC_TOKEN;
    else process.env.TEMP_MUSIC_SYNC_TOKEN = previous.token;
    if (previous.password === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = previous.password;
    if (previous.nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous.nodeEnv;
    resetStoreForTests();
  }
});

function portOf(server: ReturnType<express.Express["listen"]>): number {
  return (server.address() as AddressInfo).port;
}
