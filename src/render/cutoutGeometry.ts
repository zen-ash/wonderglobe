// Turns a traced cut-out silhouette into real paper geometry: an extruded
// card (front/back carry the drawing, the edge is white paper) whose outline
// is the drawing's own outline. Also derives house walls/roof dimensions.

import * as THREE from "three";
import type { CutoutMeta } from "@/core/types";
import { bridgeDeckAt, type BridgeSpan } from "@/world/collision";
import { PLANET_RADIUS } from "@/world/sphere";

export interface CutoutGeometry {
  /**
   * The card: groups 0 = front (the drawing), 1 = cut edge (white paper),
   * 2 = back (plain paper). Use with `[front, edge, back]` materials.
   */
  geometry: THREE.BufferGeometry;
  /** World units per pixel. */
  scale: number;
  halfWidth: number;
  height: number;
  width: number;
}

export const PAPER_THICKNESS = 0.05;

/** Material slots of a cut-out card. */
export const CARD_GROUP = { front: 0, edge: 1, back: 2 } as const;

export interface CutoutOptions {
  /**
   * How far the middle of the card bows toward the viewer (world units), like
   * a sheet of card standing in a slot. Default: a little, by size. 0 = flat.
   */
  bow?: number;
  /** Target number of slices across the longer side (for smooth curl / bow). */
  slices?: number;
}

/** Pixel → local coordinates (origin at the anchor, y up). */
function toLocal(meta: CutoutMeta, f: number, px: number, py: number): [number, number] {
  return [(px - meta.anchor[0] * meta.width) * f, (meta.anchor[1] * meta.height - py) * f];
}

type P2 = [number, number];

/** Clip a convex polygon to a ≤ v ≤ b on one axis (0 = x, 1 = y). */
function clipAxis(poly: P2[], axis: 0 | 1, a: number, b: number): P2[] {
  let out = poly;
  for (const [limit, keepAbove] of [
    [a, true],
    [b, false],
  ] as Array<[number, boolean]>) {
    if (!isFinite(limit) || out.length === 0) continue;
    const src = out;
    out = [];
    for (let i = 0; i < src.length; i++) {
      const p = src[i], q = src[(i + 1) % src.length];
      const pin = keepAbove ? p[axis] >= limit : p[axis] <= limit;
      const qin = keepAbove ? q[axis] >= limit : q[axis] <= limit;
      if (pin) out.push(p);
      if (pin !== qin) {
        const t = (limit - p[axis]) / (q[axis] - p[axis]);
        const r: P2 = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
        r[axis] = limit;
        out.push(r);
      }
    }
  }
  // Drop repeated points (a vertex lying exactly on a cut line).
  return out.filter((p, i) => {
    const q = out[(i + out.length - 1) % out.length];
    return out.length < 2 || Math.abs(p[0] - q[0]) > 1e-9 || Math.abs(p[1] - q[1]) > 1e-9;
  });
}

function area2(poly: P2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a;
}

/** Parameters (0..1) where segment p→q crosses any of the grid lines. */
function crossings(p: P2, q: P2, xs: number[], ys: number[]): number[] {
  const ts: number[] = [];
  const dx = q[0] - p[0], dy = q[1] - p[1];
  if (Math.abs(dx) > 1e-9) for (const x of xs) {
    const t = (x - p[0]) / dx;
    if (t > 1e-6 && t < 1 - 1e-6) ts.push(t);
  }
  if (Math.abs(dy) > 1e-9) for (const y of ys) {
    const t = (y - p[1]) / dy;
    if (t > 1e-6 && t < 1 - 1e-6) ts.push(t);
  }
  return ts.sort((a, b) => a - b);
}

/**
 * Turn a traced silhouette into a paper card: the drawing on the front, plain
 * paper on the back, a white cut edge, gently bowed. The faces are sliced
 * along a grid (crack-free: shared edges split at the same points) so curl,
 * wing folds and body waves bend smoothly instead of only moving the outline.
 * Vertex colours carry the soft shading that follows the bow.
 */
export function buildCutoutGeometry(meta: CutoutMeta, worldHeight: number, thickness = PAPER_THICKNESS, opts: CutoutOptions = {}): CutoutGeometry {
  // Size by the silhouette's actual height in the bitmap (padding excluded).
  let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity;
  for (const poly of meta.polygons) {
    for (const [x, y] of poly) {
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    }
  }
  if (!isFinite(minY)) {
    minY = 0; maxY = meta.height; minX = 0; maxX = meta.width;
  }
  // Keep very wide drawings from becoming enormous.
  const silH = Math.max(1, maxY - minY), silW = Math.max(1, maxX - minX);
  let f = worldHeight / silH;
  const maxWidth = worldHeight * 2.2;
  if (silW * f > maxWidth) f = maxWidth / silW;

  const left = (minX - meta.anchor[0] * meta.width) * f;
  const right = (maxX - meta.anchor[0] * meta.width) * f;
  const top = (meta.anchor[1] * meta.height - minY) * f;
  const bottom = (meta.anchor[1] * meta.height - maxY) * f;
  const width = right - left;
  const cx = (left + right) / 2;
  const half = Math.max(1e-3, width / 2);
  const bow = opts.bow ?? Math.min(0.09, 0.035 * Math.max(width, top - bottom));

  // Slice grid (interior lines only).
  const slices = opts.slices ?? 8;
  const cell = Math.max(width, top - bottom, 1e-3) / slices;
  const nx = Math.max(1, Math.min(14, Math.round(width / cell)));
  const ny = Math.max(1, Math.min(14, Math.round((top - bottom) / cell)));
  const xs: number[] = [], ys: number[] = [];
  for (let i = 1; i < nx; i++) xs.push(left + (width * i) / nx);
  for (let j = 1; j < ny; j++) ys.push(bottom + ((top - bottom) * j) / ny);
  const xb = [-Infinity, ...xs, Infinity];
  const yb = [-Infinity, ...ys, Infinity];

  const polys = meta.polygons.length ? meta.polygons : [[[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]] as Array<[number, number]>];
  const capTris: number[] = []; // x,y triples (front winding, CCW seen from +z)
  const edges: Array<[P2, P2]> = [];
  for (const poly of polys) {
    if (poly.length < 3) continue;
    let pts = poly.map(([x, y]) => new THREE.Vector2(...toLocal(meta, f, x, y)));
    // Drop repeated points (and a closing duplicate).
    pts = pts.filter((p, i) => p.distanceToSquared(pts[(i + 1) % pts.length]) > 1e-12);
    if (pts.length < 3) continue;
    if (THREE.ShapeUtils.isClockWise(pts)) pts.reverse();
    const faces = THREE.ShapeUtils.triangulateShape(pts, []);
    for (const [a, b, c] of faces) {
      const tri: P2[] = [
        [pts[a].x, pts[a].y],
        [pts[b].x, pts[b].y],
        [pts[c].x, pts[c].y],
      ];
      if (area2(tri) < 0) tri.reverse();
      const tx0 = Math.min(tri[0][0], tri[1][0], tri[2][0]), tx1 = Math.max(tri[0][0], tri[1][0], tri[2][0]);
      const ty0 = Math.min(tri[0][1], tri[1][1], tri[2][1]), ty1 = Math.max(tri[0][1], tri[1][1], tri[2][1]);
      for (let i = 0; i < xb.length - 1; i++) {
        if (xb[i + 1] <= tx0 || xb[i] >= tx1) continue;
        const strip = clipAxis(tri, 0, xb[i], xb[i + 1]);
        if (strip.length < 3) continue;
        for (let j = 0; j < yb.length - 1; j++) {
          if (yb[j + 1] <= ty0 || yb[j] >= ty1) continue;
          const piece = clipAxis(strip, 1, yb[j], yb[j + 1]);
          if (piece.length < 3 || Math.abs(area2(piece)) < 1e-10) continue;
          for (let k = 1; k < piece.length - 1; k++) capTris.push(piece[0][0], piece[0][1], piece[k][0], piece[k][1], piece[k + 1][0], piece[k + 1][1]);
        }
      }
    }
    for (let i = 0; i < pts.length; i++) {
      const p: P2 = [pts[i].x, pts[i].y];
      const q: P2 = [pts[(i + 1) % pts.length].x, pts[(i + 1) % pts.length].y];
      const ts = crossings(p, q, xs, ys);
      let prev = p;
      for (const t of [...ts, 1]) {
        const next: P2 = t === 1 ? q : [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
        edges.push([prev, next]);
        prev = next;
      }
    }
  }

  const capVerts = capTris.length / 2;
  const total = capVerts * 2 + edges.length * 6;
  const position = new Float32Array(total * 3);
  const normal = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  const color = new Float32Array(total * 3);
  const hz = thickness / 2;
  // Light for the baked shading: from the upper front-left.
  const L = new THREE.Vector3(-0.55, 0.3, 0.78).normalize();
  const n0 = L.z;
  let w = 0;
  const bowZ = (x: number) => {
    const xn = Math.max(-1, Math.min(1, (x - cx) / half));
    return bow * (1 - xn * xn);
  };
  const slope = (x: number) => {
    const xn = Math.max(-1, Math.min(1, (x - cx) / half));
    return (-2 * bow * xn) / half;
  };
  const put = (x: number, y: number, z: number, nx_: number, ny_: number, nz_: number, shade: number) => {
    position[w * 3] = x;
    position[w * 3 + 1] = y;
    position[w * 3 + 2] = z + bowZ(x);
    normal[w * 3] = nx_;
    normal[w * 3 + 1] = ny_;
    normal[w * 3 + 2] = nz_;
    uv[w * 2] = x / (f * meta.width) + meta.anchor[0];
    uv[w * 2 + 1] = 1 - meta.anchor[1] + y / (f * meta.height);
    color[w * 3] = color[w * 3 + 1] = color[w * 3 + 2] = shade;
    w++;
  };
  const capShade = (x: number, y: number, side: 1 | -1) => {
    // Normal of the bowed sheet: (-dz/dx, 0, 1).
    const sx = -slope(x) * side;
    const len = Math.hypot(sx, 1);
    const lam = (sx * L.x + L.z) / len;
    const yn = Math.max(0, Math.min(1, (y - bottom) / Math.max(1e-3, top - bottom)));
    const base = side > 0 ? 1 : 0.9;
    // Amplified so the gentle bow reads; a touch darker toward the foot.
    return Math.max(0.72, Math.min(1.03, base + (lam - n0) * 2.2 - (1 - yn) * 0.04));
  };
  // Front (+z): as triangulated.
  for (let i = 0; i < capTris.length; i += 2) {
    const x = capTris[i], y = capTris[i + 1];
    const s = slope(x), len = Math.hypot(s, 1);
    put(x, y, hz, -s / len, 0, 1 / len, capShade(x, y, 1));
  }
  // Back (-z): reversed winding.
  for (let i = 0; i < capTris.length; i += 6) {
    for (const k of [0, 4, 2]) {
      const x = capTris[i + k], y = capTris[i + k + 1];
      const s = slope(x), len = Math.hypot(s, 1);
      put(x, y, -hz, s / len, 0, -1 / len, capShade(x, y, -1));
    }
  }
  // Cut edge: outward-facing quads.
  for (const [p, q] of edges) {
    const dx = q[0] - p[0], dy = q[1] - p[1];
    const l = Math.hypot(dx, dy) || 1;
    const ex = dy / l, ey = -dx / l;
    put(p[0], p[1], hz, ex, ey, 0, 1);
    put(p[0], p[1], -hz, ex, ey, 0, 1);
    put(q[0], q[1], -hz, ex, ey, 0, 1);
    put(p[0], p[1], hz, ex, ey, 0, 1);
    put(q[0], q[1], -hz, ex, ey, 0, 1);
    put(q[0], q[1], hz, ex, ey, 0, 1);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(position, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geometry.setAttribute("color", new THREE.BufferAttribute(color, 3));
  geometry.addGroup(0, capVerts, CARD_GROUP.front);
  geometry.addGroup(capVerts * 2, edges.length * 6, CARD_GROUP.edge);
  geometry.addGroup(capVerts, capVerts, CARD_GROUP.back);
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return { geometry, scale: f, halfWidth: Math.max(Math.abs(left), Math.abs(right)), height: top, width };
}

export interface HouseShape {
  /** Wall half-width, wall height and roof peak height (local units). */
  wallLeft: number;
  wallRight: number;
  wallHeight: number;
  peak: number;
  peakX: number;
  depth: number;
}

/** Derive a paper building from the drawing: walls below the roof line, a folded roof above. */
export function deriveHouseShape(meta: CutoutMeta, f: number): HouseShape {
  const roofPy = meta.roofLine * meta.height;
  let wallMin = Infinity, wallMax = -Infinity, topY = Infinity, topX = meta.anchor[0] * meta.width;
  for (const poly of meta.polygons) {
    for (const [x, y] of poly) {
      if (y > roofPy + (meta.anchor[1] * meta.height - roofPy) * 0.25) {
        if (x < wallMin) wallMin = x;
        if (x > wallMax) wallMax = x;
      }
      if (y < topY) {
        topY = y;
        topX = x;
      }
    }
  }
  if (!isFinite(wallMin)) {
    wallMin = meta.width * 0.2;
    wallMax = meta.width * 0.8;
  }
  if (!isFinite(topY)) topY = 0;
  const [wl] = toLocal(meta, f, wallMin, 0);
  const [wr] = toLocal(meta, f, wallMax, 0);
  const wallHeight = Math.max(0.3, (meta.anchor[1] * meta.height - roofPy) * f);
  const peak = Math.max(wallHeight + 0.2, (meta.anchor[1] * meta.height - topY) * f);
  const [px] = toLocal(meta, f, topX, 0);
  const inset = (wr - wl) * 0.06;
  return { wallLeft: wl + inset, wallRight: wr - inset, wallHeight, peak, peakX: Math.min(wr, Math.max(wl, px)), depth: Math.max(0.8, (wr - wl) * 0.75) };
}

/**
 * Average colour of the drawing's own ink in a band of the cut-out (0 = top,
 * 1 = bottom), skipping white paper, the dark cut line and transparent pixels.
 * Used to colour a building's roof and walls from the child's drawing.
 */
export function sampleBandColor(image: CanvasImageSource & { width: number; height: number }, from: number, to: number): string | null {
  const S = 64;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(image, 0, 0, S, S);
  const data = ctx.getImageData(0, Math.floor(from * S), S, Math.max(1, Math.ceil((to - from) * S))).data;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 200) continue;
    const R = data[i], G = data[i + 1], B = data[i + 2];
    const max = Math.max(R, G, B), min = Math.min(R, G, B);
    if (min > 225) continue; // white paper
    if (max < 70) continue; // cut line / dark ink
    // Favour coloured ink over greys.
    const w = 0.3 + (max - min) / 255;
    r += R * w;
    g += G * w;
    b += B * w;
    n += w;
  }
  if (n < 3) return null;
  const hex = (v: number) => Math.round(v / n).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

// ---------------------------------------------------------------- bridges
// Bridge geometry lives in the bridge's local frame: origin on the planet
// surface (radius PLANET_RADIUS) under its centre, +X along the crossing,
// +Y up, +Z sideways. Points are bent along the sphere so long bridges hug it.

/** Height of the drawing standing along each side of a bridge. */
export const BRIDGE_WALL = 1.5;
const RAIL_OFFSET = 0.8;

/** Local position of a point at arc length `along`, absolute radius `r` and lateral offset `w`, relative to the bridge centre on the planet surface. */
export function bend(along: number, r: number, w: number, out: THREE.Vector3): THREE.Vector3 {
  // Angles along and across the bridge, so the point sits exactly at radius r.
  const phi = along / PLANET_RADIUS;
  const psi = w / PLANET_RADIUS;
  const c = Math.cos(psi);
  return out.set(r * Math.sin(phi) * c, r * Math.cos(phi) * c - PLANET_RADIUS, r * Math.sin(psi));
}

/** Paper planks on the water following the deck (one merged geometry). */
export function buildBridgePlanks(span: BridgeSpan): THREE.BufferGeometry {
  const half = span.halfAngle * PLANET_RADIUS;
  const count = Math.max(4, Math.ceil((half * 2) / 0.34));
  const step = (half * 2) / count;
  const positions: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];
  const width = span.halfWidth + 0.08;
  const tones = [new THREE.Color("#e8c9a0"), new THREE.Color("#dcb98c"), new THREE.Color("#f0d6b0")];
  const quad = (a: THREE.Vector3, b: THREE.Vector3, cc: THREE.Vector3, d: THREE.Vector3, col: THREE.Color) => {
    for (const p of [a, b, cc, a, cc, d]) {
      positions.push(p.x, p.y, p.z);
      colors.push(col.r, col.g, col.b);
    }
    uvs.push(0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1);
  };
  for (let i = 0; i < count; i++) {
    const s0 = -half + i * step + 0.03, s1 = -half + (i + 1) * step - 0.03;
    const r0 = bridgeDeckAt(span, s0), r1 = bridgeDeckAt(span, s1);
    const col = tones[i % tones.length];
    const corners = (r: number, s: number, w: number, down: number) => bend(s, r - down, w, new THREE.Vector3());
    const t00 = corners(r0, s0, -width, 0), t01 = corners(r0, s0, width, 0), t11 = corners(r1, s1, width, 0), t10 = corners(r1, s1, -width, 0);
    const b00 = corners(r0, s0, -width, 0.07), b01 = corners(r0, s0, width, 0.07), b11 = corners(r1, s1, width, 0.07), b10 = corners(r1, s1, -width, 0.07);
    quad(t00, t10, t11, t01, col); // top
    quad(b00, b01, b11, b10, col.clone().multiplyScalar(0.7)); // bottom
    quad(t00, t01, b01, b00, col.clone().multiplyScalar(0.85)); // ends
    quad(t10, b10, b11, t11, col.clone().multiplyScalar(0.85));
    quad(t00, b00, b10, t10, col.clone().multiplyScalar(0.8)); // sides
    quad(t01, t11, b11, b01, col.clone().multiplyScalar(0.8));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** The drawing bent along the bridge as a standing side panel (one per side). */
export function buildBridgeSide(meta: CutoutMeta, span: BridgeSpan, side: 1 | -1): THREE.BufferGeometry {
  const cut = buildCutoutGeometry(meta, BRIDGE_WALL, PAPER_THICKNESS, { bow: 0, slices: 6 });
  const g = cut.geometry;
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  const midX = (bb.min.x + bb.max.x) / 2;
  const half = span.halfAngle * PLANET_RADIUS;
  const sx = (half * 2 * 1.02) / Math.max(0.1, bb.max.x - bb.min.x);
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const out = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const along = side * (x - midX) * sx;
    const r = bridgeDeckAt(span, Math.max(-half, Math.min(half, along))) - 0.5 + (y - bb.min.y);
    bend(along, r, side * (RAIL_OFFSET + z), out);
    pos.setXYZ(i, out.x, out.y, out.z);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}
