import type { Album, Track } from "./types";

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function titleFromAudioFile(filename: string): { title: string; scripture: string } {
  const slash = Math.max(filename.lastIndexOf("/"), filename.lastIndexOf("\\"));
  const base = filename.slice(slash + 1).replace(/\.[^.]+$/, "");
  const cleaned = base.replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
  const match = cleaned.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if (match) return { title: match[1].trim(), scripture: match[2].trim() };
  return { title: cleaned || "Untitled", scripture: "" };
}

export function uniqueSlug(base: string, used: Set<string>): string {
  const root = slugify(base) || "track";
  let candidate = root;
  let n = 2;
  while (used.has(candidate)) {
    candidate = `${root}-${n++}`;
  }
  used.add(candidate);
  return candidate;
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
  thumb: "Echoes of Storms.webp",
  artistThumb: "Brody and Eden.webp",
  sortOrder: 1,
  hidden: false,
};

export const LEGACY_ECHOES_THUMB = "Brody and Eden.webp";

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
    lyrics: `[Verse 1]
There's a stillness on the water tonight,
Two shadows stand where the last lights will fall;
I feel their soft eyes piercing from the other side,
I hear them asking if I still care at all.
The ropes that gently led, lay worthless on the ground
Will You come back or leave us here alone?
A storm came through and moved our worlds apart.
"Can't cross this river any more" is all I could moan.

[Chorus]
Where are You in the echoes of the storm?
The black cloud hides Your face and I am cold;
You rescue those You love — I've read those words —
But faith and hope feel far away and old.
Though sadness overwhelms, His love always stays the same,
Though every echo shakes me to the core;
The storm has taken more than I can bear —
I cannot let this storm break me anymore.

[Verse 2]
Yes, I've been through many storms before,
Some left me stronger, some just left me scarred;
Some took my pride, and some took people dear,
Some left me guilty, some just left me hard.
But this one seemed to cut through heart and soul,
Oh how I miss their silent trust, their warmth that never lied;
But now I stand here useless at the shore,
Watching them scared to face the other side.

[Chorus]
Where are You in the echoes of the storm?
The black cloud hides Your face and I am cold;
You rescue those You love — I've read those words —
But faith and hope feel far away and old.
Though sadness overwhelms, His love always stays the same,
Though every echo shakes me to the core;
The storm has taken more than I can bear —
I cannot let this storm break me anymore.

[Bridge]
So I brought it all before You in my brokenness and rage,
The unanswered why, the loss, the bitter cost;
And somewhere through the shouting and the tears,
I felt the black cloud shift — just slightly — at its frost.
Some rays broke through, not wide, not warm enough,
But something ancient moved behind the grey;
You bind up the broken and Your hands have always healed —
I've felt it before — maybe again someday.

[Chorus]
Where are You in the echoes of the storm?
The black cloud hides Your face and I am cold;
You rescue those You love — I've read those words —
But faith and hope feel far away and old.
Though sadness overwhelms, His love always stays the same,
Though every echo shakes me to the core;
The storm has taken more than I can bear —
I cannot let this storm break me anymore.

"Will this storm pass —
The way all storms have passed before?
Can He restore what's gone —
The way He's done before?
Does He still care —
I know He does —
But will He restore?
Will He restore me
To what I was?"`,
  },
  {
    n: 2,
    title: "Though He Slay Me",
    scripture: "Job 13",
    file: "Though He Slay Me (Job 13).mp3",
    img: "Though He Slay Me.webp",
    key: "t3",
    lyrics: `[Verse 1]
I am weary with my moaning,
Every night I flood my bed with tears;
My bones are troubled, Lord, I'm languishing —
Remember me through all these bitter years.

[Chorus]
Though He slay me, yet will I trust Him,
Though the darkness hides His face from me;
The Lord is my portion, says my soul,
And therefore I will hope, I will hope in Thee.

[Verse 2]
Remember all my wanderings,
The wormwood and the gall I've known;
My soul is bowed down within me, Lord —
But this I call to mind, I am not alone.

[Chorus]
Though He slay me, yet will I trust Him,
Though the darkness hides His face from me;
The Lord is my portion, says my soul,
And therefore I will hope, I will hope in Thee.

[Bridge — Spoken Word]
"The Lord is good to those who wait for Him,
To the soul who seeks Him.
It is good that one should wait quietly
For the salvation of the Lord.
For He satisfies the longing soul —
And fills the hungry soul with goodness."

[Verse 3]
Though the fig tree may not blossom,
And no fruit grows on the vine;
Though the flock be cut off from the fold —
Yet I will joy in this God of mine!

[Chorus]
Though He slay me, yet will I trust Him,
Though the darkness hides His face from me;
The Lord is my portion, says my soul,
And therefore I will hope, I will hope in Thee.

—

The steadfast love of the Lord never ceases,
His mercies never come to an end;
They are new every morning — great is His faithfulness —
Great is Your faithfulness — You called me Friend!

The steadfast love of the Lord never ceases,
His mercies never come to an end;
They are new every morning — great is His faithfulness —
Great is Your faithfulness — You called me Friend!

The steadfast love of the Lord never ceases,
His mercies never come to an end;
They are new every morning — great is His faithfulness —
Great is Your faithfulness — You called me Friend!`,
  },
  {
    n: 3,
    title: "By Waters Deep and Still",
    scripture: "Jeremiah 17",
    file: "By Waters Deep and Still (Jeremiah 17).mp3",
    img: "By Waters Deep and Still.webp",
    key: "t4",
    lyrics: `[Verse 1]
Blessed the man who trusts the Lord,
Whose hope in Him is stayed;
Like a tree beside the stream,
Whose roots will not be swayed.

[Chorus]
He does not fear when heat shall come,
His leaves remain pure green;
No drought can dry what God sustains,
His fruit will still be seen.

[Verse 2]
But oh, the heart is dark and deep,
Deceitful, desperately ill;
Who can know its hidden ways,
Or bend its crooked will?

[Chorus]
He does not fear when heat shall come,
His leaves remain pure green;
No drought can dry what God sustains,
His fruit will still be seen.

[Bridge — Spoken Word]
"Blessed is the man who trusts in the Lord,
Whose trust is the Lord.
He is like a tree planted by water,
That sends out its roots by the stream,
And does not fear when heat comes,
For its leaves remain green,
And is not anxious in the year of drought,
For it does not cease to bear fruit."

[Chorus]
He does not fear when heat shall come,
His leaves remain pure green;
No drought can dry what God sustains,
His fruit will still be seen.`,
  },
  {
    n: 4,
    title: "Under His Wings",
    scripture: "Psalm 91",
    file: "Under His Wings (Psalm 91) - VER 1.mp3",
    img: "Under His Wings.webp",
    key: "t5",
    lyrics: `[Verse 1]
He who dwells in the shelter high,
Beneath the Almighty's shade;
Will say to God, "My refuge, Lord,
My fortress, unafraid."

[Chorus]
Under His wings I find my refuge,
His faithfulness my shield;
Shadow of the Most High covers me,
My life to Him I yield.

[Verse 2]
No terror of the night I'll fear,
No arrow flies my way;
No pestilence that walks in dark,
No plague that wastes the day.

[Verse 3]
He commands His angels over me,
To guard me in all my ways;
They bear me up in their own hands,
Lest I strike a stone and fall.

[Bridge — Spoken Word]
"Because he holds fast to me in love,
I will deliver him and answer when he calls;
I will be with him in his trouble,
Rescue him and honor him with long life
And show him my salvation."`,
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
    lyrics: `[Verse 1]
My heart could not believe such craziness
As we stood on that dreadful river's edge;
For I had whispered in their ears as I let them go —
I'll find a way — I took a vow — I made a pledge.

[Chorus]
I promised — and we had hope,
I promised — and love would shine;
I promised — now trust is shattered,
I promised — but I broke their hearts — and mine.

[Verse 2]
Their saddened eyes saw my heart's intent,
I'll work and scheme — it won't take long;
For I had whispered in their ears as I let them go —
I'll find a way, I'll bring you home, where you belong.

[Chorus]
I promised — and we had hope,
I promised — and love would shine;
I promised — now trust is shattered,
I promised — but I broke their hearts — and mine.

[Verse 3]
But today I heard that river can't be crossed no more,
No money or force would do — I had done them wrong;
I had whispered in their ears as I let them go —
Now I can't find a way, can't bring them home where they belong.

[Chorus]
I promised — and we had hope,
I promised — and love would shine;
I promised — now trust is shattered,
I promised — but I broke their hearts — and mine.

[Acoustic Guitar Ensemble Break]

[Verse 4]
My heart just can't believe such craziness
As I turn again to gaze across that river;
Those majestic shapes, those loving eyes — now faded —
Only a promise broken — and hands that shiver.

[Chorus]
I promised — and we had hope,
I promised — and love would shine;
I promised — now trust is shattered,
I promised — but I broke their hearts — and mine.`,
  },
  {
    n: 7,
    title: "Clean Once Again",
    scripture: "Psalm 51",
    file: "Clean Once Again (Psalm 51).mp3",
    img: "Clean Once Again.webp",
    key: "t10",
    lyrics: `[Verse 1]
Have mercy on me, O my God,
According to Your love;
In all Your tender, boundless mercy,
Blot out my transgressions.

[Verse 2]
O wash me through from all my guilt,
And cleanse me from my sin;
For I know the wrongs that I have done,
They are ever before me.

[Chorus]
Create in me a clean heart, O God,
Renew a right spirit within;
Wash me, and I'll be whiter than snow —
Make me clean, Lord, once again.

[Verse 3]
Against You only have I sinned,
And done this evil thing;
Yet You delight in truth within,
And secret wisdom bring.

[Verse 4]
O purge me with the hyssop branch,
And I'll be white as snow;
Let me hear Your joy and gladness, Lord,
Let the bones You broke rejoice.

[Chorus]
Create in me a clean heart, O God,
Renew a right spirit within;
Wash me, and I'll be whiter than snow —
Make me clean, Lord, once again.

[Bridge]
Hide Your face from all my sin,
Blot out my guilt and shame;
Create in me a heart that's clean,
A spirit right again.

[Chorus]
Create in me a clean heart, O God,
Renew a right spirit within;
Wash me, and I'll be whiter than snow —
Make me clean, Lord, once again.`,
  },
  {
    n: 8,
    title: "Restored",
    scripture: "Psalm 23",
    file: "Restored (Psalm 23).mp3",
    img: "Restored.webp",
    key: "t7",
    lyrics: `[Verse 1]
The Lord is my shepherd; I rest
Beside the waters still;
He makes me lie in pastures green,
He restores my soul with His will.

[Chorus]
The Lord, the Lord is my shepherd,
I shall not want each day;
He leads me in paths of righteousness,
For His great name's sake always.

[Verse 2]
Through valleys deep where shadows fall,
I walk and have no fear;
Your rod and staff, they comfort me,
For You are always near.

[Chorus]
The Lord, the Lord is my shepherd,
I shall not want each day;
He leads me in paths of righteousness,
For His great name's sake always.

[Verse 3]
You spread a table in my sight,
While foes stand all around;
You anoint my head with oil of joy,
My cup flows to the ground.

[Chorus]
The Lord, the Lord is my shepherd,
I shall not want each day;
He leads me in paths of righteousness,
For His great name's sake always.

[Bridge]
Surely goodness and mercy shall follow,
Through every day I live;
And in Your house forever more,
My dwelling You will give.

[Chorus]
The Lord, the Lord is my shepherd,
I shall not want each day;
He leads me in paths of righteousness,
For His great name's sake always.`,
  },
  {
    n: 9,
    title: "Our Light",
    scripture: "Genesis 1 | John 1",
    file: "Our_Light__Genesis_1___John_1_.mp3",
    img: "Our Light.webp",
    key: "t13",
    lyrics: `[Verse 1]
Darkness lay upon the deep
Formless, empty, still, and bare
Till the Spirit, hovering, moved
And the Word breathed through the air

[Chorus]
He spoke the light, and light became
He called the day, He named the night
Before the sun, before the stars
The Word Himself had always been the Light

[Verse 2]
Sky and sea and shore took form
Seed and stem and fruit were sown
Every star was hung in place
Every wing and wave His own

[Chorus]
He spoke the light, and light became
He called the day, He named the night
Before the sun, before the stars
The Word Himself had always been the Light

[Bridge]
Then He knelt to shape the dust
Breathed His likeness into man
Not a distant, watching God
But the Maker, hand to hand

[Chorus]
He spoke the light, and light became
He called the day, He named the night
And the Word who made the morning stars
Became flesh, and became our Light

[Chorus]
He spoke the light, and light became
He called the day, He named the night
And the Word who made the morning stars
Became flesh, and became our Light`,
  },
  {
    n: 10,
    title: "Your Hands Will Break My Fall",
    scripture: "Psalm 139",
    file: "Your Hands Will Break My Fall (Psalm 139).mp3",
    img: "Your Hands Will Break My Fall.webp",
    key: "t8",
    lyrics: `[Verse 1]
O Lord, You search me and You know,
My rising and my rest;
You know each thought before it forms —
Too wonderful, too blest.

[Chorus]
There's nowhere I could ever flee,
Your presence fills it all;
From heaven's height to Sheol's deep,
Your hand will break my fall.

[Verse 2]
I take the wings of morning light,
Or sink beneath the wave;
I call the darkness down to hide,
Still light is what You gave.

[Verse 3]
Fearfully and wonderfully
Made, I will sing Your praise;
You wove me in my mother's womb
And knew my unformed days.

[Bridge — Spoken Word]
"My flesh and my heart may fail —
But God is the strength of my heart,
And my portion forever.
Many are the afflictions of the righteous —
But the Lord delivers him out of them all."`,
  },
  {
    n: 11,
    title: "The Heavens Declare",
    scripture: "Psalm 19",
    file: "The Heavens Declare (Psalm 19).mp3",
    img: "The Heavens Declare.webp",
    key: "t9",
    lyrics: `[Instrumental — Five Guitars]

[Spoken Word — Brody Vale]
"The heavens declare the glory of God,
And the sky above proclaims His handiwork.

Day to day pours out speech,
And night to night reveals knowledge.
There is no speech, nor are there words,
Whose voice is not heard.

Their voice goes out through all the earth,
And their words to the end of the world.
In them He has set a tent for the sun,
Which comes out like a bridegroom leaving His chamber,
And, like a strong man, runs its course with joy.

Its rising is from the end of the heavens,
And its circuit to the end of them,
And there is nothing hidden from its heat.

The law of the Lord is perfect, reviving the soul;
The testimony of the Lord is sure, making wise the simple;
The precepts of the Lord are right, rejoicing the heart;
The commandment of the Lord is pure, enlightening the eyes;

The fear of the Lord is clean, enduring forever;
The rules of the Lord are true, and righteous altogether.

More to be desired are they than gold, even much fine gold;
Sweeter also than honey and drippings of the honeycomb.

Moreover, by them is Your servant warned;
In keeping them there is great reward."`,
  },
  {
    n: 12,
    title: "Be Thou My Vision",
    scripture: "",
    file: "Be_Thou_My_Vision.mp3",
    img: "Be Thou My Vision.webp",
    key: "t14",
    lyrics: `TRIBUTE

A tribute to Michael Card, whose unforgettable rendition of this ancient hymn captured my son's heart — and mine — many years ago.

So this version I created for you, Matthew. Thank you for reminding me of "our" special song.

LYRICS

[Verse 1]
Be Thou my vision, O Lord of my heart,
Nought else but Thee, Lord, save that Thou art;
Thou my first thought through morning and night,
Waking or resting, Thy love is my light.

[Verse 2]
Be Thou my wisdom, be Thou my true word,
I ever with Thee, and Thou with me, Lord.
Thou my great Father, and I Thy true son,
Thou in me living, and I with Thee one.

[Verse 3]
Wealth holds no power, nor hollow acclaim,
Thou art my portion, forever the same;
Thou and Thou only, enthroned in my heart,
Great King of Glory, my treasure Thou art.

[Verse 4]
O high King of Heaven, when battle is done,
Grant Heaven's joy to me, bright Heaven's Sun.
Christ of my own heart, whatever befall,
Still be my vision, O Ruler of all.

[Verse 5]
Thou my great Father, and I Thy true son,
Thou in me living, and I with Thee one.
Christ of my own heart, whatever befall,
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

export function seedLyricsForTrack(id: string): string {
  return ECHOES_TRACKS.find((track) => track.id === id)?.lyrics || "";
}
