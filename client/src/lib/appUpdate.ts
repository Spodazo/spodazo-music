const BUILD_PARAM = "_spodazo";
const CHECK_MS = 15000;
const NO_STORE: RequestInit = {
  cache: "no-store",
  headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
};

export function shouldApplyUpdate(current: string, next: string): boolean {
  return Boolean(current && next && current !== next);
}

export function buildReloadUrl(href: string, build: string): string {
  const url = new URL(href, "https://spodazomusic.com");
  url.searchParams.set(BUILD_PARAM, build.slice(0, 16) || String(Date.now()));
  return `${url.pathname}${url.search}${url.hash}`;
}

export function stripBuildParam(href: string): string {
  const url = new URL(href, "https://spodazomusic.com");
  if (!url.searchParams.has(BUILD_PARAM)) return `${url.pathname}${url.search}${url.hash}`;
  url.searchParams.delete(BUILD_PARAM);
  const search = url.searchParams.toString();
  return `${url.pathname}${search ? `?${search}` : ""}${url.hash}`;
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

export async function applyAppUpdate(build: string): Promise<void> {
  await clearStaleAppCaches();
  window.location.replace(buildReloadUrl(window.location.href, build));
}

export function watchAppUpdates() {
  let current = "";
  let pendingBuild = "";
  let applying = false;

  dropBuildFromAddress();

  async function apply(build: string) {
    if (applying) return;
    applying = true;
    await applyAppUpdate(build);
  }

  async function check() {
    try {
      const res = await fetch("/api/version", NO_STORE);
      if (!res.ok) return;
      const body = (await res.json()) as { build?: string };
      const build = String(body.build || "");
      if (!build) return;
      if (!current) {
        current = build;
        return;
      }
      if (!shouldApplyUpdate(current, build)) return;
      if (isListening()) {
        pendingBuild = build;
        return;
      }
      await apply(build);
    } catch {
      /* offline */
    }
  }

  function flushPending() {
    if (!pendingBuild || isListening()) return;
    void apply(pendingBuild);
  }

  void check();
  window.setInterval(() => {
    if (pendingBuild) flushPending();
    else void check();
  }, CHECK_MS);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      if (pendingBuild) flushPending();
      else void check();
    }
  });
  window.addEventListener("pageshow", () => {
    if (pendingBuild) flushPending();
    else void check();
  });
  window.addEventListener("focus", () => {
    if (pendingBuild) flushPending();
    else void check();
  });
}
