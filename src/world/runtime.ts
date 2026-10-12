// The live simulation of one loaded world. React components read from it in
// their frame loops; React state is only touched for discrete events.

import { Vector3 } from "three";
import type { Behavior, CreationRecord, EaselRecord, WorldMode, WorldSave } from "@/core/types";
import { getKind, needsWater, speedFor, sizeFor } from "@/core/kinds";
import { Terrain, REGIONS, WATER_BODIES } from "./planet";
import { generateScenery, type SceneryLayout } from "./scenery";
import { ObstacleGrid } from "./collision";
import { createAgent, stepAgent, attractAgents, placementOk, nearestWater, updatePosition, startFall, type Agent, type SimContext } from "./agents";
import { createPlayer, stepPlayer, walkable, placePlayer, type PlayerInput, type PlayerState } from "./player";
import { Emitter } from "./events";
import { v3, toVec3, angleBetween, randomInCap, orthonormalize, tangentToward, moveAlong, PLANET_RADIUS } from "./sphere";
import { mulberry32 } from "./noise";
import { createMind, stepSocial, patAgent, startleAgent, SOCIAL_TICK, type Mood, type Perch, type SocialWorld } from "./social";
import { RideController } from "./rides";
import { computeBridgeSpan, findBridgeSpot as findBridge, orientBridge, type BridgeSpot } from "./bridges";

export interface RuntimeEvents {
  region: { index: number; name: string; emoji: string };
  rejected: { id: string; reason: string };
  moved: { id: string };
  /** A creature noticed the player (rate-limited per creature) – play its sound. */
  notice: { id: string; kind: string; mood: Mood };
  /** The player got on / off a ride. */
  ride: { id: string; phase: "start" | "end" };
  /** A new creation touched down after its paper-plane arrival (good moment for its voice). */
  arrived: { id: string; kind: string };
}

/** Extra clearance (world units) kept around new buildings, bridges' ends and easels. */
const BUILD_CLEARANCE = 0.6;

export interface EaselState {
  id: string;
  n: Vector3;
  t: Vector3;
  pos: Vector3;
  /** Pop-in animation 0..1 */
  spawn: number;
  carried: boolean;
  /** Bump animation when a note is added. */
  wiggle: number;
}

const HOME_RADIUS = 0.36;

export class WorldRuntime {
  readonly mode: WorldMode;
  readonly seed: number;
  readonly terrain: Terrain;
  readonly layout: SceneryLayout;
  readonly grid = new ObstacleGrid();
  readonly player: PlayerState;
  readonly creations = new Map<string, Agent>();
  readonly ambient: Agent[] = [];
  readonly visitors: Agent[] = [];
  readonly easels = new Map<string, EaselState>();
  readonly events = new Emitter<RuntimeEvents>();
  readonly input: PlayerInput = { x: 0, y: 0 };
  time = 0;
  regionIndex = -1;
  /** Camera focus for level-of-detail decisions. */
  readonly focus = new Vector3(0, 1, 0);
  /** In-memory friendship (pats) per creation id; makes them notice you more. */
  readonly friendship = new Map<string, number>();
  /** Shorter, simpler arrivals (set by the renderer from the calm-motion setting). */
  reducedMotion = false;
  private frame = 0;
  private nextVisit = 6;
  private ctx: SimContext;
  private social: SocialWorld;
  private socialClock = 0;
  private rides: RideController;
  private pendingBridge: BridgeSpot | null = null;
  private arrivals = new Set<string>();

  constructor(save: WorldSave) {
    this.mode = save.mode;
    this.seed = save.seed;
    this.terrain = new Terrain(save.seed);
    this.layout = generateScenery(this.terrain, save.seed);
    this.layout.items.forEach((it, i) => {
      if (it.radius > 0) this.grid.add({ id: `s${i}`, n: it.n, radius: it.radius });
    });
    this.ctx = { terrain: this.terrain, grid: this.grid, time: 0 };

    let pn = v3(save.player.position);
    if (!walkable(this.terrain, this.grid, pn)) pn = this.findLandNear(pn, 0.4) ?? pn;
    this.player = createPlayer(pn, v3(save.player.heading));
    this.player.pos.copy(pn).multiplyScalar(this.terrain.heightAt(pn));

    // Ambient life (farm animals, ducks, boats, butterflies, birds).
    this.layout.ambient.forEach((s, i) => {
      const a = createAgent({
        id: `amb${i}`,
        behavior: s.behavior,
        n: s.n,
        speed: s.speed,
        size: s.size,
        home: s.home,
        homeRadius: s.homeRadius,
      });
      a.facing = "right";
      this.ambient.push(a);
    });

    if (this.mode === "gallery") this.spawnVisitors();

    const perches: Perch[] = [];
    let blanket: Vector3 | null = null;
    for (const it of this.layout.items) {
      if (it.art.startsWith("tree_") || it.art === "palm" || it.art === "snow_pine") perches.push({ n: it.n, alt: it.size * 0.9 });
      else if (it.art === "blanket") blanket = it.n;
    }
    this.social = {
      time: 0,
      ctx: this.ctx,
      creations: this.creations,
      player: this.player.n,
      ridingId: null,
      perches,
      blanket,
      friendship: this.friendship,
      notice: (id, kind, mood) => this.events.emit("notice", { id, kind, mood }),
    };
    this.rides = new RideController({
      terrain: this.terrain,
      grid: this.grid,
      ctx: this.ctx,
      player: this.player,
      onEnd: (id) => this.events.emit("ride", { id, phase: "end" }),
    });
    for (const c of save.creations) this.addCreation(c, false);
    for (const e of save.easels) this.addEasel(e, false);
    this.regionIndex = this.terrain.regionAt(this.player.n).index;
  }

  private spawnVisitors() {
    const rng = mulberry32(this.seed ^ 0xa11e);
    const tmp = new Vector3();
    for (let i = 0; i < 18; i++) {
      const region = REGIONS[i % REGIONS.length];
      for (let k = 0; k < 20; k++) {
        randomInCap(region.center, 0.3, rng, tmp);
        if (walkable(this.terrain, this.grid, tmp)) break;
      }
      const a = createAgent({ id: `vis${i}`, behavior: "walk", n: tmp, speed: 1 + rng() * 0.5, size: 1.1 + rng() * 0.3, home: region.center, homeRadius: 0.4 });
      this.visitors.push(a);
    }
  }

  // ---------------------------------------------------------------- creations

  addCreation(rec: CreationRecord, animate: boolean): Agent {
    const kind = getKind(rec.kind);
    const behavior = rec.behavior;
    let n = v3(rec.position);
    const size = sizeFor(rec.kind);
    const isBridge = rec.kind === "bridge";
    // Restore safely: if the saved spot became invalid, find a nearby one.
    // (Bridges belong over water, so only the mountain top is off limits.)
    if (isBridge ? this.terrain.isBlockedTerrain(n) : !placementOk(this.ctx, behavior, n, 0.3, rec.id)) {
      n = this.findSpot(behavior, n, size) ?? n;
    }
    const a = createAgent({
      kind: rec.kind,
      reducedMotion: this.reducedMotion,
      id: rec.id,
      behavior,
      facing: rec.facing,
      n,
      t: v3(rec.heading),
      speed: speedFor(rec.kind, behavior) || kind.speed,
      size,
      home: n,
      homeRadius: needsWater(behavior) ? 0 : HOME_RADIUS,
      spawn: animate ? 0 : 1,
    });
    if (needsWater(behavior)) {
      const w = this.terrain.waterAt(n);
      if (w >= 0) {
        a.home = WATER_BODIES[w].center.clone();
        a.homeRadius = WATER_BODIES[w].radius * 0.85;
      }
    }
    a.mind = createMind(rec.id, rec.kind);
    if (isBridge) {
      a.solid = false;
      a.radius = 0.6;
      a.home = null;
      this.grid.addBridge(computeBridgeSpan(this.terrain, rec.id, a.n, a.t));
    }
    if (a.solid) this.grid.add({ id: rec.id, n: a.n, radius: a.radius });
    updatePosition(a, this.ctx);
    this.creations.set(rec.id, a);
    if (animate) this.arrivals.add(rec.id);
    return a;
  }

  removeCreation(id: string) {
    if (this.rides.id === id) this.rides.abort();
    this.creations.delete(id);
    this.grid.remove(id);
    this.friendship.delete(id);
  }

  /** Find a spot suitable for a behaviour near `near` (spiral search). */
  findSpot(behavior: Behavior, near: Vector3, size: number, ignoreId?: string, clearance = behavior === "build" ? BUILD_CLEARANCE : 0): Vector3 | null {
    // New buildings keep a clearing around them (no trees or lamp posts touching the walls).
    const radius = (behavior === "build" ? size * 0.45 : 0.4) + clearance;
    if (needsWater(behavior)) {
      // Pick the in-water spot of the nearest pond/lake that is closest to `near`.
      const body = WATER_BODIES[nearestWater(near).index];
      const rng = mulberry32(Math.floor((near.x + 2) * 1e5));
      const tmp = new Vector3();
      let best: Vector3 | null = null;
      let bestD = Infinity;
      for (let k = 0; k < 120; k++) {
        randomInCap(body.center, body.radius * 0.8, rng, tmp);
        if (!placementOk(this.ctx, behavior, tmp, radius, ignoreId)) continue;
        const d = angleBetween(tmp, near);
        if (d < bestD) {
          bestD = d;
          best = tmp.clone();
        }
      }
      return best ?? body.center.clone();
    }
    const tmp = new Vector3();
    const rng = mulberry32(Math.floor((near.x + 2) * 1e6) ^ Math.floor((near.y + 2) * 1e5));
    if (placementOk(this.ctx, behavior, near, radius, ignoreId) && !this.overlapsCreation(near, radius, ignoreId)) return near.clone();
    for (let ring = 1; ring < 30; ring++) {
      const ang = (ring * 0.6) / PLANET_RADIUS;
      for (let k = 0; k < 10; k++) {
        randomInCap(near, ang, rng, tmp, ang * 0.6);
        if (placementOk(this.ctx, behavior, tmp, radius, ignoreId) && !this.overlapsCreation(tmp, radius, ignoreId)) return tmp.clone();
      }
    }
    return null;
  }

  private overlapsCreation(n: Vector3, radius: number, ignoreId?: string): boolean {
    for (const a of this.creations.values()) {
      if (a.id === ignoreId) continue;
      if (a.behavior !== "build" && a.behavior !== "grow" && a.behavior !== "still") continue;
      if (a.kind === "bridge") {
        // Keep the walkway itself free.
        if (this.grid.getBridge(a.id) && this.grid.onBridge(n, -radius)?.id === a.id) return true;
        continue;
      }
      if (angleBetween(a.n, n) * PLANET_RADIUS < a.radius + radius + 0.3) return true;
    }
    for (const e of this.easels.values()) {
      if (e.id === ignoreId) continue;
      if (angleBetween(e.n, n) * PLANET_RADIUS < 1.6 + radius) return true;
    }
    return false;
  }

  /**
   * Where a new creation should appear: in front of the player, suitable for it.
   * Pass the kind so bridges are put across the nearest narrow water.
   */
  spawnPointFor(behavior: Behavior, size: number, kind?: string): Vector3 {
    if (kind === "bridge") return this.findBridgeSpot(this.player.n).center.clone();
    const n = this.player.n.clone();
    const t = this.player.camForward.clone();
    moveAlong(n, t, behavior === "build" ? 5 + size * 0.5 : 3.6);
    if (behavior === "swim" || behavior === "float") {
      // If water is near enough, use it; otherwise the nearest pond.
      return this.findSpot(behavior, n, size) ?? n;
    }
    return this.findSpot(behavior, n, size) ?? n;
  }

  /** Heading for a new creation at `point`: bridges run along the crossing, buildings face the player. */
  spawnHeadingFor(kind: string, point: Vector3, behavior?: Behavior): Vector3 {
    const b = behavior ?? getKind(kind).behavior;
    if (kind === "bridge") {
      const p = this.pendingBridge;
      if (p && angleBetween(p.center, point) < 1e-5) return p.t.clone();
      return orientBridge(this.terrain, point, this.player.camForward);
    }
    if (b === "build") return tangentToward(point, this.player.n, new Vector3());
    const t = this.player.camForward.clone().addScaledVector(point, -this.player.camForward.dot(point));
    if (t.lengthSq() < 1e-8) return tangentToward(point, this.player.n, new Vector3());
    return t.normalize();
  }

  /** Best bridge placement near `near`: centre point and crossing direction. */
  findBridgeSpot(near: Vector3): BridgeSpot {
    const spot = findBridge(this.terrain, this.grid, near);
    this.pendingBridge = { center: spot.center.clone(), t: spot.t.clone(), crossing: spot.crossing };
    return spot;
  }

  findLandNear(n: Vector3, maxAngle: number): Vector3 | null {
    const rng = mulberry32(12345);
    const tmp = new Vector3();
    for (let i = 0; i < 200; i++) {
      randomInCap(n, (maxAngle * (i + 1)) / 200, rng, tmp);
      if (walkable(this.terrain, this.grid, tmp)) return tmp.clone();
    }
    return null;
  }

  /** Begin carrying a creation or easel. */
  pickUp(id: string): boolean {
    const a = this.creations.get(id);
    if (a && this.rides.id === id) return false;
    if (a) {
      if (a.hidden) {
        a.hidden = false;
        if (a.mind) a.mind.activity = "free";
      }
      a.state = "carried";
      this.grid.remove(id);
      return true;
    }
    const e = this.easels.get(id);
    if (e) {
      e.carried = true;
      this.grid.remove(id);
      return true;
    }
    return false;
  }

  /** Move a carried thing to follow the pointer. */
  carryTo(id: string, n: Vector3) {
    const a = this.creations.get(id);
    if (a) {
      a.n.copy(n).normalize();
      orthonormalize(a.n, a.t);
      a.altitude = 1.2;
      this.updateCarriedPosition(a);
      return;
    }
    const e = this.easels.get(id);
    if (e) {
      e.n.copy(n).normalize();
      orthonormalize(e.n, e.t);
      e.pos.copy(e.n).multiplyScalar(this.terrain.heightAt(e.n) + 0.8);
    }
  }

  private updateCarriedPosition(a: Agent) {
    const h = Math.max(this.terrain.heightAt(a.n), this.terrain.waterAt(a.n) >= 0 ? PLANET_RADIUS : 0);
    a.pos.copy(a.n).multiplyScalar(h + a.altitude);
  }

  /** Whether dropping here is allowed (for live feedback while carrying). */
  canDrop(id: string, n: Vector3): boolean {
    const a = this.creations.get(id);
    if (a && a.kind === "bridge") return !this.terrain.isBlockedTerrain(n) && !this.overlapsCreation(n, 0.3, id);
    if (a) return placementOk(this.ctx, a.behavior, n, a.radius * 0.6, id) && !this.overlapsCreation(n, a.radius * 0.5, id);
    if (this.easels.has(id)) return placementOk(this.ctx, "build", n, 0.8, id) && !this.overlapsCreation(n, 0.6, id) && !this.nearPlayer(n, 0.8);
    return false;
  }

  private nearPlayer(n: Vector3, r: number) {
    return angleBetween(n, this.player.n) * PLANET_RADIUS < r;
  }

  /** Finish carrying. Returns true if accepted at the new spot. */
  drop(id: string, n: Vector3, previous: Vector3): boolean {
    const ok = this.canDrop(id, n);
    const at = ok ? n : previous;
    const a = this.creations.get(id);
    if (a) {
      a.n.copy(at).normalize();
      orthonormalize(a.n, a.t);
      a.state = "idle";
      a.timer = 1;
      if (!needsWater(a.behavior)) {
        a.home = a.n.clone();
        a.homeRadius = HOME_RADIUS;
        if (a.behavior === "fly" || a.behavior === "hover" || a.behavior === "flutter") a.homeRadius = a.behavior === "fly" ? 0.5 : 0.15;
      } else {
        const w = this.terrain.waterAt(a.n);
        if (w >= 0) {
          a.home = WATER_BODIES[w].center.clone();
          a.homeRadius = WATER_BODIES[w].radius * 0.85;
        }
      }
      if (a.behavior === "fly" || a.behavior === "hover" || a.behavior === "flutter") a.altitude = Math.max(a.altitude, 1);
      else startFall(a, 1.2); // a small fall + bounce
      if (a.kind === "bridge") {
        a.home = null;
        a.t.copy(orientBridge(this.terrain, a.n, a.t));
        this.grid.addBridge(computeBridgeSpan(this.terrain, id, a.n, a.t));
      }
      if (a.mind && a.mind.activity !== "free") {
        a.mind.activity = "free";
        a.mind.partner = null;
      }
      if (a.solid) this.grid.add({ id, n: a.n, radius: a.radius });
      if (!ok) this.events.emit("rejected", { id, reason: this.rejectReason(a.behavior) });
      else this.events.emit("moved", { id });
      return ok;
    }
    const e = this.easels.get(id);
    if (e) {
      e.n.copy(at).normalize();
      // Face the player so the picture is visible.
      tangentToward(e.n, this.player.n, e.t);
      e.carried = false;
      e.pos.copy(e.n).multiplyScalar(this.terrain.heightAt(e.n));
      this.grid.add({ id, n: e.n, radius: 0.7 });
      if (!ok) this.events.emit("rejected", { id, reason: "Easels need a flat, dry spot with some room." });
      else this.events.emit("moved", { id });
      return ok;
    }
    return false;
  }

  private rejectReason(b: Behavior): string {
    if (b === "swim") return "Fish need water! Try a pond or the lake.";
    if (b === "float") return "That one floats — put it on the water.";
    if (b === "build") return "Buildings need dry, open ground.";
    if (b === "grow") return "Plants need dry ground to grow.";
    return "It can't go there. Try somewhere on dry land.";
  }

  // ------------------------------------------------------------------- easels

  addEasel(rec: EaselRecord, animate: boolean): EaselState {
    let n = v3(rec.position);
    if (!placementOk(this.ctx, "build", n, 0.6, rec.id)) n = this.findSpot("build", n, 1.6, rec.id) ?? n;
    const t = v3(rec.heading);
    orthonormalize(n, t);
    const e: EaselState = { id: rec.id, n, t, pos: n.clone().multiplyScalar(this.terrain.heightAt(n)), spawn: animate ? 0 : 1, carried: false, wiggle: 0 };
    this.easels.set(rec.id, e);
    this.grid.add({ id: rec.id, n, radius: 0.7 });
    if (animate) this.celebrate(n, "wow");
    return e;
  }

  removeEasel(id: string) {
    this.easels.delete(id);
    this.grid.remove(id);
  }

  easelSpawnPoint(): { n: Vector3; t: Vector3 } {
    const n = this.player.n.clone();
    const t = this.player.camForward.clone();
    moveAlong(n, t, 3.2);
    // Easels need about 1.3 units of clear ground around them.
    const spot = this.findSpot("build", n, 1.6, undefined, 1.3 - 1.6 * 0.45 + 0.1) ?? n;
    const facing = tangentToward(spot, this.player.n, new Vector3());
    return { n: spot, t: facing };
  }

  /** Visitors and ambient walkers come to look. */
  celebrate(n: Vector3, emote: string): number {
    return attractAgents([...this.visitors, ...this.creations.values()], n, 0.45, emote);
  }

  // ------------------------------------------------------- pats & surprises

  /** Pat a creation: heart, happy hop, friendship +1. Returns its kind (null if unknown). */
  pat(id: string): string | null {
    const a = this.creations.get(id);
    if (!a) return null;
    patAgent(a, this.social);
    return a.kind;
  }

  /** "Shake the planet": every creation, animal and visitor jumps in surprise. */
  jumpAll(): void {
    const rng = mulberry32((this.frame * 2654435761) >>> 0);
    for (const a of this.creations.values()) if (a.kind !== "bridge" && a.behavior !== "build") startleAgent(a, this.time, rng, true);
    for (const a of this.ambient) startleAgent(a, this.time, rng, false);
    for (const a of this.visitors) startleAgent(a, this.time, rng, rng() < 0.5);
  }

  // -------------------------------------------------------------------- rides

  /** Ride a flyer / hover-er (scenic loop over the mountain) or a swimmer / floater (around its pond). */
  startRide(id: string): boolean {
    const a = this.creations.get(id);
    if (!a || this.rides.active) return false;
    if (a.mind?.activity === "sleep") patAgent(a, this.social);
    if (!this.rides.start(a)) return false;
    this.events.emit("ride", { id, phase: "start" });
    return true;
  }

  /** Stop a ride early (the creature brings the player back first). */
  endRide(): void {
    this.rides.end();
  }

  /** The creation the player is riding, if any. */
  get riding(): { id: string } | null {
    const id = this.rides.id;
    return id ? { id } : null;
  }

  /** Whether a creation can be ridden. */
  canRide(id: string): boolean {
    const a = this.creations.get(id);
    return !!a && RideController.canRide(a);
  }

  // ---------------------------------------------------------------- stepping

  step(rawDt: number) {
    // Clamp frame deltas (background tabs, hitches).
    const dt = Math.min(0.05, Math.max(0, rawDt));
    if (dt === 0) return;
    this.time += dt;
    this.ctx.time = this.time;
    this.frame++;
    if (this.rides.active) this.rides.step(dt);
    else {
      stepPlayer(this.player, this.input, this.terrain, this.grid, dt);
      // Standing in water (a bridge was taken away): step back onto land.
      if (this.terrain.waterAt(this.player.n, 0.004) >= 0 && !this.grid.onBridge(this.player.n)) {
        const spot = this.findLandNear(this.player.n, 0.3) ?? this.findLandNear(this.player.n, 0.9);
        if (spot) placePlayer(this.player, spot);
      }
    }

    // Social decisions at ~4 Hz.
    this.socialClock += dt;
    if (this.socialClock >= SOCIAL_TICK) {
      this.socialClock = Math.min(this.socialClock - SOCIAL_TICK, SOCIAL_TICK);
      this.social.time = this.time;
      this.social.ridingId = this.rides.id;
      stepSocial(this.social);
    }

    const focus = this.focus;
    const near = (a: Agent) => a.n.dot(focus) > 0.55;
    // Distant entities update less often (every 4th frame with 4× dt).
    const slow = this.frame % 4 === 0;
    for (const a of this.creations.values()) {
      if (near(a) || a.spawn < 1) stepAgent(a, this.ctx, dt);
      else if (slow) stepAgent(a, this.ctx, Math.min(0.2, dt * 4));
    }
    for (const id of this.arrivals) {
      const a = this.creations.get(id);
      if (!a) this.arrivals.delete(id);
      else if (a.spawn >= a.spawnHold + (1 - a.spawnHold) * 0.3) {
        this.arrivals.delete(id);
        this.events.emit("arrived", { id, kind: a.kind });
      }
    }
    for (const a of this.ambient) {
      if (near(a)) stepAgent(a, this.ctx, dt);
      else if (slow) stepAgent(a, this.ctx, Math.min(0.2, dt * 4));
    }
    for (const a of this.visitors) {
      if (near(a)) stepAgent(a, this.ctx, dt);
      else if (slow) stepAgent(a, this.ctx, Math.min(0.2, dt * 4));
    }
    for (const e of this.easels.values()) {
      if (e.spawn < 1) e.spawn = Math.min(1, e.spawn + dt * 1.2);
      if (e.wiggle > 0) e.wiggle = Math.max(0, e.wiggle - dt);
    }

    // Now and then a gallery visitor strolls over to admire a picture.
    if (this.mode === "gallery" && this.time > this.nextVisit && this.easels.size) {
      this.nextVisit = this.time + 6 + Math.random() * 6;
      const easels = [...this.easels.values()];
      const e = easels[Math.floor(Math.random() * easels.length)];
      const idle = this.visitors.filter((v) => v.state !== "goto" && v.state !== "react" && angleBetween(v.n, e.n) < 0.6);
      const v = idle[Math.floor(Math.random() * idle.length)];
      if (v) {
        v.state = "goto";
        v.target = e.n.clone();
        v.emote = Math.random() < 0.5 ? "heart" : "wow";
        v.emoteTimer = 6;
      }
    }

    // Region change detection with hysteresis.
    const r = this.terrain.regionAt(this.player.n);
    if (r.index !== this.regionIndex && r.depth > 0.03) {
      this.regionIndex = r.index;
      const def = REGIONS[r.index];
      this.events.emit("region", { index: r.index, name: def.name, emoji: def.emoji });
    }
  }

  /** Write live positions back into save records. */
  snapshot(save: WorldSave): WorldSave {
    const creations = save.creations.map((c) => {
      const a = this.creations.get(c.id);
      if (!a) return c;
      const home = a.behavior === "fly" || a.behavior === "hover" || a.behavior === "flutter" ? a.home ?? a.n : a.n;
      return { ...c, position: toVec3(home), heading: toVec3(a.t) };
    });
    const easels = save.easels.map((e) => {
      const s = this.easels.get(e.id);
      return s ? { ...e, position: toVec3(s.n), heading: toVec3(s.t) } : e;
    });
    return {
      ...save,
      creations,
      easels,
      player: { position: toVec3(this.rides.landingSpot ?? this.player.n), heading: toVec3(this.player.t) },
    };
  }

  regionNameAt(n: Vector3): string {
    return REGIONS[this.terrain.regionAt(n).index].name;
  }

  positionOf(id: string): Vector3 | null {
    return this.creations.get(id)?.n ?? this.easels.get(id)?.n ?? null;
  }

  dispose() {
    this.events.clear();
  }
}
