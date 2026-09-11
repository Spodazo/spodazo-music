import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DEFAULT_PLAYER_SETUP, SITE_COPYRIGHT } from "../shared/seed-data";
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
  const byId = await store.getTrackById(echoes.tracks[0].id);
  assert.equal(byId?.title, "Echoes of the Storm");
  assert.equal(byId?.file, echoes.tracks[0].file);
  assert.match(echoes.tracks[0].audioUrl, /^\/media\/songs\//);
  assert.match(echoes.heroUrl, /^\/media\/images\//);
  assert.equal(echoes.copyright, SITE_COPYRIGHT);

  const album = await store.createAlbum({
    slug: "second-watch",
    title: "Second Watch",
    artists: "Brody Vale",
    heroPortrait: "",
    thumb: "",
    sortOrder: 2,
  });
  assert.equal(album.tagline, DEFAULT_PLAYER_SETUP.theme);
  assert.equal(album.credits, DEFAULT_PLAYER_SETUP.credits);
  assert.equal(album.copyright, SITE_COPYRIGHT);
  assert.equal(album.color, "ink");
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
  assert.equal(loaded.tracks[0].durationLabel, "");

  const xing = Buffer.alloc(576, 0);
  xing[0] = 0xff;
  xing[1] = 0xfb;
  xing[2] = 0xb4;
  xing[3] = 0x44;
  xing.write("Xing", 36);
  xing.writeUInt32BE(1, 40);
  xing.writeUInt32BE(417, 44);
  fs.writeFileSync(path.join(dir, "songs", "first-light.mp3"), Buffer.concat([xing, Buffer.alloc(500)]));
  const timed = await store.getAlbumBySlug("second-watch");
  assert.equal(timed?.tracks[0].durationLabel, "0:10");

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

  assert.deepEqual(await store.getPlayerSetup(), DEFAULT_PLAYER_SETUP);
  const saved = await store.updatePlayerSetup({ appName: "New Player" });
  assert.equal(saved.appName, "New Player");
  assert.equal(saved.theme, DEFAULT_PLAYER_SETUP.theme);
  assert.equal(saved.collectionCover, "");
  assert.equal(saved.logo, "");
  assert.equal(saved.collectionColor, "ink");
  assert.equal((await store.getPlayerSetup()).appName, "New Player");
  const withColor = await store.updatePlayerSetup({ collectionColor: "navy" });
  assert.equal(withColor.collectionColor, "navy");
  const withCover = await store.updatePlayerSetup({ collectionCover: "Collection.webp" });
  assert.equal(withCover.collectionCover, "Collection.webp");
  assert.match(withCover.collectionCoverUrl, /Collection\.webp/);
  assert.equal((await store.getPlayerSetup()).collectionCover, "Collection.webp");
  const withLogo = await store.updatePlayerSetup({ logo: "Mark.webp" });
  assert.equal(withLogo.logo, "Mark.webp");
  assert.match(withLogo.logoUrl, /Mark\.webp/);
  assert.equal((await store.getPlayerSetup()).logo, "Mark.webp");
  assert.deepEqual(await store.getCurator(), { firstName: "", lastName: "", email: "" });
  assert.equal((await store.getCuratorRecord()).passwordHash, "");
  const curator = await store.updateCurator({ firstName: "Wernard", lastName: "Broodryk", email: "w@example.com", passwordHash: "hashed" });
  assert.deepEqual(curator, { firstName: "Wernard", lastName: "Broodryk", email: "w@example.com" });
  assert.equal((await store.getCuratorRecord()).passwordHash, "hashed");
  assert.equal("passwordHash" in curator, false);
  const afterName = await store.getAlbumBySlug("echoes");
  assert.equal(afterName?.copyright, DEFAULT_PLAYER_SETUP.copyright);
});
