import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { watchAppUpdates } from "./lib/appUpdate";
import { dropLegacyAudioCaches } from "./lib/audioCache";
import { persistedSessionRestoreAllowed, restoreLastPlace } from "./lib/lastPlace";
import { prefetchHome, readCachedAlbums, readCachedSetup } from "./lib/homeCache";
import { prefetchAlbumImages, readCachedAlbum } from "./lib/albumCache";
import { prefetchCachedImages } from "./lib/images";
import { restorePalette } from "./lib/palette";
import { applySiteIcons } from "./lib/siteIcons";
import "./index.css";

restorePalette();
const cachedSetup = readCachedSetup();
if (cachedSetup) applySiteIcons(cachedSetup);
prefetchHome();
const cachedAlbums = readCachedAlbums();
prefetchCachedImages([
  cachedSetup?.logoUrl,
  cachedSetup?.collectionCoverUrl,
  ...cachedAlbums.flatMap((album) => [album.thumbUrl, album.heroUrl]),
]);
for (const album of cachedAlbums) {
  const cached = readCachedAlbum(album.slug);
  if (cached) prefetchAlbumImages(cached);
}
void dropLegacyAudioCaches();
const allowSessionRestore = persistedSessionRestoreAllowed();
const lastPath = allowSessionRestore
  ? restoreLastPlace(window.location.pathname)
  : window.location.pathname;
if (lastPath !== window.location.pathname) {
  window.history.replaceState(window.history.state, "", lastPath + window.location.search + window.location.hash);
} else if (!allowSessionRestore && window.location.hash) {
  window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
}
watchAppUpdates();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
