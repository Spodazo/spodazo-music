import fs from "fs";
import path from "path";
import { imagesDir, songsDir } from "./paths";

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

export function assetVersion(): string {
  return process.env.BUILD_ID || process.env.RAILWAY_GIT_COMMIT_SHA || process.env.RAILWAY_DEPLOYMENT_ID || "dev";
}

export function imageUrl(filename: string): string {
  if (!filename) return "";
  return `/media/images/${encodeURIComponent(filename)}?v=${assetVersion()}`;
}

export function audioUrl(filename: string): string {
  if (!filename) return "";
  return `/media/songs/${encodeURIComponent(filename)}?v=${assetVersion()}`;
}

function id3v2Size(head: Buffer): number {
  if (head.length < 10 || head[0] !== 0x49 || head[1] !== 0x44 || head[2] !== 0x33) return 0;
  const size =
    ((head[6] & 0x7f) << 21) |
    ((head[7] & 0x7f) << 14) |
    ((head[8] & 0x7f) << 7) |
    (head[9] & 0x7f);
  return 10 + size;
}

export function isMpegFrame(data: Buffer, i: number): boolean {
  if (i + 3 >= data.length) return false;
  if (data[i] !== 0xff || (data[i + 1] & 0xe0) !== 0xe0) return false;
  const version = (data[i + 1] >> 3) & 3;
  const layer = (data[i + 1] >> 1) & 3;
  if (version === 1 || layer === 0) return false;
  const bitrate = (data[i + 2] >> 4) & 0xf;
  const sample = (data[i + 2] >> 2) & 3;
  return bitrate !== 0 && bitrate !== 0xf && sample !== 3;
}

export function mp3AudioRange(data: Buffer): { start: number; end: number } {
  const start = id3v2Size(data.subarray(0, 10));
  let end = data.length;
  if (end >= 128 && data.subarray(end - 128, end - 125).toString("ascii") === "TAG") {
    end -= 128;
  }
  return { start, end };
}

/** Skip ID3v2 so the player starts on a real MPEG frame, not artwork. */
export function mp3DataOffset(full: string): number {
  const fd = fs.openSync(full, "r");
  try {
    const head = Buffer.alloc(10);
    if (fs.readSync(fd, head, 0, 10, 0) < 10) return 0;
    const offset = id3v2Size(head);
    const fileSize = fs.fstatSync(fd).size;
    return offset > 0 && offset < fileSize - 128 ? offset : 0;
  } finally {
    fs.closeSync(fd);
  }
}

export function stripMp3Tags(full: string): boolean {
  const data = fs.readFileSync(full);
  const { start, end } = mp3AudioRange(data);
  if (start === 0 && end === data.length) return false;
  if (!isMpegFrame(data, start) || end - start < 1024) return false;
  const tmp = `${full}.stripping`;
  fs.writeFileSync(tmp, data.subarray(start, end));
  try {
    fs.renameSync(tmp, full);
  } catch (err) {
    fs.unlinkSync(tmp);
    throw err;
  }
  return true;
}

export function shouldStripAudioUpload(file: {
  fieldname: string;
  mimetype: string;
  originalname: string;
}): boolean {
  return file.fieldname === "audio" || file.mimetype.startsWith("audio/") || /\.mp3$/i.test(file.originalname);
}

export function stripUploadedSong(filename: string) {
  if (!filename) return;
  try {
    stripMp3Tags(path.join(songsDir(), filename));
  } catch (err) {
    console.error(`[media] could not strip ${filename}:`, err);
  }
}

export function stripStoredSongs(): number {
  const dir = songsDir();
  if (!fs.existsSync(dir)) return 0;
  let stripped = 0;
  for (const name of fs.readdirSync(dir)) {
    if (!name.toLowerCase().endsWith(".mp3")) continue;
    try {
      if (stripMp3Tags(path.join(dir, name))) stripped += 1;
    } catch (err) {
      console.error(`[media] could not strip ${name}:`, err);
    }
  }
  if (stripped) console.log(`[media] stripped ID3 tags from ${stripped} song${stripped === 1 ? "" : "s"}`);
  return stripped;
}
