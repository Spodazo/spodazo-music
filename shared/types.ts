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
  sortOrder: number;
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
  instrumental: boolean;
  slug: string;
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
};

export type AlbumListItem = Album & {
  heroUrl: string;
  thumbUrl: string;
  trackCount: number;
};
