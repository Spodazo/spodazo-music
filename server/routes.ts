import type { Express, Request } from "express";
import fs from "fs";
import path from "path";
import multer from "multer";
import { slugify, titleFromAudioFile, uniqueSlug } from "../shared/seed-data";
import { loginAdmin, logoutAdmin, requireAdmin } from "./auth";
import { imagesDir, songsDir, uniqueFileName } from "./paths";
import { getStore } from "./storage";

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, file, cb) => {
      const dir = file.fieldname === "audio" ? songsDir() : imagesDir();
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const dir = file.fieldname === "audio" ? songsDir() : imagesDir();
      cb(null, uniqueFileName(dir, file.originalname));
    },
  }),
  limits: { fileSize: 80 * 1024 * 1024 },
});

function albumFields(body: Request["body"]) {
  const fields: {
    slug: string;
    title: string;
    tagline: string;
    credits: string;
    artists: string;
    copyright: string;
    heroPortrait?: string;
    thumb?: string;
    artistThumb?: string;
    sortOrder?: number;
    hidden: boolean;
  } = {
    slug: String(body.slug || slugify(body.title || "")).trim(),
    title: String(body.title || "").trim(),
    tagline: String(body.tagline || ""),
    credits: String(body.credits || ""),
    artists: String(body.artists || ""),
    copyright: String(body.copyright || ""),
    hidden: body.hidden === true || body.hidden === "true",
  };
  if (body.heroPortrait) fields.heroPortrait = String(body.heroPortrait);
  if (body.thumb) fields.thumb = String(body.thumb);
  if (body.artistThumb) fields.artistThumb = String(body.artistThumb);
  if (body.sortOrder !== undefined && body.sortOrder !== "") fields.sortOrder = Number(body.sortOrder);
  return fields;
}

function trackFields(body: Request["body"], albumId?: string) {
  const title = String(body.title || "").trim();
  const fields: Record<string, unknown> = {
    title,
    scripture: String(body.scripture || ""),
    lyrics: String(body.lyrics || ""),
    instrumental: body.instrumental === true || body.instrumental === "true",
    slug: String(body.slug || slugify(title)),
  };
  if (albumId) fields.albumId = albumId;
  if (body.n !== undefined && body.n !== "") fields.n = Number(body.n);
  if (body.file) fields.file = String(body.file);
  if (body.img) fields.img = String(body.img);
  if (body.key) fields.key = String(body.key);
  return fields;
}

export function registerRoutes(app: Express): void {
  app.get("/api/version", (_req, res) => {
    res.json({
      app: "spodazo-music",
      ok: true,
      musicDataDir: process.env.MUSIC_DATA_DIR || ".music-data",
      database: process.env.DATABASE_URL ? "postgres" : "json",
    });
  });

  app.get("/api/albums", async (req, res) => {
    const store = await getStore();
    const list = await store.listAlbums();
    res.json(req.session?.admin ? list : list.filter((album) => !album.hidden));
  });

  app.get("/api/albums/:slug", async (req, res) => {
    const store = await getStore();
    const album = await store.getAlbumBySlug(req.params.slug);
    if (!album || (album.hidden && !req.session?.admin)) {
      res.status(404).json({ error: "Album not found" });
      return;
    }
    res.json(album);
  });

  app.get("/api/admin/me", (req, res) => {
    res.json({ admin: Boolean(req.session?.admin) });
  });

  app.post("/api/admin/login", async (req, res) => {
    const password = String(req.body?.password || "");
    if (!process.env.ADMIN_PASSWORD) {
      res.status(500).json({ error: "ADMIN_PASSWORD is not set" });
      return;
    }
    try {
      if (!(await loginAdmin(req, password))) {
        res.status(401).json({ error: "Wrong password" });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      console.error("[admin] login session error:", err);
      res.status(500).json({ error: "Could not start admin session" });
    }
  });

  app.post("/api/admin/logout", async (req, res) => {
    await logoutAdmin(req);
    res.json({ ok: true });
  });

  app.post("/api/admin/albums", requireAdmin, upload.fields([
    { name: "hero", maxCount: 1 },
    { name: "thumb", maxCount: 1 },
    { name: "artist", maxCount: 1 },
  ]), async (req, res) => {
    const store = await getStore();
    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const fields = albumFields(req.body);
    if (!fields.title || !fields.slug) {
      res.status(400).json({ error: "Title and slug are required" });
      return;
    }
    if (files?.hero?.[0]) fields.heroPortrait = files.hero[0].filename;
    if (files?.thumb?.[0]) fields.thumb = files.thumb[0].filename;
    if (files?.artist?.[0]) fields.artistThumb = files.artist[0].filename;
    const created = await store.createAlbum(fields);
    res.status(201).json(await store.getAlbumById(created.id));
  });

  app.patch("/api/admin/albums/:id", requireAdmin, upload.fields([
    { name: "hero", maxCount: 1 },
    { name: "thumb", maxCount: 1 },
    { name: "artist", maxCount: 1 },
  ]), async (req, res) => {
    const store = await getStore();
    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const fields = albumFields(req.body);
    if (files?.hero?.[0]) fields.heroPortrait = files.hero[0].filename;
    if (files?.thumb?.[0]) fields.thumb = files.thumb[0].filename;
    if (files?.artist?.[0]) fields.artistThumb = files.artist[0].filename;
    const updated = await store.updateAlbum(req.params.id, fields);
    if (!updated) {
      res.status(404).json({ error: "Album not found" });
      return;
    }
    res.json(await store.getAlbumById(updated.id));
  });

  app.delete("/api/admin/albums/:id", requireAdmin, async (req, res) => {
    const store = await getStore();
    const ok = await store.deleteAlbum(req.params.id);
    if (!ok) {
      res.status(404).json({ error: "Album not found" });
      return;
    }
    res.json({ ok: true });
  });

  app.post("/api/admin/albums/:id/tracks", requireAdmin, upload.fields([
    { name: "audio", maxCount: 1 },
    { name: "artwork", maxCount: 1 },
  ]), async (req, res) => {
    const store = await getStore();
    const album = await store.getAlbumById(req.params.id);
    if (!album) {
      res.status(404).json({ error: "Album not found" });
      return;
    }
    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const fields = trackFields(req.body, album.id);
    if (!fields.title) {
      res.status(400).json({ error: "Track title is required" });
      return;
    }
    if (files?.audio?.[0]) fields.file = files.audio[0].filename;
    if (files?.artwork?.[0]) fields.img = files.artwork[0].filename;
    if (!fields.n) fields.n = album.tracks.length + 1;
    const created = await store.createTrack(fields as Parameters<typeof store.createTrack>[0]);
    res.status(201).json(created);
  });

  app.post("/api/admin/albums/:id/tracks/bulk", requireAdmin, upload.array("audio", 40), async (req, res) => {
    const store = await getStore();
    const album = await store.getAlbumById(req.params.id);
    if (!album) {
      res.status(404).json({ error: "Album not found" });
      return;
    }
    const files = ((req.files as Express.Multer.File[] | undefined) || []).slice();
    if (!files.length) {
      res.status(400).json({ error: "Choose one or more MP3 files" });
      return;
    }
    files.sort((a, b) => a.originalname.localeCompare(b.originalname, undefined, { numeric: true, sensitivity: "base" }));
    const used = new Set(album.tracks.map((track) => track.slug).filter(Boolean));
    const created = [];
    let n = album.tracks.length + 1;
    for (const file of files) {
      const { title, scripture } = titleFromAudioFile(file.originalname);
      const slug = uniqueSlug(title, used);
      created.push(
        await store.createTrack({
          albumId: album.id,
          n: n++,
          title,
          scripture,
          file: file.filename,
          img: "",
          key: slug,
          lyrics: "",
          instrumental: false,
          slug,
        }),
      );
    }
    res.status(201).json({ tracks: created });
  });

  app.patch("/api/admin/tracks/:id", requireAdmin, upload.fields([
    { name: "audio", maxCount: 1 },
    { name: "artwork", maxCount: 1 },
  ]), async (req, res) => {
    const store = await getStore();
    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const fields = trackFields(req.body);
    if (files?.audio?.[0]) fields.file = files.audio[0].filename;
    if (files?.artwork?.[0]) fields.img = files.artwork[0].filename;
    const updated = await store.updateTrack(req.params.id, fields as Parameters<typeof store.updateTrack>[1]);
    if (!updated) {
      res.status(404).json({ error: "Track not found" });
      return;
    }
    res.json(updated);
  });

  app.delete("/api/admin/tracks/:id", requireAdmin, async (req, res) => {
    const store = await getStore();
    const ok = await store.deleteTrack(req.params.id);
    if (!ok) {
      res.status(404).json({ error: "Track not found" });
      return;
    }
    res.json({ ok: true });
  });

  app.post("/api/admin/albums/:id/reorder", requireAdmin, async (req, res) => {
    const store = await getStore();
    const trackIds = Array.isArray(req.body?.trackIds) ? req.body.trackIds.map(String) : [];
    res.json(await store.reorderTracks(req.params.id, trackIds));
  });

  app.post("/api/admin/albums/:id/visibility", requireAdmin, async (req, res) => {
    const store = await getStore();
    const hidden = req.body?.hidden === true || req.body?.hidden === "true";
    const updated = await store.updateAlbum(req.params.id, { hidden });
    if (!updated) {
      res.status(404).json({ error: "Album not found" });
      return;
    }
    res.json(await store.getAlbumById(updated.id));
  });

  app.post("/api/admin/reorder-albums", requireAdmin, async (req, res) => {
    const store = await getStore();
    const albumIds = Array.isArray(req.body?.albumIds) ? req.body.albumIds.map(String) : [];
    await store.reorderAlbums(albumIds);
    res.json(await store.listAlbums());
  });

  app.get("/media/images/:file", (req, res) => {
    const file = path.basename(decodeURIComponent(req.params.file));
    const full = path.join(imagesDir(), file);
    if (!fs.existsSync(full)) {
      res.status(404).end();
      return;
    }
    res.sendFile(full);
  });

  app.get("/media/songs/:file", (req, res) => {
    const file = path.basename(decodeURIComponent(req.params.file));
    const full = path.join(songsDir(), file);
    if (!fs.existsSync(full)) {
      res.status(404).end();
      return;
    }
    res.sendFile(full);
  });
}
