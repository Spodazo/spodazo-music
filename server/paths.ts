import fs from "fs";
import path from "path";

export function dataDir(): string {
  return process.env.MUSIC_DATA_DIR || path.resolve(process.cwd(), ".music-data");
}

export function imagesDir(): string {
  return path.join(dataDir(), "images");
}

export function songsDir(): string {
  return path.join(dataDir(), "songs");
}

export function catalogPath(): string {
  return path.join(dataDir(), "catalog.json");
}

export function ensureDataDirs(): void {
  for (const dir of [dataDir(), imagesDir(), songsDir()]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function syncBundledImages(): void {
  const srcDir = path.resolve(process.cwd(), "media/images");
  if (!fs.existsSync(srcDir)) return;
  ensureDataDirs();
  for (const name of fs.readdirSync(srcDir)) {
    if (name.startsWith(".")) continue;
    fs.copyFileSync(path.join(srcDir, name), path.join(imagesDir(), name));
  }
}

export function musicOrigin(): string {
  return (process.env.MUSIC_ORIGIN || "https://music.spodazo.com").replace(/\/$/, "");
}

export function safeFileName(name: string): string {
  return path.basename(name).replace(/[^a-zA-Z0-9._ ()|-]/g, "_");
}

export function uniqueFileName(dir: string, original: string): string {
  const safe = safeFileName(original);
  let name = safe;
  let i = 2;
  while (fs.existsSync(path.join(dir, name))) {
    const ext = path.extname(safe);
    const stem = ext ? safe.slice(0, -ext.length) : safe;
    name = `${stem}-${i++}${ext}`;
  }
  return name;
}
