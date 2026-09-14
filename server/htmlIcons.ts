import { createHash } from "crypto";
import fs from "fs";
import { faviconPublicPath } from "./media";

export function siteIconStamp(favicon: string, rev = ""): string {
  return createHash("sha1").update(`${favicon.trim()}\0${rev}`).digest("hex").slice(0, 16);
}

export function faviconRevision(): string {
  const ico = faviconPublicPath("favicon.ico");
  if (!ico) return "";
  return String(Math.round(fs.statSync(ico).mtimeMs));
}

export function currentIconStamp(favicon: string): string {
  return siteIconStamp(favicon, faviconRevision());
}

/** Safari reads these tags from the first HTML bytes and ignores later JavaScript. */
export function htmlWithSiteIcons(html: string, favicon: string): string {
  if (!favicon || !html) return html;
  const stamp = currentIconStamp(favicon);
  const block = [
    `<link rel="icon" type="image/png" href="/icon-${stamp}.png" />`,
    `<link rel="apple-touch-icon" href="/touch-${stamp}.png" />`,
    `<link rel="manifest" href="/site-icons/${stamp}/site.webmanifest" />`,
  ].join("\n    ");
  let next = html.replace(/\n?[ \t]*<link\b[^>]*\brel="(?:shortcut icon|icon|apple-touch-icon|manifest)"[^>]*>/gi, "");
  if (/<meta name="msapplication-TileImage"/.test(next)) {
    next = next.replace(
      /<meta name="msapplication-TileImage"[^>]*>/,
      `<meta name="msapplication-TileImage" content="/icon-${stamp}.png" />\n    ${block}`,
    );
  } else {
    next = next.replace("</head>", `    ${block}\n  </head>`);
  }
  return next;
}
