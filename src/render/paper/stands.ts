// Cardboard stands: the little kraft-paper bases every standing piece is
// slotted into (lighter top, darker cut edge), and the soft contact shadow
// under them. Both are single instanced meshes.

import * as THREE from "three";
import { applyOcclusionDither } from "../materials";

const KRAFT_TOP = new THREE.Color("#dcbb86");
const KRAFT_MID = new THREE.Color("#cfa873");
const KRAFT_SIDE = new THREE.Color("#a3784a");

/** Unit octagonal stand: radius 1, from y = 0 to y = 1. */
export function buildStandGeometry(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.97, 1, 1, 8, 1, false);
  g.translate(0, 0.5, 0);
  g.rotateY(Math.PI / 8);
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const nrm = g.getAttribute("normal") as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const ny = nrm.getY(i);
    if (ny > 0.5) {
      // Top: lighter in the middle, a touch darker toward the cut edge.
      const r = Math.hypot(pos.getX(i), pos.getZ(i));
      c.copy(KRAFT_TOP).lerp(KRAFT_MID, Math.min(1, r));
    } else if (ny < -0.5) c.copy(KRAFT_SIDE).multiplyScalar(0.8);
    else c.copy(KRAFT_SIDE);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return g;
}

export function createStandMesh(count: number): THREE.InstancedMesh {
  const material = applyOcclusionDither(new THREE.MeshLambertMaterial({ vertexColors: true }));
  const mesh = new THREE.InstancedMesh(buildStandGeometry(), material, Math.max(1, count));
  mesh.count = count;
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  mesh.name = "paper-stands";
  return mesh;
}

/** Soft contact shadows (flat quads with the feathered shadow texture). */
export function createContactShadows(count: number, texture: THREE.Texture): THREE.InstancedMesh {
  const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const inst = new THREE.InstancedMesh(geo, mat, Math.max(1, count));
  inst.count = count;
  inst.frustumCulled = false;
  inst.renderOrder = 1;
  inst.name = "paper-contact-shadows";
  return inst;
}
