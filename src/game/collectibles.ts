// Hidden treasures and golden butterflies. Placement is pure and seeded by the
// world seed, so a planet always hides its treasures in the same spots.
// Land treasures sit on walkable ground clear of scenery; the lily, the pearl
// and the bottle sit right at a water edge (reachable from the shore); the
// summit star floats above the mountain top and can only be reached by flying.

import { Vector3 } from "three";
import type { WorldMode } from "@/core/types";
import { REGIONS, REGION_BY_ID, WATER_BODIES, WATER_LEVEL, type RegionKind, type Terrain } from "@/world/planet";
import type { SceneryLayout } from "@/world/scenery";
import { angleBetween, pointAt, randomInCap, PLANET_RADIUS } from "@/world/sphere";
import { mulberry32 } from "@/world/noise";

export type TreasureKind =
  | "key"
  | "bottle"
  | "kite"
  | "shell"
  | "acorn"
  | "crown"
  | "carrot"
  | "lily"
  | "pinecone"
  | "pearl"
  | "bell"
  | "star";

export interface TreasureDef {
  id: string;
  kind: TreasureKind;
  /** Short friendly name ("a shiny key"). */
  label: string;
  region: RegionKind;
  /** Unit surface direction. */
  n: Vector3;
  /** World position of the treasure's centre. */
  pos: Vector3;
  /** Sits on the water (at the shore line). */
  onWater: boolean;
  /** Floats high up (needs flying to reach). */
  airborne: boolean;
  /** Size of the cut-out in world units. */
  size: number;
}

interface TreasureSpec {
  id: string;
  kind: TreasureKind;
  label: string;
  region: RegionKind;
  place: "land" | "waterEdge" | "shore" | "summit" | "mushroom" | "foothills";
  /** Which water body for shore items. */
  water?: string;
  size: number;
}

const SPECS: TreasureSpec[] = [
  { id: "key", kind: "key", label: "a shiny key", region: "forest", place: "mushroom", size: 0.55 },
  { id: "bottle", kind: "bottle", label: "a message in a bottle", region: "coast", place: "waterEdge", water: "sea", size: 0.6 },
  { id: "kite", kind: "kite", label: "a lost kite", region: "picnic", place: "land", size: 0.7 },
  { id: "shell", kind: "shell", label: "a shiny shell", region: "duckpond", place: "shore", water: "duckpond", size: 0.5 },
  { id: "acorn", kind: "acorn", label: "an acorn", region: "garden", place: "land", size: 0.5 },
  { id: "crown", kind: "crown", label: "a tiny paper crown", region: "village", place: "land", size: 0.55 },
  { id: "carrot", kind: "carrot", label: "a carrot", region: "farm", place: "land", size: 0.6 },
  { id: "lily", kind: "lily", label: "a lily blossom", region: "lily", place: "waterEdge", water: "lily", size: 0.6 },
  { id: "pinecone", kind: "pinecone", label: "a pine cone", region: "mountain", place: "foothills", size: 0.5 },
  { id: "pearl", kind: "pearl", label: "a pearl", region: "lake", place: "waterEdge", water: "lake", size: 0.5 },
  { id: "bell", kind: "bell", label: "a little bell", region: "cherry", place: "land", size: 0.5 },
  { id: "summit-star", kind: "star", label: "the summit star", region: "mountain", place: "summit", size: 1.2 },
];

/** Treasure ids that exist in a mode (the summit star needs a flying ride, so paper only). */
export function treasureIdsFor(mode: WorldMode): string[] {
  return SPECS.filter((s) => mode === "paper" || s.place !== "summit").map((s) => s.id);
}

export const TREASURE_LABELS: Record<string, string> = Object.fromEntries(SPECS.map((s) => [s.id, s.label]));

/** How close (world units along the ground) the player must walk to pick something up. */
export const PICKUP_RADIUS = 1.2;
/** How close a flying player must get to the summit star (3D, including height). */
export const SUMMIT_RADIUS = 2.5;
/** Treasures sparkle when the player is this close. */
export const SPARKLE_RADIUS = 6;

const _tmp = new Vector3();

function obstacleClear(layout: SceneryLayout | undefined, n: Vector3, clearance: number): boolean {
  if (!layout) return true;
  for (const it of layout.items) {
    if (it.radius <= 0) continue;
    const need = (it.radius + clearance) / PLANET_RADIUS;
    if (Math.abs(it.n.x - n.x) > need * 1.5 || Math.abs(it.n.y - n.y) > need * 1.5 || Math.abs(it.n.z - n.z) > need * 1.5) continue;
    if (angleBetween(it.n, n) < need) return false;
  }
  return true;
}

/** Dry, walkable ground well inside a region and clear of scenery. */
function goodLand(terrain: Terrain, layout: SceneryLayout | undefined, n: Vector3, region: number): boolean {
  if (terrain.waterAt(n, -0.03) >= 0) return false;
  if (terrain.isBlockedTerrain(n)) return false;
  const r = terrain.regionAt(n);
  if (r.index !== region || r.depth < 0.03) return false;
  return obstacleClear(layout, n, 0.55);
}

/** Angle from a water body's centre to its shoreline along bearing `phi`. */
function shoreAngle(terrain: Terrain, wi: number, phi: number): number {
  const w = WATER_BODIES[wi];
  let a = w.radius * 0.5;
  for (; a < w.radius * 1.6; a += 0.002) {
    pointAt(w.center, a, phi, _tmp);
    if (terrain.waterAt(_tmp) !== wi) return a;
  }
  return a;
}

/**
 * Where the treasures of a world are hidden. Deterministic for a seed.
 * Pass the scenery layout to keep treasures clear of trees, houses and rocks.
 */
export function placeTreasures(terrain: Terrain, seed: number, mode: WorldMode, layout?: SceneryLayout): TreasureDef[] {
  const ids = new Set(treasureIdsFor(mode));
  const out: TreasureDef[] = [];
  SPECS.forEach((spec, si) => {
    if (!ids.has(spec.id)) return;
    const rng = mulberry32((seed ^ 0x7ea5e5) + si * 7919);
    const region = REGIONS.findIndex((r) => r.id === spec.region);
    const center = REGION_BY_ID[spec.region].center;
    let n: Vector3 | null = null;
    let onWater = false;
    let airborne = false;

    if (spec.place === "summit") {
      n = center.clone();
      airborne = true;
    } else if (spec.place === "mushroom" && layout) {
      // Tucked beside a mushroom in the forest.
      const shrooms = layout.items.filter((it) => it.art === "mushroom" && it.region === region);
      const order = shrooms.map((m) => ({ m, k: rng() })).sort((a, b) => a.k - b.k);
      for (const { m } of order) {
        for (let k = 0; k < 8 && !n; k++) {
          pointAt(m.n, 0.62 / PLANET_RADIUS, rng() * Math.PI * 2, _tmp);
          if (terrain.waterAt(_tmp, -0.03) < 0 && !terrain.isBlockedTerrain(_tmp) && obstacleClear(layout, _tmp, 0.42)) n = _tmp.clone();
        }
        if (n) break;
      }
    } else if (spec.place === "waterEdge" || spec.place === "shore") {
      const wi = WATER_BODIES.findIndex((w) => w.id === spec.water);
      for (let k = 0; k < 60 && !n; k++) {
        const phi = rng() * Math.PI * 2;
        const a = shoreAngle(terrain, wi, phi);
        // Somewhere a child can stand right next to it.
        pointAt(WATER_BODIES[wi].center, a + 0.03, phi, _tmp);
        if (terrain.waterAt(_tmp, -0.01) >= 0 || terrain.isBlockedTerrain(_tmp) || !obstacleClear(layout, _tmp, 0.45)) continue;
        if (spec.place === "waterEdge") {
          pointAt(WATER_BODIES[wi].center, a - 0.018, phi, _tmp);
          if (terrain.waterAt(_tmp) !== wi) continue;
          onWater = true;
        } else {
          pointAt(WATER_BODIES[wi].center, a + 0.03, phi, _tmp);
        }
        n = _tmp.clone();
      }
    }

    if (!n) {
      // Plain land spot inside the region (foothills: away from the steep peak).
      const minA = spec.place === "foothills" ? 0.15 : 0.03;
      const maxA = spec.place === "foothills" ? 0.3 : 0.28;
      for (let k = 0; k < 400 && !n; k++) {
        randomInCap(center, maxA, rng, _tmp, minA);
        if (spec.place === "foothills" && terrain.sample(_tmp).ground === "snow") continue;
        if (goodLand(terrain, layout, _tmp, region)) n = _tmp.clone();
      }
      // Last resort: anywhere dry in the region.
      for (let k = 0; k < 400 && !n; k++) {
        randomInCap(center, 0.35, rng, _tmp);
        if (terrain.waterAt(_tmp, -0.02) < 0 && !terrain.isBlockedTerrain(_tmp)) n = _tmp.clone();
      }
      n ??= center.clone();
    }

    const h = terrain.heightAt(n);
    const pos = n.clone().multiplyScalar(airborne ? h + 1.6 : onWater ? Math.max(h, WATER_LEVEL) + 0.12 : h + spec.size * 0.5);
    out.push({ id: spec.id, kind: spec.kind, label: spec.label, region: spec.region, n, pos, onWater, airborne, size: spec.size });
  });
  return out;
}

/** Whether the player (world position + unit direction) is close enough to pick a treasure up. */
export function canCollect(def: Pick<TreasureDef, "n" | "pos" | "airborne">, playerPos: Vector3, playerN: Vector3): boolean {
  if (def.airborne) return playerPos.distanceTo(def.pos) < SUMMIT_RADIUS;
  if (Math.abs(playerPos.length() - def.pos.length()) > 2.5) return false;
  return angleBetween(playerN, def.n) * PLANET_RADIUS < PICKUP_RADIUS;
}

// ------------------------------------------------------------ golden butterflies

export const GOLDEN_BUTTERFLY_IDS = ["golden-1", "golden-2"] as const;

/** Land regions where butterflies like to flutter (not the start garden, not over water). */
const BUTTERFLY_REGIONS: RegionKind[] = ["village", "picnic", "meadow", "cherry", "forest", "farm"];

export interface ButterflyDef {
  id: string;
  region: RegionKind;
  center: Vector3;
  /** Angular radius of its loop (radians). */
  ring: number;
  phase: number;
  /** Radians per second around the loop. */
  speed: number;
}

/** Days since the epoch in local time – butterflies move to new places each day. */
export function dayIndex(date = new Date()): number {
  return Math.floor((date.getTime() - date.getTimezoneOffset() * 60000) / 86400000);
}

/**
 * Golden butterflies out today (pure). Each one not yet caught appears on most
 * days, in a region picked from the world seed and the day.
 */
export function goldenButterflies(seed: number, day: number, found: readonly string[] = []): ButterflyDef[] {
  const out: ButterflyDef[] = [];
  const used = new Set<RegionKind>();
  GOLDEN_BUTTERFLY_IDS.forEach((id, i) => {
    const rng = mulberry32((seed ^ 0x60f1d) + day * 131 + i * 977);
    const shows = rng() < 0.7;
    let region = BUTTERFLY_REGIONS[Math.floor(rng() * BUTTERFLY_REGIONS.length)];
    if (used.has(region)) region = BUTTERFLY_REGIONS[(BUTTERFLY_REGIONS.indexOf(region) + 1 + i) % BUTTERFLY_REGIONS.length];
    const phase = rng() * Math.PI * 2;
    const speed = 0.22 + rng() * 0.08;
    const ring = 0.07 + rng() * 0.05;
    if (!shows || found.includes(id)) return;
    used.add(region);
    out.push({ id, region, center: REGION_BY_ID[region].center.clone(), ring, phase, speed });
  });
  return out;
}

/** Where a golden butterfly is at time `t` (seconds). Writes into `out` and returns the surface direction too. */
export function butterflyPoint(def: ButterflyDef, t: number, terrain: Terrain, out: Vector3, outN?: Vector3): Vector3 {
  const a = def.phase + t * def.speed;
  // A wobbly loop (figure of eight-ish) around the region.
  const ring = def.ring * (1 + 0.35 * Math.sin(a * 2.3));
  const n = pointAt(def.center, ring, a, outN ?? new Vector3());
  const h = Math.max(terrain.heightAt(n), WATER_LEVEL);
  return out.copy(n).multiplyScalar(h + 1.0 + 0.25 * Math.sin(t * 2.7 + def.phase));
}

/** Butterflies are caught when the player walks under them. */
export function canCatchButterfly(butterflyN: Vector3, playerN: Vector3): boolean {
  return angleBetween(butterflyN, playerN) * PLANET_RADIUS < 1.5;
}
