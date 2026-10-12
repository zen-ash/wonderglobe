"use client";
// Weather particles around the view: blue crayon rain strokes, paper snow
// flakes (always a little around Snowcap Mountain, everywhere in winter),
// cherry petals in spring, blowing leaves in autumn, and short local showers
// under tapped clouds (`rainBurst`). Each field is one instanced draw call
// animated entirely on the GPU; particles live in a world-fixed lattice so
// they don't slide along when the camera moves.

import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { environment } from "@/world/environment";
import { REGION_BY_ID, type RegionKind } from "@/world/planet";
import { PLANET_RADIUS } from "@/world/sphere";
import { PARTICLE_CELLS, particleCellUv } from "@/art/weatherArt";
import { getAssets } from "./assets";
import { ENV_PARS, envUniforms, atmosphere } from "./atmosphere/envUniforms";
import { MAX_SHOWERS, showers, showerStrength, startShower, pruneShowers, nowSeconds } from "./atmosphere/showers";
import { camera as camCtl } from "./cameraControl";

/**
 * A short local shower under `point` (e.g. a tapped cloud) for ~5 seconds.
 * Drops fall from the point's height to the ground; rings appear if it's
 * over water; the cloud nearest the point darkens while it rains.
 */
export function rainBurst(point: THREE.Vector3, seconds = 5): void {
  startShower(point, seconds);
}

// ------------------------------------------------------------- field shader

interface FieldOpts {
  count: number;
  cells: number[];
  /** Quad width, height (world). */
  size: [number, number];
  /** Fall speed (world units / s). */
  speed: number;
  radius: number;
  height: number;
  /** Side-to-side drift amplitude. */
  sway: number;
  /** Spin / flip speed (paper bits tumble; rain doesn't). */
  tumble: number;
  /** Streaks align with the fall direction instead of facing the camera. */
  streak: boolean;
  /** Alpha-blended (rain) instead of alpha-tested paper. */
  blend: boolean;
  /** Multiplier for wind drift. */
  wind: number;
}

const FIELD_VERT = /* glsl */ `
  attribute vec4 aSeed;   // lattice xyz (0..1), phase
  attribute vec4 aRect;   // atlas rect
  attribute float aPick;  // 0..1 threshold vs amount
  uniform vec3 uCenter;
  uniform float uGround;
  uniform float uTime;
  uniform float uAmount;
  uniform float uRadius;
  uniform float uHeight;
  uniform float uSpeed;
  uniform vec2 uSize;
  uniform float uSway;
  uniform float uTumble;
  uniform float uStreak;
  uniform float uWindK;
  uniform vec4 uEnvWind;
  uniform vec4 uHaze;
  varying vec2 vUv;
  varying float vAlpha;
  void main() {
    if (aPick >= uAmount) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    // World-fixed lattice wrapped into a cube around the centre.
    float span = uRadius * 2.0;
    vec3 rel = mod(aSeed.xyz * span - uCenter, span) - uRadius;
    vec3 pw = uCenter + rel;
    vec3 n = normalize(pw);
    vec3 cn = normalize(uCenter);
    float horiz = length(n * length(uCenter) - uCenter) / uRadius;
    float t = uTime;
    float fall = fract(aSeed.w - t * uSpeed / uHeight);   // 1 = top, 0 = ground
    float alt = fall * uHeight;
    vec3 wd = cross(uEnvWind.xyz, n);
    wd = length(wd) > 1e-4 ? normalize(wd) : vec3(1.0, 0.0, 0.0);
    vec3 side = normalize(cross(n, wd));
    float ph = aSeed.w * 37.0;
    vec3 p = n * (uGround + 0.05 + alt);
    p += wd * (uEnvWind.w * uWindK * (1.0 - fall) * 2.5 + sin(t * 0.9 + ph) * uSway);
    p += side * cos(t * 0.7 + ph * 1.3) * uSway;
    vec3 toCam = normalize(cameraPosition - p);
    vec3 axisUp;
    vec3 axisRight;
    if (uStreak > 0.5) {
      axisUp = normalize(n + wd * uEnvWind.w * uWindK * 0.35);
      axisRight = normalize(cross(axisUp, toCam));
    } else {
      vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
      vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
      float a = t * uTumble * (0.6 + fract(ph)) + ph;
      axisRight = camRight * cos(a) + camUp * sin(a);
      axisUp = -camRight * sin(a) + camUp * cos(a);
      axisRight *= mix(1.0, cos(t * uTumble * 1.7 + ph), step(0.01, uTumble));
    }
    vec3 world = p + axisRight * position.x * uSize.x + axisUp * position.y * uSize.y;
    vUv = vec2(mix(aRect.x, aRect.z, position.x + 0.5), mix(aRect.y, aRect.w, position.y + 0.5));
    float edge = 1.0 - smoothstep(0.7, 1.0, horiz);
    float ends = smoothstep(0.0, 0.06, fall) * (1.0 - smoothstep(0.85, 1.0, fall));
    // Thin out right in front of the lens.
    float near = smoothstep(2.5, 6.0, length(cameraPosition - p));
    vAlpha = edge * ends * near;
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;

const FIELD_FRAG = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uBlend;
  ${ENV_PARS}
  varying vec2 vUv;
  varying float vAlpha;
  void main() {
    vec4 c = texture2D(uMap, vUv);
    if (uBlend > 0.5) {
      float a = c.a * vAlpha * 0.7;
      if (a < 0.02) discard;
      gl_FragColor = vec4(envApply(c.rgb), a);
    } else {
      if (c.a < 0.5 || vAlpha < 0.5) discard;
      gl_FragColor = vec4(envApply(c.rgb), 1.0);
    }
  }
`;

function createField(atlas: THREE.Texture, o: FieldOpts, seed: number) {
  const base = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute("position", base.getAttribute("position"));
  const seeds = new Float32Array(o.count * 4);
  const rects = new Float32Array(o.count * 4);
  const picks = new Float32Array(o.count);
  let a = seed >>> 0;
  const rnd = () => {
    a = (a * 1664525 + 1013904223) >>> 0;
    return a / 4294967296;
  };
  for (let i = 0; i < o.count; i++) {
    seeds.set([rnd(), rnd(), rnd(), rnd()], i * 4);
    rects.set(particleCellUv(o.cells[Math.floor(rnd() * o.cells.length)]), i * 4);
    picks[i] = (i + rnd()) / o.count;
  }
  geo.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 4));
  geo.setAttribute("aRect", new THREE.InstancedBufferAttribute(rects, 4));
  geo.setAttribute("aPick", new THREE.InstancedBufferAttribute(picks, 1));
  geo.instanceCount = o.count;
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: atlas },
      uCenter: { value: new THREE.Vector3(0, PLANET_RADIUS, 0) },
      uGround: { value: PLANET_RADIUS },
      uTime: { value: 0 },
      uAmount: { value: 0 },
      uRadius: { value: o.radius },
      uHeight: { value: o.height },
      uSpeed: { value: o.speed },
      uSize: { value: new THREE.Vector2(o.size[0], o.size[1]) },
      uSway: { value: o.sway },
      uTumble: { value: o.tumble },
      uStreak: { value: o.streak ? 1 : 0 },
      uWindK: { value: o.wind },
      uBlend: { value: o.blend ? 1 : 0 },
      ...envUniforms,
    },
    vertexShader: FIELD_VERT,
    fragmentShader: FIELD_FRAG,
    transparent: o.blend,
    depthWrite: !o.blend,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = o.blend ? 5 : 0;
  return { mesh, material };
}

// ------------------------------------------------------------- the weather

const _center = new THREE.Vector3();
const _fwd = new THREE.Vector3();

function nearRegion(dir: THREE.Vector3, id: RegionKind, inner: number, outer: number): number {
  const a = Math.acos(THREE.MathUtils.clamp(dir.dot(REGION_BY_ID[id].center), -1, 1));
  return 1 - THREE.MathUtils.smoothstep(a, inner, outer);
}

export function Weather({ lightGraphics = false, reducedMotion = false }: { lightGraphics?: boolean; reducedMotion?: boolean }) {
  const assets = getAssets();
  const fields = useMemo(() => {
    const k = lightGraphics ? 0.35 : 1;
    const rain = createField(
      assets.particles,
      { count: Math.round(1000 * k), cells: [PARTICLE_CELLS.rain], size: [0.11, 0.36], speed: 12, radius: 13, height: 11, sway: 0, tumble: 0, streak: true, blend: true, wind: 1 },
      11,
    );
    const snow = createField(
      assets.particles,
      { count: Math.round(900 * k), cells: [PARTICLE_CELLS.snow], size: [0.17, 0.17], speed: 1.2, radius: 12, height: 10, sway: 0.45, tumble: 0.6, streak: false, blend: false, wind: 1.5 },
      22,
    );
    const petals = createField(
      assets.particles,
      { count: Math.round(320 * k), cells: [PARTICLE_CELLS.petal], size: [0.2, 0.2], speed: 0.8, radius: 11, height: 7, sway: 0.7, tumble: 1.4, streak: false, blend: false, wind: 2.2 },
      33,
    );
    const leaves = createField(
      assets.particles,
      {
        count: Math.round(260 * k),
        cells: [PARTICLE_CELLS.leafOrange, PARTICLE_CELLS.leafRed, PARTICLE_CELLS.leafYellow],
        size: [0.24, 0.24],
        speed: 1.0,
        radius: 12,
        height: 7,
        sway: 0.8,
        tumble: 1.2,
        streak: false,
        blend: false,
        wind: 2.6,
      },
      44,
    );
    return { rain, snow, petals, leaves };
  }, [assets, lightGraphics]);

  // One burst field per shower slot (cheap: they share geometry size).
  const showerFields = useMemo(() => {
    const per = lightGraphics ? 70 : 160;
    return Array.from({ length: MAX_SHOWERS }, (_, i) =>
      createField(
        assets.particles,
        { count: per, cells: [PARTICLE_CELLS.rain], size: [0.11, 0.36], speed: 10, radius: 1.6, height: 8, sway: 0, tumble: 0, streak: true, blend: true, wind: 0.2 },
        100 + i,
      ),
    );
  }, [assets, lightGraphics]);

  useEffect(
    () => () => {
      for (const f of [fields.rain, fields.snow, fields.petals, fields.leaves, ...showerFields]) {
        f.mesh.geometry.dispose();
        f.material.dispose();
      }
    },
    [fields, showerFields],
  );

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const e = environment;
    const cam = state.camera;
    const calm = reducedMotion ? 0.55 : 1;
    // Centre the fields on what the camera looks at (≈ the player).
    _fwd.setFromMatrixColumn(cam.matrixWorld, 2).negate();
    _center.copy(cam.position).addScaledVector(_fwd, Math.min(camCtl.distance, 14));
    const dir = _center.clone().normalize();
    const ground = PLANET_RADIUS + 0.25;
    _center.copy(dir).multiplyScalar(ground);
    const show = 1 - THREE.MathUtils.smoothstep(atmosphere.planetView, 0.4, 0.9);

    const mountain = nearRegion(dir, "mountain", 0.3, 0.6);
    const winter = e.season === "winter" ? 1 : 0;
    const cherry = Math.max(nearRegion(dir, "cherry", 0.25, 0.5), nearRegion(dir, "garden", 0.2, 0.45) * 0.6);
    const forest = nearRegion(dir, "forest", 0.25, 0.55);
    const amounts = {
      rain: e.rain * show,
      snow: Math.max(e.snow, mountain * 0.4, winter * 0.18) * show,
      petals: (e.season === "spring" ? 0.08 + cherry * 0.92 : 0) * show,
      leaves: (e.season === "autumn" ? (0.2 + forest * 0.5) * (0.5 + e.wind) : 0) * show,
    };
    const list: Array<[keyof typeof amounts, ReturnType<typeof createField>]> = [
      ["rain", fields.rain],
      ["snow", fields.snow],
      ["petals", fields.petals],
      ["leaves", fields.leaves],
    ];
    for (const [key, f] of list) {
      const u = f.material.uniforms;
      u.uTime.value += dt * calm;
      u.uCenter.value.copy(_center);
      u.uGround.value = ground;
      u.uAmount.value = amounts[key];
      f.mesh.visible = amounts[key] > 0.001;
    }
    // Mountain snow starts higher up the slopes.
    fields.snow.material.uniforms.uGround.value = ground + mountain * 1.5;
    fields.snow.material.uniforms.uHeight.value = 10 + mountain * 3;

    // Local showers under tapped clouds.
    const now = nowSeconds();
    pruneShowers(now);
    showerFields.forEach((f, i) => {
      const s = showers[i];
      const k = s ? showerStrength(s, now) : 0;
      f.mesh.visible = k > 0.001;
      if (!s || !f.mesh.visible) return;
      const u = f.material.uniforms;
      u.uTime.value += dt * calm;
      u.uCenter.value.copy(s.dir).multiplyScalar(PLANET_RADIUS + 0.25);
      u.uGround.value = PLANET_RADIUS + 0.1;
      u.uHeight.value = Math.max(4, s.top - PLANET_RADIUS - 1.5);
      u.uAmount.value = k;
    });
  });

  return (
    <group name="weather">
      <primitive object={fields.rain.mesh} />
      <primitive object={fields.snow.mesh} />
      <primitive object={fields.petals.mesh} />
      <primitive object={fields.leaves.mesh} />
      {showerFields.map((f, i) => (
        <primitive key={i} object={f.mesh} />
      ))}
    </group>
  );
}
