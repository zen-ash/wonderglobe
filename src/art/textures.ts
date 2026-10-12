// Utility textures: ground grain, cardboard, paper, celebration star and
// sticky notes.

import { INK, ctx2d, makeCanvas, paperGrain, parseHex, rgba, shade, tracePath, type Pt } from "./crayon";
import { C, bezierPts, renderKitArt } from "./kit";
import { createRng, type Rng } from "./rng";

/** Draw fn at the 9 wrapped offsets so marks crossing an edge tile seamlessly. */
function wrapped(size: number, fn: (dx: number, dy: number) => void): void {
  for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) fn(dx, dy);
}

function streak(ctx: CanvasRenderingContext2D, rng: Rng, size: number, len: [number, number], angle: [number, number]): void {
  const x = rng.range(0, size);
  const y = rng.range(0, size);
  const a = rng.range(angle[0], angle[1]);
  const l = rng.range(len[0], len[1]);
  const bend = rng.range(-0.25, 0.25) * l;
  wrapped(size, (dx, dy) => {
    if (x + dx < -l || x + dx > size + l || y + dy < -l || y + dy > size + l) return;
    ctx.beginPath();
    ctx.moveTo(x + dx, y + dy);
    ctx.quadraticCurveTo(
      x + dx + Math.cos(a) * l * 0.5 - Math.sin(a) * bend,
      y + dy + Math.sin(a) * l * 0.5 + Math.cos(a) * bend,
      x + dx + Math.cos(a) * l,
      y + dy + Math.sin(a) * l,
    );
    ctx.stroke();
  });
}

/**
 * Tileable greyscale crayon grain (values ~0.85..1.0) for multiplying with
 * planet ground colours.
 */
export function drawGroundGrain(size = 256): HTMLCanvasElement {
  const c = makeCanvas(size, size);
  const ctx = ctx2d(c);
  const rng = createRng(2024);
  ctx.fillStyle = "rgb(238,238,238)";
  ctx.fillRect(0, 0, size, size);
  ctx.lineCap = "round";
  const n = Math.round((size * size) / 55);
  for (let i = 0; i < n; i++) {
    const dark = rng.chance(0.55);
    ctx.strokeStyle = dark ? `rgba(0,0,0,${rng.range(0.025, 0.06)})` : `rgba(255,255,255,${rng.range(0.25, 0.6)})`;
    ctx.lineWidth = rng.range(0.8, 2.4) * (size / 256);
    streak(ctx, rng, size, [size * 0.02, size * 0.07], [-0.75, -0.35]);
  }
  // Very soft, large blotches for low-frequency variation.
  for (let i = 0; i < 10; i++) {
    const x = rng.range(0, size);
    const y = rng.range(0, size);
    const r = rng.range(size * 0.18, size * 0.32);
    const dark = rng.chance(0.5);
    wrapped(size, (dx, dy) => {
      const g = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
      g.addColorStop(0, dark ? "rgba(0,0,0,0.03)" : "rgba(255,255,255,0.1)");
      g.addColorStop(1, dark ? "rgba(0,0,0,0)" : "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
    });
  }
  return c;
}

/** Corrugated cardboard (tileable) for object bases. */
export function drawCardboardTexture(size = 256): HTMLCanvasElement {
  const c = makeCanvas(size, size);
  const ctx = ctx2d(c);
  const rng = createRng(77);
  ctx.fillStyle = "#c9a074";
  ctx.fillRect(0, 0, size, size);
  // Corrugation ridges: an integer number of periods so it tiles.
  const periods = Math.max(8, Math.round(size / 14));
  const p = size / periods;
  for (let i = 0; i < periods; i++) {
    const x = i * p;
    const g = ctx.createLinearGradient(x, 0, x + p, 0);
    g.addColorStop(0, "rgba(120,80,40,0.16)");
    g.addColorStop(0.45, "rgba(255,235,200,0.12)");
    g.addColorStop(1, "rgba(120,80,40,0.16)");
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, p, size);
  }
  ctx.lineCap = "round";
  const n = Math.round((size * size) / 120);
  for (let i = 0; i < n; i++) {
    const dark = rng.chance(0.6);
    ctx.strokeStyle = dark ? `rgba(90,55,25,${rng.range(0.06, 0.18)})` : `rgba(255,240,210,${rng.range(0.1, 0.3)})`;
    ctx.lineWidth = rng.range(0.5, 1.3);
    streak(ctx, rng, size, [2, 8], [-0.4, 0.4]);
  }
  // A few faint stains.
  for (let i = 0; i < 5; i++) {
    const x = rng.range(0, size);
    const y = rng.range(0, size);
    const r = rng.range(size * 0.05, size * 0.12);
    wrapped(size, (dx, dy) => {
      const g = ctx.createRadialGradient(x + dx, y + dy, r * 0.6, x + dx, y + dy, r);
      g.addColorStop(0, "rgba(120,80,40,0.015)");
      g.addColorStop(0.9, "rgba(120,80,40,0.045)");
      g.addColorStop(1, "rgba(120,80,40,0)");
      ctx.fillStyle = g;
      ctx.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
    });
  }
  return c;
}

/** Cream paper (tileable). */
export function drawPaperTexture(size = 256): HTMLCanvasElement {
  const c = makeCanvas(size, size);
  const ctx = ctx2d(c);
  ctx.fillStyle = "#f7efdc";
  ctx.fillRect(0, 0, size, size);
  paperGrain(ctx, size, size, createRng(55), 0.5);
  return c;
}

/** Little 5-point paper star (yellow, outline, white border) for celebration bursts. */
export function drawStarParticle(size = 128): HTMLCanvasElement {
  return renderKitArt(
    size,
    size,
    999,
    (k) => {
      const pts: Pt[] = [];
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
        const r = i % 2 === 0 ? 40 : 18;
        pts.push([50 + Math.cos(a) * r, 54 + Math.sin(a) * r]);
      }
      k.shape(k.poly(pts, 0.6, 6), C.yellow, { w: 3, fill: { hatch: C.orange, shadeRegion: [50, 54, 40, 40] } });
      k.shine(bezierPts([38, 46], [42, 36], [48, 28], 5), "#ffffff", 3, 0.7);
      k.dot(44, 54, 2.2, INK);
      k.dot(56, 54, 2.2, INK);
      k.line(bezierPts([45, 60], [50, 64], [55, 60], 5), INK, 2, 1);
    },
    { outline: Math.max(1.5, size * 0.03), border: Math.max(2, size * 0.05), grain: 0.35 },
  );
}

/** Tiny sticky note with a folded corner (transparent background). */
export function drawNoteTexture(color: string, size = 128): HTMLCanvasElement {
  const c = makeCanvas(size, size);
  const ctx = ctx2d(c);
  const rng = createRng(parseHex(color).reduce((a, b) => a * 31 + b, 7));
  const m = size * 0.08;
  const s = size - m * 2;
  const fold = s * 0.2;
  const body: Pt[] = [
    [m, m],
    [m + s, m],
    [m + s, m + s - fold],
    [m + s - fold, m + s],
    [m, m + s],
  ];
  // Soft shadow
  ctx.save();
  ctx.shadowColor = "rgba(60,40,20,0.25)";
  ctx.shadowBlur = size * 0.04;
  ctx.shadowOffsetY = size * 0.015;
  ctx.fillStyle = color;
  ctx.beginPath();
  tracePath(ctx, body, true, false);
  ctx.fill();
  ctx.restore();
  // Grain + adhesive strip + faint lines
  ctx.save();
  ctx.beginPath();
  tracePath(ctx, body, true, false);
  ctx.clip();
  const g = ctx.createLinearGradient(0, m, 0, m + s);
  g.addColorStop(0, rgba(shade(color, -0.12), 0.5));
  g.addColorStop(0.16, rgba(shade(color, -0.12), 0.0));
  g.addColorStop(1, rgba(shade(color, 0.25), 0.25));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  paperGrain(ctx, size, size, rng, 0.35);
  ctx.strokeStyle = rgba(shade(color, -0.25), 0.35);
  ctx.lineWidth = Math.max(1, size / 128);
  for (let y = m + s * 0.32; y < m + s * 0.9; y += s * 0.16) {
    ctx.beginPath();
    ctx.moveTo(m + s * 0.1, y);
    ctx.lineTo(m + s * 0.85, y + rng.range(-0.5, 0.5));
    ctx.stroke();
  }
  ctx.restore();
  // Folded corner
  const flap: Pt[] = [
    [m + s, m + s - fold],
    [m + s - fold, m + s],
    [m + s - fold * 0.92, m + s - fold * 0.92],
  ];
  ctx.fillStyle = shade(color, -0.18);
  ctx.beginPath();
  tracePath(ctx, flap, true, false);
  ctx.fill();
  ctx.strokeStyle = rgba(shade(color, -0.45), 0.6);
  ctx.lineWidth = Math.max(1, size / 110);
  ctx.stroke();
  // Thin outline
  ctx.strokeStyle = rgba(shade(color, -0.4), 0.55);
  ctx.beginPath();
  tracePath(ctx, body, true, false);
  ctx.stroke();
  return c;
}
