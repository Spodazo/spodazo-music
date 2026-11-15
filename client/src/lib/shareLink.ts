export function songSharePath(albumSlug: string, trackSlug: string, hidden = false): string {
  const album = encodeURIComponent(albumSlug);
  const track = encodeURIComponent(trackSlug);
  if (hidden) return `/song/${album}/${track}`;
  return `/${album}#${track}`;
}

export function songShareUrl(origin: string, albumSlug: string, trackSlug: string, hidden = false): string {
  return `${origin.replace(/\/$/, "")}${songSharePath(albumSlug, trackSlug, hidden)}`;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const field = document.createElement("textarea");
      field.value = text;
      field.setAttribute("readonly", "");
      field.style.position = "fixed";
      field.style.left = "-9999px";
      document.body.appendChild(field);
      field.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(field);
      return ok;
    } catch {
      return false;
    }
  }
}
