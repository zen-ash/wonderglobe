// How each scenery drawing is built as paper craft (crossed cards, a single
// card, a little folded building), plus colour/shape facts measured once from
// the atlas pixels (dominant colours for plain paper backs, wall and roof
// colours and proportions for the buildings).

import { pickSceneryVariant, type AtlasEntry, type SceneryArtId, type SceneryAtlas } from "@/art/sceneryAtlas";
import { BILLBOARD_KIND } from "../materials";

export interface PaperArtLayout {
  /** How it is built: crossed/single standing cards, or a folded building. */
  build: "cards" | "building";
  /** Number of cards (1 = single card along its facing, 2 = X, 3 = star). */
  cards: 1 | 2 | 3;
  /** Back face: 0 plain paper, 1 the drawing faded toward paper, 2 the drawing. */
  back: 0 | 1 | 2;
  /** Max hue rotation (radians) between copies. */
  hue: number;
  /** Stands on a cardboard stand. */
  stand: boolean;
  /** Max paper bow (0..1). */
  bow: number;
}

const L = (build: PaperArtLayout["build"], cards: PaperArtLayout["cards"], back: PaperArtLayout["back"], hue: number, stand: boolean, bow: number): PaperArtLayout => ({ build, cards, back, hue, stand, bow });

const TREE = L("cards", 2, 1, 0.12, true, 0.5);
const FLOWER = L("cards", 2, 1, 0.45, true, 0.6);
const TUFT = L("cards", 3, 1, 0.1, false, 0.7);
const OBJECT = L("cards", 2, 0, 0.06, true, 0.35);
const BUILDING = L("building", 2, 0, 0.03, true, 0);

const LAYOUTS: Partial<Record<SceneryArtId, PaperArtLayout>> = {
  tree_round: TREE,
  tree_pine: { ...TREE, hue: 0.08 },
  tree_cherry: { ...TREE, hue: 0.1 },
  tree_fruit: TREE,
  tree_birch: TREE,
  palm: TREE,
  snow_pine: { ...TREE, hue: 0.05 },
  bush: L("cards", 3, 1, 0.12, true, 0.5),
  bush_berry: L("cards", 3, 1, 0.12, true, 0.5),
  flower_red: FLOWER,
  flower_yellow: FLOWER,
  flower_blue: FLOWER,
  flower_pink: FLOWER,
  flower_white: { ...FLOWER, hue: 0.1 },
  flower_orange: FLOWER,
  flower_purple: FLOWER,
  tulip: FLOWER,
  wildflowers: { ...FLOWER, hue: 0.35 },
  sunflower: { ...FLOWER, hue: 0.12 },
  daisy_cluster: { ...FLOWER, hue: 0.2 },
  grass_tuft: TUFT,
  grass_tall: TUFT,
  reed: TUFT,
  fern: TUFT,
  mushroom: { ...OBJECT, hue: 0.25 },
  rock: OBJECT,
  boulder: OBJECT,
  pebbles: L("cards", 2, 0, 0.08, false, 0.2),
  shell: L("cards", 2, 0, 0.2, false, 0.2),
  pumpkin: { ...OBJECT, hue: 0.08 },
  cabbage_row: L("cards", 2, 1, 0.1, true, 0.4),
  haystack: OBJECT,
  scarecrow: OBJECT,
  signpost: OBJECT,
  lamp_post: OBJECT,
  picnic_basket: OBJECT,
  kite: OBJECT,
  well: OBJECT,
  windmill: { ...OBJECT, bow: 0.15 },
  lighthouse: { ...OBJECT, bow: 0.1 },
  fence: L("cards", 1, 2, 0.04, true, 0.25),
  bench: L("cards", 1, 0, 0.04, true, 0.2),
  house_red: BUILDING,
  house_blue: BUILDING,
  house_yellow: BUILDING,
  cottage: BUILDING,
  barn: BUILDING,
  beach_hut: BUILDING,
};

const DEFAULT_LAYOUT = OBJECT;

export function paperLayout(art: string): PaperArtLayout {
  return LAYOUTS[art as SceneryArtId] ?? DEFAULT_LAYOUT;
}

/** How each scenery art reacts to night and seasons in the paper shaders (BILLBOARD_KIND). */
export function paperKind(art: string): number {
  switch (art) {
    case "house_red":
    case "house_blue":
    case "house_yellow":
    case "cottage":
    case "barn":
    case "windmill":
    case "beach_hut":
      return BILLBOARD_KIND.windows;
    case "lamp_post":
      return BILLBOARD_KIND.lamp;
    case "lighthouse":
      return BILLBOARD_KIND.lighthouse;
    case "tree_round":
    case "tree_fruit":
    case "tree_birch":
    case "bush":
    case "bush_berry":
      return BILLBOARD_KIND.tree;
    case "tree_pine":
    case "snow_pine":
    case "palm":
      return BILLBOARD_KIND.evergreen;
    case "tree_cherry":
      return BILLBOARD_KIND.blossom;
    case "flower_red":
    case "flower_yellow":
    case "flower_blue":
    case "flower_pink":
    case "flower_white":
    case "flower_orange":
    case "flower_purple":
    case "wildflowers":
    case "tulip":
    case "sunflower":
    case "daisy_cluster":
    case "grass_tuft":
    case "grass_tall":
    case "fern":
    case "reed":
      return BILLBOARD_KIND.plant;
    default:
      return BILLBOARD_KIND.none;
  }
}

/** Stable 0..1 hash for an integer (instance seeds). */
export function hash01(i: number): number {
  let x = (i | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/** One of the art's drawings (children's variants), chosen by a stable integer key (the item index). */
export function pickVariant(entry: AtlasEntry, key: number): AtlasEntry {
  return pickSceneryVariant(entry, key);
}

// ------------------------------------------------------------ atlas analysis

export type RGB = [number, number, number];

export interface ArtStats {
  /** Average colour of the coloured (not ink, not paper) pixels — linear RGB. */
  dominant: RGB;
  /** Average colour of the upper / lower part of the drawing — linear RGB. */
  top: RGB;
  bottom: RGB;
  /** Building proportions (fractions of the visible art): body width, body centre x, eave and ridge heights above the ground line. */
  bodyWidth: number;
  bodyCenter: number;
  eave: number;
  ridge: number;
}

const statsCache = new WeakMap<AtlasEntry, ArtStats>();
let pixels: { data: Uint8ClampedArray; w: number; h: number; canvas: HTMLCanvasElement } | null = null;

const toLin = (c: number) => Math.pow(c / 255, 2.2);

function readPixels(atlas: SceneryAtlas) {
  if (pixels && pixels.canvas === atlas.canvas) return pixels;
  const ctx = atlas.canvas.getContext("2d", { willReadFrequently: true } as CanvasRenderingContext2DSettings) as CanvasRenderingContext2D | null;
  if (!ctx) return null;
  const img = ctx.getImageData(0, 0, atlas.canvas.width, atlas.canvas.height);
  pixels = { data: img.data, w: img.width, h: img.height, canvas: atlas.canvas };
  return pixels;
}

const FALLBACK: ArtStats = { dominant: [0.8, 0.75, 0.6], top: [0.5, 0.3, 0.25], bottom: [0.8, 0.75, 0.6], bodyWidth: 0.8, bodyCenter: 0.5, eave: 0.55, ridge: 0.95 };

/** Colour and shape facts for one atlas entry (cached). */
export function artStats(atlas: SceneryAtlas, entry: AtlasEntry): ArtStats {
  const hit = statsCache.get(entry);
  if (hit) return hit;
  const px = typeof document !== "undefined" ? readPixels(atlas) : null;
  if (!px) return FALLBACK;
  const { data, w, h } = px;
  const x0 = Math.round(entry.u0 * w), x1 = Math.round(entry.u1 * w);
  // Canvas rows run top-down; v runs bottom-up.
  const yTop = Math.round((1 - entry.v1) * h), yBot = Math.round((1 - entry.v0) * h);
  const rows = Math.max(1, yBot - yTop);
  const groundRow = yBot - entry.anchorY * rows; // canvas row of the ground line
  const visRows = Math.max(1, groundRow - yTop);
  const acc = { all: [0, 0, 0, 0], top: [0, 0, 0, 0], bot: [0, 0, 0, 0] };
  const widths: Array<{ y: number; l: number; r: number }> = [];
  const step = 2;
  for (let y = yTop; y < yBot; y += step) {
    let l = -1, r = -1;
    const f = (groundRow - y) / visRows; // 0 at ground, 1 at top
    for (let x = x0; x < x1; x += step) {
      const i = (y * w + x) * 4;
      if (data[i + 3] < 160) continue;
      if (l < 0) l = x;
      r = x;
      const R = data[i], G = data[i + 1], B = data[i + 2];
      const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
      if (mx < 70) continue; // ink
      if (mn > 225 && mx - mn < 20) continue; // white paper border
      const add = (a: number[]) => {
        a[0] += R;
        a[1] += G;
        a[2] += B;
        a[3]++;
      };
      add(acc.all);
      if (f > 0.62) add(acc.top);
      else if (f > 0.08 && f < 0.48) add(acc.bot);
    }
    widths.push({ y, l, r });
  }
  const avg = (a: number[], fb: RGB): RGB => (a[3] > 4 ? [toLin(a[0] / a[3]), toLin(a[1] / a[3]), toLin(a[2] / a[3])] : fb);
  const dominant = avg(acc.all, FALLBACK.dominant);
  const stats: ArtStats = { ...FALLBACK, dominant, top: avg(acc.top, dominant), bottom: avg(acc.bot, dominant) };
  // Body: the median opaque width of the lower walls.
  const W = Math.max(1, x1 - x0);
  const lower = widths.filter((r) => r.l >= 0 && (groundRow - r.y) / visRows > 0.1 && (groundRow - r.y) / visRows < 0.42);
  if (lower.length) {
    const ws = lower.map((r) => r.r - r.l).sort((a, b) => a - b);
    const cs = lower.map((r) => (r.l + r.r) / 2).sort((a, b) => a - b);
    const bw = ws[Math.floor(ws.length / 2)];
    stats.bodyWidth = Math.min(0.98, Math.max(0.35, bw / W));
    stats.bodyCenter = (cs[Math.floor(cs.length / 2)] - x0) / W;
    // Eave: scanning down from the top, where the silhouette first gets about as wide as the walls.
    let eave = 0.55, ridge = 0.95;
    let foundRidge = false;
    for (const r of widths) {
      if (r.l < 0) continue;
      const f = (groundRow - r.y) / visRows;
      const rw = r.r - r.l;
      if (!foundRidge && rw > bw * 0.3) {
        ridge = f;
        foundRidge = true;
      }
      if (rw >= bw * 0.86) {
        eave = f;
        break;
      }
    }
    stats.ridge = Math.min(1, Math.max(0.5, ridge));
    stats.eave = Math.min(stats.ridge - 0.15, Math.max(0.3, eave - 0.03));
  }
  statsCache.set(entry, stats);
  return stats;
}

/** Plain paper back: cream paper with a hint of the drawing's main colour (linear RGB). */
export function paperBackTint(s: ArtStats): RGB {
  const cream: RGB = [0.92, 0.86, 0.74];
  return [cream[0] * 0.8 + s.dominant[0] * 0.2, cream[1] * 0.8 + s.dominant[1] * 0.2, cream[2] * 0.8 + s.dominant[2] * 0.2];
}
