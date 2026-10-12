// Little crayon pictures for stickers and hidden treasures. Each drawer works
// in the shared 100×100 kit box and keeps inside a circle of radius ~32
// around (50, 50), so it fits a round sticker or a small paper cut-out.

import { C, Kit, leafPts, bezierPts, ribbonPts } from "./kit";
import type { Pt } from "./crayon";

export type IconDrawer = (k: Kit) => void;

const GOLD = "#f6c330";

function petalRing(k: Kit, cx: number, cy: number, n: number, dist: number, rx: number, ry: number, color: string) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    k.shape(k.ell(cx + Math.cos(a) * dist, cy + Math.sin(a) * dist, rx, ry, a), color, { w: 1.5 });
  }
}

function star(cx: number, cy: number, r: number, inner = 0.45, points = 5, rot = -Math.PI / 2): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < points * 2; i++) {
    const rr = i % 2 ? r * inner : r;
    const a = rot + (i / (points * 2)) * Math.PI * 2;
    out.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  return out;
}

function house(k: Kit, x: number, y: number, w: number, h: number, wall: string, roof: string) {
  k.shape(k.rect(x, y, w, h), wall);
  k.shape(k.poly([[x - 5, y + 1], [x + w / 2, y - h * 0.62], [x + w + 5, y + 1]]), roof);
  k.shape(k.rect(x + w * 0.38, y + h * 0.45, w * 0.26, h * 0.55), C.woodDark, { w: 1.4 });
  k.shape(k.rect(x + w * 0.1, y + h * 0.18, w * 0.2, w * 0.2), C.sky, { w: 1.3 });
}

export const ICONS: Record<string, IconDrawer> = {
  sunflower(k) {
    k.tube([[50, 60], [49, 72], [51, 84]], C.leaf, 4);
    k.shape(leafPts(50, 74, -0.4, 13, 7), C.leaf, { w: 1.4 });
    petalRing(k, 50, 44, 12, 14, 8, 4.5, C.yellow);
    k.circle(50, 44, 10, C.brown);
    for (let i = 0; i < 6; i++) k.dot(46 + (i % 3) * 4, 41 + Math.floor(i / 3) * 5, 1.1, "#4a2f1d");
  },
  lily(k) {
    k.shape(k.ell(50, 64, 28, 10), "#6cc070");
    for (let i = 0; i < 7; i++) {
      const a = -Math.PI / 2 + (i - 3) * 0.42;
      k.shape(leafPts(50, 58, a, 24, 11, 0, 0.9), i % 2 ? "#ffc6dc" : "#ffdbe9", { w: 1.4 });
    }
    k.circle(50, 53, 5, C.yellow, 1.3);
  },
  house(k) {
    house(k, 30, 44, 40, 34, C.cream, C.red);
    k.tube([[60, 30], [60, 22]], C.brick, 5);
  },
  basket(k) {
    k.outline(bezierPts([26, 50], [50, 8], [74, 50], 14), 4.5, C.ink, true);
    k.shape(k.poly([[22, 48], [78, 48], [70, 80], [30, 80]]), C.wood);
    for (let i = 0; i < 4; i++) k.line([[25 + i * 2, 56 + i * 6], [75 - i * 2, 56 + i * 6]], C.woodDark, 1.4, 1);
    k.shape(k.ell(36, 46, 7, 5), C.red, { w: 1.4 });
    k.shape(k.ell(60, 45, 8, 5), C.yellow, { w: 1.4 });
  },
  tulip(k) {
    k.tube([[50, 52], [50, 84]], C.leaf, 4);
    k.shape(leafPts(50, 82, -1.0, 22, 9, -0.05), C.leaf, { w: 1.4 });
    k.shape(leafPts(50, 82, -2.1, 20, 9, -0.05), C.leafDark, { w: 1.4 });
    k.shape(k.poly([[34, 30], [42, 40], [50, 26], [58, 40], [66, 30], [64, 50], [50, 58], [36, 50]]), C.rose);
  },
  blossom(k) {
    petalRing(k, 50, 50, 5, 14, 12, 10, C.blossom);
    k.circle(50, 50, 7, C.pink, 1.4);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.6;
      k.dot(50 + Math.cos(a) * 9, 50 + Math.sin(a) * 9, 1.4, C.rose);
    }
  },
  pine(k) {
    k.tube([[50, 72], [50, 84]], C.trunk, 6);
    k.shape(k.poly([[50, 18], [66, 42], [58, 42], [72, 60], [60, 60], [76, 76], [24, 76], [40, 60], [28, 60], [42, 42], [34, 42]]), C.pine);
  },
  barn(k) {
    k.shape(k.poly([[24, 50], [36, 30], [64, 30], [76, 50], [76, 82], [24, 82]]), C.red);
    k.shape(k.rect(40, 56, 20, 26), C.white, { w: 1.6 });
    k.line([[40, 56], [60, 82]], C.red, 2.2, 1);
    k.line([[60, 56], [40, 82]], C.red, 2.2, 1);
    k.shape(k.rect(44, 36, 12, 10), C.white, { w: 1.4 });
  },
  duck(k) {
    k.shape(k.blob(46, 62, 24, 14), C.yellow);
    k.circle(64, 40, 11, C.yellow);
    k.shape(k.poly([[73, 40], [84, 43], [73, 47]]), C.orange, { w: 1.4 });
    k.dot(66, 37, 1.8, C.ink);
    k.shape(leafPts(38, 60, -0.3, 16, 9, 0.1), C.gold, { w: 1.3 });
  },
  boat(k) {
    k.tube([[50, 20], [50, 64]], C.woodDark, 2.5);
    k.shape(k.poly([[53, 22], [74, 58], [53, 58]]), C.white);
    k.shape(k.poly([[47, 28], [30, 58], [47, 58]]), C.red);
    k.shape(k.poly([[22, 64], [78, 64], [68, 78], [32, 78]]), C.blue);
  },
  mountain(k) {
    k.shape(k.poly([[16, 80], [44, 26], [58, 48], [66, 38], [86, 80]]), C.mountain);
    k.shape(k.poly([[36, 42], [44, 26], [52, 38], [47, 44], [42, 40]]), C.snow, { w: 1.4 });
  },
  wave(k) {
    k.shape(k.poly([[50, 18], [68, 48], [70, 60], [62, 74], [50, 78], [38, 74], [30, 60], [32, 48]]), C.blue);
    k.shine([[40, 52], [42, 64]], "#ffffff", 3, 0.7);
  },
  pencil(k) {
    k.shape(k.poly([[30, 76], [34, 62], [66, 30], [74, 38], [42, 70]]), C.yellow);
    k.shape(k.poly([[30, 76], [34, 62], [42, 70]]), C.cream, { w: 1.4 });
    k.shape(k.poly([[30, 76], [32, 70], [36, 74]]), C.ink, { w: 1 });
    k.shape(k.poly([[66, 30], [74, 38], [78, 34], [70, 26]]), C.pink, { w: 1.4 });
  },
  paw(k) {
    k.shape(k.blob(50, 60, 15, 12), C.brown);
    for (const [x, y] of [[32, 42], [43, 32], [57, 32], [68, 42]] as Pt[]) k.shape(k.blob(x, y, 6, 7.5), C.brown, { w: 1.5 });
  },
  sprout(k) {
    k.shape(k.ell(50, 78, 18, 6), C.trunk);
    k.tube([[50, 76], [50, 46]], C.leaf, 4);
    k.shape(leafPts(50, 50, -2.6, 22, 13, -0.1), C.grass, { w: 1.5 });
    k.shape(leafPts(50, 46, -0.5, 24, 13, -0.1), C.leaf, { w: 1.5 });
  },
  car(k) {
    k.shape(k.poly([[34, 50], [40, 36], [62, 36], [70, 50]]), C.sky);
    k.shape(k.rect(20, 48, 60, 18), C.red);
    k.circle(34, 68, 7, C.ink, 1.2);
    k.circle(66, 68, 7, C.ink, 1.2);
    k.dot(34, 68, 3, C.grey);
    k.dot(66, 68, 3, C.grey);
  },
  wand(k) {
    k.tube([[30, 78], [56, 46]], C.purple, 5);
    k.shape(star(62, 38, 17), C.yellow);
    k.dot(28, 34, 2.2, C.pink);
    k.dot(78, 64, 2.2, C.sky);
    k.dot(76, 22, 1.8, C.yellow);
  },
  bird(k) {
    k.shape(k.blob(48, 54, 20, 15), C.sky);
    k.shape(leafPts(44, 50, -2.4, 22, 13, 0.05), C.blue, { w: 1.5 });
    k.circle(64, 42, 10, C.sky);
    k.shape(k.poly([[72, 42], [82, 45], [72, 48]]), C.orange, { w: 1.3 });
    k.dot(66, 40, 1.8, C.ink);
  },
  fish(k) {
    k.shape(k.poly([[24, 50], [14, 36], [14, 64]]), C.orange);
    k.shape(k.blob(48, 50, 26, 16), C.orange);
    k.shape(k.poly([[42, 36], [52, 26], [58, 36]]), C.tomato, { w: 1.4 });
    k.dot(62, 46, 2.4, C.ink);
    k.line([[38, 42], [38, 58]], C.tomato, 1.6, 1);
  },
  bridge(k) {
    k.shape(k.ell(50, 76, 34, 6), C.blue, { w: 1.4 });
    k.shape(k.poly([[16, 50], [84, 50], [84, 72], [72, 72], [70, 64], [50, 58], [30, 64], [28, 72], [16, 72]]), C.wood);
    for (let i = 0; i < 6; i++) k.tube([[20 + i * 12, 50], [20 + i * 12, 38]], C.woodDark, 2.5);
    k.line([[16, 40], [84, 40]], C.woodDark, 2.5, 1);
  },
  frame(k) {
    k.shape(k.rect(22, 24, 56, 50), C.gold);
    k.shape(k.rect(30, 32, 40, 34), C.sky, { w: 1.5 });
    k.shape(k.poly([[30, 66], [42, 48], [52, 58], [60, 50], [70, 66]]), C.grass, { w: 1.3 });
    k.circle(60, 40, 4, C.yellow, 1.2);
    k.tube([[34, 74], [28, 86]], C.woodDark, 3);
    k.tube([[66, 74], [72, 86]], C.woodDark, 3);
  },
  note(k) {
    k.shape(k.poly([[24, 26], [76, 24], [78, 66], [64, 78], [26, 76]]), "#ffe066");
    k.shape(k.poly([[64, 78], [66, 66], [78, 66]]), "#e9c442", { w: 1.4 });
    for (let i = 0; i < 3; i++) k.line([[32, 38 + i * 10], [68 - i * 6, 38 + i * 10]], C.blue, 2, 1);
  },
  chest(k) {
    k.shape(k.poly([[22, 44], [26, 30], [74, 30], [78, 44]]), C.wood);
    k.shape(k.rect(22, 44, 56, 32), C.wood);
    k.shape(k.rect(46, 40, 8, 12), GOLD, { w: 1.4 });
    k.line([[22, 44], [78, 44]], C.woodDark, 2, 1);
    for (let i = 0; i < 3; i++) k.dot(32 + i * 18, 24 - (i % 2) * 4, 3, GOLD);
  },
  crown(k) {
    k.shape(k.poly([[22, 70], [20, 34], [36, 50], [50, 26], [64, 50], [80, 34], [78, 70]]), GOLD);
    k.shape(k.rect(22, 66, 56, 10), C.gold, { w: 1.5 });
    k.circle(50, 56, 4, C.red, 1.3);
    k.circle(34, 60, 3, C.blue, 1.2);
    k.circle(66, 60, 3, C.teal, 1.2);
  },
  star(k) {
    k.shape(star(50, 52, 30, 0.48), GOLD);
    k.shine([[40, 42], [46, 36]], "#fff6c8", 3, 0.8);
    k.dot(43, 54, 2, C.ink);
    k.dot(57, 54, 2, C.ink);
    k.line(bezierPts([44, 61], [50, 66], [56, 61], 6), C.ink, 1.6, 1);
  },
  butterfly(k) {
    k.shape(k.blob(34, 38, 14, 13), GOLD);
    k.shape(k.blob(66, 38, 14, 13), GOLD);
    k.shape(k.blob(37, 64, 11, 10), C.gold);
    k.shape(k.blob(63, 64, 11, 10), C.gold);
    k.shape(k.ell(50, 52, 4, 20), C.brown, { w: 1.5 });
    k.line([[49, 33], [42, 20]], C.ink, 1.5, 1);
    k.line([[51, 33], [58, 20]], C.ink, 1.5, 1);
    k.dot(34, 38, 3, "#fff6c8");
    k.dot(66, 38, 3, "#fff6c8");
  },
  horseshoe(k) {
    const center: Pt[] = [];
    for (let i = 0; i <= 16; i++) {
      const a = Math.PI * 0.95 - (i / 16) * Math.PI * 1.9 + Math.PI / 2;
      center.push([50 + Math.cos(a + Math.PI) * 22, 50 + Math.sin(a + Math.PI) * 24]);
    }
    k.shape(ribbonPts(center, () => 11), C.grey);
    for (let i = 2; i <= 14; i += 3) k.dot(center[i][0], center[i][1], 1.5, C.ink);
  },
  camera(k) {
    k.shape(k.rect(38, 28, 18, 10), C.greyDark, { w: 1.5 });
    k.shape(k.rect(20, 34, 60, 40), C.teal);
    k.circle(50, 54, 14, C.ink, 1.4);
    k.circle(50, 54, 9, C.sky, 1.2);
    k.dot(46, 50, 2.5, "#ffffff");
    k.dot(70, 42, 3, C.yellow);
  },
  heart(k) {
    k.shape(k.poly([[50, 80], [22, 52], [20, 36], [30, 26], [42, 26], [50, 36], [58, 26], [70, 26], [80, 36], [78, 52]]), C.rose);
    k.shine([[30, 38], [34, 32]], "#ffffff", 3, 0.7);
  },
  owl(k) {
    k.shape(k.poly([[64, 18], [78, 24], [72, 36]]), C.yellow, { w: 1.3 });
    k.shape(k.blob(50, 56, 22, 26), C.brown);
    k.shape(k.blob(50, 64, 13, 15), C.cream, { w: 1.4 });
    k.circle(41, 46, 8, C.white, 1.4);
    k.circle(59, 46, 8, C.white, 1.4);
    k.dot(41, 46, 3.5, C.ink);
    k.dot(59, 46, 3.5, C.ink);
    k.shape(k.poly([[47, 52], [53, 52], [50, 58]]), C.orange, { w: 1.2 });
    k.shape(k.poly([[30, 34], [36, 24], [40, 36]]), C.brown, { w: 1.4 });
    k.shape(k.poly([[60, 36], [64, 24], [70, 34]]), C.brown, { w: 1.4 });
  },
  rainbow(k) {
    const cols = [C.red, C.orange, C.yellow, C.grass, C.blue, C.purple];
    cols.forEach((c, i) => {
      const r = 34 - i * 4.4;
      const pts: Pt[] = [];
      for (let j = 0; j <= 18; j++) pts.push([50 - Math.cos((j / 18) * Math.PI) * r, 66 - Math.sin((j / 18) * Math.PI) * r]);
      k.line(pts, c, 4.6, 1);
    });
    k.union([k.blob(20, 66, 9, 7), k.blob(28, 68, 8, 6)], C.white, { w: 1.4 });
    k.union([k.blob(80, 66, 9, 7), k.blob(72, 68, 8, 6)], C.white, { w: 1.4 });
  },
  key(k) {
    k.circle(34, 50, 14, GOLD);
    k.circle(34, 50, 6, "#fdf3c9", 1.4);
    k.shape(k.rect(46, 46, 34, 8), GOLD);
    k.shape(k.rect(66, 54, 6, 10), GOLD, { w: 1.5 });
    k.shape(k.rect(74, 54, 5, 7), GOLD, { w: 1.5 });
  },
  bottle(k) {
    k.shape(k.poly([[40, 34], [60, 34], [64, 44], [64, 80], [36, 80], [36, 44]]), "#9fe0c8");
    k.shape(k.rect(44, 20, 12, 15), "#9fe0c8", { w: 1.5 });
    k.shape(k.rect(44, 14, 12, 7), C.wood, { w: 1.4 });
    k.shape(k.poly([[42, 50], [58, 48], [58, 70], [42, 72]]), C.cream, { w: 1.3 });
    k.line([[45, 56], [55, 55]], C.ink, 1.1, 1);
    k.line([[45, 62], [54, 61]], C.ink, 1.1, 1);
  },
  kite(k) {
    k.line(bezierPts([50, 66], [30, 76], [44, 88], 10), C.ink, 1.5, 1);
    k.shape(k.poly([[50, 14], [72, 40], [50, 66], [28, 40]]), C.red);
    k.shape(k.poly([[50, 14], [72, 40], [50, 40]]), C.yellow, { w: 1.3 });
    k.shape(k.poly([[50, 40], [28, 40], [50, 66]]), C.blue, { w: 1.3 });
    k.shape(k.ell(40, 78, 4, 3, 0.4), C.pink, { w: 1.2 });
  },
  shell(k) {
    const pts: Pt[] = [[50, 80]];
    for (let i = 0; i <= 12; i++) {
      const a = Math.PI + (i / 12) * Math.PI;
      pts.push([50 + Math.cos(a) * 30, 56 + Math.sin(a) * 30]);
    }
    k.shape(k.poly(pts), "#ffc9b0");
    for (let i = 1; i < 6; i++) {
      const a = Math.PI + (i / 6) * Math.PI;
      k.line([[50, 78], [50 + Math.cos(a) * 27, 56 + Math.sin(a) * 27]], "#e38f72", 1.6, 1);
    }
  },
  acorn(k) {
    k.shape(k.blob(50, 60, 17, 20), C.wood);
    k.shape(k.poly([[30, 46], [36, 34], [50, 30], [64, 34], [70, 46], [50, 50]]), C.brown);
    k.tube([[50, 31], [53, 22]], C.woodDark, 3);
    k.shine([[42, 58], [43, 70]], "#ffffff", 2.5, 0.5);
  },
  carrot(k) {
    k.shape(leafPts(50, 30, -2.0, 18, 8), C.leaf, { w: 1.4 });
    k.shape(leafPts(50, 30, -1.1, 18, 8), C.grass, { w: 1.4 });
    k.shape(k.poly([[38, 32], [62, 32], [52, 84], [48, 84]]), C.orange);
    for (let i = 0; i < 3; i++) k.line([[42 + i * 2, 44 + i * 12], [50 + i, 44 + i * 12]], "#c4651e", 1.4, 1);
  },
  pinecone(k) {
    k.shape(k.blob(50, 54, 18, 26), C.trunk);
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 3; c++) k.shape(k.ell(40 + c * 10, 40 + r * 10, 5, 4), C.brown, { w: 1.1 });
    k.tube([[50, 28], [50, 20]], C.woodDark, 3);
  },
  pearl(k) {
    k.shape(k.ell(50, 62, 30, 13), "#c6b7e8");
    k.shape(k.ell(50, 40, 28, 12, 0.08), "#d7cdf2");
    k.circle(50, 56, 11, "#fbf8ff");
    k.shine([[45, 52], [48, 49]], "#ffffff", 3, 0.9);
  },
  bell(k) {
    k.circle(50, 26, 5, GOLD, 1.4);
    k.shape(k.poly([[50, 28], [64, 36], [68, 62], [78, 72], [22, 72], [32, 62], [36, 36]]), GOLD);
    k.circle(50, 76, 6, C.gold, 1.4);
    k.tube([[60, 38], [64, 62]], "#fff1b8", 2);
    k.shape(leafPts(50, 22, -2.5, 14, 7), C.red, { w: 1.2 });
    k.shape(leafPts(50, 22, -0.6, 14, 7), C.red, { w: 1.2 });
  },
};
