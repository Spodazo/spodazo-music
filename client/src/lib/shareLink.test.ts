import assert from "node:assert/strict";
import test from "node:test";
import { songSharePath, songShareUrl } from "./shareLink";

test("song share links use the album path and song hash", () => {
  assert.equal(songSharePath("echoes", "our-light"), "/echoes#our-light");
  assert.equal(
    songShareUrl("https://spodazomusic.com", "vision", "house-of-many-mansions"),
    "https://spodazomusic.com/vision#house-of-many-mansions",
  );
});
