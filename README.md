# Spodazo Music

Public album player at [spodazomusic.com](https://spodazomusic.com). Media and catalog live on Railway. There is no WordPress dependency.

The public site has **no login**. `/admin` is password-protected so you can add albums, songs, artwork, and lyrics.

## What visitors see

- `/` — album list
- `/echoes` — Echoes of Storms player
- later albums — `/your-album-slug`

## Local

```bash
cd spodazo-music
cp .env.example .env
# set ADMIN_PASSWORD and SESSION_SECRET
npm install
npm run dev
```

Opens on port 3000. Catalog is stored in `.music-data/catalog.json` until `DATABASE_URL` is set. Upload MP3s and artwork in `/admin` (or copy them into `.music-data/songs` and `.music-data/images`).

## Admin

1. Open `/admin`
2. Sign in with `ADMIN_PASSWORD`
3. Create or edit an album (title, slug, hero portrait, thumbnail, credits)
4. Add a song (title, scripture, MP3, artwork, lyrics)

## Railway

Create a **new** Railway project named **Spodazo Music**.

1. Deploy from the `Spodazo/spodazo-music` GitHub repo.
2. Add a **Postgres** plugin in the same project.
3. Add a **volume** mounted at `/data`.
4. Set variables:

```
ADMIN_PASSWORD=...
SESSION_SECRET=...
DATABASE_URL=${{Postgres.DATABASE_URL}}
MUSIC_DATA_DIR=/data/music
```

5. Health check: `GET /api/version`
6. Custom domain: `spodazomusic.com`

Artwork in `media/images/` is copied onto the volume on startup. Songs must be uploaded in Admin (they are not stored in git).

## Backup

```bash
npm run db:backup
```

Writes a Postgres custom dump when `DATABASE_URL` is set, otherwise a tarball of `MUSIC_DATA_DIR`.

## Stack

Express + React + Vite + Drizzle. Postgres on Railway; JSON catalog locally.
