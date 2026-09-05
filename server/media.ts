import fs from "fs";
import path from "path";
import { imagesDir, musicOrigin, songsDir } from "./paths";

function usableFile(full: string): string | null {
  if (!fs.existsSync(full)) return null;
  const size = fs.statSync(full).size;
  return size > 1024 ? full : null;
}

export function localImagePath(filename: string): string | null {
  if (!filename) return null;
  return usableFile(path.join(imagesDir(), filename));
}

export function localSongPath(filename: string): string | null {
  if (!filename) return null;
  return usableFile(path.join(songsDir(), filename));
}

export function imageUrl(filename: string): string {
  if (!filename) return "";
  if (localImagePath(filename)) {
    return `/media/images/${encodeURIComponent(filename)}`;
  }
  return `${musicOrigin()}/Images/${encodeURIComponent(filename).replace(/%20/g, "%20")}`;
}

export function audioUrl(filename: string): string {
  if (!filename) return "";
  if (localSongPath(filename)) {
    return `/media/songs/${encodeURIComponent(filename)}`;
  }
  return `${musicOrigin()}/Songs/${encodeURIComponent(filename).replace(/%20/g, "%20")}`;
}
