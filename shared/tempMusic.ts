export const TEMP_MUSIC_SLUG = "temp-music";
export const TEMP_MUSIC_TITLE = "Temp Music";
export const TEMP_MUSIC_FOLDER = "Temp Music";
export const TEMP_MUSIC_MAX_FILES = 200;
export const TEMP_MUSIC_MAX_BYTES = 80 * 1024 * 1024;

export type TempMusicFile = {
  name: string;
  size: number;
  sha256: string;
};

export type TempMusicPlan = {
  upload: string[];
  unchanged: string[];
  remove: string[];
};

export type FileSnap = {
  name: string;
  size: number;
  mtimeMs: number;
};

export function normalizeSyncName(name: string): string {
  return name.normalize("NFC").replace(/\\/g, "/").split("/").pop() || "";
}

export function isTempMusicFileName(name: string): boolean {
  if (!name || name !== normalizeSyncName(name)) return false;
  if (name.length > 180) return false;
  if (name.startsWith(".") || name.includes("\0")) return false;
  return name.toLowerCase().endsWith(".mp3");
}

export function compareSyncNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

export function validateSyncFiles(input: unknown): TempMusicFile[] | { error: string } {
  if (!Array.isArray(input)) return { error: "files must be a list" };
  if (input.length > TEMP_MUSIC_MAX_FILES) return { error: "Too many songs in Temp Music" };
  const seen = new Set<string>();
  const files: TempMusicFile[] = [];
  for (const item of input) {
    const record = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const name = normalizeSyncName(String(record.name || ""));
    const size = Number(record.size);
    const sha256 = String(record.sha256 || "").toLowerCase();
    if (!isTempMusicFileName(name)) return { error: "Only MP3 files can sync to Temp Music" };
    if (!Number.isInteger(size) || size < 1 || size > TEMP_MUSIC_MAX_BYTES) {
      return { error: `Cannot sync ${name}` };
    }
    if (!/^[a-f0-9]{64}$/.test(sha256)) return { error: `Cannot sync ${name}` };
    const key = name.toLowerCase();
    if (seen.has(key)) return { error: `Two files in Temp Music are named ${name}` };
    seen.add(key);
    files.push({ name, size, sha256 });
  }
  return files;
}

export function planTempMusicSync(
  current: Record<string, { sha256: string; size: number }>,
  desired: TempMusicFile[],
): TempMusicPlan {
  const wanted = new Set(desired.map((file) => file.name));
  const upload: string[] = [];
  const unchanged: string[] = [];
  for (const file of desired) {
    const prev = current[file.name];
    if (!prev || prev.sha256 !== file.sha256 || prev.size !== file.size) upload.push(file.name);
    else unchanged.push(file.name);
  }
  const remove = Object.keys(current)
    .filter((name) => !wanted.has(name))
    .sort(compareSyncNames);
  return { upload, unchanged, remove };
}

/** A file still being copied changes size or timestamp between the two looks. */
export function stableSnapshots(first: FileSnap[], second: FileSnap[]): { ready: boolean; files: FileSnap[] } {
  if (second.some((file) => file.size < 1)) return { ready: false, files: [] };
  if (first.length !== second.length) return { ready: false, files: [] };
  const before = new Map(first.map((file) => [file.name, file]));
  for (const file of second) {
    const prev = before.get(file.name);
    if (!prev || prev.size !== file.size || prev.mtimeMs !== file.mtimeMs) return { ready: false, files: [] };
  }
  return { ready: true, files: second };
}
