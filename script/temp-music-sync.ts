import { spawn } from "child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import {
  isSyncFolderName,
  isTempMusicFileName,
  normalizeSyncName,
  stableSnapshots,
  type FileSnap,
  type TempMusicFile,
} from "../shared/tempMusic";

export type SyncConfig = {
  api: string;
  token: string;
  folder: string;
  settleMs?: number;
};

export type SyncResult =
  | { ok: true; added: number; updated: number; removed: number; unread?: string[] }
  | { ok: false; skipped: "missing-folder" | "busy" | "unreachable" | "rejected"; detail?: string };

const READ_TIMEOUT_MS = 20000;
const STALL_MS = 60000;

export function defaultConfigPath(): string {
  return path.join(process.env.HOME || "", "Library", "Application Support", "Spodazo Music", "temp-music.json");
}

export function loadSyncConfig(file = process.env.TEMP_MUSIC_CONFIG || defaultConfigPath()): SyncConfig {
  let parsed: Partial<SyncConfig> = {};
  try {
    parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<SyncConfig>;
  } catch {
    parsed = {};
  }
  const home = process.env.HOME || "";
  const supportFolder = path.join(home, "Library", "Application Support", "Spodazo Music", "Temp Music");
  return {
    api: (process.env.TEMP_MUSIC_API || parsed.api || "http://127.0.0.1:3000").replace(/\/$/, ""),
    token: process.env.TEMP_MUSIC_SYNC_TOKEN || parsed.token || "",
    folder: process.env.TEMP_MUSIC_DIR || parsed.folder || supportFolder,
    settleMs: parsed.settleMs ?? 500,
  };
}

function logLine(line: string) {
  const file =
    process.env.TEMP_MUSIC_LOG ||
    path.join(process.env.HOME || "", "Library", "Logs", "Spodazo Music", "temp-music-sync.log");
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    appendFileSync(file, `${new Date().toISOString()} ${line}\n`);
  } catch {
    console.log(line);
  }
}

const FILE_WORKER = `
import { createHash } from "crypto";
import { createReadStream } from "fs";
const full = process.env.TEMP_MUSIC_READ_FILE || "";
const wantBytes = process.env.TEMP_MUSIC_READ_MODE === "bytes";
const hash = createHash("sha256");
const chunks = [];
const stream = createReadStream(full);
stream.on("data", (chunk) => {
  hash.update(chunk);
  if (wantBytes) chunks.push(chunk);
});
stream.on("error", () => process.exit(1));
stream.on("end", () => {
  process.stdout.write(hash.digest("hex"));
  if (wantBytes) process.stdout.write("\\n" + Buffer.concat(chunks).toString("base64"));
});
`;

type HashRecord = { size: number; mtimeMs: number; sha256: string };
const hashCache = new Map<string, HashRecord>();
let cacheLoaded = false;

function hashCachePath(): string {
  return path.join(path.dirname(defaultConfigPath()), "temp-music-hashes.json");
}

function loadHashCache() {
  if (cacheLoaded) return;
  cacheLoaded = true;
  if (!process.env.TEMP_MUSIC_CONFIG && !process.env.TEMP_MUSIC_LOG) return;
  try {
    const raw = JSON.parse(readFileSync(hashCachePath(), "utf8")) as Record<string, HashRecord>;
    for (const [key, value] of Object.entries(raw || {})) {
      if (value && /^[a-f0-9]{64}$/.test(value.sha256)) hashCache.set(key, value);
    }
  } catch {
    /* the next changed file is hashed again */
  }
}

function saveHashCache() {
  if (!process.env.TEMP_MUSIC_CONFIG && !process.env.TEMP_MUSIC_LOG) return;
  const saved: Record<string, HashRecord> = {};
  for (const [key, value] of hashCache) saved[key] = value;
  try {
    mkdirSync(path.dirname(hashCachePath()), { recursive: true });
    writeFileSync(hashCachePath(), JSON.stringify(saved));
  } catch {
    /* memory still has the hash for this run */
  }
}

function readInChild(full: string, mode: "hash" | "bytes"): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", FILE_WORKER], {
      env: { ...process.env, TEMP_MUSIC_READ_FILE: full, TEMP_MUSIC_READ_MODE: mode },
      stdio: ["ignore", "pipe", "ignore"],
    });
    const chunks: Buffer[] = [];
    let settled = false;
    const finish = (err: Error | null, value?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(value || "");
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error(`timed out reading ${full}`));
    }, READ_TIMEOUT_MS);
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.once("error", (err) => finish(err));
    child.once("close", (code) => {
      if (code !== 0) finish(new Error(`timed out reading ${full}`));
      else finish(null, Buffer.concat(chunks).toString("utf8"));
    });
  });
}

async function sha256File(full: string, size?: number, mtimeMs?: number): Promise<string> {
  loadHashCache();
  const cached = hashCache.get(full);
  if (cached && cached.size === size && cached.mtimeMs === mtimeMs) return cached.sha256;
  const sha256 = (await readInChild(full, "hash")).trim();
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error(`timed out reading ${full}`);
  if (size !== undefined && mtimeMs !== undefined) {
    hashCache.set(full, { size, mtimeMs, sha256 });
    saveHashCache();
  }
  return sha256;
}

type TreeSnap = { files: FileSnap[]; folders: string[] };

function insideRoot(rootReal: string, real: string): boolean {
  return real === rootReal || real.startsWith(rootReal + path.sep);
}

async function snapshotTree(dir: string): Promise<TreeSnap> {
  const rootReal = await fs.realpath(dir);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: FileSnap[] = [];
  const folders: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    let real = full;
    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      real = await fs.realpath(full);
      stat = await fs.stat(full);
    } catch {
      continue;
    }
    if (!insideRoot(rootReal, real)) continue;
    const display = entry.name.normalize("NFC");
    if (stat.isDirectory()) {
      if (!isSyncFolderName(display)) continue;
      folders.push(display);
      const children = await fs.readdir(full, { withFileTypes: true });
      for (const child of children) {
        if (child.name.startsWith(".")) continue;
        const childName = normalizeSyncName(child.name);
        if (!isTempMusicFileName(childName)) continue;
        const childFull = path.join(full, child.name);
        let childReal = childFull;
        let childStat: Awaited<ReturnType<typeof fs.stat>>;
        try {
          childReal = await fs.realpath(childFull);
          childStat = await fs.stat(childFull);
        } catch {
          continue;
        }
        if (!childStat.isFile() || !insideRoot(rootReal, childReal)) continue;
        files.push({ name: `${display}/${childName}`, size: childStat.size, mtimeMs: childStat.mtimeMs });
      }
      continue;
    }
    if (!stat.isFile()) continue;
    const fileName = normalizeSyncName(entry.name);
    if (!isTempMusicFileName(fileName)) continue;
    files.push({ name: fileName, size: stat.size, mtimeMs: stat.mtimeMs });
  }
  files.sort((a, b) => compareNames(a.name, b.name));
  folders.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
  return { files, folders };
}

function compareNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function sameFolders(first: string[], second: string[]): boolean {
  if (first.length !== second.length) return false;
  const a = [...first].sort(compareNames);
  const b = [...second].sort(compareNames);
  return a.every((name, index) => name === b[index]);
}

function fileInside(root: string, rel: string): string | null {
  const parts = rel.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) return null;
  const full = path.resolve(root, ...parts);
  const base = path.resolve(root);
  if (full !== base && !full.startsWith(base + path.sep)) return null;
  return full;
}

async function readFinishedFiles(
  dir: string,
  settleMs: number,
): Promise<{ files: TempMusicFile[]; folders: string[]; unread: string[] } | "busy"> {
  const first = await snapshotTree(dir);
  await new Promise((resolve) => setTimeout(resolve, settleMs));
  const second = await snapshotTree(dir);
  const stable = stableSnapshots(first.files, second.files);
  if (!stable.ready || !sameFolders(first.folders, second.folders)) return "busy";
  const files: TempMusicFile[] = [];
  const unread: string[] = [];
  for (const snap of stable.files) {
    const full = fileInside(dir, snap.name);
    if (!full) return "busy";
    try {
      const sha256 = await sha256File(full, snap.size, snap.mtimeMs);
      const after = await fs.stat(full);
      if (after.size !== snap.size || after.mtimeMs !== snap.mtimeMs) return "busy";
      files.push({ name: snap.name, size: snap.size, sha256 });
    } catch {
      unread.push(snap.name);
    }
  }
  return { files, folders: second.folders, unread };
}

export async function syncTempMusicFolder(config: SyncConfig): Promise<SyncResult> {
  try {
    const dirStat = await fs.stat(config.folder);
    if (!dirStat.isDirectory()) return { ok: false, skipped: "missing-folder" };
  } catch {
    return { ok: false, skipped: "missing-folder" };
  }
  const scanned = await readFinishedFiles(config.folder, config.settleMs ?? 500);
  if (scanned === "busy") return { ok: false, skipped: "busy" };
  const { files, folders, unread } = scanned;
  const headers = {
    Authorization: `Bearer ${config.token}`,
    "Content-Type": "application/json",
  };
  let planRes: Response;
  try {
    planRes = await fetch(`${config.api}/api/sync/temp-music/plan`, {
      method: "POST",
      headers,
      body: JSON.stringify({ files, folders }),
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    return { ok: false, skipped: "unreachable" };
  }
  if (!planRes.ok) return { ok: false, skipped: "rejected", detail: await planRes.text() };
  const plan = (await planRes.json()) as { upload?: string[] };
  const byName = new Map(files.map((file) => [file.name, file]));
  let added = 0;
  let updated = 0;
  for (const name of plan.upload || []) {
    const file = byName.get(name);
    if (!file) return { ok: false, skipped: "busy" };
    const full = fileInside(config.folder, name);
    if (!full) return { ok: false, skipped: "busy" };
    const bytes = await readBounded(full);
    const body = new FormData();
    body.append("audio", new Blob([bytes], { type: "audio/mpeg" }), path.basename(name));
    let res: Response;
    try {
      res = await fetch(
        `${config.api}/api/sync/temp-music/file?name=${encodeURIComponent(name)}&size=${file.size}&sha256=${file.sha256}`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${config.token}` },
          body,
          signal: AbortSignal.timeout(20000),
        },
      );
    } catch {
      return { ok: false, skipped: "unreachable" };
    }
    if (!res.ok) return { ok: false, skipped: "rejected", detail: await res.text() };
    if (res.status === 201) added += 1;
    else updated += 1;
  }
  if (unread.length) return { ok: true, added, updated, removed: 0, unread };
  let pruneRes: Response;
  try {
    pruneRes = await fetch(`${config.api}/api/sync/temp-music/prune`, {
      method: "POST",
      headers,
      body: JSON.stringify({ confirm: "mirror", files, folders }),
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    return { ok: false, skipped: "unreachable" };
  }
  if (!pruneRes.ok) return { ok: false, skipped: "rejected", detail: await pruneRes.text() };
  const pruned = (await pruneRes.json()) as { removed?: string[] };
  return { ok: true, added, updated, removed: pruned.removed?.length || 0, unread };
}

async function readBounded(full: string): Promise<Buffer> {
  const text = await readInChild(full, "bytes");
  const split = text.indexOf("\n");
  const bytes = Buffer.from(split >= 0 ? text.slice(split + 1) : "", "base64");
  if (!bytes.length) throw new Error(`timed out reading ${full}`);
  return bytes;
}

function briefDetail(detail: string): string {
  const line = detail.replace(/\s+/g, " ").trim();
  if (line.startsWith("<!DOCTYPE") || line.startsWith("<html")) return "the music app returned an error page";
  return line.slice(0, 180);
}

async function watchForever(): Promise<void> {
  const initial = loadSyncConfig();
  await fs.mkdir(initial.folder, { recursive: true });
  let running = false;
  let quietUntil = 0;
  let failures = 0;
  let lastLog = "";
  const logOnce = (line: string) => {
    if (line === lastLog) return;
    lastLog = line;
    logLine(line);
  };
  const run = async () => {
    if (running || Date.now() < quietUntil) return;
    running = true;
    const stall = setTimeout(() => {
      logLine("[temp-music] sync stalled, restarting watcher");
      process.kill(process.pid, "SIGKILL");
    }, STALL_MS);
    try {
      let result: SyncResult;
      try {
        result = await syncTempMusicFolder(loadSyncConfig());
      } catch (err) {
        logOnce(`[temp-music] sync failed ${err instanceof Error ? err.message : "unexpected error"}`);
        failures = Math.min(8, failures + 1);
        quietUntil = Date.now() + Math.min(5 * 60 * 1000, 3000 * 2 ** failures);
        return;
      }
      if (!result.ok) {
        if (result.skipped === "busy") logOnce("[temp-music] waiting for a file to finish copying");
        else if (result.skipped === "unreachable") logOnce("[temp-music] music app is not reachable");
        else if (result.skipped === "missing-folder") logOnce("[temp-music] Desktop folder is missing");
        else logOnce(`[temp-music] sync rejected ${briefDetail(result.detail || "")}`);
        if (result.skipped === "unreachable" || result.skipped === "rejected") {
          failures = Math.min(8, failures + 1);
          quietUntil = Date.now() + Math.min(5 * 60 * 1000, 3000 * 2 ** failures);
        }
        return;
      }
      failures = 0;
      quietUntil = 0;
      if (result.unread?.length) logOnce(`[temp-music] left in place, could not read ${result.unread.join(", ")}`);
      if (result.added || result.updated || result.removed) {
        lastLog = "";
        logLine(`[temp-music] added ${result.added}, updated ${result.updated}, removed ${result.removed}`);
      }
    } finally {
      clearTimeout(stall);
      running = false;
    }
  };
  logLine(`[temp-music] watching ${initial.folder}`);
  setInterval(() => void run(), 3000);
  await run();
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  watchForever().catch((err) => {
    console.error("[temp-music] watcher stopped:", err);
    process.exit(1);
  });
}
