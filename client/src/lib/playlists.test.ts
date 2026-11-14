import assert from "node:assert/strict";
import test from "node:test";
import {
  addPlaylistSong,
  albumsForPlaylistPicker,
  createPlaylist,
  deletePlaylist,
  MAX_PLAYLIST_SONGS,
  playlistSongFromTrack,
  PLAYLISTS_KEY,
  readPlaylists,
  removePlaylistSong,
  renamePlaylist,
} from "./playlists";

const memory = new Map<string, string>();
const localStorageMock = {
  getItem(key: string) {
    return memory.get(key) ?? null;
  },
  setItem(key: string, value: string) {
    memory.set(key, value);
  },
  removeItem(key: string) {
    memory.delete(key);
  },
  clear() {
    memory.clear();
  },
  key() {
    return null;
  },
  get length() {
    return memory.size;
  },
};

Object.defineProperty(globalThis, "localStorage", { value: localStorageMock, configurable: true });
Object.defineProperty(globalThis, "window", {
  value: {
    localStorage: localStorageMock,
    dispatchEvent() {
      return true;
    },
    addEventListener() {},
    removeEventListener() {},
  },
  configurable: true,
});

function song(trackId: string, albumSlug: string, title: string) {
  return playlistSongFromTrack(
    { slug: albumSlug, title: albumSlug },
    {
      id: trackId,
      title,
      scripture: "",
      instrumental: false,
      imageUrl: "/media/images/cover.webp",
      audioUrl: `/media/audio/${trackId}/play?v=1`,
      durationLabel: "3:10",
    },
  );
}

test("a guest can keep songs from more than one album in a playlist", () => {
  memory.clear();
  const created = createPlaylist("  Sunday morning  ");
  assert.equal("playlist" in created, true);
  if (!("playlist" in created)) return;
  assert.equal(created.playlist.name, "Sunday morning");
  const withEchoes = addPlaylistSong(created.playlist.id, song("echoes-1", "echoes", "Job 5"));
  assert.equal("playlist" in withEchoes, true);
  if (!("playlist" in withEchoes)) return;
  const withVision = addPlaylistSong(withEchoes.playlist.id, song("vision-1", "be-thou-my-vision", "Be Thou My Vision"));
  assert.equal("playlist" in withVision, true);
  if (!("playlist" in withVision)) return;
  assert.deepEqual(withVision.playlist.songs.map((item) => item.albumSlug), ["echoes", "be-thou-my-vision"]);
  const again = addPlaylistSong(withVision.playlist.id, song("echoes-1", "echoes", "Job 5"));
  assert.equal("playlist" in again && again.playlist.songs.length, 2);
  const renamed = renamePlaylist(created.playlist.id, "Evening");
  assert.equal("playlist" in renamed && renamed.playlist.name, "Evening");
  const removed = removePlaylistSong(created.playlist.id, "echoes-1");
  assert.equal(removed?.songs.length, 1);
  assert.equal(removed?.songs[0].title, "Be Thou My Vision");
  deletePlaylist(created.playlist.id);
  assert.deepEqual(readPlaylists(), []);
});

test("a broken playlist record does not replace the ones that are still valid", () => {
  memory.set(PLAYLISTS_KEY, JSON.stringify([
    { id: "ok", name: "Kept", updatedAt: 1, songs: [song("a", "echoes", "One")] },
    { id: "", name: "Dropped", songs: [] },
    { name: "No id" },
  ]));
  const playlists = readPlaylists();
  assert.equal(playlists.length, 1);
  assert.equal(playlists[0].name, "Kept");
  assert.equal(playlists[0].songs[0].title, "One");
});

test("songs without a same-site audio address are ignored", () => {
  memory.set(PLAYLISTS_KEY, JSON.stringify([{
    id: "ok",
    name: "Kept",
    updatedAt: 1,
    songs: [{ trackId: "a", albumSlug: "echoes", title: "Remote", albumTitle: "Echoes", audioUrl: "https://evil.example/song.mp3" }],
  }]));
  assert.equal(readPlaylists()[0].songs.length, 0);
});

test("hidden albums are offered only to an admin", () => {
  const albums = [
    { title: "Echoes", hidden: false },
    { title: "Temp Music", hidden: true },
  ];
  assert.deepEqual(albumsForPlaylistPicker(albums, false).map((album) => album.title), ["Echoes"]);
  assert.deepEqual(albumsForPlaylistPicker(albums, true).map((album) => album.title), ["Echoes", "Temp Music"]);
});

test("a playlist stops accepting songs once it is full", () => {
  memory.clear();
  const created = createPlaylist("Full");
  assert.equal("playlist" in created, true);
  if (!("playlist" in created)) return;
  memory.set(PLAYLISTS_KEY, JSON.stringify([{
    ...created.playlist,
    songs: Array.from({ length: MAX_PLAYLIST_SONGS }, (_, index) => song(`t${index}`, "echoes", `Song ${index}`)),
  }]));
  const result = addPlaylistSong(created.playlist.id, song("extra", "other", "Extra"));
  assert.deepEqual(result, { error: "This playlist is full." });
});
