import assert from "node:assert/strict";
import test from "node:test";
import { isLinkOnlyAlbum, visibleHomeAlbums } from "./privateAlbums";

test("an admin still sees hidden Temp and Christmas albums", () => {
  const albums = visibleHomeAlbums([
    { slug: "echoes", title: "Echoes", hidden: false },
    { slug: "temp-music", title: "Temp Music", hidden: true },
    { slug: "temp-christmas-2026", title: "Christmas 2026", hidden: true },
    { slug: "heart-songs", title: "Heart Songs", hidden: true },
    { slug: "heart-songs", title: "Heart Songs", hidden: false },
  ]);
  assert.deepEqual(albums.map((album) => album.title), ["Echoes", "Temp Music", "Christmas 2026", "Heart Songs"]);
});

test("Josh is link-only by title or slug", () => {
  assert.equal(isLinkOnlyAlbum({ title: "Josh", slug: "drafts" }), true);
  assert.equal(isLinkOnlyAlbum({ title: " joshua ", slug: "josh" }), true);
  assert.equal(isLinkOnlyAlbum({ title: "Echoes", slug: "echoes" }), false);
});
