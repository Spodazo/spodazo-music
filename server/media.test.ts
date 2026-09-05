import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { audioUrl, imageUrl } from "./media";

test("empty local files fall back to the live WordPress origin", () => {
  process.env.MUSIC_DATA_DIR = path.join(os.tmpdir(), "spodazo-music-empty");
  process.env.MUSIC_ORIGIN = "https://music.spodazo.com";
  assert.equal(
    imageUrl("Echoes of the Storm.webp"),
    "https://music.spodazo.com/Images/Echoes%20of%20the%20Storm.webp",
  );
  assert.equal(
    audioUrl("Echoes of the Storm (Job 5).mp3"),
    "https://music.spodazo.com/Songs/Echoes%20of%20the%20Storm%20(Job%205).mp3",
  );
});
