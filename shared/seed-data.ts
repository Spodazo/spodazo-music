import type { Album, Track } from "./types";

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const ECHOES_ALBUM_ID = "album-echoes";

export const ECHOES_ALBUM: Album = {
  id: ECHOES_ALBUM_ID,
  slug: "echoes",
  title: "Echoes of Storms",
  tagline: "Crisis of faith answered through the Word of God",
  credits: "Music, lyrics and graphics by Spodazo. | Vocals by Brody Vale & Eden Blue",
  artists: "Brody Vale with Eden Blue",
  copyright:
    "Produced by Spodazo LLC, trading as Spodazo Music Ltd © 2026. All Rights Reserved. This material may not be copied — in whole or in part — or distributed without previous permission from the Producers.",
  heroPortrait: "Echoes of Storms Web Portrait.webp",
  thumb: "Brody and Eden.webp",
  sortOrder: 1,
};

const TRACK_META: Array<{
  n: number;
  title: string;
  scripture: string;
  file: string;
  img: string;
  key: string;
  instrumental?: boolean;
  lyrics?: string;
}> = [
  {
    n: 1,
    title: "Echoes of the Storm",
    scripture: "Job 5",
    file: "Echoes of the Storm (Job 5).mp3",
    img: "Echoes of the Storm.webp",
    key: "t1",
  },
  {
    n: 2,
    title: "Though He Slay Me",
    scripture: "Job 13",
    file: "Though He Slay Me (Job 13).mp3",
    img: "Though He Slay Me.webp",
    key: "t3",
  },
  {
    n: 3,
    title: "By Waters Deep and Still",
    scripture: "Jeremiah 17",
    file: "By Waters Deep and Still (Jeremiah 17).mp3",
    img: "By Waters Deep and Still.webp",
    key: "t4",
  },
  {
    n: 4,
    title: "Under His Wings",
    scripture: "Psalm 91",
    file: "Under His Wings (Psalm 91) - VER 1.mp3",
    img: "Under His Wings.webp",
    key: "t5",
  },
  {
    n: 5,
    title: "Horsemens Praise",
    scripture: "Psalm 150",
    file: "Horsemens Praise (Psalm 150).mp3",
    img: "Horsemens Praise.webp",
    key: "t12",
    instrumental: true,
    lyrics: `Praise ye the LORD. Praise God in his sanctuary:
Praise him in the firmament of his power.
Praise him for his mighty acts:
Praise him according to his excellent greatness.
Praise him with the sound of the trumpet:
Praise him with the psaltery and harp.
Praise him with the timbrel and dance:
Praise him with stringed instruments and organs.
Praise him upon the loud cymbals:
Praise him upon the high sounding cymbals.
Let every thing that hath breath praise the LORD.
Praise ye the LORD.`,
  },
  {
    n: 6,
    title: "A Promise Broken",
    scripture: "Job 10",
    file: "A Promise Broken (Job 10).mp3",
    img: "A Promise Broken.webp",
    key: "t11",
  },
  {
    n: 7,
    title: "Clean Once Again",
    scripture: "Psalm 51",
    file: "Clean Once Again (Psalm 51).mp3",
    img: "Clean Once Again.webp",
    key: "t10",
  },
  {
    n: 8,
    title: "Restored",
    scripture: "Psalm 23",
    file: "Restored (Psalm 23).mp3",
    img: "Restored.webp",
    key: "t7",
  },
  {
    n: 9,
    title: "Our Light",
    scripture: "Genesis 1 | John 1",
    file: "Our_Light__Genesis_1___John_1_.mp3",
    img: "Our Light.webp",
    key: "t13",
  },
  {
    n: 10,
    title: "Your Hands Will Break My Fall",
    scripture: "Psalm 139",
    file: "Your Hands Will Break My Fall (Psalm 139).mp3",
    img: "Your Hands Will Break My Fall.webp",
    key: "t8",
  },
  {
    n: 11,
    title: "The Heavens Declare",
    scripture: "Psalm 19",
    file: "The Heavens Declare (Psalm 19).mp3",
    img: "The Heavens Declare.webp",
    key: "t9",
  },
  {
    n: 12,
    title: "Be Thou My Vision",
    scripture: "",
    file: "Be_Thou_My_Vision.mp3",
    img: "Be Thou My Vision.webp",
    key: "t14",
    lyrics: `[Verse 1]
Be Thou my vision, O Lord of my heart,
Nought else but Thee, Lord, save that Thou art;
Thou my first thought through morning and night,
Waking or resting, Thy love is my light.

[Verse 2]
Be Thou my wisdom, be Thou my true word,
I ever with Thee and Thou with me, Lord;
Thou my great Father, and I Thy true son,
Thou in me dwelling, and I with Thee one.

[Verse 3]
Be Thou my breastplate, my sword for the fight,
Be Thou my dignity, Thou my delight,
Thou my soul's shelter, and Thou my high tower,
Raise Thou me heavenward, O Power of my power.

[Verse 4]
Riches I heed not, nor man's empty praise,
Thou mine inheritance, now and always;
Thou and Thou only, the first in my heart,
High King of heaven, my treasure Thou art.

[Verse 5]
High King of heaven, when battle is done,
Grant heaven's joy to me, bright heaven's Sun;
Heart of my own heart, whatever befall,
Still be my vision, O Ruler of all.`,
  },
];

export const ECHOES_TRACKS: Track[] = TRACK_META.map((track) => ({
  id: `track-echoes-${track.n}`,
  albumId: ECHOES_ALBUM_ID,
  n: track.n,
  title: track.title,
  scripture: track.scripture,
  file: track.file,
  img: track.img,
  key: track.key,
  lyrics: track.lyrics || "",
  instrumental: Boolean(track.instrumental),
  slug: slugify(track.title),
}));

export const DEFAULT_CATALOG = {
  albums: [ECHOES_ALBUM],
  tracks: ECHOES_TRACKS,
};
