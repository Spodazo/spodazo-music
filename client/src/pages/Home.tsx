import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import AdminLoginLink from "../components/AdminLoginLink";
import { fetchAlbums, fetchPlayerSetup } from "../lib/api";
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

export default function HomePage() {
  const [albums, setAlbums] = useState<AlbumListItem[]>([]);
  const [setup, setSetup] = useState<PlayerSetup>(DEFAULT_PLAYER_SETUP);
  const [error, setError] = useState("");
  const themeRef = useFitOneLine(setup.theme);

  useEffect(() => {
    fetchAlbums()
      .then(setAlbums)
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
          <img className="home-logo" src={setup.logoUrl} alt={setup.appName} />
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
          <img className="collection-cover" src={setup.collectionCoverUrl} alt={setup.appName} />
        ) : null}
        <div className="album-grid">
          {albums.map((album) => {
            const hasOwnBackground = Boolean(album.heroPortrait && album.heroPortrait !== album.thumb);
            const backgroundUrl = hasOwnBackground ? album.heroUrl : "";
            const coverUrl = album.thumbUrl || (!backgroundUrl ? album.heroUrl : "");
            return (
              <Link key={album.id} href={`/${album.slug}`} className="album-card">
                <div className={`album-card-art${backgroundUrl ? " has-bg" : ""}`}>
                  {backgroundUrl ? <img className="album-card-bg" src={backgroundUrl} alt="" /> : null}
                  {coverUrl ? (
                    <img className="album-card-cover" src={coverUrl} alt={album.title} />
                  ) : (
                    <div className="album-card-empty" />
                  )}
                </div>
                <div className="album-card-body">
                  <h2>{album.title}{album.hidden ? <span className="hidden-badge">Hidden</span> : null}</h2>
                  <p>{album.artists || album.tagline}</p>
                  <p>{album.trackCount} {album.trackCount === 1 ? "song" : "songs"}</p>
                </div>
              </Link>
            );
          })}
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
        <div className="sdg sdg-sm">
          <svg className="sdg-cross" viewBox="0 0 10 11" aria-hidden="true">
            <rect x="4" y="0" width="2" height="11" />
            <rect x="0" y="3.5" width="10" height="2" />
          </svg>
          Soli Deo Gloria
        </div>
      </footer>
    </main>
  );
}
