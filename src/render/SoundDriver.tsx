"use client";
// Feeds the player's surroundings to the audio layer: regional ambience,
// region-flavoured music and footsteps. Throttled; reads simulation state only.

import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { WorldRuntime } from "@/world/runtime";
import { REGIONS } from "@/world/planet";
import { nearestWater } from "@/world/agents";
import { PLANET_RADIUS } from "@/world/sphere";
import { updateAmbience, stopAmbience } from "@/audio/ambience";
import { setMusicRegion } from "@/audio/music";
import { playFootstep } from "@/audio/creatures";
import { camera } from "./cameraControl";

export function SoundDriver({ runtime }: { runtime: WorldRuntime }) {
  const last = useRef(0);
  const lastStep = useRef(0);

  useEffect(
    () => () => {
      stopAmbience();
      setMusicRegion(null);
    },
    [],
  );

  useFrame(() => {
    const p = runtime.player;
    // Footsteps: one per half-cycle of the walking bob.
    const step = Math.floor(p.phase / Math.PI);
    if (step !== lastStep.current) {
      lastStep.current = step;
      if (p.moving > 0.3) playFootstep(runtime.terrain.sample(p.n).ground, Math.min(1, p.moving));
    }
    const now = performance.now();
    if (now - last.current < 100) return;
    last.current = now;
    const r = runtime.terrain.regionAt(p.n);
    const w = nearestWater(p.n);
    const height = runtime.terrain.heightAt(p.n) - PLANET_RADIUS;
    updateAmbience({
      region: REGIONS[r.index].id,
      secondRegion: REGIONS[r.second].id,
      blend: 0.5 * (1 - Math.min(1, r.depth / 0.06)),
      moving: p.moving > 0.2,
      nearWater: Math.max(0, Math.min(1, 1 - (w.angle * PLANET_RADIUS) / 6)),
      altitude: Math.max(0, Math.min(1, height / 4.6)),
      inPlanetView: camera.mode === "planet",
    });
    setMusicRegion(REGIONS[r.index].id);
  });
  return null;
}
