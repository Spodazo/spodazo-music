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
  attachOutput,
  markOutputNeedsRebuild,
  outputGraphIsStale,
  outputRebuildIsPending,
  shouldRebuildOutput,
  pipelineIsDead,
  playSong,
  releaseOutput,
  restoreMobileOutput,
  setOutputLevel,
  waitForAudible,
  watchPlaybackRoute,
  resumeLiveOutput,
  resumePlaybackAfterInterrupt,
  shouldReroutePlayback,
  type PlaybackSnapshot,
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
if (typeof globalThis.document === "undefined") {
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      hidden: false,
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return true;
      },
    },
  });
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
  assert.match(src, /resume \|\| !mobile \|\| keepAudible/);
  assert.match(src, /MOBILE_HEADER_HOLD_MS/);
  assert.match(src, /interruptionend/);
  assert.match(src, /devicechange/);
});

function stubAudioSession() {
  const listeners = new Map<string, Set<(event?: Event) => void>>();
  const session = {
    type: "playback",
    addEventListener(type: string, fn: (event?: Event) => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: (event?: Event) => void) {
      listeners.get(type)?.delete(fn);
    },
    dispatch(type: string) {
      for (const fn of listeners.get(type) || []) fn();
    },
  };
  const devices = {
    addEventListener(type: string, fn: (event?: Event) => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: (event?: Event) => void) {
      listeners.get(type)?.delete(fn);
    },
    dispatch(type: string) {
      for (const fn of listeners.get(type) || []) fn();
    },
  };
  const previous = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
      platform: "iPhone",
      maxTouchPoints: 5,
      audioSession: session,
      mediaDevices: devices,
    },
  });
  return {
    session,
    devices,
    restore() {
      if (previous) Object.defineProperty(globalThis, "navigator", previous);
      else delete (globalThis as { navigator?: Navigator }).navigator;
    },
  };
}

test("restoreMobileOutput unmutes after the opener gate has closed", async () => {
  const restore = stubUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)");
  const audio = fakeAudio();
  try {
    const started = playSong(audio as unknown as HTMLAudioElement, "/media/songs/a.mp3", 0, false, 1);
    await started;
    assert.equal(audio.muted, true);
    restoreMobileOutput(audio as unknown as HTMLAudioElement, 0.85);
    assert.equal(audio.muted, false);
    setOutputLevel(audio as unknown as HTMLAudioElement, 0.7);
    assert.equal(audio.volume, 0.7);
  } finally {
    restore();
  }
});

test("a phone call pauses playback without rebuilding on session interruption end", async () => {
  const stub = stubAudioSession();
  const restoreCtx = stubAudioContext();
  const audio = fakeAudio();
  audio.src = "/media/songs/a.mp3";
  audio.currentTime = 42;
  audio.paused = false;
  const graph = attachOutput(audio as unknown as HTMLAudioElement, 0.8);
  if (graph) graph.ctx.state = "interrupted";
  let rerouted = false;
  const stop = watchPlaybackRoute(
    () => audio as unknown as HTMLAudioElement,
    () => {
      rerouted = true;
    },
  );
  try {
    stub.session.dispatch("interruptionbegin");
    audio.paused = true;
    stub.session.dispatch("interruptionend");
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(rerouted, false);
    assert.equal(audio.paused, false);
  } finally {
    stop();
    stub.restore();
    restoreCtx();
  }
});

test("another app opening or closing does not tear down a song that is still playing", () => {
  const audio = fakeAudio() as unknown as HTMLAudioElement;
  audio.paused = false;
  assert.equal(shouldReroutePlayback(audio, "visibility"), false);
  assert.equal(shouldReroutePlayback(audio, "interruptionend"), false);
  audio.paused = true;
  assert.equal(shouldReroutePlayback(audio, "visibility"), false);
  assert.equal(shouldReroutePlayback(audio, "interruptionend"), false);
  assert.equal(shouldReroutePlayback(audio, "devicechange"), true);
});

test("closing another phone app does not pause or rebuild a playing song", async () => {
  const stub = stubAudioSession();
  const audio = fakeAudio();
  audio.src = "/media/songs/a.mp3";
  audio.currentTime = 20;
  audio.paused = false;
  let rerouted = false;
  const stop = watchPlaybackRoute(
    () => audio as unknown as HTMLAudioElement,
    () => {
      rerouted = true;
    },
  );
  try {
    stub.session.dispatch("interruptionbegin");
    stub.session.dispatch("interruptionend");
    if (typeof document !== "undefined") {
      document.dispatchEvent(new Event("visibilitychange"));
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(audio.paused, false);
    assert.equal(rerouted, false);
  } finally {
    stop();
    stub.restore();
  }
});

test("when another app ducks Music in the background, playback resumes without a rebuild", async () => {
  const stub = stubAudioSession();
  const audio = fakeAudio();
  audio.src = "/media/songs/a.mp3";
  audio.currentTime = 33;
  audio.paused = false;
  let rerouted = false;
  const stop = watchPlaybackRoute(
    () => audio as unknown as HTMLAudioElement,
    () => {
      rerouted = true;
    },
  );
  try {
    stub.session.dispatch("interruptionbegin");
    audio.paused = true;
    stub.session.dispatch("interruptionend");
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(rerouted, false);
    assert.equal(audio.paused, false);
  } finally {
    stop();
    stub.restore();
  }
});

test("switching Bluetooth devices asks the player to rebuild the live audio element", async () => {
  const stub = stubAudioSession();
  const audio = fakeAudio();
  audio.src = "/media/songs/a.mp3";
  audio.currentTime = 18;
  audio.paused = false;
    let snapshot: PlaybackSnapshot | undefined;
    const stop = watchPlaybackRoute(
      () => audio as unknown as HTMLAudioElement,
      (next) => {
        snapshot = next;
      },
    );
    try {
      stub.devices.dispatch("devicechange");
      await new Promise((resolve) => setTimeout(resolve, 80));
      assert.ok(snapshot);
      assert.equal(snapshot.time, 18);
      assert.equal(snapshot.playing, true);
  } finally {
    stop();
    stub.restore();
  }
});

test("a mobile pause marks the output graph so the next play rebuilds it", async () => {
  const restore = stubUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)");
  const audio = fakeAudio();
  try {
    markOutputNeedsRebuild();
    assert.equal(outputRebuildIsPending(), true);
    await playSong(audio as unknown as HTMLAudioElement, "/media/songs/a.mp3", 12, false, 1);
    assert.equal(outputRebuildIsPending(), false);
  } finally {
    restore();
  }
});

test("desktop pause does not mark the output graph for rebuild", () => {
  markOutputNeedsRebuild();
  assert.equal(outputRebuildIsPending(), false);
  assert.equal(outputGraphIsStale(fakeAudio() as unknown as HTMLAudioElement), false);
});

function stubAudioContext() {
  const previous = window.AudioContext;
  class FakeContext {
    state = "running";
    currentTime = 0;
    destination = {};
    onstatechange: (() => void) | null = null;
    createMediaElementSource() {
      return { connect() {} };
    }
    createGain() {
      return {
        gain: {
          value: 0,
          cancelScheduledValues() {},
          setValueAtTime() {},
          linearRampToValueAtTime() {},
        },
        connect() {},
        disconnect() {},
      };
    }
    addEventListener() {}
    removeEventListener() {}
    resume() {
      return Promise.resolve();
    }
    close() {
      return Promise.resolve();
    }
  }
  Object.defineProperty(window, "AudioContext", { configurable: true, value: FakeContext });
  return () => {
    if (previous) Object.defineProperty(window, "AudioContext", { configurable: true, value: previous });
    else delete (window as { AudioContext?: typeof AudioContext }).AudioContext;
  };
}

test("a mobile song change rebuilds the output graph", () => {
  const restoreUa = stubUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)");
  const restoreCtx = stubAudioContext();
  const audio = fakeAudio() as unknown as HTMLAudioElement;
  audio.src = "/media/songs/a.mp3";
  try {
    attachOutput(audio);
    assert.equal(shouldRebuildOutput(audio, "/media/songs/a.mp3"), false);
    assert.equal(shouldRebuildOutput(audio, "/media/songs/b.mp3"), true);
  } finally {
    restoreCtx();
    restoreUa();
  }
});

test("desktop song change does not rebuild the output graph", () => {
  const audio = fakeAudio() as unknown as HTMLAudioElement;
  audio.src = "/media/songs/a.mp3";
  assert.equal(shouldRebuildOutput(audio, "/media/songs/b.mp3"), false);
});

test("a mobile continuation stays unmuted when keepAudible is set", async () => {
  const restore = stubUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)");
  const audio = fakeAudio();
  try {
    await playSong(audio as unknown as HTMLAudioElement, "/media/songs/b.mp3", 0, true, 1, true);
    assert.equal(audio.muted, false);
    assert.equal(audio.volume, 1);
  } finally {
    restore();
  }
});

test("the next mobile song reuses the live audio context instead of opening a silent one", async () => {
  const restoreUa = stubUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)");
  const created: Array<{ closed: boolean }> = [];
  const gains: number[] = [];
  const previous = window.AudioContext;
  class FakeContext {
    state = "running";
    currentTime = 0;
    destination = {};
    onstatechange: (() => void) | null = null;
    closed = false;
    constructor() {
      created.push(this);
    }
    createMediaElementSource() {
      return { connect() {}, disconnect() {} };
    }
    createGain() {
      const gain = {
        value: 0,
        cancelScheduledValues() {},
        setValueAtTime(value: number) {
          gain.value = value;
          gains.push(value);
        },
        linearRampToValueAtTime() {},
      };
      return { gain, connect() {}, disconnect() {} };
    }
    addEventListener() {}
    removeEventListener() {}
    resume() {
      return Promise.resolve();
    }
    close() {
      this.closed = true;
      this.state = "closed";
      return Promise.resolve();
    }
  }
  Object.defineProperty(window, "AudioContext", { configurable: true, value: FakeContext });
  const first = fakeAudio() as unknown as HTMLAudioElement;
  const next = fakeAudio() as unknown as HTMLAudioElement;
  try {
    attachOutput(first);
    releaseOutput(first);
    await playSong(next, "/media/songs/b.mp3", 0, true, 0.85, true);
    assert.equal(created.length, 1);
    assert.equal(created[0].closed, false);
    assert.equal(next.muted, false);
    assert.ok(gains.includes(0.85));
  } finally {
    restoreUa();
    if (previous) Object.defineProperty(window, "AudioContext", { configurable: true, value: previous });
    else delete (window as { AudioContext?: typeof AudioContext }).AudioContext;
  }
});

test("a mobile continuation does not open an audio context outside a tap", async () => {
  const restoreUa = stubUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)");
  let constructed = 0;
  const previous = window.AudioContext;
  class FakeContext {
    state = "running";
    currentTime = 0;
    destination = {};
    onstatechange: (() => void) | null = null;
    constructor() {
      constructed += 1;
    }
    createMediaElementSource() {
      return { connect() {}, disconnect() {} };
    }
    createGain() {
      return {
        gain: {
          value: 0,
          cancelScheduledValues() {},
          setValueAtTime() {},
          linearRampToValueAtTime() {},
        },
        connect() {},
        disconnect() {},
      };
    }
    addEventListener() {}
    removeEventListener() {}
    resume() {
      return Promise.resolve();
    }
    close() {
      return Promise.resolve();
    }
  }
  Object.defineProperty(window, "AudioContext", { configurable: true, value: FakeContext });
  const audio = fakeAudio();
  try {
    await playSong(audio as unknown as HTMLAudioElement, "/media/songs/b.mp3", 0, true, 0.85, true);
    assert.equal(constructed, 0);
    assert.equal(audio.muted, false);
    assert.equal(audio.volume, 0.85);
  } finally {
    restoreUa();
    if (previous) Object.defineProperty(window, "AudioContext", { configurable: true, value: previous });
    else delete (window as { AudioContext?: typeof AudioContext }).AudioContext;
  }
});

test("desktop playback does not rebuild on Bluetooth or call events", async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const listeners = new Map<string, Set<(event?: Event) => void>>();
  const session = {
    addEventListener(type: string, fn: (event?: Event) => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: (event?: Event) => void) {
      listeners.get(type)?.delete(fn);
    },
    dispatch(type: string) {
      for (const fn of listeners.get(type) || []) fn();
    },
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      platform: "MacIntel",
      maxTouchPoints: 0,
      audioSession: session,
    },
  });
  const audio = fakeAudio();
  audio.src = "/media/songs/a.mp3";
  let called = false;
  const stop = watchPlaybackRoute(
    () => audio as unknown as HTMLAudioElement,
    () => {
      called = true;
    },
  );
  try {
    session.dispatch("interruptionend");
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(called, false);
  } finally {
    stop();
    if (previous) Object.defineProperty(globalThis, "navigator", previous);
    else delete (globalThis as { navigator?: Navigator }).navigator;
  }
});
