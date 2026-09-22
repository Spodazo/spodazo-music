/**
 * Safari/PWA playback helpers.
 * Desktop plays immediately. Mobile only uses a short GainNode mute (see MOBILE_HEADER_*).
 * After a call, Bluetooth route change, or mobile pause, rebuild the live element — the old GainNode stays silent.
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

let playGen = 0;
let gateOpen = true;

type OutputGraph = {
  ctx: AudioContext;
  gain: GainNode;
  onState?: () => void;
};

export type PlaybackSnapshot = {
  url: string;
  time: number;
  playing: boolean;
};

const graphs = new WeakMap<HTMLAudioElement, OutputGraph>();
const routeWatchers = new Set<{
  getAudio: () => HTMLAudioElement | null;
  onReroute: (snapshot: PlaybackSnapshot) => void;
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
  for (const item of snapshots) item.onReroute(item.snapshot);
}

function requestPlaybackReroute() {
  if (!isMobilePlayback()) return;
  if (typeof document !== "undefined" && document.hidden) return;
  window.clearTimeout(routeTimer);
  routeTimer = window.setTimeout(() => {
    if (typeof document !== "undefined" && document.hidden) return;
    flushPlaybackReroute();
  }, 50);
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
  return state === "interrupted" || state === "closed" || state === "suspended";
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

export function releaseOutput(audio: HTMLAudioElement | null) {
  if (!audio) return;
  const graph = graphs.get(audio);
  if (!graph) return;
  graphs.delete(audio);
  if (graph.onState) {
    try {
      graph.ctx.removeEventListener("statechange", graph.onState);
    } catch {
      /* older WebKit */
    }
    graph.ctx.onstatechange = null;
  }
  try {
    graph.gain.disconnect();
  } catch {
    /* already disconnected */
  }
  try {
    void graph.ctx.close();
  } catch {
    /* already closed */
  }
}

export function watchPlaybackRoute(
  getAudio: () => HTMLAudioElement | null,
  onReroute: (snapshot: PlaybackSnapshot) => void,
): () => void {
  const watch = { getAudio, onReroute };
  routeWatchers.add(watch);

  const onInterruptBegin = () => {
    sessionInterrupted = true;
    notePlayingBeforeInterrupt();
  };
  const onInterruptEnd = () => {
    sessionInterrupted = true;
    requestPlaybackReroute();
  };
  const onDeviceChange = () => {
    requestPlaybackReroute();
  };
  const onVisibility = () => {
    if (document.hidden) {
      markOutputNeedsRebuild();
      return;
    }
    if (sessionInterrupted) requestPlaybackReroute();
  };

  const session = audioSession();
  session?.addEventListener?.("interruptionbegin", onInterruptBegin);
  session?.addEventListener?.("interruptionend", onInterruptEnd);
  navigator.mediaDevices?.addEventListener?.("devicechange", onDeviceChange);
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibility);
  }

  return () => {
    routeWatchers.delete(watch);
    session?.removeEventListener?.("interruptionbegin", onInterruptBegin);
    session?.removeEventListener?.("interruptionend", onInterruptEnd);
    navigator.mediaDevices?.removeEventListener?.("devicechange", onDeviceChange);
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVisibility);
    }
    if (routeWatchers.size === 0) window.clearTimeout(routeTimer);
  };
}

export function attachOutput(audio: HTMLAudioElement): OutputGraph | null {
  const existing = graphs.get(audio);
  if (existing) return existing;
  const Ctor = audioContextCtor();
  if (!Ctor) return null;
  try {
    const ctx = new Ctor();
    const source = ctx.createMediaElementSource(audio);
    const gain = ctx.createGain();
    gain.gain.value = 0;
    source.connect(gain);
    gain.connect(ctx.destination);
    let wasRunning = false;
    const onState = () => {
      if (ctx.state === "running") {
        wasRunning = true;
        return;
      }
      if (!wasRunning) return;
      const state = ctx.state as string;
      if (state !== "interrupted" && state !== "suspended" && state !== "closed") return;
      outputNeedsRebuild = true;
      if (state === "interrupted") {
        sessionInterrupted = true;
        notePlayingBeforeInterrupt();
      }
    };
    ctx.addEventListener("statechange", onState);
    ctx.onstatechange = onState;
    const graph = { ctx, gain, onState };
    graphs.set(audio, graph);
    return graph;
  } catch {
    return graphs.get(audio) || null;
  }
}

function setOutput(audio: HTMLAudioElement, value: number) {
  const graph = graphs.get(audio);
  if (graph) {
    const now = graph.ctx.currentTime;
    graph.gain.gain.cancelScheduledValues(now);
    graph.gain.gain.setValueAtTime(Math.max(0, Math.min(1, value)), now);
    audio.volume = 1;
    return;
  }
  audio.volume = Math.max(0, Math.min(1, value));
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
): Promise<void> {
  const gen = ++playGen;
  outputNeedsRebuild = false;
  unlockAudio(audio);
  const resume = isResumeTime(time);
  const dead = forceReload || !sameSong(audio, url);
  if (dead) assignSrc(audio, url, resume ? time : 0, forceReload);

  if (resume || !isMobilePlayback()) {
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
  const graph = attachOutput(audio);
  if (graph && graph.ctx.state === "suspended") void graph.ctx.resume();
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
