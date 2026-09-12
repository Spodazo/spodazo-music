/** Safari/PWA playback helpers. Do not prefetch or play from blob URLs — that scratches MP3s. */

export const HAVE_CURRENT_DATA = 2;
/** First MPEG/Xing frames Safari otherwise plays as a scratch. */
export const START_OFFSET = 0.05;

let playGen = 0;

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

function fadeVolume(audio: HTMLAudioElement, target: number, ms: number, gen: number) {
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

async function openStartGate(audio: HTMLAudioElement, url: string, targetVolume: number, gen: number) {
  await waitForAudible(audio, START_OFFSET, 2500);
  if (gen !== playGen || !sameSong(audio, url) || audio.paused) return;
  if (audio.currentTime < START_OFFSET) return;
  fadeVolume(audio, targetVolume, 50, gen);
}

export function playSong(
  audio: HTMLAudioElement,
  url: string,
  time = 0,
  forceReload = false,
  targetVolume = 1,
): Promise<void> {
  const gen = ++playGen;
  const resume = isResumeTime(time);
  const dead = forceReload || !sameSong(audio, url);
  if (dead) assignSrc(audio, url, resume ? time : 0, forceReload);

  if (resume) {
    audio.volume = targetVolume;
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

  audio.volume = 0;
  return audio.play().then(() => {
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

export function unlockAudio() {
  setPlaybackSession();
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
