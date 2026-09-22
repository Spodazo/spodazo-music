import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import AdminLoginLink from "../components/AdminLoginLink";
import SdgFooter from "../components/SdgFooter";
import { imageIsHot, revealLoadedImage } from "../lib/images";
import {
  loadHomeAlbums,
  loadHomeSetup,
  readCachedAlbums,
  readCachedSetup,
} from "../lib/homeCache";
import { copyrightLines, creditLine, DEFAULT_PLAYER_SETUP } from "@shared/seed-data";
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

function CardImage({
  className,
  src,
  alt,
  priority = false,
}: {
  className: string;
  src: string;
  alt: string;
  priority?: boolean;
}) {
  return (
    <img
      className={`${className}${imageIsHot(src) ? " is-hot" : ""}`}
      src={src}
      alt={alt}
      decoding="auto"
      fetchPriority={priority ? "high" : "auto"}
      ref={(img) => revealLoadedImage(img, src)}
      onLoad={(event) => revealLoadedImage(event.currentTarget, src)}
    />
  );
}

function AlbumCard({ album, priority }: { album: AlbumListItem; priority: boolean }) {
  const hasOwnBackground = Boolean(album.heroPortrait && album.heroPortrait !== album.thumb);
  const backgroundUrl = hasOwnBackground ? album.heroUrl : "";
  const coverUrl = album.thumbUrl || (!backgroundUrl ? album.heroUrl : "");

  return (
    <Link href={`/${album.slug}`} className="album-card">
      <div className={`album-card-art${backgroundUrl ? " has-bg" : ""}`}>
        {backgroundUrl ? (
          <CardImage className="album-card-bg" src={backgroundUrl} alt="" priority={priority} />
        ) : null}
        {coverUrl ? (
          <CardImage className="album-card-cover" src={coverUrl} alt={album.title} priority={priority} />
        ) : (
          <div className="album-card-empty" />
        )}
      </div>
      <div className="album-card-body">
        <h2>{album.title}{album.hidden ? <span className="hidden-badge">Hidden</span> : null}</h2>
        {album.artists ? <p className="album-card-artists">{album.artists}</p> : null}
        <p>{album.trackCount} {album.trackCount === 1 ? "song" : "songs"}</p>
      </div>
    </Link>
  );
}

export default function HomePage() {
  const [albums, setAlbums] = useState<AlbumListItem[]>(() => readCachedAlbums());
  const [setup, setSetup] = useState<PlayerSetup>(() => {
    const cached = readCachedSetup();
    if (cached) {
      applyPalette(cached.collectionColor);
      document.title = cached.appName;
      return cached;
    }
    return DEFAULT_PLAYER_SETUP;
  });
  const [error, setError] = useState("");
  const themeRef = useFitOneLine(setup.theme);

  useEffect(() => {
    loadHomeAlbums()
      .then(setAlbums)
      .catch((err: Error) => setError(err.message));
    loadHomeSetup()
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
          <img className="home-logo" src={setup.logoUrl} alt={setup.appName} decoding="sync" fetchPriority="high" />
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
          <img className="collection-cover" src={setup.collectionCoverUrl} alt={setup.appName} decoding="sync" fetchPriority="high" />
        ) : null}
        <div className="album-grid">
          {albums.map((album, index) => (
            <AlbumCard key={album.id} album={album} priority={index === 0} />
          ))}
        </div>
      </div>
      <footer className="home-foot">
        {[...new Set(albums.map((album) => creditLine(album.artists, album.credits)).filter(Boolean))].map((line) => (
          <p key={line} className="home-foot-credit">{line}</p>
        ))}
        {!albums.some((album) => creditLine(album.artists, album.credits)) && setup.credits ? (
          <p className="home-foot-credit">{setup.credits}</p>
        ) : null}
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
