// Sky art drawn like a child would: a smiling sun with stroke rays, bumpy
// crayon clouds, plus the soft teal sky gradient.

import { ctx2d, makeCanvas, paperGrain, type Pt } from "./crayon";
import { CK, dk, renderChildArt } from "./childKit";
import { createRng } from "./rng";

/** A child's sun: a lopsided yellow circle, stroke rays and a big smile (transparent background). */
export function drawSunTexture(size = 256): HTMLCanvasElement {
  return renderChildArt(size, size, 777, (p) => {
    const cx = 50;
    const cy = 50;
    const n = 12;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + 0.13 + p.rng.range(-0.06, 0.06);
      const r0 = 30;
      const r1 = i % 2 === 0 ? 41 : 37;
      p.line(
        [
          [cx + Math.cos(a) * r0, cy + Math.sin(a) * r0],
          [cx + Math.cos(a) * r1, cy + Math.sin(a) * r1],
        ],
        i % 2 === 0 ? CK.orange : CK.yellow,
        4.2,
        0.3,
      );
    }
    p.shape(p.oval(cx, cy, 27, 26, 0.06), CK.yellow, { angle: -0.6, width: 2.6, base: 0.5, line: dk(CK.orange, 0.25), w: 2.8 });
    p.dot(39, 55, 4.2, "#f59a8a");
    p.dot(61, 55, 4.2, "#f59a8a");
    p.smile(cx, cy + 1, 22, { w: 2.4 });
  });
}

/** A child's cloud: bumpy outline in blue crayon, white with a little blue scribble. Canvas is size x 0.6*size. */
export function drawCloudTexture(variant: number, size = 256): HTMLCanvasElement {
  const h = Math.round(size * 0.6);
  return renderChildArt(size, h, 4000 + variant * 31, (p) => {
    const r = createRng(variant * 977 + 5);
    const pts = p.bumpy(50, 31 + r.range(-1, 1), 37, 17 + (variant % 3) * 0.8, 7 + (variant % 3), 0.4);
    const flat = pts.map(([x, y]) => [x, Math.min(y, 43 + r.range(-0.3, 0.3))] as Pt);
    p.shape(flat, CK.white, { line: CK.blue, base: 0, w: 2.6 });
    p.scribble(
      flat.filter(([, y]) => y > 33),
      CK.sky,
      { angle: -0.15, width: 2.2, alpha: 0.5 },
    );
  });
}

/** Soft teal sky: deeper teal at the top, creamy near the horizon, faint paper grain. */
export function drawSkyGradient(w: number, h: number): HTMLCanvasElement {
  const c = makeCanvas(w, h);
  const ctx = ctx2d(c);
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "#6fc2c3");
  g.addColorStop(0.45, "#9fd8d2");
  g.addColorStop(0.8, "#d9eedd");
  g.addColorStop(1, "#f6efd8");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  paperGrain(ctx, w, h, createRng(31337), 0.18);
  return c;
}
