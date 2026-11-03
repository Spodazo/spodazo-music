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

const TOKEN = "c".repeat(64);

function mp3(fill = 1): Buffer {
  const data = Buffer.alloc(2048, fill);
  data[0] = 0xff;
  data[1] = 0xfb;
  return data;
}

function sha256(data: Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function cookieHeader(res: Response): string {
  const list = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  return list.map((item) => item.split(";")[0]).join("; ");
}

test("Desktop folder syncs into a private Temp Music album", async () => {
  const previous = {
    data: process.env.MUSIC_DATA_DIR,
    db: process.env.DATABASE_URL,
    token: process.env.TEMP_MUSIC_SYNC_TOKEN,
    password: process.env.ADMIN_PASSWORD,
    nodeEnv: process.env.NODE_ENV,
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spodazo-temp-music-"));
  const folder = path.join(dir, "Temp Music");
  fs.mkdirSync(folder);
  process.env.MUSIC_DATA_DIR = dir;
  delete process.env.DATABASE_URL;
  process.env.TEMP_MUSIC_SYNC_TOKEN = TOKEN;
  process.env.ADMIN_PASSWORD = "temp-music-test-password";
  process.env.NODE_ENV = "development";
  resetStoreForTests();

  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use(sessionMiddleware());
  registerRoutes(app);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const port = (server.address() as AddressInfo).port;
  const api = `http://127.0.0.1:${port}`;
  const config = { api, token: TOKEN, folder, settleMs: 20 };

  try {
    const denied = await fetch(`${api}/api/sync/temp-music/plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: [] }),
    });
    assert.equal(denied.status, 401);

    const missing = await syncTempMusicFolder({ ...config, folder: path.join(dir, "missing") });
    assert.deepEqual(missing, { ok: false, skipped: "missing-folder" });

    fs.writeFileSync(path.join(folder, "notes.txt"), "leave me");
    fs.writeFileSync(path.join(folder, "2 Early (Psalm 1).mp3"), mp3(1));
    fs.writeFileSync(path.join(folder, "10 Late.mp3"), mp3(2));
    const added = await syncTempMusicFolder(config);
    assert.equal(added.ok, true);
    if (!added.ok) return;
    assert.equal(added.added, 2);
    assert.equal(added.removed, 0);

    const statusRes = await fetch(`${api}/api/sync/temp-music`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    const status = (await statusRes.json()) as {
      hidden: boolean;
      tracks: { id: string; n: number; title: string; scripture: string; lyrics: string; name: string; file: string }[];
    };
    assert.equal(status.hidden, true);
    assert.deepEqual(
      status.tracks.map((track) => ({ n: track.n, title: track.title, scripture: track.scripture, name: track.name })),
      [
        { n: 1, title: "2 Early", scripture: "Psalm 1", name: "2 Early (Psalm 1).mp3" },
        { n: 2, title: "10 Late", scripture: "", name: "10 Late.mp3" },
      ],
    );

    const publicList = (await (await fetch(`${api}/api/albums`)).json()) as { slug: string }[];
    assert.equal(publicList.some((album) => album.slug === TEMP_MUSIC_SLUG), false);
    assert.equal((await fetch(`${api}/api/albums/${TEMP_MUSIC_SLUG}`)).status, 404);
    const privateFile = status.tracks[0].file;
    assert.equal((await fetch(`${api}/media/songs/${encodeURIComponent(privateFile)}`)).status, 404);

    const store = await getStore();
    await store.updateTrack(status.tracks[0].id, { title: "Custom title", lyrics: "Keep me", img: "cover.webp" });
    fs.writeFileSync(path.join(folder, "2 Early (Psalm 1).mp3"), mp3(3));
    const replaced = await syncTempMusicFolder(config);
    assert.equal(replaced.ok, true);
    if (!replaced.ok) return;
    assert.equal(replaced.updated, 1);
    assert.equal(replaced.added, 0);
    const after = (await (await fetch(`${api}/api/sync/temp-music`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json()) as {
      tracks: { id: string; title: string; lyrics: string; img: string; file: string }[];
    };
    assert.equal(after.tracks[0].id, status.tracks[0].id);
    assert.equal(after.tracks[0].title, "Custom title");
    assert.equal(after.tracks[0].lyrics, "Keep me");
    assert.equal(after.tracks[0].img, "cover.webp");
    assert.notEqual(after.tracks[0].file, privateFile);
    assert.equal(fs.existsSync(path.join(dir, "songs", privateFile)), false);

    const blocked = await fetch(`${api}/api/sync/temp-music/prune`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        confirm: "mirror",
        files: [{ name: "brand-new.mp3", size: 2048, sha256: sha256(mp3(9)) }],
      }),
    });
    assert.equal(blocked.status, 409);
    const stillThere = (await (await fetch(`${api}/api/sync/temp-music`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json()) as {
      tracks: unknown[];
    };
    assert.equal(stillThere.tracks.length, 2);

    fs.rmSync(path.join(folder, "10 Late.mp3"));
    fs.rmSync(path.join(folder, "2 Early (Psalm 1).mp3"));
    const removed = await syncTempMusicFolder(config);
    assert.equal(removed.ok, true);
    if (!removed.ok) return;
    assert.equal(removed.removed, 2);
    const empty = (await (await fetch(`${api}/api/sync/temp-music`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json()) as {
      tracks: unknown[];
    };
    assert.equal(empty.tracks.length, 0);
    assert.equal(fs.existsSync(path.join(folder, "notes.txt")), true);

    const login = await fetch(`${api}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "temp-music-test-password" }),
    });
    assert.equal(login.status, 200);
    const cookie = cookieHeader(login);
    const albums = (await (await fetch(`${api}/api/albums`, { headers: { Cookie: cookie } })).json()) as {
      id: string;
      slug: string;
      hidden: boolean;
    }[];
    const temp = albums.find((album) => album.slug === TEMP_MUSIC_SLUG);
    assert.ok(temp);
    assert.equal(temp.hidden, true);
    const opened = await fetch(`${api}/api/albums/${TEMP_MUSIC_SLUG}`, { headers: { Cookie: cookie } });
    assert.equal(opened.status, 200);

    const unhide = await fetch(`${api}/api/admin/albums/${temp.id}/visibility`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ hidden: false }),
    });
    assert.equal(unhide.status, 200);
    const unhidden = (await unhide.json()) as { hidden: boolean };
    assert.equal(unhidden.hidden, true);
    const removedAlbum = await fetch(`${api}/api/admin/albums/${temp.id}`, { method: "DELETE", headers: { Cookie: cookie } });
    assert.equal(removedAlbum.status, 400);

    const publicAlbum = await store.createAlbum({ slug: "public-demo", title: "Public Demo", hidden: false });
    const publicTrack = await store.createTrack({
      albumId: publicAlbum.id,
      title: "Public Song",
      file: "public-demo.mp3",
      slug: "public-song",
    });
    fs.writeFileSync(path.join(dir, "songs", publicTrack.file), mp3(4));
    assert.equal((await fetch(`${api}/media/songs/public-demo.mp3`)).status, 200);

    fs.writeFileSync(path.join(folder, "Private.mp3"), mp3(5));
    const priv = await syncTempMusicFolder(config);
    assert.equal(priv.ok, true);
    const privStatus = (await (await fetch(`${api}/api/sync/temp-music`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json()) as {
      tracks: { file: string }[];
    };
    const hiddenAudio = await fetch(`${api}/media/songs/${encodeURIComponent(privStatus.tracks[0].file)}`);
    assert.equal(hiddenAudio.status, 404);
    const adminAudio = await fetch(`${api}/media/songs/${encodeURIComponent(privStatus.tracks[0].file)}`, {
      headers: { Cookie: cookie },
    });
    assert.equal(adminAudio.status, 200);

    const christmas = path.join(folder, "Christmas 2026");
    fs.mkdirSync(christmas);
    const emptyFolder = await syncTempMusicFolder(config);
    assert.equal(emptyFolder.ok, true);
    const created = (await (await fetch(`${api}/api/sync/temp-music`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json()) as {
      albums: { slug: string; title: string; hidden: boolean; tracks: { name: string }[] }[];
    };
    const christmasAlbum = created.albums.find((album) => album.title === "Christmas 2026");
    assert.ok(christmasAlbum);
    assert.equal(christmasAlbum.slug, "temp-christmas-2026");
    assert.equal(christmasAlbum.hidden, true);
    assert.equal(christmasAlbum.tracks.length, 0);
    assert.equal((await fetch(`${api}/api/albums/temp-christmas-2026`)).status, 404);

    fs.renameSync(path.join(folder, "Private.mp3"), path.join(christmas, "Private.mp3"));
    const moved = await syncTempMusicFolder(config);
    assert.equal(moved.ok, true);
    const afterMove = (await (await fetch(`${api}/api/sync/temp-music`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json()) as {
      tracks: { name: string }[];
      albums: { title: string; tracks: { title: string; lyrics: string; name: string; file: string }[] }[];
    };
    assert.equal(afterMove.tracks.some((track) => track.name === "Private.mp3"), false);
    const christmasSongs = afterMove.albums.find((album) => album.title === "Christmas 2026")?.tracks || [];
    assert.equal(christmasSongs.length, 1);
    assert.equal(christmasSongs[0].name, "Christmas 2026/Private.mp3");
    assert.equal(christmasSongs[0].title, "Private");
    const movedAudio = await fetch(`${api}/media/songs/${encodeURIComponent(christmasSongs[0].file)}`);
    assert.equal(movedAudio.status, 404);

    fs.rmSync(christmas, { recursive: true });
    const dropped = await syncTempMusicFolder(config);
    assert.equal(dropped.ok, true);
    const gone = (await (await fetch(`${api}/api/sync/temp-music`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json()) as {
      albums: { title: string }[];
    };
    assert.equal(gone.albums.some((album) => album.title === "Christmas 2026"), false);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    resetStoreForTests();
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
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
