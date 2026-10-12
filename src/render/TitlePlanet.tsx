"use client";
// A slowly turning little paper planet behind the title screen: the real
// terrain (fixed seed, low detail), its water, a sprinkling of paper cut-out
// scenery from the shared atlas, a few drifting clouds and the sun. Cheap by
// design: low-poly, dpr ≤ 1.5, paused while the tab is hidden, and it simply
// disappears if WebGL is unavailable.

import { Component, useEffect, useMemo, useState, type ReactNode } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { Terrain } from "@/world/planet";
import { generateScenery } from "@/world/scenery";
import { PLANET_RADIUS } from "@/world/sphere";
import { seasonFromDate } from "@/world/environment";
import type { SceneryArtId } from "@/art/sceneryAtlas";
import { buildPlanetGeometry, buildWaterGeometry } from "./Planet";
import { createPlanetMaterial, createWaterMaterial, createBillboardMaterial, createStandingQuad, envUniforms, BILLBOARD_KIND } from "./materials";
import { getAssets } from "./assets";

const TITLE_SEED = 20240611;

/** Instanced camera-facing cut-outs (attributes as expected by createBillboardMaterial). */
function buildBillboards(count: number) {
  const base = createStandingQuad();
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute("position", base.getAttribute("position"));
  geo.setAttribute("uv", base.getAttribute("uv"));
  const attr = (n: number) => new THREE.InstancedBufferAttribute(new Float32Array(count * n), n);
  const center = attr(3), size = attr(2), uv = attr(4), params = attr(4), extra = attr(4);
  geo.setAttribute("aCenter", center);
  geo.setAttribute("aSize", size);
  geo.setAttribute("aUv", uv);
  geo.setAttribute("aParams", params);
  geo.setAttribute("aExtra", extra);
  geo.instanceCount = count;
  return { geo, center, size, uv, params, extra };
}

/** Seasonal behaviour of a cut-out in the billboard shader (autumn leaves, blossom, frost). */
function kindOf(art: string): number {
  if (/^(tree_round|tree_fruit|tree_birch|bush|bush_berry)$/.test(art)) return BILLBOARD_KIND.tree;
  if (/^(tree_pine|snow_pine|palm)$/.test(art)) return BILLBOARD_KIND.evergreen;
  if (art === "tree_cherry") return BILLBOARD_KIND.blossom;
  if (/^(flower_|tulip|sunflower|daisy|grass|reed)/.test(art)) return BILLBOARD_KIND.plant;
  if (/^(house_|cottage|barn|windmill|beach_hut)/.test(art)) return BILLBOARD_KIND.windows;
  return BILLBOARD_KIND.none;
}
const FOV = 32;

function hasWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

/** A calm daytime look for the shared atmosphere uniforms (the game resets them every frame). */
function calmDay(reduced: boolean) {
  const season = seasonFromDate(new Date());
  envUniforms.uEnvTint.value.setRGB(1, 1, 1);
  envUniforms.uEnvDay.value.set(1, 0, 0, envUniforms.uEnvDay.value.w);
  envUniforms.uEnvWeather.value.set(0, season === "winter" ? 0.3 : 0, season === "autumn" ? 1 : 0, season === "spring" ? 1 : 0);
  envUniforms.uEnvWind.value.set(0, 1, 0, 0.15);
  envUniforms.uLightDir.value.set(0.55, 0.62, 0.56).normalize();
  envUniforms.uHazeColor.value.set("#d9eedd");
  envUniforms.uHaze.value.set(200, 260, 0, reduced ? 0.4 : 1);
}

/** Planet framing: centred low on the screen, sized to the viewport. */
function Framing() {
  const { camera, size } = useThree();
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    const W = size.width, H = size.height;
    const portrait = W < H * 0.8;
    // A big round dome rising from the bottom edge, behind the cards, with
    // its cut-out trees standing up along the skyline as it turns.
    const rPx = portrait ? Math.min(W * 0.78, H * 0.36) : Math.min(H * 0.75, W * 0.5);
    const topPx = portrait ? H - rPx * 0.8 : H * 0.55;
    const centreY = (topPx + rPx) / H;
    const half = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const alpha = Math.atan((rPx / (H / 2)) * half);
    const dist = (PLANET_RADIUS + 0.8) / Math.sin(alpha);
    cam.fov = FOV;
    cam.near = 1;
    cam.far = dist + 120;
    cam.position.set(0, 0, dist);
    cam.lookAt(0, 0, 0);
    // Shift the picture down so the planet rises from behind the cards.
    cam.setViewOffset(W, H, 0, -(centreY - 0.5) * H, W, H);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  }, [camera, size]);
  return null;
}

function Scene({ reduced }: { reduced: boolean }) {
  const built = useMemo(() => {
    const assets = getAssets();
    const terrain = new Terrain(TITLE_SEED);
    const planetGeo = buildPlanetGeometry(terrain, 20);
    const planetMat = createPlanetMaterial(assets.grain);
    const waterGeo = buildWaterGeometry(terrain, true);
    const waterMat = createWaterMaterial();

    // Paper cut-outs: every other standing item is plenty at this distance.
    const items = generateScenery(terrain, TITLE_SEED).items.filter((it, i) => !it.flat && !!assets.atlas.entries[it.art as SceneryArtId] && (it.size > 1.2 || i % 2 === 0));
    const { geo, center, size, uv, params, extra } = buildBillboards(items.length);
    const p = new THREE.Vector3();
    items.forEach((it, i) => {
      const e = assets.atlas.entries[it.art as SceneryArtId];
      p.copy(it.n).multiplyScalar(it.onWater ? Math.max(terrain.heightAt(it.n), PLANET_RADIUS - 0.06) : terrain.heightAt(it.n) - 0.04);
      center.setXYZ(i, p.x, p.y, p.z);
      // About game size: the planet is shown big behind the cards.
      size.setXY(i, it.size * 1.05 * e.aspect, it.size * 1.05);
      uv.setXYZW(i, e.u0, e.v0, e.u1, e.v1);
      params.setXYZW(i, it.sway, (i * 1.7) % 6.28, i % 3 === 0 ? -1 : 1, -e.anchorY * it.size * 1.05);
      extra.setXYZW(i, kindOf(it.art), (i * 0.618) % 1, 0, 0);
    });
    const billMat = createBillboardMaterial(assets.atlasTexture);
    const bill = new THREE.Mesh(geo, billMat);
    bill.frustumCulled = false;

    // Clouds orbiting on a few tilted rings.
    const clouds = [0, 1, 2, 3, 4].map((k) => {
      const mat = new THREE.SpriteMaterial({ map: assets.clouds[k % assets.clouds.length], transparent: true, depthWrite: false, opacity: 0.95 });
      const s = new THREE.Sprite(mat);
      const w = 5.5 + (k % 3) * 1.6;
      s.scale.set(w, w * 0.55, 1);
      return { sprite: s, mat, angle: k * 1.31, tilt: -0.5 + (k % 3) * 0.5, speed: 0.05 + (k % 2) * 0.025, r: PLANET_RADIUS + 7 + (k % 2) * 2 };
    });
    const sunMat = new THREE.SpriteMaterial({ map: assets.sun, transparent: true, depthWrite: false });
    const sun = new THREE.Sprite(sunMat);
    sun.scale.set(8, 8, 1);
    return { planetGeo, planetMat, waterGeo, waterMat, bill, billMat, clouds, sun, sunMat };
  }, []);

  useEffect(() => {
    calmDay(reduced);
  }, [reduced]);

  useEffect(
    () => () => {
      built.planetGeo.dispose();
      built.planetMat.dispose();
      built.waterGeo.dispose();
      built.waterMat.dispose();
      built.bill.geometry.dispose();
      built.billMat.dispose();
      built.clouds.forEach((c) => c.mat.dispose());
      built.sunMat.dispose();
    },
    [built],
  );

  const group = useMemo(() => new THREE.Group(), []);
  const spin = useMemo(() => new THREE.Group(), []);
  useEffect(() => {
    group.rotation.set(0.42, 0, -0.18);
    spin.rotation.y = 2.2;
  }, [group, spin]);

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const motion = reduced ? 0.12 : 1;
    spin.rotation.y += dt * 0.06 * motion;
    built.waterMat.uniforms.uTime.value += dt * motion;
    built.billMat.uniforms.uTime.value += dt * motion;
    // No "player" to keep visible: park it at the camera so nothing dissolves.
    built.billMat.uniforms.uPlayer.value.copy(state.camera.position);
    envUniforms.uEnvDay.value.w += dt * motion;
    for (const c of built.clouds) {
      c.angle += dt * c.speed * motion;
      const x = Math.cos(c.angle) * c.r;
      const z = Math.sin(c.angle) * c.r;
      c.sprite.position.set(x, Math.sin(c.angle * 0.7 + c.tilt * 3) * 4 + c.tilt * 10, z);
      // Clouds read best near the planet's rim: fade the ones drifting in front.
      c.mat.opacity = 0.95 * (1 - THREE.MathUtils.smoothstep(z, c.r * 0.25, c.r * 0.75));
    }
  });

  // The sun sits in a free corner of the screen, far behind the planet.
  const { camera, size } = useThree();
  useEffect(() => {
    const W = size.width, H = size.height;
    const portrait = W < H * 0.8;
    const ndc = new THREE.Vector3(portrait ? 0.74 : 0.76, portrait ? 0.86 : 0.55, 0.5).unproject(camera);
    const dir = ndc.sub(camera.position).normalize();
    built.sun.position.copy(camera.position).addScaledVector(dir, camera.position.length() + PLANET_RADIUS * 1.6);
  }, [camera, size, built]);

  return (
    <>
      <primitive object={group}>
        <primitive object={spin}>
          <mesh geometry={built.planetGeo} material={built.planetMat} />
          <mesh geometry={built.waterGeo} material={built.waterMat} renderOrder={2} />
          <primitive object={built.bill} />
        </primitive>
      </primitive>
      {built.clouds.map((c, i) => (
        <primitive key={i} object={c.sprite} />
      ))}
      <primitive object={built.sun} />
    </>
  );
}

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    console.warn("Title planet unavailable", error);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** Decorative background planet for the title screen (lazy-load with ssr: false). */
export default function TitlePlanet({ reducedMotion = false }: { reducedMotion?: boolean }) {
  const [ok, setOk] = useState(false);
  const [ready, setReady] = useState(false);
  const [visible, setVisible] = useState(true);

  // Wait for an idle moment so the logo and cards paint first.
  useEffect(() => {
    if (!hasWebGL()) return;
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(() => setOk(true), { timeout: 600 });
      return () => w.cancelIdleCallback?.(id);
    }
    const t = window.setTimeout(() => setOk(true), 200);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    const upd = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", upd);
    return () => document.removeEventListener("visibilitychange", upd);
  }, []);

  if (!ok) return null;
  return (
    <div className={`title-planet ${ready ? "ready" : ""}`} aria-hidden>
      <Boundary>
        <Canvas
          dpr={[1, 1.5]}
          frameloop={visible ? "always" : "never"}
          gl={{ antialias: true, alpha: true, powerPreference: "low-power" }}
          camera={{ fov: FOV, position: [0, 0, 80], near: 1, far: 300 }}
          onCreated={({ gl }) => {
            gl.toneMapping = THREE.NoToneMapping;
            gl.outputColorSpace = THREE.SRGBColorSpace;
            gl.setClearColor(0x000000, 0);
            requestAnimationFrame(() => requestAnimationFrame(() => setReady(true)));
          }}
          // The title is a background: let taps fall through to the cards.
          style={{ pointerEvents: "none" }}
        >
          <Framing />
          <Scene reduced={reducedMotion} />
        </Canvas>
      </Boundary>
    </div>
  );
}
