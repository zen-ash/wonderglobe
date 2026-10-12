// A tiny illustration kit used by the scenery atlas, characters and sky
// art. Drawers work in a 100x100 unit box (x right, y down); the ground line
// is at y = 93 so art sits bottom-aligned with room for the paper border.

import {
  INK,
  applyPaperCutout,
  blobPts,
  crayonGrain,
  ctx2d,
  makeCanvas,
  crayonFill,
  crayonStroke,
  ellipsePts,
  rectPts,
  shade,
  tracePath,
  wobble,
  type FillOpts,
  type Pt,
} from "./crayon";
import { createRng, type Rng } from "./rng";

/** Shared crayon palette. */
export const C = {
  ink: INK,
  grass: "#7cc35b",
  leaf: "#5aa84c",
  leafDark: "#3f8a45",
  pine: "#3f8a5a",
  olive: "#a9cc55",
  trunk: "#a36b40",
  wood: "#cf9459",
  woodDark: "#8c5b37",
  red: "#e5543e",
  tomato: "#f06a4c",
  pink: "#f7a6c3",
  rose: "#ee6f96",
  blossom: "#fac4d6",
  yellow: "#f9cf46",
  gold: "#efb43a",
  orange: "#f39338",
  cream: "#f6e6c2",
  white: "#fbf8ef",
  blue: "#5aa3e2",
  sky: "#a8dcf0",
  navy: "#40609f",
  purple: "#9b7bd2",
  teal: "#4fb5aa",
  grey: "#aaa59c",
  greyDark: "#7e786f",
  stone: "#bfb7a8",
  skin: "#f4c69e",
  brown: "#7a5236",
  hay: "#ebc35b",
  snow: "#f8fbff",
  ice: "#cde5f2",
  mountain: "#8e9cc0",
  brick: "#c95a40",
} as const;

export class Kit {
  readonly G = 93;
  /** Default part outline width (units). */
  lw = 1.9;
  constructor(
    readonly ctx: CanvasRenderingContext2D,
    readonly rng: Rng,
  ) {}

  poly(pts: Pt[], j = 0.55, step = 7): Pt[] {
    return wobble(pts, this.rng, j, step, true);
  }
  rect(x: number, y: number, w: number, h: number, j = 0.45): Pt[] {
    return this.poly(rectPts(x, y, w, h), j);
  }
  blob(cx: number, cy: number, rx: number, ry = rx, wob = 0.06, n = 22): Pt[] {
    return blobPts(cx, cy, rx, ry, this.rng, wob, n);
  }
  ell(cx: number, cy: number, rx: number, ry = rx, rot = 0): Pt[] {
    return wobble(ellipsePts(cx, cy, rx, ry, 18, rot), this.rng, Math.min(rx, ry) * 0.04, 100, true);
  }

  /** Crayon-filled shape with dark outline. */
  shape(
    pts: Pt[],
    color: string,
    o: { outline?: string | null; w?: number; smooth?: boolean; fill?: Partial<FillOpts> } = {},
  ): Pt[] {
    crayonFill(this.ctx, pts, {
      color,
      rng: this.rng,
      spacing: 2.4,
      lineWidth: 1.25,
      smooth: o.smooth,
      ...o.fill,
    });
    if (o.outline !== null) {
      crayonStroke(this.ctx, pts, {
        color: o.outline ?? INK,
        width: o.w ?? this.lw,
        rng: this.rng,
        closed: true,
        smooth: o.smooth,
      });
    }
    return pts;
  }

  /** Only the outline of a shape. */
  outline(pts: Pt[], w = this.lw, color: string = INK, smooth = true): void {
    crayonStroke(this.ctx, pts, { color, width: w, rng: this.rng, closed: true, smooth });
  }

  /** Open crayon line. */
  line(pts: Pt[], color: string = INK, w = this.lw, passes = 2): void {
    crayonStroke(this.ctx, wobble(pts, this.rng, w * 0.15, 6, false), { color, width: w, rng: this.rng, passes });
  }

  /** Thick coloured line with a dark outline (stems, poles, legs). */
  tube(pts: Pt[], color: string, w: number): void {
    const p = wobble(pts, this.rng, 0.3, 6, false);
    crayonStroke(this.ctx, p, { color: INK, width: w + this.lw * 1.5, rng: this.rng, passes: 1, jitter: 0.05 });
    crayonStroke(this.ctx, p, { color, width: w, rng: this.rng, passes: 1, jitter: 0.05 });
    crayonStroke(this.ctx, p, { color: shade(color, 0.25), width: w * 0.3, rng: this.rng, passes: 1, alpha: 0.5, jitter: w * 0.15 });
  }

  /** Plain filled dot, no outline. */
  dot(cx: number, cy: number, r: number, color: string, alpha = 1): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    tracePath(ctx, this.ell(cx, cy, r, r), true);
    ctx.fill();
    ctx.restore();
  }

  /** Outlined round thing. */
  circle(cx: number, cy: number, r: number, color: string, w = this.lw): Pt[] {
    return this.shape(this.blob(cx, cy, r, r, 0.04, 16), color, { w });
  }

  /** Several overlapping blobs sharing one outer outline (clouds, fluff). */
  union(blobs: Pt[][], color: string, o: { w?: number; fill?: Partial<FillOpts> } = {}): void {
    const w = o.w ?? this.lw;
    for (const b of blobs) crayonStroke(this.ctx, b, { color: INK, width: w * 2, rng: this.rng, closed: true, passes: 1 });
    const angle = this.rng.range(-0.9, -0.5);
    for (const b of blobs)
      crayonFill(this.ctx, b, { color, rng: this.rng, spacing: 2.4, lineWidth: 1.25, angle, ...o.fill });
  }

  /** Run fn with drawing clipped to pts. */
  clip(pts: Pt[], fn: () => void, smooth = true): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    tracePath(ctx, pts, true, smooth);
    ctx.clip();
    fn();
    ctx.restore();
  }

  /** Small highlight streak (lighter crayon). */
  shine(pts: Pt[], color = "#ffffff", w = 1.6, alpha = 0.6): void {
    crayonStroke(this.ctx, pts, { color, width: w, rng: this.rng, passes: 1, alpha });
  }
}

/** Leaf / blade polygon growing from (x, y) at angle `ang` (radians, canvas space). */
export function leafPts(x: number, y: number, ang: number, len: number, wid: number, droop = 0.12, tipPow = 0.8): Pt[] {
  const dx = Math.cos(ang);
  const dy = Math.sin(ang);
  const nx = -dy;
  const ny = dx;
  const left: Pt[] = [];
  const right: Pt[] = [];
  const N = 10;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const cx = x + dx * len * t;
    const cy = y + dy * len * t + droop * len * t * t;
    const hw = wid * 0.5 * Math.sin(Math.PI * Math.pow(t, tipPow));
    left.push([cx + nx * hw, cy + ny * hw]);
    right.push([cx - nx * hw, cy - ny * hw]);
  }
  right.reverse();
  return [...left, ...right.slice(1, -1)];
}

/** Quadratic Bezier sampled into points. */
export function bezierPts(a: Pt, c: Pt, b: Pt, n = 10): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]);
  }
  return out;
}

/** Thick polygon around a centre line with varying width. */
export function ribbonPts(center: Pt[], widthAt: (t: number) => number): Pt[] {
  const left: Pt[] = [];
  const right: Pt[] = [];
  const n = center.length;
  for (let i = 0; i < n; i++) {
    const a = center[Math.max(0, i - 1)];
    const b = center[Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0];
    let ty = b[1] - a[1];
    const l = Math.hypot(tx, ty) || 1;
    tx /= l;
    ty /= l;
    const w = widthAt(i / (n - 1)) / 2;
    left.push([center[i][0] - ty * w, center[i][1] + tx * w]);
    right.push([center[i][0] + ty * w, center[i][1] - tx * w]);
  }
  return [...left, ...right.reverse()];
}

/**
 * Draw with a Kit into a fresh transparent canvas (100 units = `size` px
 * horizontally), add crayon grain, then turn it into a paper cut-out.
 */
export function renderKitArt(
  width: number,
  height: number,
  seed: number,
  draw: (k: Kit) => void,
  o: { outline?: number; border?: number; grain?: number; units?: number } = {},
): HTMLCanvasElement {
  const canvas = makeCanvas(width, height);
  const ctx = ctx2d(canvas, true);
  const rng = createRng(seed);
  const s = width / (o.units ?? 100);
  ctx.setTransform(s, 0, 0, s, 0, 0);
  draw(new Kit(ctx, rng));
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  crayonGrain(ctx, width, height, rng, o.grain ?? 0.45);
  applyPaperCutout(canvas, {
    outline: o.outline ?? Math.max(1.5, width * 0.016),
    border: o.border ?? Math.max(2.5, width * 0.03),
    seed,
  });
  return canvas;
}
