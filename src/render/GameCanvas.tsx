"use client";
// The 3D view: one R3F canvas showing the loaded world.

import { useRef, Suspense, useEffect } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { WorldRuntime } from "@/world/runtime";
import type { CreationRecord, EaselRecord, WorldMode } from "@/core/types";
import { PlanetMesh, WaterShell } from "./Planet";
import { SkyAndLights } from "./Sky";
import { PaperScenery } from "./PaperScenery";
import { GalleryScenery } from "./GalleryScenery";
import { Creations } from "./Creations";
import { Easels } from "./Easels";
import { Player } from "./Player";
import { Bursts } from "./Bursts";
import { CameraRig, PointerControls, useKeyboardWalking } from "./Controls";
import { camera } from "./cameraControl";
import { SoundDriver } from "./SoundDriver";
import { RegionSigns } from "./RegionSigns";
import { view } from "./viewState";
import { splashHooks } from "./Arrival";
import { addRipple } from "./ripples";
import { Collectibles } from "./Collectibles";
import { GuideSnail } from "./GuideSnail";
import { PhotoCapture } from "./PhotoCapture";
import { occlusionUniforms } from "./materials";
import { useGame } from "@/state/store";
import * as persistence from "@/persistence";

// Arrival splashes make real ripples on the water.
splashHooks.addRipple = (point, size) => void addRipple(point, size);

/** Exposes the scene for debugging in development builds only. */
function DevHandle({ runtime }: { runtime: WorldRuntime }) {
  const state = useThree();
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") (window as unknown as { __wg: unknown }).__wg = { runtime, state, THREE, camera, store: useGame, persistence };
  }, [runtime, state]);
  return null;
}

/** Shares the camera with DOM overlays (labels over the planet). */
function ViewSync() {
  useFrame((state) => {
    view.camera = state.camera as THREE.PerspectiveCamera;
    view.width = state.size.width;
    view.height = state.size.height;
  });
  useEffect(
    () => () => {
      view.camera = null;
    },
    [],
  );
  return null;
}

/** Tells the UI once the first frame has been drawn (to lift the loading screen). */
function FirstFrame({ onReady }: { onReady?: () => void }) {
  const done = useRef(false);
  useFrame(() => {
    if (done.current) return;
    done.current = true;
    requestAnimationFrame(() => onReady?.());
  });
  return null;
}

/** 3D shapes and paper creations between the camera and the player dissolve. */
function OcclusionUpdater({ runtime }: { runtime: WorldRuntime }) {
  useEffect(() => {
    occlusionUniforms.uOcclOn.value = 1;
    return () => {
      occlusionUniforms.uOcclOn.value = 0;
    };
  }, []);
  useFrame(() => {
    occlusionUniforms.uOcclPlayer.value.copy(runtime.player.pos).addScaledVector(runtime.player.n, 0.8);
  }, -0.4);
  return null;
}

function SimLoop({ runtime }: { runtime: WorldRuntime }) {
  useFrame((_, dt) => {
    // Clamped inside step(); a hidden tab resumes without a giant jump.
    runtime.step(dt);
  }, -1);
  return null;
}

export interface GameCanvasProps {
  runtime: WorldRuntime;
  mode: WorldMode;
  creations: CreationRecord[];
  easels: EaselRecord[];
  lightGraphics: boolean;
  reducedMotion: boolean;
  onReady?: () => void;
  timeMode?: "cycle" | "real" | "day";
}

export default function GameCanvas({ runtime, mode, creations, easels, lightGraphics, reducedMotion, onReady, timeMode }: GameCanvasProps) {
  const planetRef = useRef<THREE.Mesh | null>(null);
  const playerPos = useRef<THREE.Vector3>(runtime.player.pos);
  useKeyboardWalking(runtime);
  return (
    <Canvas
      className="game-canvas"
      dpr={lightGraphics ? [1, 1.25] : [1, 2]}
      gl={{ antialias: !lightGraphics, powerPreference: "high-performance", alpha: false }}
      camera={{ fov: 50, near: 0.1, far: 400, position: [0, 30, 40] }}
      // Real cast shadows (configured on the sun light in Sky.tsx); off for lighter graphics.
      shadows={lightGraphics ? false : { type: THREE.PCFSoftShadowMap }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.NoToneMapping;
        gl.outputColorSpace = THREE.SRGBColorSpace;
      }}
    >
      <Suspense fallback={null}>
        <SimLoop runtime={runtime} />
        <OcclusionUpdater runtime={runtime} />
        <DevHandle runtime={runtime} />
        <SkyAndLights lightGraphics={lightGraphics} reducedMotion={reducedMotion} timeMode={timeMode} />
        <PlanetMesh terrain={runtime.terrain} light={lightGraphics} onReady={(m) => (planetRef.current = m)} />
        <WaterShell light={lightGraphics} terrain={runtime.terrain} />
        {mode === "paper" ? <PaperScenery runtime={runtime} playerRef={playerPos} /> : <GalleryScenery runtime={runtime} />}
        <RegionSigns runtime={runtime} mode={mode} />
        <Creations runtime={runtime} records={creations} reducedMotion={reducedMotion} />
        <Easels runtime={runtime} records={easels} />
        <Player runtime={runtime} mode={mode} />
        <Bursts reducedMotion={reducedMotion} />
        <CameraRig runtime={runtime} reducedMotion={reducedMotion} />
        <PointerControls runtime={runtime} planet={planetRef} />
        <Collectibles runtime={runtime} mode={mode} reducedMotion={reducedMotion} />
        <GuideSnail runtime={runtime} mode={mode} reducedMotion={reducedMotion} />
        <PhotoCapture />
        <FirstFrame onReady={onReady} />
        <ViewSync />
        <SoundDriver runtime={runtime} />
      </Suspense>
    </Canvas>
  );
}
