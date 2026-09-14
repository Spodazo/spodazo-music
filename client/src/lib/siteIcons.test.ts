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
  };
}

test("siteIconHref cache-busts generated icons from the source filename", () => {
  assert.equal(siteIconHref("/favicon.ico", "Mark.webp"), "/favicon.ico?v=Mark.webp");
  assert.equal(siteIconHref("/favicon-32x32.png", "My Icon.webp"), "/favicon-32x32.png?v=My%20Icon.webp");
});

test("applySiteIcons stamps every browser icon link", () => {
  const icons = [
    link("icon", "/favicon.ico", "48x48"),
    link("icon", "/favicon-16x16.png", "16x16", "image/png"),
    link("icon", "/favicon-32x32.png", "32x32", "image/png"),
    link("icon", "/favicon-96x96.png", "96x96", "image/png"),
  ];
  const apple = [link("apple-touch-icon", "/apple-touch-icon.png", "180x180")];
  const manifest = [link("manifest", "/site.webmanifest")];
  const tile = { content: "/android-chrome-192x192.png" };
  Object.defineProperty(globalThis, "document", {
    value: {
      querySelectorAll(selector: string) {
        if (selector === 'link[rel="icon"]') return icons;
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
        return link("", "");
      },
      head: { appendChild() {} },
    },
    configurable: true,
  });
  applySiteIcons({ favicon: "Mark.webp" });
  assert.equal(icons.find((item) => item.getAttribute("sizes") === "48x48")?.href, "/favicon.ico?v=Mark.webp");
  assert.equal(icons.find((item) => item.getAttribute("sizes") === "32x32")?.href, "/favicon-32x32.png?v=Mark.webp");
  assert.equal(apple[0].href, "/apple-touch-icon.png?v=Mark.webp");
  assert.equal(manifest[0].href, "/site.webmanifest?v=Mark.webp");
  assert.equal(tile.content, "/android-chrome-192x192.png?v=Mark.webp");
});
