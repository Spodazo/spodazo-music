import type { PlayerSetup } from "@shared/types";

export const SITE_ICON_LINKS = [
  { rel: "icon", href: "/favicon.ico", sizes: "48x48" },
  { rel: "shortcut icon", href: "/favicon.ico" },
  { rel: "icon", href: "/favicon-16x16.png", type: "image/png", sizes: "16x16" },
  { rel: "icon", href: "/favicon-32x32.png", type: "image/png", sizes: "32x32" },
  { rel: "icon", href: "/favicon-96x96.png", type: "image/png", sizes: "96x96" },
  { rel: "apple-touch-icon", href: "/apple-touch-icon.png", sizes: "180x180" },
] as const;

export function siteIconStamp(favicon: string): string {
  return encodeURIComponent(favicon.trim()) || "icon";
}

/** Safari ignores query strings on favicons. A new path forces a refetch. */
export function siteIconHref(file: string, favicon: string): string {
  const name = file.replace(/^\/+/, "").split("?")[0];
  return `/site-icons/${siteIconStamp(favicon)}/${name}`;
}

function replaceLink(rel: string, href: string, extra?: { type?: string; sizes?: string }) {
  const links = Array.from(document.querySelectorAll(`link[rel="${rel}"]`)) as HTMLLinkElement[];
  const match = extra?.sizes
    ? links.find((link) => link.getAttribute("sizes") === extra.sizes)
    : links[0];
  const el = document.createElement("link");
  el.rel = rel;
  el.href = href;
  if (extra?.type) el.type = extra.type;
  if (extra?.sizes) el.setAttribute("sizes", extra.sizes);
  if (match) {
    match.replaceWith(el);
    return;
  }
  document.head.appendChild(el);
}

export function applySiteIcons(setup: Pick<PlayerSetup, "favicon">) {
  if (typeof document === "undefined" || !setup.favicon) return;
  if (document.querySelector('link[rel="icon"][href*="/icon-"]')) return;
  for (const icon of SITE_ICON_LINKS) {
    replaceLink(icon.rel, siteIconHref(icon.href, setup.favicon), icon);
  }
  replaceLink("manifest", siteIconHref("/site.webmanifest", setup.favicon));
  const tile = document.querySelector('meta[name="msapplication-TileImage"]');
  if (tile) tile.setAttribute("content", siteIconHref("/android-chrome-192x192.png", setup.favicon));
}
