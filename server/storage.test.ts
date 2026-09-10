import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { JsonMusicStore } from "./storage";

test("JSON store seeds Echoes and supports album/track admin writes", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spodazo-music-"));
  process.env.MUSIC_DATA_DIR = dir;
  const store = new JsonMusicStore();
  const albums = await store.listAlbums();
  assert.equal(albums.length, 1);
  assert.equal(albums[0].slug, "echoes");
  assert.equal(albums[0].trackCount, 12);

  const echoes = await store.getAlbumBySlug("echoes");
  assert.ok(echoes);
  assert.equal(echoes.tracks.length, 12);
  assert.equal(echoes.tracks[0].title, "Echoes of the Storm");
  assert.match(echoes.tracks[0].audioUrl, /^\/media\/songs\//);
  assert.match(echoes.heroUrl, /^\/media\/images\//);

  const album = await store.createAlbum({
    slug: "second-watch",
    title: "Second Watch",
    tagline: "A new album",
    credits: "Spodazo",
    artists: "Brody Vale",
    copyright: "© 2026",
    heroPortrait: "",
    thumb: "",
    sortOrder: 2,
  });
  const track = await store.createTrack({
    albumId: album.id,
    n: 1,
    title: "First Light",
    scripture: "Psalm 1",
    file: "first-light.mp3",
    img: "first-light.webp",
    key: "s1",
    lyrics: "Hello",
    introduction: "A short note before the lyrics.",
    instrumental: false,
    slug: "first-light",
  });
  const loaded = await store.getAlbumBySlug("second-watch");
  assert.ok(loaded);
  assert.equal(loaded.tracks.length, 1);
  assert.equal(loaded.tracks[0].id, track.id);
  assert.equal(loaded.tracks[0].introduction, "A short note before the lyrics.");

  await store.updateTrack(track.id, { title: "First Light (edit)" });
  const edited = await store.getAlbumBySlug("second-watch");
  assert.equal(edited?.tracks[0].title, "First Light (edit)");

  const second = await store.createTrack({
    albumId: album.id,
    n: 2,
    title: "Second Light",
    slug: "second-light",
  });
  await store.reorderTracks(album.id, [second.id, track.id]);
  const reordered = await store.getAlbumBySlug("second-watch");
  assert.equal(reordered?.tracks[0].title, "Second Light");
  assert.equal(reordered?.tracks[1].title, "First Light (edit)");

  await store.updateAlbum(album.id, { hidden: true });
  const hidden = await store.getAlbumBySlug("second-watch");
  assert.equal(hidden?.hidden, true);

  await store.reorderAlbums([album.id, albums[0].id]);
  const listed = await store.listAlbums();
  assert.equal(listed.length, 2);
  assert.equal(listed[0].slug, "second-watch");
  assert.equal(listed[1].slug, "echoes");

  await store.setTrackArchived(track.id, true);
  const afterArchive = await store.getAlbumBySlug("second-watch");
  assert.equal(afterArchive?.tracks.length, 1);
  assert.equal(afterArchive?.tracks[0].title, "Second Light");
  assert.equal(afterArchive?.archivedTracks.length, 1);
  assert.equal(afterArchive?.archivedTracks[0].id, track.id);
  assert.equal(afterArchive?.archivedTracks[0].archived, true);
  const listedAfterArchive = await store.listAlbums();
  assert.equal(listedAfterArchive.find((item) => item.id === album.id)?.trackCount, 1);

  await store.setTrackArchived(track.id, false);
  const afterRestore = await store.getAlbumBySlug("second-watch");
  assert.equal(afterRestore?.archivedTracks.length, 0);
  assert.equal(afterRestore?.tracks.length, 2);
  assert.ok(afterRestore?.tracks.some((item) => item.id === track.id && !item.archived));
});
