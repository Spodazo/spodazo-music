import assert from "node:assert/strict";
import test from "node:test";
import {
  isRestorablePath,
  LAST_PLACE_KEY,
  readLastPlace,
  restoreLastPlace,
  writeLastPlace,
} from "./lastPlace";

const memory = new Map<string, string>();
const localStorageMock = {
  getItem(key: string) {
    return memory.get(key) ?? null;
  },
  setItem(key: string, value: string) {
    memory.set(key, value);
  },
  removeItem(key: string) {
    memory.delete(key);
  },
  clear() {
    memory.clear();
  },
  key() {
    return null;
  },
  get length() {
    return memory.size;
  },
};

Object.defineProperty(globalThis, "localStorage", { value: localStorageMock, configurable: true });
Object.defineProperty(globalThis, "window", {
  value: { localStorage: localStorageMock },
  configurable: true,
});

test("only an album path is restored after the phone relaunches the app", () => {
  assert.equal(isRestorablePath("/willow-songs"), true);
  assert.equal(isRestorablePath("/"), false);
  assert.equal(isRestorablePath("/admin"), false);
  assert.equal(isRestorablePath("//evil"), false);
});

test("a home-screen launch returns to the album that was playing", () => {
  memory.clear();
  writeLastPlace({ path: "/willow-songs", playing: true, trackId: "t1", time: 42 });
  assert.equal(readLastPlace()?.trackId, "t1");
  assert.equal(restoreLastPlace("/", true), "/willow-songs");
  assert.equal(restoreLastPlace("/", false), "/");
  assert.equal(restoreLastPlace("/admin", true), "/admin");
});

test("choosing the album list keeps the next launch on home", () => {
  memory.clear();
  writeLastPlace({ path: "/willow-songs", playing: true });
  writeLastPlace({ path: "/" });
  assert.equal(restoreLastPlace("/", true), "/");
  assert.equal(memory.get(LAST_PLACE_KEY)?.includes("willow-songs"), false);
});
