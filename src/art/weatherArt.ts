// Atmosphere art: a sleepy crescent paper moon, paper stars, a crayon
// rainbow, crayon rain strokes, paper snowflakes, cherry petals, autumn
// leaves, warm glows and crayon ripple rings. All original and procedural.

import { INK, crayonGrain, crayonStroke, ctx2d, makeCanvas, paperGrain, type Pt } from "./crayon";
import { C, bezierPts, leafPts, renderKitArt } from "./kit";
import { createRng } from "./rng";

/** Sleepy crescent paper moon with a little face (transparent background). */
export function drawMoonTexture(size = 256): HTMLCanvasElement {
  return renderKitArt(size, size, 4242, (k) => {
    // A crayon disc with an offset disc cut away; the cut-out pass adds the
    // ink line and the white paper edge around whatever is left.
    k.shape(k.blob(50, 50, 38, 38, 0.02, 30), "#fff1a8", {
      w: 2.4,
      fill: { hatch: C.gold, hatchAlpha: 0.35, shadeRegion: [22, 52, 26, 40], shadeColor: "#f2cf6a" },
    });
    const ctx = k.ctx;
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.ellipse(70, 38, 33, 33, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    k.shine(bezierPts([22, 36], [18, 50], [24, 66], 6), "#ffffff", 2.4, 0.7);
    // Sleepy closed eye, rosy cheek and a tiny smile.
    k.line(bezierPts([24, 52], [28, 56], [32, 52], 5), INK, 1.9, 1);
    k.dot(28, 63, 3.6, "#f2a0a0", 0.6);
    k.line(bezierPts([26, 70], [31, 73], [36, 69], 5), INK, 1.7, 1);
  });
}

/** Small five-point paper star (pale yellow, ink outline, white paper edge). */
export function drawPaperStar(size = 96): HTMLCanvasElement {
  return renderKitArt(
    size,
    size,
    1717,
    (k) => {
      const pts: Pt[] = [];
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
        const r = i % 2 === 0 ? 38 : 17;
        pts.push([50 + Math.cos(a) * r, 54 + Math.sin(a) * r]);
      }
      k.shape(k.poly(pts, 0.5, 6), "#fff3b0", { w: 3, fill: { hatch: C.yellow, hatchAlpha: 0.5 } });
      k.shine(bezierPts([40, 46], [44, 38], [49, 30], 5), "#ffffff", 3, 0.8);
    },
    { outline: Math.max(1.5, size * 0.035), border: Math.max(2, size * 0.05), grain: 0.3 },
  );
}

/**
 * Crayon rainbow band, drawn as a horizontal strip: v=0 outer edge … v=1
 * inner edge. Ink outline and white paper edges on both sides.
 */
export function drawRainbowTexture(w = 512, h = 128): HTMLCanvasElement {
  const c = makeCanvas(w, h);
  const ctx = ctx2d(c);
  const rng = createRng(606);
  const bands = ["#ef5b5b", "#f6a03c", "#f9d548", "#7cc35b", "#5aa3e2", "#9b7bd2"];
  const edge = h * 0.07;
  const ink = h * 0.045;
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#fffcf3";
  ctx.fillRect(0, ink, w, h - ink * 2);
  const top = ink + edge;
  const bh = (h - (ink + edge) * 2) / bands.length;
  bands.forEach((col, i) => {
    ctx.fillStyle = col;
    ctx.fillRect(0, top + i * bh - 0.5, w, bh + 1);
    // Crayon scribbles along the band.
    for (let s = 0; s < 34; s++) {
      const x = rng.range(-20, w);
      const y = top + i * bh + rng.range(0.2, 0.8) * bh;
      crayonStroke(ctx, [[x, y], [x + rng.range(30, 90), y + rng.range(-2, 2)]], { color: i % 2 ? "#ffffff" : INK, width: rng.range(1, 2.2), rng, passes: 1, alpha: 0.12 });
    }
  });
  crayonGrain(ctx, w, h, rng, 0.55);
  paperGrain(ctx, w, h, rng, 0.25);
  return c;
}

/**
 * Particle atlas, 4 x 2 cells of 128px:
 *  0 rain stroke · 1 snowflake · 2 cherry petal · 3 orange leaf
 *  4 red leaf · 5 yellow leaf · 6 soft warm glow · 7 firefly / sparkle
 */
export const PARTICLE_CELLS = { rain: 0, snow: 1, petal: 2, leafOrange: 3, leafRed: 4, leafYellow: 5, glow: 6, spark: 7 } as const;

export function drawParticleAtlas(cell = 128): HTMLCanvasElement {
  const c = makeCanvas(cell * 4, cell * 2);
  const ctx = ctx2d(c);
  const at = (i: number): [number, number] => [(i % 4) * cell, Math.floor(i / 4) * cell];
  const put = (i: number, art: HTMLCanvasElement) => {
    const [x, y] = at(i);
    ctx.drawImage(art, x, y, cell, cell);
  };
  // Rain: a short, slightly bent blue crayon stroke (vertical).
  {
    const art = makeCanvas(cell, cell);
    const a = ctx2d(art);
    const rng = createRng(31);
    const s = cell / 100;
    a.setTransform(s, 0, 0, s, 0, 0);
    crayonStroke(a, bezierPts([50, 12], [54, 50], [50, 88], 8), { color: "#4f97d8", width: 30, rng, passes: 2 });
    crayonStroke(a, bezierPts([46, 20], [49, 44], [47, 66], 6), { color: "#cfeaff", width: 9, rng, passes: 1, alpha: 0.9 });
    a.setTransform(1, 0, 0, 1, 0, 0);
    crayonGrain(a, cell, cell, rng, 0.5);
    put(0, art);
  }
  // Snowflake: a soft white paper flake with six crayon arms.
  put(
    1,
    renderKitArt(
      cell,
      cell,
      77,
      (k) => {
        k.shape(k.blob(50, 50, 30, 30, 0.08, 18), "#ffffff", { outline: "#9db3c8", w: 2.5, fill: { hatch: C.ice, hatchAlpha: 0.4 } });
        for (let i = 0; i < 6; i++) {
          const ang = (i / 6) * Math.PI * 2;
          k.line([[50, 50], [50 + Math.cos(ang) * 22, 50 + Math.sin(ang) * 22]], "#a9c6de", 3, 1);
        }
      },
      { outline: 2, border: 3, grain: 0.2 },
    ),
  );
  // Cherry petal.
  put(
    2,
    renderKitArt(
      cell,
      cell,
      88,
      (k) => {
        const p: Pt[] = [...bezierPts([50, 88], [12, 55], [38, 16], 10), [50, 26], ...bezierPts([62, 16], [88, 55], [50, 88], 10)];
        k.shape(k.poly(p, 0.4, 5), C.blossom, { w: 3.2, fill: { hatch: C.rose, hatchAlpha: 0.35 } });
        k.line(bezierPts([50, 80], [48, 55], [50, 34], 5), C.rose, 2.2, 1);
      },
      { outline: 4, border: 5 },
    ),
  );
  // Autumn leaves.
  const leaf = (i: number, color: string, seed: number) =>
    put(
      i,
      renderKitArt(
        cell,
        cell,
        seed,
        (k) => {
          k.shape(leafPts(50, 92, -Math.PI / 2, 82, 30, 0.1), color, { w: 3.2, fill: { shadeRegion: [50, 50, 30, 40] } });
          k.line([[50, 90], [50, 22]], INK, 2.2, 1);
          for (const y of [40, 56, 72]) {
            k.line([[50, y + 6], [36, y - 4]], INK, 1.6, 1);
            k.line([[50, y + 6], [64, y - 4]], INK, 1.6, 1);
          }
        },
        { outline: 4, border: 5 },
      ),
    );
  leaf(3, C.orange, 301);
  leaf(4, "#e0523c", 302);
  leaf(5, C.yellow, 303);
  // Soft warm glow (white, tinted in the shader).
  {
    const [x, y] = at(6);
    const g = ctx.createRadialGradient(x + cell / 2, y + cell / 2, 0, x + cell / 2, y + cell / 2, cell / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.18, "rgba(255,255,255,0.75)");
    g.addColorStop(0.5, "rgba(255,255,255,0.22)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x, y, cell, cell);
  }
  // Firefly / sparkle: bright core, small halo and a four-point twinkle.
  {
    const [x, y] = at(7);
    const cx = x + cell / 2, cy = y + cell / 2;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, cell / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.1, "rgba(255,255,255,0.95)");
    g.addColorStop(0.28, "rgba(255,255,255,0.3)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x, y, cell, cell);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    for (let i = 0; i < 4; i++) {
      ctx.rotate(Math.PI / 2);
      ctx.beginPath();
      ctx.moveTo(0, -cell * 0.46);
      ctx.quadraticCurveTo(cell * 0.03, -cell * 0.03, cell * 0.46, 0);
      ctx.quadraticCurveTo(cell * 0.03, cell * 0.03, 0, 0);
      ctx.fill();
    }
    ctx.restore();
  }
  return c;
}

/** UV rect (u0, v0, u1, v1; v up) of a particle atlas cell. */
export function particleCellUv(i: number): [number, number, number, number] {
  const col = i % 4;
  const row = Math.floor(i / 4);
  return [col / 4, 1 - (row + 1) / 2, (col + 1) / 4, 1 - row / 2];
}

/** A wobbly crayon ring for water ripples (white on transparent). */
export function drawRippleRing(size = 128): HTMLCanvasElement {
  const c = makeCanvas(size, size);
  const ctx = ctx2d(c);
  const rng = createRng(515);
  const s = size / 100;
  ctx.setTransform(s, 0, 0, s, 0, 0);
  const ring: Pt[] = [];
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    const r = 42 + rng.range(-1.2, 1.2);
    ring.push([50 + Math.cos(a) * r, 50 + Math.sin(a) * r]);
  }
  crayonStroke(ctx, ring, { color: "#ffffff", width: 5, rng, closed: true, passes: 2 });
  const inner = ring.map(([x, y]) => [50 + (x - 50) * 0.72, 50 + (y - 50) * 0.72] as Pt);
  crayonStroke(ctx, inner.slice(4, 30), { color: "#ffffff", width: 3, rng, passes: 1, alpha: 0.7 });
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  crayonGrain(ctx, size, size, rng, 0.4);
  return c;
}
