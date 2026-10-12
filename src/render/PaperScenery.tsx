"use client";
// Living Paper World scenery, built like a paper-craft diorama on a craft
// table: plants and objects are 2–3 cut-out cards slotted together in an X
// (or a star), each bowed a little and swaying in the wind; houses are little
// folded paper buildings; everything stands on a kraft cardboard stand and
// casts a real shadow in its own cut-out shape. Ambient animals are single
// cards turned along their heading. All of it is instanced:
//   cards (1 draw + 1 shadow), buildings (1 + 1), stands (1), contact
//   shadows (1), ambient cards (1 + 1), walker stands (1) — plus the flat
//   lily pads / picnic blanket.

import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { WorldRuntime } from "@/world/runtime";
import type { SceneryItem } from "@/world/scenery";
import type { AtlasEntry, SceneryArtId } from "@/art/sceneryAtlas";
import { getAssets } from "./assets";
import { createOutlineMaterial, createStandingQuad, toonMaterial } from "./materials";
import { environment } from "@/world/environment";
import { NightLights } from "./NightLights";
import { Ripples } from "./WaterRipples";
import { DevRuntimeHandle } from "./atmosphere/devHandle";
import { WATER_LEVEL } from "@/world/planet";
import { anyTangent, frameMatrix } from "@/world/sphere";
import type { Agent } from "@/world/agents";
import { camera } from "./cameraControl";
import { buildCardGeometry, createCardDepthMaterial, createCardMaterial, createCardUniforms, type CardUniforms } from "./paper/cards";
import { buildBuildingGeometry, createBuildingDepthMaterial, createBuildingMaterial } from "./paper/buildings";
import { createContactShadows, createStandMesh } from "./paper/stands";
import { artStats, hash01, paperBackTint, paperKind, paperLayout, pickVariant } from "./paper/artInfo";

export { paperKind as billboardKind } from "./paper/artInfo";

/**
 * Camera-facing billboard geometry for `createBillboardMaterial` (kept for
 * other views such as the title planet; the paper world itself uses crossed
 * cards from ./paper/cards).
 */
export function buildBillboardGeometry(count: number) {
  const base = createStandingQuad();
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute("position", base.getAttribute("position"));
  geo.setAttribute("uv", base.getAttribute("uv"));
  const center = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
  const size = new THREE.InstancedBufferAttribute(new Float32Array(count * 2), 2);
  const uv = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
  const params = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
  const extra = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
  geo.setAttribute("aExtra", extra);
  geo.setAttribute("aCenter", center);
  geo.setAttribute("aSize", size);
  geo.setAttribute("aUv", uv);
  geo.setAttribute("aParams", params);
  geo.instanceCount = count;
  return { geo, center, size, uv, params, extra };
}

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _t = new THREE.Vector3();
const _r = new THREE.Vector3();
const _f = new THREE.Vector3();
const _s = new THREE.Vector3();

/** Ground point for an item (water surface for floating things). */
function basePoint(runtime: WorldRuntime, it: SceneryItem, out: THREE.Vector3, sink = 0.04) {
  const h = runtime.terrain.heightAt(it.n);
  return out.copy(it.n).multiplyScalar(it.onWater ? Math.max(h, WATER_LEVEL) : h - sink);
}

/** The direction a piece's front faces (its `facing`, or one derived from its yaw). */
function facingOf(it: SceneryItem, out: THREE.Vector3): THREE.Vector3 {
  if (it.facing) return out.copy(it.facing).addScaledVector(it.n, -it.facing.dot(it.n)).normalize();
  anyTangent(it.n, out);
  _s.crossVectors(it.n, out);
  return out.multiplyScalar(Math.cos(it.yaw)).addScaledVector(_s, Math.sin(it.yaw)).normalize();
}

interface Piece {
  it: SceneryItem;
  entry: AtlasEntry;
  index: number;
}

/** Which pieces to draw: everything (lighter graphics: all solid pieces, ~45% of the small walk-through dressing). */
function selectPieces(runtime: WorldRuntime, light: boolean): Piece[] {
  const atlas = getAssets().atlas;
  const list = [...runtime.layout.items.filter((it) => !it.flat), ...(runtime.layout.decor ?? [])];
  const out: Piece[] = [];
  list.forEach((it, index) => {
    const base = atlas.entries[it.art as SceneryArtId];
    if (!base) return; // art not in this atlas (yet)
    if (light && it.radius === 0 && it.size < 1.2 && hash01(index * 3 + 11) > 0.45) return;
    out.push({ it, entry: pickVariant(base, index), index });
  });
  return out;
}

/** Height of the cardboard stand under a piece (0 = none). */
function standHeight(it: SceneryItem, stand: boolean): number {
  if (!stand || it.onWater) return 0;
  return Math.min(0.09, 0.035 + it.size * 0.012);
}

function updateCardUniforms(u: CardUniforms, state: { camera: THREE.Camera }, dt: number, player: THREE.Vector3 | null) {
  u.uTime.value += Math.min(dt, 0.05) * (environment.reducedMotion ? 0.5 : 1);
  u.uCamPos.value.copy(state.camera.position);
  u.uCamUp.value.setFromMatrixColumn(state.camera.matrixWorld, 1).normalize();
  if (player) u.uPlayer.value.copy(player);
  const focusing = !!camera.focus && performance.now() / 1000 < camera.focusUntil + 4;
  u.uFocusOn.value = focusing ? 1 : 0;
  if (focusing) u.uFocus.value.copy(camera.focus!);
}

export function PaperScenery({ runtime, playerRef }: { runtime: WorldRuntime; playerRef: React.RefObject<THREE.Vector3> }) {
  const assets = getAssets();
  const light = environment.lightGraphics;
  const pieces = useMemo(() => selectPieces(runtime, light), [runtime, light]);
  const uniforms = useMemo(() => createCardUniforms(assets.atlasTexture), [assets]);

  const built = useMemo(() => {
    const atlas = assets.atlas;
    const cardPieces = pieces.filter((p) => paperLayout(p.it.art).build === "cards");
    const housePieces = pieces.filter((p) => paperLayout(p.it.art).build === "building");
    const cardCount = cardPieces.reduce((n, p) => n + paperLayout(p.it.art).cards, 0);

    // ---- cards
    const cards = buildCardGeometry(cardCount);
    const stands: Array<{ pos: THREE.Vector3; n: THREE.Vector3; right: THREE.Vector3; sx: number; sy: number; sz: number }> = [];
    let k = 0;
    for (const { it, entry, index } of cardPieces) {
      const lay = paperLayout(it.art);
      const stats = artStats(atlas, entry);
      const back = paperBackTint(stats);
      const sH = standHeight(it, lay.stand);
      const h = runtime.terrain.heightAt(it.n);
      const ground = it.onWater ? Math.max(h, WATER_LEVEL) : h - 0.03;
      _p.copy(it.n).multiplyScalar(sH > 0 ? ground + sH - 0.005 : it.onWater ? ground : h - 0.04);
      facingOf(it, _f);
      _r.crossVectors(it.n, _f).normalize(); // right = up × front
      const w = it.size * entry.aspect;
      const rnd = hash01(index);
      const hue = (hash01(index * 5 + 1) * 2 - 1) * lay.hue;
      const phase = (index * 1.7) % 6.28;
      const kind = paperKind(it.art);
      for (let c = 0; c < lay.cards; c++) {
        const ang = (c * Math.PI) / lay.cards;
        _t.copy(_r).multiplyScalar(Math.cos(ang)).addScaledVector(_f, Math.sin(ang));
        cards.center.setXYZ(k, _p.x, _p.y, _p.z);
        cards.size.setXY(k, w, it.size);
        cards.uv.setXYZW(k, entry.u0, entry.v0, entry.u1, entry.v1);
        const bow = (hash01(index * 13 + c * 7 + 5) * 2 - 1) * lay.bow;
        cards.params.setXYZW(k, it.sway, phase, bow, -entry.anchorY * it.size);
        cards.extra.setXYZW(k, kind, rnd, hue, lay.back);
        cards.right.setXYZ(k, _t.x, _t.y, _t.z);
        cards.back.setXYZ(k, back[0], back[1], back[2]);
        k++;
      }
      if (sH > 0) {
        const single = lay.cards === 1;
        const r = single ? THREE.MathUtils.clamp(w * 0.5, 0.1, 1.1) : THREE.MathUtils.clamp(w * 0.2, 0.1, 0.6);
        stands.push({ pos: _p.clone().copy(it.n).multiplyScalar(ground - 0.01), n: it.n, right: _r.clone(), sx: r, sy: sH + 0.01, sz: single ? Math.max(0.1, Math.min(r * 0.35, 0.3)) : r * 0.85 });
      }
    }
    const cardMat = createCardMaterial(uniforms);
    const cardMesh = new THREE.Mesh(cards.geo, cardMat);
    cardMesh.frustumCulled = false;
    cardMesh.castShadow = true;
    cardMesh.receiveShadow = true;
    cardMesh.customDepthMaterial = createCardDepthMaterial(uniforms);
    cardMesh.name = "scenery";

    // ---- folded buildings
    const houses = buildBuildingGeometry(housePieces.length);
    housePieces.forEach(({ it, entry, index }, i) => {
      const stats = artStats(atlas, entry);
      const lay = paperLayout(it.art);
      const sH = standHeight(it, lay.stand) * 0.7;
      const ground = runtime.terrain.heightAt(it.n) - 0.03;
      _p.copy(it.n).multiplyScalar(ground + sH);
      facingOf(it, _f);
      _r.crossVectors(it.n, _f).normalize();
      const w = it.size * entry.aspect;
      const depth = w * stats.bodyWidth * 0.95;
      houses.center.setXYZ(i, _p.x, _p.y, _p.z);
      houses.right.setXYZ(i, _r.x, _r.y, _r.z);
      houses.size.setXY(i, w, it.size);
      houses.uv.setXYZW(i, entry.u0, entry.v0, entry.u1, entry.v1);
      houses.shape.setXYZW(i, stats.bodyWidth, stats.bodyCenter, stats.eave, stats.ridge);
      houses.dim.setXYZW(i, depth, entry.anchorY * it.size, paperKind(it.art), hash01(index));
      houses.wall.setXYZ(i, ...stats.bottom);
      houses.roof.setXYZ(i, ...stats.top);
      // A cardboard base plate under the house (a squashed octagon).
      _t.copy(it.n).multiplyScalar(ground - 0.01);
      stands.push({ pos: _t.clone(), n: it.n, right: _r.clone(), sx: (w * stats.bodyWidth) / 2 + 0.25, sy: sH + 0.01, sz: depth / 2 + 0.25 });
    });
    const houseMesh = new THREE.Mesh(houses.geo, createBuildingMaterial(uniforms));
    houseMesh.frustumCulled = false;
    houseMesh.castShadow = true;
    houseMesh.receiveShadow = true;
    houseMesh.customDepthMaterial = createBuildingDepthMaterial(uniforms);
    houseMesh.name = "paper-buildings";
    houseMesh.visible = housePieces.length > 0;

    // ---- cardboard stands + soft contact shadows
    const standMesh = createStandMesh(stands.length);
    stands.forEach((s, i) => {
      _t.crossVectors(s.n, s.right); // forward such that (t × n) = right
      frameMatrix(s.n, _t, s.pos, _m);
      _m.scale(_s.set(s.sx, s.sy, s.sz));
      standMesh.setMatrixAt(i, _m);
    });
    standMesh.instanceMatrix.needsUpdate = true;
    const contact = createContactShadows(stands.length, assets.shadow);
    stands.forEach((s, i) => {
      _t.crossVectors(s.n, s.right);
      _p.copy(s.pos).addScaledVector(s.n, 0.035);
      frameMatrix(s.n, _t, _p, _m);
      _m.scale(_s.set(s.sx * 2.4 + 0.3, 1, s.sz * 2.4 + 0.3));
      contact.setMatrixAt(i, _m);
    });
    contact.instanceMatrix.needsUpdate = true;
    return { cardMesh, houseMesh, standMesh, contact, cardCount, houseCount: housePieces.length, standCount: stands.length };
  }, [runtime, pieces, assets, uniforms]);

  useEffect(
    () => () => {
      for (const m of [built.cardMesh, built.houseMesh, built.standMesh, built.contact]) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
        (m.customDepthMaterial as THREE.Material | undefined)?.dispose();
      }
    },
    [built],
  );

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { __wgPaper: unknown }).__wgPaper = { pieces: pieces.length, cards: built.cardCount, buildings: built.houseCount, stands: built.standCount };
    }
  }, [pieces, built]);

  useFrame((state, dt) => {
    updateCardUniforms(uniforms, state, dt, playerRef.current);
    // Contact shadows soften under clouds and at night (lighter when real shadows are on).
    const real = state.gl.shadowMap.enabled ? 0.55 : 1;
    (built.contact.material as THREE.MeshBasicMaterial).opacity = (0.5 + 0.45 * environment.daylight * (1 - environment.clouds * 0.4)) * real;
  });

  return (
    <>
      <primitive object={built.cardMesh} />
      <primitive object={built.houseMesh} />
      <primitive object={built.standMesh} />
      <primitive object={built.contact} />
      <FlatItems runtime={runtime} />
      <PaperAmbient runtime={runtime} playerRef={playerRef} />
      <DevRuntimeHandle runtime={runtime} />
      <NightLights runtime={runtime} mode="paper" />
      <Ripples runtime={runtime} />
    </>
  );
}

/** Lily pads and the picnic blanket lie flat on the ground or water. */
export function FlatItems({ runtime }: { runtime: WorldRuntime }) {
  const flats = useMemo(() => runtime.layout.items.filter((it) => it.flat), [runtime]);
  const padGeo = useMemo(() => new THREE.CircleGeometry(0.5, 20, 0.35, Math.PI * 2 - 0.5).rotateX(-Math.PI / 2), []);
  const blanketGeo = useMemo(() => new THREE.PlaneGeometry(1, 0.75).rotateX(-Math.PI / 2), []);
  const blanketTex = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#fff7ea";
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = "#e8564f";
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if ((x + y) % 2 === 0) ctx.fillRect(x * 16, y * 16, 16, 16);
    ctx.strokeStyle = "#2b2320";
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, 122, 122);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);
  const outline = useMemo(() => createOutlineMaterial(0.03), []);
  return (
    <group>
      {flats.map((it, i) => {
        basePoint(runtime, it, _p);
        _p.addScaledVector(it.n, it.onWater ? 0.03 : 0.05);
        // Any tangent works for flat items; derive one from the item's yaw.
        _t.set(Math.cos(it.yaw), Math.sin(it.yaw), 0.3);
        _t.addScaledVector(it.n, -_t.dot(it.n)).normalize();
        const m = frameMatrix(it.n, _t, _p, new THREE.Matrix4());
        const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3();
        m.decompose(pos, quat, scl);
        const s = it.size;
        if (it.art === "lilypad") {
          return (
            <group key={i} position={pos} quaternion={quat} scale={[s, 1, s]}>
              <mesh geometry={padGeo} material={toonMaterial(i % 2 ? "#6cbf5a" : "#7fcf63")} receiveShadow />
              <mesh geometry={padGeo} material={outline} scale={[1.06, 1, 1.06]} position={[0, -0.01, 0]} />
              {i % 3 === 0 && <Blossom />}
            </group>
          );
        }
        return (
          <group key={i} position={pos} quaternion={quat} scale={[s, 1, s]}>
            <mesh geometry={blanketGeo} receiveShadow>
              <meshLambertMaterial map={blanketTex} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

function Blossom() {
  return (
    <mesh position={[0.1, 0.08, 0.05]} scale={[0.16, 0.12, 0.16]}>
      <sphereGeometry args={[1, 10, 8]} />
      <meshToonMaterial color="#ffb3c7" />
    </mesh>
  );
}

/**
 * Ambient paper animals (cows, ducks, butterflies…): single cards turned
 * along their heading (side view — the drawing faces the way they walk, and
 * from the other side the paper shows it mirrored, walking the other way).
 * In planet view they turn toward the camera for readability. Walkers stand
 * on little cardboard stands that travel with them.
 */
function PaperAmbient({ runtime, playerRef }: { runtime: WorldRuntime; playerRef: React.RefObject<THREE.Vector3> }) {
  const assets = getAssets();
  const agents = runtime.ambient;
  const uniforms = useMemo(() => createCardUniforms(assets.atlasTexture), [assets]);
  const walkers = useMemo(() => agents.map((a, i) => (a.behavior === "walk" ? i : -1)).filter((i) => i >= 0), [agents]);
  const { mesh, cards, widths, anchors, stands } = useMemo(() => {
    const cards = buildCardGeometry(agents.length);
    const widths: number[] = [];
    const anchors: number[] = [];
    agents.forEach((a, i) => {
      const art = runtime.layout.ambient[i].art as SceneryArtId;
      const base = assets.atlas.entries[art];
      const e = base ? pickVariant(base, 1000 + i) : null;
      const w = e ? a.size * e.aspect : 0;
      widths.push(w);
      anchors.push(e ? -e.anchorY * a.size : 0);
      cards.size.setXY(i, w, e ? a.size : 0);
      if (e) cards.uv.setXYZW(i, e.u0, e.v0, e.u1, e.v1);
      const stats = e ? artStats(assets.atlas, e) : null;
      const back = stats ? paperBackTint(stats) : [0.9, 0.85, 0.75];
      cards.back.setXYZ(i, back[0], back[1], back[2]);
      cards.extra.setXYZW(i, 0, hash01(i + 500), 0, 2);
    });
    cards.center.setUsage(THREE.DynamicDrawUsage);
    cards.right.setUsage(THREE.DynamicDrawUsage);
    cards.params.setUsage(THREE.DynamicDrawUsage);
    cards.size.setUsage(THREE.DynamicDrawUsage);
    const mesh = new THREE.Mesh(cards.geo, createCardMaterial(uniforms, { faceCamera: true }));
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.customDepthMaterial = createCardDepthMaterial(uniforms, { faceCamera: true });
    mesh.name = "paper-ambient";
    const stands = createStandMesh(walkers.length);
    stands.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    return { mesh, cards, widths, anchors, stands };
  }, [runtime, agents, assets, uniforms, walkers]);

  useEffect(
    () => () => {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      (mesh.customDepthMaterial as THREE.Material | undefined)?.dispose();
      stands.geometry.dispose();
      (stands.material as THREE.Material).dispose();
    },
    [mesh, stands],
  );

  const SH = 0.05;
  useFrame((state, dt) => {
    updateCardUniforms(uniforms, state, dt, playerRef.current);
    agents.forEach((a: Agent, i) => {
      const walker = a.behavior === "walk";
      cards.center.setXYZ(i, a.pos.x, a.pos.y, a.pos.z);
      cards.right.setXYZ(i, a.t.x, a.t.y, a.t.z);
      let lift = 0;
      if (walker) lift = Math.abs(Math.sin(a.phase * 8)) * 0.12 * a.moveAmount + SH;
      if (a.behavior === "float") lift = Math.sin(a.phase * 2) * 0.05 - 0.12;
      const flap = a.behavior === "flutter" || a.behavior === "fly" ? 0.75 + 0.25 * Math.abs(Math.sin(a.phase * (a.behavior === "flutter" ? 14 : 8))) : 1;
      cards.size.setX(i, widths[i] * flap);
      // A little rocking bow while walking; wings flex while flying.
      const bow = walker ? Math.sin(a.phase * 8) * 0.15 * a.moveAmount : flap < 1 ? (1 - flap) * 1.2 : 0.1;
      cards.params.setXYZW(i, 0, (i * 1.7) % 6.28, bow, lift + (walker ? anchors[i] : 0));
    });
    walkers.forEach((ai, j) => {
      const a = agents[ai];
      // Stands stay on the ground while the animal hops on them.
      const ground = runtime.terrain.heightAt(a.n) - 0.02;
      _p.copy(a.n).multiplyScalar(ground);
      _r.copy(a.t);
      _t.crossVectors(a.n, _r);
      frameMatrix(a.n, _t, _p, _m);
      const w = widths[ai];
      _m.scale(_s.set(Math.max(0.15, w * 0.42), SH + 0.02, Math.max(0.1, w * 0.2)));
      stands.setMatrixAt(j, _m);
    });
    stands.instanceMatrix.needsUpdate = true;
    cards.center.needsUpdate = true;
    cards.right.needsUpdate = true;
    cards.params.needsUpdate = true;
    cards.size.needsUpdate = true;
  });

  return (
    <>
      <primitive object={mesh} />
      <primitive object={stands} />
    </>
  );
}
