/** Safari/PWA playback helpers. Do not prefetch or play from blob URLs — that scratches MP3s. */

export const HAVE_CURRENT_DATA = 2;
/** Skip the Xing/encoder-delay frame Safari otherwise plays as a scratch. */
export const START_OFFSET = 0.05;

export function mediaUrl(url: string, time = 0): string {
  const base = url.split("#")[0];
  if (time > 0.15 && Number.isFinite(time)) return `${base}#t=${time.toFixed(2)}`;
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
    audio.load();
  }
  audio.src = next;
  audio.load();
}

export function playSong(audio: HTMLAudioElement, url: string, time = 0, forceReload = false): Promise<void> {
  const resume = time > 0.15;
  const dead = forceReload || pipelineIsDead(audio) || !sameSong(audio, url);
  if (dead) assignSrc(audio, url, resume ? time : 0, forceReload);
  const play = audio.play().then(() => undefined);
  const skipTo = time >= START_OFFSET ? time : 0;
  if (skipTo) {
    const fix = () => {
      if (!sameSong(audio, url)) return;
      if (audio.currentTime < skipTo - 0.02) {
        try {
          audio.currentTime = skipTo;
        } catch {
          /* Safari may still be opening the file */
        }
      }
    };
    audio.addEventListener("loadedmetadata", fix, { once: true });
    audio.addEventListener("playing", fix, { once: true });
  }
  return play;
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

const SILENT_WAV =
  "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";

let unlocked = false;

export function unlockAudio() {
  setPlaybackSession();
  if (unlocked) return;
  unlocked = true;
  try {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Ctor) {
      const ctx = new Ctor({ sampleRate: 48000 });
      const rate = ctx.sampleRate || 48000;
      const buffer = ctx.createBuffer(2, Math.max(1, Math.floor(rate * 0.16)), rate);
      const src = ctx.createBufferSource();
      const gain = ctx.createGain();
      gain.gain.value = 0.0001;
      src.buffer = buffer;
      src.connect(gain);
      gain.connect(ctx.destination);
      void ctx.resume();
      src.start();
    }
  } catch {
    /* ignore */
  }
  try {
    const tick = new Audio(SILENT_WAV);
    tick.setAttribute("playsinline", "true");
    tick.volume = 0.01;
    void tick.play().then(() => tick.pause()).catch(() => undefined);
  } catch {
    /* ignore */
  }
}

export function waitForAudible(audio: HTMLAudioElement, minTime: number, timeoutMs = 1500): Promise<void> {
  if (audio.currentTime >= minTime) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      audio.removeEventListener("timeupdate", onTime);
      window.clearTimeout(timer);
      resolve();
    };
    const onTime = () => {
      if (audio.currentTime >= minTime) finish();
    };
    const timer = window.setTimeout(finish, timeoutMs);
    audio.addEventListener("timeupdate", onTime);
  });
}
