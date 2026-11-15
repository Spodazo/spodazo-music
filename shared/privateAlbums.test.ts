import assert from "node:assert/strict";
import test from "node:test";
import { visibleHomeAlbums } from "./privateAlbums";

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
