// Little local rain showers (a child taps a cloud → it rains under it for a
// few seconds). Shared registry read by the weather particles, the clouds
// (which darken while raining) and the water ripples.

import * as THREE from "three";

export interface Shower {
  /** Unit direction from the planet centre to the shower. */
  dir: THREE.Vector3;
  /** Radius (distance from the planet centre) the rain starts at. */
  top: number;
  /** performance.now() / 1000 when it started. */
  start: number;
  duration: number;
}

export const MAX_SHOWERS = 4;
export const showers: Shower[] = [];

export function nowSeconds(): number {
  return (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000;
}

/** Start a short local shower under `point` (e.g. a tapped cloud). Lasts ~5 s. */
export function startShower(point: THREE.Vector3, duration = 5): Shower {
  const s: Shower = { dir: point.clone().normalize(), top: Math.max(point.length(), 26), start: nowSeconds(), duration };
  showers.push(s);
  while (showers.length > MAX_SHOWERS) showers.shift();
  return s;
}

/** 0..1 strength of a shower right now (fades in and out), 0 when over. */
export function showerStrength(s: Shower, now = nowSeconds()): number {
  const age = now - s.start;
  if (age < 0 || age > s.duration) return 0;
  return Math.min(1, age / 0.6, (s.duration - age) / 1.2);
}

/** Drop finished showers. */
export function pruneShowers(now = nowSeconds()): void {
  for (let i = showers.length - 1; i >= 0; i--) if (now - showers[i].start > showers[i].duration + 0.5) showers.splice(i, 1);
}
