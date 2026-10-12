// Water ripples: expanding crayon rings on the water surface that fade out.
// A fixed-size pool; `addRipple` can be called from anywhere (taps on the
// water, splashing creatures, rain). Drawn by <Ripples/> (./Ripples.tsx).

import * as THREE from "three";
import type { Terrain } from "@/world/planet";
import { WATER_LEVEL } from "@/world/planet";
import { nowSeconds } from "./atmosphere/showers";

export const MAX_RIPPLES = 96;

export const rippleState = {
  /** Per ripple: x, y, z (on the water), start time, size, life (s), seed, unused. */
  data: new Float32Array(MAX_RIPPLES * 8),
  next: 0,
  /** Bumped on every change so the GPU buffer re-uploads only when needed. */
  version: 0,
  terrain: null as Terrain | null,
};

const _n = new THREE.Vector3();

/** Let ripple helpers know where the water is (set by <Ripples/>). */
export function setRippleTerrain(terrain: Terrain | null): void {
  rippleState.terrain = terrain;
}

/** True if `point` (any radius) is over water. Unknown terrain → true. */
export function isOverWater(point: THREE.Vector3): boolean {
  const t = rippleState.terrain;
  if (!t) return true;
  return t.isWater(_n.copy(point).normalize());
}

/**
 * Add an expanding crayon ring on the water at `point` (projected onto the
 * water surface). `size` ≈ final radius in world units (default 1).
 * Returns false if the point isn't over water.
 */
export function addRipple(point: THREE.Vector3, size = 1, opts: { life?: number; force?: boolean } = {}): boolean {
  if (!opts.force && !isOverWater(point)) return false;
  _n.copy(point).normalize().multiplyScalar(WATER_LEVEL + 0.02);
  const i = rippleState.next;
  rippleState.next = (i + 1) % MAX_RIPPLES;
  const d = rippleState.data;
  const o = i * 8;
  d[o] = _n.x;
  d[o + 1] = _n.y;
  d[o + 2] = _n.z;
  d[o + 3] = nowSeconds();
  d[o + 4] = Math.max(0.15, size);
  d[o + 5] = opts.life ?? 1.6 + size * 0.6;
  d[o + 6] = Math.random();
  d[o + 7] = 0;
  rippleState.version++;
  return true;
}
