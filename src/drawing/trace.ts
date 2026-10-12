// Contour tracing and polygon simplification.
//
// Outer boundaries are traced along pixel edges ("crack following"), so the
// resulting vertices sit on pixel corners: a pixel (x, y) covers the square
// [x, x+1] × [y, y+1]. Each outline is walked with the shape on the right
// hand side, which in image coordinates (x right, y down) means
// **clockwise on screen** and a **positive** shoelace area. Flipping y to
// point up (e.g. for Three.js shapes) turns it counter-clockwise.

import type { Polygon } from "@/core/types";
import { connectedComponents } from "./morphology";

// Directions: 0 = right (+x), 1 = down (+y), 2 = left (-x), 3 = up (-y).
const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];

/**
 * Traces the outer boundary of the component with `label`, starting at the
 * top-left corner of its first pixel in raster order. 8-connected pixels
 * (diagonal neighbours) are treated as joined, matching the labelling.
 */
export function traceOuterBoundary(
  labels: Int32Array,
  w: number,
  h: number,
  label: number,
  startIndex: number,
): Polygon {
  const inside = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < w && y < h && labels[y * w + x] === label;
  const sx = startIndex % w;
  const sy = (startIndex - sx) / w;
  const pts: Polygon = [[sx, sy]];
  let cx = sx;
  let cy = sy;
  let dir = 0;
  const maxSteps = 4 * (w + 1) * (h + 1) + 8;
  for (let step = 0; step < maxSteps; step++) {
    cx += DX[dir];
    cy += DY[dir];
    // The two pixels ahead of the current corner, left and right of travel.
    let lx: number, ly: number, rx: number, ry: number;
    switch (dir) {
      case 0: lx = cx; ly = cy - 1; rx = cx; ry = cy; break;
      case 1: lx = cx; ly = cy; rx = cx - 1; ry = cy; break;
      case 2: lx = cx - 1; ly = cy; rx = cx - 1; ry = cy - 1; break;
      default: lx = cx - 1; ly = cy - 1; rx = cx; ry = cy - 1; break;
    }
    let next: number;
    if (inside(lx, ly)) next = (dir + 3) & 3; // turn left
    else if (inside(rx, ry)) next = dir; // straight on
    else next = (dir + 1) & 3; // turn right
    if (cx === sx && cy === sy && next === 0) break;
    if (next !== dir) pts.push([cx, cy]);
    dir = next;
  }
  return pts;
}

/**
 * Traces the outer boundary of every 8-connected component of `mask` whose
 * area is at least `minArea` pixels. Components are returned in raster order
 * of their top-left pixel (deterministic). Holes are not traced.
 */
export function traceOuterContours(mask: Uint8Array, w: number, h: number, minArea = 1): Polygon[] {
  const cc = connectedComponents(mask, w, h);
  const out: Polygon[] = [];
  for (let l = 1; l <= cc.count; l++) {
    if (cc.areas[l] < minArea) continue;
    out.push(traceOuterBoundary(cc.labels, w, h, l, cc.firstIndex[l]));
  }
  return out;
}

/** Signed shoelace area (positive for the clockwise-on-screen outlines traced here). */
export function polygonArea(poly: Polygon): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    a += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
  }
  return a / 2;
}

function segmentDistance2(p: [number, number], a: [number, number], b: [number, number]): number {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const len2 = vx * vx + vy * vy;
  let t = len2 > 0 ? ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = a[0] + t * vx - p[0];
  const dy = a[1] + t * vy - p[1];
  return dx * dx + dy * dy;
}

/** Iterative Douglas–Peucker on pts[first..last], marking kept points. */
function douglasPeucker(pts: Polygon, first: number, last: number, eps2: number, keep: Uint8Array): void {
  const stack: number[] = [first, last];
  while (stack.length > 0) {
    const b = stack.pop() as number;
    const a = stack.pop() as number;
    let worst = -1;
    let worstD = eps2;
    for (let i = a + 1; i < b; i++) {
      const d = segmentDistance2(pts[i], pts[a], pts[b]);
      if (d > worstD) {
        worstD = d;
        worst = i;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push(a, worst, worst, b);
    }
  }
}

/**
 * Simplifies a closed polygon with Douglas–Peucker (tolerance `epsilon` px).
 * The ring is split at its first vertex and the vertex farthest from it so
 * the result does not depend on an arbitrary seam. Always returns ≥ 3 points
 * when the input has ≥ 3.
 */
export function simplifyClosed(poly: Polygon, epsilon: number): Polygon {
  const n = poly.length;
  if (n <= 3) return poly.map((p) => [p[0], p[1]] as [number, number]);
  let far = 1;
  let farD = -1;
  for (let i = 1; i < n; i++) {
    const dx = poly[i][0] - poly[0][0];
    const dy = poly[i][1] - poly[0][1];
    const d = dx * dx + dy * dy;
    if (d > farD) {
      farD = d;
      far = i;
    }
  }
  const ring: Polygon = [...poly, poly[0]];
  const keep = new Uint8Array(n + 1);
  keep[0] = keep[far] = keep[n] = 1;
  const eps2 = epsilon * epsilon;
  douglasPeucker(ring, 0, far, eps2, keep);
  douglasPeucker(ring, far, n, eps2, keep);
  const out: Polygon = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push([poly[i][0], poly[i][1]]);
  if (out.length >= 3) return out;
  // Degenerate (very thin) shape: keep the three most spread-out vertices.
  let third = 1;
  let thirdD = -1;
  for (let i = 1; i < n; i++) {
    if (i === far) continue;
    const d = segmentDistance2(poly[i], poly[0], poly[far]);
    if (d > thirdD) {
      thirdD = d;
      third = i;
    }
  }
  return [0, far, third]
    .sort((a, b) => a - b)
    .map((i) => [poly[i][0], poly[i][1]] as [number, number]);
}
