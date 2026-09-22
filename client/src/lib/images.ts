import { isImageDecoded, markImageDecoded } from "./homeCache";

export const LIST_THUMB_WIDTH = 360;

export function withImageWidth(url: string, width: number): string {
  if (!url || !width) return url;
  if (/[?&]w=\d+/.test(url)) return url.replace(/([?&]w=)\d+/, `$1${width}`);
  return `${url}${url.includes("?") ? "&" : "?"}w=${width}`;
}

export function imageIsHot(src: string): boolean {
  return isImageDecoded(src);
}

export function revealLoadedImage(img: HTMLImageElement | null, src?: string) {
  if (!img?.complete || !img.naturalWidth) return;
  if (src) markImageDecoded(src);
  img.classList.add("is-ready");
}

export function prefetchCachedImages(urls: Array<string | undefined>) {
  for (const src of urls) {
    if (!src || isImageDecoded(src)) continue;
    const img = new Image();
    img.onload = () => markImageDecoded(src);
    img.src = src;
  }
}
