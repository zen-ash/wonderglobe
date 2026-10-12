"use client";
// Wooden easels in the Miniature Gallery World, showing the full picture with
// colourful sticky notes stuck around the frame.

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { EaselRecord } from "@/core/types";
import type { WorldRuntime } from "@/world/runtime";
import { getArtwork, getArtworkUrls } from "@/persistence";
import { acquireArtworkTexture, releaseArtworkTexture, noteTexture } from "./assets";
import { createOutlineMaterial, toonMaterial } from "./materials";
import { pickables } from "./Creations";
import { burstStars } from "./Bursts";
import { useGame } from "@/state/store";

const _x = new THREE.Vector3();
const _m = new THREE.Matrix4();
const WOOD = "#c98d55";
const WOOD_DARK = "#9a6a45";

export function Easels({ runtime, records }: { runtime: WorldRuntime; records: EaselRecord[] }) {
  return (
    <group>
      {records.map((r) => (
        <Easel key={r.id} runtime={runtime} record={r} />
      ))}
    </group>
  );
}

function usePicture(artworkId: string) {
  const [pic, setPic] = useState<{ texture: THREE.Texture; aspect: number } | null>(null);
  useEffect(() => {
    let alive = true;
    let acquired = false;
    const key = `orig:${artworkId}`;
    (async () => {
      const [rec, urls] = await Promise.all([getArtwork(artworkId), getArtworkUrls(artworkId)]);
      if (!alive || !rec || !urls) return;
      const texture = acquireArtworkTexture(key, urls.originalUrl);
      acquired = true;
      setPic({ texture, aspect: rec.originalWidth / Math.max(1, rec.originalHeight) });
    })().catch((e) => console.warn("Could not load picture", e));
    return () => {
      alive = false;
      if (acquired) releaseArtworkTexture(key);
    };
  }, [artworkId]);
  return pic;
}

const Easel = memo(function Easel({ runtime, record }: { runtime: WorldRuntime; record: EaselRecord }) {
  const pic = usePicture(record.artworkId);
  const root = useRef<THREE.Group>(null);
  const board = useRef<THREE.Group>(null);
  const pickRef = useRef<THREE.Group>(null);
  const outline = useMemo(() => createOutlineMaterial(0.03), []);
  const noteCount = record.notes.length;
  const prevNotes = useRef(noteCount);

  // Picture fits inside a 1.7 × 1.4 board, keeping its proportions.
  const aspect = pic?.aspect ?? 1;
  const maxW = 1.7, maxH = 1.4;
  const pw = aspect >= maxW / maxH ? maxW : maxH * aspect;
  const ph = aspect >= maxW / maxH ? maxW / aspect : maxH;
  const boardY = 1.55;

  useEffect(() => {
    const obj = pickRef.current;
    if (obj) {
      obj.userData.pickId = record.id;
      pickables.set(record.id, obj);
    }
    return () => {
      pickables.delete(record.id);
    };
  }, [record.id]);

  useEffect(() => {
    if (noteCount > prevNotes.current) {
      const e = runtime.easels.get(record.id);
      if (e) {
        e.wiggle = 0.8;
        burstStars(e.pos.clone().addScaledVector(e.n, 1.6), e.n, 10);
        runtime.celebrate(e.n, "note");
      }
    }
    prevNotes.current = noteCount;
  }, [noteCount, record.id, runtime]);

  useFrame((state) => {
    const g = root.current;
    const e = runtime.easels.get(record.id);
    if (!g || !e) return;
    _x.crossVectors(e.n, e.t).normalize();
    _m.makeBasis(_x, e.n, e.t);
    g.quaternion.setFromRotationMatrix(_m);
    g.position.copy(e.pos);
    if (e.carried) g.position.addScaledVector(e.n, 0.5 + Math.sin(state.clock.elapsedTime * 5) * 0.1);
    const s = e.spawn;
    const pop = s >= 1 ? 1 : 1 + 2.7 * Math.pow(s - 1, 3) + 1.7 * Math.pow(s - 1, 2);
    g.scale.setScalar(Math.max(0.01, pop));
    if (board.current) board.current.rotation.z = Math.sin(e.wiggle * 18) * 0.06 * e.wiggle;
  });

  const notes = useMemo(
    () =>
      record.notes.slice(-12).map((note, i) => {
        // Arrange notes around the frame edges.
        const slots: Array<[number, number]> = [
          [-pw / 2 - 0.05, ph / 2 - 0.1],
          [pw / 2 + 0.05, ph / 2 - 0.15],
          [-pw / 2 - 0.08, 0],
          [pw / 2 + 0.08, -0.05],
          [-pw / 2, -ph / 2 + 0.1],
          [pw / 2, -ph / 2 + 0.12],
          [-pw / 4, ph / 2 + 0.06],
          [pw / 4, ph / 2 + 0.08],
          [-pw / 4, -ph / 2 - 0.06],
          [pw / 4, -ph / 2 - 0.05],
          [0, ph / 2 + 0.1],
          [0, -ph / 2 - 0.1],
        ];
        const [x, y] = slots[i % slots.length];
        const rot = ((note.id.charCodeAt(note.id.length - 1) % 7) - 3) * 0.06;
        return { id: note.id, color: note.color, x, y, rot };
      }),
    [record.notes, pw, ph],
  );

  return (
    <group ref={root}>
      <group ref={pickRef}>
        {/* Legs */}
        {[
          { p: [-0.55, 0.95, 0.1], r: [0.12, 0, 0.18] },
          { p: [0.55, 0.95, 0.1], r: [0.12, 0, -0.18] },
          { p: [0, 0.9, -0.42], r: [-0.42, 0, 0] },
        ].map((leg, i) => (
          <group key={i} position={leg.p as [number, number, number]} rotation={leg.r as [number, number, number]}>
            <mesh material={toonMaterial(i === 2 ? WOOD_DARK : WOOD)} castShadow receiveShadow>
              <boxGeometry args={[0.09, 1.95, 0.09]} />
            </mesh>
            <mesh material={outline}>
              <boxGeometry args={[0.09, 1.95, 0.09]} />
            </mesh>
          </group>
        ))}
        {/* Shelf */}
        <group position={[0, boardY - ph / 2 - 0.08, 0.16]}>
          <mesh material={toonMaterial(WOOD)} castShadow receiveShadow>
            <boxGeometry args={[Math.max(1.3, pw + 0.3), 0.08, 0.22]} />
          </mesh>
          <mesh material={outline}>
            <boxGeometry args={[Math.max(1.3, pw + 0.3), 0.08, 0.22]} />
          </mesh>
        </group>
        <OpeningRibbon easelId={record.id} runtime={runtime} />
        <group ref={board} position={[0, boardY, 0.12]} rotation={[-0.1, 0, 0]}>
          {/* Board and frame */}
          <mesh material={toonMaterial("#fffaf0")} castShadow receiveShadow>
            <boxGeometry args={[pw + 0.16, ph + 0.16, 0.06]} />
          </mesh>
          <mesh material={outline}>
            <boxGeometry args={[pw + 0.16, ph + 0.16, 0.06]} />
          </mesh>
          {pic && (
            <mesh position={[0, 0, 0.035]}>
              <planeGeometry args={[pw, ph]} />
              {/* Transparent drawings show the white board behind them, like paper. */}
              <meshBasicMaterial map={pic.texture} toneMapped={false} transparent alphaTest={0.02} />
            </mesh>
          )}
          {notes.map((n) => (
            <mesh key={n.id} position={[n.x, n.y, 0.05]} rotation={[0, 0, n.rot]}>
              <planeGeometry args={[0.3, 0.3]} />
              <meshBasicMaterial map={noteTexture(n.color)} transparent alphaTest={0.3} toneMapped={false} />
            </mesh>
          ))}
        </group>
      </group>
    </group>
  );
});

/** A red ribbon with a bow across a newly hung easel; falls away when cut. */
function OpeningRibbon({ easelId, runtime }: { easelId: string; runtime: WorldRuntime }) {
  const waiting = useGame((s) => s.ribbon === easelId);
  const cutAt = useGame((s) => s.ribbonCutAt);
  const [cutting, setCutting] = useState<number | null>(null);
  const left = useRef<THREE.Group>(null);
  const right = useRef<THREE.Group>(null);
  const wasWaiting = useRef(waiting);

  useEffect(() => {
    if (wasWaiting.current && !waiting && cutAt) {
      setCutting(performance.now());
      const e = runtime.easels.get(easelId);
      if (e) {
        // Confetti: a few bursts of paper stars.
        for (let i = 0; i < 3; i++) setTimeout(() => burstStars(e.pos.clone().addScaledVector(e.n, 1 + i * 0.4), e.n, 18), i * 180);
        e.wiggle = 1;
      }
    }
    wasWaiting.current = waiting;
  }, [waiting, cutAt, easelId, runtime]);

  useFrame(() => {
    if (cutting === null) return;
    const t = Math.min(1, (performance.now() - cutting) / 1100);
    if (left.current) {
      left.current.rotation.z = -t * 1.4;
      left.current.position.y = -t * 0.6;
    }
    if (right.current) {
      right.current.rotation.z = t * 1.4;
      right.current.position.y = -t * 0.6;
    }
    if (t >= 1) setCutting(null);
  });

  if (!waiting && cutting === null) return null;
  const red = toonMaterial("#e8453c");
  return (
    <group position={[0, 0.95, 0.42]}>
      <group ref={left} position={[-0.02, 0, 0]}>
        <mesh material={red} position={[-0.45, 0, 0]} castShadow>
          <boxGeometry args={[0.9, 0.12, 0.02]} />
        </mesh>
      </group>
      <group ref={right} position={[0.02, 0, 0]}>
        <mesh material={red} position={[0.45, 0, 0]} castShadow>
          <boxGeometry args={[0.9, 0.12, 0.02]} />
        </mesh>
      </group>
      {cutting === null && (
        <group>
          <mesh material={red} position={[-0.12, 0.04, 0.03]} rotation={[0, 0, Math.PI / 2]} scale={[1, 1, 0.4]}>
            <coneGeometry args={[0.12, 0.24, 3]} />
          </mesh>
          <mesh material={red} position={[0.12, 0.04, 0.03]} rotation={[0, 0, -Math.PI / 2]} scale={[1, 1, 0.4]}>
            <coneGeometry args={[0.12, 0.24, 3]} />
          </mesh>
          <mesh material={toonMaterial("#ffd447")} position={[0, 0.04, 0.05]}>
            <sphereGeometry args={[0.06, 10, 8]} />
          </mesh>
        </group>
      )}
    </group>
  );
}
