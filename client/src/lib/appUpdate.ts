import { clearAlbumClientCache, resetAlbumInflight } from "./albumCache";
import { clearHomeClientCache, resetHomeInflight } from "./homeCache";
import { markRestoreAfterAppUpdate } from "./lastPlace";

const BUILD_PARAM = "_spodazo";
const REVISION_KEY = "spodazo-music-app-rev";
const CHECK_MS = 15000;
const NO_STORE: RequestInit = {
  cache: "no-store",
  headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
};

export const CATALOG_REFRESH_EVENT = "spodazo-catalog-refresh";

function appOrigin(): string {
  if (typeof window !== "undefined" && window.location?.origin) return window.location.origin;
  return "https://spodazomusic.com";
}

export type AppVersionInfo = {
  build?: string;
  catalog?: string;
};

export type UpdateApplyMode = "none" | "reload" | "catalog";

/** Combine deploy build + catalog stamp so song/lyric edits refresh PWAs without a redeploy. */
export function versionRevision(info: AppVersionInfo | string): string {
  if (typeof info === "string") return info;
  const build = String(info.build || "").trim();
  const catalog = String(info.catalog || "0").trim() || "0";
  if (!build) return "";
  return `${build}:${catalog}`;
}

export function shouldApplyUpdate(current: string, next: string): boolean {
  return Boolean(current && next && current !== next);
}

/** Deploy/code stamp changed — phones must pick up the new JS even mid-listen. */
export function isCodeUpdate(current: string, next: string): boolean {
  const from = current.split(":")[0] || "";
  const to = next.split(":")[0] || "";
  return Boolean(from && to && from !== to);
}

export function updateApplyMode(current: string, next: string): UpdateApplyMode {
  if (!shouldApplyUpdate(current, next)) return "none";
  return isCodeUpdate(current, next) ? "reload" : "catalog";
}

/** Used only to delay a leftover pending reload — deploys themselves never wait. */
export const UPDATE_PLAY_HOLD_MS = 5000;

/**
 * True while a song is loaded or just started. Catalog refresh ignores this.
 * Deploy/code updates also ignore this — every PWA must cache-bust immediately.
 */
export function shouldHoldAppUpdate(playerOpen: boolean, msSincePlay = Number.POSITIVE_INFINITY): boolean {
  return playerOpen || msSincePlay < UPDATE_PLAY_HOLD_MS;
}

export function buildReloadUrl(href: string, build: string): string {
  const url = new URL(href, appOrigin());
  const stamp = build.includes(":") ? build.split(":")[0] : build;
  url.searchParams.set(BUILD_PARAM, stamp.slice(0, 16) || String(Date.now()));
  return `${url.pathname}${url.search}${url.hash}`;
}

export function stripBuildParam(href: string): string {
  const url = new URL(href, appOrigin());
  if (!url.searchParams.has(BUILD_PARAM)) return `${url.pathname}${url.search}${url.hash}`;
  url.searchParams.delete(BUILD_PARAM);
  const search = url.searchParams.toString();
  return `${url.pathname}${search ? `?${search}` : ""}${url.hash}`;
}

export function readStoredRevision(): string {
  try {
    return sessionStorage.getItem(REVISION_KEY) || localStorage.getItem(REVISION_KEY) || "";
  } catch {
    return "";
  }
}

export function writeStoredRevision(build: string) {
  try {
    if (!build) return;
    sessionStorage.setItem(REVISION_KEY, build);
    localStorage.setItem(REVISION_KEY, build);
  } catch {
    /* private mode */
  }
}

export async function clearStaleAppCaches(): Promise<void> {
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((reg) => reg.unregister()));
    }
  } catch {
    /* older WebKit */
  }
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
  } catch {
    /* private mode */
  }
}

function dropBuildFromAddress() {
  if (typeof window === "undefined") return;
  const next = stripBuildParam(window.location.href);
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (next !== current) window.history.replaceState(window.history.state, "", next);
}

/** Drop stale listing caches and tell open pages to refetch. Does not remount audio. */
export function applyCatalogRefresh() {
  clearHomeClientCache();
  clearAlbumClientCache();
  resetAlbumInflight();
  resetHomeInflight();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(CATALOG_REFRESH_EVENT));
  }
}

export async function applyAppUpdate(revision: string): Promise<void> {
  writeStoredRevision(revision);
  markRestoreAfterAppUpdate();
  clearHomeClientCache();
  clearAlbumClientCache();
  await clearStaleAppCaches();
  window.location.replace(buildReloadUrl(window.location.href, revision));
}

export function watchAppUpdates() {
  let current = "";
  let applying = false;

  dropBuildFromAddress();

  async function reloadNow(revision: string) {
    if (applying) return;
    applying = true;
    current = revision;
    await applyAppUpdate(revision);
  }

  function applyCatalog(revision: string) {
    current = revision;
    writeStoredRevision(revision);
    applyCatalogRefresh();
  }

  /** Deploy: reload every open PWA now. Song edits: refetch, never reload. */
  async function applyWhenIdle(from: string, revision: string) {
    if (applying) return;
    const mode = updateApplyMode(from, revision);
    if (mode === "catalog") {
      applyCatalog(revision);
      return;
    }
    if (mode !== "reload") return;
    await reloadNow(revision);
  }

  async function check() {
    try {
      const res = await fetch("/api/version", NO_STORE);
      if (!res.ok) return;
      const body = (await res.json()) as AppVersionInfo;
      const revision = versionRevision(body);
      if (!revision) return;
      if (!current) {
        const stored = readStoredRevision();
        if (stored && shouldApplyUpdate(stored, revision)) {
          await applyWhenIdle(stored, revision);
          if (!applying) current = revision;
          return;
        }
        current = revision;
        writeStoredRevision(revision);
        return;
      }
      if (!shouldApplyUpdate(current, revision)) return;
      await applyWhenIdle(current, revision);
    } catch {
      /* offline */
    }
  }

  void check();
  window.setInterval(() => {
    void check();
  }, CHECK_MS);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void check();
  });
  window.addEventListener("pageshow", () => {
    void check();
  });
  window.addEventListener("focus", () => {
    void check();
  });
}
