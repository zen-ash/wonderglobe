// Binary-mask morphology on typed arrays.
//
// Masks are `Uint8Array`s with one byte per pixel (1 = set, 0 = clear),
// row-major. Dilation / erosion use an exact Euclidean distance transform
// (Felzenszwalb & Huttenlocher), so they are round (disc-shaped), O(n)
// regardless of radius and support fractional radii.

import type { Rect } from "./raster";

const INF = 1e20;

/** 1-D squared distance transform of sampled function `f` (length n) into `d`. */
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    const fq = f[q] + q * q;
    let s = (fq - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (fq - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dq = q - v[k];
    d[q] = dq * dq + f[v[k]];
  }
}

/**
 * Squared Euclidean distance from every pixel centre to the nearest pixel
 * where `set(i)` is true (0 on such pixels). Pixels outside the image are
 * ignored. If nothing is set, every value is ~1e20.
 */
function squaredDistance(w: number, h: number, isSet: (i: number) => boolean): Float32Array {
  const out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = isSet(i) ? 0 : INF;
  const n = Math.max(w, h);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  // Columns.
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = out[y * w + x];
    edt1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) out[y * w + x] = d[y];
  }
  // Rows.
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) f[x] = out[row + x];
    edt1d(f, w, d, v, z);
    for (let x = 0; x < w; x++) out[row + x] = d[x];
  }
  return out;
}

/** Squared distance from each pixel to the nearest set pixel of `mask`. */
export function squaredDistanceToSet(mask: Uint8Array, w: number, h: number): Float32Array {
  return squaredDistance(w, h, (i) => mask[i] !== 0);
}

/** Squared distance from each pixel to the nearest clear pixel of `mask`. */
export function squaredDistanceToClear(mask: Uint8Array, w: number, h: number): Float32Array {
  return squaredDistance(w, h, (i) => mask[i] === 0);
}

/** Disc dilation: set every pixel within `r` (Euclidean) of a set pixel. */
export function dilate(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const d2 = squaredDistanceToSet(mask, w, h);
  const r2 = r * r;
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = d2[i] <= r2 ? 1 : 0;
  return out;
}

/**
 * Disc erosion: keep pixels farther than `r` from any clear pixel. The area
 * outside the image does not count as clear, so shapes touching the image
 * edge are not eaten from that side.
 */
export function erode(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const d2 = squaredDistanceToClear(mask, w, h);
  const r2 = r * r;
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = mask[i] && d2[i] > r2 ? 1 : 0;
  return out;
}

/** Morphological closing (dilate then erode): bridges gaps up to ~2r wide. */
export function close(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return mask.slice();
  const closed = erode(dilate(mask, w, h, r), w, h, r);
  // Closing is extensive in theory; OR with the input guards against any
  // discretisation corner case so no drawn pixel is ever lost.
  for (let i = 0; i < closed.length; i++) closed[i] |= mask[i];
  return closed;
}

/**
 * Flood-fills (4-connected) through pixels where `open[i]` is non-zero,
 * starting from every open pixel on the image border. Returns 1 for reached.
 */
export function floodFromBorder(open: Uint8Array, w: number, h: number): Uint8Array {
  const reached = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let sp = 0;
  const seed = (i: number) => {
    if (open[i] && !reached[i]) {
      reached[i] = 1;
      stack[sp++] = i;
    }
  };
  for (let x = 0; x < w; x++) {
    seed(x);
    seed((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    seed(y * w);
    seed(y * w + w - 1);
  }
  while (sp > 0) {
    const i = stack[--sp];
    const x = i % w;
    if (x > 0) seed(i - 1);
    if (x < w - 1) seed(i + 1);
    if (i >= w) seed(i - w);
    if (i < w * (h - 1)) seed(i + w);
  }
  return reached;
}

/**
 * Fills every enclosed hole: clear pixels that cannot be reached from the
 * image border (4-connected) become set.
 */
export function fillHoles(mask: Uint8Array, w: number, h: number): Uint8Array {
  const open = new Uint8Array(w * h);
  for (let i = 0; i < open.length; i++) open[i] = mask[i] ? 0 : 1;
  const outside = floodFromBorder(open, w, h);
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = outside[i] ? 0 : 1;
  return out;
}

/**
 * Keeps the `weak` pixels that are 8-connected to at least one `strong`
 * pixel (hysteresis thresholding). `strong` must be a subset of `weak`.
 */
export function hysteresis(strong: Uint8Array, weak: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let sp = 0;
  for (let i = 0; i < out.length; i++) {
    if (strong[i]) {
      out[i] = 1;
      stack[sp++] = i;
    }
  }
  while (sp > 0) {
    const i = stack[--sp];
    const x = i % w;
    const y = (i - x) / w;
    for (let dy = -1; dy <= 1; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= h) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx;
        if (xx < 0 || xx >= w) continue;
        const j = yy * w + xx;
        if (weak[j] && !out[j]) {
          out[j] = 1;
          stack[sp++] = j;
        }
      }
    }
  }
  return out;
}

export interface Components {
  /** Per-pixel label: 0 = background, 1..count = component. */
  labels: Int32Array;
  count: number;
  /** areas[label] = number of pixels (index 0 unused). */
  areas: number[];
  /** boxes[label] = bounding box (index 0 unused). */
  boxes: Rect[];
  /** firstIndex[label] = first pixel in raster order (top-most, then left-most). */
  firstIndex: number[];
}

/** 8-connected component labelling, in raster order of first pixel. */
export function connectedComponents(mask: Uint8Array, w: number, h: number): Components {
  const labels = new Int32Array(w * h);
  const areas = [0];
  const boxes: Rect[] = [{ x: 0, y: 0, w: 0, h: 0 }];
  const firstIndex = [-1];
  const stack = new Int32Array(w * h);
  let count = 0;
  for (let start = 0; start < labels.length; start++) {
    if (!mask[start] || labels[start]) continue;
    const label = ++count;
    let area = 0;
    let minX = w, minY = h, maxX = -1, maxY = -1;
    let sp = 0;
    labels[start] = label;
    stack[sp++] = start;
    while (sp > 0) {
      const i = stack[--sp];
      const x = i % w;
      const y = (i - x) / w;
      area++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const j = yy * w + xx;
          if (mask[j] && !labels[j]) {
            labels[j] = label;
            stack[sp++] = j;
          }
        }
      }
    }
    areas.push(area);
    boxes.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 });
    firstIndex.push(start);
  }
  return { labels, count, areas, boxes, firstIndex };
}

export interface SpeckOptions {
  /** Pieces closer than ~2×joinRadius count as one piece (they share paper). */
  joinRadius: number;
  /** Drop a piece only if its area is below this fraction of the largest piece… */
  minRelativeArea: number;
  /** …and also below this absolute pixel count. */
  minAbsoluteArea: number;
}

/**
 * Removes isolated accidental specks while keeping deliberate small pieces.
 *
 * Pieces are grouped by connectivity of the mask dilated by `joinRadius`
 * (i.e. marks that would end up on the same piece of paper belong together)
 * and a group's size is the number of *original* set pixels inside it. A
 * group is dropped only if it is tiny both relative to the largest group and
 * in absolute terms.
 */
export function removeSpecks(mask: Uint8Array, w: number, h: number, opts: SpeckOptions): Uint8Array {
  const joined = opts.joinRadius > 0 ? dilate(mask, w, h, opts.joinRadius) : mask;
  const cc = connectedComponents(joined, w, h);
  if (cc.count <= 1) return mask.slice();
  const inkArea = new Float64Array(cc.count + 1);
  for (let i = 0; i < mask.length; i++) if (mask[i]) inkArea[cc.labels[i]]++;
  let largest = 0;
  for (let l = 1; l <= cc.count; l++) largest = Math.max(largest, inkArea[l]);
  const keep = new Uint8Array(cc.count + 1);
  for (let l = 1; l <= cc.count; l++) {
    const a = inkArea[l];
    const speck = a < largest * opts.minRelativeArea && a < opts.minAbsoluteArea;
    keep[l] = speck ? 0 : 1;
  }
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = mask[i] && keep[cc.labels[i]] ? 1 : 0;
  return out;
}

/** Bounding box of the set pixels, or null when the mask is empty. */
export function maskBounds(mask: Uint8Array, w: number, h: number): Rect | null {
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (!mask[row + x]) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      maxY = y;
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

export function countSet(mask: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) n++;
  return n;
}
