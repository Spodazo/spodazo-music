/** Local song cache so iOS PWA resume does not depend on a dead HTTP Range stream. */

export const HAVE_METADATA = 1;
export const HAVE_FUTURE_DATA = 3;

const CACHE_NAME = "spodazo-audio-v3";

type CacheEntry = {
  objectUrl?: string;
  inflight?: Promise<string | null>;
};

const memory = new Map<string, CacheEntry>();
let streamingUrl = "";

export function setStreamingUrl(url: string) {
  streamingUrl = url;
}

export function cachedSrc(url: string): string | null {
  return memory.get(url)?.objectUrl ?? null;
}

export function playableSrc(url: string): string {
  return cachedSrc(url) || url;
}

export function sameAudioSrc(audio: HTMLAudioElement, src: string): boolean {
  try {
    return audio.src === new URL(src, window.location.href).href;
  } catch {
    return audio.src === src;
  }
}

export function mediaNeedsRebuild(input: {
  readyState: number;
  hasError: boolean;
  srcMatches: boolean;
  backgrounded: boolean;
}): boolean {
  return input.hasError || !input.srcMatches || input.backgrounded || input.readyState < HAVE_FUTURE_DATA;
}

export function albumPrimeOrder(urls: string[], current?: string | null): string[] {
  const unique = urls.filter((url, index, all) => url && all.indexOf(url) === index);
  if (!current) return unique;
  const at = unique.indexOf(current);
  if (at < 0) return unique;
  return [...unique.slice(at), ...unique.slice(0, at)];
}

export function setPlaybackSession() {
  try {
    const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
    if (session) session.type = "playback";
  } catch {
    /* older WebKit */
  }
}

async function openPersistentCache(): Promise<Cache | null> {
  if (!("caches" in window)) return null;
  try {
    return await caches.open(CACHE_NAME);
  } catch {
    return null;
  }
}

export async function dropOldAudioCaches(): Promise<void> {
  if (!("caches" in window)) return;
  try {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key.startsWith("spodazo-audio-") && key !== CACHE_NAME)
        .map((key) => caches.delete(key)),
    );
  } catch {
    /* ignore quota / private mode */
  }
}

export async function hydrateFromCache(url: string): Promise<string | null> {
  if (!url) return null;
  const hit = cachedSrc(url);
  if (hit) return hit;
  const persistent = await openPersistentCache();
  const match = await persistent?.match(url);
  if (!match?.ok) return null;
  const blob = await match.blob();
  if (blob.size < 1024) return null;
  const objectUrl = URL.createObjectURL(blob);
  memory.set(url, { objectUrl });
  return objectUrl;
}

export function primeAudio(url: string, signal?: AbortSignal): Promise<string | null> {
  if (!url) return Promise.resolve(null);
  const existing = memory.get(url);
  if (existing?.objectUrl) return Promise.resolve(existing.objectUrl);
  if (existing?.inflight) return existing.inflight;
  if (streamingUrl === url) return Promise.resolve(null);

  const inflight = (async () => {
    const hydrated = await hydrateFromCache(url);
    if (hydrated) return hydrated;
    const res = await fetch(url, {
      cache: "no-store",
      credentials: "same-origin",
      signal,
    });
    if (!res.ok || res.status !== 200) throw new Error(`audio ${res.status}`);
    const persistent = await openPersistentCache();
    if (persistent) {
      try {
        await persistent.put(url, res.clone());
      } catch {
        /* quota */
      }
    }
    const blob = await res.blob();
    if (signal?.aborted) return null;
    const objectUrl = URL.createObjectURL(blob);
    memory.set(url, { objectUrl });
    return objectUrl;
  })().catch(() => {
    const cur = memory.get(url);
    if (cur && !cur.objectUrl) memory.delete(url);
    return null;
  });

  memory.set(url, { inflight });
  return inflight;
}

export function retainAudio(keep: Iterable<string>) {
  const keepSet = new Set(Array.from(keep).filter(Boolean));
  for (const [url, entry] of memory) {
    if (keepSet.has(url)) continue;
    if (entry.objectUrl) URL.revokeObjectURL(entry.objectUrl);
    memory.delete(url);
  }
}

export function clearAudioCache() {
  retainAudio([]);
  streamingUrl = "";
}

export function assignAudioSrc(audio: HTMLAudioElement, networkUrl: string) {
  const src = playableSrc(networkUrl);
  if (sameAudioSrc(audio, src)) return;
  audio.src = src;
  audio.load();
}

export function adoptBlobSrc(audio: HTMLAudioElement, networkUrl: string) {
  const blob = cachedSrc(networkUrl);
  if (!blob || sameAudioSrc(audio, blob)) return;
  const resumeTime = audio.currentTime;
  audio.src = blob;
  audio.load();
  const restore = () => {
    if (resumeTime > 0.15 && Number.isFinite(resumeTime)) {
      try {
        audio.currentTime = resumeTime;
      } catch {
        /* Safari may reject until metadata */
      }
    }
  };
  if (audio.readyState >= HAVE_METADATA) restore();
  else audio.addEventListener("loadedmetadata", restore, { once: true });
}

export function resumeMedia(
  audio: HTMLAudioElement,
  networkUrl: string,
  resumeTime: number,
  backgrounded: boolean,
): Promise<void> {
  const src = playableSrc(networkUrl);
  const rebuild = mediaNeedsRebuild({
    readyState: audio.readyState,
    hasError: Boolean(audio.error),
    srcMatches: sameAudioSrc(audio, src),
    backgrounded,
  });
  if (rebuild) {
    audio.src = src;
    audio.load();
  }
  const shouldSeek = resumeTime > 0.15 && Number.isFinite(resumeTime);
  if (shouldSeek && audio.readyState >= HAVE_METADATA) {
    try {
      audio.currentTime = resumeTime;
    } catch {
      /* Safari may reject until metadata */
    }
  } else if (shouldSeek && rebuild) {
    const wasMuted = audio.muted;
    audio.muted = true;
    const restore = () => {
      if (!sameAudioSrc(audio, src)) {
        audio.muted = wasMuted;
        return;
      }
      try {
        audio.currentTime = resumeTime;
      } catch {
        /* ignore */
      }
      audio.muted = wasMuted;
    };
    audio.addEventListener("loadedmetadata", restore, { once: true });
    window.setTimeout(restore, 900);
  }
  return audio.play().then(() => undefined);
}
