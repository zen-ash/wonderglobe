// Turns a child's drawing (from the in-game board) or an uploaded picture into
// an authentic paper cut-out that keeps the child's own pixels: colours,
// proportions, wobbly strokes and all. Nothing is ever replaced by other art
// and nothing here sees a filename — results depend only on pixels + settings.
//
// PURE module: no DOM. Runs in Node (tests), in a Web Worker and on the main
// thread as a fallback.
//
// Silhouette rules (shared by both pipelines):
//  * Small gaps in outlines are closed (disc closing, radius 2.5–4.5 px).
//  * Every enclosed hole is filled — like cutting the picture out with
//    scissors, only the outside is cut away. Inside a board drawing,
//    un-inked interior becomes white paper; inside an upload the original
//    photo pixels are kept as they are. (The "colour" upload mode is the one
//    exception: it removes background-coloured pixels everywhere, so it can
//    open holes on purpose.)
//  * Specks are dropped only if they are tiny both relative to the largest
//    piece (< 0.6 %) and absolutely; marks close enough to share the same
//    paper border are treated as part of that piece.

import type { CutoutMeta, Polygon } from "@/core/types";
import {
  close,
  connectedComponents,
  countSet,
  fillHoles,
  hysteresis,
  maskBounds,
  removeSpecks,
  squaredDistanceToSet,
} from "./morphology";
import {
  assertImage,
  clampRect,
  cropImage,
  cropMask,
  DrawingError,
  overWhite,
  padImage,
  padMask,
  resampleArea,
  resampleMaskArea,
  resolveCrop,
  toHex,
  type RGBAImage,
  type Rect,
} from "./raster";
import { simplifyClosed, traceOuterContours } from "./trace";

export type { RGBAImage, Rect } from "./raster";
export { DrawingError } from "./raster";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CutoutResult {
  /** The finished cut-out (transparent outside the paper). */
  cutout: RGBAImage;
  meta: CutoutMeta;
  /**
   * Board: ink bounds in board pixels. Upload: bounds of the kept area in
   * ORIGINAL (uncropped) image pixels.
   */
  inkBounds: Rect;
  /** Scale applied from source pixels to cut-out pixels (≤ 1). */
  scale: number;
  /**
   * Where the top-left of `inkBounds` lands in the cut-out bitmap:
   * cutoutX = (srcX - inkBounds.x) * scale + offset[0] (same for y).
   */
  offset: [number, number];
}

export interface UploadSettings {
  /** In original image px; null = whole image. */
  crop: Rect | null;
  /** 0..100 background-removal strength (default 35). */
  tolerance: number;
  /**
   * auto: transparency if present, else edge-flood.
   * edges: remove background-coloured pixels connected to the border.
   * colour: remove every pixel similar to the background colour.
   * whole: keep the whole (cropped) rectangle as a card.
   */
  mode: "auto" | "edges" | "colour" | "whole";
  /** Manual corrections in CROPPED-image pixel space (1 = painted). */
  paint?: { keep: Uint8Array | null; remove: Uint8Array | null; width: number; height: number };
}

export type UploadIssue =
  | "busy-background"
  | "too-little-foreground"
  | "too-much-foreground"
  | "many-pieces"
  | "touches-edges";

export interface UploadAnalysis {
  /** Foreground mask for the cropped image (1 = keep). */
  mask: Uint8Array;
  /** Cropped size. */
  width: number;
  height: number;
  usedTransparency: boolean;
  /** Estimated background colour (hex), null if not colour-based. */
  background: string | null;
  /** 0..1 — the UI offers the correction flow below ~0.55. */
  confidence: number;
  issues: UploadIssue[];
}

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/** Board pixels with alpha above this count as ink. */
export const INK_ALPHA = 20;
/** The silhouette box is scaled so its longest side is at most this. */
export const MAX_WORK_SIZE = 480;
/** Colour of the thin cut line around the paper border (#2b2320). */
export const OUTLINE_RGB: readonly [number, number, number] = [0x2b, 0x23, 0x20];
/** Below this confidence the UI should offer the correction flow. */
export const LOW_CONFIDENCE = 0.55;

const BORDER_FRACTION = 0.035;
const MIN_BORDER = 6;
const SPECK_RELATIVE = 0.006;
const SPECK_ABSOLUTE = 48; // px at 480 px working size
const SIMPLIFY_EPSILON = 1.25;
const TRANSPARENT_SHARE = 0.03;
const TRANSPARENT_ALPHA = 32;

/** Disc radius used to close small gaps in outlines. */
function closeRadiusFor(longest: number): number {
  return Math.min(4.5, Math.max(2.5, longest * 0.008));
}

/** Paper border / outline widths and the padding needed around the shape. */
function cutoutGeometry(longest: number) {
  const border = Math.max(MIN_BORDER, Math.round(longest * BORDER_FRACTION));
  const outline = longest >= 240 ? 3 : 2;
  return { border, outline, pad: border + outline + 4 };
}

// ---------------------------------------------------------------------------
// Silhouette clean-up (shared)
// ---------------------------------------------------------------------------

interface CleanOptions {
  closeRadius: number;
  fill: boolean;
  joinRadius: number;
  minAbsoluteArea: number;
}

/** Closes gaps, fills enclosed holes (optional) and removes specks. */
export function cleanSilhouette(mask: Uint8Array, w: number, h: number, o: CleanOptions): Uint8Array {
  let m = close(mask, w, h, o.closeRadius);
  if (o.fill) m = fillHoles(m, w, h);
  return removeSpecks(m, w, h, {
    joinRadius: o.joinRadius,
    minRelativeArea: SPECK_RELATIVE,
    minAbsoluteArea: o.minAbsoluteArea,
  });
}

// ---------------------------------------------------------------------------
// Cut-out builder (shared)
// ---------------------------------------------------------------------------

interface BuildInput {
  /** Source colours, same size as `sil`, already padded. */
  src: RGBAImage;
  /** Final silhouette (1 = part of the picture). */
  sil: Uint8Array;
  border: number;
  outline: number;
  /**
   * When true, faint source pixels just outside the silhouette (antialiased
   * stroke edges) are still painted on the paper border. When false the
   * border is plain white (used for photos, where outside = background).
   */
  keepOutside: boolean;
  /** Colour to leave out of the palette (photo background), if any. */
  ignoreColour: readonly [number, number, number] | null;
  ignoreDistance: number;
}

function buildCutout(o: BuildInput): { cutout: RGBAImage; meta: CutoutMeta; box: Rect } {
  const { src, sil, border, outline } = o;
  const W = src.width;
  const H = src.height;
  const d2 = squaredDistanceToSet(sil, W, H);
  const outer = border + outline;
  const reach = outer + 0.5; // antialiased fall-off of the outer edge
  const reach2 = reach * reach;

  // Crop to everything visible plus a small transparent margin.
  let minX = W, minY = H, maxX = -1, maxY = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (d2[y * W + x] >= reach2) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      maxY = y;
    }
  }
  const box = clampRect({ x: minX - 2, y: minY - 2, w: maxX - minX + 5, h: maxY - minY + 5 }, W, H) as Rect;
  const cw = box.w;
  const ch = box.h;

  const out = new Uint8ClampedArray(cw * ch * 4);
  const silC = new Uint8Array(cw * ch); // silhouette in cut-out coords
  const solid = new Uint8Array(cw * ch); // silhouette px with opaque source (alpha ≥ 250)
  let inky = 0; // silhouette px with any visible source
  const shape = new Uint8Array(cw * ch); // outlined shape (alpha ≥ 50 %)
  const [or, og, ob] = OUTLINE_RGB;
  const s = src.data;
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const si = (y + box.y) * W + (x + box.x);
      const oi = y * cw + x;
      const p = oi * 4;
      const dd = d2[si];
      if (dd >= reach2) {
        // Fully transparent; colour = outline so filtering never shows a halo.
        out[p] = or; out[p + 1] = og; out[p + 2] = ob; out[p + 3] = 0;
        continue;
      }
      const q = si * 4;
      if (dd === 0) {
        silC[oi] = 1;
        shape[oi] = 1;
        const a = s[q + 3];
        if (a >= 250) solid[oi] = 1;
        if (a > INK_ALPHA) inky++;
        out[p] = overWhite(s[q], a);
        out[p + 1] = overWhite(s[q + 1], a);
        out[p + 2] = overWhite(s[q + 2], a);
        out[p + 3] = 255;
        continue;
      }
      const d = Math.sqrt(dd);
      if (d <= outer) shape[oi] = 1;
      let r = 255, g = 255, b = 255;
      if (o.keepOutside) {
        const a = s[q + 3];
        r = overWhite(s[q], a);
        g = overWhite(s[q + 1], a);
        b = overWhite(s[q + 2], a);
      }
      // Paper → outline transition (1 px soft) and soft outer edge.
      const t = Math.min(1, Math.max(0, d - border + 0.5));
      out[p] = r + (or - r) * t;
      out[p + 1] = g + (og - g) * t;
      out[p + 2] = b + (ob - b) * t;
      out[p + 3] = 255 * Math.min(1, Math.max(0, reach - d));
    }
  }
  const cutout: RGBAImage = { width: cw, height: ch, data: out };

  // Polygons: outer outline(s) of the outlined paper shape.
  const polygons: Polygon[] = traceOuterContours(shape, cw, ch, 16)
    .map((poly) => simplifyClosed(poly, SIMPLIFY_EPSILON))
    .filter((poly) => poly.length >= 3);

  const meta: CutoutMeta = {
    width: cw,
    height: ch,
    polygons,
    anchor: computeAnchor(silC, shape, cw, ch),
    aspect: cw / ch,
    coverage: countSet(shape) / (cw * ch),
    // Fall back to the whole silhouette for drawings made only of soft,
    // semi-transparent strokes.
    palette: computePalette(
      out,
      countSet(solid) >= inky * 0.25 ? solid : silC,
      o.ignoreColour,
      o.ignoreDistance,
    ),
    roofLine: computeRoofLine(silC, cw, ch),
  };
  return { cutout, meta, box };
}

/**
 * Bottom-centre anchor: x = mean x of silhouette pixels in the lowest ~6 % of
 * its rows; y = bottom edge of the outlined shape. Normalised 0..1.
 */
function computeAnchor(sil: Uint8Array, shape: Uint8Array, w: number, h: number): [number, number] {
  const sb = maskBounds(sil, w, h);
  const ob = maskBounds(shape, w, h);
  if (!sb || !ob) return [0.5, 1];
  const rows = Math.max(1, Math.round(sb.h * 0.06));
  let sum = 0;
  let n = 0;
  for (let y = sb.y + sb.h - rows; y < sb.y + sb.h; y++) {
    for (let x = sb.x; x < sb.x + sb.w; x++) {
      if (sil[y * w + x]) {
        sum += x + 0.5;
        n++;
      }
    }
  }
  const ax = n > 0 ? sum / n / w : 0.5;
  const ay = (ob.y + ob.h) / h;
  return [ax, ay];
}

/**
 * Up to 5 dominant colours of the picture, most common first. Only
 * silhouette pixels with (nearly) opaque source are sampled — so the paper
 * border, the cut line and soft antialiased stroke edges are never counted;
 * near-white paper and (for photos) the background colour are ignored. Colours are quantised to 4 bits/channel; the reported colour is
 * the mean of the bucket. Buckets too close to an already chosen colour are
 * merged into it.
 */
function computePalette(
  px: Uint8ClampedArray,
  sil: Uint8Array,
  ignore: readonly [number, number, number] | null,
  ignoreDistance: number,
): string[] {
  const BINS = 4096;
  const count = new Float64Array(BINS);
  const sr = new Float64Array(BINS);
  const sg = new Float64Array(BINS);
  const sb = new Float64Array(BINS);
  const ig2 = ignoreDistance * ignoreDistance * 3;
  let total = 0;
  for (let i = 0; i < sil.length; i++) {
    if (!sil[i]) continue;
    const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2];
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    if (mn >= 225 && mx - mn <= 25) continue; // white / paper
    if (ignore) {
      const dr = r - ignore[0], dg = g - ignore[1], db = b - ignore[2];
      if (dr * dr + dg * dg + db * db <= ig2) continue;
    }
    const bin = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    count[bin]++;
    sr[bin] += r;
    sg[bin] += g;
    sb[bin] += b;
    total++;
  }
  if (total === 0) return [];
  const order: number[] = [];
  for (let i = 0; i < BINS; i++) if (count[i] > 0) order.push(i);
  order.sort((a, b) => count[b] - count[a] || a - b);
  const chosen: Array<{ r: number; g: number; b: number; n: number }> = [];
  const MERGE2 = 40 * 40;
  for (const bin of order) {
    const n = count[bin];
    const c = { r: sr[bin] / n, g: sg[bin] / n, b: sb[bin] / n };
    const near = chosen.find((k) => (k.r - c.r) ** 2 + (k.g - c.g) ** 2 + (k.b - c.b) ** 2 < MERGE2);
    if (near) {
      near.n += n;
      continue;
    }
    if (chosen.length < 5) chosen.push({ ...c, n });
  }
  return chosen
    .map((c, i) => ({ ...c, i }))
    .filter((c) => c.n >= total * 0.01)
    .sort((a, b) => b.n - a.n || a.i - b.i)
    .map((c) => toHex(c.r, c.g, c.b));
}

/**
 * Where a building's roof meets its walls (normalised y, 0 top..1 bottom).
 * Scanning from the top, find the first silhouette row whose width reaches
 * 75 % of the widest row; then continue down to the row reaching 92 % so a
 * sloping roof is followed to its eaves instead of stopping part-way. Clamped
 * to 0.15..0.7.
 */
function computeRoofLine(sil: Uint8Array, w: number, h: number): number {
  const widths = new Int32Array(h);
  let maxW = 0;
  for (let y = 0; y < h; y++) {
    let n = 0;
    for (let x = 0; x < w; x++) n += sil[y * w + x];
    widths[y] = n;
    if (n > maxW) maxW = n;
  }
  if (maxW === 0) return 0.35;
  let y = 0;
  while (y < h && widths[y] < maxW * 0.75) y++;
  while (y < h && widths[y] < maxW * 0.92) y++;
  return Math.min(0.7, Math.max(0.15, y / h));
}

// ---------------------------------------------------------------------------
// Board pipeline
// ---------------------------------------------------------------------------

/** Bounds of pixels whose alpha exceeds `threshold`, or null. */
export function alphaBounds(img: RGBAImage, threshold: number): Rect | null {
  const { width: w, height: h, data } = img;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] <= threshold) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      maxY = y;
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/**
 * Board drawing → paper cut-out. The board is transparent where nothing is
 * drawn. Throws `DrawingError("empty-drawing", "Draw something first!")`
 * when there is no ink.
 *
 * `inkBounds` in the result are the bounds of the ink that was KEPT (stray
 * specks far from the drawing are ignored), in board pixels.
 */
export function processBoardDrawing(img: RGBAImage): CutoutResult {
  assertImage(img);
  const all = alphaBounds(img, INK_ALPHA);
  if (!all) throw new DrawingError("empty-drawing", "Draw something first!");

  // Pass 1 (source resolution): drop far-away specks before choosing the
  // working box, so a stray dot in a corner doesn't shrink the drawing or
  // change its border.
  const boxImg = cropImage(img, all);
  const s0 = Math.min(1, MAX_WORK_SIZE / Math.max(all.w, all.h));
  const rawInk = new Uint8Array(all.w * all.h);
  for (let i = 0; i < rawInk.length; i++) rawInk[i] = boxImg.data[i * 4 + 3] > INK_ALPHA ? 1 : 0;
  const keptInk = removeSpecks(rawInk, all.w, all.h, {
    joinRadius: cutoutGeometry(Math.max(all.w, all.h) * s0).border / s0,
    minRelativeArea: SPECK_RELATIVE,
    minAbsoluteArea: SPECK_ABSOLUTE / (s0 * s0),
  });
  for (let i = 0; i < rawInk.length; i++) {
    if (rawInk[i] && !keptInk[i]) boxImg.data[i * 4 + 3] = 0; // erase the speck
  }
  const kb = maskBounds(keptInk, all.w, all.h);
  if (!kb) throw new DrawingError("empty-drawing", "Draw something first!");
  const ink: Rect = { x: all.x + kb.x, y: all.y + kb.y, w: kb.w, h: kb.h };

  // Pass 2 (bounded working resolution, aspect preserved).
  const scale = Math.min(1, MAX_WORK_SIZE / Math.max(ink.w, ink.h));
  const ww = Math.max(1, Math.round(ink.w * scale));
  const wh = Math.max(1, Math.round(ink.h * scale));
  const work = scale === 1 ? cropImage(boxImg, kb) : resampleArea(boxImg, kb, ww, wh);
  const longest = Math.max(ww, wh);
  const geo = cutoutGeometry(longest);
  const src = padImage(work, geo.pad);
  const W = src.width;
  const H = src.height;

  const inkMask = new Uint8Array(W * H);
  for (let i = 0; i < inkMask.length; i++) inkMask[i] = src.data[i * 4 + 3] > INK_ALPHA ? 1 : 0;
  const sil = cleanSilhouette(inkMask, W, H, {
    closeRadius: closeRadiusFor(longest),
    fill: true,
    joinRadius: geo.border,
    minAbsoluteArea: SPECK_ABSOLUTE,
  });
  if (countSet(sil) === 0) throw new DrawingError("empty-drawing", "Draw something first!");

  const { cutout, meta, box } = buildCutout({
    src,
    sil,
    border: geo.border,
    outline: geo.outline,
    keepOutside: true,
    ignoreColour: null,
    ignoreDistance: 0,
  });
  return { cutout, meta, inkBounds: ink, scale, offset: [geo.pad - box.x, geo.pad - box.y] };
}

// ---------------------------------------------------------------------------
// Upload pipeline
// ---------------------------------------------------------------------------

/** Maps tolerance 0..100 to a colour-distance threshold (per-channel RMS units). */
function toleranceToThreshold(tolerance: number): number {
  const t = Math.min(100, Math.max(0, Number.isFinite(tolerance) ? tolerance : 35));
  return 4 + t * 0.8;
}

interface Background {
  colour: [number, number, number];
  /** Per-pixel brightness factor applied to `colour` (lighting normalisation). */
  shade: Float32Array;
}

/**
 * Estimates the paper/background colour and a smooth lighting field.
 *
 * Global colour: per-channel median of a thin ring of border pixels,
 * refined to the mean of border pixels close to that median (robust to a
 * drawing that touches the edge). Lighting: the image is split into coarse
 * cells; in each cell the pixels that look like background give a brightness
 * ratio relative to the global colour. Cells without enough background are
 * filled in from their neighbours, the grid is smoothed, and the ratio is
 * interpolated bilinearly per pixel. Only brightness is adapted (not hue), so
 * a pale coloured area of the drawing can't be mistaken for shaded paper.
 */
function estimateBackground(rgb: Uint8Array, w: number, h: number): Background {
  const n = w * h;
  const ring = Math.max(1, Math.round(Math.min(w, h) * 0.02));
  const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  const isRing = (x: number, y: number) => x < ring || y < ring || x >= w - ring || y >= h - ring;
  let ringCount = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!isRing(x, y)) continue;
      const i = (y * w + x) * 3;
      hist[0][rgb[i]]++;
      hist[1][rgb[i + 1]]++;
      hist[2][rgb[i + 2]]++;
      ringCount++;
    }
  }
  const median = hist.map((hc) => {
    let acc = 0;
    for (let v = 0; v < 256; v++) {
      acc += hc[v];
      if (acc * 2 >= ringCount) return v;
    }
    return 255;
  });
  const near2 = 40 * 40 * 3;
  let sr = 0, sg = 0, sb = 0, sn = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!isRing(x, y)) continue;
      const i = (y * w + x) * 3;
      const dr = rgb[i] - median[0], dg = rgb[i + 1] - median[1], db = rgb[i + 2] - median[2];
      if (dr * dr + dg * dg + db * db > near2) continue;
      sr += rgb[i];
      sg += rgb[i + 1];
      sb += rgb[i + 2];
      sn++;
    }
  }
  const colour: [number, number, number] =
    sn > 0 ? [sr / sn, sg / sn, sb / sn] : [median[0], median[1], median[2]];
  const lum = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;
  const gl = Math.max(1, lum(colour[0], colour[1], colour[2]));

  // Coarse lighting grid.
  const cell = Math.max(8, Math.ceil(Math.max(w, h) / 24));
  const gw = Math.ceil(w / cell);
  const gh = Math.ceil(h / cell);
  const sum = new Float64Array(gw * gh);
  const cnt = new Float64Array(gw * gh);
  const tot = new Float64Array(gw * gh);
  for (let y = 0; y < h; y++) {
    const cy = Math.floor(y / cell);
    for (let x = 0; x < w; x++) {
      const c = cy * gw + Math.floor(x / cell);
      tot[c]++;
      const i = (y * w + x) * 3;
      const r = rgb[i], g = rgb[i + 1], b = rgb[i + 2];
      const dr = r - colour[0], dg = g - colour[1], db = b - colour[2];
      if (dr * dr + dg * dg + db * db > near2) continue;
      sum[c] += lum(r, g, b);
      cnt[c]++;
    }
  }
  let ratio = new Float64Array(gw * gh);
  let valid = new Uint8Array(gw * gh);
  let anyValid = false;
  for (let c = 0; c < ratio.length; c++) {
    if (cnt[c] >= tot[c] * 0.5) {
      ratio[c] = Math.min(1.25, Math.max(0.6, sum[c] / cnt[c] / gl));
      valid[c] = 1;
      anyValid = true;
    }
  }
  if (!anyValid) {
    ratio.fill(1);
    valid.fill(1);
  }
  // Fill invalid cells from valid neighbours, one ring per pass (deterministic).
  for (let pass = 0; pass < gw + gh; pass++) {
    let changed = false;
    const nr = ratio.slice();
    const nv = valid.slice();
    for (let cy = 0; cy < gh; cy++) {
      for (let cx = 0; cx < gw; cx++) {
        const c = cy * gw + cx;
        if (valid[c]) continue;
        let s = 0, k = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = cx + dx, yy = cy + dy;
            if (xx < 0 || yy < 0 || xx >= gw || yy >= gh) continue;
            const j = yy * gw + xx;
            if (valid[j]) {
              s += ratio[j];
              k++;
            }
          }
        }
        if (k > 0) {
          nr[c] = s / k;
          nv[c] = 1;
          changed = true;
        }
      }
    }
    ratio = nr;
    valid = nv;
    if (!changed) break;
  }
  // 3×3 smoothing.
  const smooth = new Float64Array(gw * gh);
  for (let cy = 0; cy < gh; cy++) {
    for (let cx = 0; cx < gw; cx++) {
      let s = 0, k = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = cx + dx, yy = cy + dy;
          if (xx < 0 || yy < 0 || xx >= gw || yy >= gh) continue;
          s += ratio[yy * gw + xx];
          k++;
        }
      }
      smooth[cy * gw + cx] = s / k;
    }
  }
  // Bilinear interpolation between cell centres.
  const shade = new Float32Array(n);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(gh - 1, Math.max(0, (y + 0.5) / cell - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(gh - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(gw - 1, Math.max(0, (x + 0.5) / cell - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(gw - 1, x0 + 1);
      const tx = fx - x0;
      const top = smooth[y0 * gw + x0] * (1 - tx) + smooth[y0 * gw + x1] * tx;
      const bot = smooth[y1 * gw + x0] * (1 - tx) + smooth[y1 * gw + x1] * tx;
      shade[y * w + x] = top * (1 - ty) + bot * ty;
    }
  }
  return { colour, shade };
}

/** Internal analysis result with the intermediate data the builder needs. */
interface UploadWork {
  analysis: UploadAnalysis;
  crop: Rect;
  src: RGBAImage;
  bg: [number, number, number] | null;
  threshold: number;
}

function analyze(img: RGBAImage, settings: UploadSettings): UploadWork {
  assertImage(img);
  const crop = resolveCrop(settings.crop, img);
  const src = cropImage(img, crop);
  const w = src.width;
  const h = src.height;
  const n = w * h;
  const d = src.data;
  const threshold = toleranceToThreshold(settings.tolerance);
  const longest = Math.max(w, h);

  let mask: Uint8Array;
  let usedTransparency = false;
  let bgColour: [number, number, number] | null = null;
  let borderUniformity = 1;

  if (settings.mode === "whole") {
    mask = new Uint8Array(n).fill(1);
  } else {
    let translucent = 0;
    for (let i = 0; i < n; i++) if (d[i * 4 + 3] < 250) translucent++;
    let raw: Uint8Array;
    if (settings.mode === "auto" && translucent > n * TRANSPARENT_SHARE) {
      usedTransparency = true;
      raw = new Uint8Array(n);
      for (let i = 0; i < n; i++) raw[i] = d[i * 4 + 3] > TRANSPARENT_ALPHA ? 1 : 0;
    } else {
      // Colour-based: flatten over white, compare to the lit background.
      const rgb = new Uint8Array(n * 3);
      for (let i = 0; i < n; i++) {
        const a = d[i * 4 + 3];
        rgb[i * 3] = overWhite(d[i * 4], a);
        rgb[i * 3 + 1] = overWhite(d[i * 4 + 1], a);
        rgb[i * 3 + 2] = overWhite(d[i * 4 + 2], a);
      }
      const bg = estimateBackground(rgb, w, h);
      bgColour = bg.colour;
      // Distance is RMS per channel: sqrt((dr²+dg²+db²)/3).
      const strong2 = threshold * threshold * 3;
      const weak2 = strong2 * 0.36; // weak threshold = 0.6 × threshold
      const strong = new Uint8Array(n);
      const weak = new Uint8Array(n);
      const ring = Math.max(1, Math.round(Math.min(w, h) * 0.02));
      let ringBg = 0;
      let ringN = 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          const s = bg.shade[i];
          const dr = rgb[i * 3] - bg.colour[0] * s;
          const dg = rgb[i * 3 + 1] - bg.colour[1] * s;
          const db = rgb[i * 3 + 2] - bg.colour[2] * s;
          const dist2 = dr * dr + dg * dg + db * db;
          strong[i] = dist2 > strong2 ? 1 : 0;
          weak[i] = dist2 > weak2 ? 1 : 0;
          if (x < ring || y < ring || x >= w - ring || y >= h - ring) {
            ringN++;
            if (!strong[i]) ringBg++;
          }
        }
      }
      borderUniformity = ringN > 0 ? ringBg / ringN : 1;
      raw = hysteresis(strong, weak, w, h);
    }
    mask = cleanSilhouette(raw, w, h, {
      closeRadius: closeRadiusFor(longest),
      // "colour" removes background everywhere, so holes stay open.
      fill: settings.mode !== "colour",
      joinRadius: Math.max(2, Math.round(longest * 0.01)),
      minAbsoluteArea: SPECK_ABSOLUTE * Math.max(1, (longest / MAX_WORK_SIZE) ** 2),
    });
  }

  applyPaint(mask, w, h, settings.paint);

  const { confidence, issues } =
    settings.mode === "whole"
      ? { confidence: 1, issues: [] as UploadIssue[] }
      : assess(mask, w, h, borderUniformity);

  return {
    analysis: {
      mask,
      width: w,
      height: h,
      usedTransparency,
      background: bgColour ? toHex(bgColour[0], bgColour[1], bgColour[2]) : null,
      confidence,
      issues,
    },
    crop,
    src,
    bg: bgColour,
    threshold,
  };
}

/**
 * Applies manual corrections in place: `keep` forces 1, then `remove` forces
 * 0 (remove wins where both are painted). Paint masks of a different size
 * are mapped by nearest neighbour.
 */
function applyPaint(mask: Uint8Array, w: number, h: number, paint: UploadSettings["paint"]): void {
  if (!paint || !(paint.width > 0 && paint.height > 0)) return;
  const pw = paint.width;
  const ph = paint.height;
  const apply = (layer: Uint8Array | null, value: 0 | 1) => {
    if (!layer || layer.length < pw * ph) return;
    for (let y = 0; y < h; y++) {
      const py = pw === w && ph === h ? y : Math.min(ph - 1, Math.floor(((y + 0.5) * ph) / h));
      for (let x = 0; x < w; x++) {
        const px = pw === w && ph === h ? x : Math.min(pw - 1, Math.floor(((x + 0.5) * pw) / w));
        if (layer[py * pw + px]) mask[y * w + x] = value;
      }
    }
  };
  apply(paint.keep, 1);
  apply(paint.remove, 0);
}

/**
 * Confidence that the automatic cut-out is right, from: how uniform the
 * border looks (background), how much is kept (ideal 3–70 %), how many
 * sizeable pieces there are, and how much of the crop edge is foreground.
 * The four factors (each 0..1) are multiplied.
 */
function assess(
  mask: Uint8Array,
  w: number,
  h: number,
  borderUniformity: number,
): { confidence: number; issues: UploadIssue[] } {
  const n = w * h;
  const fg = countSet(mask) / n;

  const cc = connectedComponents(mask, w, h);
  let largest = 0;
  for (let l = 1; l <= cc.count; l++) largest = Math.max(largest, cc.areas[l]);
  let pieces = 0;
  for (let l = 1; l <= cc.count; l++) {
    if (cc.areas[l] >= Math.max(largest * 0.02, n * 0.001)) pieces++;
  }

  let edgeFg = 0;
  let edgeN = 0;
  for (let x = 0; x < w; x++) {
    edgeFg += mask[x] + mask[(h - 1) * w + x];
    edgeN += 2;
  }
  for (let y = 1; y < h - 1; y++) {
    edgeFg += mask[y * w] + mask[y * w + w - 1];
    edgeN += 2;
  }
  const touch = edgeN > 0 ? edgeFg / edgeN : 0;

  const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
  const smoothstep = (a: number, b: number, v: number) => {
    const t = clamp01((v - a) / (b - a));
    return t * t * (3 - 2 * t);
  };
  const fBorder = smoothstep(0.5, 0.95, borderUniformity);
  const fFg = fg < 0.03 ? clamp01((fg - 0.002) / 0.028) : fg > 0.7 ? clamp01((0.98 - fg) / 0.28) : 1;
  const fPieces = pieces <= 3 ? 1 : Math.max(0.2, 3 / pieces);
  const fEdge = 1 - 0.7 * clamp01((touch - 0.05) / 0.4);
  const confidence = clamp01(fBorder * fFg * fPieces * fEdge);

  const issues: UploadIssue[] = [];
  if (borderUniformity < 0.7) issues.push("busy-background");
  if (fg < 0.01) issues.push("too-little-foreground");
  if (fg > 0.8) issues.push("too-much-foreground");
  if (pieces > 4) issues.push("many-pieces");
  if (touch > 0.15) issues.push("touches-edges");
  return { confidence: Math.round(confidence * 1000) / 1000, issues };
}

/** Works out which part of an uploaded picture to keep. */
export function analyzeUpload(img: RGBAImage, settings: UploadSettings): UploadAnalysis {
  return analyze(img, settings).analysis;
}

/**
 * Uploaded picture → analysis + paper cut-out. `result` is null when nothing
 * is kept. The cut-out uses the picture's own pixels inside the silhouette
 * (enclosed paper areas keep their photographed colour); background becomes
 * transparent behind a white paper border and cut line.
 */
export function processUpload(
  img: RGBAImage,
  settings: UploadSettings,
): { analysis: UploadAnalysis; result: CutoutResult | null } {
  const work = analyze(img, settings);
  const { analysis, src, crop } = work;
  const w = analysis.width;
  const bounds = maskBounds(analysis.mask, w, analysis.height);
  if (!bounds) return { analysis, result: null };

  const scale = Math.min(1, MAX_WORK_SIZE / Math.max(bounds.w, bounds.h));
  const ww = Math.max(1, Math.round(bounds.w * scale));
  const wh = Math.max(1, Math.round(bounds.h * scale));
  const pixels = scale === 1 ? cropImage(src, bounds) : resampleArea(src, bounds, ww, wh);
  let sil =
    scale === 1
      ? cropMask(analysis.mask, w, bounds)
      : resampleMaskArea(analysis.mask, w, bounds, ww, wh);
  if (countSet(sil) === 0) {
    // A sliver that vanished when scaled down: keep the kept area as a box.
    sil = new Uint8Array(ww * wh).fill(1);
  }
  const geo = cutoutGeometry(Math.max(ww, wh));
  const padded = padImage(pixels, geo.pad);
  const paddedSil = padMask(sil, ww, wh, geo.pad);

  const { cutout, meta, box } = buildCutout({
    src: padded,
    sil: paddedSil,
    border: geo.border,
    outline: geo.outline,
    keepOutside: analysis.usedTransparency,
    ignoreColour: work.bg,
    ignoreDistance: work.threshold,
  });
  return {
    analysis,
    result: {
      cutout,
      meta,
      inkBounds: { x: crop.x + bounds.x, y: crop.y + bounds.y, w: bounds.w, h: bounds.h },
      scale,
      offset: [geo.pad - box.x, geo.pad - box.y],
    },
  };
}
