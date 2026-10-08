/**
 * One PNG QR code per song, with the Spodazo Music logo in the centre.
 * Links open the live song on the public player.
 *
 * Usage: npx tsx script/export-song-qrs.ts [outputDir]
 */

import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import QRCode from "qrcode";
import sharp from "sharp";
import type { PublicAlbum, PublicTrack } from "../shared/types";

const BASE_URL = (process.env.SPODAZO_BASE_URL || "https://spodazomusic.com").replace(/\/$/, "");
const QR_SIZE = 1200;
const LOGO_WIDTH_RATIO = 0.36;
const LOGO_PAD = 14;
const LOGO_RADIUS = 22;
const LOGO_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "assets", "spodazo-music-qr-logo.png");

function songShareUrl(albumSlug: string, trackSlug: string): string {
  return `${BASE_URL}/${encodeURIComponent(albumSlug)}#${encodeURIComponent(trackSlug)}`;
}

function safeFileName(albumSlug: string, track: PublicTrack): string {
  const base = `${String(track.n).padStart(2, "0")}-${track.slug || track.title}`;
  const cleaned = base
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 120);
  return `${albumSlug}/${cleaned}.png`;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json() as Promise<T>;
}

async function loadLogo(): Promise<Buffer> {
  if (fs.existsSync(LOGO_FILE)) return fs.readFileSync(LOGO_FILE);
  throw new Error(`Missing logo at ${LOGO_FILE}`);
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

async function logoPlate(logoRaw: Buffer, qrSize: number): Promise<Buffer> {
  const logoWidth = Math.round(qrSize * LOGO_WIDTH_RATIO);
  const meta = await sharp(logoRaw).metadata();
  const logoHeight = Math.round(logoWidth * ((meta.height || 1) / (meta.width || 1)));
  const innerRadius = Math.max(8, LOGO_RADIUS - 8);
  const logo = await roundedPng(logoRaw, logoWidth, logoHeight, innerRadius);
  const w = logoWidth + LOGO_PAD * 2;
  const h = logoHeight + LOGO_PAD * 2;
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

async function main(): Promise<void> {
  const outRoot = path.resolve(process.argv[2] || path.join(process.cwd(), "exports", "song-qrs"));
  fs.mkdirSync(outRoot, { recursive: true });

  const plate = await logoPlate(await loadLogo(), QR_SIZE);
  type AlbumListItem = { slug: string; title: string; hidden?: boolean };
  const albums = (await fetchJson<AlbumListItem[]>(`${BASE_URL}/api/albums`)).filter((a) => !a.hidden);

  const index: string[] = ["album\tsong\tfile\turl"];
  let count = 0;
  for (const item of albums) {
    const album = await fetchJson<PublicAlbum>(`${BASE_URL}/api/albums/${item.slug}`);
    for (const track of album.tracks) {
      if (track.archived) continue;
      const rel = safeFileName(album.slug, track);
      const url = songShareUrl(album.slug, track.slug);
      const outPath = path.join(outRoot, rel);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, await makeQrPng(url, plate));
      index.push(`${album.title}\t${track.title}\t${rel}\t${url}`);
      count += 1;
      console.log(`Wrote ${rel}`);
    }
  }

  fs.writeFileSync(path.join(outRoot, "index.txt"), `${index.join("\n")}\n`);
  const zipPath = path.resolve(outRoot, "..", "spodazo-song-qr-codes.zip");
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  const zipped = spawnSync("zip", ["-r", "-q", zipPath, path.basename(outRoot)], {
    cwd: path.dirname(outRoot),
    stdio: "inherit",
  });
  if (zipped.status !== 0) throw new Error("zip failed");

  console.log(`\nDone: ${count} QR codes in ${outRoot}`);
  console.log(`Zip: ${zipPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
