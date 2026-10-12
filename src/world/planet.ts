// The planet: twelve regions laid out on the vertices of an icosahedron (so
// they are evenly spread over the sphere), water bodies, a mountain, a hill,
// and a height/ground function used by both simulation and rendering.

import { Vector3 } from "three";
import type { GroundType } from "@/core/types";
import { PLANET_RADIUS, angleBetween } from "./sphere";
import { fbm3, smoothstep, clamp, lerp } from "./noise";

export type RegionKind =
  | "garden"
  | "lily"
  | "village"
  | "meadow"
  | "farm"
  | "forest"
  | "cherry"
  | "picnic"
  | "duckpond"
  | "mountain"
  | "lake"
  | "coast";

export interface RegionDef {
  id: RegionKind;
  name: string;
  emoji: string;
  center: Vector3;
  grass: [number, number, number];
}

const PHI = (1 + Math.sqrt(5)) / 2;
const ico = (x: number, y: number, z: number) => new Vector3(x, y, z).normalize();

const hex = (h: string): [number, number, number] => {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

export const REGIONS: RegionDef[] = [
  { id: "garden", name: "Sunny Garden", emoji: "🌼", center: ico(0, 1, PHI), grass: hex("#93d46c") },
  { id: "lily", name: "Lily Pond", emoji: "🪷", center: ico(0, -1, PHI), grass: hex("#8ccd78") },
  { id: "village", name: "Paper Village", emoji: "🏘️", center: ico(1, PHI, 0), grass: hex("#9bd27a") },
  { id: "picnic", name: "Picnic Hill", emoji: "🧺", center: ico(-1, PHI, 0), grass: hex("#a2d872") },
  { id: "meadow", name: "Flower Meadow", emoji: "🌷", center: ico(PHI, 0, 1), grass: hex("#a8dc78") },
  { id: "cherry", name: "Cherry Grove", emoji: "🌸", center: ico(-PHI, 0, 1), grass: hex("#a3d68e") },
  { id: "forest", name: "Whispering Forest", emoji: "🌲", center: ico(0, 1, -PHI), grass: hex("#6fb35a") },
  { id: "farm", name: "Happy Farm", emoji: "🚜", center: ico(PHI, 0, -1), grass: hex("#b0d365") },
  { id: "duckpond", name: "Duck Pond", emoji: "🦆", center: ico(1, -PHI, 0), grass: hex("#94d170") },
  { id: "coast", name: "Quiet Coast", emoji: "⛵", center: ico(-1, -PHI, 0), grass: hex("#9fd07d") },
  { id: "mountain", name: "Snowcap Mountain", emoji: "🏔️", center: ico(-PHI, 0, -1), grass: hex("#8cc06a") },
  { id: "lake", name: "Big Blue Lake", emoji: "💧", center: ico(0, -1, -PHI), grass: hex("#8fcc70") },
];

export const REGION_BY_ID = Object.fromEntries(REGIONS.map((r) => [r.id, r])) as Record<RegionKind, RegionDef>;

export interface WaterBody {
  id: string;
  region: RegionKind;
  center: Vector3;
  /** Angular radius (radians). */
  radius: number;
  depth: number;
  sandy: boolean;
}

/** Water level (absolute radius). Terrain below this is under water. */
export const WATER_LEVEL = PLANET_RADIUS - 0.06;

export const WATER_BODIES: WaterBody[] = [
  { id: "lily", region: "lily", center: REGION_BY_ID.lily.center.clone(), radius: 0.15, depth: 0.7, sandy: false },
  { id: "duckpond", region: "duckpond", center: REGION_BY_ID.duckpond.center.clone(), radius: 0.16, depth: 0.7, sandy: false },
  { id: "lake", region: "lake", center: REGION_BY_ID.lake.center.clone(), radius: 0.3, depth: 1.1, sandy: true },
  { id: "sea", region: "coast", center: REGION_BY_ID.coast.center.clone(), radius: 0.34, depth: 1.3, sandy: true },
];

const MOUNTAIN = REGION_BY_ID.mountain.center;
const HILL = REGION_BY_ID.picnic.center;

export interface TerrainSample {
  /** Absolute radius of the ground surface. */
  height: number;
  ground: GroundType;
  region: number;
  /** How "deep" inside its region the point is (0 at the border). */
  regionDepth: number;
  /** Water body index if under water, else -1. */
  water: number;
  color: [number, number, number];
}

const SAND = hex("#f2dc9b");
const PATH = hex("#e8cc98");
const SOIL = hex("#c08a5c");
const ROCK = hex("#b3a79c");
const SNOW = hex("#fdfbf4");
const BED = hex("#5fb0b7");

export class Terrain {
  readonly seed: number;
  constructor(seed: number) {
    this.seed = seed;
  }

  /** Nearest region index and depth (difference to second-nearest dot). */
  regionAt(n: Vector3): { index: number; depth: number; second: number } {
    let best = -1, bestDot = -2, second = -1, secondDot = -2;
    for (let i = 0; i < REGIONS.length; i++) {
      const d = REGIONS[i].center.dot(n);
      if (d > bestDot) {
        second = best; secondDot = bestDot;
        best = i; bestDot = d;
      } else if (d > secondDot) {
        second = i; secondDot = d;
      }
    }
    return { index: best, depth: bestDot - secondDot, second };
  }

  /** Effective (wobbly) radius of a water body in direction n. */
  private waterRadius(w: WaterBody, n: Vector3): number {
    const wob = fbm3(n.x * 4.1 + 7, n.y * 4.1, n.z * 4.1, this.seed + 17, 2);
    return w.radius * (1 + 0.16 * wob);
  }

  /** Index of the water body containing n (by shoreline), or -1. */
  waterAt(n: Vector3, margin = 0): number {
    for (let i = 0; i < WATER_BODIES.length; i++) {
      const w = WATER_BODIES[i];
      const a = angleBetween(n, w.center);
      if (a < w.radius * 1.3 && a < this.waterRadius(w, n) - margin) return i;
    }
    return -1;
  }

  sample(n: Vector3): TerrainSample {
    const { index, depth, second } = this.regionAt(n);
    const region = REGIONS[index];
    const s = this.seed;
    // Gentle rolling ground that always stays above water level.
    let h = PLANET_RADIUS + 0.22 + 0.16 * fbm3(n.x * 2.3, n.y * 2.3, n.z * 2.3, s, 3) + 0.06 * fbm3(n.x * 7, n.y * 7, n.z * 7, s + 3, 2);
    let ground: GroundType = "grass";

    // Grass colour blends softly between neighbouring regions.
    const blend = 0.5 * (1 - smoothstep(0, 0.06, depth));
    const g2 = REGIONS[second].grass;
    const tint = 0.06 * fbm3(n.x * 9, n.y * 9, n.z * 9, s + 9, 2);
    let color: [number, number, number] = [
      lerp(region.grass[0], g2[0], blend) + tint,
      lerp(region.grass[1], g2[1], blend) + tint,
      lerp(region.grass[2], g2[2], blend) + tint * 0.5,
    ];

    // Mountain with rock and snow.
    const am = angleBetween(n, MOUNTAIN);
    if (am < 0.5) {
      const bump = 4.6 * Math.exp(-((am / 0.17) ** 2)) + 0.5 * Math.exp(-((am / 0.3) ** 2));
      const rough = 0.35 * fbm3(n.x * 12, n.y * 12, n.z * 12, s + 5, 2) * smoothstep(0.3, 0.05, am);
      h += bump + rough;
      if (bump > 3.3) {
        ground = "snow";
        color = [...SNOW];
      } else if (bump > 1.5) {
        ground = "rock";
        color = mix3(ROCK, color, smoothstep(1.9, 1.5, bump));
      }
    }

    // Picnic hill.
    const ah = angleBetween(n, HILL);
    if (ah < 0.45) h += 1.5 * Math.exp(-((ah / 0.2) ** 2));

    // Water bodies carve the ground; sandy shores around lake and sea.
    let water = -1;
    for (let i = 0; i < WATER_BODIES.length; i++) {
      const w = WATER_BODIES[i];
      const a = angleBetween(n, w.center);
      if (a > w.radius * 1.6) continue;
      const r = this.waterRadius(w, n);
      if (w.sandy && a < r + 0.07 && a >= r - 0.01) {
        const k = smoothstep(r + 0.07, r + 0.02, a);
        color = mix3(color, SAND, k);
        if (k > 0.5) ground = "sand";
      }
      if (a < r + 0.02) {
        // Shore slope: from ground level down to the bed.
        const k = smoothstep(r + 0.02, r - 0.05, a);
        h = lerp(h, WATER_LEVEL - w.depth, k);
        if (a < r) {
          water = i;
          ground = "water";
          color = mix3(w.sandy ? SAND : color, BED, smoothstep(r, r - 0.04, a));
        }
      }
    }

    if (water < 0 && ground === "grass") {
      // Paths and plots that make regions recognisable from above.
      if (region.id === "village") {
        const a = angleBetween(n, region.center);
        if (a < 0.07 || this.onSpokes(n, region.center, 5, 0.018, 0.3)) {
          ground = "path";
          color = mix3(color, PATH, 0.9);
        }
      } else if (region.id === "garden") {
        const a = angleBetween(n, region.center);
        if (Math.abs(a - 0.13) < 0.016 || a < 0.035 || this.onSpokes(n, region.center, 4, 0.014, 0.13)) {
          ground = "path";
          color = mix3(color, PATH, 0.85);
        }
      } else if (region.id === "farm") {
        const a = angleBetween(n, region.center);
        if (a > 0.06 && a < 0.24) {
          const stripe = Math.sin(this.localCoord(n, region.center)[0] * PLANET_RADIUS * 2.2);
          const plot = this.localCoord(n, region.center)[1] > -0.02;
          if (plot && stripe > 0.1) color = mix3(color, SOIL, 0.75);
        }
      }
    }

    // Keep colours in range.
    color = [clamp(color[0], 0, 1), clamp(color[1], 0, 1), clamp(color[2], 0, 1)];
    return { height: h, ground, region: index, regionDepth: depth, water, color };
  }

  /** Coordinates in a fixed tangent frame around `center` (radians, approx). */
  localCoord(n: Vector3, center: Vector3): [number, number] {
    const t = new Vector3(0, 1, 0).addScaledVector(center, -center.y);
    if (t.lengthSq() < 1e-6) t.set(1, 0, 0).addScaledVector(center, -center.x);
    t.normalize();
    const b = new Vector3().crossVectors(center, t);
    return [n.dot(t), n.dot(b)];
  }

  private onSpokes(n: Vector3, center: Vector3, count: number, width: number, maxAngle: number): boolean {
    const a = angleBetween(n, center);
    if (a > maxAngle || a < 0.01) return false;
    const [x, y] = this.localCoord(n, center);
    const bearing = Math.atan2(y, x);
    const step = (Math.PI * 2) / count;
    const rel = ((bearing % step) + step) % step;
    const off = Math.min(rel, step - rel) * Math.sin(a);
    return off < width;
  }

  /** Absolute radius of the ground (cheap path). */
  heightAt(n: Vector3): number {
    return this.sample(n).height;
  }

  /** World position on the ground (or water surface when floating). */
  surfacePoint(n: Vector3, out: Vector3, onWater = false): Vector3 {
    const h = this.heightAt(n);
    return out.copy(n).multiplyScalar(onWater ? Math.max(h, WATER_LEVEL) : h);
  }

  isWater(n: Vector3): boolean {
    return this.waterAt(n) >= 0;
  }

  /** Too steep/high to walk (mountain core). */
  isBlockedTerrain(n: Vector3): boolean {
    return angleBetween(n, MOUNTAIN) < 0.1;
  }

  regionName(index: number): string {
    return REGIONS[index]?.name ?? "";
  }
}

function mix3(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}
