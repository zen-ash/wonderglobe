"use client";
// Arrival of a new creation: it first appears as a folded paper plane (white
// paper with the drawing printed on its wings) that flies from just in front
// of the camera to its spot, then unfolds into the creation, which then lands
// in its own way (bounce, pop-up book, poke out of the ground, dive in).

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Behavior } from "@/core/types";
import { arrivalTiming, type Agent } from "@/world/agents";
import { burstStars } from "./Bursts";
import { playSfx } from "@/audio/sfx";

/**
 * Splash hook for water arrivals. The atmosphere's ripple system can plug in
 * here: `splashHooks.addRipple = addRipple` (from "./ripples").
 */
export const splashHooks: { addRipple: ((point: THREE.Vector3, size?: number) => void) | null } = { addRipple: null };

export function splashAt(point: THREE.Vector3, up: THREE.Vector3, size = 1) {
  try {
    splashHooks.addRipple?.(point.clone(), size);
  } catch (e) {
    console.warn("ripple failed", e);
  }
  burstStars(point, up, 10);
}

export type ArrivalStage = "plane" | "unfold" | "settle" | "done";

/** Where in its arrival a creation is: stage and progress (0..1) within it. */
export function arrivalStage(agent: Agent, reduced: boolean): { stage: ArrivalStage; k: number } {
  if (agent.spawn >= 1) return { stage: "done", k: 1 };
  const tm = arrivalTiming(agent.behavior, reduced);
  const e = agent.spawn * agent.spawnDur;
  // Scale the stage lengths to the agent's own duration (in case the setting changed meanwhile).
  const f = agent.spawnDur / tm.total;
  const plane = tm.plane * f, unfold = tm.unfold * f, settle = tm.settle * f;
  if (e < plane) return { stage: "plane", k: e / plane };
  if (e < plane + unfold) return { stage: "unfold", k: (e - plane) / unfold };
  return { stage: "settle", k: Math.min(1, (e - plane - unfold) / settle) };
}

/** Height above the creature's spot where the plane unfolds. */
export function unfoldHeight(behavior: Behavior, size: number): number {
  if (behavior === "swim" || behavior === "float") return 2.6;
  if (behavior === "build") return 1.2;
  if (behavior === "grow") return 0.6;
  return Math.max(1.2, size * 0.6);
}

let planeGeo: THREE.BufferGeometry | null = null;

/** A folded paper dart: nose along +X, wings spread along ±Z, keel below. */
export function paperPlaneGeometry(): THREE.BufferGeometry {
  if (planeGeo) return planeGeo;
  const N = [0.95, 0, 0], T = [-0.6, 0.02, 0], K = [-0.5, -0.2, 0], L = [-0.62, 0.08, 0.58], R = [-0.62, 0.08, -0.58];
  // Two wings and the keel, as separate triangles (flat-shaded paper).
  const tris = [N, T, L, N, R, T, N, K, T];
  const pos = new Float32Array(tris.flatMap((p) => p));
  const uv = new Float32Array(
    tris.flatMap((p) => [
      // Print the drawing across the spread wings (seen from above).
      0.5 + p[2] / 1.2,
      (p[0] + 0.62) / 1.6,
    ]),
  );
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.computeVertexNormals();
  planeGeo = g;
  return g;
}

const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _up = new THREE.Vector3();
const _side = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _camFwd = new THREE.Vector3();
const _camUp = new THREE.Vector3();
const _camRight = new THREE.Vector3();

function bezier(a: THREE.Vector3, c: THREE.Vector3, b: THREE.Vector3, t: number, out: THREE.Vector3) {
  const u = 1 - t;
  return out.copy(a).multiplyScalar(u * u).addScaledVector(c, 2 * u * t).addScaledVector(b, t * t);
}

/** The folded paper plane flying in, then spinning away as the creation unfolds. */
export function ArrivalPlane({ agent, texture, size, reducedMotion }: { agent: Agent; texture: THREE.Texture; size: number; reducedMotion: boolean }) {
  const group = useRef<THREE.Group>(null);
  const active = useRef(agent.spawn < agent.spawnHold);
  const path = useRef<{ a: THREE.Vector3; c: THREE.Vector3; b: THREE.Vector3 } | null>(null);
  const flags = useRef({ launched: false, unfolded: false });
  const { paper, print } = useMemo(() => {
    const paper = new THREE.MeshBasicMaterial({ color: "#fffaf0", side: THREE.DoubleSide });
    const print = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      alphaTest: 0.3,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    return { paper, print };
  }, [texture]);
  const edges = useMemo(() => new THREE.EdgesGeometry(paperPlaneGeometry()), []);
  useEffect(
    () => () => {
      paper.dispose();
      print.dispose();
      edges.dispose();
    },
    [paper, print, edges],
  );
  const scale = Math.min(1.8, Math.max(0.9, size * 0.7));

  useFrame((state) => {
    const g = group.current;
    if (!g) return;
    if (!active.current) {
      g.visible = false;
      return;
    }
    const { stage, k } = arrivalStage(agent, reducedMotion);
    if (stage === "settle" || stage === "done") {
      active.current = false;
      g.visible = false;
      return;
    }
    const n = agent.n;
    const end = _q.copy(agent.pos).addScaledVector(n, unfoldHeight(agent.behavior, agent.size));
    if (!path.current) {
      // Launch from just in front of the camera, a little below the centre of the view.
      const cam = state.camera;
      _camFwd.set(0, 0, -1).applyQuaternion(cam.quaternion);
      _camUp.set(0, 1, 0).applyQuaternion(cam.quaternion);
      _camRight.set(1, 0, 0).applyQuaternion(cam.quaternion);
      const a = cam.position.clone().addScaledVector(_camFwd, 2.6).addScaledVector(_camUp, -0.7).addScaledVector(_camRight, 0.5);
      const dist = a.distanceTo(end);
      const mid = a.clone().add(end).multiplyScalar(0.5);
      const c = mid.addScaledVector(mid.clone().normalize(), Math.min(6, dist * 0.3 + 1.2));
      path.current = { a, c, b: end.clone() };
    }
    const p = path.current;
    p.b.copy(end); // the spot can still move (e.g. dropped)
    g.visible = true;
    if (!flags.current.launched) {
      flags.current.launched = true;
      playSfx("plane");
    }
    if (stage === "plane") {
      const t = reducedMotion ? k : k * k * (3 - 2 * k);
      bezier(p.a, p.c, p.b, t, _p);
      bezier(p.a, p.c, p.b, Math.min(1, t + 0.02), _fwd);
      _fwd.sub(_p);
      if (_fwd.lengthSq() < 1e-8) _fwd.copy(n).cross(_camRight);
      _fwd.normalize();
      // Up blends from the camera's up to the planet's up near the end; a little roll in flight.
      _up.copy(_p).normalize();
      _side.crossVectors(_fwd, _up);
      if (_side.lengthSq() < 1e-6) _side.set(1, 0, 0);
      _side.normalize();
      _up.crossVectors(_side, _fwd).normalize();
      _m.makeBasis(_fwd, _up, _side);
      g.quaternion.setFromRotationMatrix(_m);
      if (!reducedMotion) g.rotateX(Math.sin(k * Math.PI * 3) * 0.35);
      g.position.copy(_p);
      // Grows a bit from near the camera to full size.
      g.scale.setScalar(scale * (0.55 + 0.45 * Math.min(1, k * 2)));
    } else {
      // Unfold: the plane spins open and shrinks away as the creation appears.
      if (!flags.current.unfolded) {
        flags.current.unfolded = true;
        burstStars(end, n, reducedMotion ? 4 : 10);
        playSfx("unfold");
      }
      g.position.copy(end);
      if (!reducedMotion) g.rotateX(0.35);
      const s = Math.max(0.001, 1 - k);
      g.scale.set(scale * s, scale * (s * 0.4 + 0.02), scale * (1 + k * 0.6) * s);
    }
  });

  return (
    <group ref={group} visible={false}>
      <mesh geometry={paperPlaneGeometry()} material={paper} castShadow />
      <mesh geometry={paperPlaneGeometry()} material={print} />
      <lineSegments geometry={edges}>
        <lineBasicMaterial color="#2b2320" />
      </lineSegments>
    </group>
  );
}

const easeOutBack = (t: number) => {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
const easeOutBounce = (x: number) => {
  const n1 = 7.5625, d1 = 2.75;
  if (x < 1 / d1) return n1 * x * x;
  if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75;
  if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375;
  return n1 * (x -= 2.625 / d1) * x + 0.984375;
};

export interface CreatureArrivalPose {
  visible: boolean;
  scaleX: number;
  scaleY: number;
  /** Lift above the resting spot (world units). */
  drop: number;
  /** Spin around the local up axis (radians). */
  spin: number;
  /** Swimmers: extra dip into the water (world units, positive = down). */
  dip: number;
  /** Moment of touching down (for the burst / sound), once. */
  landed: boolean;
}

/**
 * Pose of a paper creature during its arrival (everything but buildings):
 * unfold in the air, then land / poke out of the ground / dive in.
 */
export function creaturePose(agent: Agent, reduced: boolean, out: CreatureArrivalPose): CreatureArrivalPose {
  const { stage, k } = arrivalStage(agent, reduced);
  out.visible = true;
  out.scaleX = out.scaleY = 1;
  out.drop = out.spin = out.dip = 0;
  out.landed = false;
  const b = agent.behavior;
  const airborne = b === "fly" || b === "flutter" || b === "hover";
  const water = b === "swim" || b === "float";
  const h = unfoldHeight(b, agent.size);
  if (stage === "done") return out;
  if (stage === "plane") {
    out.visible = false;
    return out;
  }
  if (stage === "unfold") {
    if (b === "grow") {
      // Plants wait underground as a tiny bud.
      out.scaleX = out.scaleY = 0.12 * k;
      return out;
    }
    const e = easeOutBack(k);
    out.scaleX = Math.max(0.01, e * Math.min(1, k * 1.6));
    out.scaleY = Math.max(0.01, e);
    out.spin = reduced ? 0 : (1 - k) * Math.PI * 1.5;
    out.drop = h;
    return out;
  }
  // settle
  if (b === "grow") {
    // Poke out of the ground and stretch up, with a squash & stretch wobble.
    const base = easeOutBack(Math.min(1, k * 1.7));
    const wob = reduced ? 0 : Math.sin(k * 15) * (1 - k) * 0.22;
    out.scaleY = Math.max(0.01, base * (1 + wob));
    out.scaleX = Math.max(0.01, base * (1 - wob * 0.8) * (k < 0.3 ? 0.6 + k * 1.3 : 1));
    out.landed = k > 0.05;
    return out;
  }
  if (water) {
    // Dive into the water with a splash, then bob back up.
    const fall = Math.min(1, k / 0.4);
    out.drop = h * (1 - fall * fall);
    out.landed = k >= 0.4;
    if (k >= 0.4) {
      const s = (k - 0.4) / 0.6;
      out.dip = Math.sin(s * Math.PI) * (reduced ? 0.2 : 0.55) * (1 - s * 0.5);
    }
    const stretch = k < 0.4 ? fall * 0.15 : 0;
    out.scaleY = 1 + stretch;
    out.scaleX = 1 - stretch * 0.5;
    return out;
  }
  // Land with a bounce and a little squash.
  out.drop = (1 - easeOutBounce(k)) * (airborne ? h * 0.5 : h);
  const squash = k > 0.3 && k < 0.55 && !reduced ? Math.sin(((k - 0.3) / 0.25) * Math.PI) * 0.18 : 0;
  out.scaleY = 1 - squash;
  out.scaleX = 1 + squash;
  out.landed = k > 0.3;
  return out;
}
