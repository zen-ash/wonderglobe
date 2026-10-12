// Scenery drawn like children's drawings (ChildPen). Each id has one or more
// "children's versions" (variants); sceneryAtlas.ts packs every variant into
// its own atlas cell. All drawers work in the 100-unit box with the ground at
// y = 93 and keep their art inside x 7..93, y >= 9 so the paper border fits.
//
// Style rules (keep new art cohesive):
//  - plants are outlined with a darker crayon of their own colour, things
//    people made (houses, fences, boats ...) and animals with black marker;
//  - colour with ChildPen.shape()/fill() (scribbles that go over the lines);
//  - simple symbols: lollipop trees, triangle roofs, square windows with a
//    cross, circle-and-petal flowers, smiling faces only on a few things;
//  - bold: big shapes, thick lines, nothing thinner than ~2 units.

import type { Pt } from "./crayon";
import { CK, ChildPen, dk } from "./childKit";
import { bezierPts, leafPts } from "./kit";
import { drawChildPerson, lookFromSeed, type PersonLook } from "./characters";
import type { SceneryArtId } from "./sceneryAtlas";

export type ChildDrawer = (p: ChildPen) => void;

const G = 93;

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

function trunk(p: ChildPen, x: number, top: number, w: number, color: string = CK.brown, o: { hole?: boolean } = {}): Pt[] {
  const r = p.rng;
  const lean = r.range(-1.5, 1.5);
  const pts: Pt[] = [
    [x - w * 0.42 + lean, top],
    [x + w * 0.42 + lean, top],
    [x + w * 0.5, G - 3],
    [x + w * 0.62, G],
    [x - w * 0.62, G],
    [x - w * 0.5, G - 3],
  ];
  const t = p.shape(p.poly(pts, 0.6), color, { angle: -1.5 + r.range(-0.15, 0.15), width: 2.3, line: dk(color, 0.55) });
  if (o.hole) p.dot(x + r.range(-w * 0.15, w * 0.15), top + (G - top) * 0.45, Math.max(1.7, w * 0.14), dk(color, 0.7));
  return t;
}

/** Crown made of separate circles; fills first, outlines after (overlaps stay visible). */
function circleCrown(p: ChildPen, circles: Array<[number, number, number]>, color: string, o: { loops?: boolean; line?: string } = {}): Pt[][] {
  const shapes = circles.map(([x, y, rr]) => p.oval(x, y, rr, rr * p.rng.range(0.88, 1.02), 0.07));
  const angle = p.rng.range(-0.9, -0.4);
  for (const s of shapes) p.fill(s, color, { loops: o.loops, angle, width: 2.6 });
  for (const s of shapes) p.outline(s, o.line ?? dk(color));
  return shapes;
}

function leaf(p: ChildPen, x: number, y: number, ang: number, len: number, wid: number, color: string = CK.green): void {
  p.shape(p.hand(leafPts(x, y, ang, len, wid, 0.06), true, 0.35, 2), color, { w: 2.1, width: 2.1, angle: ang, line: dk(color) });
}

function grassBlades(p: ChildPen, x0: number, x1: number, h: number, color: string = CK.green): void {
  const n = Math.max(2, Math.round((x1 - x0) / 7));
  for (let i = 0; i < n; i++) {
    const x = x0 + ((i + 0.5) / n) * (x1 - x0) + p.rng.range(-1.5, 1.5);
    const hh = h * p.rng.range(0.6, 1.1);
    p.line([[x - 1.5, G], [x + p.rng.range(-4, 4), G - hh]], i % 2 ? color : dk(color, 0.25), 2.6, 0.3);
  }
}

type PetalStyle = 0 | 1 | 2;

function flowerHead(p: ChildPen, cx: number, cy: number, r: number, petal: string, centre: string, style: PetalStyle, line?: string): void {
  const rng = p.rng;
  const ln = line ?? dk(petal, 0.55);
  if (style === 0) {
    p.shape(p.petals(cx, cy, r * 0.55, r, rng.int(5, 6)), petal, { width: 2.3, base: 0.4, line: ln });
  } else if (style === 1) {
    const n = rng.int(5, 6);
    const a0 = rng.range(0, Math.PI * 2);
    const ps: Pt[][] = [];
    for (let i = 0; i < n; i++) {
      const a = a0 + (i / n) * Math.PI * 2 + rng.range(-0.15, 0.15);
      const d = r * rng.range(0.52, 0.62);
      ps.push(p.ovalRot(cx + Math.cos(a) * d, cy + Math.sin(a) * d, r * rng.range(0.42, 0.5), r * 0.3, a, 0.1));
    }
    const angle = rng.range(-1, -0.3);
    for (const s of ps) p.fill(s, petal, { width: 2.1, angle, base: 0.4 });
    for (const s of ps) p.outline(s, ln, 2.2);
  } else {
    p.shape(p.petals(cx, cy, r * 0.42, r, rng.int(8, 10), true), petal, { width: 2.1, base: 0.4, line: ln });
  }
  const ccx = cx + rng.range(-1, 1);
  const ccy = cy + rng.range(-1, 1);
  const cr = r * rng.range(0.32, 0.4);
  p.ball(ccx, ccy, cr, centre, 2.1);
  if (style === 1) {
    // A swirly middle, drawn round and round.
    const sp: Pt[] = [];
    for (let i = 0; i <= 22; i++) {
      const a = i * 0.55;
      const rr = (i / 22) * cr * 0.8;
      sp.push([ccx + Math.cos(a) * rr, ccy + Math.sin(a) * rr]);
    }
    p.stroke(sp, dk(centre, 0.5), 1.5, { even: true });
  }
}

function flower(p: ChildPen, petal: string, centre: string, style: PetalStyle, line?: string): void {
  const r = p.rng;
  const side = r.chance(0.5) ? 1 : -1;
  if (style === 1) {
    // Curvy stem, one big leaf, head leaning to one side.
    const top: Pt = [50 + side * r.range(5, 8), 33];
    const stem = bezierPts([50 - side * 2, G], [50 - side * 12, 62], top, 12);
    p.line(stem, CK.green, 4, 0.3);
    const s1 = stem[4];
    leaf(p, s1[0], s1[1], side > 0 ? -0.35 : Math.PI + 0.35, r.range(19, 23), 11, CK.lime);
    flowerHead(p, top[0], top[1], 19.5, petal, centre, style, line);
    return;
  }
  const top: Pt = [50 + r.range(-4, 4), 32];
  const mid: Pt = [50 + r.range(-6, 6), 64];
  const stem = bezierPts([50, G], mid, top, 10);
  p.line(stem, CK.green, 4, 0.35);
  const s1 = stem[3];
  const s2 = stem[5];
  leaf(p, s1[0], s1[1], side > 0 ? -0.5 : Math.PI + 0.5, r.range(15, 19), 9);
  leaf(p, s2[0], s2[1], side > 0 ? Math.PI + 0.55 : -0.55, r.range(12, 15), 8);
  flowerHead(p, top[0], top[1], 20.5, petal, centre, style, line);
}

/** A small flower on a short stem (for clumps). */
function tinyFlower(p: ChildPen, x: number, y: number, r: number, petal: string, centre: string, pointy = false): void {
  p.line([[x + p.rng.range(-2, 2), G], [x, y]], CK.green, 2.6, 0.3);
  const n = p.rng.int(5, 6);
  p.shape(p.petals(x, y, r * 0.5, r, pointy ? 8 : n, pointy), petal, { width: 1.8, base: 0.5, line: dk(petal, 0.55), w: 2 });
  p.dot(x, y, r * 0.38, centre);
}

/** Windows with a cross, the way every child draws them. */
function crossWindow(p: ChildPen, x: number, y: number, w: number, h: number, glass: string = CK.sky): void {
  p.shape(p.rect(x, y, w, h, 0.6), glass, { width: 2, w: 2.2 });
  p.line([[x + w / 2, y + 0.5], [x + w / 2, y + h - 0.5]], p.ink, 1.7);
  p.line([[x + 0.5, y + h / 2], [x + w - 0.5, y + h / 2]], p.ink, 1.7);
}

function houseKid(p: ChildPen, wall: string, roof: string, door: string, v: number): void {
  const r = p.rng;
  if (v === 0) {
    // Square house, big triangle roof, chimney, round attic window.
    p.shape(p.rect(64, 18, 9, 18, 0.6), CK.red, { angle: -1.4 });
    p.shape(p.rect(18, 52, 63, G - 52, 1.1), wall, { angle: r.range(-0.8, -0.3) });
    p.shape(p.poly([[10, 54], [50, 14], [90, 54]], 1.2), roof, { angle: r.range(0.2, 0.6), width: 2.6 });
    p.ball(50 + r.range(-2, 2), 40, 5.6, CK.yellow);
    crossWindow(p, 23, 59 + r.range(-1.5, 1.5), 13, 12);
    crossWindow(p, 63, 59 + r.range(-1.5, 1.5), 13, 12);
    p.shape(p.rect(43, 68, 13, G - 68, 0.5), door, { angle: -1.45 });
    p.dot(53, 81, 1.4);
  } else {
    // Tall two-storey house with an overhanging roof and four windows.
    p.shape(p.rect(30, 15, 8, 17, 0.6), CK.brown, { angle: -1.4 });
    p.shape(p.rect(23, 42, 54, G - 42, 1.2), wall, { angle: r.range(-1.2, -0.7) });
    p.shape(p.poly([[14, 44], [52, 12], [87, 44]], 1.3), roof, { angle: r.range(-0.3, 0.3), width: 2.6 });
    p.ball(51, 32, 4.6, CK.yellow);
    for (const [x, y] of [
      [28, 48],
      [60, 48],
      [28, 67],
      [60, 67],
    ] as const) {
      const yy = y + r.range(-1.2, 1.2);
      p.shape(p.rect(x, yy, 12, 11, 0.7), CK.yellow, { width: 2, w: 2.2 });
      p.line([[x + 0.5, yy + 5.5], [x + 11.5, yy + 5.5]], p.ink, 1.6);
    }
    p.shape(p.rect(44, 71, 12, G - 71, 0.5), door, { angle: -1.5 });
    p.dot(46.5, 82, 1.4);
    p.line([[38, G], [38, 85]], CK.green, 2.4);
    p.ball(38, 83, 2.9, CK.pink, 1.7);
  }
}

function pineTiers(p: ChildPen, color: string, snow: boolean, top = 10): void {
  const tiers = [
    { t: 52, b: 82, hw: 33 },
    { t: 33, b: 63, hw: 26 },
    { t: top, b: 44, hw: 19 },
  ];
  for (const ti of tiers) {
    const pts = p.poly(
      [
        [50, ti.t],
        [50 + ti.hw, ti.b],
        [50 + ti.hw * 0.3, ti.b + 2],
        [50 - ti.hw * 0.3, ti.b + 2],
        [50 - ti.hw, ti.b],
      ],
      1.1,
    );
    p.shape(pts, color, { width: 2.6, line: snow ? CK.navy : dk(color, 0.4) });
    if (snow) {
      const sy = ti.t + (ti.b - ti.t) * 0.42;
      const k = (sy - ti.t) / (ti.b - ti.t);
      const hw = ti.hw * k;
      const cap: Pt[] = [[50, ti.t + 0.5]];
      cap.push([50 + hw, sy]);
      for (let i = 1; i < 4; i++) {
        const x = 50 + hw - (i / 4) * hw * 2;
        cap.push([x, sy + (i % 2 ? 4 : 0.5)]);
      }
      cap.push([50 - hw, sy]);
      p.shape(p.poly(cap, 0.5, 0.6), CK.white, { line: CK.blue, w: 2, base: 0 });
    }
  }
}

function rockShape(p: ChildPen, cx: number, w: number, h: number, color: string, o: { crack?: boolean; spots?: boolean } = {}): Pt[] {
  const pts = p.sit(p.oval(cx, G - h * 0.55, w / 2, h * 0.75, 0.12, 20));
  p.shape(pts, color, { width: 2.4, angle: p.rng.range(-0.5, -0.1) });
  if (o.crack) p.line([[cx - w * 0.1, G - h * 0.9], [cx + w * 0.02, G - h * 0.6], [cx - w * 0.06, G - h * 0.35]], dk(color, 0.5), 1.8);
  if (o.spots) for (let i = 0; i < 3; i++) p.dot(cx + p.rng.range(-w * 0.25, w * 0.25), G - h * p.rng.range(0.3, 0.7), 1.2, dk(color, 0.4));
  return pts;
}

function cloudShape(p: ChildPen, cx: number, cy: number, rx: number, ry: number): void {
  const pts = p.bumpy(cx, cy, rx, ry, p.rng.int(7, 8), 0.3);
  p.shape(pts, CK.white, { line: CK.blue, base: 0, width: 2 });
  p.scribble(
    pts.filter(([, y]) => y > cy),
    CK.sky,
    { angle: -0.2, width: 2, alpha: 0.45 },
  );
}

function water(p: ChildPen, top: number): void {
  const pts: Pt[] = [];
  for (let x = 11; x <= 89; x += 5) pts.push([x, top + Math.sin(x * 0.4) * 1.8]);
  pts.push([89, G], [11, G]);
  p.shape(p.hand(pts, true, 0.4), CK.blue, { angle: -0.1, width: 2.4, line: CK.navy });
}

function legs(p: ChildPen, xs: number[], top: number, color: string = CK.black, w = 3.6): void {
  for (const x of xs) p.line([[x, top], [x + p.rng.range(-1, 1), G - 0.5]], color, w, 0.3);
}

const VISITORS: PersonLook[] = [
  { skin: "#eab68a", hair: "#2f2420", hairStyle: "pigtails", shirt: CK.pink, pants: CK.navy, shoes: CK.red, dress: true, hat: null },
  { skin: "#b07a4e", hair: "#2f2420", hairStyle: "curly", shirt: CK.teal, pants: "#5b5f8f", shoes: CK.black, hat: null },
  { ...lookFromSeed(3), skin: "#f6cfa8", hair: "#c8752f", hairStyle: "short", shirt: CK.orange, pants: CK.brown, shoes: CK.blue, dress: false, hat: CK.yellow },
];

// ---------------------------------------------------------------------------
// Drawers (index = variant)
// ---------------------------------------------------------------------------

export const CHILD_DRAWERS: Record<SceneryArtId, ChildDrawer[]> = {
  // --- trees ---------------------------------------------------------------
  tree_round: [
    (p) => {
      trunk(p, 50, 54, 15);
      p.shape(p.bumpy(50, 37, 37, 26, p.rng.int(7, 9), 0.22), CK.green, { width: 2.7, line: dk(CK.green) });
    },
    (p) => {
      trunk(p, 50, 52, 10, CK.tan, { hole: true });
      p.shape(p.oval(50, 35, 30, 26, 0.1), CK.lime, { angle: -1.45, width: 2.4, line: dk(CK.green) });
    },
    (p) => {
      trunk(p, 50, 58, 13);
      p.tube([[50, 68], [38, 54]], CK.brown, 3.4, dk(CK.brown, 0.55));
      p.tube([[51, 64], [63, 52]], CK.brown, 3.4, dk(CK.brown, 0.55));
      circleCrown(
        p,
        [
          [32, 47, 17],
          [68, 46, 17],
          [50, 30, 20],
        ],
        CK.forest,
      );
    },
  ],

  tree_pine: [
    (p) => {
      trunk(p, 50, 78, 10);
      pineTiers(p, CK.forest, false);
    },
    (p) => {
      trunk(p, 50, 80, 9, CK.brown);
      // One tall zig-zag "Christmas tree" triangle.
      const pts: Pt[] = [[50, 9]];
      const steps = 5;
      for (let i = 1; i <= steps; i++) {
        const y = 9 + (i / steps) * 74;
        const hw = 6 + (i / steps) * 31;
        pts.push([50 + hw * 0.62, y - 4], [50 + hw, y]);
      }
      const left: Pt[] = [];
      for (let i = steps; i >= 1; i--) {
        const y = 9 + (i / steps) * 74;
        const hw = 6 + (i / steps) * 31;
        left.push([50 - hw, y], [50 - hw * 0.62, y - 4]);
      }
      p.shape(p.poly([...pts, ...left], 0.8, 0.8), CK.green, { width: 2.6, angle: -0.2, line: dk(CK.forest, 0.3) });
    },
  ],

  tree_cherry: [
    (p) => {
      trunk(p, 50, 56, 13, CK.brown);
      p.tube([[49, 64], [36, 50]], CK.brown, 3.4, dk(CK.brown, 0.55));
      p.tube([[52, 62], [64, 50]], CK.brown, 3.4, dk(CK.brown, 0.55));
      const crown = p.bumpy(50, 40, 34, 24, p.rng.int(8, 10), 0.24);
      p.shape(crown, CK.pink, { width: 2.4, line: CK.rose, loops: true });
      for (let i = 0; i < 12; i++) {
        const a = p.rng.range(0, Math.PI * 2);
        const rr = p.rng.range(0, 0.75);
        const x = 50 + Math.cos(a) * 34 * rr;
        const y = 38 + Math.sin(a) * 22 * rr;
        p.dot(x, y, p.rng.range(1.6, 2.4), i % 3 ? CK.white : CK.rose);
      }
    },
  ],

  tree_fruit: [
    (p) => {
      trunk(p, 50, 58, 14);
      p.shape(p.bumpy(50, 38, 37, 27, p.rng.int(8, 9), 0.2), CK.green, { width: 2.6, line: dk(CK.green) });
      for (const [x, y] of [
        [34, 32],
        [55, 24],
        [67, 40],
        [42, 50],
        [27, 46],
        [59, 52],
      ]) {
        p.ball(x + p.rng.range(-1.5, 1.5), y + p.rng.range(-1.5, 1.5), 4.2, CK.red, 1.9);
      }
    },
    (p) => {
      trunk(p, 50, 54, 10, CK.tan);
      p.shape(p.oval(50, 36, 29, 27, 0.1), CK.lime, { width: 2.4, line: dk(CK.green) });
      for (const [x, y] of [
        [38, 28],
        [58, 24],
        [62, 44],
        [42, 46],
        [50, 36],
      ]) {
        p.ball(x + p.rng.range(-1.5, 1.5), y + p.rng.range(-1.5, 1.5), 4.4, CK.orange, 1.9);
      }
      p.ball(66, G - 4, 4, CK.orange, 1.9);
    },
  ],

  tree_birch: [
    (p) => {
      const tr = p.poly([[46, 40], [54, 40], [55.5, G], [44, G]], 0.4);
      p.shape(tr, CK.white, { base: 0, line: CK.black });
      for (let y = 50; y < G - 4; y += 8) {
        const left = p.rng.chance(0.5);
        const x0 = left ? 44.5 : 50.5;
        p.line([[x0, y], [x0 + 4.5, y + 0.6]], CK.black, 2.2);
      }
      p.shape(p.oval(50, 34, 19, 26, 0.14), CK.yellow, { width: 2.3, base: 0.3, line: dk(CK.green, 0.3) });
      p.scribble(p.oval(50, 34, 17, 24, 0.14), CK.lime, { width: 2.2, alpha: 0.85 });
    },
  ],

  palm: [
    (p) => {
      const pts: Pt[] = [
        [42, G],
        [41, 70],
        [45, 46],
        [53, 28],
        [59, 30],
        [52, 48],
        [50, 70],
        [53, G],
      ];
      p.shape(p.poly(pts, 0.6), CK.tan, { angle: -1.3, line: dk(CK.tan, 0.55) });
      for (let y = 40; y < 88; y += 7) p.line([[42 + (88 - y) * 0.05 - (y < 55 ? -4 : 0), y], [51 + (y < 55 ? 3 : 0), y - 1.5]], dk(CK.tan, 0.45), 1.6);
      const top: Pt = [56, 27];
      const fronds: Array<[number, number]> = [
        [Math.PI + 0.3, 30],
        [Math.PI + 0.95, 24],
        [-1.45, 18],
        [-0.75, 26],
        [-0.1, 30],
        [0.55, 22],
        [Math.PI - 0.5, 22],
      ];
      for (const [a, len] of fronds) leaf(p, top[0], top[1], a, len, 11, p.rng.pick([CK.green, CK.forest, CK.lime]));
      p.ball(52, 32, 3.6, CK.brown, 1.8);
      p.ball(59, 33, 3.6, CK.brown, 1.8);
    },
  ],

  // --- bushes, plants ------------------------------------------------------
  bush: [
    (p) => {
      p.shape(p.sit(p.bumpy(50, 74, 37, 23, p.rng.int(7, 9), 0.24)), CK.green, { width: 2.6, line: dk(CK.green) });
    },
    (p) => {
      circleCrown(
        p,
        [
          [27, 78, 16],
          [73, 78, 16],
          [50, 71, 21],
        ],
        CK.lime,
        { line: dk(CK.green) },
      );
      p.line([[12, G], [88, G]], CK.forest, 2.8);
    },
    (p) => {
      p.shape(p.sit(p.oval(50, 76, 36, 20, 0.1)), CK.forest, { angle: -0.05, width: 2.4, line: dk(CK.forest, 0.35) });
      for (const [x, y] of [
        [36, 72],
        [61, 68],
      ])
        p.ball(x, y, 3.5, CK.yellow, 1.7);
    },
  ],

  bush_berry: [
    (p) => {
      p.shape(p.sit(p.bumpy(50, 74, 37, 23, p.rng.int(8, 9), 0.22)), CK.forest, { width: 2.6, line: dk(CK.forest, 0.35) });
      for (let i = 0; i < 9; i++) {
        const x = 20 + ((i * 37) % 60) + p.rng.range(-2, 2);
        const y = 62 + ((i * 13) % 26) + p.rng.range(-2, 2);
        p.ball(x, y, 3, i % 3 === 0 ? CK.red : CK.purple, 1.6);
      }
    },
  ],

  flower_red: [(p) => flower(p, CK.red, CK.yellow, 0), (p) => flower(p, CK.red, CK.black, 1)],
  flower_yellow: [(p) => flower(p, CK.yellow, CK.orange, 1), (p) => flower(p, CK.yellow, CK.brown, 2)],
  flower_blue: [(p) => flower(p, CK.blue, CK.yellow, 0), (p) => flower(p, CK.sky, CK.yellow, 1)],
  flower_pink: [(p) => flower(p, CK.pink, CK.yellow, 1), (p) => flower(p, CK.pink, CK.red, 0)],
  flower_white: [(p) => flower(p, CK.white, CK.yellow, 2, CK.grey), (p) => flower(p, CK.white, CK.orange, 1, CK.grey)],
  flower_orange: [(p) => flower(p, CK.orange, CK.yellow, 0), (p) => flower(p, CK.orange, CK.brown, 2)],
  flower_purple: [(p) => flower(p, CK.purple, CK.yellow, 1), (p) => flower(p, CK.lilac, CK.purple, 0)],

  tulip: [
    (p) => {
      p.line(bezierPts([50, G], [48, 66], [50, 44], 8), CK.green, 4, 0.3);
      leaf(p, 49, G - 2, -1.15, 38, 11);
      leaf(p, 51, G - 2, -2.1, 30, 10);
      const cup = p.poly(
        [
          [34, 20],
          [42, 28],
          [50, 15],
          [58, 28],
          [66, 20],
          [65, 37],
          [59, 45],
          [50, 47],
          [41, 45],
          [35, 37],
        ],
        0.6,
        0.8,
      );
      p.shape(cup, CK.rose, { angle: -1.3, width: 2.4, line: dk(CK.rose, 0.5) });
    },
  ],

  sunflower: [
    (p) => {
      p.line(bezierPts([50, G], [53, 64], [50, 40], 10), CK.green, 4.6, 0.3);
      leaf(p, 51, 72, -0.45, 20, 11);
      leaf(p, 50, 62, Math.PI + 0.45, 18, 10);
      p.shape(p.petals(50, 33, 12, 24, 13, true), CK.yellow, { width: 2.2, base: 0.5, line: dk(CK.orange, 0.3) });
      const c = p.oval(50, 33, 11.5, 11, 0.06);
      p.shape(c, CK.brown, { width: 2, line: dk(CK.brown, 0.5) });
      for (let i = 0; i < 6; i++) p.dot(50 + p.rng.range(-6.5, 6.5), 33 + p.rng.range(-6, 6), 1.1, dk(CK.brown, 0.6));
    },
    (p) => {
      p.line([[50, G], [50, 38]], CK.green, 4.6, 0.6);
      leaf(p, 50, 70, -0.5, 18, 10);
      leaf(p, 50, 78, Math.PI + 0.5, 18, 10);
      flowerHead(p, 50, 32, 23, CK.yellow, CK.brown, 1, dk(CK.orange, 0.35));
      p.smile(50, 33, 8);
    },
  ],

  daisy_cluster: [
    (p) => {
      grassBlades(p, 16, 84, 22);
      tinyFlower(p, 30, 46, 11, CK.white, CK.yellow, true);
      tinyFlower(p, 68, 40, 12, CK.white, CK.yellow, true);
      tinyFlower(p, 49, 60, 10, CK.white, CK.orange, true);
    },
  ],

  wildflowers: [
    (p) => {
      grassBlades(p, 12, 88, 20);
      const cols = [CK.red, CK.yellow, CK.blue, CK.pink, CK.purple, CK.white];
      const spots: Array<[number, number, number]> = [
        [18, 66, 7],
        [32, 52, 8],
        [47, 68, 7],
        [60, 50, 8.5],
        [74, 64, 7],
        [84, 74, 6],
      ];
      spots.forEach(([x, y, r], i) => tinyFlower(p, x, y, r, cols[i % cols.length], i % 2 ? CK.orange : CK.yellow, i === 5));
    },
    (p) => {
      grassBlades(p, 14, 86, 18, CK.lime);
      const spots: Array<[number, number, number, string]> = [
        [22, 58, 8.5, CK.orange],
        [40, 70, 6.5, CK.lilac],
        [55, 54, 9, CK.red],
        [72, 66, 7, CK.yellow],
        [83, 54, 6.5, CK.pink],
      ];
      for (const [x, y, r, c] of spots) tinyFlower(p, x, y, r, c, c === CK.yellow ? CK.orange : CK.yellow);
    },
  ],

  mushroom: [
    (p) => {
      p.shape(p.rect(40, 54, 20, G - 54, 1), CK.white, { base: 0.6, line: CK.black, angle: -1.4 });
      p.smile(50, 72, 9);
      const cap: Pt[] = [];
      for (let i = 0; i <= 14; i++) {
        const a = Math.PI + (i / 14) * Math.PI;
        cap.push([50 + Math.cos(a) * 36, 56 + Math.sin(a) * 34]);
      }
      const c = p.poly(cap, 0.6, 1);
      p.shape(c, CK.red, { angle: -0.6 });
      for (const [x, y, r] of [
        [32, 46, 4],
        [50, 32, 5],
        [66, 44, 4.5],
        [44, 48, 3],
      ])
        p.ball(x, y, r, CK.white, 1.6);
    },
    (p) => {
      // Two mushrooms: a big brown one and a little orange one.
      p.shape(p.rect(31, 58, 14, G - 58, 0.8), CK.white, { base: 0.5, angle: -1.4 });
      p.shape(p.sit(p.oval(38, 58, 26, 15, 0.08), 59), CK.brown, { angle: -0.4, line: CK.black });
      p.shape(p.rect(63, 74, 9, G - 74, 0.6), CK.white, { base: 0.5, angle: -1.4 });
      p.shape(p.sit(p.oval(67.5, 74, 15, 10, 0.08), 75), CK.orange, { angle: -0.4 });
      p.dot(64, 68, 1.6, CK.white);
      p.dot(71, 70, 1.4, CK.white);
    },
  ],

  grass_tuft: [
    (p) => {
      const pts: Pt[] = [[12, G]];
      const n = 7;
      for (let i = 0; i < n; i++) {
        const x = 14 + ((i + 0.5) / n) * 72;
        pts.push([x - 4, G - 8], [x + p.rng.range(-3, 3), G - p.rng.range(28, 42)], [x + 4, G - 8]);
      }
      pts.push([88, G]);
      p.shape(p.poly(pts, 0.4, 0.4), CK.green, { width: 2.2, angle: -1.45, line: dk(CK.green), w: 2.4 });
    },
    (p) => {
      for (let i = 0; i < 6; i++) {
        const x = 18 + i * 12.5 + p.rng.range(-2, 2);
        const h = p.rng.range(26, 40);
        const lean = p.rng.range(-8, 8);
        p.line([[x - 3.5, G], [x + lean, G - h], [x + 3.5, G]], i % 2 ? CK.green : CK.forest, 3.6, 0.3);
      }
    },
    (p) => {
      const pts: Pt[] = [[14, G]];
      for (let i = 0; i < 5; i++) {
        const x = 18 + i * 15;
        const h = p.rng.range(22, 32);
        pts.push(...bezierPts([x - 3, G - 4], [x + 2, G - h * 1.5], [x + 9, G - 4], 6));
      }
      pts.push([90, G]);
      p.shape(p.hand(pts, true, 0.4), CK.lime, { width: 2.2, angle: -1.3, line: dk(CK.green), w: 2.4 });
    },
  ],

  grass_tall: [
    (p) => {
      const pts: Pt[] = [[22, G]];
      const n = 6;
      for (let i = 0; i < n; i++) {
        const x = 24 + ((i + 0.5) / n) * 52;
        const lean = p.rng.range(-7, 7);
        pts.push([x - 3.5, G - 12], [x + lean, p.rng.range(10, 30)], [x + 3.5, G - 12]);
      }
      pts.push([78, G]);
      p.shape(p.poly(pts, 0.5, 0.5), CK.green, { width: 2.2, angle: -1.5, line: dk(CK.green), w: 2.4 });
    },
    (p) => {
      for (let i = 0; i < 7; i++) {
        const x = 26 + i * 8 + p.rng.range(-2, 2);
        const top = p.rng.range(10, 32);
        const bend = p.rng.range(-12, 12);
        p.line(bezierPts([x, G], [x + bend * 0.2, (G + top) / 2], [x + bend, top], 8), [CK.green, CK.forest, CK.lime][i % 3], 3.6, 0.6);
      }
    },
  ],

  fern: [
    (p) => {
      const fronds: Array<[Pt, Pt]> = [
        [[30, 46], [12, 30]],
        [[70, 44], [88, 30]],
        [[46, 40], [44, 10]],
      ];
      for (const [c, end] of fronds) {
        const spine = bezierPts([50, G], c, end, 12);
        p.line(spine, CK.forest, 2.6, 0.2);
        for (let i = 2; i < spine.length - 1; i++) {
          const [x, y] = spine[i];
          const [nx, ny] = spine[i + 1];
          const a = Math.atan2(ny - y, nx - x);
          const len = 9 * (1 - i / spine.length) + 3;
          for (const sgn of [-1, 1]) leaf(p, x, y, a + sgn * 1.1, len, len * 0.55, CK.green);
        }
      }
    },
  ],

  reed: [
    (p) => {
      leaf(p, 46, G - 1, -1.95, 46, 9);
      leaf(p, 54, G - 1, -1.2, 40, 9);
      for (const [x0, x1, top] of [
        [40, 34, 22],
        [50, 52, 12],
        [60, 66, 26],
      ] as const) {
        p.line([[x0, G], [x1, top]], CK.forest, 3, 0.4);
        p.shape(p.ovalRot(x1 + (x1 - x0) * 0.04, top + 9, 4, 10, (x1 - x0) * 0.02), CK.brown, { angle: -1.5, width: 2 });
      }
    },
  ],

  // --- rocks ---------------------------------------------------------------
  rock: [
    (p) => {
      rockShape(p, 50, 74, 34, CK.grey, { crack: true });
    },
    (p) => {
      rockShape(p, 40, 56, 34, CK.stone, { spots: true });
      rockShape(p, 74, 30, 18, dk(CK.sky, 0.3));
    },
  ],

  pebbles: [
    (p) => {
      rockShape(p, 22, 22, 14, CK.grey);
      rockShape(p, 44, 26, 18, CK.stone, { spots: true });
      rockShape(p, 64, 18, 11, dk(CK.sky, 0.25));
      rockShape(p, 80, 20, 15, CK.tan);
    },
    (p) => {
      rockShape(p, 28, 30, 18, CK.stone);
      rockShape(p, 54, 20, 13, CK.peach);
      rockShape(p, 74, 26, 16, CK.grey, { crack: true });
    },
  ],

  boulder: [
    (p) => {
      rockShape(p, 44, 74, 60, CK.grey, { crack: true });
      p.line([[60, 50], [66, 58], [63, 66]], dk(CK.grey, 0.5), 1.8);
      rockShape(p, 80, 22, 18, CK.stone);
      p.line([[16, G], [18, G - 7]], CK.green, 2.4);
      p.line([[20, G], [23, G - 9]], CK.green, 2.4);
    },
  ],

  // --- houses & buildings -------------------------------------------------
  house_red: [(p) => houseKid(p, CK.red, CK.navy, CK.brown, 0), (p) => houseKid(p, CK.red, CK.brown, CK.blue, 1)],
  house_blue: [(p) => houseKid(p, CK.blue, CK.red, CK.yellow, 0), (p) => houseKid(p, CK.sky, CK.orange, CK.red, 1)],
  house_yellow: [(p) => houseKid(p, CK.yellow, CK.red, CK.teal, 0), (p) => houseKid(p, CK.yellow, CK.purple, CK.green, 1)],

  cottage: [
    (p) => {
      p.shape(p.rect(20, 54, 60, G - 54, 1), CK.peach, { angle: -0.5 });
      // Round thatched roof like a hat.
      const roof: Pt[] = [];
      for (let i = 0; i <= 14; i++) {
        const a = Math.PI + (i / 14) * Math.PI;
        roof.push([50 + Math.cos(a) * 40, 56 + Math.sin(a) * 36]);
      }
      p.shape(p.poly(roof, 0.8, 1.2), CK.yellow, { angle: -1.5, width: 2.2 });
      for (let x = 24; x < 78; x += 9) p.line([[x, 50], [x + 2, 26 + Math.abs(x - 50) * 0.5]], dk(CK.yellow, 0.35), 1.6);
      const door: Pt[] = [[42, G], [42, 72], ...bezierPts([42, 72], [50, 62], [58, 72], 6).slice(1), [58, G]];
      p.shape(p.poly(door, 0.4, 0.5), CK.green, { angle: -1.4 });
      p.dot(55, 82, 1.4);
      crossWindow(p, 25, 62, 11, 11);
      crossWindow(p, 65, 62, 11, 11);
      for (const x of [26, 31, 70, 75]) p.ball(x, 78, 2.6, p.rng.pick([CK.red, CK.pink, CK.purple]), 1.6);
    },
  ],

  barn: [
    (p) => {
      const body = p.poly(
        [
          [12, G],
          [12, 46],
          [26, 24],
          [50, 11],
          [74, 24],
          [88, 46],
          [88, G],
        ],
        1,
      );
      p.shape(body, CK.red, { angle: -1.2 });
      p.line([[9, 47], [26, 23], [50, 10], [74, 23], [91, 47]], CK.white, 3.4);
      p.shape(p.rect(42, 27, 16, 14, 0.6), CK.yellow, { width: 2 });
      const door = p.rect(32, 56, 36, G - 56, 0.8);
      p.shape(door, CK.white, { base: 0, line: CK.black });
      p.line([[33, 57], [67, G - 1]], CK.red, 2.6);
      p.line([[67, 57], [33, G - 1]], CK.red, 2.6);
      p.line([[50, 57], [50, G - 1]], CK.black, 2);
    },
  ],

  windmill: [
    (p) => {
      p.shape(p.poly([[37, 39], [63, 39], [72, G], [28, G]], 0.8), CK.white, { base: 0.5, angle: -1.4, line: CK.black });
      p.shape(p.rect(45, 76, 10, G - 76, 0.5), CK.brown, { angle: -1.5 });
      p.ball(50, 59, 4.6, CK.yellow, 1.9);
      p.shape(p.poly([[32, 40], [50, 25], [68, 40]], 0.6), CK.red);
      const hub: Pt = [50, 36];
      for (let i = 0; i < 4; i++) {
        const a = Math.PI / 4 + (i * Math.PI) / 2 + 0.12;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const nx = -sa;
        const ny = ca;
        const r0 = 5;
        const r1 = 25;
        const w = 4.2;
        const blade: Pt[] = [
          [hub[0] + ca * r0, hub[1] + sa * r0],
          [hub[0] + ca * r1, hub[1] + sa * r1],
          [hub[0] + ca * r1 + nx * w * 2, hub[1] + sa * r1 + ny * w * 2],
          [hub[0] + ca * (r0 + 4) + nx * w * 2, hub[1] + sa * (r0 + 4) + ny * w * 2],
        ];
        p.shape(p.poly(blade, 0.4, 0.6), CK.tan, { width: 2, angle: a + 1.57 });
        for (const t of [0.45, 0.75]) {
          const x = hub[0] + ca * (r0 + (r1 - r0) * t);
          const y = hub[1] + sa * (r0 + (r1 - r0) * t);
          p.line([[x, y], [x + nx * w * 2, y + ny * w * 2]], CK.black, 1.5);
        }
      }
      p.ball(hub[0], hub[1], 3.4, CK.black, 1.5);
    },
  ],

  well: [
    (p) => {
      p.line([[31, 64], [31, 30]], CK.brown, 3.6, 0.3);
      p.line([[69, 64], [69, 30]], CK.brown, 3.6, 0.3);
      p.line([[31, 38], [69, 38]], CK.brown, 2.4, 0.2);
      p.line([[50, 38], [50, 50]], CK.black, 1.6, 0.1);
      p.shape(p.rect(44, 48, 12, 9, 0.5), CK.blue, { width: 2 });
      p.shape(p.poly([[20, 33], [50, 12], [80, 33]], 0.8), CK.red, { angle: 0.4 });
      const base = p.rect(24, 60, 52, G - 60, 1);
      p.shape(base, CK.stone, { angle: -0.3 });
      for (const [x, y] of [
        [30, 68],
        [46, 66],
        [60, 70],
        [36, 80],
        [54, 82],
        [66, 80],
      ])
        p.outline(p.rect(x, y, 9, 6, 0.4), dk(CK.stone, 0.5), 1.6);
    },
  ],

  fence: [
    (p) => {
      p.line([[8, 72], [92, 71]], CK.brown, 4.4, 0.4);
      p.line([[8, 84], [92, 85]], CK.brown, 4.4, 0.4);
      for (let i = 0; i < 6; i++) {
        const x = 10 + i * 14 + p.rng.range(-1, 1);
        const top = 62 + p.rng.range(-2.5, 2.5);
        p.shape(p.poly([[x, top + 5], [x + 5, top], [x + 10, top + 5], [x + 10, G], [x, G]], 0.5, 0.6), CK.tan, { angle: -1.5, width: 2, w: 2.2 });
      }
    },
  ],

  haystack: [
    (p) => {
      const pts: Pt[] = [];
      for (let i = 0; i <= 14; i++) {
        const a = Math.PI + (i / 14) * Math.PI;
        pts.push([50 + Math.cos(a) * 38, G + Math.sin(a) * 40]);
      }
      const h = p.poly(pts, 0.8, 1);
      p.shape(h, CK.yellow, { angle: -1.5, width: 2.2, line: dk(CK.orange, 0.3) });
      for (let i = 0; i < 9; i++) {
        const x = 22 + i * 7 + p.rng.range(-1, 1);
        const y = 62 + p.rng.range(-8, 18);
        p.line([[x, y], [x + p.rng.range(-2, 2), y + 6]], dk(CK.yellow, 0.35), 1.6);
      }
    },
  ],

  scarecrow: [
    (p) => {
      p.line([[50, G], [50, 50]], CK.brown, 4.4, 0.3);
      p.line([[16, 46], [84, 46]], CK.brown, 3.4, 0.4);
      p.shape(p.poly([[37, 40], [63, 40], [66, 70], [34, 70]], 0.8), CK.blue, { angle: -1.2 });
      p.shape(p.rect(42, 55, 8, 8, 0.4), CK.red, { width: 1.8, w: 1.8 });
      p.shape(p.poly([[37, 41], [18, 45], [18, 52], [37, 50]], 0.6), CK.blue, { angle: -0.2, w: 2.2 });
      p.shape(p.poly([[63, 41], [82, 45], [82, 52], [63, 50]], 0.6), CK.blue, { angle: -0.2, w: 2.2 });
      for (const [x, d] of [
        [17, -1],
        [83, 1],
      ] as const)
        for (const dy of [-3, 0, 3]) p.line([[x, 48.5], [x + d * 6, 48.5 + dy * 1.3]], dk(CK.yellow, 0.2), 2);
      p.shape(p.oval(50, 30, 10, 10, 0.08), CK.tan, { angle: -0.5 });
      p.smile(50, 31, 8);
      p.shape(p.rect(34, 19, 32, 4, 0.6), CK.brown, { width: 2 });
      p.shape(p.poly([[39, 20], [41, 9], [59, 9], [61, 20]], 0.6), CK.brown, { width: 2 });
    },
  ],

  pumpkin: [
    (p) => {
      p.line([[51, 52], [53, 42], [58, 38]], CK.green, 4, 0.3);
      const body = p.sit(p.oval(50, 72, 36, 22, 0.08), G);
      p.shape(body, CK.orange, { angle: -1.4 });
      for (const dx of [-14, 0, 14]) p.line(bezierPts([50 + dx * 0.4, 53], [50 + dx * 1.5, 72], [50 + dx * 0.5, G - 1], 6), dk(CK.orange, 0.4), 2);
      leaf(p, 54, 52, -0.4, 14, 8);
    },
  ],

  cabbage_row: [
    (p) => {
      p.line([[8, G - 1], [92, G - 1]], CK.brown, 3.4, 0.4);
      for (const x of [22, 50, 78]) {
        const c = p.sit(p.oval(x, G - 13, 14, 13, 0.1));
        p.shape(c, CK.lime, { width: 2.2, line: dk(CK.green) });
        p.line(bezierPts([x - 6, G - 6], [x, G - 24], [x + 6, G - 6], 6), dk(CK.green, 0.3), 1.8);
        p.line(bezierPts([x - 2, G - 6], [x + 1, G - 17], [x + 3, G - 6], 5), dk(CK.green, 0.3), 1.6);
      }
    },
  ],

  // --- animals -------------------------------------------------------------
  cow: [
    (p) => {
      legs(p, [30, 38, 58, 66], 70, CK.black, 4.2);
      p.line(bezierPts([20, 56], [12, 62], [14, 74], 6), CK.black, 2);
      p.dot(14, 75, 2.6);
      const body = p.rect(20, 46, 52, 28, 1.4);
      p.shape(body, CK.white, { base: 0, line: CK.black });
      for (const [x, y, rx, ry] of [
        [32, 56, 7, 5],
        [55, 52, 6, 4.5],
        [48, 66, 5, 4],
      ])
        p.tint(p.oval(x, y, rx, ry, 0.25, 14), CK.black);
      p.shape(p.oval(53, 75, 5, 3, 0.1), CK.pink, { width: 1.6, w: 1.8 });
      // Head
      p.shape(p.poly([[69, 40], [74, 33], [77, 40]], 0.3, 0.3), CK.yellow, { width: 1.5, w: 1.8 });
      p.shape(p.poly([[80, 40], [85, 33], [86, 41]], 0.3, 0.3), CK.yellow, { width: 1.5, w: 1.8 });
      p.shape(p.oval(78, 50, 12, 11, 0.08), CK.white, { base: 0 });
      p.shape(p.oval(81, 58, 9, 5.5, 0.08), CK.pink, { width: 1.8 });
      p.dot(78, 58, 1.1);
      p.dot(84, 58, 1.1);
      p.dot(74, 47, 1.5);
      p.dot(83, 46, 1.5);
    },
  ],

  sheep: [
    (p) => {
      legs(p, [33, 42, 58, 66], 70, CK.black, 4);
      const wool = p.bumpy(48, 60, 30, 18, 10, 0.32);
      p.shape(wool, CK.white, { base: 0, line: CK.black, loops: true });
      p.scribble(wool, CK.grey, { loops: true, width: 1.8, alpha: 0.5 });
      p.shape(p.ovalRot(78, 52, 10, 8, 0.4), CK.black, { flat: true, line: CK.black });
      p.shape(p.ovalRot(70, 46, 5, 2.6, -0.5), CK.black, { flat: true });
      p.dot(81, 50, 1.6, CK.white);
    },
  ],

  chicken: [
    (p) => {
      for (const x of [44, 56]) {
        p.line([[x, 76], [x, G - 1]], CK.orange, 2.8, 0.2);
        p.line([[x - 4, G], [x + 4, G]], CK.orange, 2.4, 0.2);
      }
      const body: Pt[] = p.poly(
        [
          [20, 46],
          [30, 54],
          [46, 52],
          [58, 34],
          [70, 30],
          [76, 40],
          [74, 58],
          [64, 74],
          [44, 80],
          [28, 72],
          [20, 58],
        ],
        0.8,
      );
      p.shape(p.hand(body, true, 0.6, 3), CK.white, { base: 0, line: CK.black });
      p.shape(p.bumpy(64, 26, 7, 5, 3, 0.4), CK.red, { width: 1.8, w: 2 });
      p.shape(p.poly([[75, 37], [86, 41], [75, 45]], 0.3, 0.3), CK.yellow, { width: 1.6, w: 2 });
      p.shape(p.oval(74, 49, 2.6, 4, 0.1), CK.red, { flat: true, w: 1.6 });
      p.dot(69, 37, 1.7);
      p.line(bezierPts([36, 58], [46, 72], [56, 58], 6), CK.black, 2);
    },
  ],

  duck: [
    (p) => {
      const body = p.poly(
        [
          [16, 58],
          [28, 66],
          [52, 64],
          [56, 48],
          [52, 36],
          [60, 26],
          [72, 28],
          [76, 40],
          [68, 54],
          [80, 62],
          [74, 80],
          [50, G - 1],
          [28, 86],
          [18, 74],
        ],
        0.6,
      );
      p.shape(p.hand(body, true, 0.6, 3), CK.yellow, { angle: -0.4 });
      p.shape(p.poly([[74, 35], [87, 37], [86, 42], [74, 42]], 0.4, 0.3), CK.orange, { width: 1.6, w: 2 });
      p.dot(66, 34, 1.8);
      p.line(bezierPts([34, 70], [48, 82], [62, 68], 6), dk(CK.orange, 0.3), 2.2);
    },
  ],

  butterfly: [
    (p) => {
      p.line([[50, G], [51, 76], [50, 62]], CK.green, 3, 0.3);
      leaf(p, 50.5, 80, -0.5, 12, 7);
      const wings: Array<[number, number, number, number, string]> = [
        [33, 32, 17, 15, CK.purple],
        [67, 32, 17, 15, CK.purple],
        [37, 52, 12, 10, CK.pink],
        [63, 52, 12, 10, CK.pink],
      ];
      for (const [x, y, rx, ry, c] of wings) p.shape(p.oval(x, y, rx, ry, 0.1), c, { width: 2.2 });
      for (const [x, y, r] of [
        [31, 30, 5],
        [69, 30, 5],
        [37, 53, 3.6],
        [63, 53, 3.6],
      ])
        p.ball(x, y, r, CK.yellow, 1.6);
      p.shape(p.oval(50, 42, 3.6, 17, 0.06), CK.black, { flat: true });
      p.line(bezierPts([49, 26], [44, 16], [39, 14], 5), CK.black, 1.8);
      p.line(bezierPts([51, 26], [56, 16], [61, 14], 5), CK.black, 1.8);
      p.dot(39, 14, 2);
      p.dot(61, 14, 2);
    },
  ],

  bird: [
    (p) => {
      p.line([[14, G - 6], [86, G - 9]], CK.brown, 4.2, 0.3);
      leaf(p, 24, G - 7, -2.2, 10, 6);
      p.line([[46, 72], [45, G - 8]], CK.orange, 2.2, 0.1);
      p.line([[56, 72], [57, G - 9]], CK.orange, 2.2, 0.1);
      p.shape(p.poly([[32, 58], [14, 50], [16, 64]], 0.4, 0.4), CK.blue, { width: 2 });
      p.shape(p.oval(50, 60, 21, 14, 0.08), CK.blue, { angle: -0.3 });
      p.shape(p.oval(67, 46, 11, 10, 0.08), CK.blue, { angle: -0.3 });
      p.shape(p.poly([[76, 43], [87, 47], [76, 51]], 0.3, 0.3), CK.orange, { width: 1.6, w: 2 });
      p.dot(70, 43, 1.8);
      // Wing up like a "V" a child draws.
      p.shape(p.poly([[42, 56], [32, 28], [58, 52]], 0.6, 0.8), CK.sky, { width: 2 });
    },
  ],

  // --- picnic, beach, village things ----------------------------------------
  picnic_blanket: [
    (p) => {
      const b = p.poly([[20, 72], [80, 72], [90, G], [10, G]], 0.8);
      p.shape(b, CK.red, { angle: 0, width: 2.4 });
      for (const t of [0.33, 0.66]) {
        p.line([[20 + 60 * t, 72.5], [10 + 80 * t, G - 0.5]], CK.white, 2.4);
      }
      p.line([[16, 82.5], [85, 82.5]], CK.white, 2.4);
    },
  ],

  picnic_basket: [
    (p) => {
      p.stroke(p.hand(bezierPts([30, 60], [50, 16], [70, 60], 12), false, 0.4), CK.black, 6.6, { even: true });
      p.stroke(p.hand(bezierPts([30, 60], [50, 16], [70, 60], 12), false, 0.3), CK.tan, 3.6, { even: true });
      const body = p.poly([[22, 58], [78, 58], [72, G], [28, G]], 0.8);
      p.shape(body, CK.tan, { angle: -1.4 });
      for (const y of [68, 78, 87]) p.line([[25, y], [75, y]], dk(CK.tan, 0.45), 1.7);
      for (const x of [36, 50, 64]) p.line([[x, 59], [x - (x - 50) * 0.1, G - 1]], dk(CK.tan, 0.45), 1.7);
      p.shape(p.poly([[24, 56], [44, 50], [60, 54], [76, 54], [76, 61], [24, 61]], 0.5), CK.red, { width: 2 });
    },
  ],

  kite: [
    (p) => {
      const top: Pt = [52, 9];
      const right: Pt = [74, 30];
      const bottom: Pt = [52, 58];
      const left: Pt = [30, 30];
      const c: Pt = [52, 30];
      const quads: Array<[Pt[], string]> = [
        [[top, right, c], CK.red],
        [[right, bottom, c], CK.yellow],
        [[bottom, left, c], CK.blue],
        [[left, top, c], CK.green],
      ];
      for (const [q, col] of quads) p.fill(p.poly(q, 0.3, 0.4), col, { width: 2.2 });
      p.outline(p.poly([top, right, bottom, left], 0.3, 0.8));
      p.line([top, bottom], CK.black, 1.8);
      p.line([left, right], CK.black, 1.8);
      const tail = bezierPts(bottom, [34, 76], [50, G - 1], 14);
      p.line(tail, CK.black, 1.8, 0.4);
      [3, 7, 11].forEach((i, k) => {
        const [x, y] = tail[i];
        const c = [CK.red, CK.yellow, CK.blue][k];
        p.shape(p.poly([[x - 4.5, y - 2.6], [x, y], [x - 4.5, y + 2.6]], 0.15, 0.15), c, { flat: true, w: 1.5 });
        p.shape(p.poly([[x + 4.5, y - 2.6], [x, y], [x + 4.5, y + 2.6]], 0.15, 0.15), c, { flat: true, w: 1.5 });
      });
    },
  ],

  lighthouse: [
    (p) => {
      p.shape(p.sit(p.bumpy(50, 90, 30, 10, 5, 0.3)), CK.grey, { angle: -0.2 });
      const tower = p.poly([[39, 30], [61, 30], [68, 86], [32, 86]], 0.6);
      p.fill(tower, CK.white, { base: 0 });
      for (const [y0, y1] of [
        [30, 41],
        [52, 63],
        [74, 86],
      ]) {
        const k0 = (y0 - 30) / 56;
        const k1 = (y1 - 30) / 56;
        const band: Pt[] = [
          [39 - 7 * k0, y0],
          [61 + 7 * k0, y0],
          [61 + 7 * k1, y1],
          [39 - 7 * k1, y1],
        ];
        p.fill(p.poly(band, 0.3, 0.4), CK.red, { angle: -0.15, width: 2.3 });
      }
      p.outline(tower);
      p.shape(p.rect(45, 72, 10, 14, 0.4), CK.brown, { angle: -1.5, width: 2 });
      p.ball(50, 50, 3.6, CK.sky, 1.7);
      p.shape(p.rect(34, 27, 32, 4, 0.5), CK.black, { flat: true });
      p.shape(p.rect(41, 15, 18, 12, 0.5), CK.yellow, { width: 2 });
      p.line([[50, 15.5], [50, 26.5]], CK.black, 1.6);
      const dome: Pt[] = [];
      for (let i = 0; i <= 10; i++) {
        const a = Math.PI + (i / 10) * Math.PI;
        dome.push([50 + Math.cos(a) * 11, 16 + Math.sin(a) * 7]);
      }
      p.shape(p.poly(dome, 0.3, 0.4), CK.red, { width: 2 });
    },
  ],

  beach_hut: [
    (p) => {
      for (const x of [31, 69]) p.line([[x, 78], [x, G]], CK.brown, 4, 0.2);
      const body = p.rect(25, 40, 50, 40, 1);
      p.fill(body, CK.white, { base: 0 });
      for (let x = 25; x < 75; x += 12.5) p.fill(p.rect(x, 40.5, 6.25, 39, 0.3), CK.sky, { angle: -1.5, width: 2 });
      p.outline(body);
      p.shape(p.poly([[18, 43], [50, 19], [82, 43]], 0.8), CK.red, { angle: 0.3 });
      p.shape(p.rect(42, 54, 16, 26, 0.5), CK.yellow, { angle: -1.4 });
      p.dot(54, 68, 1.3);
      p.line([[42, 84], [58, 84]], CK.brown, 2.6, 0.2);
    },
  ],

  shell: [
    (p) => {
      const pts: Pt[] = [[44, 88], [56, 88]];
      for (let i = 0; i <= 16; i++) {
        const a = -0.12 - (i / 16) * (Math.PI - 0.24);
        const r = 38 + (i % 2 ? 0 : 2.5);
        pts.push([50 + Math.cos(a) * r, 84 + Math.sin(a) * r * 0.95]);
      }
      const s = p.poly(pts, 0.4, 0.7);
      p.shape(s, CK.peach, { angle: -1.5 });
      for (let i = 1; i < 6; i++) {
        const a = -0.3 - (i / 6) * (Math.PI - 0.6);
        p.line([[50, 86], [50 + Math.cos(a) * 34, 84 + Math.sin(a) * 32]], dk(CK.peach, 0.4), 1.8);
      }
      p.shape(p.rect(42, 84, 16, 8, 0.5), CK.pink, { width: 1.8 });
    },
  ],

  sailboat: [
    (p) => {
      water(p, 81);
      p.line([[50, 70], [50, 13]], CK.black, 2.4, 0.2);
      p.shape(p.poly([[53, 15], [53, 64], [82, 64]], 0.6), CK.white, { base: 0 });
      p.fill(p.poly([[53, 40], [53, 52], [70, 52]], 0.3), CK.red, { width: 2 });
      p.shape(p.poly([[47, 22], [47, 64], [24, 64]], 0.6), CK.yellow, { angle: -1.2 });
      p.shape(p.poly([[50, 11], [60, 14], [50, 17]], 0.2, 0.3), CK.red, { width: 1.6, w: 1.8 });
      p.shape(p.poly([[17, 66], [83, 66], [72, 84], [28, 84]], 0.8), CK.brown, { angle: -0.2 });
      for (const x of [36, 50, 64]) p.ball(x, 74, 3, CK.white, 1.5);
    },
  ],

  lamp_post: [
    (p) => {
      p.shape(p.rect(42, G - 6, 16, 6, 0.4), CK.black, { flat: true });
      p.line([[50, G - 6], [50, 33]], CK.navy, 4.8, 0.3);
      p.shape(p.poly([[38, 17], [62, 17], [59, 33], [41, 33]], 0.5), CK.yellow, { angle: -1.2 });
      p.line([[50, 17.5], [50, 32.5]], CK.black, 1.6);
      p.shape(p.poly([[35, 18], [50, 11], [65, 18]], 0.4), CK.navy, { width: 2 });
      for (const [x0, y0, x1, y1] of [
        [33, 25, 26, 25],
        [67, 25, 74, 25],
        [35, 34, 30, 39],
        [65, 34, 70, 39],
      ])
        p.line([[x0, y0], [x1, y1]], CK.orange, 2.4, 0.1);
    },
  ],

  signpost: [
    (p) => {
      grassBlades(p, 38, 62, 12);
      p.shape(p.rect(46, 26, 8, G - 26, 0.6), CK.brown, { angle: -1.5, width: 2 });
      p.shape(p.poly([[24, 24], [72, 22], [82, 29], [72, 36], [24, 36]], 0.6), CK.tan, { angle: -0.1 });
      p.shape(p.poly([[24, 42], [76, 42], [76, 54], [24, 55], [15, 48]], 0.6), CK.orange, { angle: -0.1 });
      for (const [x0, y, len] of [
        [30, 29, 34],
        [32, 48, 36],
      ]) {
        const z: Pt[] = [];
        for (let x = x0; x < x0 + len; x += 3) z.push([x, y + (Math.round((x - x0) / 3) % 2 ? -2 : 1.5)]);
        p.line(z, CK.black, 1.4, 0.2);
      }
    },
  ],

  bench: [
    (p) => {
      for (const x of [22, 78]) p.line([[x, 64], [x + (x < 50 ? -2 : 2), G]], CK.black, 3.4, 0.2);
      for (const x of [24, 76]) p.line([[x, 64], [x, 40]], CK.black, 2.8, 0.2);
      p.shape(p.rect(14, 38, 72, 8, 0.7), CK.brown, { angle: -0.1 });
      p.shape(p.rect(14, 49, 72, 7, 0.7), CK.brown, { angle: -0.1 });
      p.shape(p.rect(10, 60, 80, 8, 0.7), CK.tan, { angle: -0.1 });
    },
  ],

  snow_pine: [
    (p) => {
      trunk(p, 50, 80, 10);
      p.shape(p.sit(p.oval(50, 90, 34, 6, 0.1)), CK.white, { line: CK.blue, base: 0 });
      pineTiers(p, CK.forest, true);
    },
  ],

  mountain_peak: [
    (p) => {
      const back = p.poly([[8, G], [28, 38], [50, G]], 1);
      p.shape(back, CK.lilac, { angle: -0.9, line: CK.navy });
      const m = p.poly([[22, G], [58, 10], [92, G]], 1.2);
      p.shape(m, CK.purple, { angle: 0.8, line: CK.navy });
      const cap: Pt[] = [
        [58, 10.5],
        [71, 31],
        [65, 36],
        [60, 30],
        [54, 38],
        [49, 31],
        [45, 33],
      ];
      p.shape(p.poly(cap, 0.4, 0.5), CK.white, { line: CK.navy, base: 0 });
      p.shape(
        p.poly(
          [
            [28, 38.5],
            [34, 50],
            [29, 47],
            [25, 51],
            [21, 48],
          ],
          0.3,
          0.4,
        ),
        CK.white,
        { line: CK.navy, base: 0, w: 2 },
      );
    },
  ],

  cloud: [
    (p) => {
      cloudShape(p, 50, 64, 36, 17);
    },
  ],

  visitor_a: [(p) => drawChildPerson(p, VISITORS[0], "front")],
  visitor_b: [(p) => drawChildPerson(p, VISITORS[1], "front")],
  visitor_c: [(p) => drawChildPerson(p, VISITORS[2], "front")],
};
