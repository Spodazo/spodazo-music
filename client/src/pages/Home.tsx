import { useEffect, useState } from "react";
import { Link } from "wouter";
import { fetchAlbums } from "../lib/api";
import type { AlbumListItem } from "@shared/types";

export default function HomePage() {
  const [albums, setAlbums] = useState<AlbumListItem[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchAlbums()
      .then(setAlbums)
      .catch((err: Error) => setError(err.message));
  }, []);

  return (
    <main className="home">
      <Link href="/admin" className="admin-login" aria-label="Admin login" title="Admin login">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M17 9V7a5 5 0 0 0-10 0v2H5v12h14V9h-2zm-8 0V7a3 3 0 0 1 6 0v2H9zm3 5.2a1.8 1.8 0 0 1 .8 3.4V19h-1.6v-1.4a1.8 1.8 0 0 1 .8-3.4z" />
        </svg>
      </Link>
      <p className="home-kicker">Spodazo Music</p>
      {error ? <p className="error">{error}</p> : null}
      <div className="album-grid">
        {albums.map((album) => (
          <Link key={album.id} href={`/${album.slug}`} className="album-card">
            {album.thumbUrl ? <img src={album.thumbUrl} alt={album.title} /> : <div style={{ aspectRatio: "1", background: "#1b2330" }} />}
            <div className="album-card-body">
              <h2>{album.title}{album.hidden ? <span className="hidden-badge">Hidden</span> : null}</h2>
              <p>{album.artists || album.tagline}</p>
              <p>{album.trackCount} {album.trackCount === 1 ? "song" : "songs"}</p>
            </div>
          </Link>
        ))}
      </div>
      <footer className="home-foot">
        <p className="home-foot-tag">Crisis of faith answered through the Word of God</p>
        <p className="home-foot-credit">Music, lyrics and graphics by Spodazo. &nbsp;|&nbsp; Vocals by Brody Vale &amp; Eden Blue</p>
        <p className="home-foot-copy">
          Produced by Spodazo LLC, trading as Spodazo Music Ltd © 2026. All Rights Reserved.
          <br />
          This material may not be copied — in whole or in part — or distributed without previous permission from the Producers.
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
