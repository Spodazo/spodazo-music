export function songSharePath(albumSlug: string, trackSlug: string): string {
  return `/${encodeURIComponent(albumSlug)}#${encodeURIComponent(trackSlug)}`;
}

export function songShareUrl(origin: string, albumSlug: string, trackSlug: string): string {
  return `${origin.replace(/\/$/, "")}${songSharePath(albumSlug, trackSlug)}`;
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
