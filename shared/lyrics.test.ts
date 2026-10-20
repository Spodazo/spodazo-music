import assert from "node:assert/strict";
import test from "node:test";
import { lyricLines, lyricSectionLabel } from "./lyrics";

test("section labels drop square brackets and stay headings", () => {
  const lines = lyricLines(`[Verse 1]
Blessed the man who trusts the Lord,
whose hope in Him is stayed;

[Chorus]
He does not fear when heat shall come,
[Bridge — Spoken Word]
[Acoustic Guitar Ensemble Break]`);

  assert.deepEqual(
    lines.filter((line) => line.heading).map((line) => line.text),
    ["Verse 1", "Chorus", "Bridge — Spoken Word", "Acoustic Guitar Ensemble Break"],
  );
  assert.equal(lines.some((line) => line.text.includes("[") || line.text.includes("]")), false);
  assert.deepEqual(lines[1], {
    heading: false,
    text: "Blessed the man who trusts the Lord,",
  });
  assert.equal(lines[3].text, "");
});

test("named sections without brackets are still headings", () => {
  assert.equal(lyricSectionLabel("Chorus"), "Chorus");
  assert.equal(lyricSectionLabel("  Verse 2  "), "Verse 2");
  assert.equal(lyricSectionLabel("like a tree beside the stream,"), null);
});
