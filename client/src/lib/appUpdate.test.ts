import assert from "node:assert/strict";
import test from "node:test";
import { buildReloadUrl, shouldApplyUpdate, stripBuildParam } from "./appUpdate";

test("shouldApplyUpdate waits for two different builds", () => {
  assert.equal(shouldApplyUpdate("", "abc"), false);
  assert.equal(shouldApplyUpdate("abc", "abc"), false);
  assert.equal(shouldApplyUpdate("abc", "def"), true);
});

test("buildReloadUrl stamps the build and keeps the song hash", () => {
  assert.equal(
    buildReloadUrl("https://spodazomusic.com/echoes-of-storms#armor-of-god", "railwaysha1234567890"),
    "/echoes-of-storms?_spodazo=railwaysha123456#armor-of-god",
  );
});

test("stripBuildParam removes only the update stamp", () => {
  assert.equal(
    stripBuildParam("https://spodazomusic.com/echoes-of-storms?_spodazo=abc&x=1#armor-of-god"),
    "/echoes-of-storms?x=1#armor-of-god",
  );
  assert.equal(stripBuildParam("https://spodazomusic.com/admin"), "/admin");
});
