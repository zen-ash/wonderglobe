// Creations that feel alive: social behaviour, rides, bridges, pats and
// surprises. Everything runs in the plain simulation (no rendering).

import { afterEach, describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { getKind, needsWater } from "@/core/kinds";
import type { CreationRecord, WorldSave } from "@/core/types";
import { toVec3, angleBetween, moveAlong, randomInCap, tangentToward, PLANET_RADIUS } from "@/world/sphere";
import { REGIONS, REGION_BY_ID, WATER_BODIES, WATER_LEVEL } from "@/world/planet";
import { WorldRuntime } from "@/world/runtime";
import { walkable } from "@/world/player";
import { environment } from "@/world/environment";
import { createMind, growthScale, sproutCount } from "@/world/social";
import { bridgeCoords, bridgeDeckAt } from "@/world/collision";
import { buildBridgePlanks, buildBridgeSide, BRIDGE_WALL } from "@/render/cutoutGeometry";
import { Matrix4 } from "three";
import { mulberry32 } from "@/world/noise";

function world(playerAt: Vector3, seed = 4242): WorldSave {
  return {
    version: 1,
    mode: "paper",
    seed,
    createdAt: 0,
    updatedAt: 0,
    player: { position: toVec3(playerAt.clone().normalize()), heading: [1, 0, 0] },
    creations: [],
    easels: [],
    visited: [],
  };
}

function creation(id: string, kind: string, position: Vector3, extra: Partial<CreationRecord> = {}): CreationRecord {
  const k = getKind(kind);
  return {
    id,
    artworkId: `art_${id}`,
    kind,
    name: k.label,
    behavior: k.behavior,
    facing: k.hasFacing ? "right" : "none",
    classifiedBy: "player",
    position: toVec3(position.clone().normalize()),
    heading: [0, 1, 0],
    createdAt: 0,
    chat: [],
    ...extra,
  };
}

/** A point `dist` units from `from` toward `toward` (or along a fixed bearing). */
function near(from: Vector3, dist: number, bearing = 0): Vector3 {
  const n = from.clone().normalize();
  const t = new Vector3(0, 1, 0).addScaledVector(n, -n.y);
  if (t.lengthSq() < 1e-6) t.set(1, 0, 0).addScaledVector(n, -n.x);
  t.normalize();
  const b = new Vector3().crossVectors(n, t);
  const dir = t.multiplyScalar(Math.cos(bearing)).addScaledVector(b, Math.sin(bearing));
  moveAlong(n, dir, dist);
  return n;
}

const finite = (v: Vector3) => Number.isFinite(v.x + v.y + v.z);

function setTime(kind: "day" | "evening" | "night") {
  environment.isNight = kind === "night";
  environment.dusk = kind === "evening" ? 0.8 : 0;
  environment.time = kind === "day" ? 0.5 : kind === "evening" ? 0.76 : 0.02;
  environment.daylight = kind === "day" ? 1 : kind === "evening" ? 0.5 : 0;
}

afterEach(() => setTime("day"));

/** Walk the ride to its end, checking invariants every frame. Returns frames used. */
function rideToEnd(rt: WorldRuntime, check: (f: number) => void, maxSeconds = 40): number {
  const dt = 1 / 30;
  let f = 0;
  while (rt.riding && f < maxSeconds / dt) {
    rt.step(dt);
    check(f);
    f++;
  }
  return f;
}

describe("rides", () => {
  it("flies a scenic loop over the mountain and lands the player safely near the start", () => {
    const garden = REGIONS[0].center.clone();
    const save = world(garden);
    save.creations = [creation("dragon", "dragon", near(garden, 3))];
    const rt = new WorldRuntime(save);
    for (let i = 0; i < 30; i++) rt.step(1 / 30);
    const start = rt.player.n.clone();
    const phases: string[] = [];
    rt.events.on("ride", (e) => phases.push(`${e.id}:${e.phase}`));
    expect(rt.startRide("dragon")).toBe(true);
    expect(rt.riding).toEqual({ id: "dragon" });
    // Can't pick up what you're sitting on.
    expect(rt.pickUp("dragon")).toBe(false);
    let closest = Infinity, maxAlt = 0;
    const mountain = REGION_BY_ID.mountain.center;
    const frames = rideToEnd(rt, () => {
      const p = rt.player;
      expect(finite(p.pos) && finite(p.n) && finite(p.camForward)).toBe(true);
      expect(Math.abs(p.camForward.dot(p.n))).toBeLessThan(1e-6);
      closest = Math.min(closest, angleBetween(p.n, mountain));
      maxAlt = Math.max(maxAlt, p.pos.length() - rt.terrain.heightAt(p.n));
    });
    const seconds = frames / 30;
    expect(seconds).toBeGreaterThan(15);
    expect(seconds).toBeLessThan(30);
    expect(closest * PLANET_RADIUS).toBeLessThan(1); // right over the top
    expect(maxAlt).toBeGreaterThan(5);
    expect(phases).toEqual(["dragon:start", "dragon:end"]);
    expect(rt.riding).toBeNull();
    expect(walkable(rt.terrain, rt.grid, rt.player.n)).toBe(true);
    expect(angleBetween(rt.player.n, start) * PLANET_RADIUS).toBeLessThan(3);
    // Walking works again afterwards.
    const before = rt.player.n.clone();
    rt.input.y = 1;
    for (let i = 0; i < 20; i++) rt.step(1 / 30);
    rt.input.y = 0;
    expect(angleBetween(before, rt.player.n)).toBeGreaterThan(0);
    // The dragon flies on normally.
    for (let i = 0; i < 200; i++) rt.step(1 / 30);
    expect(finite(rt.creations.get("dragon")!.pos)).toBe(true);
  });

  it("gives a boat ride around the pond without ever leaving the water", () => {
    const lily = WATER_BODIES[0];
    const shore = near(lily.center, lily.radius * PLANET_RADIUS + 2.2, 1.0);
    const save = world(shore);
    save.creations = [creation("swan", "swan", lily.center.clone()), creation("fish", "fish", near(lily.center, 1, 2))];
    const rt = new WorldRuntime(save);
    for (let i = 0; i < 10; i++) rt.step(1 / 30);
    expect(walkable(rt.terrain, rt.grid, rt.player.n)).toBe(true);
    const start = rt.player.n.clone();
    for (const id of ["swan", "fish"]) {
      expect(rt.startRide(id)).toBe(true);
      const a = rt.creations.get(id)!;
      const frames = rideToEnd(rt, () => {
        expect(rt.terrain.waterAt(a.n)).toBeGreaterThanOrEqual(0);
        expect(finite(rt.player.pos)).toBe(true);
      });
      expect(frames / 30).toBeGreaterThan(12);
      expect(rt.riding).toBeNull();
      expect(walkable(rt.terrain, rt.grid, rt.player.n)).toBe(true);
      expect(angleBetween(rt.player.n, start) * PLANET_RADIUS).toBeLessThan(4);
      for (let i = 0; i < 60; i++) rt.step(1 / 30);
    }
  });

  it("can be stopped early and still lands on walkable ground", () => {
    const garden = REGIONS[0].center.clone();
    const save = world(garden);
    save.creations = [creation("balloon", "balloon", near(garden, 2)), creation("cat", "cat", near(garden, 3, 2))];
    const rt = new WorldRuntime(save);
    expect(rt.canRide("cat")).toBe(false);
    expect(rt.startRide("cat")).toBe(false);
    expect(rt.startRide("balloon")).toBe(true);
    for (let i = 0; i < 30 * 6; i++) rt.step(1 / 30);
    rt.endRide();
    const frames = rideToEnd(rt, () => undefined, 10);
    expect(frames / 30).toBeLessThan(7);
    expect(rt.riding).toBeNull();
    expect(walkable(rt.terrain, rt.grid, rt.player.n)).toBe(true);
  });

  it("saving mid-ride stores the landing spot, and removing the ride puts the player down", () => {
    const garden = REGIONS[0].center.clone();
    const save = world(garden);
    save.creations = [creation("bird", "bird", near(garden, 2))];
    const rt = new WorldRuntime(save);
    rt.startRide("bird");
    for (let i = 0; i < 30 * 5; i++) rt.step(1 / 30);
    const snap = rt.snapshot(save);
    const restored = new WorldRuntime(snap);
    expect(walkable(restored.terrain, restored.grid, restored.player.n)).toBe(true);
    rt.removeCreation("bird");
    expect(rt.riding).toBeNull();
    rt.step(1 / 30);
    expect(walkable(rt.terrain, rt.grid, rt.player.n)).toBe(true);
  });
});

describe("bridges", () => {
  it("spans the nearest narrow water and makes water walkable only along the corridor", () => {
    const lily = WATER_BODIES[0];
    const shore = near(lily.center, lily.radius * PLANET_RADIUS + 1.5, 0.4);
    const save = world(shore);
    const rt0 = new WorldRuntime(save);
    const spot = rt0.spawnPointFor("build", getKind("bridge").size, "bridge");
    const heading = rt0.spawnHeadingFor("bridge", spot);
    expect(rt0.terrain.waterAt(spot)).toBeGreaterThanOrEqual(0);
    expect(Math.abs(heading.dot(spot))).toBeLessThan(1e-6);

    // Before the bridge: the middle of the pond is not walkable.
    expect(walkable(rt0.terrain, rt0.grid, spot)).toBe(false);
    save.creations = [creation("br", "bridge", spot, { heading: toVec3(heading) })];
    const rt = new WorldRuntime(save);
    const br = rt.creations.get("br")!;
    expect(angleBetween(br.n, spot)).toBeLessThan(1e-5);
    const span = rt.grid.getBridge("br")!;
    expect(span).toBeTruthy();
    expect(span.halfAngle * PLANET_RADIUS * 2).toBeGreaterThan(3);
    // Along the corridor: walkable, with the deck above the water.
    const ends: Vector3[] = [];
    for (const s of [-1, -0.5, 0, 0.5, 1]) {
      const n = span.center.clone(), t = span.t.clone();
      moveAlong(n, t, s * (span.halfAngle * PLANET_RADIUS - 0.05));
      expect(walkable(rt.terrain, rt.grid, n)).toBe(true);
      expect(rt.grid.deckAt(n)).toBeGreaterThan(WATER_LEVEL);
      if (Math.abs(s) === 1) ends.push(n);
    }
    // Both ends rest on dry land (it reaches across the little pond).
    for (const e of ends) expect(rt.terrain.waterAt(e)).toBe(-1);
    // Beside the corridor over water: still not walkable.
    let offChecked = 0;
    for (const lat of [1.2, 2, -1.2, -2]) {
      const n = span.center.clone();
      const side = new Vector3().crossVectors(span.center, span.t);
      moveAlong(n, side, lat);
      if (rt.terrain.waterAt(n, -0.008) < 0) continue;
      expect(walkable(rt.terrain, rt.grid, n)).toBe(false);
      offChecked++;
    }
    expect(offChecked).toBeGreaterThan(0);

    // Walk right across it.
    const startEnd = ends[0];
    const onLand = rt.findLandNear(startEnd, 0.02) ?? startEnd;
    rt.player.n.copy(onLand);
    rt.player.camForward.copy(tangentToward(onLand, ends[1], new Vector3()));
    rt.player.t.copy(rt.player.camForward);
    rt.input.y = 1;
    let crossedWater = false;
    for (let i = 0; i < 30 * 5; i++) {
      // Keep heading toward the far end.
      rt.player.camForward.copy(tangentToward(rt.player.n, ends[1], new Vector3()));
      rt.step(1 / 30);
      const p = rt.player.n;
      if (rt.terrain.waterAt(p) >= 0) {
        crossedWater = true;
        const { lateral } = bridgeCoords(span, p);
        expect(Math.abs(lateral)).toBeLessThanOrEqual(span.halfWidth + 1e-6);
        expect(rt.player.pos.length()).toBeGreaterThan(WATER_LEVEL);
      }
      if (angleBetween(p, ends[1]) * PLANET_RADIUS < 0.6) break;
    }
    rt.input.y = 0;
    expect(crossedWater).toBe(true);
    expect(angleBetween(rt.player.n, ends[1]) * PLANET_RADIUS).toBeLessThan(1.5);

    // Taking the bridge away makes the water unwalkable again (and nobody is left standing in it).
    rt.player.n.copy(span.center);
    rt.removeCreation("br");
    expect(walkable(rt.terrain, rt.grid, span.center)).toBe(false);
    rt.step(1 / 30);
    expect(rt.terrain.waterAt(rt.player.n, 0.004)).toBe(-1);
  });

  it("restores a saved bridge over the water and re-orients it when dropped", () => {
    const duck = WATER_BODIES[1];
    const shore = near(duck.center, duck.radius * PLANET_RADIUS + 1.5, 2.0);
    const save = world(shore);
    const rt0 = new WorldRuntime(save);
    const spot = rt0.findBridgeSpot(rt0.player.n);
    save.creations = [creation("br", "bridge", spot.center, { heading: toVec3(spot.t) })];
    const rt = new WorldRuntime(save);
    const snap = rt.snapshot(save);
    const again = new WorldRuntime(snap);
    expect(angleBetween(again.creations.get("br")!.n, spot.center)).toBeLessThan(1e-5);
    expect(again.grid.getBridge("br")).toBeTruthy();
    // Carrying removes the corridor; dropping on the water puts it back.
    expect(rt.pickUp("br")).toBe(true);
    expect(rt.grid.getBridge("br")).toBeUndefined();
    expect(rt.canDrop("br", duck.center)).toBe(true);
    expect(rt.drop("br", duck.center.clone(), spot.center)).toBe(true);
    expect(rt.grid.getBridge("br")).toBeTruthy();
    expect(walkable(rt.terrain, rt.grid, duck.center)).toBe(true);
  });

  it("renders planks exactly on the simulated deck and the drawing along both sides", () => {
    const lily = WATER_BODIES[0];
    const shore = near(lily.center, lily.radius * PLANET_RADIUS + 1.5, 0.4);
    const save = world(shore);
    const spot = new WorldRuntime(world(shore)).findBridgeSpot(shore);
    save.creations = [creation("br", "bridge", spot.center, { heading: toVec3(spot.t) })];
    const rt = new WorldRuntime(save);
    const span = rt.grid.getBridge("br")!;
    // Same frame as the renderer: origin on the surface under the centre, +X along t, +Y up.
    const lateral = new Vector3().crossVectors(span.t, span.center).normalize();
    const m = new Matrix4().makeBasis(span.t, span.center, lateral);
    m.setPosition(span.center.clone().multiplyScalar(PLANET_RADIUS));
    const check = (geo: ReturnType<typeof buildBridgePlanks>, fn: (w: Vector3) => void) => {
      const pos = geo.getAttribute("position");
      const w = new Vector3();
      for (let i = 0; i < pos.count; i++) {
        w.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(m);
        expect(finite(w)).toBe(true);
        fn(w);
      }
    };
    let tops = 0;
    check(buildBridgePlanks(span), (w) => {
      const n = w.clone().normalize();
      const { along, lateral: lat } = bridgeCoords(span, n);
      expect(Math.abs(along)).toBeLessThanOrEqual(span.halfAngle * PLANET_RADIUS + 1e-3);
      expect(Math.abs(lat)).toBeLessThan(span.halfWidth + 0.15);
      const deck = bridgeDeckAt(span, along);
      expect(w.length()).toBeLessThan(deck + 1e-3);
      expect(w.length()).toBeGreaterThan(deck - 0.08);
      if (Math.abs(w.length() - deck) < 1e-3) tops++;
    });
    expect(tops).toBeGreaterThan(20);
    const meta = { width: 200, height: 100, polygons: [[[10, 10], [190, 10], [190, 90], [10, 90]] as Array<[number, number]>], anchor: [0.5, 0.9] as [number, number], aspect: 2, coverage: 0.7, palette: ["#aa5533"], roofLine: 0.4 };
    for (const side of [1, -1] as const) {
      let minR = Infinity, maxR = -Infinity;
      check(buildBridgeSide(meta, span, side), (w) => {
        const { lateral: lat } = bridgeCoords(span, w.clone().normalize());
        expect(Math.abs(Math.abs(lat) - 0.8)).toBeLessThan(0.1);
        const r = w.length() - bridgeDeckAt(span, bridgeCoords(span, w.clone().normalize()).along);
        minR = Math.min(minR, r);
        maxR = Math.max(maxR, r);
      });
      expect(minR).toBeGreaterThan(-0.6);
      expect(maxR).toBeLessThan(BRIDGE_WALL);
    }
  });

  it("finds a spot even far from any water", () => {
    const rt = new WorldRuntime(world(REGION_BY_ID.village.center.clone()));
    const spot = rt.findBridgeSpot(rt.player.n);
    expect(finite(spot.center) && finite(spot.t)).toBe(true);
    expect(rt.terrain.waterAt(spot.center)).toBeGreaterThanOrEqual(0);
  });
});

function manyCreatures(playerAt: Vector3, count: number, seed = 99): WorldSave {
  const save = world(playerAt);
  const kinds = ["fish", "duck", "cat", "dog", "dog", "person", "family", "robot", "house", "bird", "owl", "butterfly", "balloon", "tree", "flower", "frog", "rabbit", "car", "whale", "boat"];
  const rng = mulberry32(seed);
  const tmp = new Vector3();
  for (let i = 0; i < count; i++) {
    const kind = kinds[i % kinds.length];
    const water = needsWater(getKind(kind).behavior);
    const body = WATER_BODIES[i % 2];
    if (water) randomInCap(body.center, body.radius * 0.6, rng, tmp);
    else randomInCap(playerAt, 0.35, rng, tmp);
    save.creations.push(creation(`c${i}`, kind, tmp.clone()));
  }
  return save;
}

function checkHabitats(rt: WorldRuntime) {
  for (const a of rt.creations.values()) {
    expect(finite(a.pos) && finite(a.n) && finite(a.t)).toBe(true);
    expect(Math.abs(a.n.length() - 1)).toBeLessThan(1e-6);
    if (a.behavior === "swim" || a.behavior === "float") expect(rt.terrain.waterAt(a.n)).toBeGreaterThanOrEqual(0);
    if (a.behavior === "walk" || a.behavior === "drive" || a.behavior === "hop") {
      const dry = rt.terrain.waterAt(a.n, -0.01) === -1;
      expect(dry || !!rt.grid.onBridge(a.n)).toBe(true);
    }
  }
}

describe("social life", () => {
  it("keeps habitats through day, evening, night and morning with the player walking among them", () => {
    const lilyShore = near(WATER_BODIES[0].center, WATER_BODIES[0].radius * PLANET_RADIUS + 3, 0.5);
    const save = manyCreatures(lilyShore, 30);
    // A bridge for walkers to wander onto.
    const probe = new WorldRuntime(world(lilyShore));
    const spot = probe.findBridgeSpot(probe.player.n);
    save.creations.push(creation("bridge", "bridge", spot.center, { heading: toVec3(spot.t) }));
    const rt = new WorldRuntime(save);
    const notices: string[] = [];
    rt.events.on("notice", (e) => {
      expect(["happy", "shy", "curious"]).toContain(e.mood);
      notices.push(e.id);
    });
    const phases: Array<"day" | "evening" | "night"> = ["day", "evening", "night", "day"];
    const sleptIds = new Set<string>();
    for (const phase of phases) {
      setTime(phase);
      for (let f = 0; f < 30 * 40; f++) {
        // The player strolls around in circles.
        rt.input.x = Math.sin(f / 90);
        rt.input.y = 0.6;
        rt.step(1 / 30);
        if (f % 30 === 0) checkHabitats(rt);
        if (phase === "night") for (const a of rt.creations.values()) if (a.state === "sleep") sleptIds.add(a.id);
      }
      if (phase === "night") {
        const walkers = [...rt.creations.values()].filter((a) => a.behavior === "walk" || a.behavior === "hop" || a.behavior === "drive");
        const asleep = walkers.filter((a) => a.state === "sleep" || a.state === "inside");
        expect(asleep.length).toBeGreaterThan(walkers.length * 0.6);
      }
    }
    rt.input.x = rt.input.y = 0;
    expect(sleptIds.size).toBeGreaterThan(5);
    // Morning: everyone woke up.
    expect([...rt.creations.values()].filter((a) => a.state === "sleep").length).toBe(0);
    expect(notices.length).toBeGreaterThan(0);
    // Rate-limited: nobody spams notices.
    const counts = new Map<string, number>();
    for (const id of notices) counts.set(id, (counts.get(id) ?? 0) + 1);
    for (const c of counts.values()) expect(c).toBeLessThan(15);
  });

  it("a friendly creature notices the player and reacts with an emote", () => {
    const garden = REGIONS[0].center.clone();
    const save = world(garden);
    // Find a dog id with a friendly personality.
    let id = "";
    for (let i = 0; i < 50 && !id; i++) if (createMind(`dog${i}`, "dog").personality === "friendly") id = `dog${i}`;
    save.creations = [creation(id, "dog", near(garden, 2.5, 1))];
    const rt = new WorldRuntime(save);
    const notices: Array<{ id: string; mood: string; kind: string }> = [];
    rt.events.on("notice", (e) => notices.push(e));
    for (let f = 0; f < 30 * 3; f++) rt.step(1 / 30);
    expect(notices[0]).toEqual({ id, kind: "dog", mood: "happy" });
    // Re-noticing is rate limited.
    expect(notices.length).toBe(1);
    for (let f = 0; f < 30 * 30; f++) rt.step(1 / 30);
    checkHabitats(rt);
  });

  it("people visit a drawn house and pop back out; the house is then lived in", () => {
    const village = REGION_BY_ID.meadow.center.clone();
    const save = world(near(village, 12));
    const house = rtSpot(save, village);
    save.creations = [creation("home", "house", house), creation("kid", "person", near(house, 3.5, 2.2))];
    const rt = new WorldRuntime(save);
    let wasInside = false, cameOut = false;
    for (let f = 0; f < 30 * 120; f++) {
      rt.step(1 / 30);
      const kid = rt.creations.get("kid")!;
      if (kid.hidden) wasInside = true;
      else if (wasInside) cameOut = true;
      if (f % 60 === 0) checkHabitats(rt);
    }
    expect(wasInside).toBe(true);
    expect(cameOut).toBe(true);
    expect(rt.creations.get("home")!.mind!.livedIn).toBe(true);
  });

  it("birds land on trees or roofs and take off again", () => {
    const forest = REGION_BY_ID.forest.center.clone();
    const save = world(near(forest, 14));
    save.creations = ["b1", "b2", "b3"].map((id, i) => creation(id, "bird", near(forest, 2 + i, i)));
    const rt = new WorldRuntime(save);
    const perched = new Set<string>(), flewOff = new Set<string>();
    for (let f = 0; f < 30 * 150; f++) {
      rt.step(1 / 30);
      for (const a of rt.creations.values()) {
        if (a.state === "rest") perched.add(a.id);
        else if (perched.has(a.id) && a.state === "move") flewOff.add(a.id);
        expect(finite(a.pos)).toBe(true);
      }
    }
    expect(perched.size).toBeGreaterThan(0);
    expect(flewOff.size).toBeGreaterThan(0);
  });

  it("same-kind walkers play chase together, and fish school in their pond", () => {
    const meadow = REGION_BY_ID.meadow.center.clone();
    const save = world(near(meadow, 15));
    save.creations = [creation("d1", "dog", near(meadow, 1)), creation("d2", "dog", near(meadow, 2.5, 1))];
    const lake = WATER_BODIES[2];
    for (let i = 0; i < 5; i++) save.creations.push(creation(`f${i}`, "fish", near(lake.center, 1 + i * 0.8, i * 1.3)));
    const rt = new WorldRuntime(save);
    let played = false, schooled = false;
    for (let f = 0; f < 30 * 90; f++) {
      rt.step(1 / 30);
      if (rt.creations.get("d1")!.mind!.activity === "play") played = true;
      for (let i = 0; i < 5; i++) if (rt.creations.get(`f${i}`)!.steerTo) schooled = true;
      if (f % 30 === 0) checkHabitats(rt);
    }
    expect(played).toBe(true);
    expect(schooled).toBe(true);
  });

  it("evening gathering brings walkers toward the picnic blanket or a house", () => {
    const picnic = REGION_BY_ID.picnic.center.clone();
    const save = world(near(picnic, 15));
    const ids = ["w1", "w2", "w3", "w4"];
    save.creations = ids.map((id, i) => creation(id, i % 2 ? "cat" : "sheep", near(picnic, 6 + i, i * 1.5)));
    const rt = new WorldRuntime(save);
    const blanket = rt.layout.items.find((i) => i.art === "blanket")!.n;
    const before = ids.map((id) => angleBetween(rt.creations.get(id)!.n, blanket));
    setTime("evening");
    for (let f = 0; f < 30 * 40; f++) rt.step(1 / 30);
    const after = ids.map((id) => angleBetween(rt.creations.get(id)!.n, blanket));
    const closer = after.filter((a, i) => a < before[i]).length;
    expect(closer).toBeGreaterThanOrEqual(3);
    for (const a of after) expect(a * PLANET_RADIUS).toBeLessThan(5);
  });
});

/** A placement spot for a house near `n` according to the runtime's own rules. */
function rtSpot(save: WorldSave, n: Vector3): Vector3 {
  const rt = new WorldRuntime(save);
  return rt.findSpot("build", n, getKind("house").size) ?? n;
}

describe("pats and surprises", () => {
  it("new creations arrive (frozen while the paper plane flies in) and announce touchdown", () => {
    const garden = REGIONS[0].center.clone();
    const rt = new WorldRuntime(world(garden));
    const arrived: string[] = [];
    rt.events.on("arrived", (e) => arrived.push(`${e.id}:${e.kind}`));
    const spot = rt.spawnPointFor("walk", getKind("dog").size, "dog");
    const a = rt.addCreation(creation("pup", "dog", spot, { heading: toVec3(rt.spawnHeadingFor("dog", spot)) }), true);
    const start = a.n.clone();
    for (let f = 0; f < 30; f++) rt.step(1 / 30);
    expect(angleBetween(a.n, start)).toBe(0);
    for (let f = 0; f < 30 * 3; f++) rt.step(1 / 30);
    expect(a.spawn).toBe(1);
    expect(arrived).toEqual(["pup:dog"]);
    rt.reducedMotion = true;
    const b = rt.addCreation(creation("kit", "cat", near(garden, 3)), true);
    expect(b.spawnDur).toBeLessThan(a.spawnDur);
  });

  it("pat returns the kind, shows a heart and builds friendship; jumpAll keeps state sane", () => {
    const garden = REGIONS[0].center.clone();
    const save = manyCreatures(garden, 20, 7);
    const rt = new WorldRuntime(save);
    expect(rt.pat("nope")).toBeNull();
    expect(rt.pat("c2")).toBe(getKind("cat").id);
    const cat = rt.creations.get("c2")!;
    expect(cat.emote).toBe("heart");
    expect(rt.friendship.get("c2")).toBe(1);
    rt.pat("c2");
    expect(rt.friendship.get("c2")).toBe(2);
    let maxLift = 0;
    for (let round = 0; round < 6; round++) {
      rt.jumpAll();
      if (round === 2) setTime("night");
      if (round === 4) setTime("day");
      for (let f = 0; f < 45; f++) {
        rt.step(1 / 30);
        const lift = cat.pos.length() - rt.terrain.heightAt(cat.n);
        maxLift = Math.max(maxLift, lift);
      }
      for (const id of ["c0", "c3", "c5"]) rt.pat(id);
      checkHabitats(rt);
      for (const a of [...rt.ambient, ...rt.visitors]) expect(finite(a.pos)).toBe(true);
    }
    expect(maxLift).toBeGreaterThan(0.4);
    // After the jumps everything settles back down.
    for (let f = 0; f < 60; f++) rt.step(1 / 30);
    for (const a of rt.creations.values()) expect(a.bounce).toBe(1);
  });

  it("plants grow with age and sprout flowers after two days", () => {
    const day = 86_400_000;
    expect(growthScale(0, 0)).toBe(1);
    expect(growthScale(0, 3.5 * day)).toBeGreaterThan(1.2);
    expect(growthScale(0, 7 * day)).toBeCloseTo(1.6, 5);
    expect(growthScale(0, 70 * day)).toBeCloseTo(1.6, 5);
    expect(growthScale(10, 0)).toBe(1); // clock skew
    expect(sproutCount(0, day)).toBe(0);
    expect(sproutCount(0, 2 * day)).toBe(2);
    expect(sproutCount(0, 30 * day)).toBe(6);
  });

  it("personalities are deterministic per id + kind", () => {
    expect(createMind("abc", "dog").personality).toBe(createMind("abc", "dog").personality);
    const counts = { friendly: 0, shy: 0, curious: 0 };
    for (let i = 0; i < 200; i++) counts[createMind(`m${i}`, "monster").personality]++;
    expect(counts.friendly).toBeGreaterThan(30);
    expect(counts.shy).toBeGreaterThan(30);
    expect(counts.curious).toBeGreaterThan(30);
  });
});

describe("clearings and performance", () => {
  it("new buildings and easels keep a clearing from scenery", () => {
    const village = REGION_BY_ID.village.center.clone();
    const rt = new WorldRuntime(world(village));
    for (let i = 0; i < 6; i++) {
      const n = near(village, 2 + i * 1.3, i);
      const spot = rt.findSpot("build", n, getKind("house").size);
      expect(spot).not.toBeNull();
      // Nothing solid within the house footprint + clearance.
      expect(rt.grid.hit(spot!, getKind("house").size * 0.45 + 0.5)).toBeNull();
    }
    const e = rt.easelSpawnPoint();
    expect(rt.grid.hit(e.n, 1.25)).toBeNull();
  });

  it("40 creations for 5000 frames stay finite and fast", () => {
    const lilyShore = near(WATER_BODIES[0].center, WATER_BODIES[0].radius * PLANET_RADIUS + 3, 0.5);
    const rt = new WorldRuntime(manyCreatures(lilyShore, 40, 3));
    // Warm up the JIT.
    for (let f = 0; f < 200; f++) rt.step(1 / 60);
    const t0 = performance.now();
    for (let f = 0; f < 5000; f++) {
      if (f === 1500) setTime("evening");
      if (f === 2500) setTime("night");
      if (f === 3500) {
        setTime("day");
        rt.jumpAll();
      }
      rt.input.x = Math.sin(f / 200);
      rt.input.y = 0.5;
      rt.step(1 / 60);
    }
    const perStep = (performance.now() - t0) / 5000;
    checkHabitats(rt);
    expect(finite(rt.player.pos)).toBe(true);
    expect(perStep).toBeLessThan(2);
  });
});
