import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { uniqueFileName } from "./paths";

test("uniqueFileName avoids overwriting an existing file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spodazo-music-"));
  fs.writeFileSync(path.join(dir, "Our Light.mp3"), "a");
  assert.equal(uniqueFileName(dir, "Our Light.mp3"), "Our Light-2.mp3");
  assert.equal(uniqueFileName(dir, "New Song.mp3"), "New Song.mp3");
});
