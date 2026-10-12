"use client";
// Shelly the guide snail, slowly following a few steps behind the player:
// a paper cut-out in the paper world, a little outlined 3D snail in the
// gallery world. Tap her (see collectiblePickables / onGamePick) to hear
// what she has to say.

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { WorldMode } from "@/core/types";
import type { WorldRuntime } from "@/world/runtime";
import { WATER_LEVEL } from "@/world/planet";
import { angleBetween, moveAlong, orthonormalize, tangentToward, PLANET_RADIUS } from "@/world/sphere";
import { shellyCanvas } from "@/art/guide";
import { useGameUi } from "@/game/state";
import { getAssets } from "./assets";
import { createOutlineMaterial, toonMaterial } from "./materials";
import { collectiblePickables, GUIDE_PICK_ID } from "./Collectibles";
import { PoseClock, PaperFlip, stepTime, walkPose, restPose, type PuppetPose } from "./creatures/stopMotion";
import { createStandMesh, useRealShadows, blobStrength } from "./creatures/paperCard";

const SIZE = 1.15;
const FOLLOW = 2.6; // world units behind the player
const _want = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _toCam = new THREE.Vector3();
const _x = new THREE.Vector3();
const _z = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _camRight = new THREE.Vector3();

let shellyTex: [THREE.Texture, THREE.Texture] | null = null;
function textures(): [THREE.Texture, THREE.Texture] {
  if (!shellyTex) {
    const make = (blink: boolean): THREE.Texture => {
      const t = new THREE.CanvasTexture(shellyCanvas(256, blink));
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      return t;
    };
    shellyTex = [make(false), make(true)];
  }
  return shellyTex;
}

let newsTex: THREE.Texture | null = null;
function newsTexture(): THREE.Texture {
  if (newsTex) return newsTex;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fffdf6";
  ctx.strokeStyle = "#2b2320";
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.arc(64, 58, 44, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(50, 98);
  ctx.lineTo(42, 122);
  ctx.lineTo(72, 100);
  ctx.fill();
  ctx.fillStyle = "#ef5b5b";
  ctx.font = "900 68px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("!", 64, 62);
  newsTex = new THREE.CanvasTexture(c);
  newsTex.colorSpace = THREE.SRGBColorSpace;
  return newsTex;
}

export function GuideSnail({ runtime, mode, reducedMotion }: { runtime: WorldRuntime; mode: WorldMode; reducedMotion?: boolean }) {
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const news = useRef<THREE.Sprite>(null);
  const state = useMemo(() => {
    const n = runtime.player.n.clone();
    const t = runtime.player.t.clone().negate();
    moveAlong(n, t, FOLLOW);
    t.negate();
    orthonormalize(n, t);
    return { n, t, moving: 0, phase: 0, facing: 1, blinkAt: 2 };
  }, [runtime]);
  // Stop-motion pose (held between frames) and the paper flip when she turns.
  const anim = useMemo(() => ({ clock: new PoseClock(), flip: new PaperFlip(1), pose: restPose({} as PuppetPose), phase: 0, move: 0, time: 0, yaw: 0, mirror: 1 }), []);
  const stand = useMemo(() => {
    const m = createStandMesh();
    m.scale.set(0.8, 1, 0.42);
    return m;
  }, []);
  const realShadows = useRealShadows();
  const shadowRef = useRef<THREE.Mesh>(null);
  const [open, blink] = textures();
  const cardMat = useMemo(() => new THREE.MeshBasicMaterial({ map: open, alphaTest: 0.5, side: THREE.DoubleSide }), [open]);
  const shadowMat = useMemo(() => new THREE.MeshBasicMaterial({ map: getAssets().shadow, transparent: true, depthWrite: false }), []);
  const newsMat = useMemo(() => new THREE.SpriteMaterial({ map: newsTexture(), transparent: true, depthWrite: false }), []);
  const outline = useMemo(() => createOutlineMaterial(0.03), []);

  useEffect(() => {
    const g = root.current;
    if (!g) return;
    g.userData.pickId = GUIDE_PICK_ID;
    collectiblePickables.set(GUIDE_PICK_ID, g);
    return () => {
      collectiblePickables.delete(GUIDE_PICK_ID);
    };
  }, []);
  useEffect(() => () => {
    cardMat.dispose();
    shadowMat.dispose();
    newsMat.dispose();
  }, [cardMat, shadowMat, newsMat]);

  useFrame((s, rawDt) => {
    const g = root.current;
    if (!g) return;
    const dt = Math.min(rawDt, 0.05);
    const p = runtime.player;
    // A spot a few steps behind the player.
    _want.copy(p.n);
    _dir.copy(p.t).negate();
    moveAlong(_want, _dir, FOLLOW);
    const dist = angleBetween(state.n, _want) * PLANET_RADIUS;
    const fromPlayer = angleBetween(state.n, p.n) * PLANET_RADIUS;
    if (fromPlayer > 16) {
      // The player hopped far away: Shelly catches up by magic.
      state.n.copy(_want);
      tangentToward(state.n, p.n, state.t);
    } else if (dist > 0.6 && fromPlayer > FOLLOW * 0.8) {
      tangentToward(state.n, _want, state.t);
      const speed = Math.min(5, 0.8 + dist * 1.1);
      moveAlong(state.n, state.t, Math.min(dist, speed * dt));
      state.moving += (1 - state.moving) * Math.min(1, dt * 6);
    } else {
      state.moving += (0 - state.moving) * Math.min(1, dt * 5);
      if (state.moving < 0.05) tangentToward(state.n, p.n, state.t);
    }
    state.phase += dt * 7 * state.moving;
    const ground = Math.max(runtime.terrain.heightAt(state.n), WATER_LEVEL + 0.05);
    const time = s.clock.elapsedTime;
    if (anim.clock.advance(time, !!reducedMotion)) {
      anim.phase = state.phase;
      anim.move = state.moving;
      anim.time = time;
      anim.yaw = anim.flip.yaw;
      anim.mirror = anim.flip.mirror;
    }
    // A snail inches along: little stretchy hops, held on stop-motion frames.
    const hop = reducedMotion ? 0 : Math.abs(Math.sin(anim.phase)) * 0.16 * anim.move;
    g.position.copy(state.n).multiplyScalar(ground + hop);
    if (shadowRef.current) {
      shadowRef.current.position.y = 0.05 - hop;
      (shadowRef.current.material as THREE.MeshBasicMaterial).opacity = blobStrength(realShadows);
    }

    if (mode === "paper") {
      _toCam.copy(s.camera.position).sub(g.position);
      _z.copy(_toCam).addScaledVector(state.n, -_toCam.dot(state.n));
      if (_z.lengthSq() < 1e-6) _z.copy(state.t);
      _z.normalize();
      _x.crossVectors(state.n, _z).normalize();
      _m.makeBasis(_x, state.n, _z);
      g.quaternion.setFromRotationMatrix(_m);
      _camRight.setFromMatrixColumn(s.camera.matrixWorld, 0);
      const screen = state.t.dot(_camRight);
      if (Math.abs(screen) > 0.2 && state.moving > 0.2) state.facing = screen > 0 ? 1 : -1;
      anim.flip.update(state.facing, dt, reducedMotion ? 0.5 : 0.36);
      const w = walkPose("inch", anim.phase, anim.move, SIZE, reducedMotion ? 0.35 : 1, anim.mirror, anim.pose);
      if (body.current) {
        const breathe = reducedMotion ? 0 : Math.sin(anim.time * 2.2) * 0.025;
        body.current.scale.set(anim.mirror * w.scaleX, (1 + breathe) * w.scaleY, 1);
        body.current.rotation.set(0, anim.yaw, reducedMotion ? 0 : Math.sin(anim.phase) * 0.05 * anim.move);
      }
      // Blink now and then.
      const t = s.clock.elapsedTime;
      if (t > state.blinkAt + 0.14) state.blinkAt = t + 2.5 + Math.random() * 3;
      const wantMap = t > state.blinkAt ? blink : open;
      if (cardMat.map !== wantMap) {
        cardMat.map = wantMap;
        cardMat.needsUpdate = true;
      }
    } else {
      _x.crossVectors(state.n, state.t).normalize();
      _m.makeBasis(_x, state.n, state.t);
      g.quaternion.setFromRotationMatrix(_m);
      if (body.current) body.current.scale.set(1, 1 + (reducedMotion ? 0 : Math.sin(anim.time * 2.2) * 0.03), 1 + Math.sin(anim.phase * 2) * 0.05 * anim.move);
    }
    if (news.current) {
      news.current.visible = useGameUi.getState().guideHasNews && !useGameUi.getState().bubble;
      news.current.position.y = SIZE + 0.45 + (reducedMotion ? 0 : Math.sin(stepTime(s.clock.elapsedTime) * 3) * 0.08);
    }
  });

  return (
    <group ref={root}>
      <mesh ref={shadowRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]} material={shadowMat} renderOrder={1}>
        <planeGeometry args={[1.2, 0.7]} />
      </mesh>
      <group ref={body}>
        {mode === "paper" ? (
          <>
            <mesh position={[0, SIZE / 2 + 0.03, 0]} material={cardMat} castShadow>
              <planeGeometry args={[SIZE, SIZE]} />
            </mesh>
            <primitive object={stand} />
          </>
        ) : (
          <GallerySnail outline={outline} />
        )}
      </group>
      <sprite ref={news} material={newsMat} scale={[0.55, 0.55, 0.55]} position={[0, SIZE + 0.45, 0]} renderOrder={5} visible={false} />
    </group>
  );
}

/** Simple outlined 3D snail (faces +z). */
function GallerySnail({ outline }: { outline: THREE.Material }) {
  const parts = useMemo(
    () => [
      { geo: new THREE.CapsuleGeometry(0.17, 0.75, 4, 10), pos: [0, 0.17, 0.05], rot: [Math.PI / 2, 0, 0], color: "#bfe8a6" },
      { geo: new THREE.SphereGeometry(0.2, 14, 10), pos: [0, 0.36, 0.46], rot: [0, 0, 0], color: "#bfe8a6" },
      { geo: new THREE.TorusGeometry(0.22, 0.14, 10, 20), pos: [0, 0.52, -0.08], rot: [0, Math.PI / 2, 0], color: "#ff9fb2" },
      { geo: new THREE.SphereGeometry(0.11, 10, 8), pos: [0, 0.52, -0.08], rot: [0, 0, 0], color: "#ffd447" },
      { geo: new THREE.CylinderGeometry(0.03, 0.03, 0.26, 6), pos: [0.08, 0.6, 0.52], rot: [0.3, 0, -0.2], color: "#bfe8a6" },
      { geo: new THREE.CylinderGeometry(0.03, 0.03, 0.26, 6), pos: [-0.08, 0.6, 0.52], rot: [0.3, 0, 0.2], color: "#bfe8a6" },
      { geo: new THREE.SphereGeometry(0.06, 10, 8), pos: [0.11, 0.73, 0.57], rot: [0, 0, 0], color: "#fffdf6" },
      { geo: new THREE.SphereGeometry(0.06, 10, 8), pos: [-0.11, 0.73, 0.57], rot: [0, 0, 0], color: "#fffdf6" },
      { geo: new THREE.SphereGeometry(0.03, 8, 6), pos: [0.12, 0.74, 0.62], rot: [0, 0, 0], color: "#2b2320" },
      { geo: new THREE.SphereGeometry(0.03, 8, 6), pos: [-0.12, 0.74, 0.62], rot: [0, 0, 0], color: "#2b2320" },
    ],
    [],
  );
  useEffect(() => () => parts.forEach((p) => p.geo.dispose()), [parts]);
  return (
    <group scale={1.25}>
      {parts.map((p, i) => (
        <group key={i} position={p.pos as [number, number, number]} rotation={p.rot as [number, number, number]}>
          <mesh geometry={p.geo} material={toonMaterial(p.color)} castShadow receiveShadow />
          {i < 4 && <mesh geometry={p.geo} material={outline} />}
        </group>
      ))}
    </group>
  );
}
