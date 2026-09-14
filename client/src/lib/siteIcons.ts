import type { PlayerSetup } from "@shared/types";

export const SITE_ICON_LINKS = [
  { rel: "icon", href: "/favicon.ico", sizes: "48x48" },
  { rel: "icon", href: "/favicon-16x16.png", type: "image/png", sizes: "16x16" },
  { rel: "icon", href: "/favicon-32x32.png", type: "image/png", sizes: "32x32" },
  { rel: "icon", href: "/favicon-96x96.png", type: "image/png", sizes: "96x96" },
  { rel: "apple-touch-icon", href: "/apple-touch-icon.png", sizes: "180x180" },
] as const;

export function siteIconHref(path: string, favicon: string): string {
  return `${path}?v=${encodeURIComponent(favicon)}`;
}

function upsertLink(rel: string, href: string, extra?: { type?: string; sizes?: string }) {
  const links = Array.from(document.querySelectorAll(`link[rel="${rel}"]`)) as HTMLLinkElement[];
  const match = extra?.sizes
    ? links.find((link) => link.getAttribute("sizes") === extra.sizes)
    : links[0];
  const el = match || document.createElement("link");
  el.rel = rel;
  el.href = href;
  if (extra?.type) el.type = extra.type;
  if (extra?.sizes) el.setAttribute("sizes", extra.sizes);
  if (!match) document.head.appendChild(el);
}

export function applySiteIcons(setup: Pick<PlayerSetup, "favicon">) {
  if (typeof document === "undefined" || !setup.favicon) return;
  for (const icon of SITE_ICON_LINKS) {
    upsertLink(icon.rel, siteIconHref(icon.href, setup.favicon), icon);
  }
  upsertLink("manifest", siteIconHref("/site.webmanifest", setup.favicon));
  const tile = document.querySelector('meta[name="msapplication-TileImage"]');
  if (tile) tile.setAttribute("content", siteIconHref("/android-chrome-192x192.png", setup.favicon));
}
