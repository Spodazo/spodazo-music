import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildReloadUrl,
  isCodeUpdate,
  readStoredRevision,
  shouldApplyUpdate,
  shouldHoldAppUpdate,
  stripBuildParam,
  updateApplyMode,
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
  assert.equal(isCodeUpdate("deploy1:100", "deploy1:200"), false);
  assert.equal(isCodeUpdate("deploy1:100", "deploy2:100"), true);
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
  const session = new Map<string, string>();
  const local = new Map<string, string>();
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: {
      getItem(key: string) {
        return session.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        session.set(key, value);
      },
    },
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem(key: string) {
        return local.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        local.set(key, value);
      },
    },
  });
  writeStoredRevision("build-a");
  assert.equal(readStoredRevision(), "build-a");
  session.clear();
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

test("visible idle clients refresh on deploy and on song add/replace", () => {
  assert.equal(shouldHoldAppUpdate(false), false);
  assert.equal(shouldHoldAppUpdate(false, 8000), false);
  assert.equal(updateApplyMode("deploy1:100", "deploy1:200"), "catalog");
  assert.equal(updateApplyMode("deploy1:100", "deploy2:100"), "reload");
  assert.equal(updateApplyMode("deploy1:100", "deploy1:100"), "none");
});

test("a loaded or just-started song is never yanked by a full-page reload", () => {
  assert.equal(shouldHoldAppUpdate(true), true);
  assert.equal(shouldHoldAppUpdate(true, 8000), true);
  assert.equal(shouldHoldAppUpdate(false, 400), true);
  assert.equal(shouldHoldAppUpdate(false, 6000), false);
});

test("a deploy cache-busts every PWA even while a song is playing", () => {
  const src = readFileSync(new URL("./appUpdate.ts", import.meta.url), "utf8");
  const apply = src.slice(src.indexOf("async function applyWhenIdle"), src.indexOf("async function check"));
  assert.match(apply, /mode === "catalog"/);
  assert.match(apply, /await reloadNow\(revision\)/);
  assert.doesNotMatch(apply, /isBusy/);
  assert.doesNotMatch(apply, /pendingRevision/);
  assert.doesNotMatch(src, /querySelectorAll\("audio"\)/);
  assert.equal(updateApplyMode("deploy1:100", "deploy2:100"), "reload");
  assert.equal(updateApplyMode("deploy1:100", "deploy1:200"), "catalog");
});

test("the HTML page itself reloads on a deploy without waiting for a user to relaunch", () => {
  const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
  assert.match(html, /spodazo-music-app-rev/);
  assert.match(html, /\/api\/version/);
  assert.match(html, /location\.replace/);
  assert.doesNotMatch(html, /querySelectorAll\(["']audio["']\)/);
  assert.doesNotMatch(html, /audio\.paused/);
});
