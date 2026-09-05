# Spodazo Music

Public album player for [music.spodazo.com](https://music.spodazo.com), starting with **Echoes of Storms** at `/echoes`.

This is a **copy** of the WordPress player, not a migration. WordPress at `/echoes` stays live until you point the domain at this app.

The public site has **no login**. `/admin` is password-protected so you can add albums, songs, artwork, and lyrics without rewriting an index file.

## What visitors see

- `/` — album list (ready for more than Echoes)
- `/echoes` — the Echoes player (track list, Play All, modal, lyrics, `#song-slug` links)
- later albums — `/your-album-slug`

## Local

```bash
cd spodazo-music
cp .env.example .env
# set ADMIN_PASSWORD and SESSION_SECRET
npm install
npm run dev
```

Opens on port 3000. Catalog is stored in `.music-data/catalog.json` until `DATABASE_URL` is set.

Optional: copy the live Echoes MP3s and images into `.music-data` (WordPress stays untouched):

```bash
npm run seed:wordpress
```

If SiteGround blocks the download, the player still streams from `https://music.spodazo.com/Images` and `/Songs` until you upload files in `/admin`.

## Admin

1. Open `/admin`
2. Sign in with `ADMIN_PASSWORD`
3. Create or edit an album (title, slug, hero portrait, thumbnail, credits)
4. Add a song (title, scripture, MP3, artwork, lyrics)

## Railway (own project — not Team Melanie)

Create a **new** Railway project named **Spodazo Music**. Do not add this service to the Team Melanie project.

1. New GitHub repo `spodazo/spodazo-music` from this folder (or deploy this folder as the service root).
2. Add a **Postgres** plugin in the same project.
3. Add a **volume** mounted at `/data`.
4. Set variables:

```
ADMIN_PASSWORD=...
SESSION_SECRET=...
DATABASE_URL=${{Postgres.DATABASE_URL}}
MUSIC_DATA_DIR=/data/music
MUSIC_ORIGIN=https://music.spodazo.com
```

5. Health check: `GET /api/version`
6. Custom domain: add `music.spodazo.com` in Railway **after** the player looks right. Until then WordPress keeps the domain.

Cutover (when you are ready):

1. Confirm `/` lists Echoes and `/echoes` plays all 12 songs from local `/media` files (not only WordPress URLs).
2. Upload any missing artwork/audio in `/admin`, or run `npm run seed:wordpress` against the volume.
3. Point `music.spodazo.com` at the Railway service (CNAME / Railway nameservers).
4. Leave the WordPress site as a backup for a few days.

## Backup

```bash
npm run db:backup
```

Writes a Postgres custom dump when `DATABASE_URL` is set, otherwise a tarball of `MUSIC_DATA_DIR`.

## Stack

Express + React + Vite + Drizzle. Postgres on Railway; JSON catalog locally.
