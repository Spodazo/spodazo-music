import { normalizePaletteId } from "@shared/palettes";

export function applyPalette(id?: string | null): void {
  document.documentElement.dataset.palette = normalizePaletteId(id);
}
