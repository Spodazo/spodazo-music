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

export function musicOrigin(): string {
  return (process.env.MUSIC_ORIGIN || "https://music.spodazo.com").replace(/\/$/, "");
}

export function safeFileName(name: string): string {
  return path.basename(name).replace(/[^a-zA-Z0-9._ ()|-]/g, "_");
}
