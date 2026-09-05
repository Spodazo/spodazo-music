#!/usr/bin/env node
/**
 * Copy Echoes artwork and MP3s from the live WordPress site into MUSIC_DATA_DIR.
 * Safe to re-run. WordPress stays untouched.
 *
 *   MUSIC_DATA_DIR=.music-data node scripts/seed-from-wordpress.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = process.env.MUSIC_DATA_DIR || path.join(root, ".music-data");
const origin = (process.env.MUSIC_ORIGIN || "https://music.spodazo.com").replace(/\/$/, "");
const imagesDir = path.join(dataDir, "images");
const songsDir = path.join(dataDir, "songs");
fs.mkdirSync(imagesDir, { recursive: true });
fs.mkdirSync(songsDir, { recursive: true });

const files = [
  ["Images", "Echoes of Storms Web Portrait.webp"],
  ["Images", "Brody and Eden.webp"],
  ["Images", "Echoes of the Storm.webp"],
  ["Images", "Though He Slay Me.webp"],
  ["Images", "By Waters Deep and Still.webp"],
  ["Images", "Under His Wings.webp"],
  ["Images", "Horsemens Praise.webp"],
  ["Images", "A Promise Broken.webp"],
  ["Images", "Clean Once Again.webp"],
  ["Images", "Restored.webp"],
  ["Images", "Our Light.webp"],
  ["Images", "Your Hands Will Break My Fall.webp"],
  ["Images", "The Heavens Declare.webp"],
  ["Images", "Be Thou My Vision.webp"],
  ["Songs", "Echoes of the Storm (Job 5).mp3"],
  ["Songs", "Though He Slay Me (Job 13).mp3"],
  ["Songs", "By Waters Deep and Still (Jeremiah 17).mp3"],
  ["Songs", "Under His Wings (Psalm 91) - VER 1.mp3"],
  ["Songs", "Horsemens Praise (Psalm 150).mp3"],
  ["Songs", "A Promise Broken (Job 10).mp3"],
  ["Songs", "Clean Once Again (Psalm 51).mp3"],
  ["Songs", "Restored (Psalm 23).mp3"],
  ["Songs", "Our_Light__Genesis_1___John_1_.mp3"],
  ["Songs", "Your Hands Will Break My Fall (Psalm 139).mp3"],
  ["Songs", "The Heavens Declare (Psalm 19).mp3"],
  ["Songs", "Be_Thou_My_Vision.mp3"],
];

async function download([folder, name]) {
  const destDir = folder === "Images" ? imagesDir : songsDir;
  const dest = path.join(destDir, name);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
    console.log(`skip ${name}`);
    return;
  }
  const url = `${origin}/${folder}/${encodeURIComponent(name)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "SpodazoMusicSeed/1.0" },
  });
  const type = res.headers.get("content-type") || "";
  if (!res.ok || /text\/html|sgcaptcha/i.test(type)) {
    throw new Error(`${res.status} ${type || "blocked"} ${url}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1024) {
    throw new Error(`tiny response (${buf.length} bytes) for ${url}`);
  }
  fs.writeFileSync(dest, buf);
  console.log(`ok   ${name} (${Math.round(buf.length / 1024)}kB)`);
}

const failed = [];
for (const file of files) {
  try {
    await download(file);
  } catch (err) {
    failed.push(`${file[1]}: ${err.message}`);
    console.warn(`fail ${file[1]}: ${err.message}`);
  }
}

if (failed.length) {
  console.warn(`\n${failed.length} file(s) could not be copied (often SiteGround captcha).`);
  console.warn("The player will keep using WordPress URLs until those files are uploaded in /admin.");
  process.exitCode = 1;
} else {
  console.log("\nAll Echoes assets copied. WordPress can stay live until you cut DNS over.");
}
