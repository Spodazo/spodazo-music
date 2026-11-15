/** Albums that must stay off the public site, even if a save left them visible. */
export const ADMIN_ONLY_ALBUM_SLUGS = ["heart-songs"] as const;

export function isAdminOnlyAlbumSlug(slug: string): boolean {
  return (ADMIN_ONLY_ALBUM_SLUGS as readonly string[]).includes(slug);
}

/** The server already omits hidden albums for visitors. Keep the ones it sent to an admin. */
export function visibleHomeAlbums<T extends { slug: string; hidden?: boolean }>(albums: T[]): T[] {
  return albums.filter((album) => !isAdminOnlyAlbumSlug(album.slug) || Boolean(album.hidden));
}
