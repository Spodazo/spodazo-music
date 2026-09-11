/** Map playhead time onto lyric travel so a 3.4-minute song scrolls for 3.4 minutes. */
export function songLengthSeconds(duration: number): number {
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
}

export function lyricScrollAt(time: number, songLength: number, maxScroll: number): number {
  const length = songLengthSeconds(songLength);
  if (length <= 0 || !Number.isFinite(maxScroll) || maxScroll <= 0) return 0;
  const playhead = Number.isFinite(time) ? Math.min(length, Math.max(0, time)) : 0;
  return (playhead / length) * maxScroll;
}
