/**
 * Safari/PWA playback helpers.
 * Desktop plays immediately through its own meter. A phone plays the audio element itself.
 * Opening a Web Audio route on a phone, even just for the level bars, locks every browser
 * on that phone until it is restarted. A tap must not create one.
 * After a call, Bluetooth route change, or mobile pause, keep the same element. Rebuilding it
 * plays after the tap and the song stops.
 * Bluetooth with a live WebAudio graph must retire the shared AudioContext, remount, and play natively.
 * Car stereos often flap A2DP/HFP (repeated devicechange). Remount only while a graph is attached;
 * once native, settle/heal the same element — tearing it down again reloads the MP3 and stutters.
 * Route settle may kick play a few times while the new device comes up, then must stop — never keep
 * calling play() after playback has started or the user cannot pause and the song stutters.
 * Keep native-only until the next user tap so nothing reattaches a silent WebAudio graph on the new device.
 * Auto-advance must keep the same element and MediaElementSource; releasing it cannot reattach and the next song stays silent.
 * Another app opening or closing must not pause a song that is still playing.
 * When iOS keeps the element playing but WebAudio is muted/interrupted, heal with ensureMobileOutputAudible — do not remount on visibility.
 * Leaving an album retires any old context. The next album plays the element natively and does not open a new one.
 * Do not prefetch, play from blob URLs, strip Xing on VBR, or lengthen the opener hold.
 * Do not put a ScriptProcessor on the phone route. It wedges iOS until a restart.
 * The phone route is a gain and an analyser only. Chrome on iPhone uses the same audio engine.
 * A song tap or a pause must play() on the same element inside the gesture. Remounting afterwards stops the song.
 * devicechange as a tap starts the session is not a new speaker. Remount only when the output device changed,
 * or when a song that has already been playing loses its route (car Bluetooth with no device list).
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
/**
 * iOS fires devicechange when a tap activates the audio session. Ignore that window unless
 * the output fingerprint actually changed. A later event can still be a car stereo.
 */
export const PLAYBACK_START_GUARD_MS = 2000;

let playGen = 0;
let gateOpen = true;
/** After a Bluetooth remount, refuse WebAudio until the next user tap unlocks a fresh graph. */
let nativeOutputOnly = false;
let routeChangePending = false;
let routeSettleGen = 0;
let softSettleStop: (() => void) | null = null;

type OutputGraph = {
  ctx: AudioContext;
  gain: GainNode;
  source: MediaElementAudioSourceNode;
  analyser?: AnalyserNode;
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

/** Another app opening or closing is not a dead speaker. Bluetooth needs one remount only while WebAudio is attached. */
export function shouldReroutePlayback(
  audio: HTMLAudioElement | null,
  reason: PlaybackRerouteReason,
): boolean {
  if (!audio) return false;
  if (reason === "visibility") return false;
  if (reason === "devicechange") return graphs.has(audio);
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
let routeFingerprint = "";
let lastUserPlayAt = 0;

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

function anyWatcherNeedsRouteRemount(): boolean {
  for (const watch of routeWatchers) {
    const audio = watch.getAudio();
    if (audio && graphs.has(audio)) return true;
  }
  return false;
}

function stopSoftRouteSettle() {
  softSettleStop?.();
  softSettleStop = null;
}

/** Heal native playback without remounting — used when the car stereo flaps after we are already native. */
function softSettleNativeRoutes() {
  routeChangePending = false;
  nativeOutputOnly = true;
  const keepPlaying = resumeAfterInterrupt;
  sessionInterrupted = false;
  resumeAfterInterrupt = false;
  stopSoftRouteSettle();
  const stops: Array<() => void> = [];
  for (const watch of routeWatchers) {
    stops.push(
      settleRoutePlayback(
        watch.getAudio,
        () => {
          const audio = watch.getAudio();
          if (!audio || audio.ended) return false;
          return !audio.paused || keepPlaying;
        },
        watch.getVolume,
      ),
    );
  }
  softSettleStop = () => {
    for (const stop of stops) stop();
  };
}

function flushPlaybackReroute() {
  if (!isMobilePlayback()) return;
  // A later flap may have already dropped the graph; do not tear down a healthy native element.
  if (!anyWatcherNeedsRouteRemount()) {
    softSettleNativeRoutes();
    return;
  }
  stopSoftRouteSettle();
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
  routeFingerprint = "";
  lastUserPlayAt = 0;
  stopSoftRouteSettle();
}

export function rememberOutputRouteForTests(key: string) {
  routeFingerprint = key;
}

/** Mark a user tap so a session-activation devicechange is not treated as a new speaker. */
export function noteUserPlay() {
  lastUserPlayAt = typeof performance !== "undefined" ? performance.now() : Date.now();
}

type RouteDevice = { kind: string; deviceId?: string; groupId?: string; label?: string };

export function outputRouteKey(devices: RouteDevice[]): string {
  return devices
    .filter((device) => device.kind === "audiooutput")
    .map((device) => `${device.deviceId || ""}\0${device.groupId || ""}\0${device.label || ""}`)
    .sort()
    .join("\n");
}

/**
 * Same outputs, a first look at the route, or a tap with no device list: not a speaker change.
 * Two different fingerprints always count, including during the tap (headphones just plugged in).
 */
export function routeChangeIsSpurious(input: { previous: string; next: string; sincePlay: number }): boolean {
  if (input.previous && input.next) return input.previous === input.next;
  // No baseline yet, or iOS is hiding the output list. A tap's devicechange is the
  // session starting. After the song is underway, the same event is a new route.
  return input.sincePlay < PLAYBACK_START_GUARD_MS;
}

function seedRouteFingerprint() {
  if (routeFingerprint) return;
  const enumerate = navigator.mediaDevices?.enumerateDevices;
  if (typeof enumerate !== "function") return;
  void enumerate
    .call(navigator.mediaDevices)
    .then((list) => {
      const key = outputRouteKey(list);
      if (key && !routeFingerprint) routeFingerprint = key;
    })
    .catch(() => undefined);
}

function sinceUserPlay(): number {
  if (!lastUserPlayAt) return Number.POSITIVE_INFINITY;
  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  return now - lastUserPlayAt;
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

export function shouldRebuildOutput(audio: HTMLAudioElement | null, _nextUrl = ""): boolean {
  if (!audio || !isMobilePlayback()) return false;
  // A different song stays on this element. Remounting plays from useEffect, after Safari
  // has dropped the tap, so the playhead jumps and the new element stops.
  return outputGraphIsStale(audio);
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
  seedRouteFingerprint();

  const onInterruptBegin = () => {
    sessionInterrupted = true;
    notePlayingBeforeInterrupt();
  };
  const onInterruptEnd = () => {
    // iOS fires this when a song starts. play() here is the second start, and the phone
    // then drops it. Desktop never has this event, and desktop playback is the one that holds.
    sessionInterrupted = false;
    resumeAfterInterrupt = false;
  };
  const onDeviceChange = () => {
    if (!isMobilePlayback()) return;
    const enumerate = navigator.mediaDevices?.enumerateDevices;
    if (typeof enumerate !== "function") {
      applyDeviceChange("");
      return;
    }
    void enumerate
      .call(navigator.mediaDevices)
      .then((list) => applyDeviceChange(outputRouteKey(list)))
      .catch(() => applyDeviceChange(""));
  };

  function applyDeviceChange(next: string) {
    const previous = routeFingerprint;
    if (next) routeFingerprint = next;
    if (routeChangeIsSpurious({ previous, next, sincePlay: sinceUserPlay() })) return;
    // A MediaElementSource stays bound to the old route. Disconnecting it without
    // replacing the element leaves Safari's playhead moving through silence.
    nativeOutputOnly = true;
    notePlayingBeforeInterrupt();
    if (anyWatcherNeedsRouteRemount()) {
      routeChangePending = true;
      requestPlaybackReroute();
      return;
    }
    // Once remounted natively, later A2DP/HFP flaps heal the same element.
    softSettleNativeRoutes();
  }

  const session = audioSession();
  session?.addEventListener?.("interruptionbegin", onInterruptBegin);
  session?.addEventListener?.("interruptionend", onInterruptEnd);
  navigator.mediaDevices?.addEventListener?.("devicechange", onDeviceChange);

  return () => {
    routeWatchers.delete(watch);
    session?.removeEventListener?.("interruptionbegin", onInterruptBegin);
    session?.removeEventListener?.("interruptionend", onInterruptEnd);
    navigator.mediaDevices?.removeEventListener?.("devicechange", onDeviceChange);
    if (routeWatchers.size === 0) {
      window.clearTimeout(routeTimer);
      stopSoftRouteSettle();
    }
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
    if (!audio || audio.ended) return;
    // A paused element is a pause (Control Center, lock screen, or the button).
    // Never play() from this timer — that is the stutter / cannot-pause loop.
    if (audio.paused) return;
    const volume = getVolume();
    if (nativeOutputOnly) {
      audio.muted = false;
      gateOpen = true;
      if (!graphs.has(audio)) audio.volume = Math.max(0, Math.min(1, volume));
      else setOutput(audio, volume);
      return;
    }
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
 * After a Bluetooth remount, keep the element unmuted. Does not call play() —
 * restarting the stream here is what sounded like a broken connection.
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
    if (!audio || audio.paused) return;
    audio.muted = false;
    gateOpen = true;
    const volume = Math.max(0, Math.min(1, getVolume()));
    if (!graphs.has(audio)) audio.volume = volume;
    else setOutput(audio, volume);
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
    let analyser: AnalyserNode | undefined;
    if (typeof ctx.createAnalyser === "function") {
      analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.minDecibels = -90;
      analyser.maxDecibels = -10;
      analyser.smoothingTimeConstant = 0.6;
      source.connect(analyser);
      analyser.connect(gain);
    } else {
      source.connect(gain);
    }
    gain.connect(ctx.destination);
    const graph = { ctx, gain, source, analyser };
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

export function outputAnalyser(audio: HTMLAudioElement | null): AnalyserNode | null {
  if (!audio) return null;
  return graphs.get(audio)?.analyser || null;
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

/** Prefer the catalog label when Safari reports a stub 1–2s duration. */
export function trustedSongDuration(elementDuration: number, catalogSeconds: number): number {
  const catalog = Number.isFinite(catalogSeconds) ? catalogSeconds : 0;
  const element = Number.isFinite(elementDuration) ? elementDuration : 0;
  if (catalog > 8) return catalog;
  if (element > 8) return element;
  return Math.max(catalog, element);
}

/** Safari sometimes fires `ended` ~1s in on a stub decode. Do not skip to the next song. */
export function isPrematureTrackEnd(currentTime: number, knownDuration: number): boolean {
  if (!Number.isFinite(currentTime) || currentTime >= 3) return false;
  if (Number.isFinite(knownDuration) && knownDuration > 0 && knownDuration <= 8) {
    return currentTime < knownDuration - 0.35;
  }
  return true;
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
  if (gen !== playGen || !sameSong(audio, url)) return;
  // Safari often pauses during the opener after a reboot or a cold audio session.
  // Leaving muted/gain 0 is the "playhead moves, speakers silent" bug — unmute
  // even if paused. Do not play() after this timeout (Safari drops the gesture).
  audio.muted = false;
  gateOpen = true;
  if (audio.paused) {
    setOutput(audio, targetVolume);
    return;
  }
  fadeOutput(audio, targetVolume, MOBILE_HEADER_FADE_MS, gen);
}

/** Low, mid, and high energy from an FFT frame. Each value is 0–1. */
export function meterBands(freq: Uint8Array): [number, number, number] {
  const span = (from: number, to: number) => {
    let sum = 0;
    let count = 0;
    const end = Math.min(freq.length, to);
    for (let i = from; i < end; i += 1) {
      sum += freq[i];
      count += 1;
    }
    if (!count) return 0;
    // Leave headroom. The bars are drawn at 2.2× this value, so a hot bin must not already be 1.
    return Math.max(0, Math.min(1, sum / count / 255 / 1.8));
  };
  return [span(1, 5), span(5, 16), span(16, 48)];
}

let meterCtx: AudioContext | null = null;
let meterBins: Uint8Array | null = null;
let meterSmooth: [number, number, number] = [0, 0, 0];
let levelPaint: ((levels: [number, number, number]) => void) | null = null;
let liveLevels: [number, number, number] = [0, 0, 0];
let shownLevels: [number, number, number] = [0, 0, 0];
let lastLevelPaint = 0;
const BAND_AVERAGE = 16;
const bandHistory: number[][] = [[], [], []];
let bandCursor = 0;
let lowState = 0;
let midState = 0;
const desktopTaps = new WeakMap<HTMLAudioElement, ScriptProcessorNode>();

export function primePlaybackMeter() {
  if (typeof window === "undefined" || isMobilePlayback()) return;
  const Ctor = audioContextCtor();
  if (!Ctor) return;
  try {
    if (!meterCtx) meterCtx = new Ctor();
    if (meterCtx.state === "suspended") void meterCtx.resume();
  } catch {
    /* the song still plays without a meter */
  }
}

function playingElement(): HTMLAudioElement | null {
  if (typeof document === "undefined") return null;
  const nodes = document.querySelectorAll("audio");
  for (const node of nodes) {
    if (!node.paused && !node.ended) return node;
  }
  return null;
}

/** Bass, middle, and top from one block of samples. Filter state carries across blocks. */
export function sampleBands(samples: Float32Array): [number, number, number] {
  let lowSq = 0;
  let midSq = 0;
  let highSq = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const x = samples[i];
    lowState += 0.04 * (x - lowState);
    const rest = x - lowState;
    midState += 0.18 * (rest - midState);
    const high = rest - midState;
    lowSq += lowState * lowState;
    midSq += midState * midState;
    highSq += high * high;
  }
  const count = samples.length || 1;
  const level = (sq: number) => Math.max(0, Math.min(1, Math.sqrt(sq / count) * 2.2));
  return [level(lowSq), level(midSq), level(highSq)];
}

function passThroughAndMeasure(event: AudioProcessingEvent) {
  const input = event.inputBuffer;
  const output = event.outputBuffer;
  for (let channel = 0; channel < output.numberOfChannels; channel += 1) {
    const source = input.getChannelData(Math.min(channel, input.numberOfChannels - 1));
    output.getChannelData(channel).set(source);
  }
  liveLevels = averagedBands(sampleBands(input.getChannelData(0)));
  publishLevels(typeof performance !== "undefined" ? performance.now() : 0);
}

/** Several audio slices averaged together, so a single loud moment cannot strobe the bars. */
function averagedBands(raw: [number, number, number]): [number, number, number] {
  const averaged = [0, 0, 0] as [number, number, number];
  for (let band = 0; band < 3; band += 1) {
    const history = bandHistory[band];
    history[bandCursor % BAND_AVERAGE] = raw[band];
    const count = Math.min(BAND_AVERAGE, history.length);
    let sum = 0;
    for (let i = 0; i < count; i += 1) sum += history[i] || 0;
    averaged[band] = sum / count;
  }
  bandCursor += 1;
  return averaged;
}

/** One paint about 8 times a second, and never a jump of more than a couple of pixels. */
function publishLevels(now: number) {
  if (!levelPaint || now - lastLevelPaint < 130) return;
  lastLevelPaint = now;
  shownLevels = liveLevels.map((target, index) => {
    const prev = shownLevels[index];
    const delta = target - prev;
    const step = Math.max(-0.16, Math.min(0.16, delta));
    return prev + step;
  }) as [number, number, number];
  levelPaint(shownLevels);
}

function attachDesktopLevelTap(audio: HTMLAudioElement): ScriptProcessorNode | null {
  const existing = desktopTaps.get(audio);
  if (existing) return existing;
  if (isMobilePlayback() || graphs.has(audio)) return null;
  if (!meterCtx) primePlaybackMeter();
  if (!meterCtx || typeof meterCtx.createScriptProcessor !== "function") return null;
  try {
    const source = meterCtx.createMediaElementSource(audio);
    const gain = meterCtx.createGain();
    gain.gain.value = 1;
    const processor = meterCtx.createScriptProcessor(1024, 2, 2);
    source.connect(processor);
    processor.connect(gain);
    gain.connect(meterCtx.destination);
    processor.onaudioprocess = passThroughAndMeasure;
    desktopTaps.set(audio, processor);
    return processor;
  } catch {
    return desktopTaps.get(audio) || null;
  }
}

function desktopAnalyser(audio: HTMLAudioElement): ScriptProcessorNode | null {
  return desktopTaps.get(audio) || attachDesktopLevelTap(audio);
}

function easeMeter(next: [number, number, number]): [number, number, number] {
  meterSmooth = next.map((target, index) => {
    const prev = meterSmooth[index];
    const rate = target > prev ? 0.28 : 0.08;
    return prev + (target - prev) * rate;
  }) as [number, number, number];
  return meterSmooth;
}

function sampleAnalyser(audio: HTMLAudioElement): [number, number, number] | null {
  const analyser = outputAnalyser(audio);
  if (!analyser) return null;
  if (!meterBins || meterBins.length !== analyser.frequencyBinCount) {
    meterBins = new Uint8Array(analyser.frequencyBinCount);
  }
  analyser.getByteFrequencyData(meterBins);
  return meterBands(meterBins);
}

/**
 * Phone bars read the AnalyserNode on a paint timer. A ScriptProcessor in the playback
 * graph blocks the audio thread, jumps the playhead, and leaves iOS silent until reboot.
 * Desktop keeps its own full-volume tap and must not be driven by this timer.
 */
export function watchPlaybackMeter(paint: (levels: [number, number, number]) => void): () => void {
  levelPaint = paint;
  if (!isMobilePlayback() || typeof requestAnimationFrame !== "function") {
    return () => {
      if (levelPaint === paint) levelPaint = null;
    };
  }
  let raf = 0;
  const tick = (now: number) => {
    if (levelPaint !== paint) return;
    const audio = playingElement();
    const levels = audio ? sampleAnalyser(audio) : null;
    liveLevels = averagedBands(levels || [0, 0, 0]);
    publishLevels(now);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => {
    if (levelPaint === paint) levelPaint = null;
    cancelAnimationFrame(raf);
  };
}

/** Three bars driven by the song: bass, middle, and top. */
export function playbackMeterLevels(): [number, number, number] {
  const audio = playingElement();
  if (!audio) return easeMeter([0, 0, 0]);
  if (desktopTaps.has(audio) || desktopAnalyser(audio)) return liveLevels;
  const analyser = outputAnalyser(audio);
  if (!analyser) return easeMeter([0, 0, 0]);
  if (!meterBins || meterBins.length !== analyser.frequencyBinCount) {
    meterBins = new Uint8Array(analyser.frequencyBinCount);
  }
  analyser.getByteFrequencyData(meterBins);
  return easeMeter(meterBands(meterBins));
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
  if (!isMobilePlayback()) {
    primePlaybackMeter();
    attachDesktopLevelTap(audio);
  }
  const resume = isResumeTime(time);
  const mobile = isMobilePlayback();
  const continuation = keepAudible && mobile;
  const dead = forceReload || !sameSong(audio, url);
  if (continuation) {
    if (dead) assignSrc(audio, url, resume ? time : 0, forceReload);
  } else {
    unlockAudio(audio);
    if (dead) assignSrc(audio, url, resume ? time : 0, forceReload);
  }

  // One play() for the tap. A mute, and a second play() after Safari's startup
  // pause, is the start-stop-start-then-dead pattern on a phone.
  gateOpen = true;
  audio.muted = false;
  setOutput(audio, targetVolume);
  if (dead && resume) {
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

export async function dropLegacyAudioCaches(): Promise<void> {
  if (!("caches" in window)) return;
  try {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith("spodazo-audio-")).map((key) => caches.delete(key)));
  } catch {
    /* private mode */
  }
}

function isInstalledApp(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  if (nav.standalone) return true;
  if (typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(display-mode: standalone)").matches;
}

/**
 * Installed phone app only, once on page load. A Safari or Chrome tab must keep the
 * normal session: setting "playback" there stops the song from starting at all.
 * The installed app needs "playback" or the silent switch mutes it.
 */
export function setPlaybackSession() {
  if (!isMobilePlayback() || !isInstalledApp()) return;
  try {
    const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
    // Setting this again while a song is starting makes iOS pause, resume, then drop it.
    if (session && session.type !== "playback") session.type = "playback";
  } catch {
    /* older WebKit */
  }
}

export function unlockAudio(audio?: HTMLAudioElement | null) {
  noteUserPlay();
  if (!audio || !isMobilePlayback()) return;
  nativeOutputOnly = false;
  // Do not attach a graph. Capturing the element is what locks the phone until a restart.
  const graph = graphs.get(audio);
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
