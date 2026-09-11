export function parseDurationLabel(label?: string): number {
  if (!label) return 0;
  const parts = label.trim().split(":").map((part) => Number(part));
  if (parts.length < 2 || parts.length > 3 || parts.some((n) => !Number.isFinite(n))) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return parts[0] * 60 + parts[1];
}

export function formatListeningTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 30) return "";
  const totalMin = Math.round(seconds / 60);
  if (totalMin < 1) return "";
  const hours = Math.floor(totalMin / 60);
  const minutes = totalMin % 60;
  if (hours > 0) return minutes ? `${hours} hr ${minutes} min` : `${hours} hr`;
  return `${totalMin} min`;
}

export function totalListeningLabel(labels: Array<string | undefined>): string {
  const seconds = labels.reduce((sum, label) => sum + parseDurationLabel(label), 0);
  return formatListeningTime(seconds);
}
