// Seeded procedural scenery placement. The same seed always produces the
// same planet dressing, so a world looks identical every visit. Placement is
// shared by both modes; each renderer chooses how an art id looks (paper
// cut-out vs outlined 3D shape).

import { Vector3 } from "three";
import type { SceneryArtId } from "@/art/sceneryAtlas";
import { REGION_BY_ID, WATER_BODIES, type RegionKind, Terrain } from "./planet";
import { pointAt, randomInCap, angleBetween, tangentToward, PLANET_RADIUS } from "./sphere";
import { mulberry32 } from "./noise";

export type FlatArt = "lilypad" | "blanket";

export interface SceneryItem {
  art: SceneryArtId | FlatArt;
  n: Vector3;
  /** Height in world units (or diameter for flat items). */
  size: number;
  /** Collision radius in world units (0 = walk through). */
  radius: number;
  /** Rotation around the surface normal (radians). */
  yaw: number;
  /** How much it sways in the breeze (0..1). */
  sway: number;
  flat: boolean;
  /** Floats on water. */
  onWater: boolean;
  region: number;
  /**
   * Optional unit tangent the piece's front faces (houses toward their
   * plaza, benches toward the garden, fences outward along their ring).
   * When absent, renderers derive a direction from `yaw`.
   */
  facing?: Vector3;
  /** Purely decorative ground dressing (flower carpets, ferns, pebbles); always walk-through. */
  decor?: boolean;
}

export type AmbientArt = "cow" | "sheep" | "chicken" | "duck" | "sailboat" | "butterfly" | "bird";

export interface AmbientSpawn {
  art: AmbientArt;
  n: Vector3;
  behavior: "walk" | "float" | "flutter" | "fly";
  size: number;
  speed: number;
  /** Home area: wanders within this cap. */
  home: Vector3;
  homeRadius: number;
}

interface ArtSpec {
  size: [number, number];
  radius: number;
  sway: number;
}

/** Default size (min,max height) and collision radius per art. */
export const ART_SPECS: Record<SceneryArtId | FlatArt, ArtSpec> = {
  tree_round: { size: [3.0, 4.0], radius: 0.7, sway: 0.25 },
  tree_pine: { size: [3.2, 4.6], radius: 0.6, sway: 0.15 },
  tree_cherry: { size: [3.0, 3.8], radius: 0.7, sway: 0.25 },
  tree_fruit: { size: [2.8, 3.5], radius: 0.7, sway: 0.25 },
  tree_birch: { size: [3.4, 4.4], radius: 0.5, sway: 0.25 },
  palm: { size: [3.4, 4.2], radius: 0.5, sway: 0.35 },
  bush: { size: [1.0, 1.4], radius: 0.45, sway: 0.3 },
  bush_berry: { size: [1.0, 1.3], radius: 0.45, sway: 0.3 },
  flower_red: { size: [0.55, 0.8], radius: 0, sway: 1 },
  flower_yellow: { size: [0.55, 0.8], radius: 0, sway: 1 },
  flower_blue: { size: [0.55, 0.8], radius: 0, sway: 1 },
  flower_pink: { size: [0.55, 0.8], radius: 0, sway: 1 },
  flower_white: { size: [0.5, 0.7], radius: 0, sway: 1 },
  tulip: { size: [0.6, 0.85], radius: 0, sway: 1 },
  sunflower: { size: [1.3, 1.8], radius: 0.15, sway: 0.7 },
  daisy_cluster: { size: [0.45, 0.6], radius: 0, sway: 0.8 },
  mushroom: { size: [0.5, 0.8], radius: 0.15, sway: 0.1 },
  grass_tuft: { size: [0.35, 0.55], radius: 0, sway: 1 },
  reed: { size: [0.9, 1.3], radius: 0, sway: 1 },
  rock: { size: [0.5, 0.8], radius: 0.35, sway: 0 },
  boulder: { size: [1.0, 1.5], radius: 0.7, sway: 0 },
  house_red: { size: [2.6, 3.0], radius: 1.2, sway: 0 },
  house_blue: { size: [2.6, 3.0], radius: 1.2, sway: 0 },
  house_yellow: { size: [2.6, 3.0], radius: 1.2, sway: 0 },
  cottage: { size: [2.4, 2.8], radius: 1.1, sway: 0 },
  barn: { size: [3.4, 3.8], radius: 1.6, sway: 0 },
  windmill: { size: [4.2, 4.8], radius: 1.0, sway: 0 },
  well: { size: [1.3, 1.5], radius: 0.6, sway: 0 },
  fence: { size: [0.7, 0.8], radius: 0.4, sway: 0 },
  haystack: { size: [1.1, 1.4], radius: 0.6, sway: 0 },
  scarecrow: { size: [1.6, 1.9], radius: 0.3, sway: 0.3 },
  pumpkin: { size: [0.5, 0.7], radius: 0.25, sway: 0 },
  cabbage_row: { size: [0.5, 0.6], radius: 0, sway: 0.2 },
  cow: { size: [1.4, 1.6], radius: 0, sway: 0 },
  sheep: { size: [1.0, 1.2], radius: 0, sway: 0 },
  chicken: { size: [0.6, 0.7], radius: 0, sway: 0 },
  duck: { size: [0.7, 0.8], radius: 0, sway: 0 },
  picnic_blanket: { size: [0.4, 0.5], radius: 0, sway: 0 },
  picnic_basket: { size: [0.55, 0.65], radius: 0.25, sway: 0 },
  kite: { size: [2.6, 3.0], radius: 0.1, sway: 0.6 },
  lighthouse: { size: [5.0, 5.6], radius: 1.0, sway: 0 },
  beach_hut: { size: [2.0, 2.3], radius: 0.9, sway: 0 },
  shell: { size: [0.35, 0.45], radius: 0, sway: 0 },
  sailboat: { size: [1.8, 2.2], radius: 0, sway: 0 },
  lamp_post: { size: [1.9, 2.1], radius: 0.2, sway: 0 },
  signpost: { size: [1.5, 1.7], radius: 0.25, sway: 0 },
  bench: { size: [0.8, 0.9], radius: 0.45, sway: 0 },
  snow_pine: { size: [2.6, 3.6], radius: 0.55, sway: 0.1 },
  mountain_peak: { size: [3, 3], radius: 0, sway: 0 },
  cloud: { size: [2, 3], radius: 0, sway: 0 },
  butterfly: { size: [0.5, 0.6], radius: 0, sway: 0 },
  bird: { size: [0.6, 0.7], radius: 0, sway: 0 },
  visitor_a: { size: [1.3, 1.5], radius: 0, sway: 0 },
  visitor_b: { size: [1.3, 1.5], radius: 0, sway: 0 },
  visitor_c: { size: [1.3, 1.5], radius: 0, sway: 0 },
  flower_orange: { size: [0.55, 0.8], radius: 0, sway: 1 },
  flower_purple: { size: [0.55, 0.8], radius: 0, sway: 1 },
  wildflowers: { size: [0.45, 0.7], radius: 0, sway: 0.9 },
  fern: { size: [0.6, 1.0], radius: 0, sway: 0.7 },
  grass_tall: { size: [0.6, 0.95], radius: 0, sway: 1 },
  pebbles: { size: [0.22, 0.36], radius: 0, sway: 0 },
  lilypad: { size: [0.9, 1.4], radius: 0, sway: 0 },
  blanket: { size: [2.2, 2.4], radius: 0, sway: 0 },
};

export interface SceneryLayout {
  items: SceneryItem[];
  /**
   * Dense decorative dressing (flower carpets, ferns, tall grass, pebbles).
   * Walk-through only (radius 0), placed from its own random stream after
   * everything else, so `items` and `ambient` are unchanged by it. The paper
   * renderer draws it; other renderers may ignore it.
   */
  decor: SceneryItem[];
  ambient: AmbientSpawn[];
}

const FLOWERS: SceneryArtId[] = ["flower_red", "flower_yellow", "flower_blue", "flower_pink", "flower_white", "tulip"];

export function generateScenery(terrain: Terrain, seed: number): SceneryLayout {
  const rng = mulberry32(seed ^ 0x51ce17);
  const items: SceneryItem[] = [];
  const ambient: AmbientSpawn[] = [];
  const tmp = new Vector3();

  const fits = (n: Vector3, radius: number, opts: { water?: boolean; allowPath?: boolean; minGap?: number } = {}): boolean => {
    const s = terrain.sample(n);
    if (opts.water) {
      if (s.water < 0) return false;
    } else {
      if (s.water >= 0 || terrain.waterAt(n, -0.02) >= 0) return false;
      if (!opts.allowPath && s.ground === "path") return false;
      if (terrain.isBlockedTerrain(n) && radius > 0) return false;
    }
    if (radius > 0 || opts.minGap) {
      const gap = (radius + (opts.minGap ?? 0.3)) / PLANET_RADIUS;
      for (const it of items) {
        if (it.radius === 0 && !opts.minGap) continue;
        const need = gap + it.radius / PLANET_RADIUS;
        if (Math.abs(it.n.x - n.x) > need * 1.5 || Math.abs(it.n.y - n.y) > need * 1.5 || Math.abs(it.n.z - n.z) > need * 1.5) continue;
        if (angleBetween(it.n, n) < need) return false;
      }
    }
    return true;
  };

  const add = (art: SceneryArtId | FlatArt, n: Vector3, opts: { size?: number; water?: boolean; yaw?: number; flat?: boolean; facing?: Vector3 } = {}) => {
    const spec = ART_SPECS[art];
    const size = opts.size ?? spec.size[0] + rng() * (spec.size[1] - spec.size[0]);
    items.push({
      ...(opts.facing ? { facing: opts.facing.clone() } : {}),
      art,
      n: n.clone(),
      size,
      radius: spec.radius * (size / spec.size[1]),
      yaw: opts.yaw ?? rng() * Math.PI * 2,
      sway: spec.sway,
      flat: opts.flat ?? (art === "lilypad" || art === "blanket"),
      onWater: !!opts.water,
      region: terrain.regionAt(n).index,
    });
  };

  /** Scatter `count` items of art around center within [minA, maxA]. */
  const scatter = (
    arts: SceneryArtId | SceneryArtId[] | FlatArt,
    count: number,
    center: Vector3,
    maxA: number,
    minA = 0,
    opts: { water?: boolean; allowPath?: boolean; minGap?: number } = {},
  ) => {
    let placed = 0;
    for (let tries = 0; tries < count * 12 && placed < count; tries++) {
      randomInCap(center, maxA, rng, tmp, minA);
      const art = Array.isArray(arts) ? arts[Math.floor(rng() * arts.length)] : arts;
      const spec = ART_SPECS[art];
      if (!fits(tmp, spec.radius, opts)) continue;
      add(art, tmp, { water: opts.water });
      placed++;
    }
  };

  /**
   * Place a single item at polar coordinates around a center, nudging if blocked.
   * `face`: "center" turns its front toward the center, "out" lines it up along
   * the ring (front facing outward), as for fences.
   */
  const faceTmp = new Vector3();
  const placeAt = (art: SceneryArtId | FlatArt, center: Vector3, ang: number, phi: number, opts: { size?: number; yaw?: number; face?: "center" | "out" } = {}) => {
    for (let k = 0; k < 8; k++) {
      pointAt(center, ang + k * 0.01, phi + k * 0.25, tmp);
      if (fits(tmp, ART_SPECS[art].radius * 0.8, { allowPath: true, minGap: 0.05 })) {
        let facing: Vector3 | undefined;
        if (opts.face && angleBetween(tmp, center) > 1e-4) {
          tangentToward(tmp, center, faceTmp);
          if (opts.face === "out") faceTmp.negate();
          facing = faceTmp;
        }
        add(art, tmp, { size: opts.size, yaw: opts.yaw, facing });
        return;
      }
    }
  };

  const C = (id: RegionKind) => REGION_BY_ID[id].center;

  // Sunny Garden — the starting spot: flower beds, a signpost, benches.
  placeAt("signpost", C("garden"), 0.045, 0.6);
  for (let i = 0; i < 4; i++) placeAt("bench", C("garden"), 0.155, i * (Math.PI / 2) + 0.4, { face: "center" });
  for (let i = 0; i < 4; i++) placeAt("lamp_post", C("garden"), 0.115, i * (Math.PI / 2) + 0.78);
  for (let ring = 0; ring < 2; ring++) {
    const r = 0.07 + ring * 0.035;
    for (let i = 0; i < 26; i++) {
      pointAt(C("garden"), r + (rng() - 0.5) * 0.02, (i / 26) * Math.PI * 2 + rng() * 0.1, tmp);
      if (fits(tmp, 0)) add(FLOWERS[(i + ring) % FLOWERS.length], tmp);
    }
  }
  scatter(["bush", "bush_berry"], 10, C("garden"), 0.3, 0.17);
  scatter(["tree_round", "tree_fruit"], 7, C("garden"), 0.32, 0.19);
  scatter("sunflower", 6, C("garden"), 0.3, 0.17);

  // Lily Pond — lily pads on the water, reeds on the shore.
  const lily = WATER_BODIES[0];
  for (let i = 0; i < 14; i++) {
    randomInCap(lily.center, lily.radius * 0.85, rng, tmp);
    if (terrain.waterAt(tmp, 0.015) >= 0) add("lilypad", tmp, { water: true, flat: true });
  }
  for (let i = 0; i < 22; i++) {
    pointAt(lily.center, lily.radius * (1.02 + rng() * 0.12), rng() * Math.PI * 2, tmp);
    if (fits(tmp, 0)) add("reed", tmp);
  }
  scatter(FLOWERS, 18, C("lily"), 0.32, 0.2);
  scatter(["tree_birch", "tree_round"], 6, C("lily"), 0.33, 0.22);

  // Paper Village — houses around a plaza with lamp posts and a well.
  placeAt("well", C("village"), 0.0, 0);
  const houses: SceneryArtId[] = ["house_red", "house_blue", "house_yellow", "cottage"];
  for (let i = 0; i < 8; i++) {
    const phi = (i / 8) * Math.PI * 2 + Math.PI / 5;
    placeAt(houses[i % houses.length], C("village"), 0.12 + (i % 2) * 0.07, phi, { face: "center" });
  }
  for (let i = 0; i < 5; i++) placeAt("lamp_post", C("village"), 0.08, (i / 5) * Math.PI * 2 + 0.3);
  scatter(["tree_round", "tree_fruit", "bush"], 12, C("village"), 0.33, 0.2);
  scatter(FLOWERS, 20, C("village"), 0.3, 0.08);
  for (let i = 0; i < 10; i++) placeAt("fence", C("village"), 0.24, (i / 10) * Math.PI * 2, { face: "out" });

  // Flower Meadow — lots of flowers and butterflies.
  scatter([...FLOWERS, "daisy_cluster", "daisy_cluster", "tulip"], 120, C("meadow"), 0.34);
  scatter("sunflower", 10, C("meadow"), 0.3);
  scatter(["bush", "tree_round"], 5, C("meadow"), 0.34, 0.24);

  // Happy Farm — barn, windmill, crops, animals and fences.
  placeAt("barn", C("farm"), 0.04, 2.6, { face: "center" });
  placeAt("windmill", C("farm"), 0.27, 1.0);
  placeAt("scarecrow", C("farm"), 0.12, 0.6);
  for (let i = 0; i < 4; i++) placeAt("haystack", C("farm"), 0.2 + rng() * 0.05, 3.2 + i * 0.4);
  for (let i = 0; i < 24; i++) {
    pointAt(C("farm"), 0.08 + rng() * 0.15, rng() * Math.PI, tmp);
    if (fits(tmp, 0)) add(rng() < 0.7 ? "cabbage_row" : "pumpkin", tmp);
  }
  for (let i = 0; i < 16; i++) placeAt("fence", C("farm"), 0.29, (i / 16) * Math.PI * 2, { face: "out" });
  scatter(["tree_fruit"], 5, C("farm"), 0.34, 0.27);

  // Whispering Forest — dense trees, mushrooms.
  scatter(["tree_pine", "tree_pine", "tree_round", "tree_birch"], 60, C("forest"), 0.36, 0.03, { minGap: 0.4 });
  scatter("mushroom", 18, C("forest"), 0.33);
  scatter(["bush", "bush_berry"], 14, C("forest"), 0.35);
  scatter("rock", 6, C("forest"), 0.33);

  // Cherry Grove — blossom trees and benches.
  scatter("tree_cherry", 18, C("cherry"), 0.33, 0.04, { minGap: 0.6 });
  scatter(["flower_pink", "flower_white", "tulip"], 30, C("cherry"), 0.33);
  for (let i = 0; i < 3; i++) placeAt("bench", C("cherry"), 0.1, i * 2.1, { face: "center" });

  // Picnic Hill — a blanket, a basket and a kite on the hilltop.
  placeAt("blanket", C("picnic"), 0.02, 0, { yaw: 0.4 });
  placeAt("picnic_basket", C("picnic"), 0.055, 1.2);
  placeAt("kite", C("picnic"), 0.09, 2.6);
  scatter(FLOWERS, 30, C("picnic"), 0.33, 0.07);
  scatter(["tree_round", "tree_fruit"], 8, C("picnic"), 0.34, 0.2);

  // Duck Pond — reeds, benches, and a family of ducks.
  const dp = WATER_BODIES[1];
  for (let i = 0; i < 18; i++) {
    pointAt(dp.center, dp.radius * (1.03 + rng() * 0.12), rng() * Math.PI * 2, tmp);
    if (fits(tmp, 0)) add("reed", tmp);
  }
  for (let i = 0; i < 2; i++) placeAt("bench", dp.center, dp.radius + 0.06, 0.5 + i * 2, { face: "center" });
  scatter(["tree_round", "tree_birch", "bush"], 10, C("duckpond"), 0.34, 0.22);
  scatter(FLOWERS, 16, C("duckpond"), 0.33, 0.2);

  // Snowcap Mountain — snowy pines and boulders on the slopes.
  scatter("snow_pine", 20, C("mountain"), 0.33, 0.12, { minGap: 0.3 });
  scatter(["boulder", "rock"], 16, C("mountain"), 0.33, 0.1);

  // Big Blue Lake — shore trees, rocks, reeds.
  const lake = WATER_BODIES[2];
  scatter(["tree_round", "tree_pine", "tree_birch"], 14, C("lake"), 0.36, lake.radius + 0.08);
  scatter("reed", 20, C("lake"), lake.radius + 0.1, lake.radius - 0.01);
  scatter("rock", 8, C("lake"), 0.36, lake.radius + 0.04);

  // Quiet Coast — lighthouse, beach huts, palms and shells.
  const sea = WATER_BODIES[3];
  placeAt("lighthouse", sea.center, sea.radius + 0.07, 0.3);
  for (let i = 0; i < 3; i++) placeAt("beach_hut", sea.center, sea.radius + 0.08, 1.6 + i * 0.35, { face: "center" });
  scatter("palm", 8, sea.center, sea.radius + 0.14, sea.radius + 0.03);
  scatter("shell", 14, sea.center, sea.radius + 0.07, sea.radius + 0.01);

  // A light sprinkle of grass tufts and flowers everywhere else.
  for (let i = 0; i < 420; i++) {
    randomInCap(new Vector3(0, 1, 0), Math.PI, rng, tmp);
    if (!fits(tmp, 0)) continue;
    const s = terrain.sample(tmp);
    if (s.ground !== "grass") continue;
    add(rng() < 0.65 ? "grass_tuft" : FLOWERS[Math.floor(rng() * FLOWERS.length)], tmp);
  }
  // A few wandering bushes and trees along region borders to tie things together.
  for (let i = 0; i < 40; i++) {
    randomInCap(new Vector3(0, 1, 0), Math.PI, rng, tmp);
    const r = terrain.regionAt(tmp);
    if (r.depth > 0.05) continue;
    const art: SceneryArtId = rng() < 0.5 ? "bush" : "tree_round";
    if (fits(tmp, ART_SPECS[art].radius)) add(art, tmp);
  }

  // Ambient creatures: farm animals, ducks, boats, butterflies and birds.
  const spawn = (art: AmbientArt, behavior: AmbientSpawn["behavior"], home: Vector3, homeRadius: number, count: number, speed: number, water = false) => {
    let made = 0;
    for (let tries = 0; tries < count * 20 && made < count; tries++) {
      randomInCap(home, homeRadius * 0.8, rng, tmp);
      const s = terrain.sample(tmp);
      if (water ? s.water < 0 || terrain.waterAt(tmp, 0.03) < 0 : behavior === "walk" && (s.water >= 0 || terrain.isBlockedTerrain(tmp))) continue;
      const spec = ART_SPECS[art];
      ambient.push({ art, n: tmp.clone(), behavior, size: spec.size[0] + rng() * (spec.size[1] - spec.size[0]), speed, home: home.clone(), homeRadius });
      made++;
    }
  };
  spawn("cow", "walk", C("farm"), 0.26, 3, 0.6);
  spawn("sheep", "walk", C("farm"), 0.26, 4, 0.7);
  spawn("chicken", "walk", C("farm"), 0.18, 4, 1.0);
  spawn("duck", "float", dp.center, dp.radius, 5, 0.6, true);
  spawn("duck", "float", lily.center, lily.radius, 2, 0.5, true);
  spawn("sailboat", "float", lake.center, lake.radius, 2, 0.8, true);
  spawn("sailboat", "float", sea.center, sea.radius, 2, 0.9, true);
  spawn("butterfly", "flutter", C("meadow"), 0.3, 8, 1.0);
  spawn("butterfly", "flutter", C("garden"), 0.25, 4, 1.0);
  spawn("butterfly", "flutter", C("cherry"), 0.25, 3, 1.0);
  spawn("bird", "fly", C("forest"), 0.5, 4, 2.6);
  spawn("bird", "fly", C("lake"), 0.5, 3, 2.6);
  spawn("bird", "fly", C("village"), 0.5, 2, 2.6);

  const decor = generateDecor(terrain, seed, items);
  return { items, decor, ambient };
}

// ------------------------------------------------------------------ decor

/** Flowers used in carpets, by mood. */
const CARPET_SETS: SceneryArtId[][] = [
  ["flower_red", "flower_orange", "flower_yellow"],
  ["flower_pink", "flower_purple", "flower_white"],
  ["flower_blue", "flower_purple", "flower_white"],
  ["wildflowers", "daisy_cluster", "flower_yellow"],
  ["tulip", "flower_red", "flower_pink"],
  ["flower_orange", "wildflowers", "flower_yellow"],
];

/**
 * Dense ground dressing for the paper world: flower carpets in the meadow,
 * garden beds, cherry grove, picnic hill and around the ponds; ferns, tall
 * grass and pebbles in the forest and along the lake. Uses its own seeded
 * stream so the main layout is untouched. Walk-through (radius 0).
 */
export function generateDecor(terrain: Terrain, seed: number, items: SceneryItem[]): SceneryItem[] {
  const rng = mulberry32((seed ^ 0x0decf10e) >>> 0);
  const out: SceneryItem[] = [];
  const tmp = new Vector3();
  const patchC = new Vector3();
  const solid = items.filter((it) => it.radius > 0);

  const clear = (n: Vector3): boolean => {
    const s = terrain.sample(n);
    if (s.water >= 0 || terrain.waterAt(n, -0.02) >= 0 || s.ground === "path") return false;
    for (const it of solid) {
      const need = (it.radius + 0.12) / PLANET_RADIUS;
      if (Math.abs(it.n.x - n.x) > need * 1.5 || Math.abs(it.n.y - n.y) > need * 1.5 || Math.abs(it.n.z - n.z) > need * 1.5) continue;
      if (angleBetween(it.n, n) < need) return false;
    }
    return true;
  };
  const put = (art: SceneryArtId, n: Vector3, scale = 1) => {
    const spec = ART_SPECS[art];
    const size = (spec.size[0] + rng() * (spec.size[1] - spec.size[0])) * scale;
    out.push({ art, n: n.clone(), size, radius: 0, yaw: rng() * Math.PI * 2, sway: spec.sway, flat: false, onWater: false, region: terrain.regionAt(n).index, decor: true });
  };
  /** A carpet: `patches` clumps of `per` flowers, each clump in a small cap. */
  const carpets = (center: Vector3, maxA: number, minA: number, patches: number, per: number, sets: SceneryArtId[][] = CARPET_SETS) => {
    for (let p = 0; p < patches; p++) {
      randomInCap(center, maxA, rng, patchC, minA);
      const set = sets[Math.floor(rng() * sets.length)];
      const spread = (0.7 + rng() * 0.6) / PLANET_RADIUS;
      for (let i = 0; i < per; i++) {
        randomInCap(patchC, spread, rng, tmp);
        if (!clear(tmp)) continue;
        // Mostly the bed's main flower, sprinkled with its partners.
        const r = rng();
        put(r < 0.55 ? set[0] : r < 0.82 ? set[1] : set[2], tmp, 0.85 + rng() * 0.25);
      }
    }
  };
  /** Loose scatter of one or more arts. */
  const scatter = (arts: SceneryArtId[], count: number, center: Vector3, maxA: number, minA = 0) => {
    let placed = 0;
    for (let tries = 0; tries < count * 6 && placed < count; tries++) {
      randomInCap(center, maxA, rng, tmp, minA);
      if (!clear(tmp)) continue;
      put(arts[Math.floor(rng() * arts.length)], tmp);
      placed++;
    }
  };
  /** A ring of dressing around a pond's shore. */
  const shore = (body: { center: Vector3; radius: number }, count: number, arts: SceneryArtId[], from = 1.04, to = 1.22) => {
    for (let i = 0; i < count; i++) {
      pointAt(body.center, body.radius * (from + rng() * (to - from)), rng() * Math.PI * 2, tmp);
      if (clear(tmp)) put(arts[Math.floor(rng() * arts.length)], tmp);
    }
  };
  const C = (id: RegionKind) => REGION_BY_ID[id].center;
  const [lily, duck, lake] = [WATER_BODIES[0], WATER_BODIES[1], WATER_BODIES[2]];

  // Flower Meadow: a sea of flower beds with tall grass between them.
  carpets(C("meadow"), 0.33, 0, 10, 11);
  scatter(["grass_tall", "wildflowers"], 12, C("meadow"), 0.34);
  // Sunny Garden: tidy beds of tulips and roses.
  carpets(C("garden"), 0.3, 0.06, 5, 8, [CARPET_SETS[4], CARPET_SETS[0], CARPET_SETS[1]]);
  // Cherry Grove: pink and white under the blossom.
  carpets(C("cherry"), 0.32, 0.03, 5, 8, [CARPET_SETS[1], ["flower_pink", "flower_white", "daisy_cluster"]]);
  // Picnic Hill: wildflowers and daisies.
  carpets(C("picnic"), 0.33, 0.06, 5, 8, [CARPET_SETS[3], CARPET_SETS[5], CARPET_SETS[2]]);
  // Around the ponds: ferns, tall grass and little blue/purple beds.
  shore(lily, 20, ["fern", "grass_tall", "flower_blue", "flower_purple", "wildflowers"]);
  shore(duck, 16, ["fern", "grass_tall", "flower_yellow", "wildflowers"]);
  carpets(C("lily"), 0.32, 0.16, 3, 8, [CARPET_SETS[2]]);
  carpets(C("duckpond"), 0.32, 0.16, 3, 8, [CARPET_SETS[3]]);
  // Paper Village: window-box beds near the houses.
  carpets(C("village"), 0.26, 0.07, 3, 7, [CARPET_SETS[0], CARPET_SETS[4]]);
  // Whispering Forest: ferns, tall grass and pebbles on the forest floor.
  scatter(["fern", "fern", "grass_tall"], 40, C("forest"), 0.36, 0.02);
  scatter(["pebbles"], 10, C("forest"), 0.34);
  // Big Blue Lake: shore grasses, ferns and pebbles.
  shore(lake, 30, ["grass_tall", "grass_tall", "fern", "pebbles", "wildflowers"], 1.02, 1.3);
  // Happy Farm: wildflowers along the field edges.
  scatter(["wildflowers", "grass_tall"], 12, C("farm"), 0.34, 0.24);
  // Snowcap Mountain foothills: a few pebbles and ferns low down.
  scatter(["pebbles", "fern"], 6, C("mountain"), 0.34, 0.22);
  // A sprinkle of tall grass and wildflowers everywhere green.
  for (let i = 0; i < 30; i++) {
    randomInCap(new Vector3(0, 1, 0), Math.PI, rng, tmp);
    if (terrain.sample(tmp).ground !== "grass" || !clear(tmp)) continue;
    const r = rng();
    put(r < 0.5 ? "grass_tall" : r < 0.8 ? "wildflowers" : r < 0.9 ? "flower_orange" : "flower_purple", tmp);
  }
  return out;
}
