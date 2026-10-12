// Rides: the player climbs onto a flying creation for a scenic loop over the
// mountain top, or onto a swimmer / floater for a boat ride around its pond.
// The ride controller owns the player's position while riding and always
// sets them down on walkable ground near where they got on.

import { Vector3, Quaternion } from "three";
import { Terrain, REGION_BY_ID, WATER_BODIES, WATER_LEVEL } from "./planet";
import { ObstacleGrid } from "./collision";
import { updatePosition, waterOk, nearestWater, type Agent, type SimContext } from "./agents";
import { walkable, placePlayer, type PlayerState } from "./player";
import { angleBetween, anyTangent, moveAlong, tangentToward, orthonormalize, randomInCap, signedAngle, PLANET_RADIUS } from "./sphere";
import { mulberry32 } from "./noise";

export type RidePhase = "board" | "tour" | "return" | "land";

/** A teardrop loop from `a` out to the far point and back (great-circle base with a sideways swing). */
export interface LoopPath {
  a: Vector3;
  axis: Vector3;
  perp: Vector3;
  angle: number;
  width: number;
}

export function makeLoop(a: Vector3, b: Vector3, width: number): LoopPath {
  const aa = a.clone().normalize();
  const axis = new Vector3().crossVectors(aa, b);
  if (axis.lengthSq() < 1e-10) anyTangent(aa, axis);
  axis.normalize();
  const perp = new Vector3().crossVectors(axis, aa).normalize();
  return { a: aa, axis, perp, angle: angleBetween(aa, b.clone().normalize()), width };
}

/** Point on the loop at progress u ∈ [0,1] (u = 0 and 1 are the start, 0.5 the far point). */
export function loopAt(p: LoopPath, u: number, out: Vector3): Vector3 {
  const s = (1 - Math.cos(2 * Math.PI * u)) / 2;
  const th = s * p.angle;
  out.copy(p.a).multiplyScalar(Math.cos(th)).addScaledVector(p.perp, Math.sin(th));
  const o = Math.sin(2 * Math.PI * u) * p.width;
  return out.multiplyScalar(Math.cos(o)).addScaledVector(p.axis, Math.sin(o)).normalize();
}

function loopLength(p: LoopPath): number {
  const a = new Vector3(), b = new Vector3();
  let len = 0;
  loopAt(p, 0, a);
  for (let i = 1; i <= 64; i++) {
    loopAt(p, i / 64, b);
    len += angleBetween(a, b) * PLANET_RADIUS;
    a.copy(b);
  }
  return len;
}

/** Spherical interpolation between unit vectors (stable for opposite points). */
export function slerpUnit(a: Vector3, b: Vector3, k: number, out: Vector3): Vector3 {
  const ang = angleBetween(a, b);
  if (ang < 1e-6) return out.copy(a);
  const axis = new Vector3().crossVectors(a, b);
  if (axis.lengthSq() < 1e-10) anyTangent(a, axis);
  axis.normalize();
  const perp = new Vector3().crossVectors(axis, a).normalize();
  const th = ang * k;
  return out.copy(a).multiplyScalar(Math.cos(th)).addScaledVector(perp, Math.sin(th)).normalize();
}

const ss = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

export interface RideDeps {
  terrain: Terrain;
  grid: ObstacleGrid;
  ctx: SimContext;
  player: PlayerState;
  onEnd(id: string): void;
}

interface RideState {
  agent: Agent;
  water: boolean;
  phase: RidePhase;
  t: number;
  dur: number;
  start: Vector3;
  startPos: Vector3;
  landing: Vector3;
  board: Vector3;
  boardR: number;
  from: Vector3;
  fromR: number;
  loop: LoopPath;
  u: number;
  tourDur: number;
  seat: number;
  radius: number;
  hopFrom: Vector3;
}

const _n = new Vector3();
const _a = new Vector3();
const _b = new Vector3();
const _dir = new Vector3();
const _q = new Quaternion();
const _old = new Vector3();

export class RideController {
  private ride: RideState | null = null;
  constructor(private deps: RideDeps) {}

  get active(): boolean {
    return !!this.ride;
  }

  get id(): string | null {
    return this.ride?.agent.id ?? null;
  }

  get phase(): RidePhase | null {
    return this.ride?.phase ?? null;
  }

  /** Where the player will be set down (used for saving mid-ride). */
  get landingSpot(): Vector3 | null {
    return this.ride?.landing ?? null;
  }

  static canRide(a: Agent): boolean {
    return a.behavior === "fly" || a.behavior === "hover" || a.behavior === "swim" || a.behavior === "float";
  }

  start(a: Agent): boolean {
    if (this.ride || !RideController.canRide(a)) return false;
    if (a.state === "carried" || a.hidden || a.spawn < 1) return false;
    const { terrain, player } = this.deps;
    const water = a.behavior === "swim" || a.behavior === "float";
    const start = player.n.clone();
    const startPos = player.pos.clone();
    let board: Vector3, boardR: number, loop: LoopPath, tourDur: number;
    if (!water) {
      board = start.clone();
      boardR = terrain.heightAt(board) + 1.0;
      const mountain = REGION_BY_ID.mountain.center;
      let far = mountain.clone();
      if (angleBetween(board, mountain) < 0.25) {
        // Already at the mountain: loop over the top and out the other side.
        const t = tangentToward(mountain, board, new Vector3()).negate();
        moveAlong(far, t, 6);
      }
      const ang = angleBetween(board, far);
      loop = makeLoop(board, far, Math.min(0.3, 0.35 * ang + 0.05));
      tourDur = Math.min(22, Math.max(15, loopLength(loop) / 5.5));
    } else {
      const w = terrain.waterAt(a.n) >= 0 ? terrain.waterAt(a.n) : nearestWater(a.n).index;
      const body = WATER_BODIES[w];
      board = this.shorePoint(body.center, start);
      boardR = WATER_LEVEL - 0.05;
      loop = this.waterLoop(board, body.center, body.radius);
      tourDur = Math.min(20, Math.max(14, loopLength(loop) / 1.4));
    }
    const landing = this.landingFor(start, board, water);
    const from = a.n.clone();
    const fromR = a.pos.length();
    const boardDur = water ? Math.min(3.5, Math.max(1.4, (angleBetween(from, board) * PLANET_RADIUS) / 2.5)) : Math.min(3, Math.max(1.6, (angleBetween(from, board) * PLANET_RADIUS) / 6));
    a.state = "ride";
    a.steerTo = null;
    a.target = null;
    a.falling = false;
    if (a.mind) {
      a.mind.activity = "free";
      a.mind.partner = null;
    }
    player.target = null;
    this.ride = {
      agent: a,
      water,
      phase: "board",
      t: 0,
      dur: boardDur,
      start,
      startPos,
      landing,
      board,
      boardR,
      from,
      fromR,
      loop,
      u: 0,
      tourDur,
      seat: water ? (a.behavior === "swim" ? 0.3 : a.size * 0.42) : a.size * 0.5,
      radius: boardR,
      hopFrom: new Vector3(),
    };
    return true;
  }

  /** Stop early: fly / swim back to where the player got on, then hop off. */
  end(): void {
    const r = this.ride;
    if (!r) return;
    if (r.phase === "board") {
      this.finish(true);
      return;
    }
    if (r.phase !== "tour") return;
    r.phase = "return";
    r.from.copy(r.agent.n);
    r.fromR = r.agent.pos.length();
    r.t = 0;
    r.dur = Math.min(4, Math.max(1.2, (angleBetween(r.from, r.board) * PLANET_RADIUS) / 7));
  }

  /** The ridden creation vanished (removed): put the player down right away. */
  abort(): void {
    const r = this.ride;
    if (!r) return;
    const { player } = this.deps;
    const spot = this.nearestWalkable(player.n) ?? r.landing;
    placePlayer(player, spot);
    player.pos.copy(spot).multiplyScalar(this.groundAt(spot));
    const id = r.agent.id;
    this.ride = null;
    this.deps.onEnd(id);
  }

  step(dt: number): void {
    const r = this.ride;
    if (!r) return;
    const { player } = this.deps;
    const a = r.agent;
    r.t += dt;
    const k = Math.min(1, r.t / r.dur);
    _old.copy(a.n);
    switch (r.phase) {
      case "board": {
        const e = ss(0, 1, k);
        slerpUnit(r.from, r.board, e, a.n);
        const far = angleBetween(r.from, r.board) * PLANET_RADIUS;
        const radius = r.fromR + (r.boardR - r.fromR) * e + (r.water ? 0 : Math.sin(Math.PI * e) * Math.min(2, far * 0.2));
        this.headAlong(a, _old, r.board);
        this.place(a, radius, r.water);
        // The player hops on during the last part.
        const h = ss(0.6, 1, k);
        if (h <= 0) {
          player.pos.copy(r.startPos);
        } else {
          _a.copy(a.pos).addScaledVector(a.n, r.seat);
          player.pos.copy(r.startPos).lerp(_a, h).addScaledVector(a.n, Math.sin(Math.PI * h) * 1.2);
          if (h > 0.5) this.carryPlayer(dt, a.t, 0);
        }
        if (k >= 1) {
          r.phase = "tour";
          r.t = 0;
          r.dur = r.tourDur;
          r.radius = r.boardR;
        }
        break;
      }
      case "tour": {
        r.u = k;
        loopAt(r.loop, k, a.n);
        loopAt(r.loop, Math.min(1, k + 0.004), _b);
        if (angleBetween(a.n, _b) > 1e-7) tangentToward(a.n, _b, _dir);
        else _dir.copy(a.t);
        // How fast the heading turns (for banking).
        _b.copy(a.t).addScaledVector(a.n, -a.t.dot(a.n));
        const turnRate = _b.lengthSq() > 1e-10 && dt > 0 ? signedAngle(a.n, _b.normalize(), _dir) / dt : 0;
        a.t.copy(_dir);
        orthonormalize(a.n, a.t);
        if (r.water) this.place(a, 0, true);
        else {
          const env = ss(0, 0.1, k) * (1 - ss(0.88, 1, k));
          const ground = this.deps.terrain.heightAt(a.n);
          // Swoop down low over the mountain top (where the summit star floats).
          const nearPeak = 1 - ss(0.05, 0.16, angleBetween(a.n, REGION_BY_ID.mountain.center));
          const want = Math.max(ground + 1 + 7.5 * env * (1 - 0.92 * nearPeak), ground + 0.8);
          const rate = want > r.radius ? 4 : 1.2;
          r.radius += (want - r.radius) * Math.min(1, dt * rate);
          r.radius = Math.max(r.radius, ground + 0.8);
          this.place(a, r.radius, false);
          // Bank into the turns.
          a.bank += (Math.max(-1.5, Math.min(1.5, turnRate)) - a.bank) * Math.min(1, dt * 2);
        }
        this.carryPlayer(dt, a.t, r.seat);
        if (k >= 1) this.beginLanding();
        break;
      }
      case "return": {
        const e = ss(0, 1, k);
        slerpUnit(r.from, r.board, e, a.n);
        this.headAlong(a, _old, r.board);
        this.place(a, r.fromR + (r.boardR - r.fromR) * e, r.water);
        this.carryPlayer(dt, a.t, r.seat);
        if (k >= 1) this.beginLanding();
        break;
      }
      case "land": {
        const h = ss(0, 1, k);
        _a.copy(r.landing).multiplyScalar(this.groundAt(r.landing));
        player.pos.copy(r.hopFrom).lerp(_a, h).addScaledVector(a.n, Math.sin(Math.PI * h) * 1.4);
        if (!r.water) {
          // Hover gently while the player hops off.
          a.pos.copy(a.n).multiplyScalar(r.boardR + Math.sin(r.t * 3) * 0.1);
        }
        if (k >= 1) this.finish(false);
        break;
      }
    }
    if (r.phase !== "land" && r.phase !== "board") player.n.copy(a.n);
  }

  private beginLanding(): void {
    const r = this.ride!;
    r.phase = "land";
    r.t = 0;
    r.dur = 1.2;
    r.hopFrom.copy(this.deps.player.pos);
  }

  /** Release the creature and put the player down on the landing spot. */
  private finish(early: boolean): void {
    const r = this.ride!;
    const { player } = this.deps;
    const a = r.agent;
    const spot = early ? (walkable(this.deps.terrain, this.deps.grid, r.start) ? r.start : r.landing) : r.landing;
    placePlayer(player, spot);
    player.pos.copy(spot).multiplyScalar(this.groundAt(spot));
    player.moving = 0;
    a.state = a.behavior === "float" ? "idle" : "move";
    a.timer = 0.5;
    if (!r.water) a.altitude = Math.max(0, a.pos.length() - this.deps.terrain.heightAt(a.n));
    else {
      a.altitude = 0;
      updatePosition(a, this.deps.ctx);
    }
    this.ride = null;
    this.deps.onEnd(a.id);
  }

  /** Put the creature at radius (air) or on the water (water). */
  private place(a: Agent, radius: number, water: boolean): void {
    if (water) {
      a.altitude = 0;
      updatePosition(a, this.deps.ctx);
    } else {
      a.pos.copy(a.n).multiplyScalar(radius);
      a.altitude = radius - this.deps.terrain.heightAt(a.n);
    }
  }

  /** Point the heading along the movement since last frame (or toward the goal). */
  private headAlong(a: Agent, prev: Vector3, goal: Vector3): void {
    if (angleBetween(prev, a.n) > 1e-7) {
      _dir.copy(a.n).sub(prev);
      _dir.addScaledVector(a.n, -_dir.dot(a.n));
      if (_dir.lengthSq() > 1e-12) a.t.copy(_dir);
    } else if (angleBetween(a.n, goal) > 1e-6) tangentToward(a.n, goal, a.t);
    orthonormalize(a.n, a.t);
  }

  /** Keep the player sitting on the creature, camera turning smoothly with the flight. */
  private carryPlayer(dt: number, heading: Vector3, seat: number): void {
    const { player } = this.deps;
    const a = this.ride!.agent;
    _q.setFromUnitVectors(player.n, a.n);
    player.camForward.applyQuaternion(_q);
    player.n.copy(a.n);
    player.t.copy(heading);
    orthonormalize(player.n, player.t);
    _n.copy(player.camForward).addScaledVector(player.n, -player.camForward.dot(player.n));
    if (_n.lengthSq() < 1e-8) _n.copy(player.t);
    _n.normalize().lerp(player.t, 1 - Math.exp(-dt * 1.8));
    _n.addScaledVector(player.n, -_n.dot(player.n));
    if (_n.lengthSq() < 1e-8) _n.copy(player.t);
    player.camForward.copy(_n.normalize());
    if (seat > 0) player.pos.copy(a.pos).addScaledVector(a.n, seat);
    player.target = null;
    player.moving = 0;
  }

  private groundAt(n: Vector3): number {
    return Math.max(this.deps.terrain.heightAt(n), this.deps.grid.deckAt(n));
  }

  /** In-water point nearest to `from`, a little way from the shore. */
  private shorePoint(center: Vector3, from: Vector3): Vector3 {
    const n = center.clone();
    const t = tangentToward(center, from, new Vector3());
    let last = center.clone();
    for (let d = 0; d < 10; d += 0.2) {
      if (!waterOk(this.deps.ctx, n, 0.03)) break;
      last.copy(n);
      moveAlong(n, t, 0.2);
    }
    if (!waterOk(this.deps.ctx, last, 0.02)) last = center.clone();
    return last;
  }

  /** A loop from the boarding point across the pond and back, entirely on the water. */
  private waterLoop(board: Vector3, center: Vector3, bodyRadius: number): LoopPath {
    const away = tangentToward(center, board, new Vector3()).negate();
    let far = center.clone();
    moveAlong(far, away.clone(), bodyRadius * 0.5 * PLANET_RADIUS);
    let width = bodyRadius * 0.35;
    for (let attempt = 0; attempt < 8; attempt++) {
      const loop = makeLoop(board, far, width);
      let ok = true;
      for (let i = 0; i <= 64 && ok; i++) if (!waterOk(this.deps.ctx, loopAt(loop, i / 64, _a), 0.006)) ok = false;
      if (ok) return loop;
      width *= 0.7;
      slerpUnit(center, far, 0.7, far);
      far = far.clone();
    }
    return makeLoop(board, board, 0);
  }

  private landingFor(start: Vector3, board: Vector3, water: boolean): Vector3 {
    const { terrain, grid } = this.deps;
    if (walkable(terrain, grid, start) && (!water || angleBetween(start, board) * PLANET_RADIUS < 9)) return start.clone();
    if (water) {
      // Walk out from the boarding point until there's dry ground.
      const n = board.clone();
      const w = terrain.waterAt(board);
      const t = w >= 0 ? tangentToward(board, WATER_BODIES[w].center, new Vector3()).negate() : anyTangent(board, new Vector3());
      for (let d = 0; d < 8; d += 0.25) {
        moveAlong(n, t, 0.25);
        if (walkable(terrain, grid, n)) return n.clone();
      }
    }
    return this.nearestWalkable(start) ?? start.clone();
  }

  private nearestWalkable(n: Vector3): Vector3 | null {
    const { terrain, grid } = this.deps;
    if (walkable(terrain, grid, n)) return n.clone();
    const rng = mulberry32(777);
    const tmp = new Vector3();
    for (let i = 0; i < 300; i++) {
      randomInCap(n, (0.5 * (i + 1)) / 300, rng, tmp);
      if (walkable(terrain, grid, tmp)) return tmp.clone();
    }
    return null;
  }
}
