export type Album = {
  id: string;
  slug: string;
  title: string;
  tagline: string;
  credits: string;
  artists: string;
  copyright: string;
  heroPortrait: string;
  thumb: string;
  artistThumb: string;
  color: string;
  sortOrder: number;
  hidden: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type Track = {
  id: string;
  albumId: string;
  n: number;
  title: string;
  scripture: string;
  file: string;
  img: string;
  key: string;
  lyrics: string;
  introduction: string;
  instrumental: boolean;
  slug: string;
  archived: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type PublicTrack = Track & {
  imageUrl: string;
  audioUrl: string;
  durationLabel?: string;
};

export type PublicAlbum = Album & {
  heroUrl: string;
  thumbUrl: string;
  artistUrl: string;
  tracks: PublicTrack[];
  archivedTracks: PublicTrack[];
};

export type AlbumListItem = Album & {
  heroUrl: string;
  thumbUrl: string;
  trackCount: number;
};

export type PlayerSetup = {
  appName: string;
  theme: string;
  credits: string;
  copyright: string;
  collectionCover: string;
  collectionCoverUrl: string;
  logo: string;
  logoUrl: string;
  footerImage: string;
  footerImageUrl: string;
  collectionColor: string;
};

export type Curator = {
  firstName: string;
  lastName: string;
  email: string;
};

export type CuratorRecord = Curator & {
  passwordHash: string;
};
