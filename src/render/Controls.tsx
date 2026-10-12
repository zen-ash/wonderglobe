"use client";
// Camera rig (close exploration ↔ whole-planet view with smooth blending),
// pointer handling (tap to walk/inspect, drag to look around or carry things,
// wheel/pinch zoom) and keyboard walking.

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { WorldRuntime } from "@/world/runtime";
import { yawCamera, placePlayer } from "@/world/player";
import { PLANET_RADIUS } from "@/world/sphere";
import { camera as cam, zoomCamera, setCameraMode } from "./cameraControl";
import { pickables } from "./Creations";
import { collectiblePickables, isGamePickId, onGamePick } from "./Collectibles";
import { useGame } from "@/state/store";
import { playSfx } from "@/audio/sfx";
import { safeCapture } from "@/ui/pointer";
import { playCreatureSound } from "@/audio/creatures";
import { cloudObjects, cloudAt } from "./Sky";
import { rainBurst } from "./Weather";
import { addRipple } from "./ripples";
import { reportEvent } from "@/game/guide";

const _eyeE = new THREE.Vector3();
const _targetE = new THREE.Vector3();
const _eyeP = new THREE.Vector3();
const _upP = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _dirE = new THREE.Vector3();
const _target = new THREE.Vector3();
const _up = new THREE.Vector3();
const _q = new THREE.Quaternion();

function slerpDirs(a: THREE.Vector3, b: THREE.Vector3, t: number, out: THREE.Vector3) {
  const dot = THREE.MathUtils.clamp(a.dot(b), -1, 1);
  const ang = Math.acos(dot);
  if (ang < 1e-4) return out.copy(a);
  const s = Math.sin(ang);
  return out
    .copy(a)
    .multiplyScalar(Math.sin((1 - t) * ang) / s)
    .addScaledVector(b, Math.sin(t * ang) / s)
    .normalize();
}

export function CameraRig({ runtime, reducedMotion }: { runtime: WorldRuntime; reducedMotion: boolean }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const smoothTarget = useRef(new THREE.Vector3());
  const smoothEye = useRef(new THREE.Vector3());
  const first = useRef(true);
  const closeBlend = useRef(0);
  const closeEye = useRef(new THREE.Vector3());
  const closeTarget = useRef(new THREE.Vector3());
  const viewShift = useRef(0);

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const p = runtime.player;
    const n = p.n;
    // Explore camera behind the player.
    // Portrait screens see less sideways; pull back a little.
    const aspect = (camera as THREE.PerspectiveCamera).aspect || 1;
    // While riding, pull back so the flight (and the view below) is visible.
    const ride = runtime.riding ? 1.5 : 1;
    const d = Math.max(cam.distance, runtime.riding ? 10 : 0) * ride * (aspect < 1 ? 1 + (1 - aspect) * 0.7 : 1);
    const h = d * Math.sin(cam.pitch) + 1.2;
    const back = d * Math.cos(cam.pitch);
    _targetE.copy(p.pos).addScaledVector(n, 1.1);
    if (cam.focus && performance.now() / 1000 < cam.focusUntil) {
      // Only lean toward nearby points; far ones would twist the view.
      const d = cam.focus.distanceTo(_targetE);
      if (d < 14) _targetE.lerp(cam.focus, 0.5 * (1 - d / 14) + 0.15);
    } else if (cam.focus && performance.now() / 1000 > cam.focusUntil + 4) cam.focus = null;
    _eyeE.copy(p.pos).addScaledVector(n, h).addScaledVector(p.camForward, -back);
    // Stay above the ground (hills, mountain).
    const groundAtEye = runtime.terrain.heightAt(_dir.copy(_eyeE).normalize()) + 0.8;
    if (_eyeE.length() < groundAtEye) _eyeE.setLength(groundAtEye);

    // Close-ups: a panel is open for a creation/easel, or a new arrival is being shown off.
    const now = performance.now() / 1000;
    let close = false;
    if (cam.showcase && now > cam.showcase.start + cam.showcase.duration) cam.showcase = null;
    if (cam.closeUpId || cam.showcase) {
      let point: THREE.Vector3 | null = null;
      let up = n;
      let height = 1.2;
      let facing: THREE.Vector3 | null = null;
      let reach = 4.2;
      if (cam.closeUpId) {
        const a = runtime.creations.get(cam.closeUpId);
        const e = runtime.easels.get(cam.closeUpId);
        if (a) {
          point = a.pos;
          up = a.n;
          height = Math.min(2.4, a.size * 0.55);
          reach = 3.2 + a.size * 1.1;
          if (a.behavior === "build") facing = a.t;
        } else if (e) {
          point = e.pos;
          up = e.n;
          height = 1.5;
          reach = 4.6;
          facing = e.t;
        }
      } else if (cam.showcase) {
        point = cam.showcase.point;
        up = _dir.copy(point).normalize().clone();
        height = 1;
        reach = 6.5;
      }
      if (point) {
        close = true;
        closeTarget.current.copy(point).addScaledVector(up, height);
        // Look from the player's side (or from the front of a building/easel).
        const away = _dirE.copy(facing ?? smoothEye.current.clone().sub(point));
        away.addScaledVector(up, -away.dot(up));
        if (away.lengthSq() < 1e-6) away.copy(p.camForward).negate();
        away.normalize();
        if (cam.showcase && !cam.closeUpId) {
          const t = (now - cam.showcase.start) / cam.showcase.duration;
          _q.setFromAxisAngle(up, (THREE.MathUtils.smoothstep(t, 0, 1) - 0.5) * cam.showcase.sweep);
          away.applyQuaternion(_q);
        }
        closeEye.current.copy(closeTarget.current).addScaledVector(away, reach).addScaledVector(up, reach * 0.32);
        const g = runtime.terrain.heightAt(_up.copy(closeEye.current).normalize()) + 0.7;
        if (closeEye.current.length() < g) closeEye.current.setLength(g);
      }
    }
    closeBlend.current += ((close ? 1 : 0) - closeBlend.current) * Math.min(1, dt * (reducedMotion ? 6 : 2.4));
    const cb = THREE.MathUtils.smoothstep(closeBlend.current, 0, 1);
    if (cb > 0.001) {
      _eyeE.lerp(closeEye.current, cb);
      _targetE.lerp(closeTarget.current, cb);
    }
    // With a side panel open on wide screens, shift the picture left so the creation stays visible.
    const wantShift = cam.closeUpId && aspect > 1.25 ? 0.17 : 0;
    viewShift.current += (wantShift - viewShift.current) * Math.min(1, dt * 3);
    if (viewShift.current > 0.002) {
      const w = state.size.width, hgt = state.size.height;
      camera.setViewOffset(w, hgt, w * viewShift.current, 0, w, hgt);
    } else if (camera.view?.enabled) camera.clearViewOffset();

    // Smooth the explore camera a little (feels gentle, hides hops).
    const k = 1 - Math.exp(-dt * 9);
    if (first.current) {
      smoothEye.current.copy(_eyeE);
      smoothTarget.current.copy(_targetE);
      first.current = false;
    } else {
      smoothEye.current.lerp(_eyeE, k);
      smoothTarget.current.lerp(_targetE, k);
    }

    // Planet view.
    _upP.copy(cam.planetUp).addScaledVector(cam.planetDir, -cam.planetUp.dot(cam.planetDir)).normalize();
    _eyeP.copy(cam.planetDir).multiplyScalar(cam.planetDistance);

    const want = cam.mode === "planet" ? 1 : 0;
    const speed = reducedMotion ? 3 : 1.1;
    cam.blend += Math.sign(want - cam.blend) * Math.min(Math.abs(want - cam.blend), dt * speed);
    const b = THREE.MathUtils.smootherstep(cam.blend, 0, 1);

    // Interpolate along an arc (direction + radius) so we never pass through the planet.
    _dirE.copy(smoothEye.current).normalize();
    const rE = smoothEye.current.length();
    slerpDirs(_dirE, cam.planetDir, b, _dir);
    camera.position.copy(_dir).multiplyScalar(THREE.MathUtils.lerp(rE, cam.planetDistance, b));
    _target.copy(smoothTarget.current).multiplyScalar(1 - b);
    slerpDirs(n, _upP, b, _up);
    camera.up.copy(_up);
    camera.lookAt(_target);
    runtime.focus.copy(_dir);
  }, -0.5); // after the simulation, before objects face the camera (positive priorities would disable auto-render)

  useEffect(() => {
    camera.near = 0.1;
    camera.far = 400;
    camera.updateProjectionMatrix();
  }, [camera]);
  return null;
}

// ------------------------------------------------------------------ pointer

interface PointerState {
  id: number;
  x: number;
  y: number;
  startX: number;
  startY: number;
  startTime: number;
  pickId: string | null;
  carrying: boolean;
  carryFrom: THREE.Vector3 | null;
  moved: boolean;
}

export function PointerControls({ runtime, planet }: { runtime: WorldRuntime; planet: React.RefObject<THREE.Mesh | null> }) {
  const { gl, camera, size } = useThree();
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const ndc = useMemo(() => new THREE.Vector2(), []);
  const pointers = useRef(new Map<number, PointerState>());
  const pinch = useRef<number | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // "Shake the planet": quick back-and-forth drags in the planet view.
  const shake = useRef({ lastSign: 0, flips: [] as number[], cooldown: 0 });

  useEffect(() => {
    const el = gl.domElement;

    const setRay = (x: number, y: number) => {
      const rect = el.getBoundingClientRect();
      ndc.set(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
    };

    /** A tapped cloud rains a little shower on the spot. */
    const tapCloud = (x: number, y: number): boolean => {
      setRay(x, y);
      const hit = raycaster.intersectObjects(cloudObjects(), false)[0];
      const c = hit ? cloudAt(hit.object) : null;
      if (!c) return false;
      rainBurst(c.position);
      playSfx("rain-start");
      return true;
    };

    const pickObject = (x: number, y: number): string | null => {
      setRay(x, y);
      const objs = [...pickables.values(), ...collectiblePickables.values()];
      const hits = raycaster.intersectObjects(objs, true);
      const planetHit = planet.current ? raycaster.intersectObject(planet.current, false)[0] : undefined;
      for (const h of hits) {
        if (planetHit && h.distance > planetHit.distance + 0.5) break;
        let o: THREE.Object3D | null = h.object;
        while (o && !o.userData.pickId) o = o.parent;
        if (o?.userData.pickId) return o.userData.pickId as string;
      }
      return null;
    };

    const groundPoint = (x: number, y: number): THREE.Vector3 | null => {
      setRay(x, y);
      if (!planet.current) return null;
      const hit = raycaster.intersectObject(planet.current, false)[0];
      if (hit) return hit.point.clone().normalize();
      // Fall back to the water sphere / ideal sphere.
      const sphere = new THREE.Sphere(new THREE.Vector3(), PLANET_RADIUS);
      const p = raycaster.ray.intersectSphere(sphere, new THREE.Vector3());
      return p ? p.normalize() : null;
    };

    const startCarry = (ps: PointerState) => {
      if (!ps.pickId || ps.carrying) return;
      const from = runtime.positionOf(ps.pickId);
      if (!from) return;
      ps.carryFrom = from.clone();
      if (runtime.pickUp(ps.pickId)) {
        ps.carrying = true;
        playSfx("rustle");
        useGame.getState().setCarrying({ id: ps.pickId, ok: true });
      }
    };

    const blockedByUi = () => {
      const s = useGame.getState();
      return s.screen !== "playing";
    };

    const onDown = (e: PointerEvent) => {
      if (blockedByUi()) return;
      safeCapture(el, e.pointerId);
      const ps: PointerState = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        startX: e.clientX,
        startY: e.clientY,
        startTime: performance.now(),
        pickId: pointers.current.size === 0 ? pickObject(e.clientX, e.clientY) : null,
        carrying: false,
        carryFrom: null,
        moved: false,
      };
      pointers.current.set(e.pointerId, ps);
      if (pointers.current.size === 2) {
        const [a, b] = [...pointers.current.values()];
        pinch.current = Math.hypot(a.x - b.x, a.y - b.y);
        if (holdTimer.current) clearTimeout(holdTimer.current);
        // A second finger cancels carrying a press.
        a.pickId = null;
      }
      if (ps.pickId) {
        // Press and hold also picks things up.
        holdTimer.current = setTimeout(() => startCarry(ps), 380);
      }
    };

    const onMove = (e: PointerEvent) => {
      const ps = pointers.current.get(e.pointerId);
      if (!ps) return;
      const dx = e.clientX - ps.x, dy = e.clientY - ps.y;
      ps.x = e.clientX;
      ps.y = e.clientY;
      if (!ps.moved && Math.hypot(ps.x - ps.startX, ps.y - ps.startY) > 7) {
        ps.moved = true;
        if (holdTimer.current) clearTimeout(holdTimer.current);
        if (ps.pickId && cam.mode === "explore") startCarry(ps);
      }
      if (pointers.current.size === 2 && pinch.current) {
        const [a, b] = [...pointers.current.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (dist > 0) {
          zoomCamera(pinch.current / dist, runtime.player.n, runtime.player.camForward);
          pinch.current = dist;
        }
        return;
      }
      if (ps.carrying && ps.pickId) {
        const g = groundPoint(e.clientX, e.clientY);
        if (g) {
          runtime.carryTo(ps.pickId, g);
          const ok = runtime.canDrop(ps.pickId, g);
          const cur = useGame.getState().carrying;
          if (!cur || cur.ok !== ok) useGame.getState().setCarrying({ id: ps.pickId, ok });
        }
        return;
      }
      if (!ps.moved) return;
      // Drag empty space to look around.
      if (cam.mode === "explore") {
        yawCamera(runtime.player, -dx * 0.0075);
        cam.pitch = THREE.MathUtils.clamp(cam.pitch + dy * 0.005, 0.1, 1.3);
      } else {
        const sh = shake.current;
        const sign = Math.abs(dx) > 6 ? Math.sign(dx) : 0;
        const now = performance.now();
        if (sign && sign !== sh.lastSign) {
          sh.flips = sh.flips.filter((t) => now - t < 1200);
          sh.flips.push(now);
          sh.lastSign = sign;
          if (sh.flips.length >= 5 && now > sh.cooldown) {
            sh.cooldown = now + 2500;
            sh.flips = [];
            runtime.jumpAll();
            playSfx("jump");
          }
        }
        const right = new THREE.Vector3().crossVectors(cam.planetDir, cam.planetUp).normalize();
        _q.setFromAxisAngle(cam.planetUp, -dx * 0.006);
        cam.planetDir.applyQuaternion(_q);
        _q.setFromAxisAngle(right, -dy * 0.006);
        cam.planetDir.applyQuaternion(_q).normalize();
        cam.planetUp.applyQuaternion(_q).normalize();
      }
    };

    const onUp = (e: PointerEvent) => {
      const ps = pointers.current.get(e.pointerId);
      pointers.current.delete(e.pointerId);
      if (pointers.current.size < 2) pinch.current = null;
      if (holdTimer.current) clearTimeout(holdTimer.current);
      if (!ps) return;
      const game = useGame.getState();
      if (ps.carrying && ps.pickId) {
        const g = groundPoint(e.clientX, e.clientY) ?? ps.carryFrom!;
        const ok = runtime.drop(ps.pickId, g, ps.carryFrom!);
        playSfx(ok ? "pop" : "error");
        game.setCarrying(null);
        game.markDirty();
        return;
      }
      if (ps.moved || e.type === "pointercancel") return;
      if (performance.now() - ps.startTime > 700) return;
      if (isGamePickId(ps.pickId)) {
        onGamePick(ps.pickId);
        return;
      }
      if (ps.pickId) {
        playSfx("click");
        const isEasel = runtime.easels.has(ps.pickId);
        if (!isEasel) {
          // A tap is also a friendly pat: a heart and a happy hop.
          const kind = runtime.pat(ps.pickId);
          if (kind) {
            playSfx("pat");
            playCreatureSound(kind, { volume: 0.8 });
            reportEvent("pat");
          }
        }
        game.openPanel(isEasel ? "easel" : "creation", ps.pickId);
        return;
      }
      if (tapCloud(e.clientX, e.clientY)) return;
      const g = groundPoint(e.clientX, e.clientY);
      if (!g) return;
      if (runtime.terrain.isWater(g)) {
        addRipple(g.clone().multiplyScalar(PLANET_RADIUS), 1);
        playSfx("splash", { volume: 0.5 });
      }
      if (cam.mode === "planet") {
        // Travel there: hop over and float back down to explore.
        const spot = runtime.findLandNear(g, 0.25);
        if (spot) {
          placePlayer(runtime.player, spot);
          setCameraMode("explore");
          playSfx("whoosh");
        }
        return;
      }
      runtime.player.target = g;
    };

    const onWheel = (e: WheelEvent) => {
      if (blockedByUi()) return;
      e.preventDefault();
      const factor = Math.exp(e.deltaY * 0.0012);
      zoomCamera(factor, runtime.player.n, runtime.player.camForward);
    };

    const onContext = (e: Event) => e.preventDefault();

    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("contextmenu", onContext);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("contextmenu", onContext);
    };
  }, [gl, camera, raycaster, ndc, runtime, planet, size]);

  return null;
}

// ----------------------------------------------------------------- keyboard

export function useKeyboardWalking(runtime: WorldRuntime | null) {
  useEffect(() => {
    if (!runtime) return;
    const keys = new Set<string>();
    const update = () => {
      let x = 0, y = 0;
      if (keys.has("KeyW") || keys.has("ArrowUp")) y += 1;
      if (keys.has("KeyS") || keys.has("ArrowDown")) y -= 1;
      if (keys.has("KeyD") || keys.has("ArrowRight")) x += 1;
      if (keys.has("KeyA") || keys.has("ArrowLeft")) x -= 1;
      runtime.input.x = x;
      runtime.input.y = y;
    };
    const typing = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
    };
    const MOVE = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);
    const down = (e: KeyboardEvent) => {
      if (typing(e) || !MOVE.has(e.code)) return;
      if (useGame.getState().panel && useGame.getState().panel !== "collection") return;
      e.preventDefault();
      keys.add(e.code);
      if (cam.mode === "planet") setCameraMode("explore");
      update();
    };
    const up = (e: KeyboardEvent) => {
      keys.delete(e.code);
      update();
    };
    const blur = () => {
      keys.clear();
      update();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [runtime]);
}
