"use client";
// Hidden treasures and golden butterflies in the 3D world. Paper cut-out
// billboards in the paper world, little outlined 3D shapes in the gallery
// world. They sparkle when the player is near and are picked up by walking
// close (or tapping them — see `collectiblePickables` / `onGamePick`).

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { WorldMode } from "@/core/types";
import type { WorldRuntime } from "@/world/runtime";
import { angleBetween, PLANET_RADIUS } from "@/world/sphere";
import { useGame } from "@/state/store";
import { iconCutoutCanvas } from "@/art/stickers";
import { getAssets } from "./assets";
import { createOutlineMaterial, toonMaterial } from "./materials";
import { burstStars } from "./Bursts";
import { stepTime } from "./creatures/stopMotion";
import {
  butterflyPoint,
  canCatchButterfly,
  canCollect,
  dayIndex,
  goldenButterflies,
  SPARKLE_RADIUS,
  type ButterflyDef,
  type TreasureDef,
} from "@/game/collectibles";
import { collectFound, treasuresFor } from "@/game/progress";
import { openGuide } from "@/game/guide";

/**
 * Tappable game objects (treasures, butterflies, Shelly). Each object's
 * `userData.pickId` starts with "game:". Include these in the tap raycast and
 * pass a hit id to `onGamePick`.
 */
export const collectiblePickables = new Map<string, THREE.Object3D>();

export const GUIDE_PICK_ID = "game:guide";

export function isGamePickId(id: string | null | undefined): id is string {
  return typeof id === "string" && id.startsWith("game:");
}

/** Handle a tap on a game object. Far treasures make the player walk over. */
export function onGamePick(id: string): void {
  const { runtime, world } = useGame.getState();
  if (!runtime || !world) return;
  if (id === GUIDE_PICK_ID) {
    openGuide();
    return;
  }
  const [, type, rawId] = id.split(":");
  if (type === "treasure") {
    const def = treasuresFor(runtime).find((t) => t.id === rawId);
    if (!def || (world.found ?? []).includes(def.id)) return;
    const near = angleBetween(runtime.player.n, def.n) * PLANET_RADIUS < 7;
    if (def.airborne) {
      if (canCollect(def, runtime.player.pos, runtime.player.n)) grab(def.id, def.pos, def.n);
      return;
    }
    if (near) grab(def.id, def.pos, def.n);
    else runtime.player.target = def.n.clone();
  } else if (type === "butterfly") {
    const obj = collectiblePickables.get(id);
    if (!obj) return;
    const p = obj.getWorldPosition(new THREE.Vector3());
    const n = p.clone().normalize();
    if (angleBetween(runtime.player.n, n) * PLANET_RADIUS < 6) grab(rawId, p, n);
    else runtime.player.target = n;
  }
}

function grab(id: string, pos: THREE.Vector3, up: THREE.Vector3) {
  if (collectFound(id)) burstStars(pos, up, 22);
}

const texCache = new Map<string, THREE.Texture>();
function iconTexture(icon: string): THREE.Texture {
  let t = texCache.get(icon);
  if (!t) {
    t = new THREE.CanvasTexture(iconCutoutCanvas(icon, 192));
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    texCache.set(icon, t);
  }
  return t;
}

const GEM_COLORS: Record<string, string> = {
  key: "#f6c330",
  bottle: "#9fe0c8",
  kite: "#ef5b5b",
  shell: "#ffc9b0",
  acorn: "#b07a45",
  crown: "#f6c330",
  carrot: "#ff9f5a",
  lily: "#ff9fc2",
  pinecone: "#8b5a2b",
  pearl: "#f4efff",
  bell: "#f6c330",
  star: "#ffd447",
};

const _toCam = new THREE.Vector3();
const _x = new THREE.Vector3();
const _z = new THREE.Vector3();
const _m = new THREE.Matrix4();

/** Orient `g` upright on the planet (up = n) and turned toward the camera. */
function faceCamera(g: THREE.Object3D, n: THREE.Vector3, camPos: THREE.Vector3) {
  _toCam.copy(camPos).sub(g.position);
  _z.copy(_toCam).addScaledVector(n, -_toCam.dot(n));
  if (_z.lengthSq() < 1e-6) _z.set(1, 0, 0).addScaledVector(n, -n.x);
  _z.normalize();
  _x.crossVectors(n, _z).normalize();
  _m.makeBasis(_x, n, _z);
  g.quaternion.setFromRotationMatrix(_m);
}

function starShape(r: number): THREE.Shape {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 ? r * 0.45 : r;
    const a = Math.PI / 2 + (i / 10) * Math.PI * 2;
    if (i === 0) s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    else s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  s.closePath();
  return s;
}

export function Collectibles({ runtime, mode, reducedMotion }: { runtime: WorldRuntime; mode: WorldMode; reducedMotion?: boolean }) {
  const found = useGame((s) => s.world?.found);
  const treasures = useMemo(() => treasuresFor(runtime), [runtime]);
  const visible = useMemo(() => treasures.filter((t) => !(found ?? []).includes(t.id)), [treasures, found]);
  const butterflies = useMemo(() => goldenButterflies(runtime.seed, dayIndex(), found ?? []), [runtime.seed, found]);
  const frame = useRef(0);

  // Walking close picks things up (checked a few times a second).
  useFrame(() => {
    if (++frame.current % 5) return;
    const p = runtime.player;
    for (const t of visible) {
      if (canCollect(t, p.pos, p.n)) grab(t.id, t.pos, t.n);
    }
  });

  return (
    <group>
      {visible.map((t) => (
        <Treasure key={t.id} def={t} runtime={runtime} mode={mode} reducedMotion={!!reducedMotion} />
      ))}
      {butterflies.map((b) => (
        <GoldenButterfly key={b.id} def={b} runtime={runtime} mode={mode} reducedMotion={!!reducedMotion} />
      ))}
    </group>
  );
}

function Sparkles({ count = 5, radius = 0.6 }: { count?: number; radius?: number }) {
  const star = getAssets().star;
  const mats = useMemo(
    () => Array.from({ length: count }, (_, i) => new THREE.SpriteMaterial({ map: star, transparent: true, depthWrite: false, color: i % 2 ? "#fff2b0" : "#ffffff" })),
    [star, count],
  );
  const refs = useRef<Array<THREE.Sprite | null>>([]);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    refs.current.forEach((s, i) => {
      if (!s) return;
      const a = t * 0.9 + (i / count) * Math.PI * 2;
      s.position.set(Math.cos(a) * radius, 0.15 + ((i * 0.37 + t * 0.4) % 1) * radius * 1.4, Math.sin(a) * radius);
      const k = 0.5 + 0.5 * Math.sin(t * 5 + i * 1.7);
      s.scale.setScalar(0.08 + 0.2 * k);
      (s.material as THREE.SpriteMaterial).opacity = 0.35 + 0.65 * k;
    });
  });
  useEffect(() => () => mats.forEach((m) => m.dispose()), [mats]);
  return (
    <group>
      {mats.map((m, i) => (
        <sprite key={i} ref={(el) => void (refs.current[i] = el)} material={m} renderOrder={4} />
      ))}
    </group>
  );
}

function Treasure({ def, runtime, mode, reducedMotion }: { def: TreasureDef; runtime: WorldRuntime; mode: WorldMode; reducedMotion: boolean }) {
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const sparkle = useRef<THREE.Group>(null);
  const pickId = `game:treasure:${def.id}`;
  const cardMat = useMemo(() => new THREE.MeshBasicMaterial({ map: iconTexture(def.kind), alphaTest: 0.5, side: THREE.DoubleSide }), [def.kind]);
  const outline = useMemo(() => createOutlineMaterial(0.03), []);
  const gemGeo = useMemo(
    () => (def.kind === "star" ? new THREE.ExtrudeGeometry(starShape(def.size * 0.5), { depth: def.size * 0.18, bevelEnabled: false }).center() : new THREE.OctahedronGeometry(def.size * 0.42, 0)),
    [def.kind, def.size],
  );
  const base = useMemo(() => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), def.n), [def.n]);

  useEffect(() => {
    const g = root.current;
    if (!g) return;
    g.userData.pickId = pickId;
    collectiblePickables.set(pickId, g);
    return () => {
      collectiblePickables.delete(pickId);
    };
  }, [pickId]);
  useEffect(() => () => {
    cardMat.dispose();
    gemGeo.dispose();
  }, [cardMat, gemGeo]);

  useFrame((state) => {
    const g = root.current;
    if (!g) return;
    const t = state.clock.elapsedTime;
    const st = stepTime(t, reducedMotion);
    const bob = reducedMotion ? 0 : Math.sin(st * 2 + def.pos.x) * (def.airborne ? 0.25 : 0.07);
    g.position.copy(def.pos).addScaledVector(def.n, bob);
    const near = runtime.player.pos.distanceTo(def.pos) < (def.airborne ? 14 : SPARKLE_RADIUS);
    if (sparkle.current) sparkle.current.visible = near;
    if (mode === "paper") {
      faceCamera(g, def.n, state.camera.position);
      if (body.current) body.current.rotation.z = reducedMotion ? 0 : Math.sin(st * 1.6 + def.pos.y) * 0.08;
    } else {
      g.quaternion.copy(base);
      if (body.current && !reducedMotion) body.current.rotation.y = t * 1.2;
    }
    // A gentle glow-pulse when the player is close.
    const s = near && !reducedMotion ? 1 + Math.sin(t * 4) * 0.06 : 1;
    g.scale.setScalar(s);
  });

  return (
    <group ref={root}>
      <group ref={body}>
        {mode === "paper" ? (
          <mesh material={cardMat} castShadow>
            <planeGeometry args={[def.size, def.size]} />
          </mesh>
        ) : (
          <>
            <mesh geometry={gemGeo} material={toonMaterial(GEM_COLORS[def.kind] ?? "#ffd447")} castShadow receiveShadow />
            <mesh geometry={gemGeo} material={outline} />
          </>
        )}
      </group>
      <group ref={sparkle} visible={false}>
        <Sparkles count={def.airborne ? 8 : 5} radius={def.size * 0.8} />
      </group>
    </group>
  );
}

function GoldenButterfly({ def, runtime, mode, reducedMotion }: { def: ButterflyDef; runtime: WorldRuntime; mode: WorldMode; reducedMotion: boolean }) {
  const root = useRef<THREE.Group>(null);
  const wings = useRef<THREE.Group>(null);
  const left = useRef<THREE.Group>(null);
  const right = useRef<THREE.Group>(null);
  const pickId = `game:butterfly:${def.id}`;
  const n = useMemo(() => new THREE.Vector3(), []);
  const prev = useMemo(() => new THREE.Vector3(), []);
  const cardMat = useMemo(() => new THREE.MeshBasicMaterial({ map: iconTexture("butterfly"), alphaTest: 0.5, side: THREE.DoubleSide }), []);
  const wingGeo = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(0, 0);
    s.bezierCurveTo(0.25, 0.35, 0.55, 0.3, 0.5, 0.05);
    s.bezierCurveTo(0.5, -0.2, 0.25, -0.35, 0, 0);
    return new THREE.ExtrudeGeometry(s, { depth: 0.03, bevelEnabled: false });
  }, []);
  const outline = useMemo(() => createOutlineMaterial(0.025), []);

  useEffect(() => {
    const g = root.current;
    if (!g) return;
    g.userData.pickId = pickId;
    collectiblePickables.set(pickId, g);
    return () => {
      collectiblePickables.delete(pickId);
    };
  }, [pickId]);
  useEffect(() => () => {
    cardMat.dispose();
    wingGeo.dispose();
  }, [cardMat, wingGeo]);

  useFrame((state) => {
    const g = root.current;
    if (!g) return;
    const t = state.clock.elapsedTime;
    prev.copy(g.position);
    butterflyPoint(def, t, runtime.terrain, g.position, n);
    // Wings beat on stop-motion frames (the flight path stays smooth).
    const flap = reducedMotion ? 0.3 : Math.sin(stepTime(t) * 14);
    if (mode === "paper") {
      faceCamera(g, n, state.camera.position);
      if (wings.current) wings.current.scale.x = 0.35 + 0.65 * Math.abs(flap);
    } else {
      // Face along the flight path.
      _z.copy(g.position).sub(prev);
      _z.addScaledVector(n, -_z.dot(n));
      if (_z.lengthSq() > 1e-8) {
        _z.normalize();
        _x.crossVectors(n, _z).normalize();
        _m.makeBasis(_x, n, _z);
        g.quaternion.setFromRotationMatrix(_m);
      }
      if (left.current) left.current.rotation.z = 0.2 + flap * 0.8;
      if (right.current) right.current.rotation.z = 0.2 + flap * 0.8;
    }
    if (canCatchButterfly(n, runtime.player.n) && Math.abs(runtime.player.pos.length() - g.position.length()) < 3) {
      grab(def.id, g.position.clone(), n.clone());
    }
  });

  return (
    <group ref={root}>
      {mode === "paper" ? (
        <group ref={wings}>
          <mesh material={cardMat} castShadow>
            <planeGeometry args={[0.75, 0.75]} />
          </mesh>
        </group>
      ) : (
        <group scale={0.9}>
          <group ref={left} position={[0.03, 0, 0]}>
            <mesh geometry={wingGeo} material={toonMaterial("#f6c330")} rotation={[Math.PI / 2, 0, 0]} castShadow />
          </group>
          <group rotation={[0, Math.PI, 0]}>
            <group ref={right} position={[0.03, 0, 0]}>
              <mesh geometry={wingGeo} material={toonMaterial("#f6c330")} rotation={[Math.PI / 2, 0, 0]} castShadow />
            </group>
          </group>
          <group rotation={[Math.PI / 2, 0, 0]}>
            <mesh material={toonMaterial("#7a5236")}>
              <capsuleGeometry args={[0.04, 0.28, 4, 8]} />
            </mesh>
            <mesh material={outline}>
              <capsuleGeometry args={[0.04, 0.28, 4, 8]} />
            </mesh>
          </group>
        </group>
      )}
      <Sparkles count={4} radius={0.45} />
    </group>
  );
}
