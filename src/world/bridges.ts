// Drawn bridges: where to put one (across the nearest narrow water), how long
// it is, and the walkable corridor it adds. A bridge record only stores its
// centre and heading, so the span is always recomputed from the terrain the
// same way (spawn, restore and drop agree).

import { Vector3 } from "three";
import { Terrain, WATER_BODIES, WATER_LEVEL } from "./planet";
import { ObstacleGrid, type BridgeSpan } from "./collision";
import { moveAlong, turn, tangentToward, angleBetween, orthonormalize, anyTangent, PLANET_RADIUS } from "./sphere";

/** Walkable corridor width (world units). */
export const BRIDGE_WIDTH = 1.4;
/** Furthest a bridge reaches from its centre to either end (world units). */
export const BRIDGE_MAX_HALF = 5.2;
const MIN_HALF = 1.6;
/** How far the ends rest on dry land past the shoreline. */
const LANDING = 0.8;
const STEP = 0.2;

const _n = new Vector3();
const _t = new Vector3();

const isWet = (terrain: Terrain, n: Vector3) => terrain.waterAt(n, 0) >= 0;

/** Distance (world units) from n along t to the first dry point, or -1 if none within `max`. */
function distToLand(terrain: Terrain, n: Vector3, t: Vector3, max: number): number {
  _n.copy(n);
  _t.copy(t);
  for (let d = 0; d <= max; d += STEP) {
    if (d > 0) moveAlong(_n, _t, STEP);
    if (!isWet(terrain, _n)) return d;
  }
  return -1;
}

/** The corridor of a bridge centred at `center`, running along `t`. */
export function computeBridgeSpan(terrain: Terrain, id: string, center: Vector3, t: Vector3): BridgeSpan {
  const c = center.clone().normalize();
  const tt = t.clone();
  orthonormalize(c, tt);
  const back = tt.clone().negate();
  let half: number;
  if (!isWet(terrain, c)) {
    half = MIN_HALF; // a little footbridge on dry land
  } else {
    const plus = distToLand(terrain, c, tt, BRIDGE_MAX_HALF);
    const minus = distToLand(terrain, c, back, BRIDGE_MAX_HALF);
    if (plus >= 0 && minus >= 0) half = Math.max(plus, minus) + LANDING;
    else if (plus >= 0 || minus >= 0) half = Math.max(plus, minus) + LANDING; // a pier: symmetric about its centre
    else half = 2.5;
  }
  half = Math.min(BRIDGE_MAX_HALF, Math.max(MIN_HALF, half));
  const endAn = c.clone(), endAt = back.clone();
  moveAlong(endAn, endAt, half);
  const endBn = c.clone(), endBt = tt.clone();
  moveAlong(endBn, endBt, half);
  const deckEnd = (n: Vector3) => Math.max(terrain.heightAt(n), WATER_LEVEL + 0.22);
  return {
    id,
    center: c,
    t: tt,
    axis: new Vector3().crossVectors(c, tt).normalize(),
    halfAngle: half / PLANET_RADIUS,
    halfWidth: BRIDGE_WIDTH / 2,
    endA: deckEnd(endAn),
    endB: deckEnd(endBn),
    arch: 0.22 + 0.05 * half,
  };
}

/** Both end points of a span (unit vectors), -t end first. */
export function bridgeEnds(b: BridgeSpan): [Vector3, Vector3] {
  const a = b.center.clone(), at = b.t.clone().negate();
  moveAlong(a, at, b.halfAngle * PLANET_RADIUS);
  const e = b.center.clone(), et = b.t.clone();
  moveAlong(e, et, b.halfAngle * PLANET_RADIUS);
  return [a, e];
}

export interface BridgeSpot {
  center: Vector3;
  t: Vector3;
  /** Whether it reaches dry land on both sides. */
  crossing: boolean;
}

/**
 * Best place for a new bridge near `from` (usually the player): across the
 * nearest narrow water if the far shore is within ~8 units, else a pier from
 * the nearest shoreline into the water.
 */
export function findBridgeSpot(terrain: Terrain, grid: ObstacleGrid, from: Vector3): BridgeSpot {
  const origin = from.clone().normalize();
  // Distance to the nearest shoreline decides how far to look.
  let nearestShore = Infinity;
  for (const w of WATER_BODIES) nearestShore = Math.min(nearestShore, (angleBetween(origin, w.center) - w.radius * 1.16) * PLANET_RADIUS);
  const reach = Math.max(9, nearestShore + 3);
  const steps = Math.ceil(reach / 0.25);
  let best: { score: number; spot: BridgeSpot } | null = null;
  const bearings = 32;
  const t0 = anyTangent(origin, new Vector3());
  const n = new Vector3(), t = new Vector3();
  for (let i = 0; i < bearings; i++) {
    n.copy(origin);
    t.copy(t0);
    turn(n, t, (i / bearings) * Math.PI * 2);
    // March out until we enter the water.
    let entry = -1;
    let d = 0;
    for (let k = 0; k <= steps; k++) {
      if (k > 0) {
        moveAlong(n, t, 0.25);
        d += 0.25;
      }
      if (isWet(terrain, n)) {
        entry = d;
        break;
      }
    }
    if (entry < 0) continue;
    const entryN = n.clone(), entryT = t.clone();
    // Then until we reach the far shore (or give up: a pier).
    let exit = -1;
    for (let k = 1; k <= Math.ceil(8.5 / 0.25); k++) {
      moveAlong(n, t, 0.25);
      if (!isWet(terrain, n)) {
        exit = k * 0.25;
        break;
      }
    }
    const center = entryN.clone(), ct = entryT.clone();
    let score: number;
    let crossing: boolean;
    if (exit > 0) {
      moveAlong(center, ct, exit / 2);
      score = entry + exit * 0.6;
      crossing = true;
    } else {
      moveAlong(center, ct, 2.2);
      score = entry + 8;
      crossing = false;
    }
    if (terrain.isBlockedTerrain(center)) continue;
    // Prefer ends that don't run into a tree or a house.
    const span = computeBridgeSpan(terrain, "probe", center, ct);
    for (const end of bridgeEnds(span)) if (grid.hit(end, 0.4)) score += 4;
    if (!best || score < best.score) best = { score, spot: { center, t: ct, crossing } };
  }
  if (best) return best.spot;
  // No water anywhere near: a pier from the nearest pond's shore toward its middle.
  let body = WATER_BODIES[0], bodyA = Infinity;
  for (const w of WATER_BODIES) {
    const a = angleBetween(origin, w.center) - w.radius;
    if (a < bodyA) {
      bodyA = a;
      body = w;
    }
  }
  const c = body.center.clone();
  const out = tangentToward(c, origin, new Vector3());
  const shore = distToLand(terrain, c, out, 20);
  moveAlong(c, out, Math.max(0, shore - 2.2));
  return { center: c, t: out.negate(), crossing: false };
}

/** Pick a heading at `center` that crosses the water most sensibly (shortest full crossing). */
export function orientBridge(terrain: Terrain, center: Vector3, hint: Vector3): Vector3 {
  const c = center.clone().normalize();
  const base = hint.clone();
  orthonormalize(c, base);
  if (!isWet(terrain, c)) return base;
  let best: Vector3 | null = null, bestScore = Infinity;
  const t = new Vector3();
  for (let i = 0; i < 12; i++) {
    t.copy(base);
    turn(c, t, (i / 12) * Math.PI); // a bridge is symmetric: half a turn covers every direction
    const plus = distToLand(terrain, c, t, BRIDGE_MAX_HALF);
    const minus = distToLand(terrain, c, t.clone().negate(), BRIDGE_MAX_HALF);
    let score: number;
    if (plus >= 0 && minus >= 0) score = Math.max(plus, minus);
    else if (plus >= 0 || minus >= 0) score = 20 + Math.max(plus, minus);
    else score = 100;
    score += i === 0 ? -0.3 : 0; // keep the hint when it's about as good
    if (score < bestScore) {
      bestScore = score;
      best = t.clone();
    }
  }
  return best ?? base;
}
