// The live 3D camera and canvas size, for DOM overlays (labels, markers) that
// project world positions to the screen without going through React.

import type { PerspectiveCamera } from "three";

export const view: { camera: PerspectiveCamera | null; width: number; height: number } = {
  camera: null,
  width: 1,
  height: 1,
};
