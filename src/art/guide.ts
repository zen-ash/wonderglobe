// Shelly the paper snail: an original crayon cut-out (side view, facing
// right) used for the 3D guide in the paper world and her speech-bubble
// portrait.

import { C, renderKitArt, bezierPts, type Kit } from "./kit";
import type { Pt } from "./crayon";

const BODY = "#bfe8a6";
const BODY_DARK = "#8fcf7e";
const SHELL = "#ff9fb2";
const SHELL_DARK = "#ee6f96";
const SPIRAL = "#ffd447";

function spiral(cx: number, cy: number, r: number, turns = 2.2, n = 40): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = t * turns * Math.PI * 2;
    const rr = r * (1 - t * 0.92);
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  return pts;
}

function drawShelly(k: Kit, blink: boolean) {
  // Foot / body: a long soft slug, head raised at the right.
  const body: Pt[] = [
    [10, 88],
    [14, 82],
    [30, 80],
    [56, 79],
    [68, 74],
    [72, 62],
    [74, 50],
    [82, 44],
    [91, 48],
    [93, 60],
    [90, 74],
    [92, 84],
    [88, 90],
    [50, 92],
    [20, 92],
  ];
  k.shape(k.poly(body, 0.4), BODY);
  k.line([[18, 89], [86, 89]], BODY_DARK, 1.6, 1);
  // Eye stalks and eyes.
  k.tube([[80, 48], [76, 30]], BODY, 3);
  k.tube([[87, 48], [91, 31]], BODY, 3);
  for (const [x, y] of [[76, 27], [91, 28]] as Pt[]) {
    k.circle(x, y, 5.5, "#fffdf6", 1.6);
    if (blink) k.line([[x - 3.5, y], [x + 3.5, y]], C.ink, 1.8, 1);
    else {
      k.dot(x + 1.2, y + 0.6, 2.6, C.ink);
      k.dot(x + 2.2, y - 0.6, 0.9, "#ffffff");
    }
  }
  // Smile and rosy cheek.
  k.line(bezierPts([80, 60], [85, 65], [90, 59], 8), C.ink, 1.7, 1);
  k.dot(78, 56, 3, "#ff9fb2", 0.75);
  // The shell: pink with a sunny spiral.
  k.shape(k.blob(42, 56, 27, 26, 0.03, 26), SHELL, { w: 2.2 });
  k.line(spiral(43, 57, 21, 2.1), SPIRAL, 5, 1);
  k.line(spiral(43, 57, 21, 2.1), SHELL_DARK, 1.3, 1);
  k.shine([[24, 46], [28, 38], [34, 33]], "#ffffff", 2.4, 0.65);
  // A tiny paper flower on the shell.
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    k.dot(56 + Math.cos(a) * 3.2, 34 + Math.sin(a) * 3.2, 2.4, "#fffdf6");
  }
  k.dot(56, 34, 1.8, C.yellow);
}

const cache = new Map<string, HTMLCanvasElement>();
const urls = new Map<string, string>();

/** Shelly as a paper cut-out canvas (transparent outside the paper). */
export function shellyCanvas(size = 256, blink = false): HTMLCanvasElement {
  const key = `${size}:${blink ? 1 : 0}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const c = renderKitArt(size, size, 0x5e11, (k) => drawShelly(k, blink), { border: size * 0.035, outline: size * 0.012 });
  cache.set(key, c);
  return c;
}

/** Data URL of Shelly's cut-out (for the speech-bubble portrait). */
export function shellyUrl(size = 160, blink = false): string {
  const key = `${size}:${blink ? 1 : 0}`;
  let u = urls.get(key);
  if (!u) {
    u = shellyCanvas(size, blink).toDataURL("image/png");
    urls.set(key, u);
  }
  return u;
}

/** Height / width of the art (square canvas; the snail sits on the bottom). */
export const SHELLY_ASPECT = 1;
