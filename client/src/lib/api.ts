import type { AlbumListItem, Curator, PlayerSetup, PublicAlbum, Track } from "@shared/types";

async function parse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || res.statusText);
  }
  return res.json() as Promise<T>;
}

export function fetchPlayerSetup(): Promise<PlayerSetup> {
  return fetch("/api/player-setup").then((res) => parse<PlayerSetup>(res));
}

export function updatePlayerSetup(form: FormData): Promise<PlayerSetup> {
  return fetch("/api/admin/player-setup", {
    method: "PATCH",
    body: form,
  }).then((res) => parse<PlayerSetup>(res));
}

export function fetchAlbums(): Promise<AlbumListItem[]> {
  return fetch("/api/albums").then((res) => parse<AlbumListItem[]>(res));
}

export function fetchAlbum(slug: string): Promise<PublicAlbum> {
  return fetch(`/api/albums/${encodeURIComponent(slug)}`).then((res) => parse<PublicAlbum>(res));
}

export function adminMe(): Promise<{ admin: boolean }> {
  return fetch("/api/admin/me").then((res) => parse<{ admin: boolean }>(res));
}

export function adminLogin(password: string): Promise<void> {
  return fetch("/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  }).then((res) => parse<{ ok: boolean }>(res)).then(() => undefined);
}

export function adminLogout(): Promise<void> {
  return fetch("/api/admin/logout", { method: "POST" }).then((res) => parse(res)).then(() => undefined);
}

export function fetchCurator(): Promise<Curator> {
  return fetch("/api/admin/curator").then((res) => parse<Curator>(res));
}

export function verifyCuratorPassword(password: string): Promise<void> {
  return fetch("/api/admin/curator/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  }).then((res) => parse<{ ok: boolean }>(res)).then(() => undefined);
}

export function updateCurator(fields: {
  currentPassword: string;
  firstName: string;
  lastName: string;
  email: string;
  password?: string;
}): Promise<Curator> {
  return fetch("/api/admin/curator", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fields),
  }).then((res) => parse<Curator>(res));
}

export function recoverCuratorPassword(fields: {
  password: string;
  email?: string;
  recoveryPassword?: string;
}): Promise<void> {
  return fetch("/api/admin/curator/recover", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fields),
  }).then((res) => parse<{ ok: boolean }>(res)).then(() => undefined);
}

export function createAlbum(form: FormData): Promise<PublicAlbum> {
  return fetch("/api/admin/albums", { method: "POST", body: form }).then((res) => parse<PublicAlbum>(res));
}

export function updateAlbum(id: string, form: FormData): Promise<PublicAlbum> {
  return fetch(`/api/admin/albums/${encodeURIComponent(id)}`, { method: "PATCH", body: form }).then((res) =>
    parse<PublicAlbum>(res),
  );
}

export function setAlbumHidden(id: string, hidden: boolean): Promise<PublicAlbum> {
  return fetch(`/api/admin/albums/${encodeURIComponent(id)}/visibility`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hidden }),
  }).then((res) => parse<PublicAlbum>(res));
}

export function deleteAlbum(id: string): Promise<void> {
  return fetch(`/api/admin/albums/${encodeURIComponent(id)}`, { method: "DELETE" })
    .then((res) => parse(res))
    .then(() => undefined);
}

export function createTrack(albumId: string, form: FormData): Promise<Track> {
  return fetch(`/api/admin/albums/${encodeURIComponent(albumId)}/tracks`, { method: "POST", body: form }).then((res) =>
    parse<Track>(res),
  );
}

export function createTracksBulk(albumId: string, form: FormData): Promise<Track[]> {
  return fetch(`/api/admin/albums/${encodeURIComponent(albumId)}/tracks/bulk`, { method: "POST", body: form })
    .then((res) => parse<{ tracks: Track[] }>(res))
    .then((body) => body.tracks);
}

export function trackFileUrl(id: string): string {
  return `/api/admin/tracks/${encodeURIComponent(id)}/file`;
}

export function updateTrack(id: string, form: FormData): Promise<Track> {
  return fetch(`/api/admin/tracks/${encodeURIComponent(id)}`, { method: "PATCH", body: form }).then((res) =>
    parse<Track>(res),
  );
}

export function deleteTrack(id: string): Promise<void> {
  return fetch(`/api/admin/tracks/${encodeURIComponent(id)}`, { method: "DELETE" })
    .then((res) => parse(res))
    .then(() => undefined);
}

export function setTrackArchived(id: string, archived: boolean): Promise<Track> {
  return fetch(`/api/admin/tracks/${encodeURIComponent(id)}/archive`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ archived }),
  }).then((res) => parse<Track>(res));
}

export function reorderTracks(albumId: string, trackIds: string[]): Promise<Track[]> {
  return fetch(`/api/admin/albums/${encodeURIComponent(albumId)}/reorder`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trackIds }),
  }).then((res) => parse<Track[]>(res));
}

export function reorderAlbums(albumIds: string[]): Promise<AlbumListItem[]> {
  return fetch("/api/admin/reorder-albums", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ albumIds }),
  }).then((res) => parse<AlbumListItem[]>(res));
}
