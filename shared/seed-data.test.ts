import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_CATALOG, ECHOES_ALBUM, ECHOES_TRACKS, slugify } from "./seed-data";

test("Echoes catalog has twelve unique tracks", () => {
  assert.equal(ECHOES_ALBUM.slug, "echoes");
  assert.equal(ECHOES_TRACKS.length, 12);
  assert.equal(new Set(ECHOES_TRACKS.map((track) => track.n)).size, 12);
  assert.equal(new Set(ECHOES_TRACKS.map((track) => track.file)).size, 12);
  assert.equal(new Set(ECHOES_TRACKS.map((track) => track.img)).size, 12);
  assert.ok(ECHOES_TRACKS.every((track) => track.albumId === ECHOES_ALBUM.id));
  assert.equal(DEFAULT_CATALOG.albums.length, 1);
  assert.equal(ECHOES_ALBUM.thumb, "Echoes of Storms.webp");
  assert.equal(ECHOES_ALBUM.artistThumb, "Brody and Eden.webp");
});

test("every Echoes track has lyrics from the live player", () => {
  assert.ok(ECHOES_TRACKS.every((track) => track.lyrics.trim().length > 40));
});

test("slugify matches player deep links", () => {
  assert.equal(slugify("Echoes of the Storm"), "echoes-of-the-storm");
  assert.equal(slugify("Be Thou My Vision"), "be-thou-my-vision");
  assert.equal(slugify("Our Light"), "our-light");
});
