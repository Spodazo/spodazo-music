import fs from "fs";
import path from "path";
import sharp from "sharp";
import { dataDir, faviconDir, imagesDir, songsDir, uniqueFileName } from "./paths";

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

export const LIST_THUMB_WIDTH = 360;
export const HOME_CARD_WIDTH = 720;
export const COLLECTION_COVER_WIDTH = 1200;
const IMAGE_WIDTHS = new Set([LIST_THUMB_WIDTH, HOME_CARD_WIDTH, COLLECTION_COVER_WIDTH]);

export function imageUrl(filename: string, width?: number): string {
  if (!filename) return "";
  const params = new URLSearchParams({ v: assetVersion() });
  if (width && IMAGE_WIDTHS.has(width)) params.set("w", String(width));
  return `/media/images/${encodeURIComponent(filename)}?${params}`;
}

export function parseImageWidth(value: unknown): number | undefined {
  const width = Number(value);
  return IMAGE_WIDTHS.has(width) ? width : undefined;
}

export async function warmHomeCardImages(
  albums: Array<{ thumb?: string; heroPortrait?: string }>,
  extra: Array<string | undefined> = [],
): Promise<void> {
  const names = new Set<string>();
  for (const album of albums) {
    if (album.thumb) names.add(album.thumb);
    if (album.heroPortrait) names.add(album.heroPortrait);
  }
  for (const name of extra) {
    if (name) names.add(name);
  }
  await Promise.all(
    [...names].flatMap((name) =>
      [LIST_THUMB_WIDTH, HOME_CARD_WIDTH].map(async (width) => {
        const full = localImagePath(name);
        if (!full) return;
        try {
          await preparedImagePath(full, width);
        } catch {
          /* listing and boot must stay fast */
        }
      }),
    ),
  );
}

export async function preparedImagePath(full: string, width?: number): Promise<string> {
  if (!width || !fs.existsSync(full)) return full;
  const thumbs = path.join(dataDir(), "image-thumbs");
  fs.mkdirSync(thumbs, { recursive: true });
  const stamp = Math.round(fs.statSync(full).mtimeMs);
  const dest = path.join(
    thumbs,
    `${width}-${stamp}-${path.basename(full, path.extname(full))}.webp`,
  );
  if (fs.existsSync(dest) && fs.statSync(dest).size > 32) return dest;
  const tmp = `${dest}.tmp`;
  await sharp(full)
    .rotate()
    .resize(width, width, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 78 })
    .toFile(tmp);
  fs.renameSync(tmp, dest);
  return dest;
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
  const footer = (head[5] & 0x10) !== 0 ? 10 : 0;
  return 10 + size + footer;
}

function leadingTagSize(data: Buffer): number {
  let offset = 0;
  for (let i = 0; i < 4 && offset + 10 <= data.length; i += 1) {
    const size = id3v2Size(data.subarray(offset, offset + 10));
    if (!size || offset + size >= data.length - 128) break;
    offset += size;
  }
  return offset;
}

function apeTagSize(data: Buffer, end: number): number {
  if (end < 32) return 0;
  const foot = end - 32;
  if (data.subarray(foot, foot + 8).toString("ascii") !== "APETAGEX") return 0;
  const size = data.readUInt32LE(foot + 12);
  const flags = data.readUInt32LE(foot + 20);
  const hasHeader = (flags & 0x80000000) === 0 && (flags & 0x20000000) !== 0;
  const total = size + (hasHeader ? 32 : 0);
  return total > 32 && total < end ? total : 0;
}

function trailingTagSize(data: Buffer): number {
  let end = data.length;
  for (let i = 0; i < 4; i += 1) {
    const id3 = end >= 128 && data.subarray(end - 128, end - 125).toString("ascii") === "TAG" ? 128 : 0;
    const ape = apeTagSize(data, end);
    const extra = id3 || ape;
    if (!extra) break;
    end -= extra;
  }
  return data.length - end;
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

function mpegBitrate(data: Buffer, i: number): number {
  return BITRATE_MPEG1_L3[(data[i + 2] >> 4) & 0xf];
}

function mpegSampleRate(data: Buffer, i: number): number {
  const version = (data[i + 1] >> 3) & 3;
  return (version === 3 ? SAMPLE_MPEG1 : SAMPLE_MPEG2)[(data[i + 2] >> 2) & 3];
}

function mpegSamplesPerFrame(data: Buffer, i: number): number {
  const version = (data[i + 1] >> 3) & 3;
  return version === 3 ? 1152 : 576;
}

function xingSideInfo(data: Buffer, i: number): number {
  const version = (data[i + 1] >> 3) & 3;
  const channel = (data[i + 3] >> 6) & 3;
  return version === 3 ? (channel === 3 ? 21 : 36) : channel === 3 ? 13 : 21;
}

function xingFrameCount(frame: Buffer): number {
  const side = xingSideInfo(frame, 0);
  if (frame.length < side + 12) return 0;
  const tag = frame.subarray(side, side + 4).toString("ascii");
  if (tag !== "Xing" && tag !== "Info") return 0;
  const flags = frame.readUInt32BE(side + 4);
  if ((flags & 1) === 0) return 0;
  return frame.readUInt32BE(side + 8);
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 1) return "";
  const whole = Math.round(seconds);
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${String(whole % 60).padStart(2, "0")}`;
}

/** Length from Xing frame count, or CBR bitrate × file size. Reads the header only. */
export function mp3DurationSeconds(full: string): number {
  const fd = fs.openSync(full, "r");
  try {
    const fileSize = fs.fstatSync(fd).size;
    if (fileSize < 128) return 0;
    const head = Buffer.alloc(10);
    if (fs.readSync(fd, head, 0, 10, 0) < 10) return 0;
    const id3 = id3v2Size(head);
    const tailBuf = Buffer.alloc(128);
    const tail =
      fs.readSync(fd, tailBuf, 0, 128, fileSize - 128) === 128 && tailBuf.subarray(0, 3).toString("ascii") === "TAG"
        ? 128
        : 0;
    const audioEnd = fileSize - tail;
    if (id3 >= audioEnd) return 0;
    const probeLen = Math.min(2048, audioEnd - id3);
    const probe = Buffer.alloc(probeLen);
    if (fs.readSync(fd, probe, 0, probeLen, id3) < 4 || !isMpegFrame(probe, 0)) return 0;
    const sample = mpegSampleRate(probe, 0);
    const samples = mpegSamplesPerFrame(probe, 0);
    if (!sample || !samples) return 0;
    const frameLen = mpegFrameLength(probe, 0);
    if (frameLen && frameLen <= probe.length) {
      const frames = xingFrameCount(probe.subarray(0, frameLen));
      if (frames > 0) return (frames * samples) / sample;
    }
    const bitrate = mpegBitrate(probe, 0);
    const audioBytes = audioEnd - id3;
    if (!bitrate || audioBytes <= 0) return 0;
    return (audioBytes * 8) / (bitrate * 1000);
  } finally {
    fs.closeSync(fd);
  }
}

const durationCache = new Map<string, string>();

export function durationLabelForFile(filename: string): string {
  if (!filename) return "";
  const full = localSongPath(filename);
  if (!full) return "";
  const stat = fs.statSync(full);
  const key = `${full}:${stat.size}:${stat.mtimeMs}`;
  const cached = durationCache.get(key);
  if (cached !== undefined) return cached;
  let label = "";
  try {
    label = formatDuration(mp3DurationSeconds(full));
  } catch {
    label = "";
  }
  durationCache.set(key, label);
  return label;
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
    const fileSize = fs.fstatSync(fd).size;
    let offset = 0;
    for (let i = 0; i < 4; i += 1) {
      const head = Buffer.alloc(10);
      if (fs.readSync(fd, head, 0, 10, offset) < 10) break;
      const size = id3v2Size(head);
      if (!size || offset + size >= fileSize - 128) break;
      offset += size;
    }
    return offset;
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Strip ID3, APE, comment, and “where from” URL tags.
 * Restore Xing on VBR (Safari cannot decode Echoes-style files without it).
 * Remove Xing/Info from CBR — Safari plays those header frames as a scratch.
 */
export function prepareMp3(full: string): boolean {
  const data = fs.readFileSync(full);
  const id3 = leadingTagSize(data);
  const tail = trailingTagSize(data);
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

export const FAVICON_PNGS = [
  { name: "favicon-16x16.png", size: 16 },
  { name: "favicon-32x32.png", size: 32 },
  { name: "favicon-48x48.png", size: 48 },
  { name: "favicon-96x96.png", size: 96 },
  { name: "apple-touch-icon.png", size: 180 },
  { name: "android-chrome-192x192.png", size: 192 },
  { name: "android-chrome-512x512.png", size: 512 },
] as const;

export const FAVICON_PUBLIC_FILES = ["favicon.ico", ...FAVICON_PNGS.map((item) => item.name)] as const;

const ICO_PNG_SIZES = new Set([16, 32, 48]);

/** Pack PNG images into an ICO. Modern browsers and Windows accept PNG-encoded ICO entries. */
export function encodeIco(pngs: Buffer[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const entries = Buffer.alloc(16 * pngs.length);
  let offset = 6 + entries.length;
  const images: Buffer[] = [];
  pngs.forEach((png, index) => {
    const width = png.length >= 24 ? png.readUInt32BE(16) : 0;
    const height = png.length >= 24 ? png.readUInt32BE(20) : 0;
    const at = index * 16;
    entries.writeUInt8(width >= 256 ? 0 : width, at);
    entries.writeUInt8(height >= 256 ? 0 : height, at + 1);
    entries.writeUInt16LE(1, at + 4);
    entries.writeUInt16LE(32, at + 6);
    entries.writeUInt32LE(png.length, at + 8);
    entries.writeUInt32LE(offset, at + 12);
    images.push(png);
    offset += png.length;
  });
  return Buffer.concat([header, entries, ...images]);
}

export function faviconPublicPath(name: string): string | null {
  if (!FAVICON_PUBLIC_FILES.includes(name as (typeof FAVICON_PUBLIC_FILES)[number])) return null;
  const full = path.join(faviconDir(), name);
  return fs.existsSync(full) ? full : null;
}

export async function prepareFaviconSet(filename: string): Promise<string[]> {
  const source = filename ? path.join(imagesDir(), path.basename(filename)) : "";
  if (!source || !fs.existsSync(source) || fs.statSync(source).size < 32) {
    throw new Error("Favicon image not found");
  }
  const destDir = faviconDir();
  fs.mkdirSync(destDir, { recursive: true });
  const icoPngs: Buffer[] = [];
  for (const item of FAVICON_PNGS) {
    const png = await sharp(source)
      .rotate()
      .resize(item.size, item.size, { fit: "cover", position: "centre" })
      .png({ compressionLevel: 9 })
      .toBuffer();
    writeAtomic(path.join(destDir, item.name), png);
    if (ICO_PNG_SIZES.has(item.size)) icoPngs.push(png);
  }
  writeAtomic(path.join(destDir, "favicon.ico"), encodeIco(icoPngs));
  return [...FAVICON_PUBLIC_FILES];
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
