"use client";
// One signpost per region, standing on open land near the region's centre.
//  * Living Paper World: a paper cut-out board on a stick with the region's
//    name hand-lettered in crayon (one atlas texture, one merged double-sided
//    card mesh that casts a shadow in its cut-out shape).
//  * Miniature Gallery World: a small outlined wooden sign (instanced boxes +
//    outline hull) with the name painted on both faces of the board.
// Textures are drawn once; the whole set is at most five meshes.

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { WorldRuntime } from "@/world/runtime";
import type { WorldMode } from "@/core/types";
import type { SceneryItem } from "@/world/scenery";
import { REGIONS, type Terrain } from "@/world/planet";
import { PLANET_RADIUS, anyTangent, frameMatrix, tangentToward, angleBetween } from "@/world/sphere";
import { getToonGradient, applyOcclusionDither } from "./materials";
import { createShapeBatches, partMatrix, type Part } from "./shapes";

// ------------------------------------------------------------------ placement

export interface SignSpot {
  region: number;
  /** Unit surface normal. */
  n: THREE.Vector3;
  /** Unit tangent the sign's front faces (away from the region centre). */
  facing: THREE.Vector3;
}

/** Total sign height in world units. */
export const SIGN_HEIGHT = 1.6;
const SIGN_OBSTACLE_RADIUS = 0.3;

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const _q = new THREE.Vector3();

/** Is `n` a calm, open spot for a sign in region `index`? */
function goodSpot(terrain: Terrain, items: SceneryItem[], index: number, n: THREE.Vector3): boolean {
  const reg = terrain.regionAt(n);
  if (reg.index !== index || reg.depth < 0.025) return false;
  if (terrain.waterAt(n, -0.035) >= 0 || terrain.isBlockedTerrain(n)) return false;
  const s = terrain.sample(n);
  if (s.ground === "path" || s.ground === "sand" || s.ground === "water") return false;
  if (s.height > PLANET_RADIUS + 2.4) return false;
  // Not on a slope, and not right beside a path.
  const t = anyTangent(n, new THREE.Vector3());
  const b = new THREE.Vector3().crossVectors(n, t);
  for (let k = 0; k < 4; k++) {
    const dir = k === 0 ? t : k === 1 ? b : k === 2 ? t.clone().negate() : b.clone().negate();
    _q.copy(n).addScaledVector(dir, 0.028).normalize();
    const sk = terrain.sample(_q);
    if (sk.ground === "path" || sk.ground === "water") return false;
    if (Math.abs(sk.height - s.height) > 0.32) return false;
  }
  // Clear of scenery (trees, houses, rocks… and little flowers).
  for (const it of items) {
    if (it.n.dot(n) < 0.98) continue;
    const d = angleBetween(it.n, n) * PLANET_RADIUS;
    const need = it.flat ? it.size * 0.5 + 0.4 : it.radius > 0 ? Math.max(it.radius, it.size * 0.32) + 0.75 : 0.45;
    if (d < need) return false;
  }
  return true;
}

/**
 * Deterministic sign spots: for each region, the open spot closest to its
 * centre (searching outward in rings), facing away from the centre.
 */
export function pickSignSpots(terrain: Terrain, items: SceneryItem[]): SignSpot[] {
  const out: SignSpot[] = [];
  REGIONS.forEach((r, index) => {
    const c = r.center;
    const t0 = anyTangent(c, new THREE.Vector3());
    const b0 = new THREE.Vector3().crossVectors(c, t0);
    const rng = mulberry(0x5167 + index * 977);
    const turn0 = rng() * Math.PI * 2;
    const n = new THREE.Vector3();
    let found: THREE.Vector3 | null = null;
    for (let a = 0.05; a <= 0.52 && !found; a += 0.012) {
      const steps = 18;
      for (let k = 0; k < steps; k++) {
        const phi = turn0 + (k * Math.PI * 2) / steps;
        const dir = t0.clone().multiplyScalar(Math.cos(phi)).addScaledVector(b0, Math.sin(phi));
        n.copy(c).multiplyScalar(Math.cos(a)).addScaledVector(dir, Math.sin(a)).normalize();
        if (goodSpot(terrain, items, index, n)) {
          found = n.clone();
          break;
        }
      }
    }
    if (!found) return;
    const facing = tangentToward(found, c, new THREE.Vector3()).negate();
    out.push({ region: index, n: found, facing });
  });
  return out;
}

// ------------------------------------------------------------------ lettering

function cssFont(varName: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return v ? `${v}, ${fallback}` : fallback;
}

const EMOJI_FONT = `"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;

/** Crayon colour per region (board tint / painted letters). */
const REGION_COLOR: Record<string, string> = {
  garden: "#ffd447",
  lily: "#ff9fc8",
  village: "#ffb067",
  picnic: "#ff8a7a",
  meadow: "#f9a8e0",
  cherry: "#ffc1d6",
  forest: "#8fdc7a",
  farm: "#ffcf5a",
  duckpond: "#8fd0ff",
  coast: "#7fe0d2",
  mountain: "#cfe4ff",
  lake: "#7fb8ff",
};

function splitName(name: string): string[] {
  if (name.length <= 11) return [name];
  const i = name.indexOf(" ");
  return i > 0 ? [name.slice(0, i), name.slice(i + 1)] : [name];
}

/** Fit `lines` into maxW × maxH; returns the font size. */
function fitText(ctx: CanvasRenderingContext2D, lines: string[], font: (px: number) => string, maxW: number, maxH: number, start: number): number {
  let px = start;
  for (; px > 18; px -= 2) {
    ctx.font = font(px);
    const w = Math.max(...lines.map((l) => ctx.measureText(l).width));
    if (w <= maxW && px * 0.92 * lines.length <= maxH) break;
  }
  return px;
}

function wobblyRect(x0: number, y0: number, x1: number, y1: number, r: number, rng: () => number): Path2D {
  const j = () => (rng() - 0.5) * 6;
  const p = new Path2D();
  const a = [x0 + j(), y0 + j()], b = [x1 + j(), y0 + j()], c = [x1 + j(), y1 + j()], d = [x0 + j(), y1 + j()];
  p.moveTo(a[0] + r, a[1]);
  p.quadraticCurveTo((a[0] + b[0]) / 2, a[1] - 3 + j(), b[0] - r, b[1]);
  p.quadraticCurveTo(b[0], b[1], b[0], b[1] + r);
  p.quadraticCurveTo(b[0] + 3 + j(), (b[1] + c[1]) / 2, c[0], c[1] - r);
  p.quadraticCurveTo(c[0], c[1], c[0] - r, c[1]);
  p.quadraticCurveTo((c[0] + d[0]) / 2, c[1] + 3 + j(), d[0] + r, d[1]);
  p.quadraticCurveTo(d[0], d[1], d[0], d[1] - r);
  p.quadraticCurveTo(d[0] - 3 + j(), (d[1] + a[1]) / 2, a[0], a[1] + r);
  p.quadraticCurveTo(a[0], a[1], a[0] + r, a[1]);
  p.closePath();
  return p;
}

const PAPER_CELL_W = 400;
const PAPER_CELL_H = 440;
const PAPER_COLS = 4;
const INK = "#2b2320";

/** Paper cut-out sign (board + stick) into the cell at (ox, oy). Returns nothing; layout is fixed. */
function drawPaperSign(ctx: CanvasRenderingContext2D, ox: number, oy: number, index: number) {
  const r = REGIONS[index];
  const rng = mulberry(0xbeef + index * 131);
  const W = PAPER_CELL_W, H = PAPER_CELL_H;
  ctx.save();
  ctx.translate(ox, oy);
  ctx.clearRect(0, 0, W, H);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const tilt = (rng() - 0.5) * 0.05;
  ctx.translate(W / 2, H / 2);
  ctx.rotate(tilt);
  ctx.translate(-W / 2, -H / 2);
  const board = wobblyRect(30, 24, W - 30, 228, 22, rng);
  const stick = new Path2D();
  stick.rect(W / 2 - 13, 200, 26, H - 216);
  const border = 13;
  // Paper edge: dark cut line, then the white border, then the paper itself.
  ctx.strokeStyle = "rgba(43,35,32,0.9)";
  ctx.lineWidth = border * 2 + 5;
  ctx.stroke(board);
  ctx.stroke(stick);
  ctx.strokeStyle = "#fffdf6";
  ctx.lineWidth = border * 2;
  ctx.stroke(board);
  ctx.stroke(stick);
  ctx.fillStyle = "#fffdf6";
  ctx.fill(board);
  ctx.fill(stick);
  // Stick: brown crayon.
  ctx.fillStyle = "#b07a4c";
  ctx.fill(stick);
  ctx.save();
  ctx.clip(stick);
  ctx.strokeStyle = "rgba(90,55,30,0.35)";
  ctx.lineWidth = 2;
  for (let y = 200; y < H; y += 9) {
    ctx.beginPath();
    ctx.moveTo(W / 2 - 14, y + rng() * 4);
    ctx.lineTo(W / 2 + 14, y + 6 + rng() * 4);
    ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 4;
  ctx.stroke(stick);
  // Board: cream paper scribbled over with the region's crayon colour.
  ctx.fillStyle = "#fff6dc";
  ctx.fill(board);
  ctx.save();
  ctx.clip(board);
  ctx.strokeStyle = REGION_COLOR[r.id] ?? "#ffd447";
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 7;
  for (let k = -H; k < W + H; k += 11) {
    ctx.beginPath();
    ctx.moveTo(k + rng() * 5, 10);
    ctx.lineTo(k - 210 + rng() * 8, 240);
    ctx.stroke();
  }
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = "#ffffff";
  for (let k = 0; k < 260; k++) ctx.fillRect(30 + rng() * (W - 60), 24 + rng() * 204, 2 + rng() * 3, 1.5);
  ctx.globalAlpha = 1;
  ctx.restore();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 5;
  ctx.stroke(board);
  // Two little nails.
  ctx.fillStyle = INK;
  for (const x of [52, W - 52]) {
    ctx.beginPath();
    ctx.arc(x, 46, 4.5, 0, Math.PI * 2);
    ctx.fill();
  }
  // Emoji badge + hand-lettered name.
  ctx.font = `64px ${EMOJI_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(r.emoji, 88, 128);
  const hand = cssFont("--font-hand", `"Caveat", "Comic Sans MS", "Chalkboard SE", cursive`);
  const lines = splitName(r.name);
  const font = (px: number) => `700 ${px}px ${hand}`;
  const px = fitText(ctx, lines, font, W - 175, 170, 92);
  ctx.font = font(px);
  const cx = 88 + (W - 30 - 88) / 2 + 22;
  const lh = px * 0.9;
  const y0 = 128 - ((lines.length - 1) * lh) / 2 + 4;
  lines.forEach((line, i) => {
    const y = y0 + i * lh;
    ctx.lineWidth = 7;
    ctx.strokeStyle = "#fffdf6";
    ctx.strokeText(line, cx, y);
    ctx.fillStyle = INK;
    ctx.fillText(line, cx, y);
  });
  ctx.restore();
}

const WOOD_CELL_W = 512;
const WOOD_CELL_H = 224;

/** Painted name for the wooden gallery sign: emoji + name on warm wood. */
function drawWoodPanel(ctx: CanvasRenderingContext2D, ox: number, oy: number, index: number) {
  const r = REGIONS[index];
  const rng = mulberry(0xd00d + index * 71);
  const W = WOOD_CELL_W, H = WOOD_CELL_H;
  ctx.save();
  ctx.translate(ox, oy);
  ctx.fillStyle = "#f3c98f";
  ctx.fillRect(0, 0, W, H);
  // Wood grain.
  ctx.strokeStyle = "rgba(150,95,50,0.28)";
  ctx.lineWidth = 3;
  for (let y = 10; y < H; y += 16 + rng() * 10) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= W; x += 32) ctx.lineTo(x, y + Math.sin(x * 0.02 + rng() * 2) * 4);
    ctx.stroke();
  }
  // Painted inner border.
  ctx.strokeStyle = REGION_COLOR[r.id] ?? "#ffd447";
  ctx.lineWidth = 10;
  ctx.strokeRect(14, 14, W - 28, H - 28);
  ctx.font = `66px ${EMOJI_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(r.emoji, 76, H / 2 + 2);
  const round = cssFont("--font-round", `"Fredoka", "Nunito", "Trebuchet MS", sans-serif`);
  const lines = splitName(r.name);
  const font = (px: number) => `700 ${px}px ${round}`;
  const px = fitText(ctx, lines, font, W - 170, H - 50, 70);
  ctx.font = font(px);
  const cx = 76 + (W - 76) / 2 + 4;
  const lh = px * 1.0;
  const y0 = H / 2 - ((lines.length - 1) * lh) / 2 + 3;
  lines.forEach((line, i) => {
    ctx.lineWidth = 9;
    ctx.strokeStyle = INK;
    ctx.strokeText(line, cx, y0 + i * lh);
    ctx.fillStyle = "#fffdf6";
    ctx.fillText(line, cx, y0 + i * lh);
  });
  ctx.restore();
}

function atlasTexture(cols: number, cellW: number, cellH: number, draw: (ctx: CanvasRenderingContext2D, ox: number, oy: number, i: number) => void, fontVar: string) {
  const rows = Math.ceil(REGIONS.length / cols);
  const canvas = document.createElement("canvas");
  canvas.width = cols * cellW;
  canvas.height = rows * cellH;
  const ctx = canvas.getContext("2d")!;
  const paint = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    REGIONS.forEach((_, i) => draw(ctx, (i % cols) * cellW, Math.floor(i / cols) * cellH, i));
  };
  paint();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  // Redraw once the lettering font has arrived (it may still be loading).
  const fam = cssFont(fontVar, "sans-serif");
  if (typeof document !== "undefined" && document.fonts?.load) {
    void document.fonts
      .load(`700 64px ${fam}`)
      .then(() => {
        paint();
        tex.needsUpdate = true;
      })
      .catch(() => {});
  }
  return { tex, cols, rows, cellW, cellH, width: canvas.width, height: canvas.height };
}

// ------------------------------------------------------------------ paper signs

function PaperSigns({ runtime, spots }: { runtime: WorldRuntime; spots: SignSpot[] }) {
  const built = useMemo(() => {
    const atlas = atlasTexture(PAPER_COLS, PAPER_CELL_W, PAPER_CELL_H, drawPaperSign, "--font-hand");
    const height = SIGN_HEIGHT + 0.12;
    const width = height * (PAPER_CELL_W / PAPER_CELL_H);
    const frame = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const t = new THREE.Vector3();
    const cards: THREE.BufferGeometry[] = [];
    spots.forEach((s, i) => {
      const col = s.region % atlas.cols;
      const row = Math.floor(s.region / atlas.cols);
      const u0 = (col * atlas.cellW) / atlas.width, u1 = ((col + 1) * atlas.cellW) / atlas.width;
      const v0 = 1 - ((row + 1) * atlas.cellH) / atlas.height, v1 = 1 - (row * atlas.cellH) / atlas.height;
      p.copy(s.n).multiplyScalar(runtime.terrain.heightAt(s.n) - 0.1);
      // frameMatrix puts local +z along -t: pass -facing so the front faces outward.
      t.copy(s.facing).negate();
      frameMatrix(s.n, t, p, frame);
      // A slight lean, like a sign pushed into soft ground.
      const lean = new THREE.Matrix4().makeRotationZ(((i % 3) - 1) * 0.05);
      // Front and back faces (the back is turned round so the lettering reads correctly from behind too).
      for (const side of [1, -1]) {
        const g = new THREE.PlaneGeometry(width, height);
        const uv = g.getAttribute("uv") as THREE.BufferAttribute;
        for (let k = 0; k < uv.count; k++) uv.setXY(k, u0 + uv.getX(k) * (u1 - u0), v0 + uv.getY(k) * (v1 - v0));
        g.translate(0, height / 2, 0.004);
        if (side < 0) g.rotateY(Math.PI);
        g.applyMatrix4(lean);
        g.applyMatrix4(frame);
        cards.push(g);
      }
    });
    const geometry = cards.length ? mergeGeometries(cards) : new THREE.BufferGeometry();
    cards.forEach((g) => g.dispose());
    // Unlit paper like the other cut-outs (still tinted by the day/night patch).
    const material = applyOcclusionDither(new THREE.MeshBasicMaterial({ map: atlas.tex, alphaTest: 0.5, side: THREE.FrontSide }));
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: atlas.tex, alphaTest: 0.5 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.customDepthMaterial = depth;
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    mesh.name = "region-signs";
    return { mesh, material, depth, tex: atlas.tex };
  }, [runtime, spots]);

  useEffect(
    () => () => {
      built.mesh.geometry.dispose();
      built.material.dispose();
      built.depth.dispose();
      built.tex.dispose();
    },
    [built],
  );

  return <primitive object={built.mesh} />;
}

// ------------------------------------------------------------------ wooden signs

const BOARD: Part = { prim: "box", color: "#e8b06e", p: [0, 1.22, 0], s: [1.5, 0.66, 0.1] };
const POST: Part = { prim: "box", color: "#a8703f", p: [0, 0.62, -0.08], s: [0.14, 1.24, 0.12] };
const CAP: Part = { prim: "box", color: "#c98d55", p: [0, 1.6, 0], s: [1.62, 0.07, 0.16] };
const WOOD_PARTS = [BOARD, POST, CAP];

function WoodenSigns({ runtime, spots }: { runtime: WorldRuntime; spots: SignSpot[] }) {
  const built = useMemo(() => {
    const batches = createShapeBatches({ box: spots.length * WOOD_PARTS.length });
    const frame = new THREE.Matrix4();
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const t = new THREE.Vector3();
    const color = new THREE.Color();
    const atlas = atlasTexture(3, WOOD_CELL_W, WOOD_CELL_H, drawWoodPanel, "--font-round");
    const faces: THREE.BufferGeometry[] = [];
    const scale = SIGN_HEIGHT / 1.64;
    spots.forEach((s) => {
      p.copy(s.n).multiplyScalar(runtime.terrain.heightAt(s.n) - 0.05);
      // frameMatrix puts local +z along -t: pass -facing so the front faces outward.
      t.copy(s.facing).negate();
      frameMatrix(s.n, t, p, frame);
      for (const part of WOOD_PARTS) {
        partMatrix(frame, part, scale, m);
        batches.box.push(m, color.set(part.color));
      }
      // Painted panels on both faces of the board.
      const col = s.region % atlas.cols;
      const row = Math.floor(s.region / atlas.cols);
      const u0 = (col * atlas.cellW) / atlas.width, u1 = ((col + 1) * atlas.cellW) / atlas.width;
      const v0 = 1 - ((row + 1) * atlas.cellH) / atlas.height, v1 = 1 - (row * atlas.cellH) / atlas.height;
      for (const side of [1, -1]) {
        const g = new THREE.PlaneGeometry(1.4 * scale, 0.58 * scale);
        const uv = g.getAttribute("uv") as THREE.BufferAttribute;
        for (let k = 0; k < uv.count; k++) uv.setXY(k, u0 + uv.getX(k) * (u1 - u0), v0 + uv.getY(k) * (v1 - v0));
        if (side < 0) g.rotateY(Math.PI);
        g.translate(0, BOARD.p[1] * scale, side * (BOARD.s[2] / 2 + 0.006) * scale);
        g.applyMatrix4(frame);
        faces.push(g);
      }
    });
    Object.values(batches).forEach((b) => b.commit());
    batches.box.mesh.castShadow = true;
    const merged = faces.length ? mergeGeometries(faces) : new THREE.BufferGeometry();
    faces.forEach((g) => g.dispose());
    const faceMat = applyOcclusionDither(new THREE.MeshToonMaterial({ map: atlas.tex, gradientMap: getToonGradient() }));
    const faceMesh = new THREE.Mesh(merged, faceMat);
    faceMesh.frustumCulled = false;
    faceMesh.name = "region-sign-faces";
    return { batches, faceMesh, faceMat, tex: atlas.tex };
  }, [runtime, spots]);

  useEffect(
    () => () => {
      Object.values(built.batches).forEach((b) => b.dispose());
      built.faceMesh.geometry.dispose();
      built.faceMat.dispose();
      built.tex.dispose();
    },
    [built],
  );

  return (
    <>
      <primitive object={built.batches.box.mesh} />
      <primitive object={built.batches.box.outline} />
      <primitive object={built.faceMesh} />
    </>
  );
}

// ------------------------------------------------------------------ mount

/** Mount inside the world <Canvas>: `<RegionSigns runtime={runtime} mode={mode} />`. */
export function RegionSigns({ runtime, mode }: { runtime: WorldRuntime; mode: WorldMode }) {
  const spots = useMemo(() => pickSignSpots(runtime.terrain, runtime.layout.items), [runtime]);

  // Signs are solid: the player and new buildings walk around them.
  useEffect(() => {
    const ids: string[] = [];
    for (const s of spots) {
      // Don't trap a player who happens to be standing right there.
      if (angleBetween(s.n, runtime.player.n) * PLANET_RADIUS < SIGN_OBSTACLE_RADIUS + 0.5) continue;
      const id = `sign-${REGIONS[s.region].id}`;
      runtime.grid.add({ id, n: s.n.clone(), radius: SIGN_OBSTACLE_RADIUS });
      ids.push(id);
    }
    return () => ids.forEach((id) => runtime.grid.remove(id));
  }, [runtime, spots]);

  if (spots.length === 0) return null;
  return mode === "paper" ? <PaperSigns runtime={runtime} spots={spots} /> : <WoodenSigns runtime={runtime} spots={spots} />;
}

export default RegionSigns;
