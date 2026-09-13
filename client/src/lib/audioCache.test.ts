import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  HAVE_CURRENT_DATA,
  HEADER_HOLD,
  MOBILE_HEADER_FADE_MS,
  MOBILE_HEADER_HOLD_MS,
  isMobilePlayback,
  isResumeTime,
  mediaUrl,
  pipelineIsDead,
  playSong,
  waitForAudible,
} from "./audioCache";

if (typeof globalThis.window === "undefined") {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: globalThis,
  });
}
if (!("location" in window) || !window.location?.href) {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { href: "https://spodazomusic.com/" },
  });
}
if (typeof globalThis.requestAnimationFrame !== "function") {
  globalThis.requestAnimationFrame = (fn: FrameRequestCallback) =>
    setTimeout(() => fn(performance.now()), 0) as unknown as number;
}

function fakeAudio() {
  let src = "";
  const audio = {
    currentSrc: "",
    muted: false,
    volume: 1,
    paused: false,
    currentTime: 0,
    error: null,
    readyState: 4,
    get src() {
      return src;
    },
    set src(value: string) {
      src = new URL(value, window.location.href).href;
      this.currentSrc = src;
    },
    play() {
      this.paused = false;
      return Promise.resolve();
    },
    load() {},
    removeAttribute(name: string) {
      if (name === "src") {
        src = "";
        this.currentSrc = "";
      }
    },
    addEventListener() {},
    removeEventListener() {},
  };
  return audio;
}

function stubUserAgent(ua: string) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { userAgent: ua, platform: "", maxTouchPoints: 0 },
  });
  return () => {
    if (previous) Object.defineProperty(globalThis, "navigator", previous);
    else delete (globalThis as { navigator?: Navigator }).navigator;
  };
}

test("mediaUrl only adds a start fragment when resuming mid-song", () => {
  assert.equal(mediaUrl("/media/songs/a.mp3?v=4"), "/media/songs/a.mp3?v=4");
  assert.equal(mediaUrl("/media/songs/a.mp3?v=4#t=9.00", 0), "/media/songs/a.mp3?v=4");
  assert.equal(mediaUrl("/media/songs/a.mp3?v=4", 0.05), "/media/songs/a.mp3?v=4");
  assert.equal(mediaUrl("/media/songs/a.mp3?v=4", 45.2), "/media/songs/a.mp3?v=4#t=45.20");
});

test("a song start is not treated as a mid-song resume", () => {
  assert.equal(isResumeTime(0), false);
  assert.equal(isResumeTime(0.05), false);
  assert.equal(isResumeTime(HEADER_HOLD), false);
  assert.equal(isResumeTime(12), true);
});

test("waitForAudible resolves immediately when the playhead is already past the header", async () => {
  await waitForAudible({ currentTime: 0.4, addEventListener() {}, removeEventListener() {} } as unknown as HTMLAudioElement, 0.22);
});

test("opener mute is not used on desktop user agents", () => {
  assert.equal(isMobilePlayback(), false);
});

test("iPhone user agents use the mobile opener", () => {
  const restore = stubUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)");
  try {
    assert.equal(isMobilePlayback(), true);
  } finally {
    restore();
  }
});

test("pipelineIsDead is true only when the element cannot play", () => {
  assert.equal(pipelineIsDead({ error: null, readyState: HAVE_CURRENT_DATA } as HTMLAudioElement), false);
  assert.equal(pipelineIsDead({ error: null, readyState: 3 } as HTMLAudioElement), false);
  assert.equal(pipelineIsDead({ error: null, readyState: 1 } as HTMLAudioElement), true);
  assert.equal(pipelineIsDead({ error: {} as MediaError, readyState: 3 } as HTMLAudioElement), true);
});

test("the mobile opener stay shorter than a lost first note", () => {
  assert.ok(MOBILE_HEADER_HOLD_MS <= 40);
  assert.ok(MOBILE_HEADER_FADE_MS <= 40);
  assert.ok(MOBILE_HEADER_HOLD_MS + MOBILE_HEADER_FADE_MS <= 80);
});

test("desktop playSong starts unmuted at full volume", async () => {
  const audio = fakeAudio();
  await playSong(audio as unknown as HTMLAudioElement, "/media/songs/a.mp3", 0, false, 1);
  assert.equal(audio.muted, false);
  assert.equal(audio.volume, 1);
  assert.equal(audio.paused, false);
});

test("mobile playSong mutes only for the short opener, then unmutes", async () => {
  const restore = stubUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)");
  const audio = fakeAudio();
  try {
    const started = playSong(audio as unknown as HTMLAudioElement, "/media/songs/a.mp3", 0, false, 1);
    await started;
    assert.equal(audio.muted, true);
    assert.equal(audio.volume, 0);
    await new Promise((resolve) => setTimeout(resolve, MOBILE_HEADER_HOLD_MS + 20));
    assert.equal(audio.muted, false);
  } finally {
    restore();
  }
});

test("playback helpers never prefetch, blob-play, or wait on the playhead", () => {
  const src = readFileSync(new URL("./audioCache.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /createObjectURL/);
  assert.doesNotMatch(src, /blob:/);
  assert.doesNotMatch(src, /caches\.open/);
  assert.match(src, /resume \|\| !isMobilePlayback\(\)/);
  assert.match(src, /MOBILE_HEADER_HOLD_MS/);
});
