import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import test from "node:test";
import { assetVersion, audioUrl, convertStoredImages, convertUploadedImage, formatDuration, HOME_CARD_WIDTH, imageUrl, isVbrMp3, mp3DataOffset, mp3DurationSeconds, parseImageWidth, prepareMp3, preparedImagePath, shouldConvertImageUpload, shouldStripAudioUpload, stripMp3Tags, trackDownloadName, xingFrameLength } from "./media";

function mpegFrame(header: number[], size: number, fill = 0x22) {
  const frame = Buffer.alloc(size, fill);
  frame[0] = header[0];
  frame[1] = header[1];
  frame[2] = header[2];
  frame[3] = header[3];
  return frame;
}

const CBR192 = [0xff, 0xfb, 0xb4, 0x44];
const VBR320 = [0xff, 0xfb, 0xe4, 0x64];
const VBR160 = [0xff, 0xfb, 0xa4, 0x64];

test("media urls stay on this app", () => {
  const v = assetVersion();
  assert.equal(imageUrl("Echoes of the Storm.webp"), `/media/images/Echoes%20of%20the%20Storm.webp?v=${v}`);
  assert.equal(
    imageUrl("Echoes of the Storm.webp", HOME_CARD_WIDTH),
    `/media/images/Echoes%20of%20the%20Storm.webp?v=${v}&w=${HOME_CARD_WIDTH}`,
  );
  assert.equal(imageUrl("Echoes of the Storm.webp", 99), `/media/images/Echoes%20of%20the%20Storm.webp?v=${v}`);
  assert.equal(
    audioUrl("Echoes of the Storm (Job 5).mp3"),
    `/media/songs/Echoes%20of%20the%20Storm%20(Job%205).mp3?v=${v}`,
  );
  assert.equal(imageUrl(""), "");
  assert.equal(audioUrl(""), "");
  assert.equal(parseImageWidth("720"), 720);
  assert.equal(parseImageWidth("99"), undefined);
});

test("trackDownloadName keeps the live MP3 filename", () => {
  assert.equal(trackDownloadName({ file: "Our Light.mp3", title: "Our Light" }), "Our Light.mp3");
  assert.equal(trackDownloadName({ file: "", title: "Our Light" }), "Our Light.mp3");
});

test("mp3DataOffset skips an ID3v2 tag and leaves a raw MP3 alone", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spodazo-mp3-"));
  const raw = path.join(dir, "raw.mp3");
  const tagged = path.join(dir, "tagged.mp3");
  const audio = Buffer.from([0xff, 0xfb, 0x54, 0x00, ...Array(200).fill(0)]);
  fs.writeFileSync(raw, audio);
  const payload = Buffer.alloc(100, 0x41);
  const size = Buffer.from([
    (payload.length >> 21) & 0x7f,
    (payload.length >> 14) & 0x7f,
    (payload.length >> 7) & 0x7f,
    payload.length & 0x7f,
  ]);
  fs.writeFileSync(tagged, Buffer.concat([Buffer.from("ID3\u0003\u0000\u0000"), size, payload, audio]));
  assert.equal(mp3DataOffset(raw), 0);
  assert.equal(mp3DataOffset(tagged), 10 + payload.length);
});

test("stripMp3Tags removes tags only when the audio frame is still valid", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spodazo-mp3-"));
  const tagged = path.join(dir, "tagged.mp3");
  const audio = Buffer.from([0xff, 0xfb, 0x54, 0x00, ...Array(1200).fill(0)]);
  const payload = Buffer.alloc(80, 0x41);
  const size = Buffer.from([
    (payload.length >> 21) & 0x7f,
    (payload.length >> 14) & 0x7f,
    (payload.length >> 7) & 0x7f,
    payload.length & 0x7f,
  ]);
  const footer = Buffer.concat([Buffer.from("TAG"), Buffer.alloc(125, 0x20)]);
  fs.writeFileSync(tagged, Buffer.concat([Buffer.from("ID3\u0003\u0000\u0000"), size, payload, audio, footer]));
  assert.equal(stripMp3Tags(tagged), true);
  const cleaned = fs.readFileSync(tagged);
  assert.deepEqual(cleaned.subarray(0, 4), Buffer.from([0xff, 0xfb, 0x54, 0x00]));
  assert.equal(cleaned.length, audio.length);
  assert.equal(stripMp3Tags(tagged), false);
  assert.equal(mp3DataOffset(tagged), 0);
});

test("CBR songs lose Xing so Safari does not play the header as a scratch", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spodazo-mp3-"));
  const file = path.join(dir, "horsemen.mp3");
  const xing = Buffer.alloc(576, 0);
  xing[0] = 0xff;
  xing[1] = 0xfb;
  xing[2] = 0xb4;
  xing.write("Xing", 36);
  const audio = Buffer.concat([mpegFrame(CBR192, 576), mpegFrame(CBR192, 576)]);
  fs.writeFileSync(file, Buffer.concat([xing, audio]));
  assert.equal(mp3DataOffset(file), 0);
  assert.equal(prepareMp3(file), true);
  const cleaned = fs.readFileSync(file);
  assert.deepEqual(cleaned.subarray(0, 4), Buffer.from(CBR192));
  assert.equal(cleaned.length, audio.length);
  assert.equal(xingFrameLength(cleaned, 0), 0);
});

test("VBR songs like Echoes get a Xing map back so Safari can decode them", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spodazo-mp3-"));
  const file = path.join(dir, "echoes.mp3");
  const audio = Buffer.concat([mpegFrame(VBR320, 960), mpegFrame(VBR160, 480), mpegFrame(VBR320, 960)]);
  fs.writeFileSync(file, audio);
  assert.equal(isVbrMp3(audio), true);
  assert.equal(xingFrameLength(audio, 0), 0);
  assert.equal(prepareMp3(file), true);
  const prepared = fs.readFileSync(file);
  const xing = xingFrameLength(prepared, 0);
  assert.ok(xing > 0);
  assert.deepEqual(prepared.subarray(xing, xing + 4), Buffer.from(VBR320));
  assert.equal(prepareMp3(file), false);
});

test("VBR uploads keep an existing Xing header and only lose ID3", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spodazo-mp3-"));
  const file = path.join(dir, "upload.mp3");
  const xing = Buffer.alloc(384, 0);
  xing[0] = 0xff;
  xing[1] = 0xfb;
  xing[2] = 0x94;
  xing[3] = 0x64;
  xing.write("Xing", 36);
  const audio = Buffer.concat([mpegFrame(VBR320, 960), mpegFrame(VBR160, 480)]);
  const payload = Buffer.alloc(40, 0x41);
  const size = Buffer.from([
    (payload.length >> 21) & 0x7f,
    (payload.length >> 14) & 0x7f,
    (payload.length >> 7) & 0x7f,
    payload.length & 0x7f,
  ]);
  fs.writeFileSync(file, Buffer.concat([Buffer.from("ID3\u0003\u0000\u0000"), size, payload, xing, audio]));
  assert.equal(mp3DataOffset(file), 10 + payload.length);
  assert.equal(prepareMp3(file), true);
  const prepared = fs.readFileSync(file);
  assert.ok(xingFrameLength(prepared, 0) > 0);
  assert.deepEqual(prepared.subarray(0, 4), Buffer.from([0xff, 0xfb, 0x94, 0x64]));
});

test("formatDuration skips sub-second lengths", () => {
  assert.equal(formatDuration(0), "");
  assert.equal(formatDuration(0.4), "");
  assert.equal(formatDuration(61), "1:01");
  assert.equal(formatDuration(421), "7:01");
});

test("CBR duration comes from bitrate and file size", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spodazo-mp3-"));
  const file = path.join(dir, "cbr.mp3");
  const frames = Array.from({ length: 84 }, () => mpegFrame(CBR192, 576));
  fs.writeFileSync(file, Buffer.concat(frames));
  const seconds = mp3DurationSeconds(file);
  assert.ok(Math.abs(seconds - 2.016) < 0.02);
  assert.equal(formatDuration(seconds), "0:02");
});

test("VBR duration comes from the Xing frame count", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spodazo-mp3-"));
  const file = path.join(dir, "vbr.mp3");
  const xing = Buffer.alloc(576, 0);
  xing[0] = 0xff;
  xing[1] = 0xfb;
  xing[2] = 0xb4;
  xing[3] = 0x44;
  xing.write("Xing", 36);
  xing.writeUInt32BE(1, 40);
  xing.writeUInt32BE(417, 44);
  fs.writeFileSync(file, Buffer.concat([xing, mpegFrame(VBR160, 480)]));
  const seconds = mp3DurationSeconds(file);
  assert.ok(Math.abs(seconds - 10.008) < 0.02);
  assert.equal(formatDuration(seconds), "0:10");
});

test("shouldStripAudioUpload matches every future song upload", () => {
  assert.equal(shouldStripAudioUpload({ fieldname: "audio", mimetype: "audio/mpeg", originalname: "Song.mp3" }), true);
  assert.equal(shouldStripAudioUpload({ fieldname: "file", mimetype: "audio/mp3", originalname: "Song" }), true);
  assert.equal(shouldStripAudioUpload({ fieldname: "track", mimetype: "application/octet-stream", originalname: "Hymn.mp3" }), true);
  assert.equal(shouldStripAudioUpload({ fieldname: "artwork", mimetype: "image/webp", originalname: "Cover.webp" }), false);
});

test("shouldConvertImageUpload matches album and song artwork", () => {
  assert.equal(shouldConvertImageUpload({ fieldname: "hero", mimetype: "image/jpeg", originalname: "Portrait.jpg" }), true);
  assert.equal(shouldConvertImageUpload({ fieldname: "thumb", mimetype: "image/png", originalname: "Cover.png" }), true);
  assert.equal(shouldConvertImageUpload({ fieldname: "artwork", mimetype: "application/octet-stream", originalname: "Song.tif" }), true);
  assert.equal(shouldConvertImageUpload({ fieldname: "audio", mimetype: "audio/mpeg", originalname: "Song.mp3" }), false);
});

test("preparedImagePath writes a card-sized WebP once", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spodazo-thumbs-"));
  process.env.MUSIC_DATA_DIR = dir;
  const source = path.join(dir, "Cover.webp");
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  fs.writeFileSync(path.join(dir, "Cover.png"), png);
  const name = await convertUploadedImage("Cover.png", dir);
  const full = path.join(dir, name);
  const first = await preparedImagePath(full, HOME_CARD_WIDTH);
  const second = await preparedImagePath(full, HOME_CARD_WIDTH);
  assert.equal(first, second);
  assert.notEqual(first, full);
  const webp = fs.readFileSync(first);
  assert.equal(webp.subarray(0, 4).toString("ascii"), "RIFF");
});

test("convertUploadedImage stores album art as WebP", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spodazo-img-"));
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  fs.writeFileSync(path.join(dir, "Cover.png"), png);
  const name = await convertUploadedImage("Cover.png", dir);
  assert.equal(name, "Cover.webp");
  assert.equal(fs.existsSync(path.join(dir, "Cover.png")), false);
  const webp = fs.readFileSync(path.join(dir, "Cover.webp"));
  assert.equal(webp.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(webp.subarray(8, 12).toString("ascii"), "WEBP");
});

test("convertStoredImages turns leftover PNG covers into WebP", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spodazo-img-"));
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  fs.writeFileSync(path.join(dir, "Horsemens Praise.png"), png);
  fs.writeFileSync(path.join(dir, "favicon-32.png"), png);
  fs.writeFileSync(path.join(dir, "Keep.webp"), Buffer.from("RIFF....WEBP"));
  const renamed = await convertStoredImages(dir);
  assert.equal(renamed.get("Horsemens Praise.png"), "Horsemens Praise.webp");
  assert.equal(renamed.has("favicon-32.png"), false);
  assert.equal(fs.existsSync(path.join(dir, "Horsemens Praise.png")), false);
  assert.equal(fs.existsSync(path.join(dir, "Horsemens Praise.webp")), true);
  assert.equal(fs.existsSync(path.join(dir, "favicon-32.png")), true);
});
