import type { Express, Request } from "express";
import fs from "fs";
import path from "path";
import multer from "multer";
import { slugify, titleFromAudioFile, uniqueSlug } from "../shared/seed-data";
import type { PlayerSetup } from "../shared/types";
import { loginAdmin, logoutAdmin, requireAdmin } from "./auth";
import { curatorPasswordMatches, curatorRecoveryError, hashPassword, MIN_PASSWORD_LENGTH } from "./password";
import { assetVersion, convertUploadedImage, localSongPath, mp3DataOffset, shouldConvertImageUpload, shouldStripAudioUpload, stripUploadedSong, trackDownloadName } from "./media";
import { imagesDir, songsDir, uniqueFileName } from "./paths";
import { getStore } from "./storage";

const disk = multer.diskStorage({
  destination: (_req, file, cb) => {
    const dir = file.fieldname === "audio" ? songsDir() : imagesDir();
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const dir = file.fieldname === "audio" ? songsDir() : imagesDir();
    cb(null, uniqueFileName(dir, file.originalname));
  },
});

const upload = multer({
  storage: {
    _handleFile(req, file, cb) {
      disk._handleFile(req, file, (err, info) => {
        if (err) {
          cb(err);
          return;
        }
        if (info?.filename && shouldStripAudioUpload(file)) {
          stripUploadedSong(info.filename);
          cb(null, info);
          return;
        }
        if (info?.filename && shouldConvertImageUpload(file)) {
          convertUploadedImage(info.filename)
            .then((filename) => cb(null, { ...info, filename }))
            .catch(cb);
          return;
        }
        cb(null, info);
      });
    },
    _removeFile(req, file, cb) {
      disk._removeFile(req, file, cb);
    },
  },
  limits: { fileSize: 80 * 1024 * 1024 },
});

function albumFields(body: Request["body"], partial = false) {
  const has = (key: string) => Object.prototype.hasOwnProperty.call(body, key);
  const fields: {
    slug?: string;
    title?: string;
    tagline?: string;
    credits?: string;
    artists?: string;
    copyright?: string;
    heroPortrait?: string;
    thumb?: string;
    artistThumb?: string;
    color?: string;
    sortOrder?: number;
    hidden?: boolean;
  } = {};
  if (!partial || has("title")) fields.title = String(body.title || "").trim();
  if (!partial || has("slug") || has("title")) {
    fields.slug = String(body.slug || slugify(body.title || "")).trim();
  }
  if (!partial || has("tagline")) fields.tagline = String(body.tagline || "");
  if (!partial || has("credits")) fields.credits = String(body.credits || "");
  if (!partial || has("artists")) fields.artists = String(body.artists || "");
  if (!partial || has("copyright")) fields.copyright = String(body.copyright || "");
  if (!partial || has("color")) fields.color = String(body.color || "");
  if (!partial || has("hidden")) fields.hidden = body.hidden === true || body.hidden === "true";
  if (body.heroPortrait) fields.heroPortrait = String(body.heroPortrait);
  if (body.thumb) fields.thumb = String(body.thumb);
  if (body.artistThumb) fields.artistThumb = String(body.artistThumb);
  if (body.sortOrder !== undefined && body.sortOrder !== "") fields.sortOrder = Number(body.sortOrder);
  return fields;
}

function trackFields(body: Request["body"], albumId?: string) {
  const fields: Record<string, unknown> = {};
  if (albumId) fields.albumId = albumId;
  if (body.title !== undefined) {
    const title = String(body.title || "").trim();
    fields.title = title;
    if (body.slug === undefined) fields.slug = slugify(title);
  }
  if (body.slug !== undefined) fields.slug = String(body.slug || slugify(String(body.title || "")));
  if (body.scripture !== undefined) fields.scripture = String(body.scripture || "");
  if (body.lyrics !== undefined) fields.lyrics = String(body.lyrics || "");
  if (body.introduction !== undefined) fields.introduction = String(body.introduction || "");
  if (body.instrumental !== undefined) {
    fields.instrumental = body.instrumental === true || body.instrumental === "true";
  }
  if (body.n !== undefined && body.n !== "") fields.n = Number(body.n);
  if (body.file) fields.file = String(body.file);
  if (body.img) fields.img = String(body.img);
  if (body.key) fields.key = String(body.key);
  return fields;
}

export function registerRoutes(app: Express): void {
  app.get("/api/version", (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({
      app: "spodazo-music",
      ok: true,
      build: assetVersion(),
      musicDataDir: process.env.MUSIC_DATA_DIR || ".music-data",
      database: process.env.DATABASE_URL ? "postgres" : "json",
    });
  });

  app.get("/api/player-setup", async (_req, res) => {
    const store = await getStore();
    res.set("Cache-Control", "no-store");
    res.json(await store.getPlayerSetup());
  });

  app.patch("/api/admin/player-setup", requireAdmin, upload.fields([
    { name: "cover", maxCount: 1 },
    { name: "logo", maxCount: 1 },
  ]), async (req, res) => {
    const store = await getStore();
    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const body = req.body || {};
    const fields: Partial<PlayerSetup> = {};
    if (body.appName !== undefined) fields.appName = String(body.appName);
    if (body.theme !== undefined) fields.theme = String(body.theme);
    if (body.credits !== undefined) fields.credits = String(body.credits);
    if (body.copyright !== undefined) fields.copyright = String(body.copyright);
    if (body.collectionColor !== undefined) fields.collectionColor = String(body.collectionColor);
    if (files?.cover?.[0]) fields.collectionCover = files.cover[0].filename;
    if (files?.logo?.[0]) fields.logo = files.logo[0].filename;
    res.json(await store.updatePlayerSetup(fields));
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
    const store = await getStore();
    const record = await store.getCuratorRecord();
    if (!record.passwordHash && !process.env.ADMIN_PASSWORD) {
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

  app.get("/api/admin/curator", requireAdmin, async (_req, res) => {
    const store = await getStore();
    res.set("Cache-Control", "no-store");
    res.json(await store.getCurator());
  });

  app.post("/api/admin/curator/verify", requireAdmin, async (req, res) => {
    const password = String(req.body?.password || "");
    const store = await getStore();
    const record = await store.getCuratorRecord();
    if (!(await curatorPasswordMatches(password, record.passwordHash))) {
      res.status(401).json({ error: "Wrong password" });
      return;
    }
    res.json({ ok: true });
  });

  app.patch("/api/admin/curator", requireAdmin, async (req, res) => {
    const body = req.body || {};
    const currentPassword = String(body.currentPassword || "");
    const store = await getStore();
    const record = await store.getCuratorRecord();
    if (!(await curatorPasswordMatches(currentPassword, record.passwordHash))) {
      res.status(401).json({ error: "Wrong password" });
      return;
    }
    const firstName = String(body.firstName ?? record.firstName);
    const lastName = String(body.lastName ?? record.lastName);
    const email = String(body.email ?? record.email).trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ error: "Enter a valid email" });
      return;
    }
    const nextPassword = String(body.password || "");
    if (nextPassword && nextPassword.length < MIN_PASSWORD_LENGTH) {
      res.status(400).json({ error: "New password must be at least 8 characters" });
      return;
    }
    const fields: Partial<typeof record> = { firstName, lastName, email };
    if (nextPassword) fields.passwordHash = await hashPassword(nextPassword);
    res.json(await store.updateCurator(fields));
  });

  app.post("/api/admin/curator/recover", async (req, res) => {
    const body = req.body || {};
    const store = await getStore();
    const record = await store.getCuratorRecord();
    const isAdmin = Boolean(req.session?.admin);
    const password = String(body.password || "");
    const problem = curatorRecoveryError({
      isAdmin,
      email: String(body.email || ""),
      recoveryPassword: String(body.recoveryPassword || ""),
      newPassword: password,
      curatorEmail: record.email,
    });
    if (problem) {
      res.status(problem.status).json({ error: problem.error });
      return;
    }
    await store.updateCurator({ passwordHash: await hashPassword(password) });
    if (!isAdmin) {
      try {
        if (!(await loginAdmin(req, password))) {
          res.status(500).json({ error: "Password was reset, but sign-in failed" });
          return;
        }
      } catch (err) {
        console.error("[admin] recover session error:", err);
        res.status(500).json({ error: "Password was reset, but sign-in failed" });
        return;
      }
    }
    res.json({ ok: true });
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
    const fields = albumFields(req.body, true);
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

  app.get("/api/admin/tracks/:id/file", requireAdmin, async (req, res) => {
    const store = await getStore();
    const track = await store.getTrackById(req.params.id);
    if (!track?.file) {
      res.status(404).json({ error: "Track not found" });
      return;
    }
    const full = localSongPath(track.file);
    if (!full) {
      res.status(404).json({ error: "Song file is not on the live library" });
      return;
    }
    res.download(full, trackDownloadName(track));
  });

  app.post("/api/admin/tracks/:id/archive", requireAdmin, async (req, res) => {
    const store = await getStore();
    const archived = req.body?.archived === true || req.body?.archived === "true";
    const updated = await store.setTrackArchived(req.params.id, archived);
    if (!updated) {
      res.status(404).json({ error: "Track not found" });
      return;
    }
    res.json(updated);
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
    res.sendFile(full, {
      acceptRanges: true,
      start: mp3DataOffset(full),
      headers: {
        "Content-Type": "audio/mpeg",
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=31536000, immutable, no-transform",
      },
    });
  });
}
