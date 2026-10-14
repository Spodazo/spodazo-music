import { clearAlbumClientCache } from "./albumCache";
import { clearHomeClientCache } from "./homeCache";

const BUILD_PARAM = "_spodazo";
const REVISION_KEY = "spodazo-music-app-rev";
const CHECK_MS = 15000;
const NO_STORE: RequestInit = {
  cache: "no-store",
  headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
};

function appOrigin(): string {
  if (typeof window !== "undefined" && window.location?.origin) return window.location.origin;
  return "https://spodazomusic.com";
}

export type AppVersionInfo = {
  build?: string;
  catalog?: string;
};

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
    return sessionStorage.getItem(REVISION_KEY) || "";
  } catch {
    return "";
  }
}

export function writeStoredRevision(build: string) {
  try {
    if (build) sessionStorage.setItem(REVISION_KEY, build);
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

function isListening(): boolean {
  return Array.from(document.querySelectorAll("audio")).some((el) => !el.paused);
}

function dropBuildFromAddress() {
  if (typeof window === "undefined") return;
  const next = stripBuildParam(window.location.href);
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (next !== current) window.history.replaceState(window.history.state, "", next);
}

export async function applyAppUpdate(revision: string): Promise<void> {
  writeStoredRevision(revision);
  clearHomeClientCache();
  clearAlbumClientCache();
  await clearStaleAppCaches();
  window.location.replace(buildReloadUrl(window.location.href, revision));
}

export function watchAppUpdates() {
  let current = "";
  let pendingRevision = "";
  let applying = false;

  dropBuildFromAddress();

  async function reloadNow(revision: string) {
    if (applying) return;
    applying = true;
    pendingRevision = "";
    current = revision;
    await applyAppUpdate(revision);
  }

  /** Queue updates while the user is on the page; never yank a pause into a full reload. */
  async function applyWhenIdle(revision: string) {
    if (applying) return;
    if (isListening() || (typeof document !== "undefined" && !document.hidden)) {
      pendingRevision = revision;
      return;
    }
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
          // New visit / deploy mismatch — safe before the user is mid-control.
          await reloadNow(revision);
          return;
        }
        current = revision;
        writeStoredRevision(revision);
        return;
      }
      if (!shouldApplyUpdate(current, revision)) return;
      if (isCodeUpdate(current, revision)) {
        await reloadNow(revision);
        return;
      }
      await applyWhenIdle(revision);
    } catch {
      /* offline */
    }
  }

  function flushPending() {
    if (!pendingRevision || isListening()) return;
    if (typeof document !== "undefined" && !document.hidden) return;
    void reloadNow(pendingRevision);
  }

  void check();
  window.setInterval(() => {
    if (pendingRevision) flushPending();
    else void check();
  }, CHECK_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) flushPending();
    else void check();
  });
  window.addEventListener("pageshow", () => {
    if (pendingRevision) flushPending();
    else void check();
  });
  window.addEventListener("focus", () => {
    void check();
  });
}
