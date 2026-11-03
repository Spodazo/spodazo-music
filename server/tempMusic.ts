import crypto from "crypto";
import fs from "fs";
import path from "path";
import type { Express, Request, Response } from "express";
import multer from "multer";
import { titleFromAudioFile, uniqueSlug } from "../shared/seed-data";
import {
  compareSyncNames,
  planTempMusicSync,
  TEMP_MUSIC_MAX_BYTES,
  TEMP_MUSIC_SLUG,
  TEMP_MUSIC_TITLE,
  validateSyncFiles,
  type TempMusicFile,
} from "../shared/tempMusic";
import type { Album } from "../shared/types";
import { bumpContentRevision, removeSongFile, shouldStripAudioUpload, stripUploadedSong } from "./media";
import { dataDir, ensureDataDirs, songsDir, uniqueFileName } from "./paths";
import { getStore } from "./storage";

const TOKEN_FILE = "temp-music-sync.token";
const STATE_FILE = "temp-music-sync.json";

type SyncEntry = {
  trackId: string;
  sha256: string;
  size: number;
};

type SyncState = {
  files: Record<string, SyncEntry>;
};

let chain: Promise<void> = Promise.resolve();

export function withTempMusicLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function tempMusicSyncToken(): string {
  const fromEnv = process.env.TEMP_MUSIC_SYNC_TOKEN?.trim() || "";
  if (/^[a-f0-9]{64}$/.test(fromEnv)) return fromEnv;
  ensureDataDirs();
  const full = path.join(dataDir(), TOKEN_FILE);
  try {
    const existing = fs.readFileSync(full, "utf8").trim();
    if (/^[a-f0-9]{64}$/.test(existing)) return existing;
  } catch {
    /* create one below */
  }
  const token = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(full, `${token}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(full, 0o600);
  } catch {
    /* the file is still outside the web root */
  }
  return token;
}

export function tempMusicTokenMatches(header: string | undefined): boolean {
  const provided = header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  const expected = tempMusicSyncToken();
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    crypto.timingSafeEqual(b, b);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

function statePath(): string {
  return path.join(dataDir(), STATE_FILE);
}

function readState(): SyncState {
  try {
    const raw = JSON.parse(fs.readFileSync(statePath(), "utf8")) as { files?: Record<string, SyncEntry> };
    const files: Record<string, SyncEntry> = {};
    for (const [name, entry] of Object.entries(raw.files || {})) {
      if (!entry || typeof entry.trackId !== "string" || typeof entry.sha256 !== "string") continue;
      files[name] = { trackId: entry.trackId, sha256: entry.sha256, size: Number(entry.size) || 0 };
    }
    return { files };
  } catch {
    return { files: {} };
  }
}

function writeState(state: SyncState): void {
  ensureDataDirs();
  const full = statePath();
  const tmp = `${full}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, full);
}

async function ensureTempMusicAlbumUnlocked(): Promise<Album> {
  const store = await getStore();
  const existing = await store.getAlbumBySlug(TEMP_MUSIC_SLUG);
  if (existing) {
    if (!existing.hidden) await store.updateAlbum(existing.id, { hidden: true });
    return { ...existing, hidden: true };
  }
  const list = await store.listAlbums();
  const sortOrder = list.reduce((max, album) => Math.max(max, album.sortOrder), 0) + 1;
  return store.createAlbum({
    slug: TEMP_MUSIC_SLUG,
    title: TEMP_MUSIC_TITLE,
    tagline: "Private drafts. Only visible while signed in as admin.",
    artists: "",
    hidden: true,
    sortOrder,
  });
}

export function ensureTempMusicAlbum(): Promise<Album> {
  return withTempMusicLock(() => ensureTempMusicAlbumUnlocked());
}

export async function songFileIsPrivate(filename: string): Promise<boolean> {
  if (!filename) return false;
  const album = await (await getStore()).getAlbumBySlug(TEMP_MUSIC_SLUG);
  if (!album) return false;
  return [...album.tracks, ...album.archivedTracks].some((track) => track.file === filename);
}

function requireSync(req: Request, res: Response): boolean {
  if (tempMusicTokenMatches(req.header("authorization"))) return true;
  res.status(401).json({ error: "Temp Music sync key required" });
  return false;
}

function desiredFromBody(body: unknown): TempMusicFile[] | { error: string } {
  const files = body && typeof body === "object" ? (body as { files?: unknown }).files : undefined;
  return validateSyncFiles(files);
}

async function orderAlbum(albumId: string, state: SyncState): Promise<void> {
  const names = Object.keys(state.files).sort(compareSyncNames);
  const ids = names.map((name) => state.files[name]?.trackId).filter((id): id is string => Boolean(id));
  if (!ids.length) return;
  await (await getStore()).reorderTracks(albumId, ids);
}

const disk = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = songsDir();
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    cb(null, uniqueFileName(songsDir(), file.originalname));
  },
});

type SyncRequest = Request & { tempMusicHash?: { sha256: string; size: number } };

const syncUpload = multer({
  storage: {
    _handleFile(req, file, cb) {
      disk._handleFile(req, file, (err, info) => {
        if (err || !info?.filename) {
          cb(err || new Error("Upload failed"));
          return;
        }
        const full = path.join(songsDir(), info.filename);
        const data = fs.readFileSync(full);
        (req as SyncRequest).tempMusicHash = {
          sha256: crypto.createHash("sha256").update(data).digest("hex"),
          size: data.length,
        };
        if (shouldStripAudioUpload(file)) stripUploadedSong(info.filename);
        cb(null, info);
      });
    },
    _removeFile(req, file, cb) {
      disk._removeFile(req, file, cb);
    },
  },
  limits: { fileSize: TEMP_MUSIC_MAX_BYTES },
});

async function statusPayload() {
  const store = await getStore();
  const album = await store.getAlbumBySlug(TEMP_MUSIC_SLUG);
  const state = readState();
  const byId = new Map(Object.entries(state.files).map(([name, entry]) => [entry.trackId, { name, ...entry }]));
  return {
    slug: TEMP_MUSIC_SLUG,
    hidden: Boolean(album?.hidden),
    tracks: (album?.tracks || []).map((track) => {
      const sync = byId.get(track.id);
      return {
        id: track.id,
        n: track.n,
        title: track.title,
        scripture: track.scripture,
        lyrics: track.lyrics,
        img: track.img,
        file: track.file,
        name: sync?.name || "",
        sha256: sync?.sha256 || "",
        size: sync?.size || 0,
      };
    }),
  };
}

export function registerTempMusicRoutes(app: Express): void {
  app.get("/api/sync/temp-music", async (req, res) => {
    if (!requireSync(req, res)) return;
    await ensureTempMusicAlbum();
    res.json(await statusPayload());
  });

  app.post("/api/sync/temp-music/plan", async (req, res) => {
    if (!requireSync(req, res)) return;
    const desired = desiredFromBody(req.body);
    if ("error" in desired) {
      res.status(400).json({ error: desired.error });
      return;
    }
    const plan = await withTempMusicLock(async () => {
      await ensureTempMusicAlbumUnlocked();
      const state = readState();
      const store = await getStore();
      const album = await store.getAlbumBySlug(TEMP_MUSIC_SLUG);
      const next = planTempMusicSync(state.files, desired);
      for (const name of [...next.unchanged]) {
        const entry = state.files[name];
        const track = entry ? await store.getTrackById(entry.trackId) : null;
        if (!track || track.albumId !== album?.id) {
          next.unchanged = next.unchanged.filter((item) => item !== name);
          next.upload.push(name);
        }
      }
      return next;
    });
    res.json(plan);
  });

  app.post("/api/sync/temp-music/file", syncUpload.single("audio"), async (req, res) => {
    const file = req.file;
    const hashed = (req as SyncRequest).tempMusicHash;
    if (!requireSync(req, res)) {
      if (file?.filename) removeSongFile(file.filename);
      return;
    }
    const name = String(req.query.name || "");
    const claimed = validateSyncFiles([
      { name, size: Number(req.query.size), sha256: String(req.query.sha256 || "") },
    ]);
    if ("error" in claimed || !file?.filename || !hashed) {
      if (file?.filename) removeSongFile(file.filename);
      res.status(400).json({ error: "error" in claimed ? claimed.error : "MP3 required" });
      return;
    }
    const incoming = claimed[0];
    if (hashed.sha256 !== incoming.sha256 || hashed.size !== incoming.size) {
      removeSongFile(file.filename);
      res.status(400).json({ error: `Could not read a finished copy of ${incoming.name}` });
      return;
    }
    try {
      const saved = await withTempMusicLock(async () => {
        const album = await ensureTempMusicAlbumUnlocked();
        const store = await getStore();
        const state = readState();
        const previous = state.files[incoming.name];
        const existing = previous ? await store.getTrackById(previous.trackId) : null;
        let trackId = existing?.id || "";
        let replaced = false;
        if (existing && existing.albumId === album.id) {
          const updated = await store.updateTrack(existing.id, { file: file.filename, archived: false });
          trackId = updated?.id || existing.id;
          replaced = true;
          if (existing.file && existing.file !== file.filename) removeSongFile(existing.file);
        } else {
          const current = await store.getAlbumById(album.id);
          const used = new Set(
            [...(current?.tracks || []), ...(current?.archivedTracks || [])].map((track) => track.slug).filter(Boolean),
          );
          const { title, scripture } = titleFromAudioFile(incoming.name);
          const slug = uniqueSlug(title, used);
          const created = await store.createTrack({
            albumId: album.id,
            n: (current?.tracks.length || 0) + 1,
            title,
            scripture,
            file: file.filename,
            img: "",
            key: slug,
            lyrics: "",
            introduction: "",
            instrumental: false,
            slug,
          });
          trackId = created.id;
        }
        state.files[incoming.name] = { trackId, sha256: incoming.sha256, size: incoming.size };
        writeState(state);
        await orderAlbum(album.id, state);
        bumpContentRevision();
        return { name: incoming.name, trackId, replaced };
      });
      res.status(saved.replaced ? 200 : 201).json(saved);
    } catch (err) {
      removeSongFile(file.filename);
      console.error("[temp-music] upload failed:", err);
      res.status(500).json({ error: "Could not save that song" });
    }
  });

  app.post("/api/sync/temp-music/prune", async (req, res) => {
    if (!requireSync(req, res)) return;
    if (req.body?.confirm !== "mirror") {
      res.status(400).json({ error: "Refusing to remove songs without a finished folder scan" });
      return;
    }
    const desired = desiredFromBody(req.body);
    if ("error" in desired) {
      res.status(400).json({ error: desired.error });
      return;
    }
    const result = await withTempMusicLock(async () => {
      const album = await ensureTempMusicAlbumUnlocked();
      const store = await getStore();
      const state = readState();
      for (const file of desired) {
        const entry = state.files[file.name];
        const track = entry ? await store.getTrackById(entry.trackId) : null;
        if (!entry || entry.sha256 !== file.sha256 || entry.size !== file.size || !track || track.albumId !== album.id) {
          return { error: "Upload the new songs before removing anything", status: 409 as const };
        }
      }
      const keep = new Set(desired.map((file) => file.name));
      const removed: string[] = [];
      for (const name of Object.keys(state.files)) {
        if (keep.has(name)) continue;
        const entry = state.files[name];
        const track = await store.getTrackById(entry.trackId);
        delete state.files[name];
        if (track) {
          await store.deleteTrack(track.id);
          if (track.file) removeSongFile(track.file);
        }
        removed.push(name);
      }
      const live = await store.getAlbumById(album.id);
      const syncedIds = new Set(Object.values(state.files).map((entry) => entry.trackId));
      for (const track of [...(live?.tracks || []), ...(live?.archivedTracks || [])]) {
        if (syncedIds.has(track.id)) continue;
        await store.deleteTrack(track.id);
        if (track.file) removeSongFile(track.file);
        removed.push(track.title);
      }
      writeState(state);
      await orderAlbum(album.id, state);
      if (removed.length) bumpContentRevision();
      return { removed };
    });
    if ("error" in result) {
      res.status(result.status ?? 409).json({ error: result.error });
      return;
    }
    res.json(result);
  });

  app.get("/api/admin/temp-music", async (req, res) => {
    if (!req.session?.admin) {
      res.status(401).json({ error: "Admin login required" });
      return;
    }
    await ensureTempMusicAlbum();
    res.json({
      ...(await statusPayload()),
      token: tempMusicSyncToken(),
    });
  });
}
