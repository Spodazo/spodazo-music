export type LyricLine = {
  heading: boolean;
  text: string;
};

const BRACKETED_LINE = /^\[([^\]\n]+)\]$/;
const NAMED_SECTION =
  /^((?:Verse|Chorus|Refrain|Bridge|Spoken Word|Instrumental)\b[^\]\n]*)$/i;

/** Label for a verse, chorus, or other section line, without square brackets. */
export function lyricSectionLabel(line: string): string | null {
  const trimmed = line.trim();
  const bracketed = trimmed.match(BRACKETED_LINE);
  if (bracketed) return bracketed[1].replace(/\s+/g, " ").trim();
  const named = trimmed.match(NAMED_SECTION);
  if (named) return named[1].replace(/\s+/g, " ").trim();
  return null;
}

/** Split lyrics into lines. Section labels become headings with the brackets removed. */
export function lyricLines(raw: string): LyricLine[] {
  return raw.replace(/\r\n/g, "\n").split("\n").map((line) => {
    const label = lyricSectionLabel(line);
    if (label) return { heading: true, text: label };
    return { heading: false, text: line.replace(/[\[\]]/g, "") };
  });
}
