"use client";
// The sky and its lights: a papery gradient dome that blends from teal day
// through golden-pink dusk to a deep navy-paper night, the friendly sun, a
// sleepy cut-out moon, paper stars, drifting clouds (pink at dusk, blue-grey
// at night and in the rain), a big crayon rainbow after rain, the scene
// lights and a soft vignette. It also drives the environment clock and the
// shared atmosphere uniforms every frame, and hosts the weather particles.

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { getAssets } from "./assets";
import { PLANET_RADIUS } from "@/world/sphere";
import { mulberry32 } from "@/world/noise";
import { environment, initEnvironment, setEnvironmentFlags, stepEnvironment, setWeather, setSeason, setFixedTime, setTimeMode, type TimeMode } from "@/world/environment";
import { rainBurst } from "./Weather";
import { addRipple } from "./ripples";
import { atmosphere, envUniforms, skyDirection, updateAtmosphere, snapSeasonUniforms, resetAtmosphereFrame, ENV_PARS } from "./atmosphere/envUniforms";
import { showers, showerStrength, nowSeconds } from "./atmosphere/showers";
import { camera as camCtl } from "./cameraControl";
import { Weather } from "./Weather";
import { PARTICLE_CELLS, particleCellUv } from "@/art/weatherArt";

export interface SkyProps {
  /** Fewer particles, no haze extras. Defaults to the saved preference. */
  lightGraphics?: boolean;
  /** Calmer weather, no twinkle/flicker. Defaults to the preference / OS setting. */
  reducedMotion?: boolean;
  /** How time passes ("cycle" by default). A `?timeMode=` URL param wins. */
  timeMode?: TimeMode;
}

function prefersReducedMotion(): boolean {
  try {
    return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export function SkyAndLights({ lightGraphics, reducedMotion, timeMode }: SkyProps = {}) {
  const light = lightGraphics ?? environment.lightGraphics;
  const calm = reducedMotion ?? (environment.reducedMotion || prefersReducedMotion());
  const scene = useThree((s) => s.scene);
  const getThree = useThree((s) => s.get);

  // Initialise the environment once per world load.
  useMemo(() => {
    initEnvironment({
      search: typeof window !== "undefined" ? window.location.search : "",
      timeMode: timeMode ?? environment.timeMode,
      lightGraphics: light,
      reducedMotion: calm,
    });
    snapSeasonUniforms();
    resetAtmosphereFrame();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => setEnvironmentFlags({ lightGraphics: light, reducedMotion: calm }), [light, calm]);
  useEffect(() => {
    // Development handle for trying times and weathers from the console.
    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { __wgEnv: unknown }).__wgEnv = { environment, setWeather, setSeason, setFixedTime, setTimeMode, rainBurst, addRipple, atmosphere, cloudObjects, cloudAt, three: getThree, cameraControl: camCtl };
    }
  }, [getThree]);

  useMemo(() => {
    scene.background = new THREE.Color("#9fd8d2");
  }, [scene]);

  return (
    <>
      <EnvironmentDriver light={light} calm={calm} />
      <SkyDome />
      <Lights light={light} />
      <Sun />
      <Moon calm={calm} />
      <Stars light={light} calm={calm} />
      <Clouds />
      <Rainbow />
      <Weather lightGraphics={light} reducedMotion={calm} />
      <Vignette />
    </>
  );
}

// ------------------------------------------------------------- the clock

function EnvironmentDriver({ light, calm }: { light: boolean; calm: boolean }) {
  const bg = useThree((s) => s.scene);
  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    stepEnvironment(dt);
    const camDist = state.camera.position.length();
    const pv = THREE.MathUtils.smoothstep(camDist, 30, 46);
    const focus = THREE.MathUtils.lerp(camCtl.distance, camDist - PLANET_RADIUS, pv);
    updateAtmosphere(state.camera, { focusDistance: focus, lightGraphics: light, reducedMotion: calm, dt });
    zoomSky(state.camera.position.length());
    if (bg.background instanceof THREE.Color) bg.background.setRGB(zoomed.horizon[0], zoomed.horizon[1], zoomed.horizon[2], THREE.SRGBColorSpace);
  }, -0.9);
  return null;
}

// ------------------------------------------------- sky deepens with zoom

/** "Space-ier" sky colours for the planet view: a deeper teal by day, deep navy by night (sRGB). */
const SPACE_DAY: [number, number, number] = [0.17, 0.53, 0.63];
const SPACE_NIGHT: [number, number, number] = [0.05, 0.08, 0.2];
/** Sky colours after the zoom shift (updated once per frame). */
const zoomed = { zenith: [0, 0, 0] as [number, number, number], horizon: [0, 0, 0] as [number, number, number] };

function zoomSky(camDist: number) {
  const p = atmosphere.palette;
  // 0 while exploring … 1 far out in the planet view (subtle, eased).
  const k = THREE.MathUtils.smoothstep(camDist, 32, 80);
  const day = environment.daylight;
  const deep = [0, 1, 2].map((i) => SPACE_NIGHT[i] + (SPACE_DAY[i] - SPACE_NIGHT[i]) * day);
  // Saturate a touch: push away from grey.
  for (let i = 0; i < 3; i++) {
    zoomed.zenith[i] = p.zenith[i] + (deep[i] - p.zenith[i]) * k * 0.45;
    zoomed.horizon[i] = p.horizon[i] + (deep[i] - p.horizon[i]) * k * 0.22;
  }
  for (const c of [zoomed.zenith, zoomed.horizon]) {
    const g = (c[0] + c[1] + c[2]) / 3;
    for (let i = 0; i < 3; i++) c[i] = Math.min(1, Math.max(0, g + (c[i] - g) * (1 + k * 0.18)));
  }
}

/** Current sky colour as a THREE.Color (sRGB-correct) — handy for UI/3D tinting. */
export function skyColor(out = new THREE.Color()): THREE.Color {
  const p = atmosphere.palette;
  return out.setRGB((p.horizon[0] + p.zenith[0]) / 2, (p.horizon[1] + p.zenith[1]) / 2, (p.horizon[2] + p.zenith[2]) / 2, THREE.SRGBColorSpace);
}

// ----------------------------------------------------------------- dome

function SkyDome() {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uZenith: { value: new THREE.Vector3() },
          uHorizon: { value: new THREE.Vector3() },
          uGlow: { value: new THREE.Vector3() },
          uGlowAmt: { value: 0 },
          uSkyUp: { value: new THREE.Vector3(0, 1, 0) },
          uRange: { value: new THREE.Vector2(-0.6, 0.3) },
          uSunVis: { value: new THREE.Vector3() },
          uMoonVis: { value: new THREE.Vector3() },
          uNight: { value: 0 },
          uOvercast: { value: 0 },
          uGrain: { value: getAssets().grain },
        },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = position;
            gl_Position = projectionMatrix * viewMatrix * vec4(position + cameraPosition, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uZenith;
          uniform vec3 uHorizon;
          uniform vec3 uGlow;
          uniform float uGlowAmt;
          uniform vec3 uSkyUp;
          uniform vec2 uRange;
          uniform vec3 uSunVis;
          uniform vec3 uMoonVis;
          uniform float uNight;
          uniform float uOvercast;
          uniform sampler2D uGrain;
          varying vec3 vDir;
          void main() {
            vec3 dir = normalize(vDir);
            float el = asin(clamp(dot(dir, uSkyUp), -1.0, 1.0));
            float s = clamp((el - uRange.x) / (uRange.y - uRange.x), 0.0, 1.0);
            // Soft paper bands: a gently stepped gradient.
            float sb = mix(s, floor(s * 6.0 + 0.5) / 6.0, 0.3);
            vec3 col = mix(uHorizon, uZenith, pow(sb, 0.85));
            // A pale band right on the horizon (like a paper horizon strip).
            col = mix(col, uHorizon * 1.06, (1.0 - smoothstep(0.0, 0.12, s)) * 0.5);
            // Dusk glow around the sun, hugging the horizon.
            float sd = max(dot(dir, uSunVis), 0.0);
            float glow = (pow(sd, 5.0) * 0.75 + pow(sd, 1.6) * 0.35) * (1.0 - s * 0.6) * uGlowAmt;
            col = mix(col, uGlow, clamp(glow, 0.0, 0.8));
            // Warm halo around the sun by day, cool halo around the moon at night.
            col += vec3(1.0, 0.95, 0.78) * pow(sd, 24.0) * 0.28 * (1.0 - uNight) * (1.0 - uOvercast);
            float md = max(dot(dir, uMoonVis), 0.0);
            col += vec3(0.55, 0.62, 0.86) * pow(md, 30.0) * 0.3 * uNight;
            // Paper grain and fibres (screen space so it reads like paper).
            float g = texture2D(uGrain, gl_FragCoord.xy / 320.0).r;
            float g2 = texture2D(uGrain, gl_FragCoord.yx / 97.0).r;
            col *= 0.93 + 0.09 * g + 0.04 * (g2 - 0.9);
            gl_FragColor = vec4(col, 1.0);
          }
        `,
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: false,
      }),
    [],
  );
  const geometry = useMemo(() => new THREE.SphereGeometry(280, 48, 24), []);
  useFrame(() => {
    const u = material.uniforms;
    const p = atmosphere.palette;
    u.uZenith.value.set(...zoomed.zenith);
    u.uHorizon.value.set(...zoomed.horizon);
    u.uGlow.value.set(...p.glow);
    u.uGlowAmt.value = p.glowAmount * (1 - environment.clouds * 0.5);
    u.uSkyUp.value.copy(atmosphere.skyUp);
    u.uRange.value.set(atmosphere.skyLo, atmosphere.skyHi);
    u.uSunVis.value.copy(atmosphere.sunVisual);
    u.uMoonVis.value.copy(atmosphere.moonVisual);
    u.uNight.value = 1 - environment.daylight;
    u.uOvercast.value = environment.clouds;
  });
  return <mesh geometry={geometry} material={material} renderOrder={-1000} frustumCulled={false} name="sky" />;
}

// --------------------------------------------------------------- lights

const DAY_SUN = new THREE.Color("#fff3dc");
const DUSK_SUN = new THREE.Color("#ffc29a");
const MOON = new THREE.Color("#e4e8ff");
const HEMI_SKY_DAY = new THREE.Color("#fff6e4");
const HEMI_SKY_NIGHT = new THREE.Color("#eceeff");
const HEMI_GROUND_DAY = new THREE.Color("#8fc7b8");
const HEMI_GROUND_NIGHT = new THREE.Color("#98a2c4");

const _focus = new THREE.Vector3();
const _lx = new THREE.Vector3();
const _ly = new THREE.Vector3();
const _up0 = new THREE.Vector3(0, 1, 0);

/**
 * Scene lights. The directional light is the sun by day and the moon by
 * night (envUniforms.uLightDir) and casts real shadows: its shadow camera
 * follows the point the camera looks at (about 40 units across while
 * exploring, the whole visible hemisphere in the planet view), snapped to
 * shadow-map texels so shadows don't crawl. Shadows are strong and warm by
 * day, long at dusk, faint by moonlight and soft under clouds.
 */
function Lights({ light }: { light: boolean }) {
  const hemi = useRef<THREE.HemisphereLight>(null);
  const dir = useRef<THREE.DirectionalLight>(null);
  const scene = useThree((s) => s.scene);
  const small = useThree((s) => Math.min(s.size.width, s.size.height) < 700);
  const mapSize = small ? 1024 : 2048;
  const half = useRef(0);
  useEffect(() => {
    const d = dir.current;
    if (!d) return;
    d.castShadow = !light;
    const sh = d.shadow;
    sh.mapSize.set(mapSize, mapSize);
    if (sh.map) {
      sh.map.dispose();
      sh.map = null;
    }
    sh.bias = -0.0006;
    sh.normalBias = 0.03;
    sh.radius = 3;
    sh.camera.near = 1;
    sh.camera.far = 140;
    sh.camera.updateProjectionMatrix();
    scene.add(d.target);
    return () => {
      scene.remove(d.target);
    };
  }, [light, mapSize, scene]);
  useFrame((state) => {
    const e = environment;
    const night = 1 - e.daylight;
    const d = dir.current;
    if (d) {
      const L = envUniforms.uLightDir.value;
      d.color.copy(DAY_SUN).lerp(DUSK_SUN, e.dusk * 0.7).lerp(MOON, night);
      d.intensity = THREE.MathUtils.lerp(1.6, 1.15, night) * (1 - e.clouds * 0.25);
      if (!d.castShadow) {
        d.position.copy(L).multiplyScalar(100);
      } else {
        // Follow what the camera looks at; cover the whole disc in the planet view.
        const pv = atmosphere.planetView;
        _focus.copy(atmosphere.focus);
        _focus.lerp(_lx.copy(state.camera.position).setLength(PLANET_RADIUS * 0.55), pv);
        const want = THREE.MathUtils.lerp(THREE.MathUtils.clamp(camCtl.distance * 1.1 + 7, 13, 24), PLANET_RADIUS + 5, pv);
        const sh = d.shadow;
        const cam = sh.camera as THREE.OrthographicCamera;
        if (Math.abs(want - half.current) > 0.25) {
          half.current = want;
          cam.left = cam.bottom = -want;
          cam.right = cam.top = want;
          cam.updateProjectionMatrix();
        }
        // Snap the focus to whole shadow-map texels in light space.
        const texel = (2 * half.current) / sh.mapSize.x;
        _lx.crossVectors(_up0, L);
        if (_lx.lengthSq() < 1e-6) _lx.set(1, 0, 0);
        _lx.normalize();
        _ly.crossVectors(L, _lx).normalize();
        const fx = _focus.dot(_lx), fy = _focus.dot(_ly);
        _focus.addScaledVector(_lx, Math.round(fx / texel) * texel - fx).addScaledVector(_ly, Math.round(fy / texel) * texel - fy);
        d.target.position.copy(_focus);
        d.target.updateMatrixWorld();
        d.position.copy(_focus).addScaledVector(L, 60);
        // Strength: crisp by day, faint by moonlight, softer under clouds and rain.
        const sun = 0.8 * THREE.MathUtils.smoothstep(e.daylight, 0.3, 0.7) * (1 - e.clouds * 0.5) * (1 - e.rain * 0.35);
        const moon = 0.3 * (1 - THREE.MathUtils.smoothstep(e.daylight, 0.12, 0.4)) * (1 - e.clouds * 0.7);
        sh.intensity = Math.max(sun, moon);
      }
    }
    if (hemi.current) {
      hemi.current.color.copy(HEMI_SKY_DAY).lerp(HEMI_SKY_NIGHT, night);
      hemi.current.groundColor.copy(HEMI_GROUND_DAY).lerp(HEMI_GROUND_NIGHT, night);
      hemi.current.intensity = 1.15 + e.clouds * 0.15;
    }
  });
  return (
    <>
      <hemisphereLight ref={hemi} args={["#fff6e4", "#8fc7b8", 1.15]} />
      <directionalLight ref={dir} intensity={1.6} color="#fff3dc" />
    </>
  );
}

// ----------------------------------------------------------- sun & moon

const SKY_DIST = 200;

function glowMaterial(color: string) {
  const assets = getAssets();
  const m = new THREE.SpriteMaterial({ map: assets.particles, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const [u0, v0, u1, v1] = particleCellUv(PARTICLE_CELLS.glow);
  m.map = assets.particles.clone();
  m.map.offset.set(u0, v0);
  m.map.repeat.set(u1 - u0, v1 - v0);
  m.map.needsUpdate = true;
  return m;
}

function Sun() {
  const ref = useRef<THREE.Sprite>(null);
  const halo = useRef<THREE.Sprite>(null);
  const material = useMemo(() => new THREE.SpriteMaterial({ map: getAssets().sun, depthWrite: false, fog: false, transparent: true }), []);
  const haloMat = useMemo(() => glowMaterial("#ffd9a0"), []);
  useFrame((state) => {
    const s = ref.current;
    if (!s) return;
    const e = environment;
    s.position.copy(state.camera.position).addScaledVector(atmosphere.sunVisual, SKY_DIST);
    const t = state.clock.elapsedTime;
    const wob = 1 + (e.reducedMotion ? 0 : Math.sin(t * 0.8) * 0.02);
    // Bigger and warmer near the horizon.
    const low = 1 - THREE.MathUtils.smoothstep(atmosphere.sunAltitude, 0.05, 0.45);
    const size = 27 * wob * (1 + low * 0.2);
    s.scale.set(size, size, 1);
    material.rotation = e.reducedMotion ? 0 : Math.sin(t * 0.3) * 0.06;
    material.opacity = THREE.MathUtils.smoothstep(atmosphere.sunAltitude, -0.12, 0.05) * (1 - Math.max(e.clouds - 0.2, 0) * 0.9) * (1 - e.rain * 0.6);
    material.color.setRGB(1, 1 - low * 0.12, 1 - low * 0.3);
    s.visible = material.opacity > 0.01;
    if (halo.current) {
      halo.current.position.copy(s.position);
      halo.current.scale.setScalar(size * (2.2 + low));
      haloMat.opacity = material.opacity * (0.35 + low * 0.35);
      halo.current.visible = s.visible;
    }
  });
  return (
    <>
      <sprite ref={halo} material={haloMat} renderOrder={-2} />
      <sprite ref={ref} material={material} renderOrder={-1} />
    </>
  );
}

function Moon({ calm }: { calm: boolean }) {
  const ref = useRef<THREE.Sprite>(null);
  const halo = useRef<THREE.Sprite>(null);
  const material = useMemo(() => new THREE.SpriteMaterial({ map: getAssets().moon, depthWrite: false, fog: false, transparent: true }), []);
  const haloMat = useMemo(() => glowMaterial("#9fb2ff"), []);
  useFrame((state) => {
    const s = ref.current;
    if (!s) return;
    const e = environment;
    s.position.copy(state.camera.position).addScaledVector(atmosphere.moonVisual, SKY_DIST);
    const size = 26;
    s.scale.set(size, size, 1);
    const t = state.clock.elapsedTime;
    material.rotation = -0.25 + (calm ? 0 : Math.sin(t * 0.25) * 0.05);
    material.opacity = (1 - THREE.MathUtils.smoothstep(e.daylight, 0.35, 0.75)) * THREE.MathUtils.smoothstep(atmosphere.moonAltitude, -0.1, 0.08) * (1 - e.clouds * 0.5);
    s.visible = material.opacity > 0.01;
    if (halo.current) {
      halo.current.position.copy(s.position);
      halo.current.scale.setScalar(size * 2.6);
      haloMat.opacity = material.opacity * 0.45;
      halo.current.visible = s.visible;
    }
  });
  return (
    <>
      <sprite ref={halo} material={haloMat} renderOrder={-2} />
      <sprite ref={ref} material={material} renderOrder={-1} />
    </>
  );
}

// ----------------------------------------------------------------- stars

const STAR_VERT = /* glsl */ `
  attribute vec4 aStar;   // azimuth, band 0..1, size, phase
  uniform vec3 uEast;
  uniform vec3 uNorth;
  uniform vec3 uSkyUp;
  uniform vec2 uRange;
  uniform float uTime;
  uniform float uOpacity;
  uniform float uTwinkle;
  uniform vec4 uRect;
  varying vec2 vUv;
  varying float vAlpha;
  void main() {
    float el = uRange.x + (uRange.y - uRange.x) * aStar.y;
    vec3 h = uEast * cos(aStar.x) + uNorth * sin(aStar.x);
    vec3 dir = normalize(h * cos(el) + uSkyUp * sin(el));
    vec3 c = cameraPosition + dir * 240.0;
    vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    float tw = 1.0 + uTwinkle * 0.25 * sin(uTime * (0.8 + fract(aStar.w * 7.0)) + aStar.w * 40.0);
    float s = aStar.z * tw;
    vec3 world = c + (camRight * position.x + camUp * position.y) * s;
    vUv = vec2(mix(uRect.x, uRect.z, position.x + 0.5), mix(uRect.y, uRect.w, position.y + 0.5));
    vAlpha = uOpacity * smoothstep(0.08, 0.3, aStar.y);
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;

function makeStarMesh(count: number, seed: number, sizes: [number, number], tex: THREE.Texture, rect: [number, number, number, number], additive: boolean) {
  const base = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute("position", base.getAttribute("position"));
  const rng = mulberry32(seed);
  const data = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    data[i * 4] = rng() * Math.PI * 2;
    data[i * 4 + 1] = 0.12 + Math.sqrt(rng()) * 0.9;
    data[i * 4 + 2] = sizes[0] + rng() * (sizes[1] - sizes[0]);
    data[i * 4 + 3] = rng();
  }
  geo.setAttribute("aStar", new THREE.InstancedBufferAttribute(data, 4));
  geo.instanceCount = count;
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: tex },
      uEast: { value: new THREE.Vector3() },
      uNorth: { value: new THREE.Vector3() },
      uSkyUp: { value: new THREE.Vector3() },
      uRange: { value: new THREE.Vector2() },
      uTime: { value: 0 },
      uOpacity: { value: 0 },
      uTwinkle: { value: 1 },
      uRect: { value: new THREE.Vector4(...rect) },
    },
    vertexShader: STAR_VERT,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      varying vec2 vUv;
      varying float vAlpha;
      void main() {
        vec4 c = texture2D(uMap, vUv);
        ${additive ? "gl_FragColor = vec4(c.rgb * vec3(1.0, 0.95, 0.8) * c.a * vAlpha, 1.0);" : "if (c.a < 0.5) discard; gl_FragColor = vec4(c.rgb, vAlpha);"}
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -3;
  return { mesh, material };
}

function Stars({ light, calm }: { light: boolean; calm: boolean }) {
  const assets = getAssets();
  const meshes = useMemo(() => {
    const dots = makeStarMesh(light ? 120 : 260, 99, [1.2, 3.2], assets.particles, particleCellUv(PARTICLE_CELLS.spark), true);
    const paper = makeStarMesh(light ? 10 : 18, 7, [5, 8.5], assets.paperStar, [0, 0, 1, 1], false);
    return [dots, paper];
  }, [assets, light]);
  useEffect(() => () => meshes.forEach((m) => m.mesh.geometry.dispose()), [meshes]);
  useFrame((_, dt) => {
    const e = environment;
    const vis = (1 - THREE.MathUtils.smoothstep(e.daylight, 0.2, 0.6)) * (1 - e.clouds * 0.8);
    for (const m of meshes) {
      const u = m.material.uniforms;
      u.uEast.value.copy(atmosphere.skyEast);
      u.uNorth.value.copy(atmosphere.skyNorth);
      u.uSkyUp.value.copy(atmosphere.skyUp);
      u.uRange.value.set(atmosphere.skyLo, atmosphere.skyHi);
      u.uTime.value += Math.min(dt, 0.05);
      u.uTwinkle.value = calm ? 0 : 1;
      u.uOpacity.value = vis;
      m.mesh.visible = vis > 0.01;
    }
  });
  return (
    <>
      {meshes.map((m, i) => (
        <primitive key={i} object={m.mesh} />
      ))}
    </>
  );
}

// ---------------------------------------------------------------- clouds

interface CloudState {
  axis: THREE.Vector3;
  start: THREE.Vector3;
  speed: number;
  altitude: number;
  scale: number;
  /** Only shows when the sky is overcast. */
  extra: boolean;
  sprite: THREE.Sprite | null;
  dark: number;
}

const BASE_CLOUDS = 14;
const EXTRA_CLOUDS = 12;
const cloudRegistry: CloudState[] = [];

/** Cloud sprites (for raycasting taps). Only clouds that are actually showing. */
export function cloudObjects(): THREE.Object3D[] {
  return cloudRegistry.filter((c) => c.sprite && c.sprite.visible && (c.sprite.material as THREE.SpriteMaterial).opacity > 0.3).map((c) => c.sprite!);
}

/** If `object` is one of the clouds, its index and current world position. */
export function cloudAt(object: THREE.Object3D | null | undefined): { index: number; position: THREE.Vector3 } | null {
  if (!object) return null;
  const index = cloudRegistry.findIndex((c) => c.sprite === object);
  if (index < 0) return null;
  return { index, position: cloudRegistry[index].sprite!.position.clone() };
}

const CLOUD_DAY = new THREE.Color(1, 1, 1);
const CLOUD_DUSK = new THREE.Color().setRGB(1, 0.8, 0.84, THREE.SRGBColorSpace);
const CLOUD_NIGHT = new THREE.Color().setRGB(0.55, 0.6, 0.8, THREE.SRGBColorSpace);
const CLOUD_RAIN = new THREE.Color().setRGB(0.72, 0.76, 0.82, THREE.SRGBColorSpace);
const _cc = new THREE.Color();

function Clouds() {
  const assets = getAssets();
  const clouds = useMemo<CloudState[]>(() => {
    const rng = mulberry32(42);
    const list = Array.from({ length: BASE_CLOUDS + EXTRA_CLOUDS }, (_, i) => {
      const start = new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize();
      const axis = new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).cross(start).normalize();
      const extra = i >= BASE_CLOUDS;
      return {
        axis,
        start,
        speed: 0.008 + rng() * 0.012,
        altitude: PLANET_RADIUS + 10 + rng() * 6,
        scale: (extra ? 4.5 : 4) + rng() * 3,
        extra,
        sprite: null,
        dark: 0,
      } as CloudState;
    });
    return list;
  }, []);
  useEffect(() => {
    cloudRegistry.length = 0;
    cloudRegistry.push(...clouds);
    return () => {
      cloudRegistry.length = 0;
    };
  }, [clouds]);
  // One material per cloud so each can fade and tint on its own.
  const materials = useMemo(
    () => clouds.map((_, i) => new THREE.SpriteMaterial({ map: assets.clouds[i % assets.clouds.length], transparent: true, depthWrite: false, opacity: 0, alphaTest: 0.1 })),
    [assets, clouds],
  );
  const q = useMemo(() => new THREE.Quaternion(), []);
  const camDir = useMemo(() => new THREE.Vector3(), []);
  const cloudDir = useMemo(() => new THREE.Vector3(), []);
  const time = useRef(0);
  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const e = environment;
    // Clouds hurry along when it's windy (calmer with reduced motion).
    time.current += dt * (0.6 + e.wind * 1.6) * (e.reducedMotion ? 0.6 : 1);
    const t = time.current;
    const camLen = state.camera.position.length();
    camDir.copy(state.camera.position).normalize();
    const now = nowSeconds();
    // Base tint: white day, pink dusk, blue-grey night, grey rain.
    const night = 1 - e.daylight;
    _cc.copy(CLOUD_DAY).lerp(CLOUD_DUSK, e.dusk * (1 - night * 0.5)).lerp(CLOUD_NIGHT, night).lerp(CLOUD_RAIN, Math.max(e.rain, (e.clouds - 0.5) * 0.8) * (1 - night * 0.5));
    for (const c of clouds) {
      if (!c.sprite) continue;
      q.setFromAxisAngle(c.axis, t * c.speed);
      c.sprite.position.copy(c.start).applyQuaternion(q).multiplyScalar(c.altitude);
      // Fade clouds near the camera, and clouds covering the planet when we look from space.
      const d = c.sprite.position.distanceTo(state.camera.position);
      let want = THREE.MathUtils.smoothstep(d, 6, 16) * 0.95;
      if (c.extra) want *= THREE.MathUtils.smoothstep(e.clouds, 0.3, 0.7);
      cloudDir.copy(c.sprite.position).normalize();
      if (camLen > c.altitude + 4 && cloudDir.dot(camDir) > 0.6) want = 0;
      const m = c.sprite.material as THREE.SpriteMaterial;
      m.opacity += (want - m.opacity) * Math.min(1, dt * 4);
      c.sprite.visible = m.opacity > 0.01;
      // Darken under a local shower.
      let dark = 0;
      for (const s of showers) {
        const k = showerStrength(s, now);
        if (k > 0 && cloudDir.dot(s.dir) > 0.995) dark = Math.max(dark, k);
      }
      c.dark += (dark - c.dark) * Math.min(1, dt * 3);
      m.color.copy(_cc).lerp(CLOUD_RAIN, c.dark * 0.8).multiplyScalar(1 - c.dark * 0.15);
      const grow = 1 + (c.extra ? 0.2 : 0) + c.dark * 0.12;
      c.sprite.scale.set(c.scale * 1.6 * grow, c.scale * grow, 1);
    }
  });

  return (
    <group name="clouds">
      {clouds.map((c, i) => (
        <sprite
          key={i}
          ref={(s) => {
            c.sprite = s;
            if (s) s.userData.cloudIndex = i;
          }}
          material={materials[i]}
          scale={[c.scale * 1.6, c.scale, 1]}
        />
      ))}
    </group>
  );
}

// --------------------------------------------------------------- rainbow

function rainbowGeometry(): THREE.BufferGeometry {
  const seg = 64;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const inner = 0.8;
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI;
    const c = Math.cos(a), s = Math.sin(a);
    pos.push(c, s, 0, c * inner, s * inner, 0);
    uv.push(i / seg * 3, 1, i / seg * 3, 0);
    if (i < seg) {
      const k = i * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

const _rdir = new THREE.Vector3();
const _rup = new THREE.Vector3();
const _rright = new THREE.Vector3();
const _rfwd = new THREE.Vector3();
const _rm = new THREE.Matrix4();

function Rainbow() {
  const assets = getAssets();
  const geometry = useMemo(() => rainbowGeometry(), []);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uMap: { value: assets.rainbow }, uOpacity: { value: 0 }, uReveal: { value: 0 }, ...envUniforms },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          varying float vArc;
          void main() {
            vUv = uv;
            vArc = uv.x / 3.0;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform sampler2D uMap;
          uniform float uOpacity;
          uniform float uReveal;
          ${ENV_PARS}
          varying vec2 vUv;
          varying float vArc;
          void main() {
            // Drawn in from the left like a crayon stroke.
            if (vArc > uReveal) discard;
            vec4 c = texture2D(uMap, vUv);
            float ends = smoothstep(0.0, 0.08, vArc) * smoothstep(1.0, 0.92, vArc);
            vec3 col = c.rgb * mix(vec3(1.0), uEnvTint, 0.6);
            gl_FragColor = vec4(col, uOpacity * mix(0.7, 1.0, ends));
          }
        `,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    [assets],
  );
  const mesh = useMemo(() => {
    const m = new THREE.Mesh(geometry, material);
    m.matrixAutoUpdate = false;
    m.frustumCulled = false;
    m.renderOrder = -1;
    m.name = "rainbow";
    return m;
  }, [geometry, material]);
  const az = useRef<number | null>(null);
  const reveal = useRef(0);
  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const k = environment.rainbow;
    material.uniforms.uOpacity.value = Math.min(1, k * 1.15) * 0.92;
    mesh.visible = k > 0.01;
    if (!mesh.visible) {
      az.current = null;
      reveal.current = 0;
      return;
    }
    reveal.current = Math.min(1, reveal.current + dt * (environment.reducedMotion ? 1 : 0.35));
    material.uniforms.uReveal.value = reveal.current;
    // Sit just off-centre in front of the view, easing along as you turn.
    _rfwd.setFromMatrixColumn(state.camera.matrixWorld, 2).negate();
    const want = Math.atan2(_rfwd.dot(atmosphere.skyNorth), _rfwd.dot(atmosphere.skyEast)) - 0.12;
    if (az.current === null) az.current = want;
    let d = want - az.current;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    az.current += d * Math.min(1, dt * 0.25);
    const D = 190;
    skyDirection(az.current, -0.04, _rdir);
    _rup.copy(atmosphere.skyUp).addScaledVector(_rdir, -atmosphere.skyUp.dot(_rdir)).normalize();
    _rright.crossVectors(_rdir, _rup).normalize();
    const radius = D * Math.tan((atmosphere.skyHi - atmosphere.skyLo) * 0.55);
    _rm.makeBasis(_rright.multiplyScalar(radius), _rup.multiplyScalar(radius), _rdir.clone().multiplyScalar(-1));
    _rm.setPosition(state.camera.position.clone().addScaledVector(_rdir, D));
    mesh.matrix.copy(_rm);
    mesh.matrixWorld.copy(_rm);
  });
  return <primitive object={mesh} />;
}

// --------------------------------------------------------------- vignette

function Vignette() {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uNight: { value: 0 }, uStrength: { value: 0.2 }, uAspect: { value: 1 } },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = position.xy * 0.5 + 0.5;
            gl_Position = vec4(position.xy, 0.0, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uNight;
          uniform float uStrength;
          uniform float uAspect;
          varying vec2 vUv;
          void main() {
            vec2 d = (vUv - 0.5) * vec2(uAspect, 1.0);
            float v = smoothstep(0.42, 1.05, length(d) / max(1.0, uAspect * 0.85));
            vec3 col = mix(vec3(0.32, 0.22, 0.16), vec3(0.06, 0.08, 0.2), uNight);
            gl_FragColor = vec4(col, v * uStrength);
          }
        `,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      }),
    [],
  );
  const geometry = useMemo(() => new THREE.PlaneGeometry(2, 2), []);
  useFrame((state) => {
    const night = 1 - environment.daylight;
    material.uniforms.uNight.value = night;
    material.uniforms.uStrength.value = 0.26 + night * 0.24;
    material.uniforms.uAspect.value = state.size.width / Math.max(1, state.size.height);
  });
  return <mesh geometry={geometry} material={material} renderOrder={10000} frustumCulled={false} name="vignette" />;
}
