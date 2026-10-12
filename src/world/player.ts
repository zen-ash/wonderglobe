// The player's walker: keyboard / joystick / click-to-walk on the sphere with
// collision sliding. The camera's forward direction is carried along with the
// player so "forward" keeps meaning "away from the camera" everywhere.

import { Vector3, Quaternion } from "three";
import { ObstacleGrid } from "./collision";
import { Terrain } from "./planet";
import { moveAlong, turn, tangentToward, signedAngle, angleBetween, orthonormalize, PLANET_RADIUS } from "./sphere";
import { clamp } from "./noise";

export interface PlayerInput {
  /** -1..1 right/left and forward/back relative to the camera. */
  x: number;
  y: number;
}

export interface PlayerState {
  n: Vector3;
  /** Body heading. */
  t: Vector3;
  /** Camera forward tangent (parallel transported with the player). */
  camForward: Vector3;
  target: Vector3 | null;
  speed: number;
  moving: number;
  phase: number;
  stuck: number;
  pos: Vector3;
  /** -1 or 1: which way the paper cut-out faces on screen. */
  screenFacing: number;
}

export const PLAYER_RADIUS = 0.35;
const WALK_SPEED = 4.2;

export function createPlayer(n: Vector3, t: Vector3): PlayerState {
  const nn = n.clone().normalize();
  const tt = t.clone();
  orthonormalize(nn, tt);
  return {
    n: nn,
    t: tt,
    camForward: tt.clone(),
    target: null,
    speed: WALK_SPEED,
    moving: 0,
    phase: 0,
    stuck: 0,
    pos: new Vector3(),
    screenFacing: 1,
  };
}

const _want = new Vector3();
const _right = new Vector3();
const _cand = new Vector3();
const _candT = new Vector3();
const _q = new Quaternion();
const _old = new Vector3();

export function walkable(terrain: Terrain, grid: ObstacleGrid, n: Vector3): boolean {
  // Over water only along a drawn bridge's corridor.
  if (terrain.waterAt(n, -0.008) >= 0 && !grid.onBridge(n)) return false;
  if (terrain.isBlockedTerrain(n)) return false;
  return !grid.hit(n, PLAYER_RADIUS);
}

export function stepPlayer(p: PlayerState, input: PlayerInput, terrain: Terrain, grid: ObstacleGrid, dt: number): void {
  let mag = Math.min(1, Math.hypot(input.x, input.y));
  _want.set(0, 0, 0);
  if (mag > 0.08) {
    p.target = null;
    _right.crossVectors(p.camForward, p.n).normalize();
    _want.copy(p.camForward).multiplyScalar(input.y).addScaledVector(_right, input.x).normalize();
  } else if (p.target) {
    const dist = angleBetween(p.n, p.target) * PLANET_RADIUS;
    if (dist < 0.35) {
      p.target = null;
      mag = 0;
    } else {
      tangentToward(p.n, p.target, _want);
      mag = clamp(dist / 1.2, 0.35, 1);
    }
  } else {
    mag = 0;
  }

  if (mag > 0) {
    // Turn the body toward the desired direction, quickly.
    const ang = signedAngle(p.n, p.t, _want);
    turn(p.n, p.t, clamp(ang, -10 * dt, 10 * dt));
    const dist = p.speed * mag * dt;
    _old.copy(p.n);
    let moved = false;
    // Try straight, then slide along obstacles at increasing angles.
    for (const off of [0, 0.5, -0.5, 1.0, -1.0, 1.4, -1.4]) {
      _cand.copy(p.n);
      _candT.copy(_want);
      if (off !== 0) turn(_cand, _candT, off);
      moveAlong(_cand, _candT, dist * (off === 0 ? 1 : Math.cos(off) * 0.9 + 0.1));
      if (walkable(terrain, grid, _cand)) {
        p.n.copy(_cand);
        moved = true;
        break;
      }
    }
    if (moved) {
      // Carry the heading and camera frame along with the move.
      _q.setFromUnitVectors(_old, p.n);
      p.t.applyQuaternion(_q);
      p.camForward.applyQuaternion(_q);
      orthonormalize(p.n, p.t);
      orthonormalize(p.n.clone(), p.camForward);
      p.camForward.addScaledVector(p.n, -p.camForward.dot(p.n)).normalize();
      p.stuck = 0;
      p.phase += dt * 9 * mag;
    } else {
      p.stuck += dt;
      if (p.stuck > 0.8) p.target = null;
    }
    p.moving += ((moved ? 1 : 0) - p.moving) * Math.min(1, dt * 10);
  } else {
    p.moving += (0 - p.moving) * Math.min(1, dt * 8);
  }
  const h = Math.max(terrain.heightAt(p.n), grid.deckAt(p.n));
  const hop = Math.abs(Math.sin(p.phase)) * 0.18 * p.moving;
  p.pos.copy(p.n).multiplyScalar(h + hop);
}

/** Rotate the camera forward around the player's up (yaw drag). */
export function yawCamera(p: PlayerState, angle: number): void {
  turn(p.n, p.camForward, angle);
}

/** Teleport (used for "travel to" with a paper hop). */
export function placePlayer(p: PlayerState, n: Vector3, faceToward?: Vector3): void {
  const q = new Quaternion().setFromUnitVectors(p.n, n.clone().normalize());
  p.n.copy(n).normalize();
  p.t.applyQuaternion(q);
  p.camForward.applyQuaternion(q);
  orthonormalize(p.n, p.t);
  p.camForward.addScaledVector(p.n, -p.camForward.dot(p.n)).normalize();
  if (faceToward) {
    tangentToward(p.n, faceToward, p.camForward);
    p.t.copy(p.camForward);
  }
  p.target = null;
}

