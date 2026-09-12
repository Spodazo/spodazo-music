import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import AdminLoginLink from "../components/AdminLoginLink";
import SdgFooter from "../components/SdgFooter";
import { fetchAlbums, fetchPlayerSetup } from "../lib/api";
import { readCachedAlbums, writeCachedAlbums } from "../lib/homeCache";
import { copyrightLines, DEFAULT_PLAYER_SETUP } from "@shared/seed-data";
import type { AlbumListItem, PlayerSetup } from "@shared/types";
import { applyPalette } from "../lib/palette";

function useFitOneLine(text: string) {
  const ref = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    function fit() {
      const max = el.parentElement?.clientWidth || el.clientWidth;
      if (!max) return;
      el.style.fontSize = "16px";
      const width = el.scrollWidth;
      if (width > max) el.style.fontSize = `${Math.max(8, (16 * max) / width)}px`;
    }

    let cancelled = false;
    const run = () => {
      if (!cancelled) fit();
    };
    run();
    void document.fonts?.ready.then(run);
    const observer = new ResizeObserver(run);
    if (el.parentElement) observer.observe(el.parentElement);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [text]);

  return ref;
}

function useDecodedImage(src: string, priority = false) {
  const [ready, setReady] = useState(!src);

  useEffect(() => {
    if (!src) {
      setReady(true);
      return;
    }
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      setReady(true);
    };
    setReady(false);
    const image = new Image();
    if (priority) image.fetchPriority = "high";
    image.decoding = "async";
    image.onload = done;
    image.onerror = done;
    image.src = src;
    if (image.complete && image.naturalWidth) done();
    return () => {
      image.onload = null;
      image.onerror = null;
    };
  }, [src, priority]);

  return ready;
}

function AlbumCard({ album, priority }: { album: AlbumListItem; priority: boolean }) {
  const hasOwnBackground = Boolean(album.heroPortrait && album.heroPortrait !== album.thumb);
  const backgroundUrl = hasOwnBackground ? album.heroUrl : "";
  const coverUrl = album.thumbUrl || (!backgroundUrl ? album.heroUrl : "");
  const bgReady = useDecodedImage(backgroundUrl, priority);
  const coverReady = useDecodedImage(coverUrl, priority);
  const ready = bgReady && coverReady;

  return (
    <Link href={`/${album.slug}`} className="album-card">
      <div className={`album-card-art${backgroundUrl ? " has-bg" : ""}${ready ? " is-ready" : ""}`}>
        {ready && backgroundUrl ? (
          <img className="album-card-bg" src={backgroundUrl} alt="" decoding="async" />
        ) : null}
        {ready && coverUrl ? (
          <img className="album-card-cover" src={coverUrl} alt={album.title} decoding="async" />
        ) : !coverUrl ? (
          <div className="album-card-empty" />
        ) : null}
      </div>
      <div className="album-card-body">
        <h2>{album.title}{album.hidden ? <span className="hidden-badge">Hidden</span> : null}</h2>
        <p>{album.artists || album.tagline}</p>
        <p>{album.trackCount} {album.trackCount === 1 ? "song" : "songs"}</p>
      </div>
    </Link>
  );
}

export default function HomePage() {
  const [albums, setAlbums] = useState<AlbumListItem[]>(() => readCachedAlbums());
  const [setup, setSetup] = useState<PlayerSetup>(DEFAULT_PLAYER_SETUP);
  const [error, setError] = useState("");
  const themeRef = useFitOneLine(setup.theme);

  useEffect(() => {
    fetchAlbums()
      .then((next) => {
        writeCachedAlbums(next);
        setAlbums(next);
      })
      .catch((err: Error) => setError(err.message));
    fetchPlayerSetup()
      .then((next) => {
        setSetup(next);
        applyPalette(next.collectionColor);
        document.title = next.appName;
      })
      .catch(() => undefined);
  }, []);

  return (
    <main className="home">
      <AdminLoginLink />
      <div className="home-brand">
        {setup.logoUrl ? (
          <img className="home-logo" src={setup.logoUrl} alt={setup.appName} decoding="async" fetchPriority="high" />
        ) : (
          <div className="home-logo home-logo-placeholder" aria-label={setup.appName}>
            Logo
          </div>
        )}
        {setup.theme ? <p ref={themeRef} className="home-theme">{setup.theme}</p> : null}
      </div>
      <div className="home-main">
        {error ? <p className="error">{error}</p> : null}
        {setup.collectionCoverUrl ? (
          <img className="collection-cover" src={setup.collectionCoverUrl} alt={setup.appName} decoding="async" />
        ) : null}
        <div className="album-grid">
          {albums.map((album, index) => (
            <AlbumCard key={album.id} album={album} priority={index === 0} />
          ))}
        </div>
      </div>
      <footer className="home-foot">
        <p className="home-foot-credit">{setup.credits}</p>
        <p className="home-foot-copy">
          {copyrightLines(setup.copyright).map((line, index) => (
            <span key={index}>
              {index > 0 ? <br /> : null}
              {line}
            </span>
          ))}
        </p>
        <SdgFooter imageUrl={setup.footerImageUrl} compact />
      </footer>
    </main>
  );
}
