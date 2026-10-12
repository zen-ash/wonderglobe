// Moving the player around the planet for the UI (collection, arrivals).

import * as THREE from "three";
import { useGame } from "@/state/store";
import { moveAlong, tangentToward, angleBetween, PLANET_RADIUS } from "@/world/sphere";
import { placePlayer } from "@/world/player";
import { focusCamera, setCameraMode, camera } from "@/render/cameraControl";

/** Put the player a few steps from `target` (unit vector), facing it. */
export function travelNear(target: THREE.Vector3, opts: { standOff?: number; approach?: THREE.Vector3 } = {}) {
  const runtime = useGame.getState().runtime;
  if (!runtime) return;
  const n = target.clone();
  const t = opts.approach ? opts.approach.clone() : tangentToward(target, runtime.player.n, new THREE.Vector3());
  moveAlong(n, t, opts.standOff ?? 3.4);
  const spot = runtime.findLandNear(n, 0.2) ?? n;
  placePlayer(runtime.player, spot, target);
  setCameraMode("explore");
  // Look a little more from above so nearby trees don't hide what we came to see.
  camera.pitch = Math.max(camera.pitch, 0.72);
  camera.distance = Math.max(camera.distance, 12);
}

/** Travel to a creation or easel by id and look at it. */
export function travelTo(id: string) {
  const runtime = useGame.getState().runtime;
  if (!runtime) return;
  const target = runtime.positionOf(id);
  if (!target) return;
  const e = runtime.easels.get(id);
  travelNear(target.clone(), { standOff: e ? 3.4 : 3.6, approach: e?.t });
  focusCamera(target.clone().multiplyScalar(runtime.terrain.heightAt(target) + 1.2), 2.5, performance.now() / 1000);
}

/** Distance in world units from the player to a point. */
export function distanceFromPlayer(n: THREE.Vector3): number {
  const runtime = useGame.getState().runtime;
  if (!runtime) return 0;
  return angleBetween(runtime.player.n, n) * PLANET_RADIUS;
}
