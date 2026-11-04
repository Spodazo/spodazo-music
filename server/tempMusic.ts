import crypto from "crypto";
import fs from "fs";
import path from "path";
import type { Express, Request, Response } from "express";
import multer from "multer";
import { titleFromAudioFile, uniqueSlug } from "../shared/seed-data";
import {
  isSyncAlbumSlug,
  planTempMusicSync,
  syncAlbumSlug,
  syncPathFolder,
  TEMP_MUSIC_MAX_BYTES,
  TEMP_MUSIC_SLUG,
  TEMP_MUSIC_TITLE,
  validateSyncFiles,
  validateSyncFolders,
  type TempMusicFile,
} from "../shared/tempMusic";
import type { Album } from "../shared/types";
import { bumpContentRevision, removeSongFile, shouldStripAudioUpload, stripUploadedSong } from "./media";
import { dataDir, ensureDataDirs, songsDir, uniqueFileName } from "./paths";
import { getStore, type MusicStore } from "./storage";

const TOKEN_FILE = "temp-music-sync.token";
const STATE_FILE = "temp-music-sync.json";

type SyncEntry = {
  trackId: string;
  sha256: string;
  size: number;
  appliedTitle?: string;
  appliedScripture?: string;
};

type SyncState = {
  files: Record<string, SyncEntry>;
  albums: Record<string, string>;
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
    const raw = JSON.parse(fs.readFileSync(statePath(), "utf8")) as {
      files?: Record<string, SyncEntry>;
      albums?: Record<string, string>;
    };
    const files: Record<string, SyncEntry> = {};
    for (const [name, entry] of Object.entries(raw.files || {})) {
      if (!entry || typeof entry.trackId !== "string" || typeof entry.sha256 !== "string") continue;
      files[name] = {
        trackId: entry.trackId,
        sha256: entry.sha256,
        size: Number(entry.size) || 0,
        appliedTitle: entry.appliedTitle,
        appliedScripture: entry.appliedScripture,
      };
    }
    const albums: Record<string, string> = {};
    for (const [folder, albumId] of Object.entries(raw.albums || {})) {
      if (typeof albumId === "string" && albumId) albums[folder] = albumId;
    }
    return { files, albums };
  } catch {
    return { files: {}, albums: {} };
  }
}

function writeState(state: SyncState): void {
  ensureDataDirs();
  const full = statePath();
  const tmp = `${full}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, full);
}

async function ensureSyncAlbum(folderName: string): Promise<Album> {
  const store = await getStore();
  const slug = syncAlbumSlug(folderName);
  const title = folderName || TEMP_MUSIC_TITLE;
  const existing = await store.getAlbumBySlug(slug);
  if (existing) {
    const patch: { hidden?: boolean; title?: string } = {};
    if (!existing.hidden) patch.hidden = true;
    if (existing.title !== title) patch.title = title;
    if (Object.keys(patch).length) {
      const updated = await store.updateAlbum(existing.id, patch);
      return updated ? { ...updated, hidden: true } : { ...existing, hidden: true, title };
    }
    return existing;
  }
  const list = await store.listAlbums();
  const sortOrder = list.reduce((max, album) => Math.max(max, album.sortOrder), 0) + 1;
  return store.createAlbum({
    slug,
    title,
    tagline: folderName
      ? "Private folder from Temp Music. Only visible while signed in as admin."
      : "Private drafts. Only visible while signed in as admin.",
    artists: "",
    hidden: true,
    sortOrder,
  });
}

async function ensureTempMusicAlbumUnlocked(): Promise<Album> {
  return ensureSyncAlbum("");
}

export function ensureTempMusicAlbum(): Promise<Album> {
  return withTempMusicLock(() => ensureTempMusicAlbumUnlocked());
}

export async function songFileIsPrivate(filename: string): Promise<boolean> {
  if (!filename) return false;
  const store = await getStore();
  const list = await store.listAlbums();
  for (const item of list) {
    if (!isSyncAlbumSlug(item.slug)) continue;
    const album = await store.getAlbumById(item.id);
    if (!album) continue;
    if ([...album.tracks, ...album.archivedTracks].some((track) => track.file === filename)) return true;
  }
  return false;
}

function requireSync(req: Request, res: Response): boolean {
  if (tempMusicTokenMatches(req.header("authorization"))) return true;
  res.status(401).json({ error: "Temp Music sync key required" });
  return false;
}

function desiredFromBody(body: unknown): { files: TempMusicFile[]; folders: string[] } | { error: string } {
  const record = body && typeof body === "object" ? (body as { files?: unknown; folders?: unknown }) : {};
  const files = validateSyncFiles(record.files);
  if ("error" in files) return files;
  const folders = validateSyncFolders(record.folders);
  if ("error" in folders) return folders;
  const names = new Set(folders);
  for (const file of files) {
    const folder = syncPathFolder(file.name);
    if (folder) names.add(folder);
  }
  return { files, folders: [...names] };
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

function trackStatus(
  track: {
    id: string;
    n: number;
    title: string;
    scripture: string;
    lyrics: string;
    img: string;
    file: string;
  },
  sync?: { name: string; sha256: string; size: number },
) {
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
}

async function statusPayload() {
  const store = await getStore();
  const state = readState();
  const byId = new Map(Object.entries(state.files).map(([name, entry]) => [entry.trackId, { name, ...entry }]));
  const list = (await store.listAlbums()).filter((album) => isSyncAlbumSlug(album.slug));
  const albums = [];
  for (const item of list) {
    const album = await store.getAlbumById(item.id);
    if (!album) continue;
    albums.push({
      slug: album.slug,
      title: album.title,
      hidden: album.hidden,
      tracks: album.tracks.map((track) => trackStatus(track, byId.get(track.id))),
    });
  }
  const root = albums.find((album) => album.slug === TEMP_MUSIC_SLUG);
  return {
    slug: TEMP_MUSIC_SLUG,
    hidden: root?.hidden ?? true,
    tracks: root?.tracks || [],
    albums,
  };
}

async function applyFilenameTitle(
  store: MusicStore,
  state: SyncState,
  name: string,
  trackId: string,
  albumId: string,
): Promise<boolean> {
  const fromFile = titleFromAudioFile(name);
  const entry = state.files[name];
  if (
    entry &&
    entry.appliedTitle === fromFile.title &&
    (entry.appliedScripture || "") === (fromFile.scripture || "")
  ) {
    return false;
  }
  const track = await store.getTrackById(trackId);
  if (!track) return false;
  const changed = track.title !== fromFile.title || track.scripture !== fromFile.scripture;
  if (changed) {
    const album = await store.getAlbumById(albumId);
    const used = new Set(
      [...(album?.tracks || []), ...(album?.archivedTracks || [])]
        .filter((item) => item.id !== trackId)
        .map((item) => item.slug)
        .filter(Boolean),
    );
    await store.updateTrack(trackId, {
      title: fromFile.title,
      scripture: fromFile.scripture,
      slug: uniqueSlug(fromFile.title, used),
    });
  }
  if (entry) {
    entry.appliedTitle = fromFile.title;
    entry.appliedScripture = fromFile.scripture;
  }
  return changed;
}

async function movedTrack(store: MusicStore, state: SyncState, incoming: TempMusicFile) {
  const donor = Object.entries(state.files).find(
    ([name, entry]) => name !== incoming.name && entry.sha256 === incoming.sha256 && entry.size === incoming.size,
  );
  if (!donor) return null;
  return store.getTrackById(donor[1].trackId);
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
      const state = readState();
      const store = await getStore();
      for (const folder of ["", ...desired.folders]) {
        const album = await ensureSyncAlbum(folder);
        state.albums[folder] = album.id;
      }
      writeState(state);
      const next = planTempMusicSync(state.files, desired.files);
      for (const name of [...next.unchanged]) {
        const entry = state.files[name];
        const track = entry ? await store.getTrackById(entry.trackId) : null;
        const album = await store.getAlbumBySlug(syncAlbumSlug(syncPathFolder(name)));
        if (!track || track.albumId !== album?.id) {
          next.unchanged = next.unchanged.filter((item) => item !== name);
          next.upload.push(name);
        }
      }
      let renamed = false;
      for (const name of next.unchanged) {
        const entry = state.files[name];
        const album = await store.getAlbumBySlug(syncAlbumSlug(syncPathFolder(name)));
        if (!entry || !album) continue;
        if (await applyFilenameTitle(store, state, name, entry.trackId, album.id)) renamed = true;
      }
      if (renamed) {
        writeState(state);
        bumpContentRevision();
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
        const folderName = syncPathFolder(incoming.name);
        const album = await ensureSyncAlbum(folderName);
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
          const moved = await movedTrack(store, state, incoming);
          const fromFile = titleFromAudioFile(incoming.name);
          const title = fromFile.title;
          const scripture = fromFile.scripture;
          const slug = uniqueSlug(title, used);
          let n = (current?.tracks.length || 0) + 1;
          if (moved && moved.albumId === album.id) {
            n = moved.n;
            await store.updateTrack(moved.id, { n: (current?.tracks.length || 0) + 1 });
          }
          const created = await store.createTrack({
            albumId: album.id,
            n,
            title,
            scripture,
            file: file.filename,
            img: moved?.img || "",
            key: slug,
            lyrics: moved?.lyrics || "",
            introduction: moved?.introduction || "",
            instrumental: Boolean(moved?.instrumental),
            slug,
          });
          trackId = created.id;
        }
        const named = titleFromAudioFile(incoming.name);
        state.files[incoming.name] = {
          trackId,
          sha256: incoming.sha256,
          size: incoming.size,
          appliedTitle: named.title,
          appliedScripture: named.scripture,
        };
        state.albums[folderName] = album.id;
        writeState(state);
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
      const store = await getStore();
      const state = readState();
      const folderNames = new Set(["", ...desired.folders]);
      for (const folder of folderNames) {
        const album = await ensureSyncAlbum(folder);
        state.albums[folder] = album.id;
      }
      for (const file of desired.files) {
        const entry = state.files[file.name];
        const track = entry ? await store.getTrackById(entry.trackId) : null;
        const albumId = state.albums[syncPathFolder(file.name)];
        if (!entry || entry.sha256 !== file.sha256 || entry.size !== file.size || !track || track.albumId !== albumId) {
          return { error: "Upload the new songs before removing anything", status: 409 as const };
        }
      }
      const keep = new Set(desired.files.map((file) => file.name));
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
      for (const [folder, albumId] of Object.entries(state.albums)) {
        const live = await store.getAlbumById(albumId);
        const syncedIds = new Set(
          Object.entries(state.files)
            .filter(([name]) => syncPathFolder(name) === folder)
            .map(([, entry]) => entry.trackId),
        );
        for (const track of [...(live?.tracks || []), ...(live?.archivedTracks || [])]) {
          if (syncedIds.has(track.id)) continue;
          await store.deleteTrack(track.id);
          if (track.file) removeSongFile(track.file);
          removed.push(track.title);
        }
        if (folder && !folderNames.has(folder)) {
          if (live) await store.deleteAlbum(live.id);
          delete state.albums[folder];
          removed.push(folder);
        }
      }
      writeState(state);
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
