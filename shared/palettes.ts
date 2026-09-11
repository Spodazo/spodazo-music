export const PALETTE_IDS = ["ink", "navy", "forest", "espresso", "plum", "teal"] as const;

export type PaletteId = (typeof PALETTE_IDS)[number];

export type Palette = {
  id: PaletteId;
  name: string;
  bg: string;
  bg2: string;
  bg3: string;
  card: string;
  input: string;
  panel: string;
  portrait: string;
  text: string;
  text2: string;
  muted: string;
  footer: string;
  accent: string;
  accent2: string;
};

export const DEFAULT_PALETTE_ID: PaletteId = "ink";

export const PALETTES: Palette[] = [
  {
    id: "ink",
    name: "Current ink",
    bg: "#0D1117",
    bg2: "#111820",
    bg3: "#16202C",
    card: "#121A24",
    input: "#0F141C",
    panel: "#111820",
    portrait: "#0A1520",
    text: "#ECE8E0",
    text2: "#B8B0A4",
    muted: "#7A8A9A",
    footer: "#C8C8C8",
    accent: "#E8B86D",
    accent2: "#C9943C",
  },
  {
    id: "navy",
    name: "Midnight navy",
    bg: "#12213D",
    bg2: "#162846",
    bg3: "#1B3052",
    card: "#172A4A",
    input: "#142442",
    panel: "#162846",
    portrait: "#0F2546",
    text: "#ECE8E0",
    text2: "#B8B0A4",
    muted: "#96A4BA",
    footer: "#C8C8C8",
    accent: "#A8C4E8",
    accent2: "#8FB0D4",
  },
  {
    id: "forest",
    name: "Deep forest",
    bg: "#102A1E",
    bg2: "#143325",
    bg3: "#193F2D",
    card: "#153727",
    input: "#122F21",
    panel: "#143325",
    portrait: "#0D3322",
    text: "#ECE8E0",
    text2: "#B8B0A4",
    muted: "#98AEA9",
    footer: "#C8C8C8",
    accent: "#B4D4A8",
    accent2: "#9FCB9A",
  },
  {
    id: "espresso",
    name: "Espresso brown",
    bg: "#271911",
    bg2: "#302015",
    bg3: "#3C281A",
    card: "#342216",
    input: "#2C1C13",
    panel: "#302015",
    portrait: "#301D0E",
    text: "#ECE8E0",
    text2: "#B8B0A4",
    muted: "#A09A98",
    footer: "#C8C8C8",
    accent: "#E0B890",
    accent2: "#C9A27A",
  },
  {
    id: "plum",
    name: "Charcoal plum",
    bg: "#221630",
    bg2: "#291A39",
    bg3: "#311F45",
    card: "#2B1B3D",
    input: "#251835",
    panel: "#291A39",
    portrait: "#261339",
    text: "#ECE8E0",
    text2: "#B8B0A4",
    muted: "#9894AC",
    footer: "#C8C8C8",
    accent: "#D4B8E0",
    accent2: "#C4A8D4",
  },
  {
    id: "teal",
    name: "Deep teal",
    bg: "#0D2A2E",
    bg2: "#113137",
    bg3: "#163943",
    card: "#12333B",
    input: "#0F2D33",
    panel: "#113137",
    portrait: "#0A2E37",
    text: "#ECE8E0",
    text2: "#B8B0A4",
    muted: "#98B2B9",
    footer: "#C8C8C8",
    accent: "#8ED4D0",
    accent2: "#7EC8C4",
  },
];

export function isPaletteId(value: string): value is PaletteId {
  return PALETTE_IDS.includes(value as PaletteId);
}

export function normalizePaletteId(raw?: string | null): PaletteId {
  const id = String(raw || "").trim().toLowerCase();
  return isPaletteId(id) ? id : DEFAULT_PALETTE_ID;
}

export function paletteById(raw?: string | null): Palette {
  const id = normalizePaletteId(raw);
  return PALETTES.find((item) => item.id === id) || PALETTES[0];
}
