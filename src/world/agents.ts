// Behaviour systems for everything that lives on the planet: creations,
// ambient animals and gallery visitors. Pure simulation – no rendering.

import { Vector3 } from "three";
import type { Behavior, Facing } from "@/core/types";
import { needsWater } from "@/core/kinds";
import { Terrain, WATER_BODIES, WATER_LEVEL } from "./planet";
import { ObstacleGrid } from "./collision";
import { moveAlong, turn, tangentToward, signedAngle, angleBetween, orthonormalize, PLANET_RADIUS } from "./sphere";
import { mulberry32, hashString, clamp } from "./noise";
import type { Mind } from "./social";

/**
 * idle/move/goto/react/seekWater: the original wandering behaviours.
 * seek: walk to `target` (social: follow, flee, gather, visit, play) and stop.
 * attend: stand still and face `target` (noticing the player).
 * sleep: stay still (night).
 * perch: a flyer gliding down onto `target` at `perchAlt`; rest: sitting there.
 * inside: hidden inside a drawn house.
 * ride: carrying the player (positioned by the ride controller).
 */
export type AgentState =
  | "idle"
  | "move"
  | "goto"
  | "react"
  | "carried"
  | "seekWater"
  | "seek"
  | "attend"
  | "sleep"
  | "perch"
  | "rest"
  | "inside"
  | "ride";

/** Arrival timing (seconds): paper plane flight, unfold, then the landing / growing / folding. */
export function arrivalTiming(behavior: Behavior, reduced = false): { plane: number; unfold: number; settle: number; total: number } {
  const plane = reduced ? 0.6 : 1.4;
  const unfold = reduced ? 0.25 : 0.5;
  const settle = behavior === "build" ? (reduced ? 0.8 : 1.6) : behavior === "grow" ? (reduced ? 0.7 : 1.4) : reduced ? 0.6 : 1.0;
  return { plane, unfold, settle, total: plane + unfold + settle };
}

export interface Agent {
  id: string;
  behavior: Behavior;
  facing: Facing;
  /** Surface normal (unit) and heading (unit tangent). */
  n: Vector3;
  t: Vector3;
  speed: number;
  size: number;
  /** Footprint radius for collisions (world units). */
  radius: number;
  /** Current height above the ground / water surface. */
  altitude: number;
  targetAltitude: number;
  state: AgentState;
  timer: number;
  /** Smoothly varying turn rate (rad/s). */
  turnRate: number;
  /** Optional home area to wander within. */
  home: Vector3 | null;
  homeRadius: number;
  /** For gallery visitors: where to go, and what to do there. */
  target: Vector3 | null;
  /** Animation phases. */
  phase: number;
  moveAmount: number;
  bank: number;
  /** 0..1 entrance animation progress (1 = settled). */
  spawn: number;
  /** World position (computed each step). */
  pos: Vector3;
  rng: () => number;
  /** Whether it blocks the player (houses, trees). */
  solid: boolean;
  /** Reaction emote shown above the head ("heart", "wow", "note"). */
  emote: string | null;
  emoteTimer: number;
  /** Vertical speed while falling after being dropped (grounded things only). */
  fallSpeed: number;
  falling: boolean;
  /** Kind id for creations ("" for ambient life and visitors). */
  kind: string;
  /** Social brain (creations only). */
  mind: Mind | null;
  /** Seek: speed multiplier, stop distance (world units), time spent blocked, arrival flag. */
  seekSpeed: number;
  seekStop: number;
  stuck: number;
  arrived: boolean;
  /** Counts seeks abandoned because the way was blocked. */
  giveUps: number;
  /** Swimmers/flyers: a point to drift toward (overrides the home pull while set). */
  steerTo: Vector3 | null;
  steerGain: number;
  /** Inside a house (not drawn). */
  hidden: boolean;
  /** Surprise / happy jump: progress 0..1 (1 = done), delay before it starts, height. */
  bounce: number;
  bounceDelay: number;
  bounceHeight: number;
  /** Height above the ground of a perch (tree top, roof). */
  perchAlt: number;
  /** 0..1 attention toward the player (plants lean, houses light their door). */
  attend: number;
  attendTarget: number;
  /** Seconds the whole arrival takes, and the spawn fraction until it touches down. */
  spawnDur: number;
  spawnHold: number;
}

export function createAgent(opts: {
  id: string;
  behavior: Behavior;
  facing?: Facing;
  n: Vector3;
  t?: Vector3;
  speed: number;
  size: number;
  home?: Vector3 | null;
  homeRadius?: number;
  spawn?: number;
  kind?: string;
  reducedMotion?: boolean;
}): Agent {
  const n = opts.n.clone().normalize();
  const t = opts.t ? opts.t.clone() : new Vector3(0, 1, 0);
  orthonormalize(n, t);
  const rng = mulberry32(hashString(opts.id));
  const airborne = opts.behavior === "fly" || opts.behavior === "flutter" || opts.behavior === "hover";
  const solid = opts.behavior === "build" || (opts.behavior === "grow" && opts.size > 2.2);
  const a: Agent = {
    id: opts.id,
    behavior: opts.behavior,
    facing: opts.facing ?? "none",
    n,
    t,
    speed: opts.speed,
    size: opts.size,
    radius: opts.behavior === "build" ? opts.size * 0.42 : solid ? 0.6 : Math.min(0.6, opts.size * 0.3),
    altitude: 0,
    targetAltitude: 0,
    state: "idle",
    timer: rng() * 2,
    turnRate: 0,
    home: opts.home ? opts.home.clone() : null,
    homeRadius: opts.homeRadius ?? 0,
    target: null,
    phase: rng() * Math.PI * 2,
    moveAmount: 0,
    bank: 0,
    spawn: opts.spawn ?? 1,
    pos: new Vector3(),
    rng,
    solid,
    emote: null,
    emoteTimer: 0,
    fallSpeed: 0,
    falling: false,
    kind: opts.kind ?? "",
    mind: null,
    seekSpeed: 1,
    seekStop: 0.8,
    stuck: 0,
    arrived: false,
    giveUps: 0,
    steerTo: null,
    steerGain: 1,
    hidden: false,
    bounce: 1,
    bounceDelay: 0,
    bounceHeight: 0,
    perchAlt: 0,
    attend: 0,
    attendTarget: 0,
    spawnDur: 1,
    spawnHold: 0,
  };
  const timing = arrivalTiming(opts.behavior, opts.reducedMotion);
  a.spawnDur = timing.total;
  a.spawnHold = (timing.plane + timing.unfold) / timing.total;
  if (airborne) {
    a.targetAltitude = cruiseAltitude(a);
    a.altitude = a.spawn < 1 ? a.targetAltitude + 3 : a.targetAltitude;
  }
  return a;
}

function cruiseAltitude(a: Agent): number {
  switch (a.behavior) {
    case "fly":
      return 4.5 + a.rng() * 3.5;
    case "flutter":
      return 0.9 + a.rng() * 1.2;
    case "hover":
      return 3 + a.rng() * 2.5;
    default:
      return 0;
  }
}

export interface SimContext {
  terrain: Terrain;
  grid: ObstacleGrid;
  time: number;
}

const _cand = new Vector3();
const _candT = new Vector3();
const _dir = new Vector3();

/** Can a land agent stand at n? */
export function landOk(ctx: SimContext, n: Vector3, radius: number, ignoreId?: string): boolean {
  if (ctx.terrain.waterAt(n, -0.01) >= 0 && !ctx.grid.onBridge(n, 0.1)) return false;
  if (ctx.terrain.isBlockedTerrain(n)) return false;
  return !ctx.grid.hit(n, radius, ignoreId);
}

/** Can a water agent be at n? (a little margin from the shore) */
export function waterOk(ctx: SimContext, n: Vector3, margin = 0.012): boolean {
  return ctx.terrain.waterAt(n, margin) >= 0;
}

/** Nearest water body to n: index and the closest in-water point direction. */
export function nearestWater(n: Vector3): { index: number; center: Vector3; angle: number } {
  let best = 0, bestA = Infinity;
  for (let i = 0; i < WATER_BODIES.length; i++) {
    const a = angleBetween(n, WATER_BODIES[i].center) - WATER_BODIES[i].radius;
    if (a < bestA) {
      bestA = a;
      best = i;
    }
  }
  return { index: best, center: WATER_BODIES[best].center, angle: bestA };
}

/** Try to step forward; returns true if moved. */
function tryStep(a: Agent, dist: number, ok: (n: Vector3) => boolean): boolean {
  _cand.copy(a.n);
  _candT.copy(a.t);
  moveAlong(_cand, _candT, dist);
  if (!ok(_cand)) return false;
  a.n.copy(_cand);
  a.t.copy(_candT);
  return true;
}

/** Step toward heading, sliding around obstacles at growing angles. Keeps the heading on success. */
function tryStepSlide(a: Agent, dist: number, ok: (n: Vector3) => boolean): boolean {
  for (const off of SLIDE) {
    _cand.copy(a.n);
    _candT.copy(a.t);
    if (off !== 0) turn(_cand, _candT, off);
    moveAlong(_cand, _candT, dist);
    if (!ok(_cand)) continue;
    if (off !== 0) turn(a.n, a.t, off * 0.35);
    // Re-align the heading at the new spot (parallel transport of the old one).
    _dir.copy(a.t);
    a.n.copy(_cand);
    a.t.copy(_dir).addScaledVector(a.n, -_dir.dot(a.n));
    orthonormalize(a.n, a.t);
    return true;
  }
  return false;
}
const SLIDE = [0, 0.5, -0.5, 1.0, -1.0, 1.5, -1.5];

function outsideHome(a: Agent, n: Vector3): boolean {
  return !!a.home && a.homeRadius > 0 && angleBetween(n, a.home) > a.homeRadius;
}

/** Inside home, or (when already outside) at least not moving further away. */
function homeOk(a: Agent, n: Vector3): boolean {
  if (!outsideHome(a, n)) return true;
  return outsideHome(a, a.n) && angleBetween(n, a.home!) <= angleBetween(a.n, a.home!);
}

/** Start a little jump (surprise, wave, pat). */
export function startBounce(a: Agent, delay: number, height: number): void {
  a.bounce = 0;
  a.bounceDelay = Math.max(0, delay);
  a.bounceHeight = height;
}

function bounceOffset(a: Agent): number {
  if (a.bounce >= 1 || a.bounceDelay > 0) return 0;
  return Math.sin(a.bounce * Math.PI) * a.bounceHeight;
}

/** Whether a land/air creature is mid-arrival (the paper plane hasn't touched down yet). */
export function arriving(a: Agent): boolean {
  return a.spawn < a.spawnHold;
}

export function stepAgent(a: Agent, ctx: SimContext, dt: number): void {
  if (a.spawn < 1) a.spawn = Math.min(1, a.spawn + dt / Math.max(0.1, a.spawnDur));
  if (a.emoteTimer > 0) {
    a.emoteTimer -= dt;
    if (a.emoteTimer <= 0) a.emote = null;
  }
  a.phase += dt;
  if (a.bounce < 1) {
    if (a.bounceDelay > 0) a.bounceDelay -= dt;
    else a.bounce = Math.min(1, a.bounce + dt / 0.55);
  }
  a.attend += (a.attendTarget - a.attend) * Math.min(1, dt * 3);
  if (a.state === "ride") {
    // Position comes from the ride controller.
    a.moveAmount += (1 - a.moveAmount) * Math.min(1, dt * 6);
    return;
  }
  let moved = 0;

  if (a.state === "carried") {
    a.moveAmount = 0;
  } else if (arriving(a) || a.state === "inside") {
    // Still flying in as a paper plane, or tucked inside a house.
    a.moveAmount = 0;
  } else if (a.state === "sleep") {
    moved = stepSleeper(a, ctx, dt);
  } else if (a.falling) {
    // A little drop with a bounce after being put down.
    a.fallSpeed -= 22 * dt;
    a.altitude += a.fallSpeed * dt;
    if (a.altitude <= 0) {
      a.altitude = 0;
      a.fallSpeed = -a.fallSpeed * 0.35;
      if (a.fallSpeed < 1.2) {
        a.falling = false;
        a.fallSpeed = 0;
      }
    }
  } else {
    switch (a.behavior) {
      case "walk":
      case "hop":
      case "drive":
        moved = stepWalker(a, ctx, dt);
        break;
      case "fly":
        moved = a.state === "perch" || a.state === "rest" ? stepPercher(a, ctx, dt) : stepFlyer(a, ctx, dt);
        break;
      case "flutter":
        moved = stepFlutter(a, dt);
        break;
      case "hover":
        moved = stepHover(a, dt);
        break;
      case "swim":
      case "float":
        moved = stepSwimmer(a, ctx, dt);
        break;
      default:
        a.moveAmount = 0;
    }
  }
  a.moveAmount += ((moved > 0 ? 1 : 0) - a.moveAmount) * Math.min(1, dt * 6);
  updatePosition(a, ctx);
}

/** Start a short fall from the current altitude (grounded behaviours only). */
export function startFall(a: Agent, height: number): void {
  if (a.behavior === "fly" || a.behavior === "flutter" || a.behavior === "hover") return;
  a.altitude = height;
  a.fallSpeed = 0;
  a.falling = true;
}

export function updatePosition(a: Agent, ctx: SimContext): void {
  let h = ctx.terrain.heightAt(a.n);
  let r: number;
  if (a.behavior === "swim") {
    r = Math.max(h + 0.25, WATER_LEVEL - 0.05) + a.altitude;
    if (ctx.terrain.waterAt(a.n) < 0) r = h + a.altitude; // flopping toward water on land
  } else if (a.behavior === "float") {
    r = (ctx.terrain.waterAt(a.n) >= 0 ? WATER_LEVEL - 0.05 : h) + a.altitude;
  } else {
    // Walking over a bridge deck (or a bridge standing over the water).
    const deck = ctx.grid.deckAt(a.n);
    if (deck > h) h = deck;
    r = h + a.altitude;
  }
  a.pos.copy(a.n).multiplyScalar(r + bounceOffset(a));
}

function stepWalker(a: Agent, ctx: SimContext, dt: number): number {
  a.timer -= dt;
  const isVehicle = a.behavior === "drive";
  const ok = (n: Vector3) => landOk(ctx, n, a.radius * 0.6, a.id) && homeOk(a, n);

  if (a.state === "seek" && a.target) {
    tangentToward(a.n, a.target, _dir);
    const ang = signedAngle(a.n, a.t, _dir);
    turn(a.n, a.t, clamp(ang, -4 * dt, 4 * dt));
    const dist = angleBetween(a.n, a.target) * PLANET_RADIUS;
    if (dist < a.seekStop) {
      a.state = "idle";
      a.arrived = true;
      a.altitude = 0;
      a.timer = 0.6 + a.rng() * 0.8;
      return 0;
    }
    let speed = a.speed * a.seekSpeed * Math.min(1, 0.35 + dist / 1.5);
    if (a.behavior === "hop") {
      const hop = Math.sin(a.phase * 7);
      a.altitude = Math.max(0, hop) * 0.4 * Math.min(1, a.size);
      speed *= hop > 0 ? 1.5 : 0.2;
    } else a.altitude *= 0.8;
    // Only turn toward the goal when facing roughly the right way, then step.
    if (Math.abs(ang) > 1.6) return 0;
    if (!tryStepSlide(a, speed * dt, (n) => landOk(ctx, n, a.radius * 0.6, a.id))) {
      a.stuck += dt;
      if (a.stuck > 1.4) {
        // Give up rather than jitter against something.
        a.state = "idle";
        a.arrived = false;
        a.target = null;
        a.stuck = 0;
        a.giveUps++;
        a.timer = 0.5 + a.rng();
        turn(a.n, a.t, (a.rng() < 0.5 ? -1 : 1) * (1 + a.rng()));
      }
      return 0;
    }
    a.stuck = Math.max(0, a.stuck - dt * 0.5);
    return 1;
  }
  if (a.state === "attend") {
    if (a.target) {
      tangentToward(a.n, a.target, _dir);
      turn(a.n, a.t, clamp(signedAngle(a.n, a.t, _dir), -5 * dt, 5 * dt));
    }
    a.altitude *= 0.8;
    if (a.timer <= 0) {
      a.state = "idle";
      a.timer = 0.5 + a.rng();
    }
    return 0;
  }

  if (a.state === "goto" && a.target) {
    tangentToward(a.n, a.target, _dir);
    const ang = signedAngle(a.n, a.t, _dir);
    turn(a.n, a.t, clamp(ang, -3 * dt, 3 * dt));
    const dist = angleBetween(a.n, a.target) * PLANET_RADIUS;
    if (dist < 1.6 + a.radius) {
      a.state = "react";
      a.timer = 2.6;
      a.target = null;
      return 0;
    }
    if (!tryStep(a, a.speed * 1.3 * dt, (n) => landOk(ctx, n, a.radius * 0.6, a.id))) {
      turn(a.n, a.t, (a.rng() - 0.5) * 2);
      a.timer = 0.3;
      if (a.rng() < 0.02) {
        a.state = "react";
        a.timer = 2;
      }
      return 0;
    }
    return 1;
  }
  if (a.state === "react") {
    if (a.timer <= 0) {
      a.state = "idle";
      a.timer = 1 + a.rng() * 2;
    }
    a.altitude = Math.abs(Math.sin(a.phase * 9)) * 0.35 * Math.min(1, a.timer);
    return 0;
  }

  if (a.state === "idle") {
    a.altitude *= 0.8;
    if (a.timer <= 0) {
      a.state = "move";
      a.timer = isVehicle ? 4 + a.rng() * 6 : 2 + a.rng() * 4;
      a.turnRate = (a.rng() - 0.5) * (isVehicle ? 0.6 : 1.2);
    }
    return 0;
  }

  // Moving: gentle meander.
  a.turnRate += (a.rng() - 0.5) * dt * (isVehicle ? 0.8 : 2);
  a.turnRate = clamp(a.turnRate, -1.2, 1.2);
  turn(a.n, a.t, a.turnRate * dt);
  let speed = a.speed;
  if (a.behavior === "hop") {
    const hop = Math.sin(a.phase * 6);
    a.altitude = Math.max(0, hop) * 0.45 * Math.min(1, a.size);
    speed *= hop > 0 ? 1.6 : 0.15;
  } else {
    a.altitude = 0;
  }
  if (a.state !== "move") {
    a.state = "idle";
    a.timer = 0.5;
    return 0;
  }
  if (!tryStep(a, speed * dt, ok)) {
    // Blocked: turn away and pause briefly.
    const back = outsideHome(a, a.n) && a.home ? signedAngle(a.n, a.t, tangentToward(a.n, a.home, _dir)) : (a.rng() < 0.5 ? -1 : 1) * (1 + a.rng() * 1.5);
    turn(a.n, a.t, back);
    a.state = isVehicle ? "move" : "idle";
    a.timer = isVehicle ? 0.5 : 0.4 + a.rng() * 1.2;
    return 0;
  }
  if (a.timer <= 0) {
    a.state = "idle";
    a.timer = isVehicle ? 0.8 + a.rng() * 1.5 : 1 + a.rng() * 3;
  }
  return 1;
}

/** Turn toward `steerTo` (if any). Returns true when steering is active. */
function steer(a: Agent, dt: number, rate: number): boolean {
  if (!a.steerTo) return false;
  if (angleBetween(a.n, a.steerTo) * PLANET_RADIUS < 0.3) return true;
  const ang = signedAngle(a.n, a.t, tangentToward(a.n, a.steerTo, _dir));
  turn(a.n, a.t, clamp(ang, -rate * a.steerGain * dt, rate * a.steerGain * dt));
  return true;
}

function stepFlyer(a: Agent, ctx: SimContext, dt: number): number {
  // Curved paths: turn rate drifts smoothly, so birds draw loops and arcs.
  a.timer -= dt;
  if (a.timer <= 0) {
    a.timer = 2 + a.rng() * 4;
    a.targetAltitude = cruiseAltitude(a);
    a.turnRate = (a.rng() - 0.5) * 1.4;
  }
  if (a.state !== "move" && a.state !== "idle") a.state = "move";
  const steering = !!a.steerTo;
  if (!steering && a.home && a.homeRadius > 0 && angleBetween(a.n, a.home) > a.homeRadius) {
    const ang = signedAngle(a.n, a.t, tangentToward(a.n, a.home, _dir));
    a.turnRate += clamp(ang, -1, 1) * dt * 1.5;
  }
  if (steering) {
    const ang = signedAngle(a.n, a.t, tangentToward(a.n, a.steerTo!, _dir));
    a.turnRate += (clamp(ang * 1.5, -1.6, 1.6) - a.turnRate) * Math.min(1, dt * 2 * a.steerGain);
  }
  turn(a.n, a.t, a.turnRate * dt);
  a.bank += (a.turnRate - a.bank) * Math.min(1, dt * 2);
  moveAlong(a.n, a.t, a.speed * dt);
  // Rise over the mountain.
  const ground = ctx.terrain.heightAt(a.n) - PLANET_RADIUS;
  const minAlt = Math.max(0, 1.5 - ground);
  const want = Math.max(a.targetAltitude, minAlt) + Math.sin(a.phase * 1.3) * 0.4;
  a.altitude += (want - a.altitude) * Math.min(1, dt * 0.8);
  return 1;
}

/** A flyer gliding down to a perch (tree top, roof) and resting there. */
function stepPercher(a: Agent, ctx: SimContext, dt: number): number {
  void ctx;
  if (!a.target) {
    a.state = "move";
    return 1;
  }
  const dist = angleBetween(a.n, a.target) * PLANET_RADIUS;
  if (a.state === "rest") {
    // Sitting still, wings folded; a little breathing bob.
    a.altitude += (a.perchAlt - a.altitude) * Math.min(1, dt * 4);
    a.bank *= 0.9;
    a.turnRate = 0;
    return 0;
  }
  tangentToward(a.n, a.target, _dir);
  const ang = signedAngle(a.n, a.t, _dir);
  turn(a.n, a.t, clamp(ang, -2.5 * dt, 2.5 * dt));
  a.bank += (clamp(ang, -1, 1) - a.bank) * Math.min(1, dt * 2);
  const speed = a.speed * Math.min(1, 0.25 + dist / 4);
  if (dist < 0.25) {
    a.n.copy(a.target);
    orthonormalize(a.n, a.t);
    a.state = "rest";
    a.arrived = true;
    return 0;
  }
  if (Math.abs(ang) < 2) moveAlong(a.n, a.t, Math.min(speed * dt, dist));
  // Glide down as we get close.
  const k = clamp(1 - (dist - 1) / 6, 0, 1);
  const want = a.perchAlt + (a.targetAltitude - a.perchAlt) * (1 - k);
  a.altitude += (want - a.altitude) * Math.min(1, dt * 1.6);
  return 1;
}

/** Sleeping: stay put; flyers sitting on a perch keep their height, others settle down. */
function stepSleeper(a: Agent, ctx: SimContext, dt: number): number {
  void ctx;
  switch (a.behavior) {
    case "fly":
      a.altitude += ((a.perchAlt > 0 ? a.perchAlt : a.altitude) - a.altitude) * Math.min(1, dt * 2);
      a.bank *= 0.9;
      break;
    case "flutter":
      a.altitude += (0.35 - a.altitude) * Math.min(1, dt * 1.5);
      break;
    case "hover":
      a.altitude += (a.targetAltitude * 0.6 + Math.sin(a.phase * 0.5) * 0.2 - a.altitude) * Math.min(1, dt * 0.8);
      break;
    case "swim":
    case "float":
      a.altitude = 0;
      break;
    default:
      a.altitude *= 0.8;
  }
  return 0;
}

function stepFlutter(a: Agent, dt: number): number {
  a.timer -= dt;
  if (a.timer <= 0) {
    a.timer = 0.3 + a.rng() * 0.9;
    a.turnRate = (a.rng() - 0.5) * (a.steerTo ? 2.5 : 5);
    a.targetAltitude = cruiseAltitude(a);
  }
  if (a.state !== "move" && a.state !== "idle") a.state = "move";
  if (!a.home) a.home = a.n.clone();
  if (a.homeRadius === 0) a.homeRadius = 0.12;
  if (!steer(a, dt, 4) && angleBetween(a.n, a.home) > a.homeRadius) {
    const ang = signedAngle(a.n, a.t, tangentToward(a.n, a.home, _dir));
    turn(a.n, a.t, clamp(ang, -4 * dt, 4 * dt));
  }
  turn(a.n, a.t, a.turnRate * dt);
  moveAlong(a.n, a.t, a.speed * dt * (0.6 + 0.4 * Math.abs(Math.sin(a.phase * 3))));
  const flap = Math.sin(a.phase * 7) * 0.25;
  a.altitude += (a.targetAltitude + flap - a.altitude) * Math.min(1, dt * 3);
  return 1;
}

function stepHover(a: Agent, dt: number): number {
  a.timer -= dt;
  if (a.timer <= 0) {
    a.timer = 4 + a.rng() * 5;
    a.turnRate = (a.rng() - 0.5) * 0.5;
  }
  if (a.state !== "move" && a.state !== "idle") a.state = "move";
  if (!a.home) a.home = a.n.clone();
  if (a.homeRadius === 0) a.homeRadius = 0.18;
  if (!steer(a, dt, 1.2) && angleBetween(a.n, a.home) > a.homeRadius) {
    const ang = signedAngle(a.n, a.t, tangentToward(a.n, a.home, _dir));
    turn(a.n, a.t, clamp(ang, -dt, dt));
  }
  turn(a.n, a.t, a.turnRate * dt);
  moveAlong(a.n, a.t, a.speed * dt);
  const want = a.targetAltitude + Math.sin(a.phase * 0.9) * 0.5;
  a.altitude += (want - a.altitude) * Math.min(1, dt * 1.2);
  return 1;
}

function stepSwimmer(a: Agent, ctx: SimContext, dt: number): number {
  a.timer -= dt;
  const inWater = ctx.terrain.waterAt(a.n) >= 0;
  if (!inWater) {
    // Head for the nearest water, flopping along the ground.
    a.state = "seekWater";
    const w = nearestWater(a.n);
    tangentToward(a.n, w.center, _dir);
    const ang = signedAngle(a.n, a.t, _dir);
    turn(a.n, a.t, clamp(ang, -3 * dt, 3 * dt));
    const hop = Math.sin(a.phase * 7);
    a.altitude = Math.max(0, hop) * 0.4;
    moveAlong(a.n, a.t, a.speed * 0.9 * dt * (hop > 0 ? 1.5 : 0.3));
    return 1;
  }
  if (a.state === "seekWater") {
    a.state = "move";
    const w = ctx.terrain.waterAt(a.n);
    a.home = WATER_BODIES[w].center.clone();
    a.homeRadius = WATER_BODIES[w].radius * 0.85;
  }
  if (a.state !== "move" && a.state !== "idle") a.state = "move";
  a.altitude = 0;
  if (a.timer <= 0) {
    a.timer = 1.5 + a.rng() * 3;
    a.turnRate = (a.rng() - 0.5) * (a.steerTo ? 0.6 : 1.4);
    a.state = a.behavior === "float" && !a.steerTo && a.rng() < 0.3 ? "idle" : "move";
  }
  if (a.state === "idle") return 0;
  steer(a, dt, 1.6);
  turn(a.n, a.t, a.turnRate * dt);
  const speed = a.speed * (a.behavior === "swim" ? 0.8 + 0.3 * Math.sin(a.phase * 4) : 1);
  if (!tryStep(a, speed * dt, (n) => waterOk(ctx, n, 0.01 + a.size * 0.004))) {
    const w = ctx.terrain.waterAt(a.n);
    const center = w >= 0 ? WATER_BODIES[w].center : nearestWater(a.n).center;
    const ang = signedAngle(a.n, a.t, tangentToward(a.n, center, _dir));
    turn(a.n, a.t, ang * 0.6 + (a.rng() - 0.5) * 0.6);
    a.turnRate = 0;
    return 0;
  }
  return 1;
}

/** States in which an agent can't be called over or distracted. */
export function busy(a: Agent): boolean {
  return a.state === "carried" || a.state === "inside" || a.state === "ride" || a.state === "sleep" || a.hidden || arriving(a);
}

/** Make nearby walkers come over to look at something new. */
export function attractAgents(agents: Iterable<Agent>, n: Vector3, maxAngle: number, emote: string): number {
  let count = 0;
  for (const a of agents) {
    if (a.behavior !== "walk" && a.behavior !== "hop") continue;
    if (busy(a)) continue;
    if (angleBetween(a.n, n) > maxAngle) continue;
    a.state = "goto";
    a.target = n.clone();
    a.emote = emote;
    a.emoteTimer = 6;
    count++;
  }
  return count;
}

/** Whether a behaviour is allowed at a location (used for drops and spawning). */
export function placementOk(ctx: SimContext, behavior: Behavior, n: Vector3, radius: number, ignoreId?: string): boolean {
  if (needsWater(behavior)) return waterOk(ctx, n, 0.02);
  if (behavior === "fly" || behavior === "hover" || behavior === "flutter") return !ctx.terrain.isBlockedTerrain(n);
  return landOk(ctx, n, radius, ignoreId);
}
