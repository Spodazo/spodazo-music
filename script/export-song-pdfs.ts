/**
 * One A4 PDF per song: album title, cover (full content width), title, subtitle,
 * info, Bible verses, and lyrics. Data from the public API (default: production).
 *
 * Usage: npx tsx script/export-song-pdfs.ts [outputDir]
 */

import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import sharp from "sharp";
import type { PublicAlbum, PublicTrack } from "../shared/types";

const BASE_URL = (process.env.SPODAZO_BASE_URL || "https://spodazomusic.com").replace(/\/$/, "");
const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
/** Text and section margins */
const MARGIN = 48;
const CONTENT_WIDTH = A4_WIDTH - MARGIN * 2;
/** Artwork: nearly full page width with a small edge inset */
const COVER_MARGIN = 16;
const COVER_WIDTH = A4_WIDTH - COVER_MARGIN * 2;

const BOOK =
  "(?:Genesis|Exodus|Leviticus|Numbers|Deuteronomy|Joshua|Judges|Ruth|(?:1|2|I|II)?\\s*Samuel|(?:1|2|I|II)?\\s*Kings|(?:1|2|I|II)?\\s*Chronicles|Ezra|Nehemiah|Esther|Job|Psalm|Psalms|Proverbs|Ecclesiastes|Song of Solomon|Isaiah|Jeremiah|Lamentations|Ezekiel|Daniel|Hosea|Joel|Amos|Obadiah|Jonah|Micah|Nahum|Habakkuk|Zephaniah|Haggai|Zechariah|Malachi|Matthew|Mark|Luke|John|Acts|Romans|(?:1|2|I|II)?\\s*Corinthians|Galatians|Galations|Ephesians|Philippians|Colossians|(?:1|2|I|II)?\\s*Thessalonians|(?:1|2|I|II)?\\s*Timothy|Titus|Philemon|Hebrews|James|(?:1|2|I|II)?\\s*Peter|(?:1|2|I|II|III)?\\s*John|Jude|Revelation)";

const SCRIPTURE_REF_LINE = new RegExp(
  `^${BOOK}(?:\\s+\\d+)?(?:\\s*[:.]\\s*[\\d\\s,\\-–—]+)?$`,
  "i",
);

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

export function splitIntroduction(introduction: string): { info: string; bibleVerses: string } {
  const text = normalizeNewlines(introduction);
  if (!text) return { info: "", bibleVerses: "" };

  const lines = text.split("\n");
  let firstScripture = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (SCRIPTURE_REF_LINE.test(line)) {
      firstScripture = i;
      break;
    }
  }

  if (firstScripture < 0) {
    return {
      info: text.replace(/^TRIBUTE\s*\n*/i, "").trim(),
      bibleVerses: "",
    };
  }

  const info = lines
    .slice(0, firstScripture)
    .join("\n")
    .replace(/^TRIBUTE\s*\n*/i, "")
    .trim();
  const bibleVerses = lines.slice(firstScripture).join("\n").trim();
  return { info, bibleVerses };
}

function safeFileName(albumSlug: string, track: PublicTrack): string {
  const base = `${String(track.n).padStart(2, "0")}-${track.slug || track.title}`;
  const cleaned = base
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 120);
  return `${albumSlug}/${cleaned}.pdf`;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json() as Promise<T>;
}

async function loadCoverImage(imageUrl: string): Promise<{ buffer: Buffer; width: number; height: number } | null> {
  if (!imageUrl) return null;
  const url = imageUrl.startsWith("http") ? imageUrl : `${BASE_URL}${imageUrl.split("?")[0]}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const raw = Buffer.from(await res.arrayBuffer());
  const png = await sharp(raw).png().toBuffer();
  const meta = await sharp(png).metadata();
  return {
    buffer: png,
    width: meta.width || COVER_WIDTH,
    height: meta.height || COVER_WIDTH,
  };
}

type PdfDoc = InstanceType<typeof PDFDocument>;

function ensureSpace(doc: PdfDoc, needed: number): void {
  if (doc.y + needed <= A4_HEIGHT - MARGIN) return;
  doc.addPage();
}

function sectionHeading(doc: PdfDoc, title: string): void {
  ensureSpace(doc, 36);
  doc.moveDown(0.6);
  doc.font("Helvetica-Bold").fontSize(11).fillColor("#333333").text(title.toUpperCase(), {
    width: CONTENT_WIDTH,
    align: "left",
  });
  doc.moveDown(0.25);
}

function bodyText(doc: PdfDoc, text: string): void {
  const normalized = normalizeNewlines(text);
  if (!normalized) return;
  doc.font("Helvetica").fontSize(10.5).fillColor("#111111").text(normalized, {
    width: CONTENT_WIDTH,
    align: "left",
    lineGap: 2,
  });
}

async function writeTrackPdf(
  album: PublicAlbum,
  track: PublicTrack,
  outPath: string,
): Promise<void> {
  const { info, bibleVerses } = splitIntroduction(track.introduction || "");
  const cover = await loadCoverImage(track.imageUrl);

  await new Promise<void>((resolve, reject) => {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    const stream = fs.createWriteStream(outPath);
    const doc = new PDFDocument({ size: "A4", margin: MARGIN, autoFirstPage: true });

    stream.on("finish", () => resolve());
    stream.on("error", reject);
    doc.on("error", reject);
    doc.pipe(stream);

    doc.font("Helvetica-Bold").fontSize(16).fillColor("#000000").text(album.title, {
      width: CONTENT_WIDTH,
      align: "center",
    });
    doc.moveDown(0.8);

    if (cover) {
      const coverHeight = (cover.height / cover.width) * COVER_WIDTH;
      ensureSpace(doc, coverHeight + 12);
      const x = COVER_MARGIN;
      const y = doc.y;
      doc.image(cover.buffer, x, y, { width: COVER_WIDTH });
      doc.y = y + coverHeight + 12;
    }

    doc.font("Helvetica-Bold").fontSize(14).fillColor("#000000").text(track.title, {
      width: CONTENT_WIDTH,
      align: "center",
    });

    const subtitle = (track.scripture || "").trim();
    if (subtitle) {
      doc.moveDown(0.25);
      doc.font("Helvetica-Oblique").fontSize(11).fillColor("#444444").text(subtitle, {
        width: CONTENT_WIDTH,
        align: "center",
      });
    }

    if (info) {
      sectionHeading(doc, "Info");
      bodyText(doc, info);
    }

    if (bibleVerses) {
      sectionHeading(doc, "Bible Verses");
      bodyText(doc, bibleVerses);
    }

    const lyrics = normalizeNewlines(track.lyrics || "");
    if (lyrics && !/^lyrics can be added/i.test(lyrics)) {
      sectionHeading(doc, "Lyrics");
      bodyText(doc, lyrics);
    } else if (track.instrumental) {
      sectionHeading(doc, "Lyrics");
      bodyText(doc, "(Instrumental)");
    }

    doc.end();
  });
}

async function main(): Promise<void> {
  const outRoot = path.resolve(process.argv[2] || path.join(process.cwd(), "exports", "song-pdfs"));
  fs.mkdirSync(outRoot, { recursive: true });

  type AlbumListItem = { slug: string; title: string; hidden?: boolean };
  const albums = (await fetchJson<AlbumListItem[]>(`${BASE_URL}/api/albums`)).filter((a) => !a.hidden);

  let count = 0;
  for (const item of albums) {
    const album = await fetchJson<PublicAlbum>(`${BASE_URL}/api/albums/${item.slug}`);
    for (const track of album.tracks) {
      if (track.archived) continue;
      const rel = safeFileName(album.slug, track);
      const outPath = path.join(outRoot, rel);
      await writeTrackPdf(album, track, outPath);
      count += 1;
      console.log(`Wrote ${rel}`);
    }
  }

  console.log(`\nDone: ${count} PDFs in ${outRoot}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
