"use client";
// Lives inside the Canvas and lets photo mode grab a picture of the world:
// render one frame and copy the drawing buffer in the same task (so it works
// without preserveDrawingBuffer).

import { useEffect } from "react";
import { useThree } from "@react-three/fiber";

export interface PhotoBridge {
  /** Snapshot of the current view, or null when the 3D view isn't ready. */
  capture: (() => HTMLCanvasElement | null) | null;
}

export const photoBridge: PhotoBridge = { capture: null };

export function PhotoCapture() {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    photoBridge.capture = () => {
      try {
        gl.render(scene, camera);
        const src = gl.domElement;
        const c = document.createElement("canvas");
        c.width = src.width;
        c.height = src.height;
        const ctx = c.getContext("2d");
        if (!ctx || !c.width || !c.height) return null;
        ctx.drawImage(src, 0, 0);
        return c;
      } catch (e) {
        console.warn("[wonderglobe] photo capture failed", e);
        return null;
      }
    };
    return () => {
      photoBridge.capture = null;
    };
  }, [gl, scene, camera]);
  return null;
}
