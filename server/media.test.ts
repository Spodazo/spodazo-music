import assert from "node:assert/strict";
import test from "node:test";
import { audioUrl, imageUrl } from "./media";

test("media urls stay on this app", () => {
  assert.equal(imageUrl("Echoes of the Storm.webp"), "/media/images/Echoes%20of%20the%20Storm.webp");
  assert.equal(
    audioUrl("Echoes of the Storm (Job 5).mp3"),
    "/media/songs/Echoes%20of%20the%20Storm%20(Job%205).mp3?v=2",
  );
  assert.equal(imageUrl(""), "");
  assert.equal(audioUrl(""), "");
});
