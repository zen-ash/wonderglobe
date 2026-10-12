"use client";
// The player: a paper kid cut-out (paper world) or a little outlined figure
// (gallery world), plus the click-to-walk target marker. In the paper world
// the child's own drawing can be the player character (world.playerArtworkId).
// While riding a creation the player sits small on top of it.

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { WorldRuntime } from "@/world/runtime";
import { useGame } from "@/state/store";
import { getAssets } from "./assets";
import { createOutlineMaterial, toonMaterial } from "./materials";
import { buildCutoutGeometry } from "./cutoutGeometry";
import { useArtwork } from "./Creations";
import { createPaperCard, createStandMesh, standScale, useRealShadows, blobStrength } from "./creatures/paperCard";
import { PoseClock, PaperFlip, restPose, stepTime, walkPose, type PuppetPose } from "./creatures/stopMotion";

const _toCam = new THREE.Vector3();
const _x = new THREE.Vector3();
const _z = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _camRight = new THREE.Vector3();

const PLAYER_HEIGHT = 1.7;

const RIDE_SCALE = 0.55;

export function Player({ runtime, mode }: { runtime: WorldRuntime; mode: "paper" | "gallery" }) {
  const assets = getAssets();
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const kid = useRef<THREE.Group>(null);
  const drawn = useRef<THREE.Mesh>(null);
  const shadowRef = useRef<THREE.Mesh>(null);
  const rideBlend = useRef(0);
  const realShadows = useRealShadows();
  const playerArtworkId = useGame((s) => s.world?.playerArtworkId ?? null);
  const art = useArtwork(mode === "paper" ? playerArtworkId : null);
  const drawing = useMemo(() => {
    if (!art) return null;
    const cut = buildCutoutGeometry(art.meta, PLAYER_HEIGHT);
    const card = createPaperCard(art.texture);
    card.uniforms.uHalfWidth.value = cut.halfWidth;
    card.uniforms.uHeight.value = cut.height;
    return { cut, card };
  }, [art]);
  useEffect(
    () => () => {
      if (!drawing) return;
      drawing.cut.geometry.dispose();
      drawing.card.dispose();
    },
    [drawing],
  );
  const cardMat = useMemo(
    () => new THREE.MeshBasicMaterial({ map: assets.player[0], alphaTest: 0.5, side: THREE.DoubleSide, color: "#f7f7f7" }),
    [assets],
  );
  const stand = useMemo(() => createStandMesh(), []);
  const standBase = useMemo(() => standScale(drawing ? drawing.cut.width : PLAYER_HEIGHT * assets.playerAspect, new THREE.Vector3()), [drawing, assets]);
  const anim = useMemo(
    () => ({ clock: new PoseClock(), flip: new PaperFlip(1), pose: restPose({} as PuppetPose), phase: 0, move: 0, above: 0, yaw: 0, mirror: 1, frame: 0, time: 0 }),
    [],
  );
  const shadowMat = useMemo(() => new THREE.MeshBasicMaterial({ map: assets.shadow, transparent: true, depthWrite: false }), [assets]);
  const outline = useMemo(() => createOutlineMaterial(0.03), []);

  useFrame((state, rawDt) => {
    const g = root.current;
    if (!g) return;
    const dt = Math.min(rawDt, 0.05);
    const t = state.clock.elapsedTime;
    const calm = runtime.reducedMotion;
    const amp = calm ? 0.35 : 1;
    const p = runtime.player;
    const n = p.n;
    // Riding: shrink and sit on the creature (a touch toward the camera so we're in front of it).
    const riding = !!runtime.riding;
    rideBlend.current += ((riding ? 1 : 0) - rideBlend.current) * Math.min(1, dt * 6);
    const rb = rideBlend.current;
    g.scale.setScalar(1 - (1 - RIDE_SCALE) * rb);
    // Stop-motion: hold the walk pose (and the hop height) between frames.
    const groundH = Math.max(runtime.terrain.heightAt(n), runtime.grid.deckAt(n));
    const above = Math.max(0, p.pos.length() - groundH);
    if (anim.clock.advance(t, calm)) {
      anim.phase = p.phase;
      anim.move = p.moving;
      anim.above = above;
      anim.yaw = anim.flip.yaw;
      anim.mirror = anim.flip.mirror;
      anim.time = t;
      anim.frame = p.moving > 0.3 && Math.sin(p.phase) > 0 ? 1 : 0;
    }
    const held = riding ? 0 : (calm ? 0.3 : 1) * anim.above - above;
    g.position.copy(p.pos).addScaledVector(n, held);
    if (shadowRef.current) {
      shadowRef.current.visible = rb < 0.5;
      shadowRef.current.position.y = 0.05 - (above + held);
      shadowMat.opacity = blobStrength(realShadows);
    }
    if (mode === "paper") {
      _toCam.copy(state.camera.position).sub(p.pos);
      _z.copy(_toCam).addScaledVector(n, -_toCam.dot(n));
      if (_z.lengthSq() < 1e-6) _z.copy(p.t);
      _z.normalize();
      _x.crossVectors(n, _z).normalize();
      _m.makeBasis(_x, n, _z);
      g.quaternion.setFromRotationMatrix(_m);
      _camRight.setFromMatrixColumn(state.camera.matrixWorld, 0);
      const screen = p.t.dot(_camRight);
      if (p.moving > 0.2 && Math.abs(screen) > 0.15) p.screenFacing = screen > 0 ? 1 : -1;
      // Turning around is a paper flip: edge-on, then the other way.
      anim.flip.update(p.screenFacing, dt, calm ? 0.5 : 0.3);
      if (cardMat.map !== assets.player[anim.frame]) {
        cardMat.map = assets.player[anim.frame];
        cardMat.needsUpdate = true;
      }
      // People walk front-on: rock from foot to foot, squash on each landing.
      const w = walkPose("front", anim.phase, anim.move, PLAYER_HEIGHT, amp, 1, anim.pose);
      if (body.current) {
        body.current.scale.set(anim.mirror * w.scaleX, w.scaleY, 1);
        body.current.rotation.set(0, anim.yaw, w.roll + (riding ? Math.sin(stepTime(t, calm) * 3) * 0.05 : 0));
        body.current.position.set(0, 0, rb * 0.35);
      }
      // The child's own drawing replaces the built-in kid when there is one.
      if (kid.current) kid.current.visible = !drawing;
      if (drawn.current && drawing) {
        drawn.current.visible = true;
        const u = drawing.card.uniforms;
        u.uTime.value = anim.time;
        u.uBend.value = w.bend + Math.sin(anim.phase) * 0.06 * anim.move * amp;
      }
      stand.visible = rb < 0.5;
      stand.scale.set(standBase.x, 1 / Math.max(0.5, w.scaleY), standBase.z);
    } else {
      // Face +z along the heading; rock from foot to foot on stop-motion frames.
      _x.crossVectors(n, p.t).normalize();
      _m.makeBasis(_x, n, p.t);
      g.quaternion.setFromRotationMatrix(_m);
      if (body.current) body.current.rotation.z = Math.sin(anim.phase) * 0.1 * anim.move * amp;
    }
  });

  return (
    <group ref={root}>
      <mesh ref={shadowRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]} material={shadowMat} renderOrder={1}>
        <planeGeometry args={[1.3, 0.9]} />
      </mesh>
      {mode === "paper" ? (
        <group ref={body}>
          <group ref={kid}>
            <mesh position={[0, PLAYER_HEIGHT / 2, 0]} material={cardMat} castShadow>
              <planeGeometry args={[PLAYER_HEIGHT * assets.playerAspect, PLAYER_HEIGHT]} />
            </mesh>
          </group>
          {drawing && <mesh ref={drawn} geometry={drawing.cut.geometry} material={drawing.card.materials} customDepthMaterial={drawing.card.depth} castShadow />}
          <primitive object={stand} />
        </group>
      ) : (
        <group ref={body} scale={1.35}>
          {[
            { geo: <cylinderGeometry args={[0.07, 0.07, 0.32, 8]} />, pos: [0.1, 0.16, 0], color: "#3c4a7a" },
            { geo: <cylinderGeometry args={[0.07, 0.07, 0.32, 8]} />, pos: [-0.1, 0.16, 0], color: "#3c4a7a" },
            { geo: <coneGeometry args={[0.26, 0.5, 10]} />, pos: [0, 0.55, 0], color: "#ffd447" },
            { geo: <sphereGeometry args={[0.19, 14, 10]} />, pos: [0, 0.92, 0], color: "#f6d2b4" },
            { geo: <coneGeometry args={[0.2, 0.26, 10]} />, pos: [0, 1.13, 0], color: "#e8564f" },
            { geo: <boxGeometry args={[0.24, 0.26, 0.12]} />, pos: [0, 0.6, -0.2], color: "#5fb85a" },
          ].map((p, i) => (
            <group key={i} position={p.pos as [number, number, number]}>
              <mesh material={toonMaterial(p.color)} castShadow receiveShadow>
                {p.geo}
              </mesh>
              <mesh material={outline}>{p.geo}</mesh>
            </group>
          ))}
        </group>
      )}
      <TargetMarker runtime={runtime} />
    </group>
  );
}

/** A little pulsing paper ring where the player is walking to. */
function TargetMarker({ runtime }: { runtime: WorldRuntime }) {
  const ref = useRef<THREE.Mesh>(null);
  const parentInv = useMemo(() => new THREE.Matrix4(), []);
  useFrame((state) => {
    const m = ref.current;
    if (!m) return;
    const target = runtime.player.target;
    m.visible = !!target;
    if (!target || !m.parent) return;
    // Place in world space despite living under the player group.
    const world = target.clone().multiplyScalar(runtime.terrain.heightAt(target) + 0.06);
    m.parent.updateMatrixWorld();
    parentInv.copy(m.parent.matrixWorld).invert();
    m.position.copy(world).applyMatrix4(parentInv);
    const s = 0.5 + Math.sin(state.clock.elapsedTime * 6) * 0.08;
    m.scale.setScalar(s);
  });
  return (
    <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]} renderOrder={3}>
      <ringGeometry args={[0.55, 0.8, 24]} />
      <meshBasicMaterial color="#fffdf6" transparent opacity={0.85} depthWrite={false} />
    </mesh>
  );
}
