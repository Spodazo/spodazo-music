import assert from "node:assert/strict";
import test from "node:test";
import { lyricMaxTravel, lyricPadPixels, lyricScrollAt, songLengthSeconds } from "./lyricScroll";

test("songLengthSeconds ignores unknown HTML audio durations", () => {
  assert.equal(songLengthSeconds(204), 204);
  assert.equal(songLengthSeconds(0), 0);
  assert.equal(songLengthSeconds(Number.NaN), 0);
  assert.equal(songLengthSeconds(Number.POSITIVE_INFINITY), 0);
});

test("lyric scroll lasts the whole song, not the length of the lyric text", () => {
  const song = 3.4 * 60;
  const max = 800;
  assert.equal(lyricScrollAt(0, song, max), 0);
  assert.equal(lyricScrollAt(song / 2, song, max), 400);
  assert.equal(lyricScrollAt(song, song, max), 800);
  assert.equal(lyricScrollAt(song + 12, song, max), 800);
});

test("lyric scroll stays put until the song length is known", () => {
  assert.equal(lyricScrollAt(30, 0, 800), 0);
  assert.equal(lyricScrollAt(30, Number.NaN, 800), 0);
});

test("lyric pad is a share of the sheet viewport so the last lines can rise", () => {
  assert.equal(lyricPadPixels(0), 0);
  assert.equal(lyricPadPixels(200), 128);
  assert.equal(lyricPadPixels(400), 168);
});

test("sing-along travel needs a sheet shorter than the lyric track", () => {
  const lyrics = 900;
  const pad = lyricPadPixels(320);
  assert.equal(lyricMaxTravel(320, lyrics + pad), lyrics + pad - 320);
  // Dock grown to full lyric height (mobile regression): almost nothing left to scroll.
  assert.equal(lyricMaxTravel(lyrics, lyrics + 128), 128);
  assert.ok(lyricMaxTravel(320, lyrics + pad) > lyricMaxTravel(lyrics, lyrics + 128));
});
