// Shared pieces for paper cut-out puppets: the three card materials (drawing
// on the front, white cut edge, plain paper back), a shadow depth material
// that keeps the cut-out shape (and follows the paper's bending), and the
// little kraft-cardboard stand every grounded puppet slots into.

import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import { createPaperMaterial, createPaperDepthMaterial, applyOcclusionDither, type PaperUniforms } from "../materials";
import { getAssets } from "../assets";

export const EDGE_PAPER = "#e9dfcb";
export const BACK_PAPER = "#efe6d4";

export interface PaperCard {
  /** [front, edge, back] — matches the cut-out geometry groups. */
  materials: THREE.Material[];
  front: THREE.MeshBasicMaterial;
  uniforms: PaperUniforms;
  /** Use as `customDepthMaterial` so the real shadow has the cut-out's shape. */
  depth: THREE.Material;
  dispose(): void;
}

/** Make `target`'s shader read the same uniform objects as `source` (call before first render). */
function shareUniforms(target: PaperUniforms, source: PaperUniforms) {
  const t = target as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(source)) t[k] = v;
}

/**
 * Paper card materials. The edge and back are separate paper materials that
 * share the front's deformation uniforms, so wings, waves and curl move all
 * three faces together.
 */
export function createPaperCard(map: THREE.Texture | null, opts: { frontColor?: string } = {}): PaperCard {
  const front = createPaperMaterial(map, opts.frontColor);
  const edge = createPaperMaterial(null, EDGE_PAPER);
  const back = createPaperMaterial(null, BACK_PAPER);
  shareUniforms(edge.uniforms, front.uniforms);
  shareUniforms(back.uniforms, front.uniforms);
  front.material.side = THREE.FrontSide;
  back.material.side = THREE.FrontSide;
  edge.material.side = THREE.DoubleSide;
  // Baked shading that follows the card's bow (vertex colours).
  front.material.vertexColors = true;
  back.material.vertexColors = true;
  const depth = createCutoutDepthMaterial(map, front.uniforms);
  return {
    materials: [front.material, edge.material, back.material],
    front: front.material,
    uniforms: front.uniforms,
    depth,
    dispose() {
      front.material.dispose();
      edge.material.dispose();
      back.material.dispose();
      depth.dispose();
    },
  };
}


/** Same deformation as the paper material (wave, wing fold, curl), for the shadow pass. */
const DEFORM_GLSL = /* glsl */ `
  {
    float xn = transformed.x / max(uHalfWidth, 1e-3);
    float yn = transformed.y / max(uHeight, 1e-3);
    transformed.z += sin(xn * 3.2 - uTime * 7.0) * uWave * uHalfWidth * 0.18 * abs(xn);
    float side = sign(transformed.x);
    float ang = uFold * 1.1;
    float ax = abs(transformed.x);
    transformed.z += -sin(ang) * ax;
    transformed.x = side * cos(ang) * ax;
    transformed.z += uBend * yn * yn * uHeight * 0.35;
  }
`;

/**
 * Shadow depth material for a paper cut-out: shaped by the drawing's alpha and
 * bending exactly like the paper (wave / fold / curl).
 */
export function createCutoutDepthMaterial(map: THREE.Texture | null, uniforms: PaperUniforms): THREE.Material {
  if (map) return createPaperDepthMaterial(map, uniforms);
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime; uniform float uWave; uniform float uFold; uniform float uBend; uniform float uHalfWidth; uniform float uHeight;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\n" + DEFORM_GLSL);
  };
  m.customProgramCacheKey = () => "wonderglobe-paper-depth-plain";
  return m;
}

/** Whether real (shadow-mapped) shadows are on — then blob shadows stay subtle. */
export function useRealShadows(): boolean {
  return useThree((s) => s.gl.shadowMap.enabled);
}

/** Blob-shadow opacity factor: subtle contact shading when real shadows are on. */
export function blobStrength(realShadows: boolean): number {
  return realShadows ? 0.4 : 1;
}

// ------------------------------------------------------- cardboard stand

/** Stand height (top surface above the ground). */
export const STAND_TOP = 0.075;

let standGeo: THREE.BufferGeometry | null = null;
let standMat: THREE.Material | null = null;

const KRAFT_TOP = new THREE.Color("#f7dcae");
const KRAFT_SIDE = new THREE.Color("#d6a46c");
const KRAFT_FOOT = new THREE.Color("#b3824f");
const SLOT = new THREE.Color("#5a3b22");

/**
 * A small round kraft-cardboard base (radius 0.5, scale it to the card) with a
 * slot across the top: lighter top, darker rounded side. Shared geometry.
 */
export function standGeometry(): THREE.BufferGeometry {
  if (standGeo) return standGeo;
  const prof = [
    new THREE.Vector2(0, -0.02),
    new THREE.Vector2(0.5, -0.02),
    new THREE.Vector2(0.53, 0.0),
    new THREE.Vector2(0.535, 0.03),
    new THREE.Vector2(0.52, 0.06),
    new THREE.Vector2(0.495, STAND_TOP),
    new THREE.Vector2(0.0, STAND_TOP),
  ];
  const lathe = new THREE.LatheGeometry(prof, 28).toNonIndexed();
  lathe.computeVertexNormals();
  const pos = lathe.getAttribute("position") as THREE.BufferAttribute;
  const nrm = lathe.getAttribute("normal") as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const ny = nrm.getY(i);
    if (ny > 0.8) c.copy(KRAFT_TOP);
    else if (ny < -0.5) c.copy(KRAFT_FOOT);
    else c.copy(KRAFT_SIDE).lerp(KRAFT_FOOT, Math.max(0, 0.03 - pos.getY(i)) * 12);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  lathe.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  // UVs from the top view so the cardboard grain lies flat.
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i) + 0.5 + pos.getY(i) * 2;
    uv[i * 2 + 1] = pos.getZ(i) + 0.5;
  }
  lathe.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  // The slot the card stands in.
  const slot = new THREE.BoxGeometry(0.78, 0.012, 0.075).toNonIndexed();
  slot.translate(0, STAND_TOP + 0.002, 0);
  const sc = new Float32Array(slot.getAttribute("position").count * 3);
  for (let i = 0; i < sc.length; i += 3) sc.set([SLOT.r, SLOT.g, SLOT.b], i);
  slot.setAttribute("color", new THREE.BufferAttribute(sc, 3));
  standGeo = mergeNonIndexed([lathe, slot]);
  lathe.dispose();
  slot.dispose();
  return standGeo;
}

/** Shared lit kraft material (receives real shadows). */
export function standMaterial(): THREE.Material {
  if (standMat) return standMat;
  standMat = applyOcclusionDither(new THREE.MeshLambertMaterial({ map: getAssets().cardboard, vertexColors: true }));
  return standMat;
}

/** Ready-made stand mesh (shared geometry/material; dispose nothing). */
export function createStandMesh(): THREE.Mesh {
  const m = new THREE.Mesh(standGeometry(), standMaterial());
  m.receiveShadow = true;
  m.castShadow = false;
  return m;
}

/** Stand footprint for a card of the given width. */
export function standScale(width: number, out: THREE.Vector3): THREE.Vector3 {
  const w = Math.max(0.6, width);
  return out.set(Math.min(1.45, w * 0.72), 1, Math.min(0.85, Math.max(0.42, w * 0.36)));
}

function mergeNonIndexed(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const names = ["position", "normal", "uv", "color"];
  const out = new THREE.BufferGeometry();
  for (const name of names) {
    const size = (geos[0].getAttribute(name) as THREE.BufferAttribute).itemSize;
    const total = geos.reduce((n, g) => n + g.getAttribute(name).count * size, 0);
    const arr = new Float32Array(total);
    let o = 0;
    for (const g of geos) {
      const a = g.getAttribute(name) as THREE.BufferAttribute;
      arr.set(a.array as Float32Array, o);
      o += a.count * size;
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  out.computeBoundingSphere();
  return out;
}
