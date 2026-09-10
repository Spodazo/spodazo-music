function isListening(): boolean {
  return Array.from(document.querySelectorAll("audio")).some((el) => !el.paused);
}

export function watchAppUpdates() {
  let current = "";
  let pending = false;

  async function check() {
    try {
      const res = await fetch("/api/version", { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as { build?: string };
      const build = String(body.build || "");
      if (!build) return;
      if (!current) {
        current = build;
        return;
      }
      if (build === current) return;
      if (isListening()) {
        pending = true;
        return;
      }
      window.location.reload();
    } catch {
      /* offline */
    }
  }

  void check();
  window.setInterval(() => {
    if (pending && !isListening()) {
      window.location.reload();
      return;
    }
    void check();
  }, 45000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      if (pending && !isListening()) window.location.reload();
      else void check();
    }
  });
  window.addEventListener("pageshow", () => {
    if (pending && !isListening()) window.location.reload();
    else void check();
  });
}