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
      <p className="home-kicker">Spodazo Music</p>
      <h1>Albums</h1>
      <p className="home-lead">
        Music, lyrics and graphics by Spodazo. Open an album to listen.
      </p>
      {error ? <p className="error">{error}</p> : null}
      <div className="album-grid">
        {albums.map((album) => (
          <Link key={album.id} href={`/${album.slug}`} className="album-card">
            {album.thumbUrl ? <img src={album.thumbUrl} alt={album.title} /> : <div style={{ aspectRatio: "1", background: "#1b2330" }} />}
            <div className="album-card-body">
              <h2>{album.title}</h2>
              <p>{album.artists || album.tagline}</p>
              <p>{album.trackCount} {album.trackCount === 1 ? "song" : "songs"}</p>
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
