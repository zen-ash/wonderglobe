// Spherical-surface math. Every entity on the planet is described by a unit
// surface normal `n` and a unit tangent heading `t` (t ⟂ n). Movement rotates
// both together along a great circle, so there are no latitude/longitude
// singularities and nothing flips near the poles.

import { Vector3, Matrix4, Quaternion } from "three";
import type { Vec3 } from "@/core/types";

export const PLANET_RADIUS = 20;

const _a = new Vector3();
const _b = new Vector3();

export function v3(v: Vec3): Vector3 {
  return new Vector3(v[0], v[1], v[2]);
}

export function toVec3(v: Vector3): Vec3 {
  return [round6(v.x), round6(v.y), round6(v.z)];
}

function round6(x: number): number {
  return Math.round(x * 1e6) / 1e6;
}

/** Re-orthonormalise a frame in place: n unit, t unit and perpendicular to n. */
export function orthonormalize(n: Vector3, t: Vector3): void {
  n.normalize();
  t.addScaledVector(n, -t.dot(n));
  if (t.lengthSq() < 1e-10) anyTangent(n, t);
  t.normalize();
}

/** Writes some tangent perpendicular to n into out. */
export function anyTangent(n: Vector3, out: Vector3): Vector3 {
  // Pick the world axis least aligned with n for a stable cross product.
  const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
  if (ax <= ay && ax <= az) _a.set(1, 0, 0);
  else if (ay <= az) _a.set(0, 1, 0);
  else _a.set(0, 0, 1);
  return out.crossVectors(n, _a).normalize();
}

/**
 * Move along the great circle defined by (n, t) by `dist` world units.
 * Updates n and t in place (t is parallel transported).
 */
export function moveAlong(n: Vector3, t: Vector3, dist: number, radius = PLANET_RADIUS): void {
  const a = dist / radius;
  if (a === 0) return;
  const c = Math.cos(a), s = Math.sin(a);
  _a.copy(n);
  n.multiplyScalar(c).addScaledVector(t, s);
  t.multiplyScalar(c).addScaledVector(_a, -s);
  orthonormalize(n, t);
}

/** Rotate the heading t around n by `angle` radians (positive = left turn seen from above). */
export function turn(n: Vector3, t: Vector3, angle: number): void {
  if (angle === 0) return;
  _b.crossVectors(n, t); // left vector
  const c = Math.cos(angle), s = Math.sin(angle);
  t.multiplyScalar(c).addScaledVector(_b, s);
  orthonormalize(n, t);
}

/** Unit tangent at n pointing along the shortest path toward target. */
export function tangentToward(n: Vector3, target: Vector3, out: Vector3): Vector3 {
  out.copy(target).addScaledVector(n, -target.dot(n));
  if (out.lengthSq() < 1e-10) return anyTangent(n, out);
  return out.normalize();
}

/** Signed angle (radians) to turn heading t toward the direction `want` around n. */
export function signedAngle(n: Vector3, t: Vector3, want: Vector3): number {
  _b.crossVectors(n, t);
  return Math.atan2(want.dot(_b), want.dot(t));
}

/** Great-circle angle between two unit vectors. */
export function angleBetween(a: Vector3, b: Vector3): number {
  return Math.acos(Math.min(1, Math.max(-1, a.dot(b))));
}

/** Great-circle distance in world units between two unit vectors. */
export function surfaceDistance(a: Vector3, b: Vector3, radius = PLANET_RADIUS): number {
  return angleBetween(a, b) * radius;
}

/** Parallel-transport tangent `v` from frame at `from` to frame at `to` (minimal rotation). */
export function transportTangent(from: Vector3, to: Vector3, v: Vector3): void {
  const q = new Quaternion().setFromUnitVectors(from, to);
  v.applyQuaternion(q);
  orthonormalize(_a.copy(to), v);
}

/** Build a local→world matrix: +Y = up (n), -Z = forward (t), origin at `pos`. */
export function frameMatrix(n: Vector3, t: Vector3, pos: Vector3, out: Matrix4, scale = 1): Matrix4 {
  const right = _a.crossVectors(t, n).normalize(); // x
  const back = _b.copy(t).negate(); // z
  out.makeBasis(right, n, back);
  if (scale !== 1) out.scale(new Vector3(scale, scale, scale));
  out.setPosition(pos);
  return out;
}

/** Random unit vector inside a spherical cap around `center` (angle radius), using rng in [0,1). */
export function randomInCap(center: Vector3, maxAngle: number, rng: () => number, out: Vector3, minAngle = 0): Vector3 {
  const t = new Vector3();
  anyTangent(center, t);
  const b = new Vector3().crossVectors(center, t);
  // Uniform over area: angle ~ acos(1 - u(1-cos max))
  const cosMin = Math.cos(minAngle), cosMax = Math.cos(maxAngle);
  const cosA = cosMin - rng() * (cosMin - cosMax);
  const ang = Math.acos(cosA);
  const phi = rng() * Math.PI * 2;
  const dir = t.multiplyScalar(Math.cos(phi)).addScaledVector(b, Math.sin(phi));
  out.copy(center).multiplyScalar(Math.cos(ang)).addScaledVector(dir, Math.sin(ang));
  return out.normalize();
}

/** Point at angular offset `ang` from center in tangent direction at bearing `phi`. */
export function pointAt(center: Vector3, ang: number, phi: number, out: Vector3): Vector3 {
  const t = new Vector3();
  anyTangent(center, t);
  const b = new Vector3().crossVectors(center, t);
  const dir = t.multiplyScalar(Math.cos(phi)).addScaledVector(b, Math.sin(phi));
  return out.copy(center).multiplyScalar(Math.cos(ang)).addScaledVector(dir, Math.sin(ang)).normalize();
}
