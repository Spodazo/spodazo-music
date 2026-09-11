import assert from "node:assert/strict";
import test from "node:test";
import { lyricScrollAt, songLengthSeconds } from "./lyricScroll";

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
