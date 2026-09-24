export const LAST_PLACE_KEY = "spodazo-last-place-v1";

export type LastPlace = {
  path: string;
  playing?: boolean;
  trackId?: string;
  time?: number;
};

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function standaloneApp(): boolean {
  if (typeof window === "undefined") return false;
  const media = typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches;
  return Boolean(media || (navigator as Navigator & { standalone?: boolean }).standalone);
}

export function isRestorablePath(path: string): boolean {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("://")) return false;
  const [pathname] = path.split(/[?#]/);
  if (!pathname || pathname === "/" || pathname.startsWith("/admin")) return false;
  return pathname.slice(1).length > 0 && !pathname.slice(1).includes("/");
}

export function writeLastPlace(place: LastPlace) {
  try {
    const path = String(place.path || "/");
    storage()?.setItem(LAST_PLACE_KEY, JSON.stringify({
      path,
      playing: Boolean(place.playing),
      trackId: place.trackId || "",
      time: Number.isFinite(place.time) ? Number(place.time) : 0,
    }));
  } catch {
    /* private mode */
  }
}

export function readLastPlace(): LastPlace | null {
  try {
    const raw = storage()?.getItem(LAST_PLACE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LastPlace;
    if (!parsed || typeof parsed !== "object" || typeof parsed.path !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function restoreLastPlace(currentPath: string, standalone = standaloneApp()): string {
  if (currentPath !== "/" || !standalone) return currentPath;
  const last = readLastPlace();
  if (!last || !isRestorablePath(last.path)) return currentPath;
  return last.path;
}
