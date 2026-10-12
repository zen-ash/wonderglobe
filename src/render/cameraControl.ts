// Mutable camera controller shared by the camera rig, pointer handling and UI
// buttons. Not React state: it changes every frame.

import { Vector3 } from "three";

export type CameraMode = "explore" | "planet";

export interface CameraController {
  mode: CameraMode;
  /** Explore: pitch (radians above the horizon) and distance from the player. */
  pitch: number;
  distance: number;
  /** Planet view: direction from planet centre to the camera, and its up vector. */
  planetDir: Vector3;
  planetUp: Vector3;
  planetDistance: number;
  /** 0..1 blend from explore (0) to planet (1). */
  blend: number;
  /** Optional temporary focus point (e.g. a new creation arriving). */
  focus: Vector3 | null;
  focusUntil: number;
  /** A creation or easel shown up close while its panel is open. */
  closeUpId: string | null;
  /** A slow orbit around a point (new arrivals). */
  showcase: { point: Vector3; start: number; duration: number; sweep: number } | null;
  /** Listeners notified when mode flips (for the UI). */
  listeners: Set<(mode: CameraMode) => void>;
}

export const EXPLORE_MIN_DIST = 5;
export const EXPLORE_MAX_DIST = 24;
export const PLANET_MIN_DIST = 46;
export const PLANET_MAX_DIST = 90;

export const camera: CameraController = {
  mode: "explore",
  pitch: 0.42,
  distance: 11,
  planetDir: new Vector3(0, 0, 1),
  planetUp: new Vector3(0, 1, 0),
  planetDistance: 62,
  blend: 0,
  focus: null,
  focusUntil: 0,
  closeUpId: null,
  showcase: null,
  listeners: new Set(),
};

/** Look at a creation/easel up close (null to return to the player). */
export function setCloseUp(id: string | null) {
  camera.closeUpId = id;
}

/** Circle slowly around a world point for a few seconds (new arrivals). */
export function showcaseAt(point: Vector3, seconds = 4.5, sweep = 1.6) {
  camera.showcase = { point: point.clone(), start: performance.now() / 1000, duration: seconds, sweep };
}

export function setCameraMode(mode: CameraMode, fromDir?: Vector3, up?: Vector3) {
  if (camera.mode === mode) return;
  if (mode === "planet" && fromDir) {
    camera.planetDir.copy(fromDir).normalize();
    if (up) camera.planetUp.copy(up);
  }
  camera.mode = mode;
  camera.listeners.forEach((fn) => fn(mode));
}

export function onCameraMode(fn: (mode: CameraMode) => void): () => void {
  camera.listeners.add(fn);
  return () => camera.listeners.delete(fn);
}

/** Zoom by a factor (wheel/pinch). Crossing the limits switches views. */
export function zoomCamera(factor: number, playerUp: Vector3, camUp: Vector3) {
  if (camera.mode === "explore") {
    const next = camera.distance * factor;
    if (next > EXPLORE_MAX_DIST * 1.08 && factor > 1) {
      setCameraMode("planet", playerUp, camUp);
      camera.planetDistance = PLANET_MIN_DIST + 6;
      return;
    }
    camera.distance = Math.min(EXPLORE_MAX_DIST, Math.max(EXPLORE_MIN_DIST, next));
  } else {
    const next = camera.planetDistance * factor;
    if (next < PLANET_MIN_DIST * 0.95 && factor < 1) {
      setCameraMode("explore");
      camera.distance = EXPLORE_MAX_DIST - 4;
      return;
    }
    camera.planetDistance = Math.min(PLANET_MAX_DIST, Math.max(PLANET_MIN_DIST, next));
  }
}

/** Briefly look at a point (e.g. where a new creation lands). */
export function focusCamera(point: Vector3, seconds: number, now: number) {
  camera.focus = point.clone();
  camera.focusUntil = now + seconds;
}

export function resetCamera() {
  camera.mode = "explore";
  camera.pitch = 0.42;
  camera.distance = 11;
  camera.blend = 0;
  camera.focus = null;
  camera.closeUpId = null;
  camera.showcase = null;
}
