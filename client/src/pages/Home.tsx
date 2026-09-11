import { useEffect, useState } from "react";
import { Link } from "wouter";
import AdminLoginLink from "../components/AdminLoginLink";
import { fetchAlbums, fetchPlayerSetup } from "../lib/api";
import { copyrightLines, DEFAULT_PLAYER_SETUP } from "@shared/seed-data";
import type { AlbumListItem, PlayerSetup } from "@shared/types";
import { applyPalette } from "../lib/palette";

export default function HomePage() {
  const [albums, setAlbums] = useState<AlbumListItem[]>([]);
  const [setup, setSetup] = useState<PlayerSetup>(DEFAULT_PLAYER_SETUP);
  const [error, setError] = useState("");

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
        {setup.theme ? <p className="home-theme">{setup.theme}</p> : null}
      </div>
      <div className="home-main">
        {error ? <p className="error">{error}</p> : null}
        {setup.collectionCoverUrl ? (
          <img className="collection-cover" src={setup.collectionCoverUrl} alt={setup.appName} />
        ) : null}
        <div className="album-grid">
          {albums.map((album) => (
            <Link key={album.id} href={`/${album.slug}`} className="album-card">
              {album.thumbUrl ? <img src={album.thumbUrl} alt={album.title} /> : <div style={{ aspectRatio: "1", background: "var(--bg3)" }} />}
              <div className="album-card-body">
                <h2>{album.title}{album.hidden ? <span className="hidden-badge">Hidden</span> : null}</h2>
                <p>{album.artists || album.tagline}</p>
                <p>{album.trackCount} {album.trackCount === 1 ? "song" : "songs"}</p>
              </div>
            </Link>
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
