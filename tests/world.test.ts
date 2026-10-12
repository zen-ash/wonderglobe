// Behaviour mapping, spherical movement, scenery determinism, placement rules
// and restoring a saved world into a live simulation.

import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { KINDS, KIND_IDS, BEHAVIOR_CHOICES, getKind, needsWater, needsLand, isAirborne, speedFor, FALLBACK_KIND, KIND_GROUPS } from "@/core/kinds";
import type { Behavior, CreationRecord, EaselRecord, WorldSave } from "@/core/types";
import { moveAlong, turn, orthonormalize, toVec3, PLANET_RADIUS, angleBetween } from "@/world/sphere";
import { Terrain, REGIONS, WATER_BODIES } from "@/world/planet";
import { generateScenery } from "@/world/scenery";
import { WorldRuntime } from "@/world/runtime";

const ALL_BEHAVIORS: Behavior[] = ["walk", "hop", "fly", "flutter", "swim", "float", "drive", "grow", "build", "hover", "still"];

function emptyWorld(mode: "paper" | "gallery" = "paper", seed = 4242): WorldSave {
  return {
    version: 1,
    mode,
    seed,
    createdAt: 0,
    updatedAt: 0,
    player: { position: toVec3(REGIONS[0].center.clone()), heading: [1, 0, 0] },
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

describe("kind table → behaviour mapping", () => {
  it("has unique ids, sensible sizes and a fallback", () => {
    expect(new Set(KIND_IDS).size).toBe(KINDS.length);
    expect(KIND_IDS).toContain(FALLBACK_KIND);
    for (const k of KINDS) {
      expect(ALL_BEHAVIORS).toContain(k.behavior);
      expect(k.size).toBeGreaterThan(0.3);
      expect(k.size).toBeLessThan(5);
      if (["grow", "build", "still"].includes(k.behavior)) expect(k.speed).toBe(0);
      else expect(k.speed).toBeGreaterThan(0);
    }
  });

  it("maps familiar subjects to the right behaviours", () => {
    expect(getKind("fish").behavior).toBe("swim");
    expect(getKind("duck").behavior).toBe("float");
    expect(getKind("boat").behavior).toBe("float");
    expect(getKind("bird").behavior).toBe("fly");
    expect(getKind("butterfly").behavior).toBe("flutter");
    expect(getKind("house").behavior).toBe("build");
    expect(getKind("tree").behavior).toBe("grow");
    expect(getKind("car").behavior).toBe("drive");
    expect(getKind("cat").behavior).toBe("walk");
    expect(getKind("frog").behavior).toBe("hop");
  });

  it("falls back to a playable sculpture for unknown kinds", () => {
    expect(getKind("definitely-not-a-kind").id).toBe(FALLBACK_KIND);
  });

  it("offers a choice for every behaviour and every picker kind exists", () => {
    expect(new Set(BEHAVIOR_CHOICES.map((c) => c.behavior))).toEqual(new Set(ALL_BEHAVIORS));
    for (const g of KIND_GROUPS) for (const id of g.kinds) expect(KIND_IDS).toContain(id);
  });

  it("classifies habitats consistently", () => {
    for (const b of ALL_BEHAVIORS) {
      const count = [needsWater(b), needsLand(b), isAirborne(b)].filter(Boolean).length;
      expect(count).toBe(1);
    }
    // Imaginary creations borrow a speed for the movement the player picks.
    expect(speedFor("dragon", "swim")).toBeGreaterThan(0);
    expect(speedFor("monster", "grow")).toBe(0);
  });
});

describe("movement on the sphere", () => {
  it("keeps the frame orthonormal and returns home after a full lap", () => {
    const n = new Vector3(0.2, 0.9, 0.1).normalize();
    const t = new Vector3(1, 0, 0);
    orthonormalize(n, t);
    const start = n.clone();
    const steps = 2000;
    const lap = 2 * Math.PI * PLANET_RADIUS;
    for (let i = 0; i < steps; i++) {
      moveAlong(n, t, lap / steps);
      expect(Math.abs(n.length() - 1)).toBeLessThan(1e-9);
      expect(Math.abs(t.dot(n))).toBeLessThan(1e-9);
    }
    expect(angleBetween(n, start)).toBeLessThan(1e-6);
  });

  it("walks straight over the poles without flipping", () => {
    const n = new Vector3(0, 0, 1);
    const t = new Vector3(0, 1, 0); // heading north
    let prevT = t.clone();
    for (let i = 0; i < 400; i++) {
      moveAlong(n, t, 0.2);
      // Heading changes smoothly: never a sudden reversal.
      expect(t.dot(prevT)).toBeGreaterThan(0.99);
      prevT = t.clone();
      expect(Number.isFinite(n.x + n.y + n.z + t.x + t.y + t.z)).toBe(true);
    }
  });

  it("turning keeps the heading tangent", () => {
    const n = new Vector3(0, 1, 0);
    const t = new Vector3(1, 0, 0);
    for (let i = 0; i < 100; i++) turn(n, t, 0.37);
    expect(Math.abs(t.dot(n))).toBeLessThan(1e-9);
    expect(Math.abs(t.length() - 1)).toBeLessThan(1e-9);
  });
});

describe("planet and scenery", () => {
  it("has twelve distinct regions and water where the ponds are", () => {
    expect(REGIONS.length).toBe(12);
    expect(new Set(REGIONS.map((r) => r.name)).size).toBe(12);
    const terrain = new Terrain(1);
    for (const w of WATER_BODIES) expect(terrain.isWater(w.center)).toBe(true);
    expect(terrain.isWater(REGIONS[0].center)).toBe(false);
  });

  it("places hundreds of scenery items deterministically per seed", () => {
    const a = generateScenery(new Terrain(77), 77);
    const b = generateScenery(new Terrain(77), 77);
    const c = generateScenery(new Terrain(78), 78);
    expect(a.items.length).toBeGreaterThan(500);
    expect(a.items.map((i) => i.art + toVec3(i.n).join())).toEqual(b.items.map((i) => i.art + toVec3(i.n).join()));
    expect(a.items.map((i) => toVec3(i.n).join())).not.toEqual(c.items.map((i) => toVec3(i.n).join()));
    // Every region gets dressed.
    const regions = new Set(a.items.map((i) => i.region));
    expect(regions.size).toBe(12);
  });
});

describe("restoring a saved world", () => {
  it("rebuilds creations with their behaviours and keeps valid positions", () => {
    const save = emptyWorld();
    const pondFish = WATER_BODIES[0].center.clone();
    const garden = REGIONS[0].center.clone();
    const housePos = new Vector3().copy(garden).add(new Vector3(0.05, 0.02, 0)).normalize();
    save.creations = [creation("fish1", "fish", pondFish), creation("house1", "house", housePos), creation("bird1", "bird", garden)];
    const rt = new WorldRuntime(save);
    expect(rt.creations.size).toBe(3);
    expect(rt.creations.get("fish1")!.behavior).toBe("swim");
    expect(rt.terrain.waterAt(rt.creations.get("fish1")!.n)).toBeGreaterThanOrEqual(0);
    expect(rt.creations.get("house1")!.solid).toBe(true);
    // A saved spot that is valid is restored exactly.
    expect(angleBetween(rt.creations.get("fish1")!.n, pondFish)).toBeLessThan(1e-6);
  });

  it("repairs an invalid saved spot (a fish saved on dry land ends up in water)", () => {
    const save = emptyWorld();
    save.creations = [creation("fish2", "fish", REGIONS[0].center.clone())];
    const rt = new WorldRuntime(save);
    expect(rt.terrain.waterAt(rt.creations.get("fish2")!.n)).toBeGreaterThanOrEqual(0);
  });

  it("round-trips positions through snapshot()", () => {
    const save = emptyWorld("gallery");
    const easel: EaselRecord = {
      id: "e1",
      artworkId: "art_e1",
      title: "Sunny",
      artist: "Mia",
      story: "",
      notes: [{ id: "n1", color: "#ffe066", text: "Wow", createdAt: 0 }],
      position: toVec3(REGIONS[2].center),
      heading: [0, 0, 1],
      createdAt: 0,
    };
    save.easels = [easel];
    const rt = new WorldRuntime(save);
    const snap = rt.snapshot(save);
    const again = new WorldRuntime(snap);
    expect(angleBetween(again.easels.get("e1")!.n, rt.easels.get("e1")!.n)).toBeLessThan(1e-5);
    expect(snap.easels[0].notes).toEqual(easel.notes);
    expect(again.visitors.length).toBeGreaterThan(0);
  });

  it("enforces placement rules when dropping", () => {
    const save = emptyWorld();
    const garden = REGIONS[0].center.clone();
    save.creations = [creation("h", "house", garden), creation("f", "fish", WATER_BODIES[1].center.clone())];
    const rt = new WorldRuntime(save);
    const house = rt.creations.get("h")!;
    const before = house.n.clone();
    rt.pickUp("h");
    expect(rt.drop("h", WATER_BODIES[0].center.clone(), before)).toBe(false);
    expect(angleBetween(house.n, before)).toBeLessThan(1e-6);
    rt.pickUp("f");
    expect(rt.canDrop("f", garden)).toBe(false);
    expect(rt.canDrop("f", WATER_BODIES[2].center.clone())).toBe(true);
  });

  it("simulates without leaving habitats or producing NaN", () => {
    const save = emptyWorld();
    const kinds = ["fish", "duck", "cat", "frog", "car", "bird", "butterfly", "balloon", "tree"];
    save.creations = kinds.map((k, i) => {
      const spot = needsWater(getKind(k).behavior) ? WATER_BODIES[i % 4].center.clone() : REGIONS[(i * 5) % 12].center.clone();
      return creation(`c${i}`, k, spot);
    });
    const rt = new WorldRuntime(save);
    for (let f = 0; f < 1500; f++) rt.step(1 / 30);
    for (const a of rt.creations.values()) {
      expect(Number.isFinite(a.pos.x + a.pos.y + a.pos.z)).toBe(true);
      if (a.behavior === "swim" || a.behavior === "float") expect(rt.terrain.waterAt(a.n)).toBeGreaterThanOrEqual(0);
      if (a.behavior === "walk" || a.behavior === "drive" || a.behavior === "hop") expect(rt.terrain.waterAt(a.n, -0.01)).toBe(-1);
    }
    // Background-tab hitches are clamped.
    const p = rt.player.n.clone();
    rt.input.y = 1;
    rt.step(30);
    expect(angleBetween(p, rt.player.n) * PLANET_RADIUS).toBeLessThan(0.5);
  });
});
