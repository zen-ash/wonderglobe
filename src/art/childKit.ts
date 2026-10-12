// "Child's drawing" toolkit. Where Kit (kit.ts) draws neat illustrator art,
// ChildPen draws the way a 5–8 year old does: wobbly lines that drift and
// overshoot where they should close, uneven crayon/marker pressure,
// back-and-forth scribble colouring with visible stroke direction that goes
// over the lines and leaves bits of white paper, lopsided shapes.
//
// It works in the same 100-unit box as Kit (x right, y down, ground at
// y = 93). Every shape gets an opaque white paper underlay so gaps in the
// scribbles read as paper (and never as holes) once the art is turned into a
// paper cut-out by applyPaperCutout().

import { PAPER, bbox, centroid, ctx2d, applyPaperCutout, makeCanvas, mix, subdivide, tracePath, type PixelBox, type Pt } from "./crayon";
import { createRng, type Rng } from "./rng";

/** A child's crayon box: bright, slightly waxy, a little naive. */
export const CK = {
  black: "#2a2521",
  grey: "#9a948b",
  stone: "#b7b0a4",
  white: "#fffdf7",
  brown: "#8b5a2f",
  tan: "#c8935a",
  red: "#e2463a",
  orange: "#f5892a",
  yellow: "#f9d132",
  lemon: "#fde56c",
  green: "#4cae3f",
  lime: "#9bd24a",
  forest: "#2f8443",
  teal: "#27a597",
  sky: "#74c8f0",
  blue: "#3b80d9",
  navy: "#36509c",
  purple: "#8c58cb",
  lilac: "#b99de6",
  pink: "#f57fb5",
  rose: "#e45580",
  peach: "#f8bd8e",
  skin: "#f6c9a0",
} as const;

/** A darker crayon of the same colour (children often outline in the fill colour). */
export function dk(color: string, amt = 0.45): string {
  return mix(color, "#1e1410", amt);
}

/** Smooth 1D "hand drift" noise in roughly [-1, 1]. */
export function drift(rng: Rng): (t: number) => number {
  const p1 = rng.range(0, 6.283);
  const p2 = rng.range(0, 6.283);
  const p3 = rng.range(0, 6.283);
  const f1 = rng.range(0.8, 1.2);
  const f2 = rng.range(2.0, 2.7);
  const f3 = rng.range(4.4, 5.6);
  return (t) => 0.58 * Math.sin(t * f1 + p1) + 0.3 * Math.sin(t * f2 + p2) + 0.12 * Math.sin(t * f3 + p3);
}

function rot([x, y]: Pt, c: number, s: number): Pt {
  return [x * c - y * s, x * s + y * c];
}

/** x positions where the horizontal line y crosses the closed polygon, sorted. */
function crossings(q: Pt[], y: number): number[] {
  const xs: number[] = [];
  const n = q.length;
  for (let i = 0; i < n; i++) {
    const a = q[i];
    const b = q[(i + 1) % n];
    if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
      xs.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
    }
  }
  return xs.sort((p, q2) => p - q2);
}

export interface ScribbleOpts {
  /** Stroke direction in radians (canvas space). Default: a random diagonal. */
  angle?: number;
  /** Crayon width (units). */
  width?: number;
  /** Distance between neighbouring strokes (units). */
  spacing?: number;
  /** How far strokes may run over the outline (units). */
  over?: number;
  /** How far strokes may stop short of the outline (units). */
  short?: number;
  alpha?: number;
  /** Loop-de-loop scribbles instead of zig-zags (fluffy things). */
  loops?: boolean;
}

export interface ShapeOpts extends ScribbleOpts {
  /** Outline colour (null = no outline). */
  line?: string | null;
  /** Outline width. */
  w?: number;
  /** Opacity of the flat pale tint under the scribbles (0..1). */
  base?: number;
  /** Skip the scribble (flat tint only, e.g. tiny details). */
  flat?: boolean;
}

export class ChildPen {
  /** Default outline width (units). Thick so it survives at small sizes. */
  lw = 2.5;
  /** How much lines drift (units). */
  wob = 1.25;
  ink: string = CK.black;
  readonly G = 93;

  constructor(
    readonly ctx: CanvasRenderingContext2D,
    readonly rng: Rng,
  ) {}

  // -------------------------------------------------------------------------
  // Geometry: lopsided hand-drawn shapes (all return closed point lists)
  // -------------------------------------------------------------------------

  /** Hand drift: subdivide and push each point along the normal by smooth noise. */
  hand(pts: Pt[], closed = true, amp = this.wob, step = 2.2): Pt[] {
    const P = subdivide(pts, step, closed);
    const n = P.length;
    if (n < 2) return P;
    const f = drift(this.rng);
    const out: Pt[] = [];
    let s = 0;
    for (let i = 0; i < n; i++) {
      const a = P[closed ? (i - 1 + n) % n : Math.max(0, i - 1)];
      const b = P[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
      let tx = b[0] - a[0];
      let ty = b[1] - a[1];
      const l = Math.hypot(tx, ty) || 1;
      tx /= l;
      ty /= l;
      if (i > 0) s += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
      const off = amp * f(s / 15) + this.rng.range(-0.1, 0.1);
      out.push([P[i][0] - ty * off, P[i][1] + tx * off]);
    }
    return out;
  }

  /** Polygon drawn by hand (corners nudged a little). */
  poly(pts: Pt[], j = 0.9, amp = this.wob): Pt[] {
    return this.hand(
      pts.map(([x, y]) => [x + this.rng.range(-j, j), y + this.rng.range(-j, j)] as Pt),
      true,
      amp,
    );
  }

  /** Lopsided rectangle. */
  rect(x: number, y: number, w: number, h: number, j = 1): Pt[] {
    return this.poly(
      [
        [x, y],
        [x + w, y],
        [x + w, y + h],
        [x, y + h],
      ],
      j,
    );
  }

  /** Lopsided oval (a child's circle is never round). */
  oval(cx: number, cy: number, rx: number, ry = rx, lop = 0.07, n = 24): Pt[] {
    const f = drift(this.rng);
    const a0 = this.rng.range(0, Math.PI * 2);
    const out: Pt[] = [];
    for (let i = 0; i < n; i++) {
      const a = a0 + (i / n) * Math.PI * 2;
      const r = 1 + lop * f(a * 1.3);
      out.push([cx + Math.cos(a) * rx * r, cy + Math.sin(a) * ry * r]);
    }
    return out;
  }

  /** Lopsided oval rotated by `rot` radians. */
  ovalRot(cx: number, cy: number, rx: number, ry: number, rot: number, lop = 0.08): Pt[] {
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    return this.oval(0, 0, rx, ry, lop, 16).map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c] as Pt);
  }

  /** Flatten the bottom of a shape onto the ground line (bushes, rocks, mounds). */
  sit(pts: Pt[], ground = this.G): Pt[] {
    return pts.map(([x, y]) => [x, Math.min(y, ground + this.rng.range(-0.25, 0.25))] as Pt);
  }

  /** Scalloped "cloud" outline: a ring of bumps (tree tops, bushes, clouds, sheep). */
  bumpy(cx: number, cy: number, rx: number, ry: number, bumps: number, depth = 0.16, irregular = 0.4): Pt[] {
    const out: Pt[] = [];
    const a0 = this.rng.range(0, Math.PI * 2);
    const angs: number[] = [];
    for (let i = 0; i < bumps; i++) angs.push(a0 + ((i + this.rng.range(-irregular, irregular) * 0.5) / bumps) * Math.PI * 2);
    for (let i = 0; i < bumps; i++) {
      const t0 = angs[i];
      let t1 = angs[(i + 1) % bumps];
      if (t1 <= t0) t1 += Math.PI * 2;
      const d = depth * this.rng.range(1 - irregular, 1 + irregular);
      const k = 6;
      for (let j = 0; j < k; j++) {
        const u = j / k;
        const a = t0 + (t1 - t0) * u;
        const r = 1 - depth * 0.5 + d * Math.sin(Math.PI * u);
        out.push([cx + Math.cos(a) * rx * r, cy + Math.sin(a) * ry * r]);
      }
    }
    return out;
  }

  /** Flower head outline: round petals around a centre as one continuous curve. */
  petals(cx: number, cy: number, rIn: number, rOut: number, n: number, pointy = false): Pt[] {
    const out: Pt[] = [];
    const a0 = this.rng.range(0, Math.PI * 2);
    const steps = n * 8;
    const lop = drift(this.rng);
    for (let i = 0; i < steps; i++) {
      const a = a0 + (i / steps) * Math.PI * 2;
      const u = Math.abs(Math.sin((a - a0) * n * 0.5));
      const shape = pointy ? Math.pow(u, 1.6) : Math.pow(u, 0.55);
      const r = (rIn + (rOut - rIn) * shape) * (1 + 0.06 * lop(a * 2));
      out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Marks
  // -------------------------------------------------------------------------

  /**
   * A crayon / marker line with uneven pressure: a light base pass over the
   * whole path plus heavier passes where the "pressure" noise is high, and a
   * faint waxy streak on top.
   */
  stroke(pts: Pt[], color: string = this.ink, w = this.lw, o: { alpha?: number; even?: boolean; closed?: boolean } = {}): void {
    if (pts.length < 2) return;
    const ctx = this.ctx;
    const P = subdivide(pts, 1.4, !!o.closed);
    if (o.closed) P.push(P[0]);
    const press = drift(this.rng);
    const ph = this.rng.range(0, 50);
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = color;
    ctx.globalAlpha = o.alpha ?? 1;
    // Base pass.
    ctx.lineWidth = o.even ? w : w * 0.78;
    ctx.beginPath();
    tracePath(ctx, P, false, false);
    ctx.stroke();
    if (!o.even) {
      // Heavier sections where the child pressed harder.
      for (const [thr, mult] of [
        [-0.25, 1.0],
        [0.35, 1.2],
      ] as const) {
        ctx.lineWidth = w * mult;
        ctx.beginPath();
        let s = 0;
        let open = false;
        for (let i = 0; i < P.length; i++) {
          if (i > 0) s += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
          const on = press(ph + s / 7) > thr;
          if (on && !open) {
            ctx.moveTo(P[i][0], P[i][1]);
            open = true;
          } else if (on) ctx.lineTo(P[i][0], P[i][1]);
          else open = false;
        }
        ctx.stroke();
      }
    }
    // Waxy streak (lighter, broken) so the line reads as crayon.
    ctx.globalAlpha = (o.alpha ?? 1) * 0.2;
    ctx.strokeStyle = mix(color, "#ffffff", 0.3);
    ctx.lineWidth = w * 0.28;
    ctx.setLineDash([w * this.rng.range(1.5, 3), w * this.rng.range(1, 2)]);
    ctx.beginPath();
    const ox = this.rng.range(-w, w) * 0.15;
    const oy = this.rng.range(-w, w) * 0.15;
    tracePath(
      ctx,
      P.map(([x, y]) => [x + ox, y + oy] as Pt),
      false,
      false,
    );
    ctx.stroke();
    ctx.restore();
  }

  /** Open hand-drawn line. */
  line(pts: Pt[], color: string = this.ink, w = this.lw, amp = this.wob * 0.6): void {
    this.stroke(this.hand(pts, false, amp, 2.5), color, w);
  }

  /** Closed outline that overshoots where it should meet itself. */
  outline(pts: Pt[], color: string = this.ink, w = this.lw): void {
    const n = pts.length;
    if (n < 3) return;
    const start = this.rng.int(0, n - 1);
    const path: Pt[] = [];
    for (let i = 0; i <= n; i++) path.push(pts[(start + i) % n]);
    // Overshoot: keep going a little past the start, drifting off the line.
    const [cx, cy] = centroid(pts);
    const extra = Math.max(2, Math.round(n * this.rng.range(0.04, 0.09)));
    const out = this.rng.range(0.5, 1.4) * (this.rng.chance(0.5) ? 1 : -0.6);
    for (let i = 1; i <= extra; i++) {
      const p = pts[(start + i) % n];
      const dx = p[0] - cx;
      const dy = p[1] - cy;
      const l = Math.hypot(dx, dy) || 1;
      const t = (i / extra) * out;
      path.push([p[0] + (dx / l) * t * 1.6, p[1] + (dy / l) * t * 1.6]);
    }
    this.stroke(path, color, w);
    if (this.rng.chance(0.55)) {
      // Went over part of the line a second time, not quite on top of it.
      const len = Math.round(path.length * this.rng.range(0.15, 0.35));
      const i0 = this.rng.int(0, Math.max(0, path.length - len - 1));
      const ox = this.rng.range(-0.8, 0.8);
      const oy = this.rng.range(-0.8, 0.8);
      const seg = path.slice(i0, i0 + len).map(([x, y], i) => {
        const k = Math.sin((i / Math.max(1, len - 1)) * Math.PI);
        return [x + ox * k, y + oy * k] as Pt;
      });
      this.stroke(seg, color, w * 0.6);
    }
  }

  /** Paper-white underlay (so later scribble gaps show paper, not holes). */
  paper(pts: Pt[], color: string = PAPER): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    tracePath(ctx, pts, true, false);
    ctx.fill();
    ctx.restore();
  }

  /** Flat tint inside the shape (no outline). */
  tint(pts: Pt[], color: string, alpha = 1): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    tracePath(ctx, pts, true, false);
    ctx.fill();
    ctx.restore();
  }

  /** Back-and-forth zig-zag across the shape in direction `ang` (canvas space). */
  private zigzag(pts: Pt[], ang: number, sp: number, over: number, short: number, loops: boolean, band: [number, number] = [0, 1]): Pt[] {
    const rng = this.rng;
    const [cx, cy] = centroid(pts);
    const c = Math.cos(-ang);
    const s = Math.sin(-ang);
    const q = pts.map(([x, y]) => rot([x - cx, y - cy], c, s));
    const b = bbox(q);
    let path: Pt[] = [];
    let right = rng.chance(0.5);
    const yEnd = Math.min(b.y + b.h - sp * 0.15, b.y + b.h * band[1]);
    for (let y = Math.max(b.y + sp * 0.3, b.y + b.h * band[0]); y < yEnd; y += sp * 0.5 * rng.range(0.7, 1.25)) {
      const xs = crossings(q, y);
      if (xs.length < 2) continue;
      const x = right ? xs[xs.length - 1] + rng.range(-short, over) : xs[0] - rng.range(-short, over);
      path.push([x, y]);
      right = !right;
    }
    if (loops && path.length > 1) {
      // Replace the zig-zag with a cursive "eeee" loop scribble that follows it.
      const dense = subdivide(path, 0.5, false);
      const r = sp * 0.17;
      const step = (Math.PI * 2 * 0.5) / (r * 1.7);
      let ph = rng.range(0, 6.28);
      path = dense.map(([x, y]) => {
        ph += step;
        return [x + Math.cos(ph) * r, y + Math.sin(ph) * r] as Pt;
      });
    }
    const c2 = Math.cos(ang);
    const s2 = Math.sin(ang);
    return path.map((p) => {
      const [x, y] = rot(p, c2, s2);
      return [x + cx, y + cy] as Pt;
    });
  }

  /**
   * Child-style colouring: back-and-forth crayon strokes in one direction,
   * running a little over the outline in places and stopping short in
   * others, with one patch gone over again a bit harder.
   */
  scribble(pts: Pt[], color: string, o: ScribbleOpts = {}): void {
    const rng = this.rng;
    const ctx = this.ctx;
    const ang = o.angle ?? rng.range(-0.95, -0.35);
    const lw = o.width ?? 2.4;
    const sp = o.spacing ?? lw * 1.7;
    const over = o.over ?? 2.2;
    const short = o.short ?? 1.6;
    const b = bbox(pts);
    // Colouring never lines up with the outline exactly.
    const mis = Math.min(1.4, Math.min(b.w, b.h) * 0.06);
    const ox = rng.range(-mis, mis);
    const oy = rng.range(-mis, mis);
    const shifted = pts.map(([x, y]) => [x + ox, y + oy] as Pt);
    const path = o.loops ? this.zigzag(shifted, ang, sp * 2.6, over * 0.5, short, true) : this.zigzag(shifted, ang, sp, over, short, false);
    if (path.length < 2) {
      this.tint(pts, color, o.alpha ?? 0.9);
      return;
    }
    const [cx, cy] = centroid(shifted);
    // Clip to a slightly grown copy of the shape so concave bits stay tidy.
    const size = Math.max(4, Math.min(b.w, b.h) * 0.5);
    const g = 1 + (over * 1.1) / size;
    ctx.save();
    ctx.beginPath();
    tracePath(
      ctx,
      shifted.map(([x, y]) => [cx + (x - cx) * g, cy + (y - cy) * g] as Pt),
      true,
      false,
    );
    ctx.clip();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = color;
    ctx.globalAlpha = o.alpha ?? 0.95;
    ctx.lineWidth = o.loops ? lw * 0.75 : lw;
    ctx.beginPath();
    tracePath(ctx, path, false, false);
    ctx.stroke();
    // Went over one band again, a bit harder and in another direction.
    if (b.w > 8 && b.h > 8 && !o.loops) {
      const t0 = rng.range(0, 0.6);
      const p2 = this.zigzag(shifted, ang + rng.range(0.25, 0.6) * (rng.chance(0.5) ? 1 : -1), sp * 1.25, over * 0.5, short * 1.5, false, [t0, t0 + rng.range(0.25, 0.45)]);
      if (p2.length > 1) {
        ctx.strokeStyle = mix(color, "#2a1c14", 0.12);
        ctx.globalAlpha = (o.alpha ?? 0.95) * 0.75;
        ctx.lineWidth = lw * 0.8;
        ctx.beginPath();
        tracePath(ctx, p2, false, false);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /** The whole thing: paper underlay, pale tint, scribble colouring, wobbly outline. */
  shape(pts: Pt[], fill: string | null, o: ShapeOpts = {}): Pt[] {
    this.paper(pts);
    if (fill) {
      const base = o.base ?? 0.25;
      if (base > 0) this.tint(pts, fill, o.flat ? 1 : base);
      if (!o.flat) this.scribble(pts, fill, o);
    }
    if (o.line !== null) this.outline(pts, o.line ?? this.ink, o.w ?? this.lw);
    return pts;
  }

  /** Colouring only (paper, tint, scribble) - outline later with outline(). */
  fill(pts: Pt[], fill: string, o: ShapeOpts = {}): Pt[] {
    return this.shape(pts, fill, { ...o, line: null });
  }

  /** Thick coloured line with a dark edge (branches, poles, legs). */
  tube(pts: Pt[], color: string, w: number, edge: string | null = this.ink): void {
    const p = this.hand(pts, false, this.wob * 0.5, 2.5);
    if (edge) this.stroke(p, edge, w + this.lw * 1.3, { even: true });
    this.stroke(p, color, w, { even: true });
  }

  /** Solid little blob (marker dot, eye, berry). */
  dot(cx: number, cy: number, r: number, color: string = this.ink): void {
    this.tint(this.oval(cx, cy, r, r, 0.12, 12), color, 1);
  }

  /** A filled, outlined round thing (apple, window, berry). */
  ball(cx: number, cy: number, r: number, fill: string, w = this.lw * 0.8): Pt[] {
    return this.shape(this.oval(cx, cy, r, r, 0.08, 16), fill, { w, width: Math.min(2.2, r * 0.7), base: 0.6 });
  }

  /** Simple smiley: two dots and a curved line. */
  smile(cx: number, cy: number, s: number, o: { cheeks?: boolean; w?: number } = {}): void {
    const e = s * 0.42;
    this.dot(cx - e, cy - s * 0.15, Math.max(0.9, s * 0.13));
    this.dot(cx + e, cy - s * 0.12, Math.max(0.9, s * 0.13));
    const m: Pt[] = [];
    for (let i = 0; i <= 6; i++) {
      const a = Math.PI * (0.15 + (i / 6) * 0.7);
      m.push([cx + Math.cos(a) * s * 0.42, cy + s * 0.05 + Math.sin(a) * s * 0.36]);
    }
    this.stroke(this.hand(m, false, 0.2, 1.5), this.ink, o.w ?? Math.max(1.1, s * 0.16), { even: true });
    if (o.cheeks) {
      this.dot(cx - e * 1.35, cy + s * 0.22, s * 0.16, "#f59a9a");
      this.dot(cx + e * 1.35, cy + s * 0.22, s * 0.16, "#f59a9a");
    }
  }

  /** Lopsided ground line a child puts under things (a short green scribble). */
  groundScribble(x0: number, x1: number, color: string = CK.green): void {
    const pts: Pt[] = [];
    for (let x = x0; x <= x1; x += 4) pts.push([x, this.G - 1.5 + this.rng.range(-0.8, 0.8)]);
    this.stroke(this.hand(pts, false, 0.4), color, 3);
  }
}

let waxTile: HTMLCanvasElement | null = null;
const waxPatterns = new WeakMap<CanvasRenderingContext2D, CanvasPattern>();

/** Waxy crayon texture tile: short light strokes (CPU-backed so patterns are cheap). */
function waxTileCanvas(): HTMLCanvasElement {
  if (waxTile) return waxTile;
  const size = 96;
  const c = makeCanvas(size, size);
  const ctx = ctx2d(c, true);
  const rng = createRng(1234);
  ctx.lineCap = "round";
  for (let i = 0; i < size * size * 0.035; i++) {
    const x = rng.range(0, size);
    const y = rng.range(0, size);
    const len = rng.range(1.5, 5);
    const a = rng.range(-0.5, 0.1);
    ctx.strokeStyle = `rgba(255,253,245,${rng.range(0.2, 0.7)})`;
    ctx.lineWidth = rng.range(0.6, 1.4);
    ctx.beginPath();
    for (const dx of [0, -size, size])
      for (const dy of [0, -size, size]) {
        ctx.moveTo(x + dx, y + dy);
        ctx.lineTo(x + dx + Math.cos(a) * len, y + dy + Math.sin(a) * len);
      }
    ctx.stroke();
  }
  waxTile = c;
  return c;
}

/** Light waxy crayon specks over already-drawn art (alpha unchanged). */
export function waxGrain(ctx: CanvasRenderingContext2D, w: number, h: number, rng: Rng, amount = 0.32): void {
  let pat = waxPatterns.get(ctx);
  if (!pat) {
    pat = ctx.createPattern(waxTileCanvas(), "repeat") ?? undefined;
    if (!pat) return;
    waxPatterns.set(ctx, pat);
  }
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

/** ChildPen art is drawn this many units higher than Kit art (ground at y = 93 - CHILD_LIFT in canvas units). */
export const CHILD_LIFT = 1.5;

/**
 * Draw with a ChildPen into a fresh transparent canvas (100 units = `width`
 * px), add waxy grain and turn it into a paper cut-out. Mirrors kit.ts's
 * renderKitArt for single images (characters, sky art).
 */
export function renderChildArt(
  width: number,
  height: number,
  seed: number,
  draw: (p: ChildPen) => void,
  o: { outline?: number; border?: number; grain?: number } = {},
): HTMLCanvasElement {
  const canvas = makeCanvas(width, height);
  drawChildInto(canvas, seed, draw, o);
  return canvas;
}

/** Clear `canvas`, draw, grain, cut out. Returns the visible box (or null). */
export function drawChildInto(
  canvas: HTMLCanvasElement,
  seed: number,
  draw: (p: ChildPen) => void,
  o: { outline?: number; border?: number; grain?: number; scale?: number } = {},
): PixelBox | null {
  const width = canvas.width;
  const ctx = ctx2d(canvas, true);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const rng = createRng(seed);
  const s = width / 100;
  // Lift by CHILD_LIFT units so the thick crayon lines + paper border under
  // the ground line still fit inside the canvas.
  ctx.setTransform(s, 0, 0, s, 0, -CHILD_LIFT * s);
  if (o.scale && o.scale !== 1) {
    // Shrink about the ground point so the art still stands on y = 93.
    ctx.translate(50, 93);
    ctx.scale(o.scale, o.scale);
    ctx.translate(-50, -93);
  }
  // Nothing goes below the ground line (scribbles that overshoot get cut off).
  ctx.save();
  ctx.beginPath();
  ctx.rect(-50, -50, 200, 93 + 1.2 + 50);
  ctx.clip();
  ctx.beginPath();
  draw(new ChildPen(ctx, rng));
  ctx.restore();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  waxGrain(ctx, canvas.width, canvas.height, rng, o.grain ?? 0.32);
  return applyPaperCutout(canvas, {
    outline: o.outline ?? Math.max(1.5, width * 0.016),
    border: o.border ?? Math.max(2.5, width * 0.03),
    roughness: Math.max(0.8, width * 0.006),
    seed,
  });
}
