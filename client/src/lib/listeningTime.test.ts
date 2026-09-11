import assert from "node:assert/strict";
import test from "node:test";
import { formatListeningTime, parseDurationLabel, totalListeningLabel } from "./listeningTime";

test("parseDurationLabel reads m:ss and h:mm:ss", () => {
  assert.equal(parseDurationLabel("7:01"), 421);
  assert.equal(parseDurationLabel("1:02:03"), 3723);
  assert.equal(parseDurationLabel(""), 0);
  assert.equal(parseDurationLabel("—"), 0);
});

test("formatListeningTime uses minutes and hours", () => {
  assert.equal(formatListeningTime(52 * 60), "52 min");
  assert.equal(formatListeningTime(60 * 60), "1 hr");
  assert.equal(formatListeningTime(84 * 60 + 20), "1 hr 24 min");
  assert.equal(formatListeningTime(10), "");
});

test("totalListeningLabel sums album track times", () => {
  assert.equal(totalListeningLabel(["7:01", "6:40", "5:20"]), "19 min");
  assert.equal(
    totalListeningLabel(["7:01", "6:40", "5:20", "8:10", "4:55", "9:00", "6:12", "7:30", "5:48", "6:05", "8:22", "7:15"]),
    "1 hr 22 min",
  );
});
