import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_PALETTE_ID, normalizePaletteId } from "./palettes";
import { albumSetupFromPlayer, copyrightLines, DEFAULT_CATALOG, DEFAULT_CURATOR, DEFAULT_PLAYER_SETUP, ECHOES_ALBUM, ECHOES_TRACKS, SITE_COPYRIGHT, normalizeCurator, normalizePlayerSetup, publicCurator, slugify, titleFromAudioFile, uniqueSlug } from "./seed-data";

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
  assert.equal(ECHOES_ALBUM.hidden, false);
  assert.equal(ECHOES_ALBUM.color, DEFAULT_PALETTE_ID);
  assert.equal(ECHOES_ALBUM.copyright, SITE_COPYRIGHT);
});

test("every Echoes track has lyrics from the live player", () => {
  assert.ok(ECHOES_TRACKS.every((track) => track.lyrics.trim().length > 40));
});

test("titleFromAudioFile uses the filename and optional scripture", () => {
  assert.deepEqual(titleFromAudioFile("Echoes of the Storm (Job 5).mp3"), {
    title: "Echoes of the Storm",
    scripture: "Job 5",
  });
  assert.equal(titleFromAudioFile("Our_Light.mp3").title, "Our Light");
});

test("uniqueSlug keeps album deep links distinct", () => {
  const used = new Set(["our-light"]);
  assert.equal(uniqueSlug("Our Light", used), "our-light-2");
  assert.equal(uniqueSlug("Be Thou My Vision", used), "be-thou-my-vision");
});

test("albumSetupFromPlayer copies theme, credits, copyright, and color onto an album", () => {
  assert.deepEqual(albumSetupFromPlayer(DEFAULT_PLAYER_SETUP), {
    tagline: DEFAULT_PLAYER_SETUP.theme,
    credits: DEFAULT_PLAYER_SETUP.credits,
    copyright: DEFAULT_PLAYER_SETUP.copyright,
    color: DEFAULT_PALETTE_ID,
  });
});

test("normalizePlayerSetup fills blank fields from the site defaults", () => {
  assert.deepEqual(normalizePlayerSetup({}), DEFAULT_PLAYER_SETUP);
  assert.equal(normalizePlayerSetup({ appName: "  New Name  " }).appName, "New Name");
  assert.equal(normalizePlayerSetup({ appName: "  New Name  " }).theme, DEFAULT_PLAYER_SETUP.theme);
  assert.equal(normalizePlayerSetup({ collectionCover: "  Cover.webp  " }).collectionCover, "Cover.webp");
  assert.equal(normalizePlayerSetup({ collectionCover: "  Cover.webp  " }).collectionCoverUrl, "");
  assert.equal(normalizePlayerSetup({ logo: "  Mark.webp  " }).logo, "Mark.webp");
  assert.equal(normalizePlayerSetup({ logo: "  Mark.webp  " }).logoUrl, "");
  assert.equal(normalizePlayerSetup({ footerImage: "  Footer.webp  " }).footerImage, "Footer.webp");
  assert.equal(normalizePlayerSetup({ footerImage: "  Footer.webp  " }).footerImageUrl, "");
  assert.equal(normalizePlayerSetup({}).collectionColor, DEFAULT_PALETTE_ID);
  assert.equal(normalizePlayerSetup({ collectionColor: "navy" }).collectionColor, "navy");
  assert.equal(normalizePlayerSetup({ collectionColor: "nope" }).collectionColor, DEFAULT_PALETTE_ID);
});

test("normalizeCurator trims fields and publicCurator hides the password hash", () => {
  assert.deepEqual(normalizeCurator({}), DEFAULT_CURATOR);
  assert.equal(normalizeCurator({ firstName: "  Wernard  " }).firstName, "Wernard");
  assert.deepEqual(publicCurator({ firstName: "Wernard", passwordHash: "secret" }), {
    firstName: "Wernard",
    lastName: "",
    email: "",
  });
});

test("normalizePaletteId keeps known palettes and falls back to ink", () => {
  assert.equal(normalizePaletteId("teal"), "teal");
  assert.equal(normalizePaletteId("NOPE"), DEFAULT_PALETTE_ID);
});

test("copyrightLines splits the reserved notice onto two lines", () => {
  assert.deepEqual(copyrightLines(SITE_COPYRIGHT), [
    "Produced by Spodazo LLC, trading as Spodazo Music Ltd © 2026. All Rights Reserved.",
    "This material may not be copied — in whole or in part — or distributed without previous permission from the Producers.",
  ]);
});

test("slugify matches player deep links", () => {
  assert.equal(slugify("Echoes of the Storm"), "echoes-of-the-storm");
  assert.equal(slugify("Be Thou My Vision"), "be-thou-my-vision");
  assert.equal(slugify("Our Light"), "our-light");
});
