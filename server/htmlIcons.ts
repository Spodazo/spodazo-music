import fs from "fs";
import { FAVICON_PUBLIC_FILES, faviconPublicPath } from "./media";

const HTML_ICON_FILES = [...FAVICON_PUBLIC_FILES, "site.webmanifest"] as const;

export function siteIconStamp(favicon: string, rev = ""): string {
  const base = encodeURIComponent(favicon.trim()) || "icon";
  return rev ? `${base}.${rev}` : base;
}

export function faviconRevision(): string {
  const ico = faviconPublicPath("favicon.ico");
  if (!ico) return "";
  return String(Math.round(fs.statSync(ico).mtimeMs));
}

/** Safari reads icon links from the first HTML bytes and ignores later JavaScript. */
export function htmlWithSiteIcons(html: string, favicon: string): string {
  if (!favicon || !html) return html;
  const stamp = siteIconStamp(favicon, faviconRevision());
  let next = html;
  for (const name of HTML_ICON_FILES) {
    next = next.replaceAll(`="/${name}"`, `="/site-icons/${stamp}/${name}"`);
  }
  return next;
}
