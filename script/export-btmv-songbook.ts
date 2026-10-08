/**
 * Be Thou My Vision songbook: cover + intro, lyrics on a second page (vocals only).
 *
 * Usage: npx tsx script/export-btmv-songbook.ts [outputDir]
 */

import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import PDFDocument from "pdfkit";
import sharp from "sharp";
import type { PublicAlbum, PublicTrack } from "../shared/types";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(HERE, "assets", "songbook");
const FONTS = path.join(ASSETS, "fonts");
const QR_DIR = path.join(ASSETS, "qrs");
const BASE_URL = (process.env.SPODAZO_BASE_URL || "https://spodazomusic.com").replace(/\/$/, "");
const ALBUM_SLUG = "be-thou-my-vision";

const PAGE_W = 595.44;
const PAGE_H = 842.16;
const BOTTOM_MARGIN = (72 * 10) / 25.4;
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
const INK = "#F5F7FA";
const INK_SOFT = "#D7E0EA";
const SECTION_HEAD_SIZE = 16;

const BOOK =
  "(?:Genesis|Exodus|Leviticus|Numbers|Deuteronomy|Joshua|Judges|Ruth|(?:1|2|I|II)?\\s*Samuel|(?:1|2|I|II)?\\s*Kings|(?:1|2|I|II)?\\s*Chronicles|Ezra|Nehemiah|Esther|Job|Psalm|Psalms|Proverbs|Ecclesiastes|Song of Solomon|Isaiah|Jeremiah|Lamentations|Ezekiel|Daniel|Hosea|Joel|Amos|Obadiah|Jonah|Micah|Nahum|Habakkuk|Zephaniah|Haggai|Zechariah|Malachi|Matthew|Mark|Luke|John|Acts|Romans|(?:1|2|I|II)?\\s*Corinthians|Galatians|Galations|Ephesians|Philippians|Colossians|(?:1|2|I|II)?\\s*Thessalonians|(?:1|2|I|II)?\\s*Timothy|Titus|Philemon|Hebrews|James|(?:1|2|I|II)?\\s*Peter|(?:1|2|I|II|III)?\\s*John|Jude|Revelation)";
const SCRIPTURE_REF_LINE = new RegExp(
  `^${BOOK}(?:\\s+\\d+)?(?:\\s*[:.]\\s*[\\d\\s,\\-–—]+)?$`,
  "i",
);
const SECTION_LINE =
  /^\[?\s*((?:Verse|Chorus|Refrain|Bridge|Spoken Word|Instrumental)\b[^\]\n]*)\]?\s*$/i;

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

async function loadCover(imageUrl: string): Promise<Buffer | null> {
  if (!imageUrl) return null;
  const name = decodeURIComponent((imageUrl.split("?")[0].split("/").pop() || "").trim());
  const local = name ? path.join(process.cwd(), "media", "images", name) : "";
  const raw = local && fs.existsSync(local)
    ? await sharp(local).png().toBuffer()
    : await fetchPng(imageUrl.startsWith("http") ? imageUrl : `${BASE_URL}${imageUrl.split("?")[0]}`);
  return sharp(raw)
    .resize(1400, 1400, { fit: "cover", position: "centre" })
    .jpeg({ quality: 82 })
    .toBuffer();
}

async function loadQr(track: PublicTrack): Promise<Buffer> {
  const file = path.join(QR_DIR, `${safeName(track)}.png`);
  if (!fs.existsSync(file)) throw new Error(`Missing QR: ${file}`);
  return sharp(file).png().toBuffer();
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

function paintBlue(doc: PdfDoc, blue: Buffer): void {
  doc.image(blue, 0, 0, { width: PAGE_W, height: PAGE_H });
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
  return Math.max(1.2, size * 0.28);
}

function measureLyrics(doc: PdfDoc, blocks: LyricBlock[], size: number, width: number): number {
  let h = 0;
  const gap = lyricLineGap(size);
  for (const block of blocks) {
    if (block.kind === "blank") {
      h += size * 0.7;
      continue;
    }
    if (block.kind === "section") {
      doc.font("Playfair").fontSize(size);
      h += doc.heightOfString(block.text, { width, lineGap: 1 }) + size * 0.35;
    } else {
      doc.font("Montserrat-Light").fontSize(size);
      h += doc.heightOfString(block.text, { width, lineGap: gap });
    }
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

function fitBodySize(measure: (size: number) => number, available: number): number {
  if (measure(BODY_SIZE) <= available) return BODY_SIZE;
  for (let s = BODY_SIZE - 0.5; s >= 8; s -= 0.5) {
    if (measure(s) <= available) return s;
  }
  return 8;
}

function textFloor(): number {
  return PAGE_H - BOTTOM_MARGIN;
}

function drawFittedIntro(doc: PdfDoc, bits: IntroBit[], startY: number, floorY: number): void {
  const available = Math.max(40, Math.min(floorY, textFloor()) - startY);
  const size = fitBodySize((s) => measureIntro(doc, bits, s), available);
  paintIntro(doc, bits, size, startY);
}

function drawLyricsPageBody(doc: PdfDoc, track: PublicTrack, blocks: LyricBlock[], qr: Buffer): void {
  doc.font("Playfair").fontSize(28).fillColor(INK).text(track.title, MARGIN_X, 42, {
    width: TEXT_W,
    align: "center",
  });
  let y = doc.y + 6;
  const scripture = (track.scripture || "").trim();
  if (scripture) {
    doc.font("Montserrat").fontSize(BODY_SIZE).fillColor(INK_SOFT).text(scripture, MARGIN_X, y, {
      width: TEXT_W,
      align: "center",
    });
    y = doc.y + 16;
  } else y += 12;
  doc.font("Playfair").fontSize(SECTION_HEAD_SIZE).fillColor(INK).text("Lyrics", MARGIN_X, y, { width: TEXT_W });
  y = doc.y + 12;
  const available = Math.max(40, textFloor() - y);
  const size = fitBodySize((s) => measureLyrics(doc, blocks, s, TEXT_W), available);
  paintLyrics(doc, blocks, size, MARGIN_X, y, TEXT_W);
  paintQr(doc, qr);
}

async function drawSong(
  doc: PdfDoc,
  album: PublicAlbum,
  track: PublicTrack,
  assets: { wood: Buffer; blue: Buffer; logo: Buffer; cover: Buffer | null; qr: Buffer },
  addPage: boolean,
): Promise<void> {
  if (addPage) doc.addPage({ size: [PAGE_W, PAGE_H], margin: 0 });
  const intro = parseIntro(track.introduction || "");
  const instrumental = Boolean(track.instrumental);

  paintBlue(doc, assets.blue);
  paintWood(doc, assets.wood);
  if (assets.cover) {
    coverShadow(doc);
    doc.image(assets.cover, COVER_X, COVER_Y, { width: COVER_SIZE, height: COVER_SIZE, fit: [COVER_SIZE, COVER_SIZE] });
  }

  let y = TEXT_TOP;
  if (instrumental) {
    doc.font("Playfair").fontSize(SECTION_HEAD_SIZE).fillColor(INK).text("Instrumental", MARGIN_X, y, { width: TEXT_W });
    y = doc.y + 12;
  }
  const bits = instrumental ? intro.filter((b) => b.kind !== "heading") : intro;
  const introFloor = Math.min(logoTop() - 6, textFloor());
  drawFittedIntro(doc, bits, y, introFloor);
  paintLogo(doc, assets.logo);

  if (!instrumental) {
    doc.addPage({ size: [PAGE_W, PAGE_H], margin: 0 });
    paintBlue(doc, assets.blue);
    const lyrics = parseLyrics(track.lyrics || "");
    drawLyricsPageBody(doc, track, lyrics, assets.qr);
  } else {
    paintQr(doc, assets.qr);
  }
  void album;
}

async function writePdf(outPath: string, draw: (doc: PdfDoc) => Promise<void>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    const stream = fs.createWriteStream(outPath);
    const doc = new PDFDocument({ size: [PAGE_W, PAGE_H], margin: 0, autoFirstPage: false });
    stream.on("finish", () => resolve());
    stream.on("error", reject);
    doc.on("error", reject);
    doc.pipe(stream);
    registerFonts(doc);
    draw(doc)
      .then(() => doc.end())
      .catch(reject);
  });
}

/** Click targets on the Canva Forward page (points from top-left). */
const SONG_LINK_BOXES: { n: number; x: number; y: number; w: number; h: number }[] = [
  { n: 1, x: 56, y: 450, w: 132, h: 16 },
  { n: 2, x: 56, y: 468.5, w: 170, h: 16 },
  { n: 3, x: 56, y: 487.5, w: 132, h: 16 },
  { n: 4, x: 56, y: 506, w: 156, h: 16 },
  { n: 5, x: 56, y: 524.5, w: 130, h: 16 },
  { n: 6, x: 56, y: 544, w: 128, h: 16 },
  { n: 7, x: 56, y: 562.5, w: 118, h: 16 },
  { n: 8, x: 56, y: 581.5, w: 116, h: 16 },
  { n: 9, x: 56, y: 599.5, w: 124, h: 16 },
  { n: 10, x: 56, y: 618.5, w: 80, h: 16 },
];

function drawImagePage(doc: PdfDoc, image: Buffer): void {
  doc.addPage({ size: [PAGE_W, PAGE_H], margin: 0 });
  doc.image(image, 0, 0, { width: PAGE_W, height: PAGE_H });
}

function drawForwardPage(doc: PdfDoc, image: Buffer, tracks: PublicTrack[]): void {
  drawImagePage(doc, image);
  const byN = new Map(tracks.map((track) => [track.n, track]));
  for (const box of SONG_LINK_BOXES) {
    const track = byN.get(box.n);
    if (!track) continue;
    doc.link(box.x, box.y, box.w, box.h, songListenUrl(track));
  }
  doc.link(300, 438, 220, 220, `${BASE_URL}/${ALBUM_SLUG}`);
}

async function main(): Promise<void> {
  const outRoot = path.resolve(process.argv[2] || path.join(process.cwd(), "exports", "songbooks", "be-thou-my-vision"));
  const songsDir = path.join(outRoot, "songs");
  fs.mkdirSync(songsDir, { recursive: true });

  const wood = await sharp(path.join(ASSETS, "wood.png")).jpeg({ quality: 82 }).toBuffer();
  const blue = await sharp(path.join(ASSETS, "blue.png")).jpeg({ quality: 80 }).toBuffer();
  const logo = await sharp(path.join(ASSETS, "logo.png")).png().toBuffer();
  const frontCover = await sharp(path.join(ASSETS, "front-cover.jpg")).jpeg({ quality: 86 }).toBuffer();
  const forwardPage = await sharp(path.join(ASSETS, "forward.jpg")).jpeg({ quality: 86 }).toBuffer();

  const album = await fetchJson<PublicAlbum>(`${BASE_URL}/api/albums/${ALBUM_SLUG}`);
  const tracks = album.tracks.filter((t) => !t.archived);

  const covers = new Map<string, Buffer | null>();
  const qrs = new Map<string, Buffer>();
  await Promise.all(
    tracks.map(async (track) => {
      covers.set(track.id, await loadCover(track.imageUrl));
      qrs.set(track.id, await loadQr(track));
    }),
  );

  const bookPath = path.join(outRoot, "Be-Thou-My-Vision-Songbook.pdf");
  await writePdf(bookPath, async (doc) => {
    drawImagePage(doc, frontCover);
    drawForwardPage(doc, forwardPage, tracks);
    for (const track of tracks) {
      await drawSong(
        doc,
        album,
        track,
        {
          wood,
          blue,
          logo,
          cover: covers.get(track.id) || null,
          qr: qrs.get(track.id)!,
        },
        true,
      );
    }
  });
  console.log(`Wrote ${path.relative(process.cwd(), bookPath)}`);

  const forwardPath = path.join(outRoot, "02-forward.pdf");
  await writePdf(forwardPath, async (doc) => {
    drawForwardPage(doc, forwardPage, tracks);
  });
  console.log(`Wrote ${path.relative(process.cwd(), forwardPath)}`);

  for (const track of tracks) {
    const rel = `${safeName(track)}.pdf`;
    const outPath = path.join(songsDir, rel);
    await writePdf(outPath, async (doc) => {
      doc.addPage({ size: [PAGE_W, PAGE_H], margin: 0 });
      await drawSong(
        doc,
        album,
        track,
        {
          wood,
          blue,
          logo,
          cover: covers.get(track.id) || null,
          qr: qrs.get(track.id)!,
        },
        false,
      );
    });
    console.log(`Wrote songs/${rel}`);
  }

  const zipPath = path.join(outRoot, "..", "Be-Thou-My-Vision-Songbook.zip");
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  const zipped = spawnSync(
    "zip",
    ["-r", "-q", "-9", zipPath, "Be-Thou-My-Vision-Songbook.pdf", "02-forward.pdf", "songs"],
    { cwd: outRoot, stdio: "inherit" },
  );
  if (zipped.status !== 0) throw new Error("zip failed");
  console.log(`\nZip: ${zipPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
