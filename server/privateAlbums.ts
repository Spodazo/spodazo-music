import { ADMIN_ONLY_ALBUM_SLUGS } from "../shared/privateAlbums";
import { getStore } from "./storage";

/** Hidden albums are admin-only. These slugs are forced hidden on startup. */
export async function enforceAdminOnlyAlbums(): Promise<void> {
  const store = await getStore();
  const albums = await store.listAlbums();
  for (const slug of ADMIN_ONLY_ALBUM_SLUGS) {
    const album = albums.find((item) => item.slug === slug);
    if (!album || album.hidden) continue;
    await store.updateAlbum(album.id, { hidden: true });
    console.log(`[private] ${slug} is visible only while signed in as admin`);
  }
}
