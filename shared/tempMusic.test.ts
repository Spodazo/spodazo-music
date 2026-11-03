import assert from "node:assert/strict";
import test from "node:test";
import {
  planTempMusicSync,
  stableSnapshots,
  validateSyncFiles,
} from "./tempMusic";

const HASH = "a".repeat(64);

test("Temp Music sync plan uploads, replaces, and names removals", () => {
  const first = validateSyncFiles([{ name: "2 Early.mp3", size: 1200, sha256: HASH }]);
  assert.ok(Array.isArray(first));
  const plan = planTempMusicSync({}, first);
  assert.deepEqual(plan.upload, ["2 Early.mp3"]);
  assert.deepEqual(plan.remove, []);

  const nextHash = "b".repeat(64);
  const desired = validateSyncFiles([
    { name: "2 Early.mp3", size: 1400, sha256: nextHash },
    { name: "10 Late.mp3", size: 1200, sha256: HASH },
  ]);
  assert.ok(Array.isArray(desired));
  const again = planTempMusicSync({ "2 Early.mp3": { sha256: HASH, size: 1200 }, "Gone.mp3": { sha256: HASH, size: 10 } }, desired);
  assert.deepEqual(again.upload, ["2 Early.mp3", "10 Late.mp3"]);
  assert.deepEqual(again.unchanged, []);
  assert.deepEqual(again.remove, ["Gone.mp3"]);
});

test("Temp Music sync refuses paths and half-written files", () => {
  const nested = validateSyncFiles([{ name: "../Secret.mp3", size: 1200, sha256: HASH }]);
  assert.ok(Array.isArray(nested));
  if (!Array.isArray(nested)) return;
  assert.equal(nested[0].name, "Secret.mp3");
  assert.deepEqual(validateSyncFiles([{ name: "notes.txt", size: 1200, sha256: HASH }]), {
    error: "Only MP3 files can sync to Temp Music",
  });
  assert.equal(
    stableSnapshots(
      [{ name: "A.mp3", size: 10, mtimeMs: 1 }],
      [{ name: "A.mp3", size: 20, mtimeMs: 2 }],
    ).ready,
    false,
  );
  assert.equal(
    stableSnapshots(
      [{ name: "A.mp3", size: 10, mtimeMs: 1 }],
      [{ name: "A.mp3", size: 10, mtimeMs: 1 }],
    ).ready,
    true,
  );
  assert.equal(stableSnapshots([], [{ name: "A.mp3", size: 0, mtimeMs: 1 }]).ready, false);
});
