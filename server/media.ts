import fs from "fs";
import path from "path";
import sharp from "sharp";
import { imagesDir, songsDir, uniqueFileName } from "./paths";

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

export function trackDownloadName(track: { file?: string; title?: string }): string {
  const fromFile = path.basename(track.file || "");
  if (fromFile && /\.mp3$/i.test(fromFile)) return fromFile;
  const title = (track.title || "song").replace(/[/\\?%*:|"<>]/g, " ").trim() || "song";
  return `${title}.mp3`;
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

const BITRATE_MPEG1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const SAMPLE_MPEG1 = [44100, 48000, 32000, 0];
const SAMPLE_MPEG2 = [22050, 24000, 16000, 0];

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

export function mpegFrameLength(data: Buffer, i: number): number {
  if (!isMpegFrame(data, i)) return 0;
  const version = (data[i + 1] >> 3) & 3;
  const bitrate = BITRATE_MPEG1_L3[(data[i + 2] >> 4) & 0xf];
  const sample = (version === 3 ? SAMPLE_MPEG1 : SAMPLE_MPEG2)[(data[i + 2] >> 2) & 3];
  const pad = (data[i + 2] >> 1) & 1;
  if (!bitrate || !sample) return 0;
  return Math.floor(((version === 3 ? 144 : 72) * bitrate * 1000) / sample) + pad;
}

export function xingFrameLength(data: Buffer, start: number): number {
  const length = mpegFrameLength(data, start);
  if (!length || start + length > data.length) return 0;
  const frame = data.subarray(start, start + length);
  return frame.includes(Buffer.from("Xing")) || frame.includes(Buffer.from("Info")) ? length : 0;
}

function id3v1Size(data: Buffer): number {
  return data.length >= 128 && data.subarray(data.length - 128, data.length - 125).toString("ascii") === "TAG" ? 128 : 0;
}

function mpegBitrate(data: Buffer, i: number): number {
  return BITRATE_MPEG1_L3[(data[i + 2] >> 4) & 0xf];
}

function walkMpegFrames(data: Buffer, start: number, end: number): { offsets: number[]; bitrates: Set<number> } {
  const offsets: number[] = [];
  const bitrates = new Set<number>();
  let i = start;
  while (i + 4 <= end) {
    const length = mpegFrameLength(data, i);
    if (!length || i + length > end) break;
    offsets.push(i);
    bitrates.add(mpegBitrate(data, i));
    i += length;
  }
  return { offsets, bitrates };
}

export function isVbrMp3(data: Buffer, start = 0, end = data.length): boolean {
  return walkMpegFrames(data, start, end).bitrates.size > 1;
}

function writeAtomic(full: string, body: Buffer) {
  const tmp = `${full}.preparing`;
  fs.writeFileSync(tmp, body);
  try {
    fs.renameSync(tmp, full);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* already gone */
    }
    throw err;
  }
}

function buildXingFrame(audio: Buffer): Buffer {
  const version = (audio[1] >> 3) & 3;
  const sampleIndex = (audio[2] >> 2) & 3;
  const channel = (audio[3] >> 6) & 3;
  const sample = (version === 3 ? SAMPLE_MPEG1 : SAMPLE_MPEG2)[sampleIndex];
  const side = version === 3 ? (channel === 3 ? 21 : 36) : channel === 3 ? 13 : 21;
  const needed = side + 120;
  let bitrateIndex = 9;
  let length = 0;
  for (const index of [4, 5, 6, 7, 8, 9, 10]) {
    const bitrate = BITRATE_MPEG1_L3[index];
    if (!bitrate || !sample) continue;
    length = Math.floor(((version === 3 ? 144 : 72) * bitrate * 1000) / sample);
    if (length >= needed) {
      bitrateIndex = index;
      break;
    }
  }
  const frame = Buffer.alloc(length, 0);
  frame[0] = 0xff;
  frame[1] = 0xe0 | (version << 3) | (1 << 1) | 1;
  frame[2] = (bitrateIndex << 4) | (sampleIndex << 2);
  frame[3] = (channel << 6) | 0x10;
  frame.write("Xing", side);
  frame.writeUInt32BE(7, side + 4);
  const { offsets } = walkMpegFrames(audio, 0, audio.length);
  const bytes = length + audio.length;
  frame.writeUInt32BE(offsets.length + 1, side + 8);
  frame.writeUInt32BE(bytes, side + 12);
  for (let i = 0; i < 100; i += 1) {
    const at = offsets[Math.min(offsets.length - 1, Math.floor((i / 100) * offsets.length))] || 0;
    frame[side + 16 + i] = Math.min(255, Math.floor((256 * (length + at)) / bytes));
  }
  return frame;
}

/** Skip ID3v2 only — Safari needs the Xing map on VBR songs such as Echoes. */
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

/**
 * Strip ID3. Restore Xing on VBR (Safari cannot decode Echoes-style files without it).
 * Remove Xing/Info from CBR — Safari plays those header frames as a scratch.
 */
export function prepareMp3(full: string): boolean {
  const data = fs.readFileSync(full);
  const id3 = id3v2Size(data.subarray(0, Math.min(10, data.length)));
  const tail = id3v1Size(data);
  const end = data.length - tail;
  if (!isMpegFrame(data, id3) || end - id3 < 1024) return false;
  const xingLen = xingFrameLength(data, id3);
  const audioStart = id3 + xingLen;
  if (!isMpegFrame(data, audioStart) || end - audioStart < 1024) return false;
  const audio = data.subarray(audioStart, end);
  const vbr = isVbrMp3(audio);
  const body = vbr
    ? Buffer.concat([xingLen ? data.subarray(id3, audioStart) : buildXingFrame(audio), audio])
    : audio;
  if (body.length === data.length && body.equals(data)) return false;
  writeAtomic(full, body);
  return true;
}

export function stripMp3Tags(full: string): boolean {
  return prepareMp3(full);
}

export function shouldStripAudioUpload(file: {
  fieldname: string;
  mimetype: string;
  originalname: string;
}): boolean {
  return file.fieldname === "audio" || file.mimetype.startsWith("audio/") || /\.mp3$/i.test(file.originalname);
}

export function shouldConvertImageUpload(file: {
  fieldname: string;
  mimetype: string;
  originalname: string;
}): boolean {
  if (shouldStripAudioUpload(file)) return false;
  return file.mimetype.startsWith("image/") || /\.(jpe?g|png|gif|webp|tiff?|avif|bmp)$/i.test(file.originalname);
}

export async function convertUploadedImage(filename: string, dir = imagesDir()): Promise<string> {
  const source = path.join(dir, filename);
  const ext = path.extname(filename);
  const stem = ext ? filename.slice(0, -ext.length) : filename;
  const destName = ext.toLowerCase() === ".webp" ? filename : uniqueFileName(dir, `${stem}.webp`);
  const dest = path.join(dir, destName);
  const tmp = `${dest}.converting`;
  await sharp(source)
    .rotate()
    .resize(2400, 2400, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82 })
    .toFile(tmp);
  try {
    fs.renameSync(tmp, dest);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* already gone */
    }
    throw err;
  }
  if (dest !== source) fs.unlinkSync(source);
  return destName;
}

const RASTER_IMAGE = /\.(jpe?g|png|gif|tiff?|avif|bmp)$/i;
const SKIP_STORED_IMAGE = /^(favicon|apple-touch-icon)/i;

export async function convertStoredImages(dir = imagesDir()): Promise<Map<string, string>> {
  const renamed = new Map<string, string>();
  if (!fs.existsSync(dir)) return renamed;
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith(".") || SKIP_STORED_IMAGE.test(name) || !RASTER_IMAGE.test(name)) continue;
    try {
      const next = await convertUploadedImage(name, dir);
      if (next !== name) renamed.set(name, next);
      console.log(`[media] converted ${name} → ${next}`);
    } catch (err) {
      console.error(`[media] could not convert ${name}:`, err);
    }
  }
  return renamed;
}

export function stripUploadedSong(filename: string) {
  if (!filename) return;
  try {
    if (prepareMp3(path.join(songsDir(), filename))) {
      console.log(`[media] prepared upload ${filename}`);
    }
  } catch (err) {
    console.error(`[media] could not prepare ${filename}:`, err);
  }
}

export function stripStoredSongs(): number {
  const dir = songsDir();
  if (!fs.existsSync(dir)) return 0;
  let prepared = 0;
  for (const name of fs.readdirSync(dir)) {
    if (!name.toLowerCase().endsWith(".mp3")) continue;
    try {
      if (prepareMp3(path.join(dir, name))) prepared += 1;
    } catch (err) {
      console.error(`[media] could not prepare ${name}:`, err);
    }
  }
  if (prepared) console.log(`[media] prepared ${prepared} song${prepared === 1 ? "" : "s"}`);
  return prepared;
}
