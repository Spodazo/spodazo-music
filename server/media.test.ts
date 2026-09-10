import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import test from "node:test";
import { assetVersion, audioUrl, imageUrl, mp3DataOffset, shouldStripAudioUpload, stripMp3Tags, xingFrameLength } from "./media";

test("media urls stay on this app", () => {
  const v = assetVersion();
  assert.equal(imageUrl("Echoes of the Storm.webp"), `/media/images/Echoes%20of%20the%20Storm.webp?v=${v}`);
  assert.equal(
    audioUrl("Echoes of the Storm (Job 5).mp3"),
    `/media/songs/Echoes%20of%20the%20Storm%20(Job%205).mp3?v=${v}`,
  );
  assert.equal(imageUrl(""), "");
  assert.equal(audioUrl(""), "");
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

test("stripMp3Tags skips a Xing header so Horsemen-style files start on audio", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spodazo-mp3-"));
  const file = path.join(dir, "horsemen.mp3");
  const xing = Buffer.alloc(576, 0);
  xing[0] = 0xff;
  xing[1] = 0xfb;
  xing[2] = 0xb4;
  xing.write("Xing", 36);
  const audio = Buffer.from([0xff, 0xfb, 0xb4, 0x44, ...Array(1600).fill(0x22)]);
  fs.writeFileSync(file, Buffer.concat([xing, audio]));
  assert.equal(mp3DataOffset(file), 576);
  assert.equal(stripMp3Tags(file), true);
  const cleaned = fs.readFileSync(file);
  assert.deepEqual(cleaned.subarray(0, 4), Buffer.from([0xff, 0xfb, 0xb4, 0x44]));
  assert.equal(cleaned.length, audio.length);
});

test("uploaded songs lose Xing headers immediately", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spodazo-mp3-"));
  const file = path.join(dir, "upload.mp3");
  const xing = Buffer.alloc(576, 0);
  xing[0] = 0xff;
  xing[1] = 0xfb;
  xing[2] = 0xb4;
  xing.write("Xing", 36);
  const audio = Buffer.from([0xff, 0xfb, 0xb4, 0x44, ...Array(1600).fill(0x22)]);
  fs.writeFileSync(file, Buffer.concat([xing, audio]));
  assert.equal(stripMp3Tags(file), true);
  assert.equal(fs.readFileSync(file).subarray(0, 4).equals(Buffer.from([0xff, 0xfb, 0xb4, 0x44])), true);
  assert.equal(xingFrameLength(fs.readFileSync(file), 0), 0);
});

test("shouldStripAudioUpload matches every future song upload", () => {
  assert.equal(shouldStripAudioUpload({ fieldname: "audio", mimetype: "audio/mpeg", originalname: "Song.mp3" }), true);
  assert.equal(shouldStripAudioUpload({ fieldname: "file", mimetype: "audio/mp3", originalname: "Song" }), true);
  assert.equal(shouldStripAudioUpload({ fieldname: "track", mimetype: "application/octet-stream", originalname: "Hymn.mp3" }), true);
  assert.equal(shouldStripAudioUpload({ fieldname: "artwork", mimetype: "image/webp", originalname: "Cover.webp" }), false);
});
