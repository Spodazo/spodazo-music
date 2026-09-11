import fs from "fs";
import { and, asc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { albums, tracks } from "../shared/schema";
import { DEFAULT_CATALOG, ECHOES_ALBUM, LEGACY_ECHOES_THUMB, seedLyricsForTrack } from "../shared/seed-data";
import type { Album, AlbumListItem, PublicAlbum, PublicTrack, Track } from "../shared/types";
import { audioUrl, durationLabelForFile, imageUrl } from "./media";
import { catalogPath, ensureDataDirs } from "./paths";

export type AlbumInput = {
  id?: string;
  slug: string;
  title: string;
  tagline?: string;
  credits?: string;
  artists?: string;
  copyright?: string;
  heroPortrait?: string;
  thumb?: string;
  artistThumb?: string;
  sortOrder?: number;
  hidden?: boolean;
};

export type TrackInput = {
  id?: string;
  albumId: string;
  n?: number;
  title: string;
  scripture?: string;
  file?: string;
  img?: string;
  key?: string;
  lyrics?: string;
  introduction?: string;
  instrumental?: boolean;
  slug?: string;
  archived?: boolean;
};

export interface MusicStore {
  listAlbums(): Promise<AlbumListItem[]>;
  getAlbumBySlug(slug: string): Promise<PublicAlbum | null>;
  getAlbumById(id: string): Promise<PublicAlbum | null>;
  getTrackById(id: string): Promise<PublicTrack | null>;
  createAlbum(input: AlbumInput): Promise<Album>;
  updateAlbum(id: string, input: Partial<AlbumInput>): Promise<Album | null>;
  deleteAlbum(id: string): Promise<boolean>;
  createTrack(input: TrackInput): Promise<Track>;
  updateTrack(id: string, input: Partial<TrackInput>): Promise<Track | null>;
  deleteTrack(id: string): Promise<boolean>;
  setTrackArchived(id: string, archived: boolean): Promise<Track | null>;
  reorderTracks(albumId: string, trackIds: string[]): Promise<Track[]>;
  reorderAlbums(albumIds: string[]): Promise<Album[]>;
}

function nowIso(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function hydrateTrack(track: Track) {
  return {
    ...track,
    archived: Boolean(track.archived),
    introduction: track.introduction || "",
    imageUrl: imageUrl(track.img),
    audioUrl: audioUrl(track.file),
    durationLabel: durationLabelForFile(track.file),
  };
}

function hydrateAlbum(album: Album, albumTracks: Track[]): PublicAlbum {
  const mapped = albumTracks.map(hydrateTrack);
  return {
    ...album,
    heroUrl: imageUrl(album.heroPortrait),
    thumbUrl: imageUrl(album.thumb || album.heroPortrait),
    artistUrl: imageUrl(album.artistThumb || album.thumb || album.heroPortrait),
    tracks: mapped.filter((track) => !track.archived).sort((a, b) => a.n - b.n),
    archivedTracks: mapped.filter((track) => track.archived).sort((a, b) => a.title.localeCompare(b.title)),
  };
}

function toListItem(album: Album, trackCount: number): AlbumListItem {
  return {
    ...album,
    heroUrl: imageUrl(album.heroPortrait),
    thumbUrl: imageUrl(album.thumb || album.heroPortrait),
    trackCount,
  };
}

type CatalogFile = { albums: Album[]; tracks: Track[] };

export class JsonMusicStore implements MusicStore {
  constructor() {
    ensureDataDirs();
    if (!fs.existsSync(catalogPath())) {
      this.write({
        albums: DEFAULT_CATALOG.albums.map((album) => ({
          ...album,
          createdAt: nowIso(),
          updatedAt: nowIso(),
        })),
        tracks: DEFAULT_CATALOG.tracks.map((track) => ({
          ...track,
          createdAt: nowIso(),
          updatedAt: nowIso(),
        })),
      });
    } else {
      this.backfillEmptyLyrics();
      this.backfillEchoesCover();
      this.backfillEchoesArtistPhoto();
    }
  }

  private backfillEchoesCover(): void {
    const catalog = this.read();
    const album = catalog.albums.find((item) => item.id === ECHOES_ALBUM.id);
    if (!album) return;
    if (album.thumb && album.thumb !== LEGACY_ECHOES_THUMB) return;
    album.thumb = ECHOES_ALBUM.thumb;
    album.updatedAt = nowIso();
    this.write(catalog);
  }

  private backfillEchoesArtistPhoto(): void {
    const catalog = this.read();
    const album = catalog.albums.find((item) => item.id === ECHOES_ALBUM.id);
    if (!album || album.artistThumb) return;
    album.artistThumb = ECHOES_ALBUM.artistThumb;
    album.updatedAt = nowIso();
    this.write(catalog);
  }

  private backfillEmptyLyrics(): void {
    const catalog = this.read();
    let changed = false;
    for (const track of catalog.tracks) {
      const lyrics = seedLyricsForTrack(track.id);
      if (lyrics && !track.lyrics.trim()) {
        track.lyrics = lyrics;
        track.updatedAt = nowIso();
        changed = true;
      }
    }
    if (changed) this.write(catalog);
  }

  private read(): CatalogFile {
    const raw = JSON.parse(fs.readFileSync(catalogPath(), "utf8")) as CatalogFile;
    return {
      albums: (raw.albums || []).map((album) => ({ ...album, hidden: Boolean(album.hidden) })),
      tracks: (raw.tracks || []).map((track) => ({
        ...track,
        archived: Boolean(track.archived),
        introduction: track.introduction || "",
      })),
    };
  }

  private write(catalog: CatalogFile): void {
    ensureDataDirs();
    fs.writeFileSync(catalogPath(), JSON.stringify(catalog, null, 2));
  }

  async listAlbums(): Promise<AlbumListItem[]> {
    const catalog = this.read();
    return catalog.albums
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title))
      .map((album) =>
        toListItem(
          album,
          catalog.tracks.filter((track) => track.albumId === album.id && !track.archived).length,
        ),
      );
  }

  async getAlbumBySlug(slug: string): Promise<PublicAlbum | null> {
    const catalog = this.read();
    const album = catalog.albums.find((item) => item.slug === slug);
    if (!album) return null;
    return hydrateAlbum(
      album,
      catalog.tracks.filter((track) => track.albumId === album.id),
    );
  }

  async getAlbumById(id: string): Promise<PublicAlbum | null> {
    const catalog = this.read();
    const album = catalog.albums.find((item) => item.id === id);
    if (!album) return null;
    return hydrateAlbum(
      album,
      catalog.tracks.filter((track) => track.albumId === album.id),
    );
  }

  async getTrackById(id: string): Promise<PublicTrack | null> {
    const catalog = this.read();
    const track = catalog.tracks.find((item) => item.id === id);
    return track ? hydrateTrack(track) : null;
  }

  async createAlbum(input: AlbumInput): Promise<Album> {
    const catalog = this.read();
    const album: Album = {
      id: input.id || newId("album"),
      slug: input.slug,
      title: input.title,
      tagline: input.tagline || "",
      credits: input.credits || "",
      artists: input.artists || "",
      copyright: input.copyright || "",
      heroPortrait: input.heroPortrait || "",
      thumb: input.thumb || "",
      artistThumb: input.artistThumb || "",
      sortOrder: input.sortOrder ?? catalog.albums.length + 1,
      hidden: Boolean(input.hidden),
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    catalog.albums.push(album);
    this.write(catalog);
    return album;
  }

  async updateAlbum(id: string, input: Partial<AlbumInput>): Promise<Album | null> {
    const catalog = this.read();
    const album = catalog.albums.find((item) => item.id === id);
    if (!album) return null;
    Object.assign(album, input, { updatedAt: nowIso() });
    this.write(catalog);
    return album;
  }

  async deleteAlbum(id: string): Promise<boolean> {
    const catalog = this.read();
    const before = catalog.albums.length;
    catalog.albums = catalog.albums.filter((item) => item.id !== id);
    catalog.tracks = catalog.tracks.filter((item) => item.albumId !== id);
    this.write(catalog);
    return catalog.albums.length < before;
  }

  async createTrack(input: TrackInput): Promise<Track> {
    const catalog = this.read();
    const siblings = catalog.tracks.filter((item) => item.albumId === input.albumId && !item.archived);
    const track: Track = {
      id: input.id || newId("track"),
      albumId: input.albumId,
      n: input.n || siblings.length + 1,
      title: input.title,
      scripture: input.scripture || "",
      file: input.file || "",
      img: input.img || "",
      key: input.key || "",
      lyrics: input.lyrics || "",
      introduction: input.introduction || "",
      instrumental: Boolean(input.instrumental),
      slug: input.slug || "",
      archived: Boolean(input.archived),
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    catalog.tracks.push(track);
    this.write(catalog);
    return track;
  }

  async updateTrack(id: string, input: Partial<TrackInput>): Promise<Track | null> {
    const catalog = this.read();
    const track = catalog.tracks.find((item) => item.id === id);
    if (!track) return null;
    Object.assign(track, input, { updatedAt: nowIso() });
    this.write(catalog);
    return track;
  }

  async deleteTrack(id: string): Promise<boolean> {
    const catalog = this.read();
    const track = catalog.tracks.find((item) => item.id === id);
    if (!track) return false;
    catalog.tracks = catalog.tracks.filter((item) => item.id !== id);
    catalog.tracks
      .filter((item) => item.albumId === track.albumId && !item.archived)
      .sort((a, b) => a.n - b.n)
      .forEach((item, index) => {
        item.n = index + 1;
      });
    this.write(catalog);
    return true;
  }

  async setTrackArchived(id: string, archived: boolean): Promise<Track | null> {
    const catalog = this.read();
    const track = catalog.tracks.find((item) => item.id === id);
    if (!track) return null;
    track.archived = archived;
    track.updatedAt = nowIso();
    const live = catalog.tracks.filter((item) => item.albumId === track.albumId && !item.archived);
    if (archived) {
      live
        .sort((a, b) => a.n - b.n)
        .forEach((item, index) => {
          item.n = index + 1;
        });
    } else {
      const others = live.filter((item) => item.id !== track.id);
      track.n = others.reduce((max, item) => Math.max(max, item.n), 0) + 1;
    }
    this.write(catalog);
    return track;
  }

  async reorderTracks(albumId: string, trackIds: string[]): Promise<Track[]> {
    const catalog = this.read();
    const albumTracks = catalog.tracks.filter((item) => item.albumId === albumId);
    trackIds.forEach((id, index) => {
      const track = albumTracks.find((item) => item.id === id);
      if (track) track.n = index + 1;
    });
    this.write(catalog);
    return catalog.tracks.filter((item) => item.albumId === albumId).sort((a, b) => a.n - b.n);
  }

  async reorderAlbums(albumIds: string[]): Promise<Album[]> {
    const catalog = this.read();
    albumIds.forEach((id, index) => {
      const album = catalog.albums.find((item) => item.id === id);
      if (album) album.sortOrder = index + 1;
    });
    this.write(catalog);
    return catalog.albums.slice().sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title));
  }
}

function rowAlbum(row: typeof albums.$inferSelect): Album {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    tagline: row.tagline,
    credits: row.credits,
    artists: row.artists,
    copyright: row.copyright,
    heroPortrait: row.heroPortrait,
    thumb: row.thumb,
    artistThumb: row.artistThumb,
    sortOrder: row.sortOrder,
    hidden: Boolean(row.hidden),
    createdAt: row.createdAt?.toISOString(),
    updatedAt: row.updatedAt?.toISOString(),
  };
}

function rowTrack(row: typeof tracks.$inferSelect): Track {
  return {
    id: row.id,
    albumId: row.albumId,
    n: row.n,
    title: row.title,
    scripture: row.scripture,
    file: row.file,
    img: row.img,
    key: row.key,
    lyrics: row.lyrics,
    introduction: row.introduction || "",
    instrumental: row.instrumental,
    slug: row.slug,
    archived: Boolean(row.archived),
    createdAt: row.createdAt?.toISOString(),
    updatedAt: row.updatedAt?.toISOString(),
  };
}

export class PostgresMusicStore implements MusicStore {
  private db;

  constructor(connectionString: string) {
    const pool = new pg.Pool({ connectionString });
    this.db = drizzle(pool);
  }

  async ensureSchema(): Promise<void> {
    await this.db.execute(sql`
      CREATE TABLE IF NOT EXISTS albums (
        id TEXT PRIMARY KEY,
        slug TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        tagline TEXT NOT NULL DEFAULT '',
        credits TEXT NOT NULL DEFAULT '',
        artists TEXT NOT NULL DEFAULT '',
        copyright TEXT NOT NULL DEFAULT '',
        hero_portrait TEXT NOT NULL DEFAULT '',
        thumb TEXT NOT NULL DEFAULT '',
        artist_thumb TEXT NOT NULL DEFAULT '',
        sort_order INTEGER NOT NULL DEFAULT 0,
        hidden BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      )
    `);
    await this.db.execute(sql`
      CREATE TABLE IF NOT EXISTS tracks (
        id TEXT PRIMARY KEY,
        album_id TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
        n INTEGER NOT NULL,
        title TEXT NOT NULL,
        scripture TEXT NOT NULL DEFAULT '',
        file TEXT NOT NULL DEFAULT '',
        img TEXT NOT NULL DEFAULT '',
        key TEXT NOT NULL DEFAULT '',
        lyrics TEXT NOT NULL DEFAULT '',
        introduction TEXT NOT NULL DEFAULT '',
        instrumental BOOLEAN NOT NULL DEFAULT false,
        slug TEXT NOT NULL DEFAULT '',
        archived BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      )
    `);
    await this.db.execute(sql`ALTER TABLE albums ADD COLUMN IF NOT EXISTS artist_thumb TEXT NOT NULL DEFAULT ''`);
    await this.db.execute(sql`ALTER TABLE albums ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT false`);
    await this.db.execute(sql`ALTER TABLE tracks ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT false`);
    await this.db.execute(sql`ALTER TABLE tracks ADD COLUMN IF NOT EXISTS introduction TEXT NOT NULL DEFAULT ''`);
    const existing = await this.db.select({ id: albums.id }).from(albums).limit(1);
    if (existing.length === 0) {
      for (const album of DEFAULT_CATALOG.albums) {
        await this.createAlbum(album);
      }
      for (const track of DEFAULT_CATALOG.tracks) {
        await this.createTrack(track);
      }
      return;
    }
    const rows = await this.db.select({ id: tracks.id, lyrics: tracks.lyrics }).from(tracks);
    for (const row of rows) {
      const lyrics = seedLyricsForTrack(row.id);
      if (lyrics && !String(row.lyrics || "").trim()) {
        await this.db.update(tracks).set({ lyrics, updatedAt: new Date() }).where(eq(tracks.id, row.id));
      }
    }
    const [echoes] = await this.db
      .select({ id: albums.id, thumb: albums.thumb })
      .from(albums)
      .where(eq(albums.id, ECHOES_ALBUM.id))
      .limit(1);
    if (echoes && (!echoes.thumb || echoes.thumb === LEGACY_ECHOES_THUMB)) {
      await this.db
        .update(albums)
        .set({ thumb: ECHOES_ALBUM.thumb, updatedAt: new Date() })
        .where(eq(albums.id, ECHOES_ALBUM.id));
    }
    const [echoesPhoto] = await this.db
      .select({ id: albums.id, artistThumb: albums.artistThumb })
      .from(albums)
      .where(eq(albums.id, ECHOES_ALBUM.id))
      .limit(1);
    if (echoesPhoto && !echoesPhoto.artistThumb) {
      await this.db
        .update(albums)
        .set({ artistThumb: ECHOES_ALBUM.artistThumb, updatedAt: new Date() })
        .where(eq(albums.id, ECHOES_ALBUM.id));
    }
  }

  async listAlbums(): Promise<AlbumListItem[]> {
    const rows = await this.db.select().from(albums).orderBy(asc(albums.sortOrder), asc(albums.title));
    const trackRows = await this.db.select().from(tracks);
    return rows.map((row) =>
      toListItem(
        rowAlbum(row),
        trackRows.filter((track) => track.albumId === row.id && !track.archived).length,
      ),
    );
  }

  async getAlbumBySlug(slug: string): Promise<PublicAlbum | null> {
    const [row] = await this.db.select().from(albums).where(eq(albums.slug, slug)).limit(1);
    if (!row) return null;
    const albumTracks = await this.db
      .select()
      .from(tracks)
      .where(eq(tracks.albumId, row.id))
      .orderBy(asc(tracks.n));
    return hydrateAlbum(
      rowAlbum(row),
      albumTracks.map(rowTrack),
    );
  }

  async getAlbumById(id: string): Promise<PublicAlbum | null> {
    const [row] = await this.db.select().from(albums).where(eq(albums.id, id)).limit(1);
    if (!row) return null;
    const albumTracks = await this.db
      .select()
      .from(tracks)
      .where(eq(tracks.albumId, row.id))
      .orderBy(asc(tracks.n));
    return hydrateAlbum(
      rowAlbum(row),
      albumTracks.map(rowTrack),
    );
  }

  async getTrackById(id: string): Promise<PublicTrack | null> {
    const [row] = await this.db.select().from(tracks).where(eq(tracks.id, id)).limit(1);
    return row ? hydrateTrack(rowTrack(row)) : null;
  }

  async createAlbum(input: AlbumInput): Promise<Album> {
    const id = input.id || newId("album");
    const [row] = await this.db
      .insert(albums)
      .values({
        id,
        slug: input.slug,
        title: input.title,
        tagline: input.tagline || "",
        credits: input.credits || "",
        artists: input.artists || "",
        copyright: input.copyright || "",
        heroPortrait: input.heroPortrait || "",
        thumb: input.thumb || "",
        artistThumb: input.artistThumb || "",
        sortOrder: input.sortOrder ?? 0,
        hidden: Boolean(input.hidden),
      })
      .returning();
    return rowAlbum(row);
  }

  async updateAlbum(id: string, input: Partial<AlbumInput>): Promise<Album | null> {
    const patch: Partial<typeof albums.$inferInsert> = { updatedAt: new Date() };
    if (input.slug !== undefined) patch.slug = input.slug;
    if (input.title !== undefined) patch.title = input.title;
    if (input.tagline !== undefined) patch.tagline = input.tagline;
    if (input.credits !== undefined) patch.credits = input.credits;
    if (input.artists !== undefined) patch.artists = input.artists;
    if (input.copyright !== undefined) patch.copyright = input.copyright;
    if (input.heroPortrait !== undefined) patch.heroPortrait = input.heroPortrait;
    if (input.thumb !== undefined) patch.thumb = input.thumb;
    if (input.artistThumb !== undefined) patch.artistThumb = input.artistThumb;
    if (input.sortOrder !== undefined) patch.sortOrder = input.sortOrder;
    if (input.hidden !== undefined) patch.hidden = input.hidden;
    const [row] = await this.db.update(albums).set(patch).where(eq(albums.id, id)).returning();
    return row ? rowAlbum(row) : null;
  }

  async deleteAlbum(id: string): Promise<boolean> {
    const deleted = await this.db.delete(albums).where(eq(albums.id, id)).returning({ id: albums.id });
    return deleted.length > 0;
  }

  async createTrack(input: TrackInput): Promise<Track> {
    const id = input.id || newId("track");
    const [row] = await this.db
      .insert(tracks)
      .values({
        id,
        albumId: input.albumId,
        n: input.n ?? 1,
        title: input.title,
        scripture: input.scripture || "",
        file: input.file || "",
        img: input.img || "",
        key: input.key || "",
        lyrics: input.lyrics || "",
        introduction: input.introduction || "",
        instrumental: Boolean(input.instrumental),
        slug: input.slug || "",
        archived: Boolean(input.archived),
      })
      .returning();
    return rowTrack(row);
  }

  async updateTrack(id: string, input: Partial<TrackInput>): Promise<Track | null> {
    const patch: Partial<typeof tracks.$inferInsert> = { updatedAt: new Date() };
    if (input.n !== undefined) patch.n = input.n;
    if (input.title !== undefined) patch.title = input.title;
    if (input.scripture !== undefined) patch.scripture = input.scripture;
    if (input.file !== undefined) patch.file = input.file;
    if (input.img !== undefined) patch.img = input.img;
    if (input.key !== undefined) patch.key = input.key;
    if (input.lyrics !== undefined) patch.lyrics = input.lyrics;
    if (input.introduction !== undefined) patch.introduction = input.introduction;
    if (input.instrumental !== undefined) patch.instrumental = input.instrumental;
    if (input.slug !== undefined) patch.slug = input.slug;
    if (input.archived !== undefined) patch.archived = input.archived;
    if (input.albumId !== undefined) patch.albumId = input.albumId;
    const [row] = await this.db.update(tracks).set(patch).where(eq(tracks.id, id)).returning();
    return row ? rowTrack(row) : null;
  }

  async deleteTrack(id: string): Promise<boolean> {
    const [removed] = await this.db.delete(tracks).where(eq(tracks.id, id)).returning();
    if (!removed) return false;
    const remaining = await this.db
      .select()
      .from(tracks)
      .where(and(eq(tracks.albumId, removed.albumId), eq(tracks.archived, false)))
      .orderBy(asc(tracks.n));
    for (const [index, track] of remaining.entries()) {
      await this.db.update(tracks).set({ n: index + 1 }).where(eq(tracks.id, track.id));
    }
    return true;
  }

  async setTrackArchived(id: string, archived: boolean): Promise<Track | null> {
    const [current] = await this.db.select().from(tracks).where(eq(tracks.id, id)).limit(1);
    if (!current) return null;
    const [row] = await this.db
      .update(tracks)
      .set({ archived, updatedAt: new Date() })
      .where(eq(tracks.id, id))
      .returning();
    if (!row) return null;
    const live = await this.db
      .select()
      .from(tracks)
      .where(and(eq(tracks.albumId, row.albumId), eq(tracks.archived, false)))
      .orderBy(asc(tracks.n));
    if (archived) {
      for (const [index, track] of live.entries()) {
        await this.db.update(tracks).set({ n: index + 1, updatedAt: new Date() }).where(eq(tracks.id, track.id));
      }
    } else {
      const others = live.filter((track) => track.id !== row.id);
      const n = others.reduce((max, track) => Math.max(max, track.n), 0) + 1;
      const [restored] = await this.db
        .update(tracks)
        .set({ n, updatedAt: new Date() })
        .where(eq(tracks.id, id))
        .returning();
      return restored ? rowTrack(restored) : rowTrack(row);
    }
    const [updated] = await this.db.select().from(tracks).where(eq(tracks.id, id)).limit(1);
    return updated ? rowTrack(updated) : rowTrack(row);
  }

  async reorderTracks(albumId: string, trackIds: string[]): Promise<Track[]> {
    for (const [index, id] of trackIds.entries()) {
      await this.db
        .update(tracks)
        .set({ n: index + 1, updatedAt: new Date() })
        .where(and(eq(tracks.id, id), eq(tracks.albumId, albumId)));
    }
    const rows = await this.db
      .select()
      .from(tracks)
      .where(eq(tracks.albumId, albumId))
      .orderBy(asc(tracks.n));
    return rows.map(rowTrack);
  }

  async reorderAlbums(albumIds: string[]): Promise<Album[]> {
    for (const [index, id] of albumIds.entries()) {
      await this.db.update(albums).set({ sortOrder: index + 1, updatedAt: new Date() }).where(eq(albums.id, id));
    }
    const rows = await this.db.select().from(albums).orderBy(asc(albums.sortOrder), asc(albums.title));
    return rows.map(rowAlbum);
  }
}

export async function remapImageFilenames(renames: Map<string, string>): Promise<number> {
  if (!renames.size) return 0;
  const store = await getStore();
  let changed = 0;
  const albums = await store.listAlbums();
  for (const item of albums) {
    const album = await store.getAlbumById(item.id);
    if (!album) continue;
    const patch: Partial<AlbumInput> = {};
    const nextHero = renames.get(album.heroPortrait);
    const nextThumb = renames.get(album.thumb);
    const nextArtist = renames.get(album.artistThumb);
    if (nextHero) patch.heroPortrait = nextHero;
    if (nextThumb) patch.thumb = nextThumb;
    if (nextArtist) patch.artistThumb = nextArtist;
    if (Object.keys(patch).length) {
      await store.updateAlbum(album.id, patch);
      changed += 1;
    }
    for (const track of [...album.tracks, ...album.archivedTracks]) {
      const nextImg = track.img ? renames.get(track.img) : undefined;
      if (!nextImg) continue;
      await store.updateTrack(track.id, { img: nextImg });
      changed += 1;
    }
  }
  if (changed) console.log(`[media] remapped ${changed} image reference${changed === 1 ? "" : "s"}`);
  return changed;
}

let storePromise: Promise<MusicStore> | null = null;

export async function getStore(): Promise<MusicStore> {
  if (!storePromise) {
    storePromise = (async () => {
      const url = process.env.DATABASE_URL;
      if (url && /^postgres/i.test(url)) {
        const store = new PostgresMusicStore(url);
        await store.ensureSchema();
        return store;
      }
      return new JsonMusicStore();
    })();
  }
  return storePromise;
}

export function resetStoreForTests(): void {
  storePromise = null;
}
