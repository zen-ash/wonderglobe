// Sample drawings that look like a child drew them with crayons. They are
// rendered on a TRANSPARENT canvas (like the in-game drawing board) using only
// crayon strokes and scribble fills, so they can be fed through the real
// cut-out pipeline. renderSampleArtwork() puts the same drawing on cream
// paper as a finished picture for gallery easels.

import {
  blobPts,
  crayonStroke,
  ctx2d,
  ellipsePts,
  eraseGrain,
  makeCanvas,
  paperGrain,
  scribbleFill,
  wobble,
  type Pt,
} from "./crayon";
import { bezierPts, leafPts } from "./kit";
import { createRng, hashString, type Rng } from "./rng";

export interface SampleDrawing {
  id: string;
  label: string;
  suggestedKind: string;
}

type Scene = "land" | "water" | "sky";

export const SAMPLE_DRAWINGS: SampleDrawing[] = [
  { id: "fish", label: "Fish", suggestedKind: "fish" },
  { id: "house", label: "House", suggestedKind: "house" },
  { id: "cat", label: "Cat", suggestedKind: "cat" },
  { id: "flower", label: "Flower", suggestedKind: "flower" },
  { id: "bird", label: "Bird", suggestedKind: "bird" },
  { id: "car", label: "Car", suggestedKind: "car" },
  { id: "butterfly", label: "Butterfly", suggestedKind: "butterfly" },
  { id: "tree", label: "Tree", suggestedKind: "tree" },
  { id: "duck", label: "Duck", suggestedKind: "duck" },
  { id: "dragon", label: "Dragon", suggestedKind: "dragon" },
  { id: "rocket", label: "Rocket", suggestedKind: "rocket" },
];

// Crayon box colours (bright, slightly waxy).
const K = {
  black: "#2d2a32",
  red: "#e8402f",
  orange: "#f78c1f",
  yellow: "#f9d01e",
  green: "#3fae3a",
  lime: "#9bd63a",
  blue: "#2f7fe0",
  sky: "#6fc6f2",
  purple: "#8a4fd0",
  pink: "#f777b4",
  brown: "#8b5a2b",
  grey: "#8f8f99",
};

/** Child-style pen: wobbly closed outlines that overshoot, scribble fills. */
class Pen {
  constructor(
    readonly ctx: CanvasRenderingContext2D,
    readonly rng: Rng,
  ) {}
  w = 2.2;

  wob(pts: Pt[], amt = 0.9, step = 6): Pt[] {
    return wobble(pts, this.rng, amt, step, true);
  }
  blob(cx: number, cy: number, rx: number, ry = rx, wob = 0.08): Pt[] {
    return blobPts(cx, cy, rx, ry, this.rng, wob, 18);
  }
  ell(cx: number, cy: number, rx: number, ry = rx, rot = 0): Pt[] {
    return this.wob(ellipsePts(cx, cy, rx, ry, 16, rot), 0.6, 100);
  }

  /** Closed outline drawn like a child: the end overshoots the start a little. */
  outline(pts: Pt[], color: string, w = this.w): void {
    const n = pts.length;
    const extra: Pt[] = [pts[0], [pts[1 % n][0] + this.rng.range(-1, 1), pts[1 % n][1] + this.rng.range(-1, 1)]];
    crayonStroke(this.ctx, [...pts, ...extra], { color, width: w, rng: this.rng, passes: 3, alpha: 0.92, jitter: w * 0.25 });
  }
  line(pts: Pt[], color: string, w = this.w): void {
    crayonStroke(this.ctx, wobble(pts, this.rng, 0.5, 6, false), { color, width: w, rng: this.rng, passes: 3, alpha: 0.92, jitter: w * 0.25 });
  }
  fill(pts: Pt[], color: string, o: { angle?: number; overshoot?: number; width?: number } = {}): void {
    scribbleFill(this.ctx, pts, {
      color,
      rng: this.rng,
      width: o.width ?? 2.6,
      spacing: (o.width ?? 2.6) * 0.75,
      angle: o.angle,
      overshoot: o.overshoot ?? 1.03,
      alpha: 0.88,
    });
  }
  shape(pts: Pt[], fill: string, line: string, o: { angle?: number; w?: number } = {}): void {
    this.fill(pts, fill, { angle: o.angle });
    this.outline(pts, line, o.w);
  }
  dot(cx: number, cy: number, r: number, color: string): void {
    const p = this.ell(cx, cy, r, r);
    this.fill(p, color, { width: Math.max(1.2, r * 0.9), overshoot: 1 });
    this.outline(p, color, Math.max(1.2, r * 0.6));
  }
}

const DRAW: Record<string, { scene: Scene; draw: (p: Pen) => void }> = {
  fish: {
    scene: "water",
    draw(p) {
      const tail = p.wob([
        [26, 50],
        [8, 34],
        [12, 50],
        [8, 67],
      ]);
      p.shape(tail, K.yellow, K.orange);
      const body = p.blob(50, 50, 30, 20, 0.05);
      p.shape(body, K.orange, K.red);
      const fin = p.wob([
        [44, 32],
        [54, 18],
        [62, 33],
      ]);
      p.shape(fin, K.yellow, K.orange);
      p.line(bezierPts([44, 36], [38, 50], [44, 64], 6), K.red, 1.8);
      p.line(bezierPts([54, 34], [48, 50], [54, 66], 6), K.red, 1.8);
      p.dot(68, 45, 4, "#ffffff");
      p.outline(p.ell(68, 45, 4.5), K.black, 1.6);
      p.dot(69, 45, 2, K.black);
      p.line(bezierPts([70, 58], [74, 61], [78, 56], 4), K.black, 1.6);
      p.outline(p.ell(88, 30, 3), K.sky, 1.4);
      p.outline(p.ell(90, 20, 2.2), K.sky, 1.3);
    },
  },
  house: {
    scene: "land",
    draw(p) {
      p.shape(p.wob([[62, 30], [70, 30], [70, 18], [62, 18]]), K.brown, K.black);
      p.line(bezierPts([66, 16], [62, 10], [68, 6], 5), K.grey, 1.6);
      p.shape(
        p.wob([
          [14, 42],
          [50, 12],
          [86, 42],
        ]),
        K.purple,
        K.black,
      );
      const walls = p.wob([
        [22, 42],
        [78, 42],
        [78, 90],
        [22, 90],
      ]);
      p.shape(walls, K.red, K.black, { angle: -0.3 });
      p.shape(p.wob([[42, 90], [42, 66], [58, 66], [58, 90]]), K.brown, K.black);
      p.dot(55, 79, 1.4, K.yellow);
      for (const x of [28, 62]) {
        const win = p.wob([[x, 50], [x + 11, 50], [x + 11, 61], [x, 61]]);
        p.shape(win, K.sky, K.black, { w: 1.8 });
        p.line([[x + 5.5, 50], [x + 5.5, 61]], K.black, 1.4);
        p.line([[x, 55.5], [x + 11, 55.5]], K.black, 1.4);
      }
    },
  },
  cat: {
    scene: "land",
    draw(p) {
      p.line(bezierPts([68, 80], [90, 74], [84, 52], 8), K.orange, 4.5);
      const body = p.blob(50, 70, 21, 20, 0.06);
      p.shape(body, K.orange, K.brown);
      const head: Pt[] = [...p.blob(50, 38, 18, 16, 0.04)];
      p.shape(
        p.wob([
          [34, 32],
          [33, 12],
          [46, 25],
        ]),
        K.orange,
        K.brown,
      );
      p.shape(
        p.wob([
          [54, 25],
          [67, 12],
          [66, 32],
        ]),
        K.orange,
        K.brown,
      );
      p.shape(head, K.orange, K.brown);
      p.dot(43, 36, 2.2, K.green);
      p.dot(57, 36, 2.2, K.green);
      p.dot(50, 43, 1.6, K.pink);
      p.line([[45, 46], [47.5, 48.5], [50, 46.5], [52.5, 48.5], [55, 46]], K.black, 1.4);
      for (const s of [-1, 1]) {
        p.line([[50 + s * 7, 44], [50 + s * 20, 41]], K.black, 1.2);
        p.line([[50 + s * 7, 46], [50 + s * 20, 48]], K.black, 1.2);
      }
      p.line([[40, 76], [42, 88]], K.brown, 1.6);
      p.line([[60, 76], [58, 88]], K.brown, 1.6);
      p.line([[44, 60], [48, 64], [52, 60], [56, 64]], K.brown, 1.6);
    },
  },
  flower: {
    scene: "land",
    draw(p) {
      p.line([[50, 92], [49, 70], [51, 46]], K.green, 3.6);
      p.shape(p.wob(leafPts(49, 74, -0.5, 22, 11, 0.1)), K.lime, K.green);
      p.shape(p.wob(leafPts(50, 64, Math.PI + 0.5, 20, 10, 0.1)), K.lime, K.green);
      const cx = 50;
      const cy = 32;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        p.shape(p.blob(cx + Math.cos(a) * 15, cy + Math.sin(a) * 15, 10, 10, 0.08), K.pink, K.purple);
      }
      p.shape(p.blob(cx, cy, 9, 9, 0.05), K.yellow, K.orange);
      p.dot(cx - 3, cy - 1, 1.2, K.brown);
      p.dot(cx + 3, cy - 1, 1.2, K.brown);
    },
  },
  bird: {
    scene: "sky",
    draw(p) {
      p.shape(p.wob([[24, 52], [8, 44], [10, 60]]), K.blue, K.black);
      const body = p.blob(46, 56, 25, 18, 0.05);
      p.shape(body, K.sky, K.blue);
      p.shape(p.blob(70, 40, 13, 12, 0.04), K.sky, K.blue);
      p.shape(p.wob([[82, 37], [94, 41], [82, 46]]), K.orange, K.orange);
      p.dot(73, 37, 2, K.black);
      p.shape(
        p.wob([
          [36, 50],
          [40, 22],
          [60, 48],
        ]),
        K.blue,
        K.black,
      );
      p.line([[40, 73], [38, 86]], K.orange, 2);
      p.line([[50, 73], [52, 86]], K.orange, 2);
    },
  },
  car: {
    scene: "land",
    draw(p) {
      const body = p.wob([
        [8, 58],
        [28, 56],
        [36, 36],
        [68, 36],
        [78, 56],
        [94, 60],
        [94, 76],
        [8, 76],
      ]);
      p.shape(body, K.red, K.black, { angle: -0.2 });
      p.shape(p.wob([[38, 40], [50, 40], [50, 55], [32, 55]]), K.sky, K.black, { w: 1.8 });
      p.shape(p.wob([[54, 40], [66, 40], [73, 55], [54, 55]]), K.sky, K.black, { w: 1.8 });
      p.dot(90, 64, 2.6, K.yellow);
      for (const x of [28, 74]) {
        const wheel = p.ell(x, 77, 10, 10);
        p.shape(wheel, K.black, K.black);
        p.dot(x, 77, 3.6, K.grey);
      }
      p.line([[40, 63], [46, 63]], K.black, 1.6);
    },
  },
  butterfly: {
    scene: "sky",
    draw(p) {
      for (const s of [-1, 1]) {
        p.shape(p.blob(50 + s * 22, 36, 20, 17, 0.08), K.purple, K.purple);
        p.shape(p.blob(50 + s * 18, 64, 14, 13, 0.08), K.pink, K.purple);
        p.dot(50 + s * 24, 34, 5, K.yellow);
        p.dot(50 + s * 18, 65, 3.5, K.sky);
      }
      p.shape(p.blob(50, 52, 4.5, 24, 0.04), K.brown, K.black);
      p.line(bezierPts([48, 29], [42, 16], [36, 12], 5), K.black, 1.8);
      p.line(bezierPts([52, 29], [58, 16], [64, 12], 5), K.black, 1.8);
      p.dot(36, 12, 2, K.black);
      p.dot(64, 12, 2, K.black);
    },
  },
  tree: {
    scene: "land",
    draw(p) {
      p.shape(p.wob([[43, 92], [45, 50], [55, 50], [57, 92]]), K.brown, K.brown, { angle: 1.3 });
      const top: Pt[] = [];
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        const r = 30 + (i % 2) * 5;
        top.push([50 + Math.cos(a) * r, 36 + Math.sin(a) * r * 0.85]);
      }
      p.shape(p.wob(top, 1.5, 8), K.green, K.green);
      for (const [x, y] of [
        [36, 30],
        [58, 22],
        [64, 42],
        [42, 46],
        [50, 34],
      ])
        p.dot(x, y, 3.6, K.red);
    },
  },
  duck: {
    scene: "water",
    draw(p) {
      const body = p.wob(
        [
          [12, 54],
          [28, 62],
          [52, 58],
          [74, 62],
          [80, 74],
          [68, 86],
          [30, 86],
          [16, 74],
        ],
        1.1,
        7,
      );
      p.shape(body, K.yellow, K.orange);
      p.shape(p.blob(68, 42, 15, 14, 0.04), K.yellow, K.orange);
      p.shape(p.wob([[80, 40], [95, 44], [80, 50]]), K.orange, K.red);
      p.dot(70, 38, 2.2, K.black);
      p.line(bezierPts([30, 70], [44, 80], [56, 68], 6), K.orange, 2);
    },
  },
  dragon: {
    scene: "sky",
    draw(p) {
      // Tail
      p.shape(
        p.wob([
          [26, 64],
          [8, 72],
          [4, 62],
          [10, 66],
          [24, 56],
        ]),
        K.green,
        K.black,
      );
      const body = p.blob(44, 62, 22, 15, 0.06);
      p.shape(body, K.green, K.black);
      for (let i = 0; i < 4; i++) {
        const x = 30 + i * 8;
        p.shape(p.wob([[x, 50], [x + 4, 42], [x + 8, 50]], 0.4), K.orange, K.black, { w: 1.6 });
      }
      // Bat wing (drawn on top, like a kid would)
      p.shape(
        p.wob([
          [36, 60],
          [26, 30],
          [18, 18],
          [32, 26],
          [40, 14],
          [46, 28],
          [58, 20],
          [54, 58],
        ]),
        K.purple,
        K.black,
      );
      p.line([[34, 74], [32, 88]], K.green, 4);
      p.line([[54, 74], [56, 88]], K.green, 4);
      // Neck & head
      p.shape(p.wob([[56, 56], [64, 40], [72, 44], [64, 62]]), K.green, K.black);
      p.shape(p.blob(72, 38, 11, 8, 0.05), K.green, K.black);
      p.dot(74, 35, 1.8, K.black);
      p.line([[68, 30], [66, 24]], K.black, 1.6);
      // Fire
      p.shape(
        p.wob([
          [82, 40],
          [96, 32],
          [92, 40],
          [97, 46],
          [84, 44],
        ]),
        K.yellow,
        K.orange,
      );
    },
  },
  rocket: {
    scene: "sky",
    draw(p) {
      p.shape(p.wob([[42, 74], [50, 96 - 2], [58, 74]]), K.yellow, K.orange);
      p.shape(p.wob([[36, 62], [24, 80], [38, 76]]), K.red, K.black);
      p.shape(p.wob([[64, 62], [76, 80], [62, 76]]), K.red, K.black);
      const body = p.wob([
        [36, 36],
        [50, 6],
        [64, 36],
        [64, 76],
        [36, 76],
      ]);
      p.shape(body, "#e6e6ee", K.black, { angle: 1.2 });
      p.shape(p.wob([[38, 30], [50, 6], [62, 30]]), K.red, K.black);
      p.shape(p.ell(50, 46, 7, 7), K.sky, K.blue);
      p.line([[38, 64], [62, 64]], K.blue, 2);
    },
  },
};

function findSample(id: string): { scene: Scene; draw: (p: Pen) => void } {
  return DRAW[id] ?? DRAW.fish;
}

/** Child-style crayon drawing on a transparent canvas (like the drawing board output). */
export function renderSample(id: string, size = 512): HTMLCanvasElement {
  const c = makeCanvas(size, size);
  const ctx = ctx2d(c);
  const rng = createRng(hashString(`sample-${id}`));
  ctx.setTransform(size / 100, 0, 0, size / 100, 0, 0);
  findSample(id).draw(new Pen(ctx, rng));
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  eraseGrain(ctx, size, size, rng, 0.35);
  return c;
}

/** The same sample as a finished picture on cream paper with a few decorations. */
export function renderSampleArtwork(id: string, size = 512): HTMLCanvasElement {
  const c = makeCanvas(size, size);
  const ctx = ctx2d(c);
  const rng = createRng(hashString(`artwork-${id}`));
  ctx.fillStyle = "#fbf3e1";
  ctx.fillRect(0, 0, size, size);
  paperGrain(ctx, size, size, rng, 0.45);
  ctx.setTransform(size / 100, 0, 0, size / 100, 0, 0);
  const pen = new Pen(ctx, rng);
  const scene = findSample(id).scene;
  // Sun in the corner
  const sun = pen.blob(14, 14, 8, 8, 0.05);
  pen.shape(sun, "#ffd23a", "#f7a21b");
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 1.3 - 0.15;
    pen.line([[14 + Math.cos(a) * 11, 14 + Math.sin(a) * 11], [14 + Math.cos(a) * 16, 14 + Math.sin(a) * 16]], "#f7a21b", 1.6);
  }
  if (scene === "water") {
    for (const y of [88, 94]) {
      const wave: Pt[] = [];
      for (let x = 3; x <= 97; x += 3) wave.push([x, y + Math.sin(x * 0.4 + y) * 1.6]);
      pen.line(wave, "#4aa3e8", 2);
    }
  } else if (scene === "land") {
    const g: Pt[] = [
      [2, 92],
      [98, 92],
      [98, 99],
      [2, 99],
    ];
    pen.fill(g, "#7ccf4a", { angle: -1.4, width: 2 });
    for (let x = 6; x < 96; x += 5) pen.line([[x, 93], [x + rng.range(-1, 2), 87 + rng.range(-1, 1)]], "#3fae3a", 1.3);
  } else {
    for (const [x, y] of [
      [80, 14],
      [70, 88],
    ]) {
      const cloud = [...pen.blob(x, y, 9, 4.5, 0.1)];
      pen.outline(cloud, "#8cc8f0", 1.6);
    }
  }
  // Hand-drawn frame line
  pen.line(
    [
      [3, 3],
      [97, 3.5],
      [96.5, 97],
      [3.5, 96.5],
      [3, 3],
    ],
    "#d6a35a",
    1.4,
  );
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const art = renderSample(id, size);
  const s = 0.8;
  ctx.drawImage(art, size * (1 - s) * 0.5, size * (1 - s) * 0.62, size * s, size * s);
  return c;
}
