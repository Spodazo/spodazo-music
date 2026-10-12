import assert from "node:assert/strict";
import test from "node:test";
import {
  buildReloadUrl,
  readStoredRevision,
  shouldApplyUpdate,
  stripBuildParam,
  versionRevision,
  writeStoredRevision,
} from "./appUpdate";

test("shouldApplyUpdate waits for two different builds", () => {
  assert.equal(shouldApplyUpdate("", "abc"), false);
  assert.equal(shouldApplyUpdate("abc", "abc"), false);
  assert.equal(shouldApplyUpdate("abc", "def"), true);
});

test("versionRevision changes when songs or lyrics change without a deploy", () => {
  assert.equal(versionRevision({ build: "deploy1", catalog: "100" }), "deploy1:100");
  assert.equal(versionRevision({ build: "deploy1", catalog: "100" }), versionRevision({ build: "deploy1", catalog: "100" }));
  assert.notEqual(
    versionRevision({ build: "deploy1", catalog: "100" }),
    versionRevision({ build: "deploy1", catalog: "200" }),
  );
  assert.equal(shouldApplyUpdate("deploy1:100", "deploy1:200"), true);
  assert.equal(versionRevision({ build: "", catalog: "1" }), "");
});

test("buildReloadUrl stamps the build and keeps the song hash", () => {
  assert.equal(
    buildReloadUrl("https://spodazomusic.com/echoes-of-storms#armor-of-god", "railwaysha1234567890"),
    "/echoes-of-storms?_spodazo=railwaysha123456#armor-of-god",
  );
  assert.equal(
    buildReloadUrl("https://spodazomusic.com/echoes-of-storms#armor-of-god", "railwaysha1234567890:99"),
    "/echoes-of-storms?_spodazo=railwaysha123456#armor-of-god",
  );
});

test("stored revision remembers the build that last ran", () => {
  const memory = new Map<string, string>();
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: {
      getItem(key: string) {
        return memory.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        memory.set(key, value);
      },
    },
  });
  writeStoredRevision("build-a");
  assert.equal(readStoredRevision(), "build-a");
  assert.equal(shouldApplyUpdate(readStoredRevision(), "build-b"), true);
});

test("stripBuildParam removes only the update stamp", () => {
  assert.equal(
    stripBuildParam("https://spodazomusic.com/echoes-of-storms?_spodazo=abc&x=1#armor-of-god"),
    "/echoes-of-storms?x=1#armor-of-god",
  );
  assert.equal(stripBuildParam("https://spodazomusic.com/admin"), "/admin");
});
