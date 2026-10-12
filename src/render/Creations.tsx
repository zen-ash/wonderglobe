"use client";
// Children's drawings living on the planet. The visual is always the player's
// own cut-out; behaviour only changes how the paper moves (rocking, hopping,
// flapping, body waves, growing, folding into a building, lying across water
// as a bridge). New creations arrive as a folded paper plane (Arrival.tsx).

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { CreationRecord, CutoutMeta } from "@/core/types";
import { sizeFor } from "@/core/kinds";
import type { WorldRuntime } from "@/world/runtime";
import type { Agent } from "@/world/agents";
import { environment } from "@/world/environment";
import { growthScale, sproutCount } from "@/world/social";
import type { BridgeSpan } from "@/world/collision";
import { PLANET_RADIUS } from "@/world/sphere";
import { mulberry32, hashString } from "@/world/noise";
import { getArtwork, getArtworkUrls } from "@/persistence";
import { acquireArtworkTexture, releaseArtworkTexture, getAssets } from "./assets";
import { buildCutoutGeometry, deriveHouseShape, sampleBandColor, buildBridgePlanks, buildBridgeSide, PAPER_THICKNESS, BRIDGE_WALL } from "./cutoutGeometry";
import { createOutlineMaterial, applyOcclusionDither } from "./materials";
import { burstStars } from "./Bursts";
import { ArrivalPlane, arrivalStage, creaturePose, splashAt, type CreatureArrivalPose } from "./Arrival";
import { EmoteLayer } from "./Emotes";
import { createPaperCard, createStandMesh, standScale, useRealShadows, blobStrength } from "./creatures/paperCard";
import { PoseClock, PaperFlip, LandingSquash, gaitFor, gaitRate, walkPose, hopPose, restPose, stepTime, type PuppetPose } from "./creatures/stopMotion";
import { playSfx } from "@/audio/sfx";

export const pickables = new Map<string, THREE.Object3D>();

const _toCam = new THREE.Vector3();
const _x = new THREE.Vector3();
const _z = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _camRight = new THREE.Vector3();
const _v = new THREE.Vector3();

const metaCache = new Map<string, CutoutMeta>();

async function loadMeta(artworkId: string): Promise<CutoutMeta | null> {
  const hit = metaCache.get(artworkId);
  if (hit) return hit;
  const rec = await getArtwork(artworkId);
  if (!rec) return null;
  metaCache.set(artworkId, rec.meta);
  return rec.meta;
}

/** Load an artwork's cut-out metadata and a shared texture (null while loading or if missing). */
export function useArtwork(artworkId: string | null | undefined) {
  const [state, setState] = useState<{ id: string; meta: CutoutMeta; texture: THREE.Texture } | null>(null);
  useEffect(() => {
    if (!artworkId) return;
    let alive = true;
    let acquired = false;
    (async () => {
      const [meta, urls] = await Promise.all([loadMeta(artworkId), getArtworkUrls(artworkId)]);
      if (!alive || !meta || !urls) return;
      const texture = acquireArtworkTexture(artworkId, urls.cutoutUrl);
      acquired = true;
      setState({ id: artworkId, meta, texture });
    })().catch((e) => console.warn("Could not load artwork", e));
    return () => {
      alive = false;
      if (acquired) releaseArtworkTexture(artworkId);
    };
  }, [artworkId]);
  return state && state.id === artworkId ? state : null;
}

const easeOutBack = (t: number) => {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
const sub = (t: number, a: number, b: number) => Math.min(1, Math.max(0, (t - a) / (b - a)));

export function Creations({ runtime, records, reducedMotion }: { runtime: WorldRuntime; records: CreationRecord[]; reducedMotion: boolean }) {
  // Arrivals are timed in the simulation; calm motion makes them shorter.
  runtime.reducedMotion = reducedMotion;
  return (
    <group>
      {records.map((r) => (
        <CreationObject key={r.id} runtime={runtime} record={r} reducedMotion={reducedMotion} />
      ))}
      <EmoteLayer runtime={runtime} reducedMotion={reducedMotion} />
    </group>
  );
}

const CreationObject = memo(function CreationObject({ runtime, record, reducedMotion }: { runtime: WorldRuntime; record: CreationRecord; reducedMotion: boolean }) {
  const art = useArtwork(record.artworkId);
  const agent = runtime.creations.get(record.id);
  if (!art || !agent) return null;
  const props = { agent, record, meta: art.meta, texture: art.texture, runtime, reducedMotion };
  if (record.kind === "bridge") return <Bridge {...props} />;
  if (record.behavior === "build") return <Building {...props} />;
  return <PaperCreature {...props} />;
});

interface ObjProps {
  agent: Agent;
  record: CreationRecord;
  meta: CutoutMeta;
  texture: THREE.Texture;
  runtime: WorldRuntime;
  reducedMotion: boolean;
}

/** Soft contact blob under a creation (subtle when real shadows are on). */
function useBlobShadow(width: number) {
  const assets = getAssets();
  return useMemo(() => {
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: assets.shadow, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    );
    shadow.renderOrder = 1;
    const w = Math.max(0.6, width);
    shadow.scale.set(w * 1.5, 1, w * 0.9);
    return shadow;
  }, [assets, width]);
}

// ------------------------------------------------------------ small textures

const texCache = new Map<string, THREE.Texture>();

function canvasTexture(key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.Texture {
  const hit = texCache.get(key);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  texCache.set(key, t);
  return t;
}

/** A tiny paper flower (petals in one of the drawing's own colours). */
function sproutTexture(color: string): THREE.Texture {
  return canvasTexture(`sprout:${color}`, 64, 96, (ctx) => {
    ctx.lineCap = ctx.lineJoin = "round";
    ctx.strokeStyle = "#2b2320";
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(32, 94);
    ctx.quadraticCurveTo(28, 64, 32, 38);
    ctx.stroke();
    ctx.strokeStyle = "#5fb85a";
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.fillStyle = "#6cc35f";
    ctx.strokeStyle = "#2b2320";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.ellipse(42, 70, 10, 5, -0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.ellipse(32 + Math.cos(a) * 12, 28 + Math.sin(a) * 12, 10, 8, a, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.fillStyle = "#ffd447";
    ctx.beginPath();
    ctx.arc(32, 28, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  });
}

function glowTexture(): THREE.Texture {
  return canvasTexture("glow", 128, 128, (ctx) => {
    const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
    g.addColorStop(0, "rgba(255,226,140,0.95)");
    g.addColorStop(0.45, "rgba(255,196,90,0.45)");
    g.addColorStop(1, "rgba(255,180,80,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  });
}

function puffTexture(): THREE.Texture {
  return canvasTexture("puff", 64, 64, (ctx) => {
    ctx.fillStyle = "#fbf7ef";
    ctx.strokeStyle = "rgba(43,35,32,0.55)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(24, 36, 14, 0, Math.PI * 2);
    ctx.arc(40, 34, 16, 0, Math.PI * 2);
    ctx.arc(32, 22, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(24, 36, 12.5, 0, Math.PI * 2);
    ctx.arc(40, 34, 14.5, 0, Math.PI * 2);
    ctx.arc(32, 22, 11.5, 0, Math.PI * 2);
    ctx.fill();
  });
}

// ------------------------------------------------------------ paper creatures

function PaperCreature({ agent, record, meta, texture, runtime, reducedMotion }: ObjProps) {
  const size = sizeFor(record.kind);
  const cut = useMemo(() => buildCutoutGeometry(meta, size), [meta, size]);
  const card = useMemo(() => createPaperCard(texture), [texture]);
  const realShadows = useRealShadows();
  const root = useRef<THREE.Group>(null);
  const puppet = useRef<THREE.Group>(null);
  const cardRef = useRef<THREE.Mesh>(null);
  const sproutGroup = useRef<THREE.Group>(null);
  const arrived = useRef(agent.spawn >= 1);
  const pose = useRef<CreatureArrivalPose>({ visible: true, scaleX: 1, scaleY: 1, drop: 0, spin: 0, dip: 0, landed: false });
  const growth = useRef({ scale: 1, checked: -1 });
  const shadow = useBlobShadow(cut.width);
  const stand = useMemo(() => createStandMesh(), []);
  const standBase = useMemo(() => standScale(cut.width, new THREE.Vector3()), [cut.width]);
  const anim = useMemo(
    () => ({
      clock: new PoseClock(),
      flip: new PaperFlip(1),
      landing: new LandingSquash(),
      walk: restPose({} as PuppetPose),
      // Held (stop-motion) inputs.
      phase: agent.phase,
      move: 0,
      bank: 0,
      time: 0,
      above: 0,
      prevAbove: 0,
      yaw: 0,
      mirror: 1,
    }),
    [agent],
  );
  const airborne = agent.behavior === "fly" || agent.behavior === "flutter" || agent.behavior === "hover";
  const water = agent.behavior === "swim" || agent.behavior === "float";
  const plant = agent.behavior === "grow";
  const grounded = !airborne && !water;
  const gait = gaitFor(record.kind, agent.behavior, record.facing);

  // Paper flowers sprouting around older plants (in the drawing's own colours).
  const sprouts = useMemo(() => {
    if (!plant) return [];
    const count = sproutCount(record.createdAt, Date.now());
    const rng = mulberry32(hashString(record.id + "sprout"));
    const colors = meta.palette.length ? meta.palette : ["#ff9fb2"];
    return Array.from({ length: count }, (_, i) => {
      const a = (i / Math.max(1, count)) * Math.PI * 2 + rng() * 0.8;
      const r = cut.width * 0.45 + 0.35 + rng() * 0.45;
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: sproutTexture(colors[i % colors.length]), alphaTest: 0.4 }));
      sprite.center.set(0.5, 0);
      const s = 0.38 + rng() * 0.2;
      sprite.scale.set(s * (64 / 96), s, 1);
      sprite.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      return sprite;
    });
  }, [plant, record.createdAt, record.id, meta.palette, cut.width]);

  useEffect(() => {
    card.uniforms.uHalfWidth.value = cut.halfWidth;
    card.uniforms.uHeight.value = cut.height;
    card.uniforms.uWave.value = agent.behavior === "swim" ? 1 : 0;
  }, [card, cut, agent]);

  useEffect(() => {
    const obj = cardRef.current;
    if (obj) {
      obj.userData.pickId = record.id;
      pickables.set(record.id, obj);
    }
    return () => {
      pickables.delete(record.id);
    };
  }, [record.id, cut, card]);
  useEffect(() => () => cut.geometry.dispose(), [cut]);
  useEffect(() => () => card.dispose(), [card]);
  useEffect(
    () => () => {
      shadow.geometry.dispose();
      (shadow.material as THREE.Material).dispose();
    },
    [shadow],
  );

  useEffect(() => () => sprouts.forEach((s) => s.material.dispose()), [sprouts]);

  useFrame((state, rawDt) => {
    const g = root.current;
    if (!g) return;
    const dt = Math.min(rawDt, 0.05);
    const t = state.clock.elapsedTime;
    const cam = state.camera.position;
    // Hide things on the far side of the planet, and anyone inside a house.
    const visible = !agent.hidden && (agent.pos.dot(cam) > -50 || agent.n.dot(_toCam.copy(cam).normalize()) > -0.3);
    g.visible = visible;
    if (sproutGroup.current) sproutGroup.current.visible = visible;
    if (!visible) return;
    const n = agent.n;
    // Face the camera around the local up axis (paper standing up).
    _toCam.copy(cam).sub(agent.pos);
    _z.copy(_toCam).addScaledVector(n, -_toCam.dot(n));
    if (_z.lengthSq() < 1e-6) _z.copy(agent.t);
    _z.normalize();
    _x.crossVectors(n, _z).normalize();
    _m.makeBasis(_x, n, _z);
    g.quaternion.setFromRotationMatrix(_m);

    // Turning around: the card spins edge-on and comes back facing the other way.
    _camRight.setFromMatrixColumn(state.camera.matrixWorld, 0);
    const screen = agent.t.dot(_camRight);
    let want = anim.flip.target;
    if (record.facing !== "none" && agent.moveAmount > 0.2 && Math.abs(screen) > 0.2) {
      const goingRight = screen > 0;
      want = (record.facing === "right") === goingRight ? 1 : -1;
    }
    anim.flip.update(want, dt, reducedMotion ? 0.5 : 0.34);

    // Height above the ground (hops, surprise jumps) — held on stop-motion frames below.
    const groundH = Math.max(runtime.terrain.heightAt(n), runtime.grid.deckAt(n));
    const above = Math.max(0, agent.pos.length() - groundH);

    // Stop-motion: sample a new pose ~12 times a second (continuously when calm).
    const carried = agent.state === "carried";
    if (anim.clock.advance(t, reducedMotion)) {
      anim.phase = agent.phase;
      anim.move = agent.moveAmount;
      anim.bank = agent.bank;
      anim.time = t;
      anim.prevAbove = anim.above;
      anim.above = above;
      anim.yaw = anim.flip.yaw;
      anim.mirror = anim.flip.mirror;
      anim.landing.sample(grounded ? above : 0);
    }
    // Grounded puppets show the held hop height; travel stays smooth.
    const heldLift = grounded && !carried && agent.spawn >= 1 ? anim.above - above : 0;

    // Arrival: paper plane → unfold → land (or poke out / dive in).
    const p = creaturePose(agent, reducedMotion, pose.current);
    let scaleY = p.scaleY, scaleX = p.scaleX, roll = 0;
    const drop = p.drop;
    if (!arrived.current && p.landed) {
      arrived.current = true;
      if (water) {
        splashAt(agent.pos, n, agent.size);
        playSfx("splash");
      } else if (plant) {
        burstStars(agent.pos, n, 12);
        playSfx("sparkle");
      } else {
        burstStars(agent.pos, n, 16);
        playSfx("boing");
      }
    } else if (!arrived.current && agent.spawn >= 1) arrived.current = true;

    // Plants get bigger as the days go by.
    if (plant && (growth.current.checked < 0 || t - growth.current.checked > 5)) {
      growth.current.checked = t;
      growth.current.scale = growthScale(record.createdAt, Date.now());
    }
    const grow = plant ? growth.current.scale : 1;

    const motion = reducedMotion ? 0.35 : 1;
    const ph = anim.phase;
    const ht = anim.time;
    // The drawing's nose direction on screen (for leaning into a lope or a hop).
    const nose = anim.mirror * (record.facing === "left" ? -1 : 1);
    const u = card.uniforms;
    u.uTime.value = ht;
    u.uFold.value = 0;
    u.uBend.value = 0;
    let lift = 0;
    const asleep = agent.state === "sleep";
    const perched = agent.state === "rest" || (asleep && agent.behavior === "fly" && agent.perchAlt > 0);
    switch (agent.behavior) {
      case "walk":
      case "drive": {
        const w = walkPose(gait, ph * gaitRate(gait), anim.move, cut.height, motion, nose, anim.walk);
        roll = w.roll;
        lift = w.lift;
        scaleX *= w.scaleX;
        scaleY *= w.scaleY;
        u.uBend.value = w.bend;
        break;
      }
      case "hop": {
        const w = hopPose(anim.above, anim.prevAbove, motion, nose, anim.walk);
        roll = w.roll;
        scaleX *= w.scaleX;
        scaleY *= w.scaleY;
        u.uBend.value = w.bend;
        break;
      }
      case "fly":
        if (perched) {
          // Wings folded while sitting on a branch or a roof.
          u.uFold.value = 0.75;
          lift = Math.sin(ht * 2 + ph) * 0.03 * motion;
        } else {
          u.uFold.value = Math.sin(ph * 8) * 0.35 * motion;
          roll = -anim.bank * 0.35 * motion;
        }
        break;
      case "flutter":
        u.uFold.value = asleep ? 0.8 : Math.abs(Math.sin(ph * 14)) * 0.85 * motion;
        break;
      case "hover":
        roll = Math.sin(ph * 0.9) * 0.1 * motion;
        break;
      case "swim":
        u.uWave.value = asleep ? 0.2 * motion : motion;
        roll = Math.sin(ph * 3) * 0.05 * motion;
        break;
      case "float":
        roll = Math.sin(ph * 2.2) * 0.07 * motion;
        lift = Math.sin(ph * 2) * 0.05 * motion;
        break;
      case "grow":
        u.uBend.value = Math.sin(ht * 1.4 + ph) * 0.14 * motion * (0.6 + environment.wind * 0.8);
        break;
      case "still":
        roll = Math.sin(ht * 0.8 + ph) * 0.04 * motion;
        break;
    }
    // Touch-down squash, held for a couple of frames (hops, surprise jumps).
    const land = grounded && !reducedMotion ? anim.landing.amount : 0;
    if (land > 0) {
      scaleY *= 1 - 0.16 * land;
      scaleX *= 1 + 0.1 * land;
    }
    if (asleep && (agent.behavior === "walk" || agent.behavior === "hop" || agent.behavior === "drive")) {
      // Curled up, breathing slowly.
      roll = 0.28;
      lift = 0;
      scaleY = p.scaleY * (0.92 + Math.sin(ht * 1.6 + ph) * 0.03 * motion);
    }
    // Plants and still things lean a little toward the player.
    if ((plant || agent.behavior === "still") && agent.attend > 0.01) {
      const side = Math.sign(_v.copy(runtime.player.pos).sub(agent.pos).dot(_camRight)) || 1;
      roll += -side * 0.16 * agent.attend;
    }
    if (carried) {
      roll = Math.sin(stepTime(t, reducedMotion) * 6) * 0.12;
      scaleX *= 1.08;
      scaleY *= 1.08;
    }
    g.position.copy(agent.pos).addScaledVector(n, drop + heldLift);
    // Fish sit half in the water, bobbing gently.
    const fishDip = agent.behavior === "swim" && runtime.terrain.waterAt(n) >= 0 ? cut.height * (0.42 + Math.sin(ph * 2) * 0.05) : 0;
    const pp = puppet.current;
    if (pp) {
      pp.visible = p.visible;
      pp.position.set(0, lift - fishDip - p.dip, 0);
      pp.rotation.set(0, p.spin + anim.yaw, roll);
      pp.scale.set(scaleX * anim.mirror * grow, scaleY * grow, grow);
    }
    // The cardboard stand slots under grounded puppets and moves with them.
    stand.visible = grounded && !carried && p.visible && drop < 0.6;
    if (stand.visible) {
      const sg = plant ? Math.min(1.3, grow) / grow : 1;
      stand.scale.set(standBase.x * sg, 1 / Math.max(0.3, scaleY * grow), standBase.z * sg);
    }
    // Contact shadow stays on the ground.
    const lifted = above + drop + heldLift + Math.max(0, lift);
    shadow.position.set(0, -(above + drop + heldLift) + 0.06, 0);
    const fade = Math.max(0.15, 1 - lifted / 9);
    (shadow.material as THREE.MeshBasicMaterial).opacity = p.visible ? fade * blobStrength(realShadows) : 0;
    shadow.visible = !water || runtime.terrain.waterAt(n) < 0;

    // Sprouted flowers stay put around the plant (not turning with the camera).
    const sg = sproutGroup.current;
    if (sg && sprouts.length) {
      _x.crossVectors(agent.t, n).normalize();
      _z.crossVectors(_x, n).normalize();
      _m.makeBasis(_x, n, _z);
      sg.quaternion.setFromRotationMatrix(_m);
      sg.position.copy(agent.pos);
      const show = agent.spawn >= 1 && !carried;
      sg.visible = show;
      if (show) sprouts.forEach((s, i) => (s.material.rotation = Math.sin(ht * 1.5 + i) * 0.08 * motion));
    }
  });

  return (
    <>
      <group ref={root}>
        <primitive object={shadow} />
        <group ref={puppet}>
          <mesh ref={cardRef} geometry={cut.geometry} material={card.materials} customDepthMaterial={card.depth} castShadow />
          <primitive object={stand} />
        </group>
      </group>
      {sprouts.length > 0 && (
        <group ref={sproutGroup}>
          {sprouts.map((s, i) => (
            <primitive key={i} object={s} />
          ))}
        </group>
      )}
      <ArrivalPlane agent={agent} texture={texture} size={size} reducedMotion={reducedMotion} />
    </>
  );
}

// ------------------------------------------------------------------ buildings

/** A drawing of a building becomes a small folded paper house that pops up out of a book. */
function Building({ agent, record, meta, texture, runtime, reducedMotion }: ObjProps) {
  const size = sizeFor(record.kind);
  const cut = useMemo(() => buildCutoutGeometry(meta, size, 0.04, { bow: 0 }), [meta, size]);
  const house = useMemo(() => deriveHouseShape(meta, cut.scale), [meta, cut]);
  const facade = useMemo(() => createPaperCard(texture), [texture]);
  const realShadows = useRealShadows();
  const wallColor = meta.palette[0] ?? "#f4e2c8";
  const roofColor = meta.palette[1] ?? meta.palette[0] ?? "#e25b4a";
  const paperColor = (hex: string, toCream: number) => new THREE.Color(hex).lerp(new THREE.Color("#fff7ea"), toCream);
  const wallMat = useMemo(
    () => applyOcclusionDither(new THREE.MeshLambertMaterial({ color: paperColor(wallColor, 0.6), emissive: paperColor(wallColor, 0.6).multiplyScalar(0.35), side: THREE.DoubleSide })),
    [wallColor],
  );
  const roofMat = useMemo(
    () => applyOcclusionDither(new THREE.MeshLambertMaterial({ color: roofColor, emissive: new THREE.Color(roofColor).multiplyScalar(0.35), side: THREE.DoubleSide })),
    [roofColor],
  );
  const windowMat = useMemo(() => new THREE.MeshBasicMaterial({ color: "#3f5684" }), []);
  const glowMat = useMemo(
    () => new THREE.MeshBasicMaterial({ map: glowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, polygonOffset: true, polygonOffsetFactor: -3 }),
    [],
  );
  const pageMat = useMemo(() => new THREE.MeshLambertMaterial({ map: getAssets().cardboard, color: "#e2bf8f" }), []);
  const sampled = useRef(false);
  const outline = useMemo(() => createOutlineMaterial(0.025), []);
  const root = useRef<THREE.Group>(null);
  const popRef = useRef<THREE.Group>(null);
  const frontRef = useRef<THREE.Group>(null);
  const backRef = useRef<THREE.Group>(null);
  const leftRef = useRef<THREE.Group>(null);
  const rightRef = useRef<THREE.Group>(null);
  const roofL = useRef<THREE.Group>(null);
  const roofR = useRef<THREE.Group>(null);
  const pageRef = useRef<THREE.Group>(null);
  const chimneyRef = useRef<THREE.Group>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const pickRef = useRef<THREE.Group>(null);
  const done = useRef(agent.spawn >= 1);
  const opened = useRef(agent.spawn >= 1);
  const shadow = useBlobShadow(cut.width * 1.4);
  const puffs = useMemo(
    () =>
      Array.from({ length: 4 }, () => {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTexture(), transparent: true, depthWrite: false }));
        s.visible = false;
        return s;
      }),
    [],
  );

  const d = house.depth;
  const wallW = house.wallRight - house.wallLeft;
  const roofRun = Math.max(house.peakX - house.wallLeft, 0.1);
  const roofRunR = Math.max(house.wallRight - house.peakX, 0.1);
  const rise = house.peak - house.wallHeight;
  const roofLenL = Math.hypot(roofRun, rise) + 0.12;
  const roofLenR = Math.hypot(roofRunR, rise) + 0.12;
  const angL = Math.atan2(rise, roofRun);
  const angR = Math.atan2(rise, roofRunR);
  const midX = (house.wallLeft + house.wallRight) / 2;
  const pageW = wallW + 0.5;
  const pageD = d / 2 + 0.25;
  const winSize = Math.min(0.42, house.wallHeight * 0.4, d * 0.35);
  // Chimney on the left roof panel, a little way up.
  const chimney = { x: house.wallLeft + roofRun * 0.5, y: house.wallHeight + rise * 0.5, z: -d * 0.2, h: Math.max(0.35, rise * 0.45) };

  useEffect(() => {
    const obj = pickRef.current;
    if (obj) {
      obj.userData.pickId = record.id;
      pickables.set(record.id, obj);
    }
    return () => {
      pickables.delete(record.id);
      cut.geometry.dispose();
    };
  }, [record.id, cut]);
  useEffect(() => () => facade.dispose(), [facade]);
  useEffect(
    () => () => {
      shadow.geometry.dispose();
      (shadow.material as THREE.Material).dispose();
    },
    [shadow],
  );

  useEffect(
    () => () => {
      windowMat.dispose();
      glowMat.dispose();
      pageMat.dispose();
      puffs.forEach((p) => p.material.dispose());
    },
    [windowMat, glowMat, pageMat, puffs],
  );

  useFrame((state, rawDt) => {
    const g = root.current;
    if (!g) return;
    const dt = Math.min(rawDt, 0.05);
    const time = state.clock.elapsedTime;
    // Once the picture has loaded, colour the roof and walls from the drawing itself.
    const img = texture.image as (CanvasImageSource & { width: number; height: number }) | undefined;
    if (!sampled.current && img && img.width) {
      sampled.current = true;
      const roof = sampleBandColor(img, 0.05, Math.max(0.12, meta.roofLine - 0.02));
      const wall = sampleBandColor(img, meta.roofLine + 0.05, 0.92);
      if (roof) {
        roofMat.color.set(roof);
        roofMat.emissive.set(roof).multiplyScalar(0.35);
      }
      if (wall) {
        const c = paperColor(wall, 0.55);
        wallMat.color.copy(c);
        wallMat.emissive.copy(c).multiplyScalar(0.35);
      }
    }
    const n = agent.n;
    _x.crossVectors(n, agent.t).normalize();
    _m.makeBasis(_x, n, agent.t);
    g.quaternion.setFromRotationMatrix(_m);
    const carried = agent.state === "carried";
    g.position.copy(agent.pos).addScaledVector(n, carried ? 0.6 + Math.sin(time * 5) * 0.1 : 0);

    // Arrival: plane → a closed paper book appears → it opens → the house pops up.
    const { stage, k } = arrivalStage(agent, reducedMotion);
    const pop = popRef.current;
    let book = 1, s = 1;
    if (stage === "plane") {
      g.visible = false;
      return;
    }
    g.visible = true;
    if (pop) {
      if (stage === "unfold") {
        const e = Math.max(0.01, easeOutBack(k));
        pop.scale.setScalar(e);
        pop.rotation.y = reducedMotion ? 0 : (1 - k) * Math.PI;
        pop.position.y = (1 - k) * 1.2;
        book = 0;
        s = 0;
      } else {
        pop.scale.setScalar(1);
        pop.rotation.y = 0;
        pop.position.y = 0;
        if (stage === "settle") {
          book = easeOutBack(sub(k, 0, 0.35));
          s = sub(k, 0.25, 1);
        }
      }
    }
    if (!opened.current && book > 0.5) {
      opened.current = true;
      playSfx("unfold");
    }
    // The left page swings open around the spine.
    if (pageRef.current) pageRef.current.rotation.x = -(1 - book) * Math.PI;
    const walls = easeOutBack(sub(s, 0.0, 0.45));
    const facades = easeOutBack(sub(s, 0.2, 0.65));
    const roof = easeOutBack(sub(s, 0.55, 1));
    const hidden = s <= 0.001;
    if (leftRef.current) {
      leftRef.current.rotation.z = (1 - walls) * (Math.PI / 2);
      leftRef.current.visible = !hidden;
    }
    if (rightRef.current) {
      rightRef.current.rotation.z = -(1 - walls) * (Math.PI / 2);
      rightRef.current.visible = !hidden;
    }
    if (frontRef.current) {
      frontRef.current.rotation.x = (1 - facades) * (Math.PI / 2);
      frontRef.current.visible = !hidden;
    }
    if (backRef.current) {
      backRef.current.rotation.x = -(1 - facades) * (Math.PI / 2);
      backRef.current.visible = !hidden;
    }
    if (roofL.current) {
      roofL.current.rotation.z = angL + (1 - roof) * 1.2;
      roofL.current.visible = !hidden;
    }
    if (roofR.current) {
      roofR.current.rotation.z = -angR - (1 - roof) * 1.2;
      roofR.current.visible = !hidden;
    }
    if (!done.current && agent.spawn >= 1) {
      done.current = true;
      burstStars(agent.pos, n, 20);
      playSfx("stamp");
    }
    shadow.position.set(0, carried ? -0.6 : 0.05, 0);
    (shadow.material as THREE.MeshBasicMaterial).opacity = blobStrength(realShadows);
    facade.uniforms.uTime.value = time;

    // Lights: windows glow warm at night, and the door lights up when the player comes close.
    const night = 1 - environment.daylight;
    const lit = Math.max(Math.min(1, night * 1.3), agent.attend * 0.85) * (agent.spawn >= 1 ? 1 : 0);
    windowMat.color.setRGB(0.25 + 0.75 * lit, 0.34 + 0.5 * lit, 0.52 - 0.2 * lit);
    if (glowRef.current) {
      glowMat.opacity = lit * 0.85;
      glowRef.current.visible = lit > 0.02 && !carried;
    }

    // Chimney smoke by day when someone lives here.
    const lived = !!agent.mind?.livedIn;
    const chim = chimneyRef.current;
    if (chim) chim.visible = roof > 0.95;
    const smoke = lived && roof > 0.95 && environment.daylight > 0.4 && !carried;
    puffs.forEach((p, i) => {
      if (!smoke) {
        p.visible = false;
        return;
      }
      const life = ((time * (reducedMotion ? 0.25 : 0.4) + i / puffs.length) % 1 + 1) % 1;
      p.visible = true;
      p.position.set(chimney.x + life * 0.5 + Math.sin(time + i) * 0.08, chimney.y + chimney.h + 0.1 + life * 1.6, chimney.z);
      const sc = 0.22 + life * 0.45;
      p.scale.set(sc, sc, 1);
      p.material.opacity = Math.min(1, (1 - life) * 1.6) * Math.min(1, life * 6);
      p.material.rotation += dt * 0.4;
    });
    void runtime;
  });

  const windowMesh = (side: 1 | -1) => (
    <group position={[side * (PAPER_THICKNESS / 2 + 0.012), house.wallHeight * 0.55, 0]} rotation={[0, side * (Math.PI / 2), 0]}>
      <mesh position={[0, 0, -0.004]}>
        <planeGeometry args={[winSize + 0.08, winSize + 0.08]} />
        <meshBasicMaterial color="#2b2320" side={THREE.DoubleSide} />
      </mesh>
      <mesh material={windowMat}>
        <planeGeometry args={[winSize, winSize]} />
      </mesh>
      <mesh position={[0, 0, 0.004]}>
        <planeGeometry args={[0.035, winSize]} />
        <meshBasicMaterial color="#2b2320" />
      </mesh>
      <mesh position={[0, 0, 0.004]}>
        <planeGeometry args={[winSize, 0.035]} />
        <meshBasicMaterial color="#2b2320" />
      </mesh>
    </group>
  );

  return (
    <>
    <group ref={root}>
      <primitive object={shadow} />
      <group ref={popRef}>
        <group ref={pickRef}>
          {/* The pop-up book: right page flat, left page swings open around the spine (local x axis). */}
          <mesh position={[midX, 0.025, -pageD / 2]} material={pageMat} receiveShadow>
            <boxGeometry args={[pageW, 0.05, pageD]} />
          </mesh>
          <group ref={pageRef} position={[midX, 0.05, 0]}>
            <mesh position={[0, -0.025, pageD / 2]} material={pageMat} receiveShadow castShadow>
              <boxGeometry args={[pageW, 0.05, pageD]} />
            </mesh>
          </group>
          {/* Front and back facades: the drawing itself (plain paper inside), hinged at the ground */}
          <group ref={frontRef} position={[0, 0, d / 2]}>
            <mesh geometry={cut.geometry} material={facade.materials} customDepthMaterial={facade.depth} castShadow />
          </group>
          <group ref={backRef} position={[0, 0, -d / 2]}>
            <mesh geometry={cut.geometry} material={facade.materials} customDepthMaterial={facade.depth} castShadow rotation={[0, Math.PI, 0]} />
          </group>
          {/* Side walls fold up from the ground, with a little window each */}
          <group ref={leftRef} position={[house.wallLeft, 0, 0]}>
            <mesh position={[0, house.wallHeight / 2, 0]} material={wallMat} castShadow receiveShadow>
              <boxGeometry args={[PAPER_THICKNESS, house.wallHeight, d]} />
            </mesh>
            <mesh position={[0, house.wallHeight / 2, 0]} material={outline}>
              <boxGeometry args={[PAPER_THICKNESS, house.wallHeight, d]} />
            </mesh>
            {windowMesh(-1)}
          </group>
          <group ref={rightRef} position={[house.wallRight, 0, 0]}>
            <mesh position={[0, house.wallHeight / 2, 0]} material={wallMat} castShadow receiveShadow>
              <boxGeometry args={[PAPER_THICKNESS, house.wallHeight, d]} />
            </mesh>
            <mesh position={[0, house.wallHeight / 2, 0]} material={outline}>
              <boxGeometry args={[PAPER_THICKNESS, house.wallHeight, d]} />
            </mesh>
            {windowMesh(1)}
          </group>
          {/* Folded roof: two paper panels meeting at the drawing's peak */}
          <group ref={roofL} position={[house.wallLeft - 0.06, house.wallHeight, 0]}>
            <mesh position={[roofLenL / 2, 0, 0]} material={roofMat} castShadow receiveShadow>
              <boxGeometry args={[roofLenL, PAPER_THICKNESS, d + 0.16]} />
            </mesh>
            <mesh position={[roofLenL / 2, 0, 0]} material={outline}>
              <boxGeometry args={[roofLenL, PAPER_THICKNESS, d + 0.16]} />
            </mesh>
          </group>
          <group ref={roofR} position={[house.wallRight + 0.06, house.wallHeight, 0]}>
            <mesh position={[-roofLenR / 2, 0, 0]} material={roofMat} castShadow receiveShadow>
              <boxGeometry args={[roofLenR, PAPER_THICKNESS, d + 0.16]} />
            </mesh>
            <mesh position={[-roofLenR / 2, 0, 0]} material={outline}>
              <boxGeometry args={[roofLenR, PAPER_THICKNESS, d + 0.16]} />
            </mesh>
          </group>
          {/* Chimney */}
          <group ref={chimneyRef} position={[chimney.x, chimney.y, chimney.z]}>
            <mesh position={[0, chimney.h / 2, 0]} material={roofMat} castShadow receiveShadow>
              <boxGeometry args={[0.24, chimney.h, 0.24]} />
            </mesh>
            <mesh position={[0, chimney.h / 2, 0]} material={outline}>
              <boxGeometry args={[0.24, chimney.h, 0.24]} />
            </mesh>
          </group>
        </group>
      </group>
      {/* Warm light spilling out of the front door onto the ground */}
      <mesh ref={glowRef} position={[midX, 0.07, d / 2 + 0.7]} rotation={[-Math.PI / 2, 0, 0]} material={glowMat} renderOrder={2}>
        <planeGeometry args={[Math.max(1.6, wallW * 0.9), 1.4]} />
      </mesh>
      {puffs.map((p, i) => (
        <primitive key={i} object={p} />
      ))}
    </group>
    <ArrivalPlane agent={agent} texture={texture} size={size} reducedMotion={reducedMotion} />
    </>
  );
}

// -------------------------------------------------------------------- bridges

function Bridge({ agent, record, meta, texture, runtime, reducedMotion }: ObjProps) {
  const [span, setSpan] = useState<BridgeSpan | null>(() => runtime.grid.getBridge(record.id) ?? null);
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const pickRef = useRef<THREE.Group>(null);
  const done = useRef(agent.spawn >= 1);
  const paper = useMemo(() => createPaperCard(texture), [texture]);
  const plankMat = useMemo(() => applyOcclusionDither(new THREE.MeshLambertMaterial({ vertexColors: true, map: getAssets().cardboard, side: THREE.DoubleSide })), []);
  const geos = useMemo(() => {
    if (!span) return null;
    return { planks: buildBridgePlanks(span), left: buildBridgeSide(meta, span, 1), right: buildBridgeSide(meta, span, -1) };
  }, [span, meta]);
  // The frame the geometry was built in (kept while carried).
  const frame = useRef({ n: agent.n.clone(), t: agent.t.clone() });

  useEffect(() => {
    paper.uniforms.uHalfWidth.value = 10;
    paper.uniforms.uHeight.value = BRIDGE_WALL;
  }, [paper]);

  useEffect(() => {
    const obj = pickRef.current;
    if (obj) {
      obj.userData.pickId = record.id;
      pickables.set(record.id, obj);
    }
    return () => {
      pickables.delete(record.id);
    };
  }, [record.id, geos]);

  useEffect(
    () => () => {
      geos?.planks.dispose();
      geos?.left.dispose();
      geos?.right.dispose();
    },
    [geos],
  );
  useEffect(() => () => paper.dispose(), [paper]);

  useFrame((state) => {
    const g = root.current;
    if (!g) return;
    const current = runtime.grid.getBridge(record.id);
    if (current && current !== span) {
      // Built or rebuilt after a drop.
      frame.current.n.copy(current.center);
      frame.current.t.copy(current.t);
      setSpan(current);
    }
    const carried = agent.state === "carried";
    const n = carried ? agent.n : frame.current.n;
    const t = carried ? agent.t : frame.current.t;
    _x.crossVectors(t, n).normalize(); // lateral
    _m.makeBasis(t, n, _x);
    g.quaternion.setFromRotationMatrix(_m);
    g.position.copy(n).multiplyScalar(PLANET_RADIUS).addScaledVector(n, carried ? 1 + Math.sin(state.clock.elapsedTime * 5) * 0.1 : 0);
    paper.uniforms.uTime.value = state.clock.elapsedTime;
    // Arrival: unfold into place, then stretch across the water.
    const { stage, k } = arrivalStage(agent, reducedMotion);
    const b = body.current;
    if (b) {
      if (stage === "plane") b.visible = false;
      else {
        b.visible = true;
        if (stage === "unfold") {
          const e = Math.max(0.01, easeOutBack(k));
          b.scale.set(0.15 * e, e, e);
          b.position.y = (1 - k) * 1.5;
        } else if (stage === "settle") {
          b.scale.set(Math.max(0.15, easeOutBack(Math.min(1, k * 1.3))), 1, 1);
          b.position.y = 0;
        } else {
          b.scale.set(1, 1, 1);
          b.position.y = 0;
        }
      }
    }
    if (!done.current && agent.spawn >= 1) {
      done.current = true;
      burstStars(agent.pos, agent.n, 20);
      splashAt(agent.pos, agent.n, 1.5);
      playSfx("stamp");
    }
  });

  if (!geos) return null;
  return (
    <>
      <group ref={root}>
        <group ref={body}>
          <group ref={pickRef}>
            <mesh geometry={geos.planks} material={plankMat} receiveShadow />
            <mesh geometry={geos.left} material={paper.materials} customDepthMaterial={paper.depth} castShadow />
            <mesh geometry={geos.right} material={paper.materials} customDepthMaterial={paper.depth} castShadow />
          </group>
        </group>
      </group>
      <ArrivalPlane agent={agent} texture={texture} size={1.6} reducedMotion={reducedMotion} />
    </>
  );
}
