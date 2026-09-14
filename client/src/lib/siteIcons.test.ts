import assert from "node:assert/strict";
import test from "node:test";
import { applySiteIcons, siteIconHref } from "./siteIcons";

function link(rel: string, href: string, sizes?: string, type?: string) {
  return {
    rel,
    href,
    type: type || "",
    getAttribute(name: string) {
      return name === "sizes" ? sizes || null : name === "href" ? this.href : null;
    },
    setAttribute(name: string, value: string) {
      if (name === "sizes") sizes = value;
      if (name === "href") this.href = value;
    },
    replaceWith(next: { href: string }) {
      this.href = next.href;
      this.rel = (next as { rel?: string }).rel || this.rel;
    },
  };
}

test("siteIconHref uses a new path so Safari cannot keep the old icon", () => {
  assert.equal(siteIconHref("/favicon.ico", "Mark.webp"), "/site-icons/Mark.webp/favicon.ico");
  assert.equal(siteIconHref("/favicon-32x32.png", "My Icon.webp"), "/site-icons/My%20Icon.webp/favicon-32x32.png");
  assert.equal(siteIconHref("favicon.ico?v=old", "Mark.webp"), "/site-icons/Mark.webp/favicon.ico");
});

test("applySiteIcons stamps every browser icon link", () => {
  const icons = [
    link("icon", "/favicon.ico", "48x48"),
    link("icon", "/favicon-16x16.png", "16x16", "image/png"),
    link("icon", "/favicon-32x32.png", "32x32", "image/png"),
    link("icon", "/favicon-96x96.png", "96x96", "image/png"),
  ];
  const shortcut: ReturnType<typeof link>[] = [];
  const apple = [link("apple-touch-icon", "/apple-touch-icon.png", "180x180")];
  const manifest = [link("manifest", "/site.webmanifest")];
  const created: ReturnType<typeof link>[] = [];
  const tile = { content: "/android-chrome-192x192.png" };
  Object.defineProperty(globalThis, "document", {
    value: {
      querySelectorAll(selector: string) {
        if (selector === 'link[rel="icon"]') return icons;
        if (selector === 'link[rel="shortcut icon"]') return shortcut;
        if (selector === 'link[rel="apple-touch-icon"]') return apple;
        if (selector === 'link[rel="manifest"]') return manifest;
        return [];
      },
      querySelector(selector: string) {
        return selector === 'meta[name="msapplication-TileImage"]'
          ? { setAttribute(_name: string, value: string) { tile.content = value; } }
          : null;
      },
      createElement() {
        const next = link("", "");
        created.push(next);
        return next;
      },
      head: {
        appendChild(node: ReturnType<typeof link>) {
          if (node.rel === "shortcut icon") shortcut.push(node);
        },
      },
    },
    configurable: true,
  });
  applySiteIcons({ favicon: "Mark.webp" });
  assert.equal(icons.find((item) => item.getAttribute("sizes") === "48x48")?.href, "/site-icons/Mark.webp/favicon.ico");
  assert.equal(icons.find((item) => item.getAttribute("sizes") === "32x32")?.href, "/site-icons/Mark.webp/favicon-32x32.png");
  assert.equal(apple[0].href, "/site-icons/Mark.webp/apple-touch-icon.png");
  assert.equal(manifest[0].href, "/site-icons/Mark.webp/site.webmanifest");
  assert.equal(shortcut[0]?.href, "/site-icons/Mark.webp/favicon.ico");
  assert.equal(tile.content, "/site-icons/Mark.webp/android-chrome-192x192.png");
});
