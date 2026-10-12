// Hand-drawn crayon drawing helpers for CanvasRenderingContext2D.
// Every function that adds randomness takes a seeded Rng so the output is
// identical on every visit.

import { createRng, type Rng } from "./rng";

export type Pt = [number, number];

/** Dark warm "ink" used for thick outlines. */
export const INK = "#2b2320";
/** Warm white of the paper border. */
export const PAPER = "#fffcf3";

// ---------------------------------------------------------------------------
// Canvas & colour utilities
// ---------------------------------------------------------------------------

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export function ctx2d(c: HTMLCanvasElement, readback = false): CanvasRenderingContext2D {
  const ctx = c.getContext("2d", readback ? { willReadFrequently: true } : undefined);
  if (!ctx) throw new Error("2D canvas context unavailable");
  return ctx;
}

export function parseHex(hex: string): [number, number, number] {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function toHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Linear mix of two hex colours. */
export function mix(a: string, b: string, t: number): string {
  const A = parseHex(a);
  const B = parseHex(b);
  return toHex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
}

/** amt > 0 lightens towards cream-white, amt < 0 darkens towards warm ink. */
export function shade(hex: string, amt: number): string {
  return amt >= 0 ? mix(hex, "#fffaf0", amt) : mix(hex, "#2b1d18", -amt);
}

export function rgba(hex: string, a: number): string {
  const [r, g, b] = parseHex(hex);
  return `rgba(${r},${g},${b},${a})`;
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

export function lerpPt(a: Pt, b: Pt, t: number): Pt {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Insert extra points so no segment is longer than `step`. */
export function subdivide(pts: Pt[], step: number, closed: boolean): Pt[] {
  const out: Pt[] = [];
  const n = pts.length;
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const k = Math.max(1, Math.ceil(len / step));
    for (let j = 0; j < k; j++) out.push(lerpPt(a, b, j / k));
  }
  if (!closed) out.push(pts[n - 1]);
  return out;
}

/** Hand-drawn jitter: subdivide then nudge every point a little. */
export function wobble(pts: Pt[], rng: Rng, amount: number, step = 6, closed = true): Pt[] {
  return subdivide(pts, step, closed).map(([x, y]) => [x + rng.range(-amount, amount), y + rng.range(-amount, amount)] as Pt);
}

export function ellipsePts(cx: number, cy: number, rx: number, ry: number, n = 20, rot = 0): Pt[] {
  const out: Pt[] = [];
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x = Math.cos(a) * rx;
    const y = Math.sin(a) * ry;
    out.push([cx + x * c - y * s, cy + x * s + y * c]);
  }
  return out;
}

/** A soft, lumpy ellipse (low-frequency radius variation). */
export function blobPts(cx: number, cy: number, rx: number, ry: number, rng: Rng, wob = 0.07, n = 22): Pt[] {
  const p1 = rng.range(0, Math.PI * 2);
  const p2 = rng.range(0, Math.PI * 2);
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = 1 + wob * (0.6 * Math.sin(2 * a + p1) + 0.4 * Math.sin(3 * a + p2)) + rng.range(-wob, wob) * 0.3;
    out.push([cx + Math.cos(a) * rx * r, cy + Math.sin(a) * ry * r]);
  }
  return out;
}

export function rectPts(x: number, y: number, w: number, h: number): Pt[] {
  return [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ];
}

export function bbox(pts: Pt[]): { x: number; y: number; w: number; h: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function centroid(pts: Pt[]): Pt {
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p[0];
    y += p[1];
  }
  return [x / pts.length, y / pts.length];
}

/** Add the path to ctx (no beginPath). Smooth = quadratic curves through midpoints. */
export function tracePath(ctx: CanvasRenderingContext2D, pts: Pt[], closed = true, smooth = true): void {
  const n = pts.length;
  if (n === 0) return;
  if (!smooth || n < 3) {
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < n; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    if (closed) ctx.closePath();
    return;
  }
  if (closed) {
    const m0 = lerpPt(pts[n - 1], pts[0], 0.5);
    ctx.moveTo(m0[0], m0[1]);
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      const m = lerpPt(p, pts[(i + 1) % n], 0.5);
      ctx.quadraticCurveTo(p[0], p[1], m[0], m[1]);
    }
    ctx.closePath();
  } else {
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < n - 1; i++) {
      const m = lerpPt(pts[i], pts[i + 1], 0.5);
      ctx.quadraticCurveTo(pts[i][0], pts[i][1], m[0], m[1]);
    }
    ctx.lineTo(pts[n - 1][0], pts[n - 1][1]);
  }
}

// ---------------------------------------------------------------------------
// Crayon strokes & fills
// ---------------------------------------------------------------------------

export interface StrokeOpts {
  color: string;
  width: number;
  rng: Rng;
  closed?: boolean;
  /** Number of passes; the first is solid, the rest thinner, dashed and offset. */
  passes?: number;
  alpha?: number;
  /** Offset jitter between passes (defaults to width * 0.18). */
  jitter?: number;
  smooth?: boolean;
}

/** Crayon line: several slightly offset semi-transparent passes with grain gaps. */
export function crayonStroke(ctx: CanvasRenderingContext2D, pts: Pt[], o: StrokeOpts): void {
  const passes = o.passes ?? 2;
  const alpha = o.alpha ?? 1;
  const j = o.jitter ?? o.width * 0.18;
  const closed = o.closed ?? false;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = o.color;
  for (let p = 0; p < passes; p++) {
    const ox = o.rng.range(-j, j);
    const oy = o.rng.range(-j, j);
    const pp = pts.map(([x, y]) => [x + ox + o.rng.range(-j, j) * 0.4, y + oy + o.rng.range(-j, j) * 0.4] as Pt);
    if (p === 0) {
      ctx.globalAlpha = alpha;
      ctx.lineWidth = o.width;
      ctx.setLineDash([]);
    } else {
      ctx.globalAlpha = alpha * 0.55;
      ctx.lineWidth = o.width * o.rng.range(0.5, 0.8);
      ctx.setLineDash([o.width * o.rng.range(3, 7), o.width * o.rng.range(0.4, 1.0)]);
      ctx.lineDashOffset = o.rng.range(0, 10) * o.width;
    }
    ctx.beginPath();
    tracePath(ctx, pp, closed, o.smooth ?? true);
    ctx.stroke();
  }
  ctx.restore();
}

/** Zig-zag hatching lines covering a box (call while clipped). */
function zigzag(
  ctx: CanvasRenderingContext2D,
  box: { x: number; y: number; w: number; h: number },
  angle: number,
  spacing: number,
  width: number,
  color: string,
  alpha: number,
  rng: Rng,
  jitter = 0.25,
  /** Optional fade: colour goes from transparent at (x0,y0) to opaque at (x1,y1). */
  fade?: [number, number, number, number],
): void {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const L = Math.hypot(box.w, box.h) / 2 + spacing * 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  if (fade) {
    // Express the fade endpoints in the rotated frame.
    const c = Math.cos(-angle);
    const s = Math.sin(-angle);
    const tx = (x: number, y: number): Pt => [(x - cx) * c - (y - cy) * s, (x - cx) * s + (y - cy) * c];
    const a = tx(fade[0], fade[1]);
    const b = tx(fade[2], fade[3]);
    const g = ctx.createLinearGradient(a[0], a[1], b[0], b[1]);
    g.addColorStop(0, rgba(color, 0));
    g.addColorStop(1, rgba(color, 1));
    ctx.strokeStyle = g;
  } else {
    ctx.strokeStyle = color;
  }
  ctx.globalAlpha = alpha;
  ctx.lineWidth = width;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  let left = true;
  ctx.moveTo(-L, -L);
  for (let y = -L; y <= L; y += spacing * 0.5) {
    const x = (left ? L : -L) + rng.range(-spacing, spacing);
    ctx.lineTo(x, y + rng.range(-spacing, spacing) * jitter);
    left = !left;
  }
  ctx.stroke();
  ctx.restore();
}

export interface FillOpts {
  color: string;
  rng: Rng;
  /** Base tint opacity (0 = hatch only). Default 1. */
  base?: number;
  /** Darker hatch colour (null = none). Defaults to a darker shade. */
  hatch?: string | null;
  /** Lighter hatch colour (null = none). Defaults to a lighter shade. */
  hatch2?: string | null;
  angle?: number;
  spacing?: number;
  lineWidth?: number;
  hatchAlpha?: number;
  smooth?: boolean;
  /** Optional extra darker scribble region [x, y, w, h] (e.g. the shady side). */
  shadeRegion?: [number, number, number, number];
  /** Colour of the shade scribble (defaults to a darker shade of the fill). */
  shadeColor?: string;
}

/** Crayon fill: base tint plus scribbled hatching, clipped to the shape. */
export function crayonFill(ctx: CanvasRenderingContext2D, pts: Pt[], o: FillOpts): void {
  const box = bbox(pts);
  const sp = o.spacing ?? Math.max(1.5, Math.min(box.w, box.h) * 0.06);
  const lw = o.lineWidth ?? sp * 0.55;
  const angle = o.angle ?? o.rng.range(-1.0, -0.5);
  const ha = o.hatchAlpha ?? 0.38;
  ctx.save();
  ctx.beginPath();
  tracePath(ctx, pts, true, o.smooth ?? true);
  ctx.clip();
  const base = o.base ?? 1;
  if (base > 0) {
    ctx.globalAlpha = base;
    ctx.fillStyle = o.color;
    ctx.fill();
  }
  const h1 = o.hatch === undefined ? shade(o.color, -0.16) : o.hatch;
  const h2 = o.hatch2 === undefined ? shade(o.color, 0.22) : o.hatch2;
  if (h1) zigzag(ctx, box, angle, sp, lw, h1, ha, o.rng);
  if (h2) zigzag(ctx, box, angle + 1.2, sp * 1.6, lw * 0.8, h2, ha * 0.8, o.rng);
  if (o.shadeRegion) {
    // Soft shading that fades in from the region's top-left corner (no hard edges).
    const [x, y, w, h] = o.shadeRegion;
    zigzag(ctx, box, angle + 0.3, sp * 0.8, lw, o.shadeColor ?? shade(o.color, -0.3), 0.5, o.rng, 0.25, [x, y, x + Math.min(w, h) * 0.5, y + h * 0.6]);
  }
  ctx.restore();
}

export interface ScribbleOpts {
  color: string;
  rng: Rng;
  width: number;
  spacing?: number;
  angle?: number;
  /** Scale of the clip region around the centroid (>1 lets the scribble go "outside the lines"). */
  overshoot?: number;
  alpha?: number;
}

/** Child-style scribble fill: back-and-forth crayon lines, no base tint. */
export function scribbleFill(ctx: CanvasRenderingContext2D, pts: Pt[], o: ScribbleOpts): void {
  const os = o.overshoot ?? 1.04;
  const [cx, cy] = centroid(pts);
  const clipPts = pts.map(([x, y]) => [cx + (x - cx) * os, cy + (y - cy) * os] as Pt);
  const box = bbox(clipPts);
  const sp = o.spacing ?? o.width * 0.8;
  ctx.save();
  ctx.beginPath();
  tracePath(ctx, clipPts, true, true);
  ctx.clip();
  zigzag(ctx, box, o.angle ?? o.rng.range(-0.9, -0.3), sp, o.width, o.color, o.alpha ?? 0.85, o.rng, 0.6);
  // A lighter second pass in another direction fills most of the gaps.
  zigzag(ctx, box, (o.angle ?? -0.6) + 1.4, sp * 2.2, o.width * 0.8, o.color, (o.alpha ?? 0.85) * 0.55, o.rng, 0.6);
  ctx.restore();
}

export interface ShapeOpts {
  fill: string;
  rng: Rng;
  outline?: string;
  width: number;
  fillOpts?: Partial<FillOpts>;
}

/** Crayon-filled shape with a thick dark wobbly outline. */
export function outlinedShape(ctx: CanvasRenderingContext2D, pts: Pt[], o: ShapeOpts): void {
  crayonFill(ctx, pts, { color: o.fill, rng: o.rng, ...o.fillOpts });
  crayonStroke(ctx, pts, { color: o.outline ?? INK, width: o.width, rng: o.rng, closed: true, smooth: o.fillOpts?.smooth });
}

/** Blobby circle/ellipse with crayon fill and dark outline. */
export function blobbyEllipse(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  o: ShapeOpts & { wob?: number },
): void {
  outlinedShape(ctx, blobPts(cx, cy, rx, ry, o.rng, o.wob ?? 0.06), o);
}

// ---------------------------------------------------------------------------
// Grain
// ---------------------------------------------------------------------------

function noiseTile(rng: Rng, size: number, kind: "paper" | "wax" | "holes"): HTMLCanvasElement {
  const c = makeCanvas(size, size);
  const ctx = ctx2d(c);
  ctx.lineCap = "round";
  const count = Math.round(size * size * (kind === "paper" ? 0.06 : 0.035));
  for (let i = 0; i < count; i++) {
    const x = rng.range(0, size);
    const y = rng.range(0, size);
    if (kind === "paper") {
      const dark = rng.chance(0.5);
      ctx.fillStyle = dark ? `rgba(90,62,35,${rng.range(0.03, 0.12)})` : `rgba(255,255,250,${rng.range(0.1, 0.35)})`;
      const s = rng.range(0.6, 1.8);
      // Wrap so the tile repeats seamlessly.
      for (const dx of [0, -size]) for (const dy of [0, -size]) ctx.fillRect(x + dx, y + dy, s, s);
    } else {
      const len = rng.range(1.5, 5);
      const a = rng.range(-0.5, 0.1);
      ctx.strokeStyle = kind === "wax" ? `rgba(255,253,245,${rng.range(0.2, 0.7)})` : `rgba(0,0,0,${rng.range(0.4, 1)})`;
      ctx.lineWidth = rng.range(0.6, 1.4);
      for (const dx of [0, -size, size])
        for (const dy of [0, -size, size]) {
          ctx.beginPath();
          ctx.moveTo(x + dx, y + dy);
          ctx.lineTo(x + dx + Math.cos(a) * len, y + dy + Math.sin(a) * len);
          ctx.stroke();
        }
    }
  }
  return c;
}

let waxTile: HTMLCanvasElement | null = null;
let holeTile: HTMLCanvasElement | null = null;

/** Light waxy crayon texture on top of already-drawn art (alpha unchanged). */
export function crayonGrain(ctx: CanvasRenderingContext2D, w: number, h: number, rng: Rng, amount = 0.5): void {
  waxTile ??= noiseTile(createRng(1234), 96, "wax");
  const pat = ctx.createPattern(waxTile, "repeat");
  if (!pat) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "source-atop";
  ctx.globalAlpha = amount;
  const ox = rng.range(0, 96);
  const oy = rng.range(0, 96);
  ctx.translate(-ox, -oy);
  ctx.fillStyle = pat;
  ctx.fillRect(0, 0, w + ox, h + oy);
  ctx.restore();
}

/** Knock tiny gaps out of crayon marks (for transparent child drawings). */
export function eraseGrain(ctx: CanvasRenderingContext2D, w: number, h: number, rng: Rng, amount = 0.5): void {
  holeTile ??= noiseTile(createRng(4321), 128, "holes");
  const pat = ctx.createPattern(holeTile, "repeat");
  if (!pat) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "destination-out";
  ctx.globalAlpha = amount;
  const ox = rng.range(0, 128);
  const oy = rng.range(0, 128);
  ctx.translate(-ox, -oy);
  ctx.fillStyle = pat;
  ctx.fillRect(0, 0, w + ox, h + oy);
  ctx.restore();
}

/** Light paper texture: speckles plus a few soft fibres. */
export function paperGrain(ctx: CanvasRenderingContext2D, w: number, h: number, rng: Rng, strength = 0.5): void {
  const tile = noiseTile(rng, 128, "paper");
  const pat = ctx.createPattern(tile, "repeat");
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (pat) {
    ctx.globalAlpha = Math.min(1, strength * 1.4);
    ctx.fillStyle = pat;
    ctx.fillRect(0, 0, w, h);
  }
  const fibres = Math.round(((w * h) / 4000) * strength);
  ctx.lineCap = "round";
  for (let i = 0; i < fibres; i++) {
    const x = rng.range(0, w);
    const y = rng.range(0, h);
    const a = rng.range(0, Math.PI * 2);
    const len = rng.range(4, 14);
    ctx.globalAlpha = rng.range(0.05, 0.14) * strength * 2;
    ctx.strokeStyle = rng.chance(0.5) ? "#8a6a48" : "#ffffff";
    ctx.lineWidth = rng.range(0.5, 1.1);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + Math.cos(a + 0.6) * len * 0.5, y + Math.sin(a + 0.6) * len * 0.5, x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.stroke();
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Paper cut-out: thick dark outline + white paper border around the art
// ---------------------------------------------------------------------------

/** Exact squared Euclidean distance transform (Felzenszwalb & Huttenlocher). */
export function distanceTransform(feature: Uint8Array, w: number, h: number): Float32Array {
  const INF = 1e20;
  const g = new Float32Array(w * h);
  for (let i = 0; i < g.length; i++) g[i] = feature[i] ? 0 : INF;
  const m = Math.max(w, h);
  const f = new Float64Array(m);
  const d = new Float64Array(m);
  const v = new Int32Array(m);
  const z = new Float64Array(m + 1);
  const pass = (n: number) => {
    let k = 0;
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;
    for (let q = 1; q < n; q++) {
      let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) {
        k--;
        s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) k++;
      d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
    }
  };
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = g[y * w + x];
    pass(h);
    for (let y = 0; y < h; y++) g[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) f[x] = g[row + x];
    pass(w);
    for (let x = 0; x < w; x++) g[row + x] = d[x];
  }
  return g;
}

/** Smooth value noise in [-1, 1]; returns a sampler f(x, y) for 0 <= x < w, 0 <= y < h. */
function valueNoise(w: number, h: number, cell: number, rng: Rng): (x: number, y: number) => number {
  const gw = Math.ceil(w / cell) + 2;
  const gh = Math.ceil(h / cell) + 2;
  const grid = new Float32Array(gw * gh);
  for (let i = 0; i < grid.length; i++) grid[i] = rng.range(-1, 1);
  const inv = 1 / cell;
  return (x, y) => {
    const gx = x * inv;
    const gy = y * inv;
    const ix = gx | 0;
    const iy = gy | 0;
    let tx = gx - ix;
    let ty = gy - iy;
    tx = tx * tx * (3 - 2 * tx);
    ty = ty * ty * (3 - 2 * ty);
    const k = iy * gw + ix;
    const a = grid[k];
    const b = grid[k + 1];
    const c = grid[k + gw];
    const d = grid[k + gw + 1];
    return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
  };
}

export interface CutoutOpts {
  /** Dark outline thickness in pixels. */
  outline: number;
  /** White paper border thickness (outside the outline) in pixels. */
  border: number;
  seed?: number;
  /** Scissor-cut irregularity of the paper edge in pixels. */
  roughness?: number;
  ink?: string;
  paper?: string;
  /** Slightly darker paper colour on the very edge (reads as paper thickness). */
  edge?: string;
  alphaThreshold?: number;
}

export interface PixelBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Turns transparent art into a paper cut-out in place: adds a thick dark
 * outline hugging the art and a white paper border around the silhouette.
 * Returns the bounding box of the visible result (exclusive x1/y1) or null.
 */
export function applyPaperCutout(canvas: HTMLCanvasElement, o: CutoutOpts): PixelBox | null {
  const cw = canvas.width;
  const ch = canvas.height;
  const ctx = ctx2d(canvas, true);
  const thr = o.alphaThreshold ?? 64;
  const R = o.outline + o.border;
  const rough = o.roughness ?? Math.max(0.6, o.border * 0.2);
  const img = ctx.getImageData(0, 0, cw, ch);
  const d = img.data;
  // 1. Bounding box of the art, so the heavy work only touches a window around it.
  let fx0 = cw;
  let fy0 = ch;
  let fx1 = -1;
  let fy1 = -1;
  for (let y = 0; y < ch; y++) {
    const row = y * cw;
    for (let x = 0; x < cw; x++) {
      if (d[(row + x) * 4 + 3] >= thr) {
        if (x < fx0) fx0 = x;
        if (x > fx1) fx1 = x;
        if (y < fy0) fy0 = y;
        if (y > fy1) fy1 = y;
      }
    }
  }
  if (fx1 < 0) return null;
  const pad = Math.ceil(R + rough + 2);
  const wx0 = Math.max(0, fx0 - pad);
  const wy0 = Math.max(0, fy0 - pad);
  const w = Math.min(cw, fx1 + pad + 1) - wx0;
  const h = Math.min(ch, fy1 + pad + 1) - wy0;
  const feat = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const src = (y + wy0) * cw + wx0;
    for (let x = 0; x < w; x++) if (d[(src + x) * 4 + 3] >= thr) feat[y * w + x] = 1;
  }
  // 2. Distance from every pixel to the nearest art pixel.
  const dist2 = distanceTransform(feat, w, h);
  const rng = createRng(o.seed ?? 7);
  const cell = Math.max(5, R * 1.6);
  const nA = valueNoise(w, h, cell, rng);
  const nB = valueNoise(w, h, cell * 0.8, rng);
  const ink = parseHex(o.ink ?? INK);
  const paper = parseHex(o.paper ?? PAPER);
  const edge = parseHex(o.edge ?? "#e6dccb");
  const maxD2 = (R + rough + 1) * (R + rough + 1);
  let x0 = cw;
  let y0 = ch;
  let x1 = -1;
  let y1 = -1;
  // 3. Paint the paper border + ink outline underneath the art.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const j = ((y + wy0) * cw + x + wx0) * 4;
      const artA = d[j + 3] / 255;
      const dd = dist2[i];
      if (artA <= 0 && dd > maxD2) continue;
      let outA = artA;
      if (dd > 0) {
        const dist = Math.sqrt(dd);
        const lim = R + nA(x, y) * rough;
        const baseA = Math.max(0, Math.min(1, lim + 0.5 - dist));
        if (baseA <= 0 && artA <= 0) continue;
        // Base colour: paper, slightly darker on the very edge, ink close to the art.
        const e = Math.max(0, Math.min(1, 1.6 - (lim - dist))) * 0.9;
        let br = paper[0] + (edge[0] - paper[0]) * e;
        let bg = paper[1] + (edge[1] - paper[1]) * e;
        let bb = paper[2] + (edge[2] - paper[2]) * e;
        const ow = o.outline * (1 + 0.28 * nB(x, y));
        const t = Math.max(0, Math.min(1, ow + 0.5 - dist));
        br += (ink[0] - br) * t;
        bg += (ink[1] - bg) * t;
        bb += (ink[2] - bb) * t;
        outA = artA + (1 - artA) * baseA;
        if (outA <= 0) continue;
        const wb = (1 - artA) * baseA;
        d[j] = (d[j] * artA + br * wb) / outA;
        d[j + 1] = (d[j + 1] * artA + bg * wb) / outA;
        d[j + 2] = (d[j + 2] * artA + bb * wb) / outA;
        d[j + 3] = outA * 255;
      } else if (artA < 1) {
        // Inside the art: semi-transparent crayon sits on white paper.
        d[j] = d[j] * artA + paper[0] * (1 - artA);
        d[j + 1] = d[j + 1] * artA + paper[1] * (1 - artA);
        d[j + 2] = d[j + 2] * artA + paper[2] * (1 - artA);
        d[j + 3] = 255;
        outA = 1;
      }
      if (outA > 0.02) {
        const gx = x + wx0;
        const gy = y + wy0;
        if (gx < x0) x0 = gx;
        if (gx > x1) x1 = gx;
        if (gy < y0) y0 = gy;
        if (gy > y1) y1 = gy;
      }
    }
  }
  ctx.putImageData(img, 0, 0, wx0, wy0, w, h);
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}
