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
  ensureMobileOutputAudible,
  isNativeOutputOnly,
  markOutputNeedsRebuild,
  outputGraphIsStale,
  outputRebuildIsPending,
  shouldRebuildOutput,
  pipelineIsDead,
  playSong,
  releaseOutput,
  releaseOutputForRouteChange,
  resetOutputRouteStateForTests,
  restoreMobileOutput,
  ROUTE_CHANGE_DEBOUNCE_MS,
  setOutputLevel,
  settleRoutePlayback,
  startBackgroundPlaybackGuard,
  unlockAudio,
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
  const restoreUa = stubUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)");
  const restoreCtx = stubAudioContext();
  const audio = fakeAudio() as unknown as HTMLAudioElement;
  try {
    audio.paused = false;
    assert.equal(shouldReroutePlayback(audio, "visibility"), false);
    assert.equal(shouldReroutePlayback(audio, "interruptionend"), false);
    audio.paused = true;
    assert.equal(shouldReroutePlayback(audio, "visibility"), false);
    assert.equal(shouldReroutePlayback(audio, "interruptionend"), false);
    // Native element already follows the system route — no remount without a WebAudio graph.
    assert.equal(shouldReroutePlayback(audio, "devicechange"), false);
    attachOutput(audio, 0.8);
    assert.equal(shouldReroutePlayback(audio, "devicechange"), true);
  } finally {
    releaseOutput(audio);
    restoreCtx();
    restoreUa();
    resetOutputRouteStateForTests();
  }
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
  const restoreCtx = stubAudioContext();
  const audio = fakeAudio() as unknown as HTMLAudioElement;
  audio.src = "/media/songs/a.mp3";
  audio.currentTime = 18;
  audio.paused = false;
  attachOutput(audio, 0.8);
  let snapshot: PlaybackSnapshot | undefined;
  const stop = watchPlaybackRoute(
    () => audio,
    (next) => {
      snapshot = next;
      releaseOutputForRouteChange(audio);
    },
  );
  try {
    stub.devices.dispatch("devicechange");
    await new Promise((resolve) => setTimeout(resolve, ROUTE_CHANGE_DEBOUNCE_MS + 40));
    assert.ok(snapshot);
    assert.equal(snapshot.time, 18);
    assert.equal(snapshot.playing, true);
    assert.equal(isNativeOutputOnly(), true);
  } finally {
    stop();
    stub.restore();
    restoreCtx();
    resetOutputRouteStateForTests();
  }
});

test("car Bluetooth flaps after native remount settle without rebuilding the element", async () => {
  const stub = stubAudioSession();
  const restoreCtx = stubAudioContext();
  const audio = fakeAudio() as unknown as HTMLAudioElement;
  audio.src = "/media/songs/a.mp3";
  audio.currentTime = 22;
  audio.paused = false;
  audio.muted = false;
  audio.volume = 0.8;
  attachOutput(audio, 0.8);
  let reroutes = 0;
  const stop = watchPlaybackRoute(
    () => audio,
    () => {
      reroutes += 1;
      releaseOutputForRouteChange(audio);
    },
    () => 0.8,
  );
  try {
    stub.devices.dispatch("devicechange");
    await new Promise((resolve) => setTimeout(resolve, ROUTE_CHANGE_DEBOUNCE_MS + 40));
    assert.equal(reroutes, 1);
    assert.equal(isNativeOutputOnly(), true);

    // Head unit keeps flipping A2DP/HFP — must not tear down and reload the song again.
    stub.devices.dispatch("devicechange");
    stub.devices.dispatch("devicechange");
    await new Promise((resolve) => setTimeout(resolve, ROUTE_CHANGE_DEBOUNCE_MS + 40));
    assert.equal(reroutes, 1);
    assert.equal(isNativeOutputOnly(), true);
    assert.equal(audio.muted, false);
    assert.equal(audio.volume, 0.8);
    assert.equal(audio.paused, false);

    // Flaps often pause the element after interruptionbegin; settle should resume without remounting.
    stub.session.dispatch("interruptionbegin");
    audio.paused = true;
    stub.devices.dispatch("devicechange");
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(reroutes, 1);
    assert.equal(audio.paused, false);
  } finally {
    stop();
    stub.restore();
    restoreCtx();
    resetOutputRouteStateForTests();
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

test("warm attach before src is set does not force a remount rebuild", () => {
  const restoreUa = stubUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)");
  const restoreCtx = stubAudioContext();
  const audio = fakeAudio() as unknown as HTMLAudioElement;
  try {
    attachOutput(audio);
    // No src yet — pointerdown warm() must not trigger async remount outside the tap.
    assert.equal(shouldRebuildOutput(audio, "/media/songs/a.mp3"), false);
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

test("auto-advance on the same element keeps the live MediaElementSource audible", async () => {
  const restoreUa = stubUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)");
  const sourced = new WeakSet<object>();
  let sourceCreates = 0;
  const gains: number[] = [];
  const previous = window.AudioContext;
  class FakeContext {
    state = "running";
    currentTime = 0;
    destination = {};
    onstatechange: (() => void) | null = null;
    createMediaElementSource(element: object) {
      if (sourced.has(element)) {
        throw new Error("HTMLMediaElement already connected to a MediaElementAudioSourceNode");
      }
      sourced.add(element);
      sourceCreates += 1;
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
      this.state = "closed";
      return Promise.resolve();
    }
  }
  Object.defineProperty(window, "AudioContext", { configurable: true, value: FakeContext });
  const audio = fakeAudio() as unknown as HTMLAudioElement;
  try {
    attachOutput(audio, 0.8);
    assert.equal(sourceCreates, 1);
    await playSong(audio, "/media/songs/b.mp3", 0, true, 0.85, true);
    assert.equal(sourceCreates, 1);
    assert.equal(audio.muted, false);
    assert.ok(gains.includes(0.85));
  } finally {
    restoreUa();
    if (previous) Object.defineProperty(window, "AudioContext", { configurable: true, value: previous });
    else delete (window as { AudioContext?: typeof AudioContext }).AudioContext;
  }
});

test("releasing MediaElementSource on the same element cannot reattach for auto-advance", async () => {
  const restoreUa = stubUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)");
  const sourced = new WeakSet<object>();
  let sourceCreates = 0;
  const previous = window.AudioContext;
  class FakeContext {
    state = "running";
    currentTime = 0;
    destination = {};
    onstatechange: (() => void) | null = null;
    createMediaElementSource(element: object) {
      if (sourced.has(element)) {
        throw new Error("HTMLMediaElement already connected to a MediaElementAudioSourceNode");
      }
      sourced.add(element);
      sourceCreates += 1;
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
      this.state = "closed";
      return Promise.resolve();
    }
  }
  Object.defineProperty(window, "AudioContext", { configurable: true, value: FakeContext });
  const audio = fakeAudio() as unknown as HTMLAudioElement;
  try {
    attachOutput(audio, 0.8);
    releaseOutput(audio);
    await playSong(audio, "/media/songs/b.mp3", 0, true, 0.85, true);
    // Browser forbids a second MediaElementSource on the same element — graph stays missing.
    assert.equal(sourceCreates, 1);
  } finally {
    restoreUa();
    if (previous) Object.defineProperty(window, "AudioContext", { configurable: true, value: previous });
    else delete (window as { AudioContext?: typeof AudioContext }).AudioContext;
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

test("playing-but-silent heals gain and mute without remounting", () => {
  const restoreUa = stubUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)");
  const gains: number[] = [];
  let resumeCalls = 0;
  let sourceCreates = 0;
  const previous = window.AudioContext;
  class FakeContext {
    state = "interrupted";
    currentTime = 0;
    destination = {};
    onstatechange: (() => void) | null = null;
    createMediaElementSource() {
      sourceCreates += 1;
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
      resumeCalls += 1;
      this.state = "running";
      return Promise.resolve();
    }
    close() {
      this.state = "closed";
      return Promise.resolve();
    }
  }
  Object.defineProperty(window, "AudioContext", { configurable: true, value: FakeContext });
  const audio = fakeAudio() as unknown as HTMLAudioElement;
  audio.paused = false;
  audio.muted = true;
  try {
    attachOutput(audio, 0);
    assert.equal(sourceCreates, 1);
    ensureMobileOutputAudible(audio, 0.85);
    assert.equal(audio.muted, false);
    assert.ok(gains.includes(0.85));
    assert.ok(resumeCalls >= 1);
    assert.equal(sourceCreates, 1);
  } finally {
    restoreUa();
    if (previous) Object.defineProperty(window, "AudioContext", { configurable: true, value: previous });
    else delete (window as { AudioContext?: typeof AudioContext }).AudioContext;
  }
});

test("unlockAudio resumes an interrupted context", () => {
  const restoreUa = stubUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)");
  let resumeCalls = 0;
  const previous = window.AudioContext;
  class FakeContext {
    state = "running";
    currentTime = 0;
    destination = {};
    onstatechange: (() => void) | null = null;
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
      resumeCalls += 1;
      this.state = "running";
      return Promise.resolve();
    }
    close() {
      return Promise.resolve();
    }
  }
  Object.defineProperty(window, "AudioContext", { configurable: true, value: FakeContext });
  const audio = fakeAudio() as unknown as HTMLAudioElement;
  audio.paused = true;
  try {
    const graph = attachOutput(audio, 0);
    assert.ok(graph);
    graph!.ctx.state = "interrupted" as AudioContextState;
    resumeCalls = 0;
    unlockAudio(audio);
    assert.ok(resumeCalls >= 1);
  } finally {
    restoreUa();
    if (previous) Object.defineProperty(window, "AudioContext", { configurable: true, value: previous });
    else delete (window as { AudioContext?: typeof AudioContext }).AudioContext;
  }
});

test("background guard restores volume while the element is still playing", async () => {
  const restoreUa = stubUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)");
  const gains: number[] = [];
  const previous = window.AudioContext;
  const docListeners = new Map<string, Set<() => void>>();
  const winListeners = new Map<string, Set<() => void>>();
  const previousDoc = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      hidden: false,
      addEventListener(type: string, fn: () => void) {
        if (!docListeners.has(type)) docListeners.set(type, new Set());
        docListeners.get(type)!.add(fn);
      },
      removeEventListener(type: string, fn: () => void) {
        docListeners.get(type)?.delete(fn);
      },
      dispatchEvent(event: Event) {
        for (const fn of docListeners.get(event.type) || []) fn();
        return true;
      },
    },
  });
  const previousAdd = window.addEventListener;
  const previousRemove = window.removeEventListener;
  window.addEventListener = ((type: string, fn: () => void) => {
    if (!winListeners.has(type)) winListeners.set(type, new Set());
    winListeners.get(type)!.add(fn);
  }) as typeof window.addEventListener;
  window.removeEventListener = ((type: string, fn: () => void) => {
    winListeners.get(type)?.delete(fn);
  }) as typeof window.removeEventListener;
  class FakeContext {
    state = "interrupted";
    currentTime = 0;
    destination = {};
    onstatechange: (() => void) | null = null;
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
      this.state = "running";
      return Promise.resolve();
    }
    close() {
      return Promise.resolve();
    }
  }
  Object.defineProperty(window, "AudioContext", { configurable: true, value: FakeContext });
  const audio = fakeAudio() as unknown as HTMLAudioElement;
  audio.paused = false;
  audio.muted = true;
  attachOutput(audio, 0);
  let stop = () => {};
  try {
    stop = startBackgroundPlaybackGuard(
      () => audio,
      () => true,
      () => 0.7,
    );
    document.dispatchEvent(new Event("visibilitychange"));
    assert.equal(audio.muted, false);
    assert.ok(gains.includes(0.7));
  } finally {
    stop();
    window.addEventListener = previousAdd;
    window.removeEventListener = previousRemove;
    if (previousDoc) Object.defineProperty(globalThis, "document", previousDoc);
    restoreUa();
    if (previous) Object.defineProperty(window, "AudioContext", { configurable: true, value: previous });
    else delete (window as { AudioContext?: typeof AudioContext }).AudioContext;
  }
});

test("Album heals playing-but-silent and tears down when leaving an album", () => {
  const src = readFileSync(new URL("../pages/Album.tsx", import.meta.url), "utf8");
  assert.match(src, /restoreMobileOutput\(audio, userVolRef\.current\);\s*\n\s*if \(audio\.paused\)/s);
  assert.match(src, /rebuildAudioAfterRouteChange\(snapshot\.time, snapshot\.playing \|\| wantPlayingRef\.current\)/);
  assert.match(src, /releaseOutputForRouteChange\(audio\)/);
  assert.match(src, /leaveAlbumForHome/);
  assert.match(src, /Retire the shared context/);
  assert.match(src, /settleRoutePlayback/);
  assert.match(src, /playSong\(audio, url, resume, true, userVolRef\.current, true\)/);
  assert.match(src, /startBackgroundPlaybackGuard\(\s*\n\s*\(\) => audioRef\.current,\s*\n\s*\(\) => wantPlayingRef\.current,\s*\n\s*\(\) => userVolRef\.current,/s);
  assert.match(src, /if \(leaveForHomeRef\.current\) return;/);
});

test("leaving an album retires the shared context so the next album can unlock audibly", async () => {
  const restoreUa = stubUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)");
  const created: Array<{ closed: boolean }> = [];
  let resumeCalls = 0;
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
      resumeCalls += 1;
      this.state = "running";
      return Promise.resolve();
    }
    close() {
      this.closed = true;
      this.state = "closed";
      return Promise.resolve();
    }
  }
  Object.defineProperty(window, "AudioContext", { configurable: true, value: FakeContext });
  const firstAlbum = fakeAudio() as unknown as HTMLAudioElement;
  firstAlbum.paused = false;
  const nextAlbum = fakeAudio() as unknown as HTMLAudioElement;
  nextAlbum.paused = true;
  try {
    attachOutput(firstAlbum, 0.85);
    assert.equal(created.length, 1);
    releaseOutputForRouteChange(firstAlbum);
    assert.equal(created[0].closed, true);

    // Next album's first tap must open a fresh context (not reuse the retired one).
    unlockAudio(nextAlbum);
    assert.equal(created.length, 2);
    assert.equal(created[1].closed, false);
    assert.ok(resumeCalls >= 1 || created[1].state === "running");
  } finally {
    restoreUa();
    if (previous) Object.defineProperty(window, "AudioContext", { configurable: true, value: previous });
    else delete (window as { AudioContext?: typeof AudioContext }).AudioContext;
  }
});

test("a keepAudible remount at song start stays unmuted", async () => {
  const restoreUa = stubUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)");
  const gains: number[] = [];
  const previous = window.AudioContext;
  class FakeContext {
    state = "running";
    currentTime = 0;
    destination = {};
    onstatechange: (() => void) | null = null;
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
      return Promise.resolve();
    }
  }
  Object.defineProperty(window, "AudioContext", { configurable: true, value: FakeContext });
  const first = fakeAudio() as unknown as HTMLAudioElement;
  const remount = fakeAudio() as unknown as HTMLAudioElement;
  try {
    attachOutput(first, 0.85);
    releaseOutput(first);
    await playSong(remount, "/media/songs/a.mp3", 0.05, true, 0.85, true);
    assert.equal(remount.muted, false);
    assert.ok(gains.includes(0.85));
  } finally {
    restoreUa();
    if (previous) Object.defineProperty(window, "AudioContext", { configurable: true, value: previous });
    else delete (window as { AudioContext?: typeof AudioContext }).AudioContext;
  }
});

test("Bluetooth route change retires a running context so remount plays natively", async () => {
  const restoreUa = stubUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)");
  const created: Array<{ state: string; closed: boolean }> = [];
  let sourceCreates = 0;
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
      sourceCreates += 1;
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
      this.closed = true;
      this.state = "closed";
      return Promise.resolve();
    }
  }
  Object.defineProperty(window, "AudioContext", { configurable: true, value: FakeContext });
  const first = fakeAudio() as unknown as HTMLAudioElement;
  const remount = fakeAudio() as unknown as HTMLAudioElement;
  try {
    attachOutput(first, 0.85);
    assert.equal(created.length, 1);
    assert.equal(sourceCreates, 1);
    // Plain releaseOutput keeps a running shared context — that is the Bluetooth silent bug.
    releaseOutput(first);
    assert.equal(created[0].closed, false);

    releaseOutputForRouteChange(null);
    assert.equal(created[0].closed, true);
    assert.equal(isNativeOutputOnly(), true);

    await playSong(remount, "/media/songs/a.mp3", 42, true, 0.85, true);
    // No new silent context outside a tap; native element volume stays audible on the new device.
    assert.equal(created.length, 1);
    assert.equal(sourceCreates, 1);
    assert.equal(remount.muted, false);
    assert.equal(remount.volume, 0.85);
    assert.equal(remount.paused, false);
    assert.equal(isNativeOutputOnly(), true);
  } finally {
    restoreUa();
    resetOutputRouteStateForTests();
    if (previous) Object.defineProperty(window, "AudioContext", { configurable: true, value: previous });
    else delete (window as { AudioContext?: typeof AudioContext }).AudioContext;
  }
});

test("devicechange rebuild path retires the shared context before remounting", async () => {
  const stub = stubAudioSession();
  const created: Array<{ closed: boolean }> = [];
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
      this.closed = true;
      this.state = "closed";
      return Promise.resolve();
    }
  }
  Object.defineProperty(window, "AudioContext", { configurable: true, value: FakeContext });
  const audio = fakeAudio() as unknown as HTMLAudioElement;
  audio.src = "/media/songs/a.mp3";
  audio.currentTime = 18;
  audio.paused = false;
  attachOutput(audio, 0.8);
  let snapshot: PlaybackSnapshot | undefined;
  const stop = watchPlaybackRoute(
    () => audio,
    (next) => {
      snapshot = next;
      releaseOutputForRouteChange(audio);
    },
    () => 0.8,
  );
  try {
    stub.devices.dispatch("devicechange");
    await new Promise((resolve) => setTimeout(resolve, ROUTE_CHANGE_DEBOUNCE_MS + 40));
    assert.ok(snapshot);
    assert.equal(snapshot.playing, true);
    assert.equal(created[0].closed, true);
    assert.equal(isNativeOutputOnly(), true);
  } finally {
    stop();
    stub.restore();
    resetOutputRouteStateForTests();
    if (previous) Object.defineProperty(window, "AudioContext", { configurable: true, value: previous });
    else delete (window as { AudioContext?: typeof AudioContext }).AudioContext;
  }
});

test("route settle keeps native playback unmuted while Bluetooth finishes connecting", async () => {
  const restoreUa = stubUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)");
  const audio = fakeAudio() as unknown as HTMLAudioElement;
  audio.paused = true;
  audio.muted = true;
  audio.volume = 0;
  releaseOutputForRouteChange(null);
  const stop = settleRoutePlayback(
    () => audio,
    () => true,
    () => 0.8,
  );
  try {
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(audio.muted, false);
    assert.equal(audio.volume, 0.8);
    assert.equal(audio.paused, false);
    assert.equal(isNativeOutputOnly(), true);
  } finally {
    stop();
    restoreUa();
    resetOutputRouteStateForTests();
  }
});

test("interruption during a Bluetooth flip does not revive the old WebAudio graph", async () => {
  const stub = stubAudioSession();
  const restoreCtx = stubAudioContext();
  const audio = fakeAudio() as unknown as HTMLAudioElement;
  audio.src = "/media/songs/a.mp3";
  audio.paused = false;
  attachOutput(audio, 0.8);
  let rerouted = false;
  const stop = watchPlaybackRoute(
    () => audio,
    () => {
      rerouted = true;
      releaseOutputForRouteChange(audio);
    },
    () => 0.8,
  );
  try {
    stub.devices.dispatch("devicechange");
    stub.session.dispatch("interruptionbegin");
    stub.session.dispatch("interruptionend");
    await new Promise((resolve) => setTimeout(resolve, 80));
    // Remount is still debounced — interruption must not clear native-only early.
    assert.equal(isNativeOutputOnly(), true);
    assert.equal(rerouted, false);
    await new Promise((resolve) => setTimeout(resolve, ROUTE_CHANGE_DEBOUNCE_MS));
    assert.equal(rerouted, true);
  } finally {
    stop();
    stub.restore();
    restoreCtx();
    resetOutputRouteStateForTests();
  }
});

test("Album settles native playback after a Bluetooth remount", () => {
  const src = readFileSync(new URL("../pages/Album.tsx", import.meta.url), "utf8");
  assert.match(src, /settleRoutePlayback/);
  assert.match(src, /rebuildAudioAfterRouteChange/);
  assert.match(src, /ROUTE_CHANGE_DEBOUNCE_MS|releaseOutputForRouteChange/);
});
