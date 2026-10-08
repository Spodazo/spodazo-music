/**
 * Echoes of Storms songbook: Canva cover/index/forward/back + song pages (intro + lyrics).
 * Index song titles link to the matching song inside this PDF; QR codes link to the player.
 *
 * Usage: npx tsx script/export-echoes-songbook.ts [outputDir]
 */

import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import PDFDocument from "pdfkit";
import { PDFDocument as PDFLibDocument, PDFName, PDFArray } from "pdf-lib";
import QRCode from "qrcode";
import sharp from "sharp";
import type { PublicAlbum, PublicTrack } from "../shared/types";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(HERE, "assets", "songbook");
const ECHOES_TEMPLATES = path.join(ASSETS, "echoes");
const COVER_OVERRIDE_DIR = path.join(ECHOES_TEMPLATES, "covers");
const FONTS = path.join(ASSETS, "fonts");
const QR_CACHE = path.join(ASSETS, "qrs-echoes");
const LOGO_FILE = path.join(HERE, "assets", "spodazo-music-qr-logo.png");
const BASE_URL = (process.env.SPODAZO_BASE_URL || "https://spodazomusic.com").replace(/\/$/, "");
const ALBUM_SLUG = "echoes-of-storms";

const PAGE_W = 595.44;
const PAGE_H = 842.16;
/** 10 mm vertical margin for lyric areas */
const LYRIC_MARGIN_V = (72 * 10) / 25.4;
const BOTTOM_MARGIN = LYRIC_MARGIN_V;
const LYRIC_MAX_SIZE = 14;
const LYRIC_MIN_SIZE = 5.5;
const INTRO_MIN_SIZE = 6;
const LYRIC_COL_MARGIN_X = 34;
const LYRIC_COL_GUTTER = 14;
const WOOD_H = PAGE_W * (843 / 1191);
const COVER_SIZE = 352;
const COVER_Y = 36;
const COVER_X = (PAGE_W - COVER_SIZE) / 2;
const MARGIN_X = 58;
const TEXT_W = PAGE_W - MARGIN_X * 2;
const TEXT_TOP = WOOD_H + 22;
const LOGO_W = 96;
const QR_PT = 88 * 0.9;
const BODY_SIZE = 14;
const SONG_TITLE_SIZE = 24;
const SONG_SUBTITLE_SIZE = 14;
const TITLE_AFTER_GAP = 4;
const SUBTITLE_AFTER_GAP = 10;
const NO_SUBTITLE_AFTER_TITLE_GAP = 12;
const LYRICS_LABEL_AFTER_GAP = 10;
const INK = "#F5F7FA";
const INK_SOFT = "#D7E0EA";
const SECTION_HEAD_SIZE = 16;
const QR_SIZE = 1200;
const LOGO_WIDTH_RATIO = 0.36;
const LOGO_PAD = 14;
const LOGO_RADIUS = 22;

/** First page of each song in the merged book (0-based), before songs are appended. */
const SONG_SECTION_START = 3;

const BOOK =
  "(?:Genesis|Exodus|Leviticus|Numbers|Deuteronomy|Joshua|Judges|Ruth|(?:1|2|I|II)?\\s*Samuel|(?:1|2|I|II)?\\s*Kings|(?:1|2|I|II)?\\s*Chronicles|Ezra|Nehemiah|Esther|Job|Psalm|Psalms|Proverbs|Ecclesiastes|Song of Solomon|Isaiah|Jeremiah|Lamentations|Ezekiel|Daniel|Hosea|Joel|Amos|Obadiah|Jonah|Micah|Nahum|Habakkuk|Zephaniah|Haggai|Zechariah|Malachi|Matthew|Mark|Luke|John|Acts|Romans|(?:1|2|I|II)?\\s*Corinthians|Galatians|Galations|Ephesians|Philippians|Colossians|(?:1|2|I|II)?\\s*Thessalonians|(?:1|2|I|II)?\\s*Timothy|Titus|Philemon|Hebrews|James|(?:1|2|I|II)?\\s*Peter|(?:1|2|I|II|III)?\\s*John|Jude|Revelation)";
const SCRIPTURE_REF_LINE = new RegExp(
  `^${BOOK}(?:\\s+\\d+)?(?:\\s*[:.]\\s*[\\d\\s,\\-–—]+)?$`,
  "i",
);
const SECTION_LINE =
  /^\[?\s*((?:Verse|Chorus|Refrain|Bridge|Spoken Word|Instrumental)\b[^\]\n]*)\]?\s*$/i;

/** Song list on Page 2.pdf (points, top-left origin). */
const SONG_LINK_BOXES: { n: number; x: number; y: number; w: number; h: number }[] = [
  { n: 1, x: 56, y: 262.5, w: 483, h: 18 },
  { n: 2, x: 56, y: 289.8, w: 483, h: 18 },
  { n: 3, x: 56, y: 317.2, w: 483, h: 18 },
  { n: 4, x: 56, y: 343.9, w: 483, h: 18 },
  { n: 5, x: 56, y: 371.3, w: 483, h: 18 },
  { n: 6, x: 56, y: 397.9, w: 483, h: 18 },
  { n: 7, x: 56, y: 425.3, w: 483, h: 18 },
  { n: 8, x: 56, y: 452.7, w: 483, h: 18 },
  { n: 9, x: 56, y: 478.6, w: 483, h: 18 },
  { n: 10, x: 56, y: 506.7, w: 483, h: 18 },
  { n: 11, x: 56, y: 534.1, w: 483, h: 18 },
  { n: 12, x: 56, y: 560.0, w: 483, h: 18 },
];

/** Album QR on Page 2 (listen to full album). */
const ALBUM_QR_LINK = { x: 468, y: 668, w: 92, h: 92 };

type PdfDoc = InstanceType<typeof PDFDocument>;
type LyricBlock = { kind: "section" | "line" | "blank"; text: string };
type IntroBit = { kind: "heading" | "ref" | "body"; text: string };

function normalizeText(text: string): string {
  return text
    .replace(/\u2028/g, "\n")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function songListenUrl(track: PublicTrack): string {
  const slug = track.slug || safeName(track);
  return `${BASE_URL}/${ALBUM_SLUG}#${encodeURIComponent(slug)}`;
}

function safeName(track: PublicTrack): string {
  const base = `${String(track.n).padStart(2, "0")}-${track.slug || track.title}`;
  return base
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 120);
}

function pagesForTrack(track: PublicTrack): number {
  return track.instrumental ? 1 : 2;
}

function songStartPageIndex(tracks: PublicTrack[], trackNumber: number): number {
  let idx = SONG_SECTION_START;
  for (const track of tracks) {
    if (track.n === trackNumber) return idx;
    idx += pagesForTrack(track);
  }
  throw new Error(`No track number ${trackNumber}`);
}

function logoHeight(): number {
  return 254 / (607 / LOGO_W);
}

function logoTop(): number {
  return PAGE_H - BOTTOM_MARGIN - logoHeight();
}

function qrTop(): number {
  return PAGE_H - BOTTOM_MARGIN - 12 - QR_PT;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json() as Promise<T>;
}

async function fetchPng(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return sharp(Buffer.from(await res.arrayBuffer())).png().toBuffer();
}

/** Gap below the wood cover strip before song title (5 mm). */
const COVER_BACKGROUND_GAP = (72 * 5) / 25.4;

function belowCoverBackgroundY(): number {
  return WOOD_H + COVER_BACKGROUND_GAP;
}

/** Lowest Y for lyric text on pages that also show the QR code (bottom-right). */
function lyricsFloorWithQr(): number {
  return qrTop() - 6;
}

async function loadCover(track: PublicTrack, imageUrl: string): Promise<Buffer | null> {
  const override = path.join(COVER_OVERRIDE_DIR, `${track.slug}.webp`);
  let raw: Buffer | null = null;
  if (fs.existsSync(override)) {
    raw = await sharp(override).png().toBuffer();
  } else if (imageUrl) {
    const name = decodeURIComponent((imageUrl.split("?")[0].split("/").pop() || "").trim());
    const local = name ? path.join(process.cwd(), "media", "images", name) : "";
    raw = local && fs.existsSync(local)
      ? await sharp(local).png().toBuffer()
      : await fetchPng(imageUrl.startsWith("http") ? imageUrl : `${BASE_URL}${imageUrl.split("?")[0]}`);
  }
  if (!raw) return null;
  return sharp(raw)
    .resize(1400, 1400, { fit: "cover", position: "centre" })
    .jpeg({ quality: 82 })
    .toBuffer();
}

async function roundedPng(input: Buffer, width: number, height: number, radius: number): Promise<Buffer> {
  const mask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
      `<rect x="0" y="0" width="${width}" height="${height}" rx="${radius}" ry="${radius}" fill="#fff"/>` +
      `</svg>`,
  );
  return sharp(input)
    .resize(width, height)
    .composite([{ input: mask, blend: "dest-in" }])
    .png()
    .toBuffer();
}

async function logoPlate(logoRaw: Buffer): Promise<Buffer> {
  const logoWidth = Math.round(QR_SIZE * LOGO_WIDTH_RATIO);
  const meta = await sharp(logoRaw).metadata();
  const logoHeightPx = Math.round(logoWidth * ((meta.height || 1) / (meta.width || 1)));
  const innerRadius = Math.max(8, LOGO_RADIUS - 8);
  const logo = await roundedPng(logoRaw, logoWidth, logoHeightPx, innerRadius);
  const w = logoWidth + LOGO_PAD * 2;
  const h = logoHeightPx + LOGO_PAD * 2;
  const plate = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
      `<rect x="0" y="0" width="${w}" height="${h}" rx="${LOGO_RADIUS}" ry="${LOGO_RADIUS}" fill="#ffffff"/>` +
      `</svg>`,
  );
  return sharp(plate)
    .composite([{ input: logo, top: LOGO_PAD, left: LOGO_PAD }])
    .png()
    .toBuffer();
}

async function makeQrPng(url: string, plate: Buffer): Promise<Buffer> {
  const qr = await QRCode.toBuffer(url, {
    type: "png",
    width: QR_SIZE,
    margin: 2,
    errorCorrectionLevel: "H",
    color: { dark: "#111111", light: "#FFFFFF" },
  });
  return sharp(qr).composite([{ input: plate, gravity: "centre" }]).png().toBuffer();
}

async function loadQr(track: PublicTrack, plate: Buffer): Promise<Buffer> {
  fs.mkdirSync(QR_CACHE, { recursive: true });
  const file = path.join(QR_CACHE, `${safeName(track)}.png`);
  if (fs.existsSync(file)) return fs.readFileSync(file);
  const png = await makeQrPng(songListenUrl(track), plate);
  fs.writeFileSync(file, png);
  return png;
}

function parseIntro(raw: string): IntroBit[] {
  const text = normalizeText(raw);
  const bits: IntroBit[] = [];
  if (!text) return bits;
  let body = text;
  if (/^TRIBUTE\b/i.test(body)) {
    bits.push({ kind: "heading", text: "Tribute" });
    body = body.replace(/^TRIBUTE\s*/i, "").trim();
  }
  const lines = body.split("\n");
  let bucket: string[] = [];
  const flushBody = () => {
    const para = bucket.join("\n").trim();
    bucket = [];
    if (para) bits.push({ kind: "body", text: para });
  };
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && SCRIPTURE_REF_LINE.test(trimmed)) {
      flushBody();
      bits.push({ kind: "ref", text: trimmed });
      continue;
    }
    bucket.push(line);
  }
  flushBody();
  return bits;
}

function parseLyrics(raw: string): LyricBlock[] {
  const text = normalizeText(raw);
  if (!text || /^lyrics can be added/i.test(text)) return [];
  const blocks: LyricBlock[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || /^[-–—"'“”]+$/.test(trimmed) || !/[A-Za-z0-9]/.test(trimmed)) continue;
    const section = trimmed.match(SECTION_LINE);
    if (section) {
      if (blocks.length) blocks.push({ kind: "blank", text: "" });
      blocks.push({
        kind: "section",
        text: section[1].replace(/\s+/g, " ").replace(/^\[|\]$/g, "").trim(),
      });
      continue;
    }
    blocks.push({ kind: "line", text: trimmed });
  }
  return blocks;
}

function registerFonts(doc: PdfDoc): void {
  doc.registerFont("Playfair", path.join(FONTS, "PlayfairDisplay-Regular.ttf"));
  doc.registerFont("Playfair-Italic", path.join(FONTS, "PlayfairDisplay-Italic.ttf"));
  doc.registerFont("Playfair-SemiBold", path.join(FONTS, "PlayfairDisplay-SemiBold.ttf"));
  doc.registerFont("Playfair-Bold", path.join(FONTS, "PlayfairDisplay-Bold.ttf"));
  doc.registerFont("Montserrat-Light", path.join(FONTS, "Montserrat-Light.ttf"));
  doc.registerFont("Montserrat", path.join(FONTS, "Montserrat-Regular.ttf"));
  doc.registerFont("Montserrat-Italic", path.join(FONTS, "Montserrat-Italic.ttf"));
  doc.registerFont("Montserrat-Medium", path.join(FONTS, "Montserrat-Medium.ttf"));
  doc.registerFont("Montserrat-SemiBold", path.join(FONTS, "Montserrat-SemiBold.ttf"));
}

function paintBrown(doc: PdfDoc, brown: Buffer): void {
  doc.image(brown, 0, 0, { width: PAGE_W, height: PAGE_H });
}

function paintWood(doc: PdfDoc, wood: Buffer): void {
  doc.image(wood, 0, 0, { width: PAGE_W, height: WOOD_H });
}

function paintLogo(doc: PdfDoc, logo: Buffer): void {
  doc.image(logo, 42, logoTop(), { width: LOGO_W });
}

function coverShadow(doc: PdfDoc): void {
  doc.save();
  doc.fillColor("#000000").fillOpacity(0.28);
  doc.rect(COVER_X + 3, COVER_Y + 4, COVER_SIZE, COVER_SIZE).fill();
  doc.restore();
}

function paintQr(doc: PdfDoc, qr: Buffer): void {
  const qrX = PAGE_W - BOTTOM_MARGIN - QR_PT;
  const qrY = qrTop();
  doc.save();
  doc.fillColor("#ffffff");
  doc.roundedRect(qrX - 4, qrY - 4, QR_PT + 8, QR_PT + 8, 3).fill();
  doc.restore();
  doc.image(qr, qrX, qrY, { width: QR_PT, height: QR_PT });
  doc.font("Montserrat").fontSize(7.5).fillColor(INK_SOFT).text("Scan to listen", qrX - 12, qrY + QR_PT + 3, {
    width: QR_PT + 24,
    align: "center",
  });
}

function introMetrics(size: number) {
  return {
    headGap: 10,
    refBefore: 8,
    refAfter: 3,
    bodyAfter: 10,
    bodyLine: size * 0.35,
  };
}

function measureIntro(doc: PdfDoc, bits: IntroBit[], size: number): number {
  const m = introMetrics(size);
  let h = 0;
  for (const bit of bits) {
    if (bit.kind === "heading") {
      doc.font("Playfair").fontSize(SECTION_HEAD_SIZE);
      h += doc.heightOfString(bit.text, { width: TEXT_W, lineGap: 2 }) + m.headGap;
    } else if (bit.kind === "ref") {
      h += m.refBefore;
      doc.font("Playfair").fontSize(size);
      h += doc.heightOfString(bit.text, { width: TEXT_W, lineGap: 1 }) + m.refAfter;
    } else {
      doc.font("Montserrat-Light").fontSize(size);
      h += doc.heightOfString(bit.text, { width: TEXT_W, lineGap: m.bodyLine }) + m.bodyAfter;
    }
  }
  return h;
}

function paintIntro(doc: PdfDoc, bits: IntroBit[], size: number, startY: number): void {
  const m = introMetrics(size);
  let y = startY;
  for (const bit of bits) {
    if (bit.kind === "heading") {
      doc.font("Playfair").fontSize(SECTION_HEAD_SIZE).fillColor(INK).text(bit.text, MARGIN_X, y, {
        width: TEXT_W,
        lineGap: 2,
      });
      y = doc.y + m.headGap;
    } else if (bit.kind === "ref") {
      y += m.refBefore;
      doc.font("Playfair").fontSize(size).fillColor(INK).text(bit.text, MARGIN_X, y, {
        width: TEXT_W,
        lineGap: 1,
      });
      y = doc.y + m.refAfter;
    } else {
      doc.font("Montserrat-Light").fontSize(size).fillColor(INK).text(bit.text, MARGIN_X, y, {
        width: TEXT_W,
        lineGap: m.bodyLine,
        align: "left",
      });
      y = doc.y + m.bodyAfter;
    }
  }
}

function lyricLineGap(size: number): number {
  if (size <= 8) return Math.max(0.6, size * 0.2);
  return Math.max(1.0, size * 0.26);
}

function measureOneBlock(doc: PdfDoc, block: LyricBlock, size: number, width: number): number {
  const gap = lyricLineGap(size);
  if (block.kind === "blank") return size * 0.7;
  if (block.kind === "section") {
    doc.font("Playfair").fontSize(size);
    return doc.heightOfString(block.text, { width, lineGap: 1 }) + size * 0.35;
  }
  doc.font("Montserrat-Light").fontSize(size);
  return doc.heightOfString(block.text, { width, lineGap: gap });
}

function measureLyrics(doc: PdfDoc, blocks: LyricBlock[], size: number, width: number): number {
  let h = 0;
  for (const block of blocks) {
    h += measureOneBlock(doc, block, size, width);
  }
  return h;
}

function paintLyrics(doc: PdfDoc, blocks: LyricBlock[], size: number, x: number, y: number, width: number): void {
  const gap = lyricLineGap(size);
  let cursor = y;
  for (const block of blocks) {
    if (block.kind === "blank") {
      cursor += size * 0.7;
      continue;
    }
    if (block.kind === "section") {
      doc.font("Playfair").fontSize(size).fillColor(INK).text(block.text, x, cursor, { width, lineGap: 1 });
      cursor = doc.y + size * 0.35;
    } else {
      doc.font("Montserrat-Light").fontSize(size).fillColor(INK).text(block.text, x, cursor, { width, lineGap: gap });
      cursor = doc.y;
    }
  }
}

function fitBodySize(measure: (size: number) => number, available: number, maxSize = BODY_SIZE): number {
  const cap = Math.min(maxSize, BODY_SIZE);
  if (measure(cap) <= available) return cap;
  for (let s = cap - 0.5; s >= 8; s -= 0.5) {
    if (measure(s) <= available) return s;
  }
  return 8;
}

function fitLyricSize(measure: (size: number) => number, available: number): number {
  const cap = LYRIC_MAX_SIZE;
  if (measure(cap) <= available) return cap;
  for (let s = cap - 0.5; s >= LYRIC_MIN_SIZE; s -= 0.5) {
    if (measure(s) <= available) return s;
  }
  return LYRIC_MIN_SIZE;
}

function fitIntroSize(measure: (size: number) => number, available: number): number {
  const cap = BODY_SIZE;
  if (measure(cap) <= available) return cap;
  for (let s = cap - 0.5; s >= INTRO_MIN_SIZE; s -= 0.5) {
    if (measure(s) <= available) return s;
  }
  return INTRO_MIN_SIZE;
}

/** Group lyrics into stanzas (verse/chorus/bridge blocks stay together). */
function groupLyricStanzas(blocks: LyricBlock[]): LyricBlock[][] {
  if (!blocks.length) return [];
  const stanzas: LyricBlock[][] = [];
  let current: LyricBlock[] = [];
  for (const block of blocks) {
    if (block.kind === "section" && current.length > 0) {
      stanzas.push(current);
      current = [];
    }
    current.push(block);
  }
  if (current.length) stanzas.push(current);
  return stanzas;
}

function flattenStanzas(stanzas: LyricBlock[][]): LyricBlock[] {
  return stanzas.flat();
}

function measureStanza(doc: PdfDoc, stanza: LyricBlock[], size: number, width: number): number {
  return measureLyrics(doc, stanza, size, width);
}

function splitStanzasByMaxHeight(
  doc: PdfDoc,
  stanzas: LyricBlock[][],
  size: number,
  width: number,
  maxHeight: number,
): { head: LyricBlock[]; tail: LyricBlock[] } {
  let h = 0;
  let count = 0;
  for (let i = 0; i < stanzas.length; i++) {
    const stanzaH = measureStanza(doc, stanzas[i], size, width);
    if (h + stanzaH > maxHeight && count > 0) break;
    h += stanzaH;
    count = i + 1;
  }
  if (count === 0 && stanzas.length) count = 1;
  return {
    head: flattenStanzas(stanzas.slice(0, count)),
    tail: flattenStanzas(stanzas.slice(count)),
  };
}

function stanzaSplitCandidates(stanzaCount: number): number[] {
  if (stanzaCount <= 1) return [1];
  const splits: number[] = [];
  for (let k = 1; k < stanzaCount; k++) splits.push(k);
  splits.sort((a, b) => {
    const balanceA = Math.abs(a - (stanzaCount - a));
    const balanceB = Math.abs(b - (stanzaCount - b));
    if (balanceA !== balanceB) return balanceA - balanceB;
    return Math.abs(a - Math.ceil(stanzaCount / 2)) - Math.abs(b - Math.ceil(stanzaCount / 2));
  });
  return splits;
}

/** Split at stanza boundaries, preferring equal verse counts in each column. */
function balanceStanzaColumns(
  doc: PdfDoc,
  stanzas: LyricBlock[][],
  size: number,
  colWidth: number,
  availLeft: number,
  availRight: number,
  col2X: number,
): [LyricBlock[], LyricBlock[]] {
  const n = stanzas.length;
  if (n <= 1) {
    return [flattenStanzas(stanzas), []];
  }

  for (const k of stanzaSplitCandidates(n)) {
    const col1 = flattenStanzas(stanzas.slice(0, k));
    const col2 = flattenStanzas(stanzas.slice(k));
    if (columnsFit(doc, col1, col2, size, colWidth, col2X, availLeft, availRight)) {
      return [col1, col2];
    }
  }

  const k = stanzaSplitCandidates(n)[0] ?? Math.ceil(n / 2);
  return [flattenStanzas(stanzas.slice(0, k)), flattenStanzas(stanzas.slice(k))];
}

function columnOverlapsQr(colX: number, colWidth: number): boolean {
  const qrX = PAGE_W - BOTTOM_MARGIN - QR_PT - 4;
  return colX + colWidth > qrX;
}

function measureSongTitleBlockEnd(doc: PdfDoc, track: PublicTrack, y: number): number {
  doc.font("Playfair").fontSize(SONG_TITLE_SIZE);
  let cursor = y + doc.heightOfString(track.title, { width: TEXT_W, align: "center" }) + TITLE_AFTER_GAP;
  const scripture = (track.scripture || "").trim();
  if (scripture) {
    doc.font("Montserrat").fontSize(SONG_SUBTITLE_SIZE);
    cursor += doc.heightOfString(scripture, { width: TEXT_W, align: "center" }) + SUBTITLE_AFTER_GAP;
  } else {
    cursor += NO_SUBTITLE_AFTER_TITLE_GAP;
  }
  return cursor;
}

function paintSongTitleBlock(doc: PdfDoc, track: PublicTrack, y: number): number {
  doc.font("Playfair").fontSize(SONG_TITLE_SIZE).fillColor(INK).text(track.title, MARGIN_X, y, {
    width: TEXT_W,
    align: "center",
  });
  y = doc.y + TITLE_AFTER_GAP;
  const scripture = (track.scripture || "").trim();
  if (scripture) {
    doc.font("Montserrat").fontSize(SONG_SUBTITLE_SIZE).fillColor(INK_SOFT).text(scripture, MARGIN_X, y, {
      width: TEXT_W,
      align: "center",
    });
    y = doc.y + SUBTITLE_AFTER_GAP;
  } else {
    y += NO_SUBTITLE_AFTER_TITLE_GAP;
  }
  return y;
}

function measureLyricsLabelEnd(doc: PdfDoc, y: number): number {
  doc.font("Playfair").fontSize(SECTION_HEAD_SIZE);
  return y + doc.heightOfString("Lyrics", { width: TEXT_W }) + LYRICS_LABEL_AFTER_GAP;
}

function paintLyricsLabel(doc: PdfDoc, y: number): number {
  doc.font("Playfair").fontSize(SECTION_HEAD_SIZE).fillColor(INK).text("Lyrics", MARGIN_X, y, { width: TEXT_W });
  return doc.y + LYRICS_LABEL_AFTER_GAP;
}

function spreadPage1LyricsStart(doc: PdfDoc, track: PublicTrack): number {
  const afterTitle = measureSongTitleBlockEnd(doc, track, belowCoverBackgroundY());
  return measureLyricsLabelEnd(doc, afterTitle);
}

function textFloor(): number {
  return PAGE_H - BOTTOM_MARGIN;
}

function drawFittedIntro(doc: PdfDoc, bits: IntroBit[], startY: number, floorY: number): void {
  const available = Math.max(24, floorY - startY);
  const size = fitIntroSize((s) => measureIntro(doc, bits, s), available);
  paintIntro(doc, bits, size, startY);
}

function twoColumnLayout(y: number) {
  const margin = LYRIC_COL_MARGIN_X;
  const totalW = PAGE_W - margin * 2;
  const colW = (totalW - LYRIC_COL_GUTTER) / 2;
  const col1X = margin;
  const col2X = margin + colW + LYRIC_COL_GUTTER;
  const availLeft = Math.max(32, PAGE_H - LYRIC_MARGIN_V - y);
  const availRight = Math.max(32, lyricsFloorWithQr() - y);
  return { colW, col1X, col2X, availLeft, availRight };
}

function columnsFit(
  doc: PdfDoc,
  col1: LyricBlock[],
  col2: LyricBlock[],
  size: number,
  colW: number,
  col2X: number,
  availLeft: number,
  availRight: number,
): boolean {
  const h1 = measureLyrics(doc, col1, size, colW);
  const h2 = measureLyrics(doc, col2, size, colW);
  const rightLimit = columnOverlapsQr(col2X, colW) ? availRight : availLeft;
  return h1 <= availLeft && h2 <= rightLimit;
}

function fitAllStanzasTwoColumn(
  doc: PdfDoc,
  stanzas: LyricBlock[][],
  lyricsY: number,
): { lyricSize: number; col1: LyricBlock[]; col2: LyricBlock[] } {
  const { colW, col2X, availLeft, availRight } = twoColumnLayout(lyricsY);
  let best = {
    lyricSize: LYRIC_MIN_SIZE,
    col1: flattenStanzas(stanzas),
    col2: [] as LyricBlock[],
  };
  for (let size = LYRIC_MAX_SIZE; size >= LYRIC_MIN_SIZE; size -= 0.5) {
    const [col1, col2] = balanceStanzaColumns(doc, stanzas, size, colW, availLeft, availRight, col2X);
    if (columnsFit(doc, col1, col2, size, colW, col2X, availLeft, availRight)) {
      return { lyricSize: size, col1, col2 };
    }
    best = { lyricSize: size, col1, col2 };
  }
  return best;
}

function drawLyricsTwoColumnPage(
  doc: PdfDoc,
  blocks: LyricBlock[],
  brown: Buffer,
  qr: Buffer,
): void {
  const stanzas = groupLyricStanzas(blocks);
  paintBrown(doc, brown);
  const labelEnd = measureLyricsLabelEnd(doc, LYRIC_MARGIN_V);
  const fit = fitAllStanzasTwoColumn(doc, stanzas, labelEnd);
  const lyricsY = paintLyricsLabel(doc, LYRIC_MARGIN_V);
  const { col1X, col2X, colW } = twoColumnLayout(lyricsY);
  paintLyrics(doc, fit.col1, fit.lyricSize, col1X, lyricsY, colW);
  paintLyrics(doc, fit.col2, fit.lyricSize, col2X, lyricsY, colW);
  paintQr(doc, qr);
}

type SpreadFit = {
  lyricSize: number;
  lyricsStartY: number;
  head: LyricBlock[];
  tail: LyricBlock[];
};

function fitSpreadTwoPages(doc: PdfDoc, track: PublicTrack, stanzas: LyricBlock[][]): SpreadFit {
  const lyricsStartY = spreadPage1LyricsStart(doc, track);
  const page2Avail = Math.max(24, lyricsFloorWithQr() - LYRIC_MARGIN_V);
  const page1Avail = Math.max(24, PAGE_H - LYRIC_MARGIN_V - lyricsStartY);
  const page1WithQr = Math.max(24, lyricsFloorWithQr() - lyricsStartY);
  let fallback: SpreadFit = {
    lyricSize: LYRIC_MIN_SIZE,
    lyricsStartY,
    head: flattenStanzas(stanzas),
    tail: [],
  };

  for (let size = LYRIC_MAX_SIZE; size >= LYRIC_MIN_SIZE; size -= 0.5) {
    const total = measureLyrics(doc, flattenStanzas(stanzas), size, TEXT_W);
    if (total <= page1WithQr) {
      return {
        lyricSize: size,
        lyricsStartY,
        head: flattenStanzas(stanzas),
        tail: [],
      };
    }
    const split = splitStanzasByMaxHeight(doc, stanzas, size, TEXT_W, page1Avail);
    const tailH = measureLyrics(doc, split.tail, size, TEXT_W);
    if (tailH <= page2Avail) {
      return {
        lyricSize: size,
        lyricsStartY,
        head: split.head,
        tail: split.tail,
      };
    }
    fallback = {
      lyricSize: size,
      lyricsStartY,
      head: split.head,
      tail: split.tail,
    };
  }
  return fallback;
}

function drawLyricsSpread(
  doc: PdfDoc,
  track: PublicTrack,
  blocks: LyricBlock[],
  brown: Buffer,
  qr: Buffer,
): void {
  const stanzas = groupLyricStanzas(blocks);
  const fit = fitSpreadTwoPages(doc, track, stanzas);
  let y = paintSongTitleBlock(doc, track, belowCoverBackgroundY());
  y = paintLyricsLabel(doc, y);
  if (fit.head.length) {
    paintLyrics(doc, fit.head, fit.lyricSize, MARGIN_X, y, TEXT_W);
  }

  doc.addPage({ size: [PAGE_W, PAGE_H], margin: 0 });
  paintBrown(doc, brown);
  if (fit.tail.length) {
    paintLyrics(doc, fit.tail, fit.lyricSize, MARGIN_X, LYRIC_MARGIN_V, TEXT_W);
  }
  paintQr(doc, qr);
}

async function drawSong(
  doc: PdfDoc,
  track: PublicTrack,
  assets: { wood: Buffer; brown: Buffer; logo: Buffer; cover: Buffer | null; qr: Buffer },
  addPage: boolean,
): Promise<void> {
  if (addPage) doc.addPage({ size: [PAGE_W, PAGE_H], margin: 0 });
  const intro = parseIntro(track.introduction || "");
  const instrumental = Boolean(track.instrumental);
  const bits = instrumental ? intro.filter((b) => b.kind !== "heading") : intro;
  const leftHasIntro = bits.length > 0;

  paintBrown(doc, assets.brown);
  paintWood(doc, assets.wood);
  if (assets.cover) {
    coverShadow(doc);
    doc.image(assets.cover, COVER_X, COVER_Y, { width: COVER_SIZE, height: COVER_SIZE, fit: [COVER_SIZE, COVER_SIZE] });
  }

  if (instrumental) {
    let y = paintSongTitleBlock(doc, track, belowCoverBackgroundY());
    doc.font("Playfair").fontSize(SECTION_HEAD_SIZE).fillColor(INK).text("Instrumental", MARGIN_X, y, { width: TEXT_W });
    y = doc.y + 12;
    drawFittedIntro(doc, bits, y, logoTop() - 4);
    paintLogo(doc, assets.logo);
    paintQr(doc, assets.qr);
    return;
  }

  const lyrics = parseLyrics(track.lyrics || "");

  if (leftHasIntro) {
    const introStartY = paintSongTitleBlock(doc, track, belowCoverBackgroundY());
    drawFittedIntro(doc, bits, introStartY, logoTop() - 4);
    paintLogo(doc, assets.logo);
    doc.addPage({ size: [PAGE_W, PAGE_H], margin: 0 });
    drawLyricsTwoColumnPage(doc, lyrics, assets.brown, assets.qr);
    return;
  }

  drawLyricsSpread(doc, track, lyrics, assets.brown, assets.qr);
}

async function renderToBuffer(draw: (doc: PdfDoc) => Promise<void>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ size: [PAGE_W, PAGE_H], margin: 0, autoFirstPage: false });
    doc.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    registerFonts(doc);
    draw(doc)
      .then(() => doc.end())
      .catch(reject);
  });
}

async function writePdf(outPath: string, draw: (doc: PdfDoc) => Promise<void>): Promise<void> {
  const buf = await renderToBuffer(draw);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, buf);
}

type PdfPage = ReturnType<PDFLibDocument["getPages"]>[number];

function appendAnnots(page: PdfPage, annotRef: ReturnType<PDFLibDocument["context"]["register"]>): void {
  const existing = page.node.lookup(PDFName.of("Annots"));
  if (existing instanceof PDFArray) {
    existing.push(annotRef);
    return;
  }
  page.node.set(PDFName.of("Annots"), page.doc.context.obj([annotRef]));
}

function addInternalLink(
  pdf: PDFLibDocument,
  fromPage: PdfPage,
  box: { x: number; y: number; w: number; h: number },
  targetPage: PdfPage,
): void {
  const yBottom = PAGE_H - box.y - box.h;
  const yTop = PAGE_H - box.y;
  const link = pdf.context.register(
    pdf.context.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: [box.x, yBottom, box.x + box.w, yTop],
      Border: [0, 0, 0],
      A: {
        Type: "Action",
        S: "GoTo",
        D: [targetPage.ref, "XYZ", null, PAGE_H, null],
      },
    }),
  );
  appendAnnots(fromPage, link);
}

function addUriLink(
  pdf: PDFLibDocument,
  fromPage: PdfPage,
  box: { x: number; y: number; w: number; h: number },
  uri: string,
): void {
  const yBottom = PAGE_H - box.y - box.h;
  const yTop = PAGE_H - box.y;
  const link = pdf.context.register(
    pdf.context.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: [box.x, yBottom, box.x + box.w, yTop],
      Border: [0, 0, 0],
      A: {
        Type: "Action",
        S: "URI",
        URI: uri,
      },
    }),
  );
  appendAnnots(fromPage, link);
}

async function mergeFullBook(songsPdf: Buffer, tracks: PublicTrack[]): Promise<Buffer> {
  const coverPath = path.join(ECHOES_TEMPLATES, "Cover page.pdf");
  const page2Path = path.join(ECHOES_TEMPLATES, "Page 2.pdf");
  const page3Path = path.join(ECHOES_TEMPLATES, "Page 3.pdf");
  const backPath = path.join(ECHOES_TEMPLATES, "Back page.pdf");
  for (const file of [coverPath, page2Path, page3Path, backPath]) {
    if (!fs.existsSync(file)) throw new Error(`Missing template: ${file}`);
  }

  const merged = await PDFLibDocument.create();
  const coverDoc = await PDFLibDocument.load(fs.readFileSync(coverPath));
  const page2Doc = await PDFLibDocument.load(fs.readFileSync(page2Path));
  const page3Doc = await PDFLibDocument.load(fs.readFileSync(page3Path));
  const backDoc = await PDFLibDocument.load(fs.readFileSync(backPath));
  const songsDoc = await PDFLibDocument.load(songsPdf);

  for (const src of [coverDoc, page2Doc, page3Doc]) {
    const [page] = await merged.copyPages(src, [0]);
    merged.addPage(page);
  }

  for (let i = 0; i < songsDoc.getPageCount(); i++) {
    const [page] = await merged.copyPages(songsDoc, [i]);
    merged.addPage(page);
  }

  const [back] = await merged.copyPages(backDoc, [0]);
  merged.addPage(back);

  const indexPage = merged.getPage(1);
  for (const box of SONG_LINK_BOXES) {
    const pageIndex = songStartPageIndex(tracks, box.n);
    const target = merged.getPage(pageIndex);
    addInternalLink(merged, indexPage, box, target);
  }
  addUriLink(merged, indexPage, ALBUM_QR_LINK, `${BASE_URL}/${ALBUM_SLUG}`);

  return Buffer.from(await merged.save());
}

async function loadBrownBackground(): Promise<Buffer> {
  const jpg = path.join(ECHOES_TEMPLATES, "brown-background.jpg");
  const pdf = path.join(ECHOES_TEMPLATES, "brown-background.pdf");
  if (!fs.existsSync(jpg) && fs.existsSync(pdf)) {
    const thumb = `${pdf}.png`;
    if (!fs.existsSync(thumb)) {
      spawnSync("qlmanage", ["-t", "-s", "1800", "-o", ECHOES_TEMPLATES, pdf], { stdio: "ignore" });
    }
    const png = fs.existsSync(thumb) ? thumb : path.join(ECHOES_TEMPLATES, "brown-background.pdf.png");
    if (fs.existsSync(png)) {
      await sharp(png)
        .resize(Math.round(PAGE_W * 2), Math.round(PAGE_H * 2), { fit: "cover" })
        .jpeg({ quality: 85 })
        .toFile(jpg);
    }
  }
  if (!fs.existsSync(jpg)) {
    throw new Error(`Missing brown background (expected ${jpg} or ${pdf})`);
  }
  return sharp(jpg).jpeg({ quality: 85 }).toBuffer();
}

async function main(): Promise<void> {
  const outRoot = path.resolve(process.argv[2] || path.join(process.cwd(), "exports", "songbooks", "echoes-of-storms"));
  const songsDir = path.join(outRoot, "songs");
  fs.mkdirSync(songsDir, { recursive: true });

  const wood = await sharp(path.join(ASSETS, "wood.png")).jpeg({ quality: 82 }).toBuffer();
  const brown = await loadBrownBackground();
  const logo = await sharp(path.join(ASSETS, "logo.png")).png().toBuffer();
  const qrPlate = await logoPlate(fs.readFileSync(LOGO_FILE));

  const album = await fetchJson<PublicAlbum>(`${BASE_URL}/api/albums/${ALBUM_SLUG}`);
  const tracks = album.tracks.filter((t) => !t.archived);

  const covers = new Map<string, Buffer | null>();
  const qrs = new Map<string, Buffer>();
  await Promise.all(
    tracks.map(async (track) => {
      covers.set(track.id, await loadCover(track, track.imageUrl));
      qrs.set(track.id, await loadQr(track, qrPlate));
    }),
  );

  const songAssets = (track: PublicTrack) => ({
    wood,
    brown,
    logo,
    cover: covers.get(track.id) || null,
    qr: qrs.get(track.id)!,
  });

  const songsPdf = await renderToBuffer(async (doc) => {
    for (const track of tracks) {
      await drawSong(doc, track, songAssets(track), true);
    }
  });

  const bookPath = path.join(outRoot, "Echoes-of-Storms-Songbook.pdf");
  fs.writeFileSync(bookPath, await mergeFullBook(songsPdf, tracks));
  console.log(`Wrote ${path.relative(process.cwd(), bookPath)}`);

  for (const track of tracks) {
    const rel = `${safeName(track)}.pdf`;
    const outPath = path.join(songsDir, rel);
    await writePdf(outPath, async (doc) => {
      await drawSong(doc, track, songAssets(track), true);
    });
    console.log(`Wrote songs/${rel}`);
  }

  const zipPath = path.join(outRoot, "..", "Echoes-of-Storms-Songbook.zip");
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  const zipped = spawnSync(
    "zip",
    ["-r", "-q", "-9", zipPath, "Echoes-of-Storms-Songbook.pdf", "songs"],
    { cwd: outRoot, stdio: "inherit" },
  );
  if (zipped.status !== 0) throw new Error("zip failed");
  console.log(`\nZip: ${zipPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
