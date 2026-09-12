import { normalizePaletteId } from "@shared/palettes";

const PALETTE_KEY = "spodazo-palette";

export function applyPalette(id?: string | null): void {
  const next = normalizePaletteId(id);
  document.documentElement.dataset.palette = next;
  try {
    localStorage.setItem(PALETTE_KEY, next);
  } catch {
    /* private mode */
  }
}

export function restorePalette(): void {
  try {
    const saved = localStorage.getItem(PALETTE_KEY);
    if (saved) document.documentElement.dataset.palette = normalizePaletteId(saved);
  } catch {
    /* private mode */
  }
}
