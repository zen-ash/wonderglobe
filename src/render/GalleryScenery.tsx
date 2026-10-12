"use client";
// Miniature Gallery World scenery: colourful outlined 3D shapes, instanced per
// primitive. Ambient animals and gallery visitors are dynamic batches.

import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { WorldRuntime } from "@/world/runtime";
import type { Agent } from "@/world/agents";
import { WATER_LEVEL } from "@/world/planet";
import { frameMatrix } from "@/world/sphere";
import { recipeFor, createShapeBatches, partMatrix, isSeasonalPart, seasonalColor, handCut, createHandCutMaterial, type Part, type Prim } from "./shapes";
import { REGIONS, type RegionKind } from "@/world/planet";
import { angleBetween, randomInCap, PLANET_RADIUS } from "@/world/sphere";
import { mulberry32 } from "@/world/noise";
import { PoseClock } from "./creatures/stopMotion";
import { useRealShadows } from "./creatures/paperCard";
import { FlatItems } from "./PaperScenery";
import { getAssets } from "./assets";
import { environment, type Season } from "@/world/environment";
import { NightLights } from "./NightLights";
import { Ripples } from "./WaterRipples";
import { DevRuntimeHandle } from "./atmosphere/devHandle";

const _frame = new THREE.Matrix4();
const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _t = new THREE.Vector3();
const _c = new THREE.Color();

function yawTangent(n: THREE.Vector3, yaw: number, out: THREE.Vector3) {
  out.set(0, 1, 0).addScaledVector(n, -n.y);
  if (out.lengthSq() < 1e-4) out.set(1, 0, 0).addScaledVector(n, -n.x);
  out.normalize();
  const b = new THREE.Vector3().crossVectors(n, out);
  return out.multiplyScalar(Math.cos(yaw)).addScaledVector(b, Math.sin(yaw)).normalize();
}

export function GalleryScenery({ runtime }: { runtime: WorldRuntime }) {
  const built = useMemo(() => {
    const items = runtime.layout.items.filter((it) => !it.flat);
    const counts: Partial<Record<Prim, number>> = {};
    for (const it of items) for (const part of recipeFor(it.art)) counts[part.prim] = (counts[part.prim] ?? 0) + 1;
    const b = createShapeBatches(counts);
    const seasonal: Array<{ prim: Prim; slot: number; part: Part; seed: number }> = [];
    let itemIndex = 0;
    for (const it of items) {
      itemIndex++;
      const h = runtime.terrain.heightAt(it.n);
      _p.copy(it.n).multiplyScalar(it.onWater ? Math.max(h, WATER_LEVEL) : h - 0.05);
      yawTangent(it.n, it.yaw, _t);
      frameMatrix(it.n, _t, _p, _frame);
      for (const part of recipeFor(it.art)) {
        partMatrix(_frame, part, it.size, _m);
        const slot = b[part.prim].push(_m, _c.set(seasonalColor(part, environment.season, itemIndex)));
        if (isSeasonalPart(part)) seasonal.push({ prim: part.prim, slot, part, seed: itemIndex });
      }
    }
    Object.values(b).forEach((x) => x.commit());
    return { batches: b, seasonal, season: { current: environment.season as Season } };
  }, [runtime]);
  const batches = built.batches;

  useEffect(() => () => Object.values(batches).forEach((b) => b.dispose()), [batches]);

  // Recolour leafy canopies if the season changes (autumn reds and golds).
  useFrame(() => {
    if (built.season.current === environment.season) return;
    built.season.current = environment.season;
    for (const s of built.seasonal) built.batches[s.prim].setColor(s.slot, _c.set(seasonalColor(s.part, environment.season, s.seed)));
    Object.values(built.batches).forEach((x) => x.mesh.instanceColor && (x.mesh.instanceColor.needsUpdate = true));
  });

  return (
    <>
      {Object.values(batches).map((b, i) => (
        <group key={i}>
          <primitive object={b.mesh} />
          <primitive object={b.outline} />
        </group>
      ))}
      <GroundShadows runtime={runtime} />
      <FlowerBeds runtime={runtime} />
      <FlatItems runtime={runtime} />
      <DynamicCritters runtime={runtime} />
      <DevRuntimeHandle runtime={runtime} />
      <NightLights runtime={runtime} mode="gallery" />
      <Ripples runtime={runtime} />
    </>
  );
}

function GroundShadows({ runtime }: { runtime: WorldRuntime }) {
  const mesh = useMemo(() => {
    const big = runtime.layout.items.filter((it) => !it.flat && it.radius > 0.3);
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ map: getAssets().shadow, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const inst = new THREE.InstancedMesh(geo, mat, Math.max(1, big.length));
    big.forEach((it, i) => {
      _p.copy(it.n).multiplyScalar(runtime.terrain.heightAt(it.n) + 0.05);
      yawTangent(it.n, 0, _t);
      frameMatrix(it.n, _t, _p, _m);
      const w = it.radius * 3.2;
      _m.scale(new THREE.Vector3(w, 1, w));
      inst.setMatrixAt(i, _m);
    });
    inst.count = big.length;
    inst.frustumCulled = false;
    return inst;
  }, [runtime]);
  const real = useRealShadows();
  useFrame(() => {
    // With real sun shadows on, the blob only darkens the contact a little.
    (mesh.material as THREE.MeshBasicMaterial).opacity = (0.55 + 0.45 * environment.daylight * (1 - environment.clouds * 0.4)) * (real ? 0.5 : 1);
  });
  return <primitive object={mesh} />;
}

/** Visitor recipe: little people with a body, head, hair and legs. */
const VISITOR_COLORS = ["#ef5b5b", "#6aa8ff", "#ffd447", "#8fd16a", "#c38bff", "#ff9f5a"];
const SKIN = ["#f6d2b4", "#e0b08c", "#a8774f", "#7a5032"];
const HAIR = ["#3a302b", "#8a5a3c", "#f2c94c", "#d9493f"];

function visitorParts(i: number): Part[] {
  const shirt = VISITOR_COLORS[i % VISITOR_COLORS.length];
  const skin = SKIN[(i * 7) % SKIN.length];
  const hair = HAIR[(i * 3) % HAIR.length];
  return [
    { prim: "cyl", color: "#4a5a8a", p: [0.09, 0.14, 0], s: [0.06, 0.28, 0.06] },
    { prim: "cyl", color: "#4a5a8a", p: [-0.09, 0.14, 0], s: [0.06, 0.28, 0.06] },
    { prim: "cone", color: shirt, p: [0, 0.45, 0], s: [0.22, 0.4, 0.2] },
    { prim: "sphere", color: skin, p: [0, 0.76, 0], s: [0.16, 0.16, 0.16] },
    { prim: "sphere", color: hair, p: [0, 0.83, -0.03], s: [0.165, 0.11, 0.165] },
  ];
}

/** Ambient animals + visitors as dynamic instanced shapes. */
function DynamicCritters({ runtime }: { runtime: WorldRuntime }) {
  const setup = useMemo(() => {
    const entries: Array<{ agent: Agent; parts: Part[]; slots: number[]; kind: "ambient" | "visitor"; art: string }> = [];
    runtime.ambient.forEach((a, i) => {
      const art = runtime.layout.ambient[i].art;
      entries.push({ agent: a, parts: recipeFor(art), slots: [], kind: "ambient", art });
    });
    runtime.visitors.forEach((a, i) => entries.push({ agent: a, parts: visitorParts(i), slots: [], kind: "visitor", art: "visitor" }));
    const counts: Partial<Record<Prim, number>> = {};
    for (const e of entries) for (const p of e.parts) counts[p.prim] = (counts[p.prim] ?? 0) + 1;
    const batches = createShapeBatches(counts, true);
    const ident = new THREE.Matrix4();
    for (const e of entries) for (const p of e.parts) e.slots.push(batches[p.prim].push(ident, _c.set(p.color)));
    Object.values(batches).forEach((b) => b.commit());
    return { entries, batches };
  }, [runtime]);

  const dirs = useMemo(() => setup.entries.map(() => new THREE.Vector3()), [setup]);
  // Stop-motion: poses (bob, rock, flap) are held between frames ~12 times a second.
  const held = useMemo(() => ({ clock: new PoseClock(), phase: setup.entries.map((e) => e.agent.phase), move: setup.entries.map(() => 0) }), [setup]);

  useFrame((state) => {
    const calm = runtime.reducedMotion;
    const amp = calm ? 0.4 : 1;
    if (held.clock.advance(state.clock.elapsedTime, calm)) {
      setup.entries.forEach((e, idx) => {
        held.phase[idx] = e.agent.phase;
        held.move[idx] = e.agent.moveAmount;
      });
    }
    setup.entries.forEach((e, idx) => {
      const a = e.agent;
      const ph = held.phase[idx];
      const mv = held.move[idx] * amp;
      // Animals are modelled facing +x; turn them so +x follows their heading.
      const fwd = dirs[idx].copy(a.t);
      const right = _t.crossVectors(fwd, a.n);
      const side = e.kind === "visitor" ? fwd.negate() : right.negate(); // visitors face +z
      _p.copy(a.pos);
      let bob = 0, rockZ = 0, rockX = 0;
      if (a.behavior === "walk") {
        if (e.kind === "visitor") {
          // People walk front-on: rock from foot to foot with little hops.
          const s = ph * 9;
          bob = Math.abs(Math.sin(s)) * 0.08 * mv;
          rockZ = Math.sin(s) * 0.11 * mv;
        } else if (e.art === "chicken") {
          const s = ph * 10;
          bob = Math.abs(Math.sin(s)) * 0.06 * mv;
          rockX = Math.sin(s) * 0.12 * mv;
        } else {
          // Four-legged lope: rise nose-up, land nose-down.
          const s = ph * 6;
          bob = Math.max(0, Math.sin(s)) * 0.1 * mv;
          rockZ = Math.cos(s) * 0.09 * mv;
        }
      }
      if (a.behavior === "float") bob = Math.sin(ph * 2) * 0.04 - 0.2;
      _p.addScaledVector(a.n, bob);
      frameMatrix(a.n, side, _p, _frame);
      if (rockZ) _frame.multiply(_m.makeRotationZ(rockZ));
      if (rockX) _frame.multiply(_m.makeRotationX(rockX));
      if (a.behavior === "flutter" || a.behavior === "fly") {
        const flap = Math.sin(ph * (a.behavior === "flutter" ? 16 : 9));
        _frame.multiply(_m.makeRotationX(flap * 0.25 * amp));
      }
      e.parts.forEach((p, k) => {
        partMatrix(_frame, p, a.size, _m);
        setup.batches[p.prim].set(e.slots[k], _m);
      });
    });
    Object.values(setup.batches).forEach((b) => (b.mesh.instanceMatrix.needsUpdate = true));
  });

  useEffect(() => () => Object.values(setup.batches).forEach((b) => b.dispose()), [setup]);

  return (
    <>
      {Object.values(setup.batches).map((b, i) => (
        <group key={i}>
          <primitive object={b.mesh} />
          <primitive object={b.outline} />
        </group>
      ))}
      <VisitorEmotes runtime={runtime} />
    </>
  );
}

const EMOJI_COLORS: Record<string, string> = { wow: "#ffd447", heart: "#ff6f91", note: "#9fd3ff" };

/** Speech-bubble emotes above visitors who are reacting to new artwork. */
function VisitorEmotes({ runtime }: { runtime: WorldRuntime }) {
  const textures = useMemo(() => {
    const make = (label: string, color: string) => {
      const c = document.createElement("canvas");
      c.width = c.height = 128;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#fffdf6";
      ctx.strokeStyle = "#2b2320";
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.ellipse(64, 56, 50, 42, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(52, 94);
      ctx.lineTo(60, 120);
      ctx.lineTo(74, 94);
      ctx.fill();
      ctx.fillStyle = color;
      ctx.font = "bold 58px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = 5;
      ctx.strokeText(label, 64, 58);
      ctx.fillText(label, 64, 58);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };
    return { wow: make("!", EMOJI_COLORS.wow), heart: make("♥", EMOJI_COLORS.heart), note: make("♪", EMOJI_COLORS.note) } as Record<string, THREE.Texture>;
  }, []);
  const sprites = useMemo(
    () =>
      runtime.visitors.map(() => {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: textures.wow, depthWrite: false }));
        s.visible = false;
        s.scale.set(0.9, 0.9, 1);
        return s;
      }),
    [runtime, textures],
  );
  useFrame(() => {
    runtime.visitors.forEach((a, i) => {
      const s = sprites[i];
      s.visible = !!a.emote;
      if (!a.emote) return;
      const map = textures[a.emote] ?? textures.wow;
      if (s.material.map !== map) s.material.map = map;
      const pop = Math.min(1, a.emoteTimer * 2);
      s.scale.setScalar(0.9 * pop);
      s.position.copy(a.pos).addScaledVector(a.n, a.size * 1.25 + Math.sin(a.phase * 4) * 0.08);
    });
  });
  return (
    <group>
      {sprites.map((s, i) => (
        <primitive key={i} object={s} />
      ))}
    </group>
  );
}

// ------------------------------------------------------------- flower beds

/** Bed palettes (head colours). */
const BED_PALETTES = [
  ["#ef5b5b", "#ff9f43", "#ffd447"],
  ["#ff8fc2", "#c38bff", "#fbf7ee"],
  ["#6aa8ff", "#b07cf0", "#fbf7ee"],
  ["#ffd447", "#fbf7ee", "#ff8fc2"],
  ["#ff6f91", "#ef5b5b", "#ffc2d6"],
];
const STEMS = ["#4f9e47", "#5aa84d", "#468f40"];
/** Beds per region (region centres). */
const REGION_BEDS: Partial<Record<RegionKind, number>> = { garden: 8, meadow: 10, cherry: 6, picnic: 6, village: 5, farm: 3, forest: 2, lily: 4, duckpond: 4, coast: 2, lake: 2 };
const FLOWERY = /^(flower_|tulip|sunflower|daisy|wildflowers)/;
const MAX_FLOWERS = 3200;

interface FlowerSpot {
  n: THREE.Vector3;
  h: number;
  height: number;
  head: number;
  yaw: number;
  tilt: number;
  color: string;
  stem: string;
}

/**
 * Deterministic flower-bed spots on grass: around region centres, along the
 * edges of the village and garden paths, and around flowery scenery.
 */
export function flowerBedSpots(runtime: WorldRuntime): FlowerSpot[] {
  const rng = mulberry32((runtime.seed ^ 0x0f10e5) >>> 0);
  const solids = runtime.layout.items.filter((it) => !it.flat && it.radius > 0.2);
  const beds: Array<{ c: THREE.Vector3; r: number; palette: string[] }> = [];
  const pick = () => BED_PALETTES[Math.floor(rng() * BED_PALETTES.length)];
  const grassAt = (n: THREE.Vector3) => {
    const s = runtime.terrain.sample(n);
    return s.water < 0 && s.ground === "grass";
  };
  const tmp = new THREE.Vector3();
  // Around region centres.
  for (const region of REGIONS) {
    const count = REGION_BEDS[region.id] ?? 0;
    for (let i = 0; i < count; i++) {
      const c = randomInCap(region.center, 0.26, rng, new THREE.Vector3(), 0.03);
      if (grassAt(c)) beds.push({ c, r: 0.6 + rng() * 0.9, palette: pick() });
    }
  }
  // Along the worn paths (village spokes, garden ring).
  for (const id of ["village", "garden"] as RegionKind[]) {
    const center = REGIONS.find((r) => r.id === id)!.center;
    let made = 0;
    for (let tries = 0; tries < 160 && made < 12; tries++) {
      const c = randomInCap(center, 0.3, rng, new THREE.Vector3(), 0.03);
      if (!grassAt(c)) continue;
      // A path within about half a step?
      let nearPath = false;
      for (let k = 0; k < 6 && !nearPath; k++) {
        const s = runtime.terrain.sample(randomInCap(c, 0.035, rng, tmp, 0.02));
        nearPath = s.ground === "path";
      }
      if (!nearPath) continue;
      beds.push({ c, r: 0.45 + rng() * 0.35, palette: pick() });
      made++;
    }
  }
  // Around flowery scenery.
  for (const it of runtime.layout.items) {
    if (it.flat || !FLOWERY.test(it.art) || rng() > 0.35) continue;
    beds.push({ c: it.n.clone(), r: 0.5 + rng() * 0.5, palette: pick() });
  }

  const spots: FlowerSpot[] = [];
  for (const bed of beds) {
    if (spots.length >= MAX_FLOWERS) break;
    const capAngle = bed.r / PLANET_RADIUS;
    const near = solids.filter((it) => angleBetween(it.n, bed.c) * PLANET_RADIUS < bed.r + it.radius + 0.2);
    const count = Math.min(48, Math.round(10 + bed.r * bed.r * 18));
    for (let i = 0; i < count && spots.length < MAX_FLOWERS; i++) {
      // Denser toward the middle of the bed.
      const n = randomInCap(bed.c, capAngle * Math.sqrt(rng()), rng, new THREE.Vector3());
      const s = runtime.terrain.sample(n);
      if (s.water >= 0 || s.ground !== "grass") continue;
      if (near.some((it) => angleBetween(it.n, n) * PLANET_RADIUS < it.radius * 0.9 + 0.1)) continue;
      spots.push({
        n,
        h: s.height,
        height: 0.14 + rng() * 0.2,
        head: 0.05 + rng() * 0.035,
        yaw: rng() * Math.PI * 2,
        tilt: (rng() - 0.5) * 0.35,
        color: bed.palette[Math.floor(rng() * bed.palette.length)],
        stem: STEMS[Math.floor(rng() * STEMS.length)],
      });
    }
  }
  return spots;
}

/** Dense little beds of tiny faceted 3D flowers (instanced; receive shadows only). */
function FlowerBeds({ runtime }: { runtime: WorldRuntime }) {
  const built = useMemo(() => {
    const spots = flowerBedSpots(runtime);
    const stemGeo = new THREE.CylinderGeometry(1, 1, 1, 4, 1);
    stemGeo.translate(0, 0.5, 0);
    const stem = handCut(stemGeo, 0, 3).fill;
    const head = handCut(new THREE.IcosahedronGeometry(1, 0), 0.14, 5, [1, 1, 1], 0.22).fill;
    stemGeo.dispose();
    const stemMat = createHandCutMaterial();
    const headMat = createHandCutMaterial();
    const count = Math.max(1, spots.length);
    const stems = new THREE.InstancedMesh(stem, stemMat, count);
    const heads = new THREE.InstancedMesh(head, headMat, count);
    const frame = new THREE.Matrix4(), local = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    const pos = new THREE.Vector3(), scl = new THREE.Vector3(), t = new THREE.Vector3(), col = new THREE.Color();
    spots.forEach((f, i) => {
      yawTangent(f.n, f.yaw, t);
      pos.copy(f.n).multiplyScalar(f.h - 0.02);
      frameMatrix(f.n, t, pos, frame);
      q.setFromEuler(e.set(f.tilt, 0, f.tilt * 0.5));
      local.compose(pos.set(0, 0, 0), q, scl.set(0.014, f.height, 0.014));
      stems.setMatrixAt(i, _m.multiplyMatrices(frame, local));
      stems.setColorAt(i, col.set(f.stem));
      // Head at the (tilted) stem top, a little flattened.
      pos.set(0, f.height, 0).applyQuaternion(q);
      local.compose(pos, q, scl.set(f.head, f.head * 0.6, f.head));
      heads.setMatrixAt(i, _m.multiplyMatrices(frame, local));
      heads.setColorAt(i, col.set(f.color).offsetHSL(0, 0, (((i * 7919) % 13) / 13 - 0.5) * 0.08));
    });
    for (const m of [stems, heads]) {
      m.count = spots.length;
      m.frustumCulled = false;
      m.receiveShadow = true;
      m.castShadow = false;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    return { stems, heads, dispose: () => [stem, head, stemMat, headMat].forEach((x) => x.dispose()) };
  }, [runtime]);
  useEffect(() => () => built.dispose(), [built]);
  return (
    <>
      <primitive object={built.stems} />
      <primitive object={built.heads} />
    </>
  );
}
