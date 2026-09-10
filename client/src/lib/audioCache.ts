/** Safari/PWA playback helpers. Do not prefetch or play from blob URLs — that scratches MP3s. */

export const HAVE_CURRENT_DATA = 2;

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

export function assignSrc(audio: HTMLAudioElement, url: string, time = 0) {
  const next = mediaUrl(url, time);
  try {
    if (audio.src === new URL(next, window.location.href).href) return;
  } catch {
    if (audio.src === next) return;
  }
  audio.src = next;
}

export function playSong(audio: HTMLAudioElement, url: string, time = 0, forceReload = false): Promise<void> {
  const dead = forceReload || pipelineIsDead(audio) || !sameSong(audio, url);
  if (dead) {
    assignSrc(audio, url, time);
  }
  const play = audio.play().then(() => undefined);
  if (dead && time > 1) {
    const fix = () => {
      if (!sameSong(audio, url)) return;
      if (audio.currentTime < 0.4) {
        try {
          audio.currentTime = time;
        } catch {
          /* Safari may still be opening the file */
        }
      }
    };
    audio.addEventListener("loadedmetadata", fix, { once: true });
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
