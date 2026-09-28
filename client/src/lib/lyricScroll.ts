/** Map playhead time onto lyric travel so a 3.4-minute song scrolls for 3.4 minutes. */
export function songLengthSeconds(duration: number): number {
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
}

/** Bottom pad so the last lines can rise into the sheet; ~42% of the visible viewport. */
export function lyricPadPixels(viewHeight: number): number {
  if (!Number.isFinite(viewHeight) || viewHeight <= 0) return 0;
  return Math.max(128, Math.round(viewHeight * 0.42));
}

/**
 * How far the lyric track can travel. The sheet viewport must be shorter than the
 * lyrics + pad — if the dock grows to the full lyric height, travel collapses to ~0.
 */
export function lyricMaxTravel(viewHeight: number, trackHeight: number): number {
  if (!Number.isFinite(viewHeight) || !Number.isFinite(trackHeight)) return 0;
  if (viewHeight <= 0 || trackHeight <= 0) return 0;
  return Math.max(0, trackHeight - viewHeight);
}

export function lyricScrollAt(time: number, songLength: number, maxScroll: number): number {
  const length = songLengthSeconds(songLength);
  if (length <= 0 || !Number.isFinite(maxScroll) || maxScroll <= 0) return 0;
  const playhead = Number.isFinite(time) ? Math.min(length, Math.max(0, time)) : 0;
  return (playhead / length) * maxScroll;
}
