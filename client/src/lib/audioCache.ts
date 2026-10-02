/**
 * Safari/PWA playback helpers.
 * Desktop plays immediately. Mobile only uses a short GainNode mute (see MOBILE_HEADER_*).
 * After a call, Bluetooth route change, or mobile pause, rebuild the live element — the old GainNode stays silent.
 * Bluetooth must retire the shared AudioContext, wait for the route to settle, remount, and play natively.
 * Keep native-only until the next user tap so nothing reattaches a silent WebAudio graph on the new device.
 * Auto-advance must keep the same element and MediaElementSource; releasing it cannot reattach and the next song stays silent.
 * Another app opening or closing must not pause a song that is still playing.
 * When iOS keeps the element playing but WebAudio is muted/interrupted, heal with ensureMobileOutputAudible — do not remount on visibility.
 * Leaving an album must retire the shared AudioContext so the next album's first tap opens a fresh audible graph.
 * Keep the AudioContext the first tap resumed. A context created when the song ends stays silent until the next tap.
 * Do not prefetch, play from blob URLs, strip Xing on VBR, or lengthen the opener hold.
 */

export const HAVE_CURRENT_DATA = 2;
/** First MPEG/Xing frames Safari otherwise plays as a scratch. */
export const START_OFFSET = 0.05;
/** One MPEG/Xing frame plus encoder delay — do not wait longer or the first note is lost. */
export const HEADER_HOLD = 0.05;
/** Mobile opener only. Keep the sum with MOBILE_HEADER_FADE_MS at or under 80ms. */
export const MOBILE_HEADER_HOLD_MS = 30;
export const MOBILE_HEADER_FADE_MS = 20;
/** Wait for Bluetooth/device routes to finish flipping before remounting playback. */
export const ROUTE_CHANGE_DEBOUNCE_MS = 450;
/** Re-assert native play/unmute while a new Bluetooth route finishes coming up. */
export const ROUTE_SETTLE_MS = 2000;
export const ROUTE_SETTLE_TICK_MS = 250;

let playGen = 0;
let gateOpen = true;
/** After a Bluetooth remount, refuse WebAudio until the next user tap unlocks a fresh graph. */
let nativeOutputOnly = false;
let routeChangePending = false;
let routeSettleGen = 0;

type OutputGraph = {
  ctx: AudioContext;
  gain: GainNode;
  source: MediaElementAudioSourceNode;
};

let sharedCtx: AudioContext | null = null;
let sharedCtor: typeof AudioContext | null = null;
let sharedWatch: (() => void) | null = null;

export type PlaybackSnapshot = {
  url: string;
  time: number;
  playing: boolean;
};

export type PlaybackRerouteReason = "visibility" | "interruptionend" | "devicechange";

/** Another app opening or closing is not a dead speaker. A call pauses us. Bluetooth needs a new route. */
export function shouldReroutePlayback(
  audio: HTMLAudioElement | null,
  reason: PlaybackRerouteReason,
): boolean {
  if (!audio) return false;
  if (reason === "visibility") return false;
  if (reason === "devicechange") return true;
  if (reason === "interruptionend") {
    // Books (and other PWAs) flash the system session; that is not a phone call or dead pipeline.
    return false;
  }
  return audio.paused;
}

const graphs = new WeakMap<HTMLAudioElement, OutputGraph>();
const routeWatchers = new Set<{
  getAudio: () => HTMLAudioElement | null;
  onReroute: (snapshot: PlaybackSnapshot) => void;
  getVolume: () => number;
}>();

let routeTimer = 0;
let sessionInterrupted = false;
let resumeAfterInterrupt = false;
let outputNeedsRebuild = false;

function audioContextCtor(): typeof AudioContext | undefined {
  return (
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  );
}

type AudioSessionLike = {
  type?: string;
  addEventListener?(type: string, listener: () => void): void;
  removeEventListener?(type: string, listener: () => void): void;
};

function audioSession(): AudioSessionLike | undefined {
  return (navigator as Navigator & { audioSession?: AudioSessionLike }).audioSession;
}

function notePlayingBeforeInterrupt() {
  for (const watch of routeWatchers) {
    const audio = watch.getAudio();
    if (audio && !audio.paused) {
      resumeAfterInterrupt = true;
      return;
    }
  }
}

function flushPlaybackReroute() {
  if (!isMobilePlayback()) return;
  const snapshots: Array<{ onReroute: (snapshot: PlaybackSnapshot) => void; snapshot: PlaybackSnapshot }> = [];
  for (const watch of routeWatchers) {
    const snapshot = playbackSnapshot(watch.getAudio());
    if (!snapshot) continue;
    snapshots.push({
      onReroute: watch.onReroute,
      snapshot: {
        ...snapshot,
        playing: snapshot.playing || resumeAfterInterrupt,
      },
    });
  }
  sessionInterrupted = false;
  resumeAfterInterrupt = false;
  routeChangePending = false;
  // Remount must stay on the native element path until the next tap.
  nativeOutputOnly = true;
  for (const item of snapshots) item.onReroute(item.snapshot);
}

function requestPlaybackReroute() {
  if (!isMobilePlayback()) return;
  window.clearTimeout(routeTimer);
  routeTimer = window.setTimeout(() => {
    flushPlaybackReroute();
  }, ROUTE_CHANGE_DEBOUNCE_MS);
}

/** True after a Bluetooth remount until the next unlock tap builds a fresh graph. */
export function isNativeOutputOnly(): boolean {
  return nativeOutputOnly;
}

/** Test helper — clear route-change locks between cases. */
export function resetOutputRouteStateForTests() {
  nativeOutputOnly = false;
  routeChangePending = false;
  routeSettleGen += 1;
  window.clearTimeout(routeTimer);
  routeTimer = 0;
}

export function playbackSnapshot(audio: HTMLAudioElement | null): PlaybackSnapshot | null {
  if (!audio) return null;
  const url = (audio.currentSrc || audio.src || "").split("#")[0];
  if (!url) return null;
  return {
    url,
    time: Number.isFinite(audio.currentTime) ? audio.currentTime : 0,
    playing: !audio.paused,
  };
}

export function markOutputNeedsRebuild() {
  if (isMobilePlayback()) outputNeedsRebuild = true;
}

export function outputRebuildIsPending(): boolean {
  return outputNeedsRebuild;
}

export function outputGraphIsStale(audio: HTMLAudioElement | null): boolean {
  if (!audio || !isMobilePlayback()) return false;
  const graph = graphs.get(audio);
  if (!graph) return false;
  if (outputNeedsRebuild) return true;
  const state = graph.ctx.state as string;
  // interrupted/suspended recover with resume(); only a closed context needs a rebuild.
  return state === "closed";
}

export function shouldRebuildOutput(audio: HTMLAudioElement | null, nextUrl = ""): boolean {
  if (!audio || !isMobilePlayback()) return false;
  if (outputGraphIsStale(audio)) return true;
  if (!nextUrl || !graphs.has(audio)) return false;
  // warm() may attach a graph before src is set — that is not a song change. Remounting
  // here would play() after the tap gesture and leave the first song silent.
  const current = (audio.currentSrc || audio.src || "").split("#")[0];
  if (!current) return false;
  return !sameSong(audio, nextUrl);
}

export function resumeLiveOutput(audio: HTMLAudioElement | null): boolean {
  if (!audio || audio.paused) return false;
  const graph = graphs.get(audio);
  if (graph) {
    const state = graph.ctx.state as string;
    if (state === "suspended" || state === "interrupted") void graph.ctx.resume();
  }
  return true;
}

/**
 * Heal playing-but-silent after backgrounding or album hops: unmute, restore gain,
 * resume interrupted/suspended context. Does not remount or create a new AudioContext.
 */
export function ensureMobileOutputAudible(audio: HTMLAudioElement | null, volume = 1): void {
  if (!audio || !isMobilePlayback()) return;
  restoreMobileOutput(audio, volume);
  if (!audio.paused) resumeLiveOutput(audio);
}

/** Another installed app (e.g. Books) must not force a rebuild — resume the live element. */
export function resumePlaybackAfterInterrupt(
  audio: HTMLAudioElement | null,
  volume = 1,
): Promise<boolean> {
  if (!audio) return Promise.resolve(false);
  restoreMobileOutput(audio, volume);
  const graph = graphs.get(audio);
  if (graph) {
    const state = graph.ctx.state as string;
    if (state === "suspended" || state === "interrupted") {
      return graph.ctx.resume().then(() => audio.play().then(() => !audio.paused)).catch(() => false);
    }
  }
  return audio.play().then(() => !audio.paused).catch(() => false);
}

export function restoreMobileOutput(audio: HTMLAudioElement | null, volume: number) {
  if (!audio) return;
  gateOpen = true;
  audio.muted = false;
  const graph = graphs.get(audio);
  if (graph) {
    const state = graph.ctx.state as string;
    if (state === "suspended" || state === "interrupted") {
      void graph.ctx.resume();
    }
  }
  setOutput(audio, volume);
}

function retireContext() {
  const ctx = sharedCtx;
  const watch = sharedWatch;
  sharedCtx = null;
  sharedCtor = null;
  sharedWatch = null;
  if (!ctx) return;
  if (watch) {
    try {
      ctx.removeEventListener("statechange", watch);
    } catch {
      /* older WebKit */
    }
    ctx.onstatechange = null;
  }
  try {
    void ctx.close();
  } catch {
    /* already closed */
  }
}

function watchContext(ctx: AudioContext) {
  let wasRunning = ctx.state === "running";
  const onState = () => {
    if (ctx.state === "running") {
      wasRunning = true;
      return;
    }
    if (!wasRunning) return;
    const state = ctx.state as string;
    if (state === "closed") {
      outputNeedsRebuild = true;
      return;
    }
    if (state !== "interrupted" && state !== "suspended") return;
    sessionInterrupted = true;
    notePlayingBeforeInterrupt();
    void ctx.resume().catch(() => undefined);
  };
  sharedWatch = onState;
  try {
    ctx.addEventListener("statechange", onState);
  } catch {
    /* older WebKit */
  }
  ctx.onstatechange = onState;
}

/** The context resumed by the first tap. A new one started from `ended` stays silent. */
function adoptContext(): AudioContext | null {
  const Ctor = audioContextCtor();
  if (!Ctor) return null;
  if (sharedCtor !== Ctor) retireContext();
  if (sharedCtx) {
    const state = sharedCtx.state as string;
    if (state === "closed") {
      retireContext();
    } else {
      if (state === "interrupted" || state === "suspended") void sharedCtx.resume().catch(() => undefined);
      return sharedCtx;
    }
  }
  try {
    const ctx = new Ctor();
    sharedCtx = ctx;
    sharedCtor = Ctor;
    watchContext(ctx);
    return ctx;
  } catch {
    return null;
  }
}

/** Shared context from the first tap — includes suspended/interrupted so auto-advance can rejoin it. */
function sharedPlaybackContext(): AudioContext | null {
  const Ctor = audioContextCtor();
  if (!Ctor || sharedCtor !== Ctor || !sharedCtx) return null;
  const state = sharedCtx.state as string;
  if (state === "closed") return null;
  if (state === "suspended" || state === "interrupted") void sharedCtx.resume().catch(() => undefined);
  return sharedCtx;
}

export function releaseOutput(audio: HTMLAudioElement | null) {
  if (!audio) return;
  const graph = graphs.get(audio);
  if (!graph) return;
  graphs.delete(audio);
  try {
    graph.source.disconnect();
  } catch {
    /* already disconnected */
  }
  try {
    graph.gain.disconnect();
  } catch {
    /* already disconnected */
  }
  const state = graph.ctx.state as string;
  if (state === "running" || state === "suspended") return;
  if (sharedCtx === graph.ctx) retireContext();
}

/**
 * Bluetooth (and similar) output-route changes: remount on a fresh element and drop the
 * shared AudioContext. A context that still reports "running" often cannot reach the new
 * device; reattaching to it leaves the song playing silently. Play natively until the next tap.
 * Also used when leaving an album so the next album's first tap opens a fresh audible context.
 */
export function releaseOutputForRouteChange(audio: HTMLAudioElement | null) {
  releaseOutput(audio);
  retireContext();
  gateOpen = true;
  nativeOutputOnly = true;
}

export function watchPlaybackRoute(
  getAudio: () => HTMLAudioElement | null,
  onReroute: (snapshot: PlaybackSnapshot) => void,
  getVolume: () => number = () => 1,
): () => void {
  const watch = { getAudio, onReroute, getVolume };
  routeWatchers.add(watch);

  const onInterruptBegin = () => {
    sessionInterrupted = true;
    notePlayingBeforeInterrupt();
  };
  const onInterruptEnd = () => {
    // Bluetooth device flips also fire session interruptions. Let the debounced remount
    // own recovery — resurrecting the old WebAudio graph here stays silent on the new device.
    if (routeChangePending || nativeOutputOnly) {
      sessionInterrupted = false;
      return;
    }
    for (const item of routeWatchers) {
      const audio = item.getAudio();
      if (!audio || !resumeAfterInterrupt) continue;
      const volume = item.getVolume();
      if (audio.paused) void resumePlaybackAfterInterrupt(audio, volume);
      else ensureMobileOutputAudible(audio, volume);
    }
    sessionInterrupted = false;
    resumeAfterInterrupt = false;
  };
  const onDeviceChange = () => {
    routeChangePending = true;
    nativeOutputOnly = true;
    notePlayingBeforeInterrupt();
    requestPlaybackReroute();
  };

  const session = audioSession();
  session?.addEventListener?.("interruptionbegin", onInterruptBegin);
  session?.addEventListener?.("interruptionend", onInterruptEnd);
  navigator.mediaDevices?.addEventListener?.("devicechange", onDeviceChange);

  return () => {
    routeWatchers.delete(watch);
    session?.removeEventListener?.("interruptionbegin", onInterruptBegin);
    session?.removeEventListener?.("interruptionend", onInterruptEnd);
    navigator.mediaDevices?.removeEventListener?.("devicechange", onDeviceChange);
    if (routeWatchers.size === 0) window.clearTimeout(routeTimer);
  };
}

/** While Music is in the background, another PWA reloading can interrupt WebAudio — keep healing. */
export function startBackgroundPlaybackGuard(
  getAudio: () => HTMLAudioElement | null,
  shouldKeepPlaying: () => boolean,
  getVolume: () => number = () => 1,
): () => void {
  if (!isMobilePlayback()) return () => {};

  const heal = () => {
    if (!shouldKeepPlaying()) return;
    const audio = getAudio();
    if (!audio) return;
    const volume = getVolume();
    if (nativeOutputOnly) {
      // Stay on the element path after Bluetooth — do not revive WebAudio here.
      setPlaybackSession();
      audio.muted = false;
      gateOpen = true;
      if (!graphs.has(audio)) audio.volume = Math.max(0, Math.min(1, volume));
      else setOutput(audio, volume);
      if (audio.paused && !audio.ended) void audio.play().catch(() => undefined);
      return;
    }
    if (audio.paused) {
      if (audio.ended) return;
      void resumePlaybackAfterInterrupt(audio, volume);
      return;
    }
    // iOS often keeps paused=false while GainNode stays at 0 or the context is interrupted.
    ensureMobileOutputAudible(audio, volume);
  };

  const id = window.setInterval(heal, 500);
  document.addEventListener("visibilitychange", heal);
  window.addEventListener("pageshow", heal);
  return () => {
    window.clearInterval(id);
    document.removeEventListener("visibilitychange", heal);
    window.removeEventListener("pageshow", heal);
  };
}

/**
 * After a Bluetooth remount, keep re-asserting unmuted native playback while the new
 * output route finishes coming online. Does not create an AudioContext.
 */
export function settleRoutePlayback(
  getAudio: () => HTMLAudioElement | null,
  shouldKeepPlaying: () => boolean,
  getVolume: () => number = () => 1,
): () => void {
  if (!isMobilePlayback()) return () => {};
  const gen = ++routeSettleGen;
  const started = performance.now();
  const tick = () => {
    if (gen !== routeSettleGen) return;
    if (!shouldKeepPlaying()) return;
    const audio = getAudio();
    if (!audio) return;
    setPlaybackSession();
    audio.muted = false;
    gateOpen = true;
    const volume = Math.max(0, Math.min(1, getVolume()));
    if (!graphs.has(audio)) audio.volume = volume;
    else setOutput(audio, volume);
    if (audio.paused && !audio.ended) void audio.play().catch(() => undefined);
  };
  tick();
  const id = window.setInterval(() => {
    if (gen !== routeSettleGen || performance.now() - started >= ROUTE_SETTLE_MS) {
      window.clearInterval(id);
      return;
    }
    tick();
  }, ROUTE_SETTLE_TICK_MS);
  return () => {
    if (gen === routeSettleGen) routeSettleGen += 1;
    window.clearInterval(id);
  };
}

export function attachOutput(audio: HTMLAudioElement, initialGain = 0): OutputGraph | null {
  const existing = graphs.get(audio);
  if (existing) return existing;
  // After Bluetooth remount, stay native until a user tap clears nativeOutputOnly via unlockAudio.
  if (nativeOutputOnly) return null;
  const ctx = adoptContext();
  if (!ctx) return null;
  try {
    const source = ctx.createMediaElementSource(audio);
    const gain = ctx.createGain();
    gain.gain.value = initialGain;
    source.connect(gain);
    gain.connect(ctx.destination);
    const graph = { ctx, gain, source };
    graphs.set(audio, graph);
    return graph;
  } catch {
    return graphs.get(audio) || null;
  }
}

function setOutput(audio: HTMLAudioElement, value: number) {
  const level = Math.max(0, Math.min(1, value));
  const graph = graphs.get(audio);
  if (graph) {
    const now = graph.ctx.currentTime;
    graph.gain.gain.cancelScheduledValues(now);
    graph.gain.gain.value = level;
    graph.gain.gain.setValueAtTime(level, now);
    audio.volume = 1;
    return;
  }
  audio.volume = level;
}

export function setOutputLevel(audio: HTMLAudioElement | null, volume: number) {
  if (!audio || !gateOpen) return;
  setOutput(audio, volume);
}

export function isMobilePlayback(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/iPhone|iPad|iPod|Android/i.test(ua)) return true;
  return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
}

export function isResumeTime(time: number): boolean {
  return time > 0.15 && Number.isFinite(time);
}

export function mediaUrl(url: string, time = 0): string {
  const base = url.split("#")[0];
  if (isResumeTime(time)) return `${base}#t=${time.toFixed(2)}`;
  return base;
}

export function sameSong(audio: HTMLAudioElement, url: string): boolean {
  const current = (audio.currentSrc || audio.src || "").split("#")[0];
  if (!current || !url) return false;
  try {
    return current === new URL(url.split("#")[0], window.location.href).href;
  } catch {
    return current === url.split("#")[0];
  }
}

export function pipelineIsDead(audio: HTMLAudioElement): boolean {
  return Boolean(audio.error) || audio.readyState < HAVE_CURRENT_DATA;
}

export function assignSrc(audio: HTMLAudioElement, url: string, time = 0, force = false) {
  const next = mediaUrl(url, time);
  if (!force) {
    try {
      if (audio.src === new URL(next, window.location.href).href) return;
    } catch {
      if (audio.src === next) return;
    }
  } else {
    audio.removeAttribute("src");
  }
  audio.src = next;
  if (force) audio.load();
}

function fadeOutput(audio: HTMLAudioElement, target: number, ms: number, gen: number) {
  const graph = graphs.get(audio);
  if (graph) {
    const now = graph.ctx.currentTime;
    const from = graph.gain.gain.value;
    graph.gain.gain.cancelScheduledValues(now);
    graph.gain.gain.setValueAtTime(from, now);
    graph.gain.gain.linearRampToValueAtTime(target, now + Math.max(0.02, ms / 1000));
    return;
  }
  const from = audio.volume;
  const started = performance.now();
  const step = (now: number) => {
    if (gen !== playGen || audio.paused) return;
    const p = Math.min(1, (now - started) / ms);
    audio.volume = from + (target - from) * p;
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function openStartGate(audio: HTMLAudioElement, url: string, targetVolume: number, gen: number) {
  await waitMs(MOBILE_HEADER_HOLD_MS);
  if (gen !== playGen || !sameSong(audio, url) || audio.paused) return;
  audio.muted = false;
  gateOpen = true;
  fadeOutput(audio, targetVolume, MOBILE_HEADER_FADE_MS, gen);
}

export function playSong(
  audio: HTMLAudioElement,
  url: string,
  time = 0,
  forceReload = false,
  targetVolume = 1,
  keepAudible = false,
): Promise<void> {
  const gen = ++playGen;
  outputNeedsRebuild = false;
  const resume = isResumeTime(time);
  const mobile = isMobilePlayback();
  const continuation = keepAudible && mobile;
  const dead = forceReload || !sameSong(audio, url);
  if (continuation) {
    if (dead) assignSrc(audio, url, resume ? time : 0, forceReload);
    setPlaybackSession();
    // Keep an existing MediaElementSource. Releasing it on this element cannot reattach.
    // Only join a context the first tap already started — creating one here stays silent until a later tap.
    // After Bluetooth, nativeOutputOnly blocks attach until unlockAudio on the next tap.
    if (!nativeOutputOnly && !graphs.has(audio) && sharedPlaybackContext()) {
      attachOutput(audio, targetVolume);
    }
  } else {
    unlockAudio(audio);
    if (dead) assignSrc(audio, url, resume ? time : 0, forceReload);
  }

  if (resume || !mobile || keepAudible) {
    gateOpen = true;
    audio.muted = false;
    setOutput(audio, targetVolume);
    if (dead) {
      const fix = () => {
        if (gen !== playGen || !sameSong(audio, url)) return;
        if (audio.currentTime < time - 0.02) {
          try {
            audio.currentTime = time;
          } catch {
            /* Safari may still be opening the file */
          }
        }
      };
      audio.addEventListener("loadedmetadata", fix, { once: true });
    }
    return audio.play().then(() => undefined);
  }

  gateOpen = false;
  audio.muted = true;
  setOutput(audio, 0);
  return audio.play().catch(() => {
    audio.muted = false;
    return audio.play();
  }).then(() => {
    void openStartGate(audio, url, targetVolume, gen);
  });
}

export async function dropLegacyAudioCaches(): Promise<void> {
  if (!("caches" in window)) return;
  try {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith("spodazo-audio-")).map((key) => caches.delete(key)));
  } catch {
    /* private mode */
  }
}

export function setPlaybackSession() {
  try {
    const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
    if (session) session.type = "playback";
  } catch {
    /* older WebKit */
  }
}

export function unlockAudio(audio?: HTMLAudioElement | null) {
  setPlaybackSession();
  if (!audio || !isMobilePlayback()) return;
  // User tap after Bluetooth: allow a fresh WebAudio graph on the new route even if still playing natively.
  const allowAttachWhilePlaying = nativeOutputOnly;
  nativeOutputOnly = false;
  // A song already playing natively must not be pulled into a new gain node at 0 — unless this tap ends native-only mode.
  if (!graphs.has(audio) && !audio.paused && !allowAttachWhilePlaying) return;
  const graph = attachOutput(audio);
  if (!graph) return;
  const state = graph.ctx.state as string;
  if (state === "suspended" || state === "interrupted") void graph.ctx.resume();
}

export function waitForAudible(audio: HTMLAudioElement, minTime: number, timeoutMs = 1500): Promise<void> {
  if (audio.currentTime >= minTime) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("playing", onTime);
      window.clearTimeout(timer);
      resolve();
    };
    const onTime = () => {
      if (audio.currentTime >= minTime) finish();
    };
    const timer = window.setTimeout(finish, timeoutMs);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("playing", onTime);
  });
}
