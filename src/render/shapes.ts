// Simple outlined 3D shapes for the Miniature Gallery World. Scenery art ids
// map to small recipes of primitive parts; parts are drawn with instancing,
// one batch (plus an outline batch) per primitive.

import * as THREE from "three";
import type { SceneryArtId } from "@/art/sceneryAtlas";
import type { FlatArt, AmbientArt } from "@/world/scenery";
import { createOutlineMaterial, getToonGradient, applyShapeEffects, GLOW_COLORS } from "./materials";
import type { Season } from "@/world/environment";

export type Prim = "sphere" | "cyl" | "cone" | "box" | "roof" | "rock";

export interface Part {
  prim: Prim;
  color: string;
  /** Position in units of item height (y up, z toward the item's front). */
  p: [number, number, number];
  /** Scale in units of item height. */
  s: [number, number, number];
  /** Optional rotation (radians, XYZ). */
  r?: [number, number, number];
}

// ------------------------------------------------------------ hand-cut look
// Every primitive is low-poly and faceted, like shapes cut and folded from
// card: flat facets, a small deterministic wobble of the corners (keyed on the
// rounded position, so coincident vertices move together and surfaces stay
// closed) and a slightly different brightness per facet (`aFacet`). The ink
// outline uses a twin geometry with the same corners but smooth normals, so
// the inverted hull stays unbroken around the folds.

/** Integer hash → 0..1 (deterministic). */
function hash3(x: number, y: number, z: number, seed: number): number {
  let h = Math.imul(x | 0, 0x8da6b343) ^ Math.imul(y | 0, 0xd8163841) ^ Math.imul(z | 0, 0xcb1ab31f) ^ Math.imul(seed | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

export interface HandCutGeometry {
  /** Flat-shaded faces with an `aFacet` brightness attribute. */
  fill: THREE.BufferGeometry;
  /** Same corners, smooth normals (for the ink outline). */
  hull: THREE.BufferGeometry;
}

/**
 * Give a geometry the hand-cut look: jitter corners by up to `amp` (object
 * units, scaled per axis by `axes`), flat facets, per-facet brightness.
 */
export function handCut(source: THREE.BufferGeometry, amp: number, seed = 1, axes: [number, number, number] = [1, 1, 1], shade = 0.12): HandCutGeometry {
  const g = source.index ? source.toNonIndexed() : source.clone();
  for (const name of Object.keys(g.attributes)) if (name !== "position") g.deleteAttribute(name);
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const count = pos.count;
  const keys = new Array<string>(count);
  for (let i = 0; i < count; i++) {
    const ix = Math.round(pos.getX(i) * 1000), iy = Math.round(pos.getY(i) * 1000), iz = Math.round(pos.getZ(i) * 1000);
    keys[i] = `${ix},${iy},${iz}`;
    if (amp > 0) {
      pos.setXYZ(
        i,
        pos.getX(i) + (hash3(ix, iy, iz, seed) - 0.5) * 2 * amp * axes[0],
        pos.getY(i) + (hash3(iy, iz, ix, seed + 7) - 0.5) * 2 * amp * axes[1],
        pos.getZ(i) + (hash3(iz, ix, iy, seed + 13) - 0.5) * 2 * amp * axes[2],
      );
    }
  }
  const fill = g;
  fill.computeVertexNormals(); // non-indexed → one normal per facet
  const facet = new Float32Array(count);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i + 2 < count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    const m = a.add(b).add(c).multiplyScalar(1000 / 3);
    const v = 1 - shade * 0.6 + hash3(Math.round(m.x), Math.round(m.y), Math.round(m.z), seed + 29) * shade;
    facet[i] = facet[i + 1] = facet[i + 2] = v;
  }
  fill.setAttribute("aFacet", new THREE.BufferAttribute(facet, 1));
  fill.computeBoundingSphere();

  // Outline twin: average the facet normals of coincident corners.
  const hull = new THREE.BufferGeometry();
  hull.setAttribute("position", pos.clone());
  const fn = fill.getAttribute("normal") as THREE.BufferAttribute;
  const sum = new Map<string, THREE.Vector3>();
  for (let i = 0; i < count; i++) {
    let v = sum.get(keys[i]);
    if (!v) sum.set(keys[i], (v = new THREE.Vector3()));
    v.x += fn.getX(i);
    v.y += fn.getY(i);
    v.z += fn.getZ(i);
  }
  const hn = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const v = sum.get(keys[i])!;
    const l = v.length() || 1;
    hn[i * 3] = v.x / l;
    hn[i * 3 + 1] = v.y / l;
    hn[i * 3 + 2] = v.z / l;
  }
  hull.setAttribute("normal", new THREE.BufferAttribute(hn, 3));
  hull.computeBoundingSphere();
  return { fill, hull };
}

let geometries: Record<Prim, HandCutGeometry> | null = null;

function buildPrims(): Record<Prim, HandCutGeometry> {
  // Triangular prism along X with its ridge pointing up, fitting a unit cube.
  const roof = new THREE.CylinderGeometry(1, 1, 1, 3, 1);
  roof.rotateZ(Math.PI / 2);
  roof.rotateX(-Math.PI / 2);
  roof.translate(0, -0.25, 0);
  roof.scale(1, 1 / 1.5, 1 / Math.sqrt(3));
  return {
    // Faceted icosahedron foliage (lower-poly than before).
    sphere: handCut(new THREE.IcosahedronGeometry(1, 1), 0.075, 11),
    cyl: handCut(new THREE.CylinderGeometry(1, 1, 1, 7), 0.05, 12, [1, 0.4, 1]),
    cone: handCut(new THREE.ConeGeometry(1, 1, 7), 0.055, 13, [1, 0.5, 1]),
    // Boxes stay crisp (windows and doors sit right on the walls).
    box: handCut(new THREE.BoxGeometry(1, 1, 1), 0.012, 14, [1, 1, 0.4], 0.08),
    roof: handCut(roof, 0.02, 15, [1, 1, 0.5], 0.1),
    rock: handCut(new THREE.DodecahedronGeometry(1, 0), 0.08, 16, [1, 1, 1], 0.16),
  };
}

/** The hand-cut (flat-shaded) geometry of a primitive. */
export function primGeometry(prim: Prim): THREE.BufferGeometry {
  if (!geometries) geometries = buildPrims();
  return geometries[prim].fill;
}

/** The smooth-normal twin of a primitive (for ink outlines). */
export function primHullGeometry(prim: Prim): THREE.BufferGeometry {
  if (!geometries) geometries = buildPrims();
  return geometries[prim].hull;
}

/**
 * Toon material for hand-cut shapes: the gallery shape effects (see-through,
 * snow, glowing windows) plus per-facet brightness from `aFacet`. Instance
 * colours stay exact, so windows and lamps are still recognised at night.
 */
export function createHandCutMaterial(): THREE.MeshToonMaterial {
  const mat = applyShapeEffects(new THREE.MeshToonMaterial({ color: "#ffffff", gradientMap: getToonGradient() }));
  const inner = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    inner.call(mat, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aFacet;\nvarying float vFacet;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvFacet = aFacet;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vFacet;")
      .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb *= vFacet;");
  };
  mat.customProgramCacheKey = () => "wonderglobe-shape-handcut";
  return mat;
}

const TRUNK = "#9a6a45";
const LEAF = "#5fb85a";
const LEAF2 = "#7fcc5d";

const flower = (color: string): Part[] => [
  { prim: "cyl", color: "#4f9e47", p: [0, 0.35, 0], s: [0.035, 0.7, 0.035] },
  { prim: "sphere", color, p: [0, 0.78, 0], s: [0.18, 0.14, 0.18] },
  { prim: "sphere", color: "#ffd84a", p: [0, 0.8, 0.08], s: [0.07, 0.07, 0.07] },
];

const house = (wall: string, roof: string): Part[] => [
  { prim: "box", color: wall, p: [0, 0.28, 0], s: [0.8, 0.56, 0.62] },
  { prim: "roof", color: roof, p: [0, 0.68, 0], s: [0.9, 0.5, 0.78] },
  { prim: "box", color: "#8a5a3c", p: [0, 0.14, 0.31], s: [0.16, 0.28, 0.03] },
  { prim: "box", color: GLOW_COLORS.window, p: [0.24, 0.34, 0.31], s: [0.14, 0.14, 0.03] },
  { prim: "box", color: GLOW_COLORS.window, p: [-0.24, 0.34, 0.31], s: [0.14, 0.14, 0.03] },
  { prim: "box", color: GLOW_COLORS.window, p: [0.41, 0.3, 0], s: [0.03, 0.14, 0.14] },
  { prim: "box", color: "#c9b7a6", p: [0.24, 0.86, -0.12], s: [0.08, 0.2, 0.08] },
];

const critter = (body: string, head: string, legs = true): Part[] => [
  { prim: "sphere", color: body, p: [0, 0.5, 0], s: [0.42, 0.32, 0.3] },
  { prim: "sphere", color: head, p: [0.42, 0.72, 0], s: [0.2, 0.2, 0.2] },
  ...(legs
    ? ([
        { prim: "cyl", color: "#5b463a", p: [0.2, 0.15, 0.12], s: [0.05, 0.3, 0.05] },
        { prim: "cyl", color: "#5b463a", p: [-0.2, 0.15, -0.12], s: [0.05, 0.3, 0.05] },
      ] as Part[])
    : []),
];

/** Recipes by art id (keyed loosely so new scenery ids can be added gradually; see recipeFor). */
export const RECIPES: Record<string, Part[]> & Partial<Record<SceneryArtId | FlatArt, Part[]>> = {
  tree_round: [
    { prim: "cyl", color: TRUNK, p: [0, 0.22, 0], s: [0.08, 0.45, 0.08] },
    { prim: "sphere", color: LEAF, p: [0, 0.62, 0], s: [0.34, 0.32, 0.34] },
    { prim: "sphere", color: LEAF2, p: [0.12, 0.78, 0.08], s: [0.2, 0.18, 0.2] },
  ],
  tree_pine: [
    { prim: "cyl", color: TRUNK, p: [0, 0.12, 0], s: [0.07, 0.25, 0.07] },
    { prim: "cone", color: "#3f9a55", p: [0, 0.42, 0], s: [0.3, 0.42, 0.3] },
    { prim: "cone", color: "#4cab5f", p: [0, 0.66, 0], s: [0.23, 0.36, 0.23] },
    { prim: "cone", color: "#5cbb68", p: [0, 0.86, 0], s: [0.15, 0.28, 0.15] },
  ],
  tree_cherry: [
    { prim: "cyl", color: "#8a5a45", p: [0, 0.22, 0], s: [0.08, 0.45, 0.08] },
    { prim: "sphere", color: "#ffb5cf", p: [0, 0.62, 0], s: [0.36, 0.3, 0.36] },
    { prim: "sphere", color: "#ffd0e0", p: [-0.14, 0.76, 0.06], s: [0.2, 0.17, 0.2] },
  ],
  tree_fruit: [
    { prim: "cyl", color: TRUNK, p: [0, 0.22, 0], s: [0.08, 0.45, 0.08] },
    { prim: "sphere", color: "#62b94f", p: [0, 0.62, 0], s: [0.34, 0.3, 0.34] },
    { prim: "sphere", color: "#ef5b4f", p: [0.2, 0.6, 0.25], s: [0.06, 0.06, 0.06] },
    { prim: "sphere", color: "#ef5b4f", p: [-0.22, 0.7, 0.18], s: [0.06, 0.06, 0.06] },
  ],
  tree_birch: [
    { prim: "cyl", color: "#f2efe6", p: [0, 0.3, 0], s: [0.06, 0.6, 0.06] },
    { prim: "sphere", color: "#a6d86a", p: [0, 0.74, 0], s: [0.26, 0.3, 0.26] },
  ],
  palm: [
    { prim: "cyl", color: "#b08356", p: [0, 0.4, 0], s: [0.06, 0.8, 0.06], r: [0, 0, 0.08] },
    { prim: "sphere", color: "#4cab5f", p: [0.04, 0.86, 0], s: [0.38, 0.1, 0.38] },
  ],
  bush: [{ prim: "sphere", color: "#58ae55", p: [0, 0.36, 0], s: [0.55, 0.38, 0.5] }],
  bush_berry: [
    { prim: "sphere", color: "#5aae58", p: [0, 0.36, 0], s: [0.55, 0.38, 0.5] },
    { prim: "sphere", color: "#d6457a", p: [0.25, 0.5, 0.3], s: [0.08, 0.08, 0.08] },
  ],
  flower_red: flower("#ef5b5b"),
  flower_yellow: flower("#ffd447"),
  flower_blue: flower("#6aa8ff"),
  flower_pink: flower("#ff8fc2"),
  flower_white: flower("#fbf7ee"),
  tulip: [
    { prim: "cyl", color: "#4f9e47", p: [0, 0.35, 0], s: [0.035, 0.7, 0.035] },
    { prim: "cone", color: "#ff6f91", p: [0, 0.8, 0], s: [0.13, 0.22, 0.13], r: [Math.PI, 0, 0] },
  ],
  sunflower: [
    { prim: "cyl", color: "#4f9e47", p: [0, 0.4, 0], s: [0.04, 0.8, 0.04] },
    { prim: "cyl", color: "#ffcc33", p: [0, 0.82, 0.03], s: [0.22, 0.04, 0.22], r: [Math.PI / 2, 0, 0] },
    { prim: "cyl", color: "#7a4b2a", p: [0, 0.82, 0.06], s: [0.1, 0.04, 0.1], r: [Math.PI / 2, 0, 0] },
  ],
  daisy_cluster: [
    { prim: "sphere", color: "#fbf7ee", p: [0.15, 0.35, 0], s: [0.16, 0.12, 0.16] },
    { prim: "sphere", color: "#fbf7ee", p: [-0.12, 0.3, 0.1], s: [0.14, 0.11, 0.14] },
    { prim: "sphere", color: "#ffe066", p: [0, 0.4, -0.12], s: [0.15, 0.12, 0.15] },
  ],
  mushroom: [
    { prim: "cyl", color: "#fff5e6", p: [0, 0.25, 0], s: [0.14, 0.5, 0.14] },
    { prim: "sphere", color: "#e8453c", p: [0, 0.55, 0], s: [0.38, 0.22, 0.38] },
  ],
  grass_tuft: [
    { prim: "cone", color: "#5fb85a", p: [0.08, 0.4, 0], s: [0.1, 0.8, 0.1] },
    { prim: "cone", color: "#76c763", p: [-0.08, 0.32, 0.05], s: [0.1, 0.64, 0.1] },
  ],
  reed: [
    { prim: "cyl", color: "#6aa84f", p: [0, 0.45, 0], s: [0.025, 0.9, 0.025] },
    { prim: "cyl", color: "#7a5032", p: [0, 0.82, 0], s: [0.05, 0.18, 0.05] },
  ],
  rock: [{ prim: "rock", color: "#b6aca3", p: [0, 0.35, 0], s: [0.6, 0.45, 0.5] }],
  boulder: [{ prim: "rock", color: "#a99f96", p: [0, 0.4, 0], s: [0.65, 0.5, 0.55] }],
  house_red: house("#fff1d6", "#e25b4a"),
  house_blue: house("#dbefff", "#4d7fd6"),
  house_yellow: house("#ffe9a3", "#8a5ac9"),
  cottage: house("#f4e2c8", "#9a6a45"),
  barn: [
    { prim: "box", color: "#d9493f", p: [0, 0.3, 0], s: [0.95, 0.6, 0.7] },
    { prim: "roof", color: "#7a3b33", p: [0, 0.72, 0], s: [1.05, 0.5, 0.86] },
    { prim: "box", color: "#fff7ea", p: [0, 0.2, 0.36], s: [0.32, 0.4, 0.03] },
    { prim: "box", color: GLOW_COLORS.window, p: [0, 0.48, 0.36], s: [0.16, 0.12, 0.03] },
  ],
  windmill: [
    { prim: "cone", color: "#f2e6d0", p: [0, 0.38, 0], s: [0.2, 0.76, 0.2] },
    { prim: "cone", color: "#d9493f", p: [0, 0.82, 0], s: [0.14, 0.14, 0.14] },
    { prim: "box", color: "#8a5a3c", p: [0, 0.7, 0.16], s: [0.06, 0.8, 0.02], r: [0, 0, 0.6] },
    { prim: "box", color: "#8a5a3c", p: [0, 0.7, 0.16], s: [0.06, 0.8, 0.02], r: [0, 0, -0.97] },
  ],
  well: [
    { prim: "cyl", color: "#b9b1a7", p: [0, 0.2, 0], s: [0.38, 0.4, 0.38] },
    { prim: "cyl", color: "#8a5a3c", p: [0.3, 0.55, 0], s: [0.04, 0.7, 0.04] },
    { prim: "cyl", color: "#8a5a3c", p: [-0.3, 0.55, 0], s: [0.04, 0.7, 0.04] },
    { prim: "roof", color: "#d9493f", p: [0, 0.92, 0], s: [0.8, 0.35, 0.6] },
  ],
  fence: [
    { prim: "box", color: "#c79a6b", p: [0.45, 0.4, 0], s: [0.1, 0.8, 0.1] },
    { prim: "box", color: "#c79a6b", p: [-0.45, 0.4, 0], s: [0.1, 0.8, 0.1] },
    { prim: "box", color: "#e0b583", p: [0, 0.55, 0], s: [1.0, 0.1, 0.06] },
    { prim: "box", color: "#e0b583", p: [0, 0.28, 0], s: [1.0, 0.1, 0.06] },
  ],
  haystack: [{ prim: "cone", color: "#f2c94c", p: [0, 0.42, 0], s: [0.5, 0.84, 0.5] }],
  scarecrow: [
    { prim: "cyl", color: "#8a5a3c", p: [0, 0.4, 0], s: [0.04, 0.8, 0.04] },
    { prim: "box", color: "#6aa8ff", p: [0, 0.6, 0], s: [0.7, 0.08, 0.08] },
    { prim: "box", color: "#e8564f", p: [0, 0.55, 0], s: [0.22, 0.3, 0.14] },
    { prim: "sphere", color: "#f2c94c", p: [0, 0.82, 0], s: [0.12, 0.12, 0.12] },
  ],
  pumpkin: [{ prim: "sphere", color: "#f28b2c", p: [0, 0.35, 0], s: [0.5, 0.35, 0.5] }],
  cabbage_row: [{ prim: "sphere", color: "#8ccf6a", p: [0, 0.3, 0], s: [0.4, 0.3, 0.4] }],
  cow: critter("#fbf7ee", "#f2c4b0"),
  sheep: critter("#fbf7ee", "#3a302b"),
  chicken: critter("#fff7ea", "#e8564f"),
  duck: critter("#fff2a8", "#5fb85a", false),
  picnic_blanket: [{ prim: "box", color: "#e8564f", p: [0, 0.02, 0], s: [1.5, 0.04, 1.1] }],
  picnic_basket: [
    { prim: "box", color: "#c99a5b", p: [0, 0.25, 0], s: [0.7, 0.5, 0.45] },
    { prim: "box", color: "#8a5a3c", p: [0, 0.6, 0], s: [0.5, 0.06, 0.06] },
  ],
  kite: [
    { prim: "box", color: "#ff8fc2", p: [0, 0.75, 0], s: [0.35, 0.35, 0.02], r: [0, 0, Math.PI / 4] },
    { prim: "cyl", color: "#3a302b", p: [0, 0.35, 0], s: [0.008, 0.7, 0.008] },
  ],
  lighthouse: [
    { prim: "cyl", color: "#fbf7ee", p: [0, 0.18, 0], s: [0.18, 0.36, 0.18] },
    { prim: "cyl", color: "#e25b4a", p: [0, 0.45, 0], s: [0.15, 0.2, 0.15] },
    { prim: "cyl", color: "#fbf7ee", p: [0, 0.65, 0], s: [0.13, 0.2, 0.13] },
    { prim: "sphere", color: GLOW_COLORS.beacon, p: [0, 0.8, 0], s: [0.1, 0.08, 0.1] },
    { prim: "cone", color: "#e25b4a", p: [0, 0.92, 0], s: [0.15, 0.16, 0.15] },
  ],
  beach_hut: [
    { prim: "box", color: "#9fd3ff", p: [0, 0.3, 0], s: [0.6, 0.6, 0.6] },
    { prim: "roof", color: "#fbf7ee", p: [0, 0.72, 0], s: [0.7, 0.4, 0.72] },
  ],
  shell: [{ prim: "cone", color: "#ffc2b8", p: [0, 0.3, 0], s: [0.35, 0.5, 0.35], r: [0.4, 0, 0] }],
  sailboat: [
    { prim: "box", color: "#c99a5b", p: [0, 0.1, 0], s: [0.8, 0.2, 0.3] },
    { prim: "cone", color: "#fbf7ee", p: [0.05, 0.6, 0], s: [0.28, 0.8, 0.04] },
  ],
  lamp_post: [
    { prim: "cyl", color: "#3a302b", p: [0, 0.45, 0], s: [0.035, 0.9, 0.035] },
    { prim: "sphere", color: GLOW_COLORS.lamp, p: [0, 0.92, 0], s: [0.09, 0.09, 0.09] },
  ],
  signpost: [
    { prim: "cyl", color: "#8a5a3c", p: [0, 0.45, 0], s: [0.04, 0.9, 0.04] },
    { prim: "box", color: "#e0b583", p: [0.15, 0.78, 0], s: [0.5, 0.16, 0.04] },
  ],
  bench: [
    { prim: "box", color: "#c79a6b", p: [0, 0.45, 0], s: [1.2, 0.08, 0.36] },
    { prim: "box", color: "#c79a6b", p: [0, 0.8, -0.16], s: [1.2, 0.3, 0.06] },
    { prim: "box", color: "#6b5444", p: [0.5, 0.22, 0], s: [0.08, 0.45, 0.3] },
    { prim: "box", color: "#6b5444", p: [-0.5, 0.22, 0], s: [0.08, 0.45, 0.3] },
  ],
  snow_pine: [
    { prim: "cyl", color: TRUNK, p: [0, 0.1, 0], s: [0.07, 0.2, 0.07] },
    { prim: "cone", color: "#3f8a5a", p: [0, 0.42, 0], s: [0.3, 0.5, 0.3] },
    { prim: "cone", color: "#fbf7ee", p: [0, 0.78, 0], s: [0.2, 0.36, 0.2] },
  ],
  mountain_peak: [],
  cloud: [],
  butterfly: [
    { prim: "box", color: "#ff8fc2", p: [0, 0.5, 0.15], s: [0.04, 0.5, 0.4], r: [0.2, 0, 0] },
    { prim: "box", color: "#ffd447", p: [0, 0.5, -0.15], s: [0.04, 0.5, 0.4], r: [-0.2, 0, 0] },
  ],
  bird: critter("#6aa8ff", "#6aa8ff", false),
  visitor_a: [],
  visitor_b: [],
  visitor_c: [],
  lilypad: [{ prim: "cyl", color: "#6cbf5a", p: [0, 0.02, 0], s: [0.5, 0.03, 0.5] }],
  // Ground dressing ids used by newer scenery layouts.
  flower_orange: flower("#ff9f43"),
  flower_purple: flower("#b07cf0"),
  wildflowers: [
    { prim: "cone", color: "#5fb85a", p: [0, 0.2, 0], s: [0.06, 0.4, 0.06] },
    { prim: "sphere", color: "#ff8fc2", p: [0.12, 0.36, 0.04], s: [0.09, 0.07, 0.09] },
    { prim: "sphere", color: "#ffd447", p: [-0.1, 0.3, -0.06], s: [0.08, 0.06, 0.08] },
    { prim: "sphere", color: "#9fc6ff", p: [0.02, 0.42, -0.1], s: [0.08, 0.06, 0.08] },
  ],
  grass_tall: [
    { prim: "cone", color: "#5fb85a", p: [0.06, 0.45, 0], s: [0.08, 0.9, 0.08], r: [0, 0, -0.12] },
    { prim: "cone", color: "#76c763", p: [-0.06, 0.38, 0.04], s: [0.08, 0.76, 0.08], r: [0.1, 0, 0.14] },
    { prim: "cone", color: "#4fa64c", p: [0, 0.32, -0.06], s: [0.07, 0.64, 0.07], r: [-0.12, 0, 0] },
  ],
  fern: [
    { prim: "cone", color: "#4fa64c", p: [0.16, 0.22, 0], s: [0.1, 0.5, 0.06], r: [0, 0, -0.9] },
    { prim: "cone", color: "#5fb85a", p: [-0.16, 0.22, 0], s: [0.1, 0.5, 0.06], r: [0, 0, 0.9] },
    { prim: "cone", color: "#58ae55", p: [0, 0.22, 0.16], s: [0.06, 0.5, 0.1], r: [0.9, 0, 0] },
    { prim: "cone", color: "#4fa64c", p: [0, 0.22, -0.16], s: [0.06, 0.5, 0.1], r: [-0.9, 0, 0] },
  ],
  pebbles: [
    { prim: "rock", color: "#b6aca3", p: [0.15, 0.08, 0], s: [0.16, 0.1, 0.14] },
    { prim: "rock", color: "#a99f96", p: [-0.12, 0.07, 0.1], s: [0.13, 0.09, 0.12] },
    { prim: "rock", color: "#c4bbb2", p: [0, 0.06, -0.14], s: [0.11, 0.07, 0.1] },
  ],
  blanket: [{ prim: "box", color: "#e8564f", p: [0, 0.02, 0], s: [1, 0.03, 0.75] }],
};

export function ambientRecipe(art: AmbientArt): Part[] {
  return recipeFor(art);
}

const FALLBACK_RECIPE: Part[] = [{ prim: "sphere", color: "#7fcc5d", p: [0, 0.3, 0], s: [0.3, 0.25, 0.3] }];

/** Parts for an art id (unknown ids get a small leafy tuft rather than nothing). */
export function recipeFor(art: string): Part[] {
  return Object.prototype.hasOwnProperty.call(RECIPES, art) ? RECIPES[art] : FALLBACK_RECIPE;
}

/** Leafy canopy colours (spheres) that change with the seasons. Evergreens are cones. */
const FOLIAGE = new Set(["#5fb85a", "#7fcc5d", "#62b94f", "#a6d86a", "#58ae55", "#5aae58"]);
const AUTUMN = ["#f28b2c", "#e8563f", "#f2c14c", "#d9732e", "#c94f3a", "#f0a33a"];

/** True for parts whose colour follows the seasons. */
export function isSeasonalPart(part: Part): boolean {
  return part.prim === "sphere" && FOLIAGE.has(part.color);
}

/** Colour of a part for a season (autumn canopies turn orange/red/gold; `seed` varies it per tree). */
export function seasonalColor(part: Part, season: Season, seed: number): string {
  if (season !== "autumn" || !isSeasonalPart(part)) return part.color;
  const k = Math.abs(Math.floor(Math.sin(seed * 12.9898 + part.p[1] * 78.233) * 43758.5453)) % AUTUMN.length;
  return AUTUMN[k];
}

/**
 * A batch of instanced primitives with a matching outline batch sharing the
 * same instance matrices.
 */
export class ShapeBatch {
  readonly mesh: THREE.InstancedMesh;
  readonly outline: THREE.InstancedMesh;
  count = 0;
  constructor(prim: Prim, capacity: number, outlineMat: THREE.ShaderMaterial, dynamic = false) {
    const mat = createHandCutMaterial();
    this.mesh = new THREE.InstancedMesh(primGeometry(prim), mat, Math.max(1, capacity));
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, capacity) * 3), 3);
    // Real sun shadows: shapes cast and receive (the outline hull does neither).
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.outline = new THREE.InstancedMesh(primHullGeometry(prim), outlineMat, Math.max(1, capacity));
    this.outline.instanceMatrix = this.mesh.instanceMatrix;
    if (dynamic) this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.outline.frustumCulled = false;
    this.mesh.count = 0;
    this.outline.count = 0;
  }
  push(matrix: THREE.Matrix4, color: THREE.Color): number {
    const i = this.count++;
    this.mesh.setMatrixAt(i, matrix);
    this.mesh.setColorAt(i, color);
    this.mesh.count = this.outline.count = this.count;
    return i;
  }
  set(i: number, matrix: THREE.Matrix4) {
    this.mesh.setMatrixAt(i, matrix);
  }
  setColor(i: number, color: THREE.Color) {
    this.mesh.setColorAt(i, color);
  }
  commit() {
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
  dispose() {
    (this.mesh.material as THREE.Material).dispose();
  }
}

export function createShapeBatches(capacities: Partial<Record<Prim, number>>, dynamic = false) {
  const outlineMat = createOutlineMaterial(0.035);
  const batches = {} as Record<Prim, ShapeBatch>;
  (["sphere", "cyl", "cone", "box", "roof", "rock"] as Prim[]).forEach((p) => {
    batches[p] = new ShapeBatch(p, capacities[p] ?? 0, outlineMat, dynamic);
  });
  return batches;
}

const _local = new THREE.Matrix4();
const _rot = new THREE.Euler();
const _q = new THREE.Quaternion();
const _pos = new THREE.Vector3();
const _scl = new THREE.Vector3();

/** Compose a part's world matrix from the item frame. */
export function partMatrix(frame: THREE.Matrix4, part: Part, size: number, out: THREE.Matrix4): THREE.Matrix4 {
  _pos.set(part.p[0] * size, part.p[1] * size, part.p[2] * size);
  _scl.set(part.s[0] * size, part.s[1] * size, part.s[2] * size);
  if (part.r) _q.setFromEuler(_rot.set(part.r[0], part.r[1], part.r[2]));
  else _q.identity();
  _local.compose(_pos, _q, _scl);
  return out.multiplyMatrices(frame, _local);
}
