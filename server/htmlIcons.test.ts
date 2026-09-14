import assert from "node:assert/strict";
import test from "node:test";
import { htmlWithSiteIcons, siteIconStamp } from "./htmlIcons";

test("siteIconStamp is a short hex path Safari can fetch", () => {
  assert.match(siteIconStamp("Mark.webp"), /^[a-f0-9]{16}$/);
  assert.notEqual(siteIconStamp("Mark.webp"), siteIconStamp("Other.webp"));
  assert.notEqual(siteIconStamp("My Icon.webp", "1"), siteIconStamp("My Icon.webp", "2"));
});

test("htmlWithSiteIcons gives Safari a new PNG URL and drops /favicon.ico", () => {
  const html = [
    '<link rel="icon" href="/favicon.ico" sizes="48x48" />',
    '<link rel="shortcut icon" href="/favicon.ico" />',
    '<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />',
    '<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />',
    '<link rel="manifest" href="/site.webmanifest" />',
    '<meta name="msapplication-TileImage" content="/android-chrome-192x192.png" />',
    "</head>",
  ].join("\n");
  const next = htmlWithSiteIcons(html, "Mark.webp");
  assert.match(next, /href="\/icon-[a-f0-9]{16}\.png"/);
  assert.match(next, /href="\/touch-[a-f0-9]{16}\.png"/);
  assert.equal(next.includes('href="/favicon.ico"'), false);
  assert.equal(next.includes("shortcut icon"), false);
  assert.equal(htmlWithSiteIcons(html, ""), html);
});
