import assert from "node:assert/strict";
import test from "node:test";
import { htmlWithSiteIcons, siteIconStamp } from "./htmlIcons";

test("siteIconStamp encodes the file and optional revision", () => {
  assert.equal(siteIconStamp("Mark.webp"), "Mark.webp");
  assert.equal(siteIconStamp("My Icon.webp", "9"), "My%20Icon.webp.9");
});

test("htmlWithSiteIcons rewrites the default icon links Safari reads", () => {
  const html = [
    '<link rel="icon" href="/favicon.ico" sizes="48x48" />',
    '<link rel="shortcut icon" href="/favicon.ico" />',
    '<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />',
    '<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />',
    '<link rel="manifest" href="/site.webmanifest" />',
    '<meta name="msapplication-TileImage" content="/android-chrome-192x192.png" />',
  ].join("\n");
  const next = htmlWithSiteIcons(html, "Mark.webp");
  assert.match(next, /href="\/site-icons\/Mark\.webp(?:\.\d+)?\/favicon\.ico"/);
  assert.match(next, /href="\/site-icons\/Mark\.webp(?:\.\d+)?\/favicon-32x32\.png"/);
  assert.match(next, /href="\/site-icons\/Mark\.webp(?:\.\d+)?\/apple-touch-icon\.png"/);
  assert.match(next, /href="\/site-icons\/Mark\.webp(?:\.\d+)?\/site\.webmanifest"/);
  assert.match(next, /content="\/site-icons\/Mark\.webp(?:\.\d+)?\/android-chrome-192x192\.png"/);
  assert.equal(next.includes('href="/favicon.ico"'), false);
  assert.equal(htmlWithSiteIcons(html, ""), html);
});
