import { createHash } from "crypto";
import { appendFileSync, createReadStream, mkdirSync, readFileSync } from "fs";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import {
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
  | { ok: true; added: number; updated: number; removed: number }
  | { ok: false; skipped: "missing-folder" | "busy" | "unreachable" | "rejected"; detail?: string };

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

async function sha256File(full: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(full)
      .on("error", reject)
      .on("data", (chunk) => {
        hash.update(chunk);
      })
      .on("end", () => resolve(hash.digest("hex")));
  });
}

async function snapshot(dir: string): Promise<FileSnap[]> {
  const names = await fs.readdir(dir);
  const snaps: FileSnap[] = [];
  for (const raw of names) {
    const name = normalizeSyncName(raw);
    if (!isTempMusicFileName(name)) continue;
    const stat = await fs.stat(path.join(dir, raw));
    if (!stat.isFile()) continue;
    snaps.push({ name, size: stat.size, mtimeMs: stat.mtimeMs });
  }
  snaps.sort((a, b) => a.name.localeCompare(b.name));
  return snaps;
}

async function readFinishedFiles(dir: string, settleMs: number): Promise<TempMusicFile[] | "busy"> {
  const first = await snapshot(dir);
  await new Promise((resolve) => setTimeout(resolve, settleMs));
  const second = await snapshot(dir);
  const stable = stableSnapshots(first, second);
  if (!stable.ready) return "busy";
  const files: TempMusicFile[] = [];
  for (const snap of stable.files) {
    const full = path.join(dir, snap.name);
    const sha256 = await sha256File(full);
    const after = await fs.stat(full);
    if (after.size !== snap.size || after.mtimeMs !== snap.mtimeMs) return "busy";
    files.push({ name: snap.name, size: snap.size, sha256 });
  }
  return files;
}

export async function syncTempMusicFolder(config: SyncConfig): Promise<SyncResult> {
  try {
    const dirStat = await fs.stat(config.folder);
    if (!dirStat.isDirectory()) return { ok: false, skipped: "missing-folder" };
  } catch {
    return { ok: false, skipped: "missing-folder" };
  }
  const files = await readFinishedFiles(config.folder, config.settleMs ?? 500);
  if (files === "busy") return { ok: false, skipped: "busy" };
  const headers = {
    Authorization: `Bearer ${config.token}`,
    "Content-Type": "application/json",
  };
  let planRes: Response;
  try {
    planRes = await fetch(`${config.api}/api/sync/temp-music/plan`, {
      method: "POST",
      headers,
      body: JSON.stringify({ files }),
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
    const bytes = await fs.readFile(path.join(config.folder, name));
    const body = new FormData();
    body.append("audio", new Blob([bytes], { type: "audio/mpeg" }), name);
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
  let pruneRes: Response;
  try {
    pruneRes = await fetch(`${config.api}/api/sync/temp-music/prune`, {
      method: "POST",
      headers,
      body: JSON.stringify({ confirm: "mirror", files }),
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    return { ok: false, skipped: "unreachable" };
  }
  if (!pruneRes.ok) return { ok: false, skipped: "rejected", detail: await pruneRes.text() };
  const pruned = (await pruneRes.json()) as { removed?: string[] };
  return { ok: true, added, updated, removed: pruned.removed?.length || 0 };
}

async function watchForever(): Promise<void> {
  const initial = loadSyncConfig();
  await fs.mkdir(initial.folder, { recursive: true });
  let running = false;
  let again = false;
  let lastLog = "";
  const logOnce = (line: string) => {
    if (line === lastLog) return;
    lastLog = line;
    logLine(line);
  };
  const run = async () => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        const result = await syncTempMusicFolder(loadSyncConfig());
        if (!result.ok) {
          if (result.skipped === "busy") logOnce("[temp-music] waiting for a file to finish copying");
          else if (result.skipped === "unreachable") logOnce("[temp-music] music app is not reachable");
          else if (result.skipped === "missing-folder") logOnce("[temp-music] Desktop folder is missing");
          else logOnce(`[temp-music] sync rejected ${result.detail || ""}`);
          continue;
        }
        if (result.added || result.updated || result.removed) {
          const line = `[temp-music] added ${result.added}, updated ${result.updated}, removed ${result.removed}`;
          lastLog = "";
          logLine(line);
        }
      } while (again);
    } finally {
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
