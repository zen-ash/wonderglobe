// Scenery atlas: standing paper cut-out illustrations (trees, flowers,
// houses, farm animals ...) packed into one transparent canvas texture.
//
// Every item is drawn the way a child would draw it (see childKit.ts and
// childScenery.ts): wobbly crayon outlines, scribbled colouring that goes
// over the lines, simple symbols. Each drawing is then turned into a paper
// cut-out (thick dark cut line + white paper border) and packed into its own
// cell. UVs follow the Three.js convention (v = 0 bottom).
//
// VARIANTS: common items (trees, bushes, flowers, grass, houses, rocks ...)
// have 2-3 different "children's versions". Each version lives in its own
// cell; `entries[id]` is the first one and `entries[id].variants` lists all
// of them (variants[0] has the same UVs as entries[id]). A renderer picks one
// per instance, e.g. `pickSceneryVariant(entries[id], instanceIndex)`, and
// then uses that variant's own UVs, aspect and anchorY.

import { makeCanvas, ctx2d, type PixelBox } from "./crayon";
import { CHILD_LIFT, drawChildInto } from "./childKit";
import { CHILD_DRAWERS } from "./childScenery";
import { hashString } from "./rng";

export type SceneryArtId =
  | "tree_round"
  | "tree_pine"
  | "tree_cherry"
  | "tree_fruit"
  | "tree_birch"
  | "palm"
  | "bush"
  | "bush_berry"
  | "flower_red"
  | "flower_yellow"
  | "flower_blue"
  | "flower_pink"
  | "flower_white"
  | "flower_orange"
  | "flower_purple"
  | "tulip"
  | "sunflower"
  | "daisy_cluster"
  | "wildflowers"
  | "mushroom"
  | "grass_tuft"
  | "grass_tall"
  | "fern"
  | "reed"
  | "rock"
  | "pebbles"
  | "boulder"
  | "house_red"
  | "house_blue"
  | "house_yellow"
  | "cottage"
  | "barn"
  | "windmill"
  | "well"
  | "fence"
  | "haystack"
  | "scarecrow"
  | "pumpkin"
  | "cabbage_row"
  | "cow"
  | "sheep"
  | "chicken"
  | "duck"
  | "picnic_blanket"
  | "picnic_basket"
  | "kite"
  | "lighthouse"
  | "beach_hut"
  | "shell"
  | "sailboat"
  | "lamp_post"
  | "signpost"
  | "bench"
  | "snow_pine"
  | "mountain_peak"
  | "cloud"
  | "butterfly"
  | "bird"
  | "visitor_a"
  | "visitor_b"
  | "visitor_c";

export interface AtlasEntry {
  /** UV rectangle of the visible art (Three.js convention: v = 0 at the bottom). */
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  /** width / height of the visible art (the UV rectangle in pixels). */
  aspect: number;
  /** Where the art touches the ground, as a 0..1 fraction of the entry height measured from its bottom edge (v0). */
  anchorY: number;
  /**
   * Every children's version of this item, each in its own atlas cell. The
   * first variant has exactly the same UVs as the entry itself. Pick one per
   * instance (e.g. variants[hash % variants.length]) and use ITS uvs, aspect
   * and anchorY. Always present on the entries of buildSceneryAtlas()
   * (length 1 when there is a single drawing); variant entries never nest.
   */
  variants?: AtlasEntry[];
}

export interface SceneryAtlas {
  canvas: HTMLCanvasElement;
  entries: Record<SceneryArtId, AtlasEntry>;
  ids: SceneryArtId[];
}

// Listing every id here makes the compiler check the list stays complete.
const ID_TABLE: Record<SceneryArtId, true> = {
  tree_round: true,
  tree_pine: true,
  tree_cherry: true,
  tree_fruit: true,
  tree_birch: true,
  palm: true,
  bush: true,
  bush_berry: true,
  flower_red: true,
  flower_yellow: true,
  flower_blue: true,
  flower_pink: true,
  flower_white: true,
  flower_orange: true,
  flower_purple: true,
  tulip: true,
  sunflower: true,
  daisy_cluster: true,
  wildflowers: true,
  mushroom: true,
  grass_tuft: true,
  grass_tall: true,
  fern: true,
  reed: true,
  rock: true,
  pebbles: true,
  boulder: true,
  house_red: true,
  house_blue: true,
  house_yellow: true,
  cottage: true,
  barn: true,
  windmill: true,
  well: true,
  fence: true,
  haystack: true,
  scarecrow: true,
  pumpkin: true,
  cabbage_row: true,
  cow: true,
  sheep: true,
  chicken: true,
  duck: true,
  picnic_blanket: true,
  picnic_basket: true,
  kite: true,
  lighthouse: true,
  beach_hut: true,
  shell: true,
  sailboat: true,
  lamp_post: true,
  signpost: true,
  bench: true,
  snow_pine: true,
  mountain_peak: true,
  cloud: true,
  butterfly: true,
  bird: true,
  visitor_a: true,
  visitor_b: true,
  visitor_c: true,
};

/** Every scenery id, in atlas order. */
export const SCENERY_IDS: SceneryArtId[] = Object.keys(ID_TABLE) as SceneryArtId[];

/** Number of children's versions drawn for an id (>= 1). */
export function sceneryVariantCount(id: SceneryArtId): number {
  return Math.max(1, CHILD_DRAWERS[id].length);
}

/** Pick a variant entry for an instance (stable for a given integer key). */
export function pickSceneryVariant(entry: AtlasEntry, key: number): AtlasEntry {
  const vs = entry.variants;
  if (!vs || vs.length < 2) return entry;
  return vs[Math.abs(Math.floor(key)) % vs.length];
}

/** Ground line of every drawing, as a fraction of the cell height from the top. */
const GROUND = (93 - CHILD_LIFT) / 100;

function drawVariantInto(c: HTMLCanvasElement, id: SceneryArtId, v: number): PixelBox | null {
  const drawers = CHILD_DRAWERS[id];
  if (!drawers.length) throw new Error(`No drawing for scenery id "${id}"`);
  const seed = hashString(v === 0 ? id : `${id}#${v}`);
  const cs = c.width;
  // A cut-out must not touch its cell edge; shrink about the ground point if it does.
  const g = 2;
  let box: PixelBox | null = null;
  for (const scale of [1, 0.93, 0.86, 0.78]) {
    box = drawChildInto(c, seed, drawers[Math.min(v, drawers.length - 1)], { scale });
    if (!box || (box.x0 >= g && box.y0 >= g && box.x1 <= cs - g && box.y1 <= cs - g)) break;
  }
  return box;
}

/** Draw a single scenery item (one variant) as its own cut-out canvas (previews/debugging). */
export function drawSceneryItem(id: SceneryArtId, size = 256, variant = 0): HTMLCanvasElement {
  const c = makeCanvas(size, size);
  drawVariantInto(c, id, Math.max(0, Math.min(variant, sceneryVariantCount(id) - 1)));
  return c;
}

export function buildSceneryAtlas(opts?: { cellSize?: number; cols?: number }): SceneryAtlas {
  const cs = Math.round(opts?.cellSize ?? 256);
  const ids = SCENERY_IDS;
  const cells: Array<[SceneryArtId, number]> = [];
  for (const id of ids) for (let v = 0; v < sceneryVariantCount(id); v++) cells.push([id, v]);
  const cols = opts?.cols ?? 8;
  const rows = Math.ceil(cells.length / cols);
  const W = cols * cs;
  const H = rows * cs;
  const canvas = makeCanvas(W, H);
  const actx = ctx2d(canvas);
  const scratch = makeCanvas(cs, cs);
  const groundPx = GROUND * cs;
  const entries = {} as Record<SceneryArtId, AtlasEntry>;
  cells.forEach(([id, v], i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const box = drawVariantInto(scratch, id, v);
    actx.drawImage(scratch, col * cs, row * cs);
    // Keep the UV rectangle inside the cell with at least a 2px transparent gutter.
    const g = 2;
    const x0 = Math.max(g, (box?.x0 ?? g) - 1);
    const y0 = Math.max(g, (box?.y0 ?? g) - 1);
    const x1 = Math.min(cs - g, (box?.x1 ?? cs - g) + 1);
    const y1 = Math.min(cs - g, (box?.y1 ?? cs - g) + 1);
    const X0 = col * cs + x0;
    const X1 = col * cs + x1;
    const Y0 = row * cs + y0;
    const Y1 = row * cs + y1;
    const e: AtlasEntry = {
      u0: X0 / W,
      u1: X1 / W,
      v0: 1 - Y1 / H,
      v1: 1 - Y0 / H,
      aspect: (x1 - x0) / (y1 - y0),
      anchorY: Math.max(0, Math.min(1, (y1 - groundPx) / (y1 - y0))),
    };
    if (v === 0) entries[id] = { ...e, variants: [e] };
    else entries[id].variants!.push(e);
  });
  return { canvas, entries, ids: [...ids] };
}
