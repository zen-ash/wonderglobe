"use client";
// Night lights: warm glows around house windows, lamp posts and the
// lighthouse (plus soft pools of light on the ground and a slowly sweeping
// lighthouse beam), and fireflies drifting over the ponds, the meadow and
// the garden. Everything fades in with the night; all instanced.

import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { WorldRuntime } from "@/world/runtime";
import type { SceneryArtId } from "@/art/sceneryAtlas";
import { environment } from "@/world/environment";
import { REGION_BY_ID, WATER_BODIES, WATER_LEVEL } from "@/world/planet";
import { randomInCap } from "@/world/sphere";
import { mulberry32 } from "@/world/noise";
import { PARTICLE_CELLS, particleCellUv } from "@/art/weatherArt";
import { getAssets } from "./assets";

type GlowKind = 0 | 1 | 2; // window, lamp, beacon
/** [height fraction of the item, glow size as a fraction of item size, kind]. */
type GlowSpot = [number, number, GlowKind];

const PAPER_GLOWS: Partial<Record<SceneryArtId, GlowSpot[]>> = {
  house_red: [[0.3, 0.5, 0], [0.56, 0.26, 0]],
  house_blue: [[0.3, 0.5, 0], [0.56, 0.26, 0]],
  house_yellow: [[0.3, 0.5, 0], [0.56, 0.26, 0]],
  cottage: [[0.3, 0.5, 0], [0.55, 0.25, 0]],
  barn: [[0.66, 0.4, 0], [0.2, 0.45, 0]],
  windmill: [[0.36, 0.25, 0]],
  beach_hut: [[0.42, 0.45, 0]],
  lamp_post: [[0.78, 0.6, 1]],
  lighthouse: [[0.81, 0.8, 2], [0.5, 0.18, 0]],
};

const GALLERY_GLOWS: Partial<Record<SceneryArtId, GlowSpot[]>> = {
  house_red: [[0.34, 0.6, 0]],
  house_blue: [[0.34, 0.6, 0]],
  house_yellow: [[0.34, 0.6, 0]],
  cottage: [[0.34, 0.6, 0]],
  barn: [[0.48, 0.45, 0]],
  lamp_post: [[0.92, 0.7, 1]],
  lighthouse: [[0.8, 0.9, 2]],
};

/** Ground light pools: radius as a fraction of item size. */
const POOLS: Partial<Record<SceneryArtId, number>> = {
  lamp_post: 0.75,
  house_red: 0.55,
  house_blue: 0.55,
  house_yellow: 0.55,
  cottage: 0.55,
  barn: 0.45,
  lighthouse: 0.4,
};

const GLOW_VERT = /* glsl */ `
  attribute vec4 aGlow;  // xyz world, size
  attribute vec4 aInfo;  // kind, phase, flat, 0
  uniform float uNight;
  uniform float uTime;
  uniform float uCalm;
  uniform vec4 uRect;
  varying vec2 vUv;
  varying float vI;
  varying vec3 vCol;
  void main() {
    vec3 p = aGlow.xyz;
    vec3 n = normalize(p);
    vec3 r;
    vec3 u;
    float flatOn = step(0.5, aInfo.z);
    if (flatOn > 0.5) {
      vec3 a = abs(n.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
      r = normalize(cross(n, a));
      u = cross(n, r);
      p += n * 0.07;
    } else {
      r = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
      u = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
      p += normalize(cameraPosition - p) * aGlow.w * 0.3;
    }
    float pulse = 1.0 + (1.0 - uCalm) * 0.05 * sin(uTime * 1.1 + aInfo.y * 6.28);
    vec3 world = p + (r * position.x + u * position.y) * aGlow.w * 2.0 * pulse;
    vUv = vec2(mix(uRect.x, uRect.z, position.x + 0.5), mix(uRect.y, uRect.w, position.y + 0.5));
    float k = aInfo.x;
    vCol = k < 0.5 ? vec3(1.0, 0.68, 0.3) : k < 1.5 ? vec3(1.0, 0.84, 0.45) : vec3(1.0, 0.93, 0.66);
    vI = uNight * (flatOn > 0.5 ? 0.3 : (k > 1.5 ? 0.8 : k > 0.5 ? 0.55 : 0.4));
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;

const GLOW_FRAG = /* glsl */ `
  uniform sampler2D uMap;
  varying vec2 vUv;
  varying float vI;
  varying vec3 vCol;
  void main() {
    float a = texture2D(uMap, vUv).a * vI;
    if (a < 0.004) discard;
    gl_FragColor = vec4(vCol, a);
  }
`;

const FIREFLY_VERT = /* glsl */ `
  attribute vec4 aHome;  // xyz world (above the ground), phase
  uniform float uNight;
  uniform float uTime;
  uniform float uCalm;
  uniform vec4 uRect;
  varying vec2 vUv;
  varying float vI;
  void main() {
    vec3 n = normalize(aHome.xyz);
    vec3 a = abs(n.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    vec3 e1 = normalize(cross(n, a));
    vec3 e2 = cross(n, e1);
    float ph = aHome.w * 6.2831;
    float t = uTime;
    vec3 p = aHome.xyz
      + e1 * (sin(t * 0.37 + ph) * 0.9 + sin(t * 0.83 + ph * 2.0) * 0.3)
      + e2 * (cos(t * 0.29 + ph * 1.7) * 0.9 + sin(t * 0.71 + ph * 3.0) * 0.3)
      + n * (sin(t * 0.55 + ph * 0.7) * 0.35);
    // Slow glow pulses; with calm motion they just breathe gently.
    float blink = mix(smoothstep(-0.2, 0.9, sin(t * 1.1 + ph * 3.0)), 0.65 + 0.35 * sin(t * 0.35 + ph), uCalm);
    vec3 r = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 u = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    float s = 0.27 * (0.6 + 0.4 * blink);
    vec3 world = p + (r * position.x + u * position.y) * s;
    vUv = vec2(mix(uRect.x, uRect.z, position.x + 0.5), mix(uRect.y, uRect.w, position.y + 0.5));
    vI = uNight * blink;
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;

const FIREFLY_FRAG = /* glsl */ `
  uniform sampler2D uMap;
  varying vec2 vUv;
  varying float vI;
  void main() {
    float a = texture2D(uMap, vUv).a * vI;
    if (a < 0.004) discard;
    gl_FragColor = vec4(vec3(0.72, 1.0, 0.28), a);
  }
`;

const BEAM_VERT = /* glsl */ `
  uniform vec3 uOrigin;
  uniform vec3 uDir;
  uniform float uLength;
  varying vec2 vB;
  void main() {
    vec3 toCam = normalize(cameraPosition - uOrigin);
    vec3 side = normalize(cross(uDir, toCam));
    float along = position.y + 0.5;          // 0 at the lamp … 1 at the end
    float width = mix(0.25, 2.6, along);
    vec3 world = uOrigin + uDir * along * uLength + side * position.x * width;
    vB = vec2(position.x * 2.0, along);
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;

const BEAM_FRAG = /* glsl */ `
  uniform float uNight;
  varying vec2 vB;
  void main() {
    float a = (1.0 - smoothstep(0.2, 1.0, abs(vB.x))) * (1.0 - smoothstep(0.35, 1.0, vB.y)) * smoothstep(0.0, 0.05, vB.y);
    gl_FragColor = vec4(vec3(1.0, 0.93, 0.68), a * 0.32 * uNight);
  }
`;

function quadGeo() {
  const base = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute("position", base.getAttribute("position"));
  return geo;
}

const _p = new THREE.Vector3();

export function NightLights({ runtime, mode, lightGraphics = environment.lightGraphics }: { runtime: WorldRuntime; mode: "paper" | "gallery"; lightGraphics?: boolean }) {
  const assets = getAssets();
  const glowRect = useMemo(() => new THREE.Vector4(...particleCellUv(PARTICLE_CELLS.glow)), []);
  const sparkRect = useMemo(() => new THREE.Vector4(...particleCellUv(PARTICLE_CELLS.spark)), []);

  // ---- glows + ground pools
  const glows = useMemo(() => {
    const table = mode === "paper" ? PAPER_GLOWS : GALLERY_GLOWS;
    const data: number[] = [];
    const info: number[] = [];
    let beacon: { origin: THREE.Vector3; n: THREE.Vector3 } | null = null;
    runtime.layout.items.forEach((it, i) => {
      if (it.flat) return;
      const spots = table[it.art as SceneryArtId];
      const pool = POOLS[it.art as SceneryArtId];
      if (!spots && !pool) return;
      const h = runtime.terrain.heightAt(it.n);
      const ground = it.onWater ? Math.max(h, WATER_LEVEL) : h;
      for (const [hf, sf, kind] of spots ?? []) {
        _p.copy(it.n).multiplyScalar(ground + it.size * hf);
        data.push(_p.x, _p.y, _p.z, it.size * sf);
        info.push(kind, (i * 0.618) % 1, 0, 0);
        if (kind === 2 && !beacon) beacon = { origin: _p.clone(), n: it.n.clone() };
      }
      if (pool) {
        _p.copy(it.n).multiplyScalar(ground);
        data.push(_p.x, _p.y, _p.z, it.size * pool);
        info.push(1, (i * 0.37) % 1, 1, 0);
      }
    });
    const count = data.length / 4;
    const geo = quadGeo();
    geo.setAttribute("aGlow", new THREE.InstancedBufferAttribute(new Float32Array(data), 4));
    geo.setAttribute("aInfo", new THREE.InstancedBufferAttribute(new Float32Array(info), 4));
    geo.instanceCount = count;
    const material = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: assets.particles }, uNight: { value: 0 }, uTime: { value: 0 }, uCalm: { value: 0 }, uRect: { value: glowRect } },
      vertexShader: GLOW_VERT,
      fragmentShader: GLOW_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(geo, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 6;
    mesh.name = "night-glows";
    return { mesh, material, beacon: beacon as { origin: THREE.Vector3; n: THREE.Vector3 } | null };
  }, [runtime, mode, assets, glowRect]);

  // ---- lighthouse beam
  const beam = useMemo(() => {
    if (!glows.beacon) return null;
    const material = new THREE.ShaderMaterial({
      uniforms: { uOrigin: { value: glows.beacon.origin.clone() }, uDir: { value: new THREE.Vector3() }, uLength: { value: 13 }, uNight: { value: 0 } },
      vertexShader: BEAM_VERT,
      fragmentShader: BEAM_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 1, 8), material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 6;
    const n = glows.beacon.n;
    const e1 = new THREE.Vector3().crossVectors(n, Math.abs(n.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize();
    const e2 = new THREE.Vector3().crossVectors(n, e1);
    return { mesh, material, n, e1, e2, angle: 0 };
  }, [glows]);

  // ---- fireflies
  const fireflies = useMemo(() => {
    const count = lightGraphics ? 0 : 150;
    if (count === 0) return null;
    const rng = mulberry32(runtime.seed ^ 0x51f1);
    const homes: Array<[THREE.Vector3, number, number]> = [
      [WATER_BODIES[0].center, WATER_BODIES[0].radius * 1.25, 40], // lily pond
      [WATER_BODIES[1].center, WATER_BODIES[1].radius * 1.25, 34], // duck pond
      [REGION_BY_ID.meadow.center, 0.3, 46],
      [REGION_BY_ID.garden.center, 0.25, 30],
    ];
    const total = homes.reduce((s, h) => s + h[2], 0);
    const data = new Float32Array(count * 4);
    let k = 0;
    for (const [c, r, share] of homes) {
      const m = Math.round((share / total) * count);
      for (let j = 0; j < m && k < count; j++, k++) {
        randomInCap(c, r, rng, _p);
        const h = Math.max(runtime.terrain.heightAt(_p), WATER_LEVEL);
        _p.multiplyScalar(h + 0.35 + rng() * 1.3);
        data.set([_p.x, _p.y, _p.z, rng()], k * 4);
      }
    }
    const geo = quadGeo();
    geo.setAttribute("aHome", new THREE.InstancedBufferAttribute(data, 4));
    geo.instanceCount = k;
    const material = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: assets.particles }, uNight: { value: 0 }, uTime: { value: 0 }, uCalm: { value: 0 }, uRect: { value: sparkRect } },
      vertexShader: FIREFLY_VERT,
      fragmentShader: FIREFLY_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(geo, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 6;
    mesh.name = "fireflies";
    return { mesh, material };
  }, [runtime, assets, lightGraphics, sparkRect]);

  useEffect(
    () => () => {
      glows.mesh.geometry.dispose();
      glows.material.dispose();
      beam?.mesh.geometry.dispose();
      fireflies?.mesh.geometry.dispose();
    },
    [glows, beam, fireflies],
  );

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const e = environment;
    const night = THREE.MathUtils.smoothstep(1 - e.daylight, 0.3, 0.8);
    const calm = e.reducedMotion ? 1 : 0;
    glows.material.uniforms.uNight.value = night;
    glows.material.uniforms.uTime.value += dt;
    glows.material.uniforms.uCalm.value = calm;
    glows.mesh.visible = night > 0.01;
    if (beam) {
      beam.angle += dt * (calm ? 0.2 : 0.55);
      beam.material.uniforms.uDir.value.copy(beam.e1).multiplyScalar(Math.cos(beam.angle)).addScaledVector(beam.e2, Math.sin(beam.angle)).addScaledVector(beam.n, 0.08).normalize();
      beam.material.uniforms.uNight.value = night;
      beam.mesh.visible = night > 0.01;
    }
    if (fireflies) {
      // Fewer fireflies when it rains.
      const n = night * (1 - e.rain * 0.8) * (1 - e.snow);
      fireflies.material.uniforms.uNight.value = n;
      fireflies.material.uniforms.uTime.value += dt * (calm ? 0.5 : 1);
      fireflies.material.uniforms.uCalm.value = calm;
      fireflies.mesh.visible = n > 0.01;
    }
  });

  return (
    <group name="night-lights">
      <primitive object={glows.mesh} />
      {beam && <primitive object={beam.mesh} />}
      {fireflies && <primitive object={fireflies.mesh} />}
    </group>
  );
}
