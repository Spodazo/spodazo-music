/** Safari/PWA playback helpers. Do not prefetch or play from blob URLs — that scratches MP3s. */

export const HAVE_CURRENT_DATA = 2;
/** First MPEG/Xing frames Safari otherwise plays as a scratch. */
export const START_OFFSET = 0.05;
/** Hold the opener silent this long — longer than one Xing frame plus encoder delay. */
export const HEADER_HOLD = 0.12;

let playGen = 0;
let gateOpen = true;

type OutputGraph = {
  ctx: AudioContext;
  gain: GainNode;
};

const graphs = new WeakMap<HTMLAudioElement, OutputGraph>();

function audioContextCtor(): typeof AudioContext | undefined {
  return (
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  );
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
    const graph = { ctx, gain };
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

function waitForPlaying(audio: HTMLAudioElement, timeoutMs = 2000): Promise<void> {
  if (!audio.paused && audio.currentTime > 0) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      audio.removeEventListener("playing", finish);
      window.clearTimeout(timer);
      resolve();
    };
    const timer = window.setTimeout(finish, timeoutMs);
    audio.addEventListener("playing", finish, { once: true });
  });
}

async function openStartGate(audio: HTMLAudioElement, url: string, targetVolume: number, gen: number) {
  await waitForPlaying(audio, 2000);
  if (gen !== playGen || !sameSong(audio, url) || audio.paused) return;
  await Promise.all([waitForAudible(audio, HEADER_HOLD, 800), waitMs(140)]);
  if (gen !== playGen || !sameSong(audio, url) || audio.paused) return;
  audio.muted = false;
  gateOpen = true;
  fadeOutput(audio, targetVolume, 80, gen);
}

export function playSong(
  audio: HTMLAudioElement,
  url: string,
  time = 0,
  forceReload = false,
  targetVolume = 1,
): Promise<void> {
  const gen = ++playGen;
  unlockAudio(audio);
  const resume = isResumeTime(time);
  const dead = forceReload || !sameSong(audio, url);
  if (dead) assignSrc(audio, url, resume ? time : 0, forceReload);

  if (resume) {
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
  if (!audio) return;
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
