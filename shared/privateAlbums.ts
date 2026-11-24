/** Albums that must stay off the public site, even if a save left them visible. */
export const ADMIN_ONLY_ALBUM_SLUGS = ["heart-songs"] as const;

/** Off the home page, but the album address still opens for anyone who has it. */
const LINK_ONLY_ALBUM_NAMES = ["josh"] as const;

export function isAdminOnlyAlbumSlug(slug: string): boolean {
  return (ADMIN_ONLY_ALBUM_SLUGS as readonly string[]).includes(slug);
}

export function isLinkOnlyAlbum(album: { slug?: string; title?: string }): boolean {
  const names = LINK_ONLY_ALBUM_NAMES as readonly string[];
  const title = (album.title || "").trim().toLowerCase();
  const slug = (album.slug || "").trim().toLowerCase();
  return names.includes(title) || names.includes(slug);
}

/** The server already omits hidden albums for visitors. Keep the ones it sent to an admin. */
export function visibleHomeAlbums<T extends { slug: string; hidden?: boolean }>(albums: T[]): T[] {
  return albums.filter((album) => !isAdminOnlyAlbumSlug(album.slug) || Boolean(album.hidden));
}
