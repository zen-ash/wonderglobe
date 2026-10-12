"use client";
// Planet ground mesh (displaced icosphere with crayon vertex colours and
// baked per-region "paint" weights) and the water shell (with a baked
// per-vertex depth for shallows, foam and sea waves).

import { useMemo, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Terrain } from "@/world/planet";
import { WATER_LEVEL, REGIONS } from "@/world/planet";
import { PLANET_RADIUS } from "@/world/sphere";
import { createPlanetMaterial, createWaterMaterial } from "./materials";
import { getAssets } from "./assets";

/** How strongly each region shows each hand-painted ground detail. */
const PAINT: Record<string, { flowers?: number; moss?: number; cobble?: number; furrow?: number; petals?: number }> = {
  meadow: { flowers: 1 },
  garden: { flowers: 0.55, cobble: 0.5 },
  picnic: { flowers: 0.45 },
  cherry: { flowers: 0.6, petals: 1 },
  lily: { flowers: 0.25 },
  duckpond: { flowers: 0.2 },
  village: { flowers: 0.12, cobble: 1 },
  forest: { moss: 1 },
  lake: { moss: 0.3 },
  mountain: { moss: 0.35 },
  farm: { furrow: 1 },
};

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

export function buildPlanetGeometry(terrain: Terrain, detail: number): THREE.BufferGeometry {
  let geo: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, detail);
  geo.deleteAttribute("normal");
  geo.deleteAttribute("uv");
  geo = mergeVertices(geo, 1e-5);
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const pat1 = new Float32Array(pos.count * 4);
  const pat2 = new Float32Array(pos.count * 4);
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    n.fromBufferAttribute(pos, i).normalize();
    const s = terrain.sample(n);
    pos.setXYZ(i, n.x * s.height, n.y * s.height, n.z * s.height);
    colors[i * 3] = s.color[0];
    colors[i * 3 + 1] = s.color[1];
    colors[i * 3 + 2] = s.color[2];
    const paint = PAINT[REGIONS[s.region]?.id] ?? {};
    const own = smooth(0, 0.06, s.regionDepth);
    const dry = s.water < 0 ? 1 : 0;
    pat1[i * 4] = (paint.flowers ?? 0) * own * dry;
    pat1[i * 4 + 1] = (paint.moss ?? 0) * own * dry;
    pat1[i * 4 + 2] = s.ground === "path" ? (paint.cobble ?? 0) : 0;
    pat1[i * 4 + 3] = (paint.furrow ?? 0) * own * dry;
    pat2[i * 4] = s.ground === "sand" ? 1 : 0;
    pat2[i * 4 + 1] = s.ground === "grass" ? 1 : 0;
    pat2[i * 4 + 2] = Math.min(1, Math.max(0, (s.height - PLANET_RADIUS - 0.3) / 4.2));
    pat2[i * 4 + 3] = (paint.petals ?? 0) * own;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.setAttribute("aPat1", new THREE.BufferAttribute(pat1, 4));
  geo.setAttribute("aPat2", new THREE.BufferAttribute(pat2, 4));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/** The last terrain the planet was built from (lets <WaterShell/> bake depths without a prop). */
let lastTerrain: Terrain | null = null;

export function PlanetMesh({ terrain, light, onReady }: { terrain: Terrain; light: boolean; onReady?: (mesh: THREE.Mesh | null) => void }) {
  lastTerrain = terrain;
  const geometry = useMemo(() => buildPlanetGeometry(terrain, light ? 48 : 80), [terrain, light]);
  const material = useMemo(() => createPlanetMaterial(getAssets().grain), []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  // Receives the sun's cast shadows (the paper cut-outs cast them; see Sky.tsx).
  return <mesh name="planet" geometry={geometry} material={material} receiveShadow ref={(m) => onReady?.(m)} />;
}

/** Water sphere with a per-vertex depth (WATER_LEVEL - ground height; negative under land). */
export function buildWaterGeometry(terrain: Terrain | null, light: boolean): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(WATER_LEVEL, light ? 64 : 160, light ? 40 : 100);
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const depth = new Float32Array(pos.count);
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    if (!terrain) {
      depth[i] = 1;
      continue;
    }
    n.fromBufferAttribute(pos, i).normalize();
    depth[i] = WATER_LEVEL - terrain.heightAt(n);
  }
  geo.setAttribute("aDepth", new THREE.BufferAttribute(depth, 1));
  return geo;
}

export function WaterShell({ light, terrain }: { light: boolean; terrain?: Terrain }) {
  const material = useMemo(() => createWaterMaterial(), []);
  const t = terrain ?? lastTerrain;
  const geometry = useMemo(() => buildWaterGeometry(t, light), [t, light]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useFrame((_, dt) => {
    material.uniforms.uTime.value += Math.min(dt, 0.05);
  });
  return <mesh name="water" geometry={geometry} material={material} renderOrder={2} />;
}
