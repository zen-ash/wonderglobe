// Shared atmosphere uniforms: one set of values, updated once per frame from
// `environment`, used by every material in the scene.
//
//  * `envUniforms` is merged (by reference) into the ShaderMaterials in
//    materials.ts, the sky and the weather/particle shaders. GLSL: ENV_PARS.
//  * Built-in three.js mesh materials (Basic/Lambert/Toon/Phong/Standard…)
//    are patched once, globally, so anything drawn with them (creations, the
//    player, easels, cardboard bases…) gets the same day/night tint and
//    distance haze. Opt a material out with `material.defines = { WG_NO_ENV: "" }`.
//
// Colours: our ShaderMaterials write their colour straight to the screen
// (sRGB values in, sRGB out), while built-in materials work in linear space,
// so both a "display" tint and a linear tint are kept.

import * as THREE from "three";
import { environment, skyPalette, type SkyPalette } from "@/world/environment";
import { PLANET_RADIUS } from "@/world/sphere";

// ------------------------------------------------------------------ uniforms

export const envUniforms = {
  /** Multiplier for lit colours (display space). */
  uEnvTint: { value: new THREE.Color(1, 1, 1) },
  /** x daylight, y dusk, z night (1-daylight), w seconds (motion clock). */
  uEnvDay: { value: new THREE.Vector4(1, 0, 0, 0) },
  /** x rain/wetness, y snow cover, z autumn (0..1), w spring (0..1). */
  uEnvWeather: { value: new THREE.Vector4(0, 0, 0, 0) },
  /** xyz wind axis (wind blows along circles around it), w gust strength 0..1. */
  uEnvWind: { value: new THREE.Vector4(0, 1, 0, 0.2) },
  /** Main light direction: sun by day, moon by night (world). */
  uLightDir: { value: new THREE.Vector3(0.45, 0.75, 0.5).normalize() },
  /** Distance haze colour (display space). */
  uHazeColor: { value: new THREE.Color("#d9eedd") },
  /** x start, y end (view depth), z max amount, w motion scale (1, or calmer). */
  uHaze: { value: new THREE.Vector4(30, 80, 0.3, 1) },
};

export type EnvUniforms = typeof envUniforms;

/** GLSL declarations + helpers for ShaderMaterials that merge `envUniforms`. */
export const ENV_PARS = /* glsl */ `
  uniform vec3 uEnvTint;
  uniform vec4 uEnvDay;
  uniform vec4 uEnvWeather;
  uniform vec4 uEnvWind;
  uniform vec3 uLightDir;
  uniform vec3 uHazeColor;
  uniform vec4 uHaze;
  float envHazeAmount() {
    float d = 1.0 / gl_FragCoord.w;
    return smoothstep(uHaze.x, uHaze.y, d) * uHaze.z;
  }
  vec3 envApply(vec3 col) {
    col *= uEnvTint;
    return mix(col, uHazeColor, envHazeAmount());
  }
  float envHash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float envNoise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(envHash(i + vec3(0, 0, 0)), envHash(i + vec3(1, 0, 0)), f.x),
                   mix(envHash(i + vec3(0, 1, 0)), envHash(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(envHash(i + vec3(0, 0, 1)), envHash(i + vec3(1, 0, 1)), f.x),
                   mix(envHash(i + vec3(0, 1, 1)), envHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  /** Unit tangent the wind blows along at a surface point. */
  vec3 envWindDir(vec3 up) {
    vec3 w = cross(uEnvWind.xyz, up);
    float l = length(w);
    return l > 1e-4 ? w / l : vec3(1.0, 0.0, 0.0);
  }
`;

// ------------------------------------------------------ built-in material patch

/** Plain {x,y,z(,w)} objects are shared by reference through three's uniform cloning. */
const builtinEnv = {
  wgTintLin: { value: { x: 1, y: 1, z: 1 } },
  wgHazeLin: { value: { x: 0.7, y: 0.85, z: 0.7 } },
  wgHazeRange: { value: { x: 30, y: 80, z: 0.3, w: 0 } },
};

const BUILTIN_PARS = /* glsl */ `
#ifndef WG_NO_ENV
uniform vec3 wgTintLin;
uniform vec3 wgHazeLin;
uniform vec4 wgHazeRange;
vec3 wgEnvApply(vec3 c) {
  c *= wgTintLin;
  float d = 1.0 / gl_FragCoord.w;
  return mix(c, wgHazeLin, smoothstep(wgHazeRange.x, wgHazeRange.y, d) * wgHazeRange.z);
}
#endif
`;

const PATCH_MARK = "/*wg-env*/";

function patchBuiltins() {
  const libs = ["basic", "lambert", "phong", "standard", "physical", "toon", "matcap"] as const;
  for (const name of libs) {
    const lib = THREE.ShaderLib[name];
    if (!lib || lib.fragmentShader.includes(PATCH_MARK)) continue;
    lib.fragmentShader = lib.fragmentShader
      .replace("#include <common>", `#include <common>\n${PATCH_MARK}\n${BUILTIN_PARS}`)
      .replace("#include <opaque_fragment>", "#ifndef WG_NO_ENV\noutgoingLight = wgEnvApply(outgoingLight);\n#endif\n#include <opaque_fragment>");
    Object.assign(lib.uniforms, builtinEnv);
  }
}
patchBuiltins();

// ------------------------------------------------------- per-frame atmosphere

/** Camera-relative sky frame and light directions, updated every frame. */
export const atmosphere = {
  /** Local up at the camera (planet normal under it). */
  up: new THREE.Vector3(0, 1, 0),
  /** Parallel-transported compass, so the sun stays put as you turn around. */
  east: new THREE.Vector3(1, 0, 0),
  north: new THREE.Vector3(0, 0, 1),
  /** Sky gradient frame: "up" for the gradient plus visible elevation range (radians). */
  skyUp: new THREE.Vector3(0, 1, 0),
  /** Horizontal compass around skyUp (equals east/north while exploring). */
  skyEast: new THREE.Vector3(1, 0, 0),
  skyNorth: new THREE.Vector3(0, 0, 1),
  skyLo: -0.6,
  skyHi: 0.3,
  /** 0 explore … 1 planet view. */
  planetView: 0,
  camDist: 30,
  /** Where sun/moon appear (unit directions from the camera), and their altitude 0..1. */
  sunVisual: new THREE.Vector3(),
  moonVisual: new THREE.Vector3(),
  sunAltitude: 0,
  moonAltitude: 0,
  /** Where the camera looks on the planet (ray hit, or the point under the camera). */
  focus: new THREE.Vector3(0, 20, 0),
  /** Real light directions (world), measured from the ground at `focus`. */
  sunDir: new THREE.Vector3(),
  moonDir: new THREE.Vector3(),
  palette: skyPalette(environment) as SkyPalette,
  /** False until the compass has been turned so the sun (or moon) starts in view. */
  oriented: false,
  orientDelay: 0,
};

/** Call when a world loads: the next frame turns the compass so the sun/moon starts in view. */
export function resetAtmosphereFrame() {
  atmosphere.oriented = false;
  atmosphere.orientDelay = 6;
}

const _fwd = new THREE.Vector3();
const _camUp = new THREE.Vector3();
const _h = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _c = new THREE.Color();
const _q = new THREE.Quaternion();

/** Direction in the sky frame from a horizontal azimuth (radians from east toward north) and a 0..1 band height. */
export function skyDirection(azimuth: number, band: number, out: THREE.Vector3): THREE.Vector3 {
  const a = atmosphere;
  const elev = a.skyLo + (a.skyHi - a.skyLo) * band;
  _h.copy(a.skyEast).multiplyScalar(Math.cos(azimuth)).addScaledVector(a.skyNorth, Math.sin(azimuth));
  return out.copy(_h).multiplyScalar(Math.cos(elev)).addScaledVector(a.skyUp, Math.sin(elev)).normalize();
}

function lightFrom(azimuth: number, altitude: number, out: THREE.Vector3) {
  const a = atmosphere;
  // Never let the light graze the ground: keep it between ~18° and ~70° up
  // (low enough for long, warm shadows at dusk).
  const alt = THREE.MathUtils.clamp(Math.asin(THREE.MathUtils.clamp(altitude, -1, 1)), 0.32, 1.2);
  out.copy(a.east).multiplyScalar(Math.cos(azimuth)).addScaledVector(a.north, Math.sin(azimuth));
  out.multiplyScalar(Math.cos(alt)).addScaledVector(a.up, Math.sin(alt)).normalize();
  return out;
}

/**
 * Recompute the sky frame and every shared uniform. Call once per frame
 * after `stepEnvironment` (SkyAndLights does this).
 */
export function updateAtmosphere(cam: THREE.Camera, opts: { focusDistance: number; lightGraphics: boolean; reducedMotion: boolean; dt: number }) {
  const e = environment;
  const a = atmosphere;
  cam.updateMatrixWorld();
  const camPos = cam.position;
  a.camDist = camPos.length();
  a.up.copy(camPos).normalize();
  // Parallel transport the compass.
  a.east.addScaledVector(a.up, -a.east.dot(a.up));
  if (a.east.lengthSq() < 1e-4) a.east.set(1, 0, 0).addScaledVector(a.up, -a.up.x);
  a.east.normalize();
  a.north.crossVectors(a.up, a.east).normalize();

  // Visible sky band.
  _fwd.setFromMatrixColumn(cam.matrixWorld, 2).negate().normalize();
  _camUp.setFromMatrixColumn(cam.matrixWorld, 1).normalize();
  const fov = (cam as THREE.PerspectiveCamera).fov ?? 50;
  const halfV = THREE.MathUtils.degToRad(fov) / 2;
  const pv = THREE.MathUtils.smoothstep(a.camDist, 30, 46);
  a.planetView = pv;
  const dip = Math.acos(Math.min(1, (PLANET_RADIUS + 0.4) / Math.max(a.camDist, PLANET_RADIUS + 0.41)));
  const pitch = Math.asin(THREE.MathUtils.clamp(_fwd.dot(a.up), -1, 1));
  const exploreLo = -dip + 0.02;
  const exploreHi = Math.max(exploreLo + 0.35, pitch + halfV * 1.05);
  a.skyUp.copy(a.up).lerp(_camUp, pv).normalize();
  a.skyLo = THREE.MathUtils.lerp(exploreLo, -halfV * 1.15, pv);
  // Horizontal compass around skyUp. In planet view it turns to include the view direction.
  a.skyEast.copy(a.east).addScaledVector(a.skyUp, -a.east.dot(a.skyUp));
  if (a.skyEast.lengthSq() < 1e-4) a.skyEast.copy(a.north).addScaledVector(a.skyUp, -a.north.dot(a.skyUp));
  a.skyEast.normalize();
  a.skyNorth.crossVectors(a.skyUp, a.skyEast).normalize();
  a.skyHi = THREE.MathUtils.lerp(exploreHi, halfV * 1.15, pv);

  // Sun and moon: azimuth swings east → west through the day.
  const phase = (e.time - 0.25) * Math.PI * 2; // 0 sunrise, π/2 noon, π sunset
  const sunAz = -0.35 + Math.PI * 0.5 - Math.cos(phase) * 1.2; // gentle swing in front of the default view
  if (!a.oriented && a.orientDelay-- <= 0) {
    // Turn the compass so whichever of sun/moon is up starts a little off-centre in view.
    _h.copy(_fwd).addScaledVector(a.up, -_fwd.dot(a.up));
    if (_h.lengthSq() > 1e-6) {
      _h.normalize();
      const target = (e.daylight > 0.3 ? sunAz : sunAz + 0.9) + 0.3;
      _tmp.crossVectors(a.up, _h);
      a.east.copy(_h).multiplyScalar(Math.cos(target)).addScaledVector(_tmp, -Math.sin(target)).normalize();
      a.north.crossVectors(a.up, a.east).normalize();
      a.oriented = true;
    }
  }
  const sunAlt = Math.sin(phase); // -1..1
  a.sunAltitude = sunAlt;
  skyDirection(sunAz, 0.1 + 0.62 * sunAlt, a.sunVisual);
  const moonPhase = phase + Math.PI;
  const moonAlt = Math.sin(moonPhase);
  a.moonAltitude = moonAlt;
  skyDirection(sunAz + 0.9, 0.12 + 0.6 * moonAlt, a.moonVisual);
  lightFrom(sunAz, sunAlt, a.sunDir);
  lightFrom(sunAz + 0.9, moonAlt, a.moonDir);
  // The light's altitude is meant for the ground being looked at (the player),
  // not for the spot under the camera: carry it over to the focus point so
  // shadows there are short at noon and long at dusk.
  {
    const o = camPos;
    const b = o.dot(_fwd);
    const c = o.lengthSq() - PLANET_RADIUS * PLANET_RADIUS;
    const disc = b * b - c;
    const t = disc > 0 ? -b - Math.sqrt(disc) : -1;
    if (t > 0) a.focus.copy(o).addScaledVector(_fwd, t);
    else a.focus.copy(o).setLength(PLANET_RADIUS);
    _tmp.copy(a.focus).normalize();
    _q.setFromUnitVectors(a.up, _tmp);
    a.sunDir.applyQuaternion(_q);
    a.moonDir.applyQuaternion(_q);
  }
  const toMoon = 1 - THREE.MathUtils.smoothstep(e.daylight, 0.15, 0.45);
  envUniforms.uLightDir.value.copy(a.sunDir).lerp(a.moonDir, toMoon).normalize();

  // Palette and tint.
  const p = skyPalette(e);
  a.palette = p;
  envUniforms.uEnvTint.value.setRGB(p.tint[0], p.tint[1], p.tint[2]);
  _c.setRGB(p.tint[0], p.tint[1], p.tint[2], THREE.SRGBColorSpace);
  // Linear-space version for built-ins: the same perceived multiplier.
  builtinEnv.wgTintLin.value.x = Math.pow(p.tint[0], 2.2);
  builtinEnv.wgTintLin.value.y = Math.pow(p.tint[1], 2.2);
  builtinEnv.wgTintLin.value.z = Math.pow(p.tint[2], 2.2);

  // Haze toward a blend of horizon and zenith (the colour the eye sees behind things).
  const hz: [number, number, number] = [
    p.horizon[0] * 0.7 + p.zenith[0] * 0.3,
    p.horizon[1] * 0.7 + p.zenith[1] * 0.3,
    p.horizon[2] * 0.7 + p.zenith[2] * 0.3,
  ];
  envUniforms.uHazeColor.value.setRGB(hz[0], hz[1], hz[2]);
  _c.setRGB(hz[0], hz[1], hz[2], THREE.SRGBColorSpace);
  builtinEnv.wgHazeLin.value.x = _c.r;
  builtinEnv.wgHazeLin.value.y = _c.g;
  builtinEnv.wgHazeLin.value.z = _c.b;
  const focus = opts.focusDistance;
  const start = focus + THREE.MathUtils.lerp(5, 6, pv);
  const end = start + THREE.MathUtils.lerp(38, 30, pv);
  const amount = opts.lightGraphics ? 0 : THREE.MathUtils.lerp(0.42, 0.22, pv) * (0.75 + 0.25 * e.daylight) + e.rain * 0.12;
  envUniforms.uHaze.value.set(start, end, amount, opts.reducedMotion ? 0.4 : 1);
  builtinEnv.wgHazeRange.value.x = start;
  builtinEnv.wgHazeRange.value.y = end;
  builtinEnv.wgHazeRange.value.z = amount;

  // Day + motion clock.
  const motion = opts.reducedMotion ? 0.4 : 1;
  const d = envUniforms.uEnvDay.value;
  d.set(e.daylight, e.dusk, 1 - e.daylight, d.w + opts.dt * motion);

  // Weather / season.
  const autumn = e.season === "autumn" ? 1 : 0;
  const spring = e.season === "spring" ? 1 : 0;
  const w = envUniforms.uEnvWeather.value;
  w.x += (e.rain - w.x) * Math.min(1, opts.dt * 0.5);
  w.set(w.x, e.snowCover, w.z + (autumn - w.z) * Math.min(1, opts.dt), w.w + (spring - w.w) * Math.min(1, opts.dt));

  // Wind: blows along circles around a slowly drifting axis.
  _tmp.set(Math.cos(e.windAngle), 0.35, Math.sin(e.windAngle)).normalize();
  envUniforms.uEnvWind.value.set(_tmp.x, _tmp.y, _tmp.z, e.wind);
}

/** Initialise autumn/spring/snow uniforms instantly (no fade) — call on mount. */
export function snapSeasonUniforms() {
  const e = environment;
  const w = envUniforms.uEnvWeather.value;
  w.set(e.rain, e.snowCover, e.season === "autumn" ? 1 : 0, e.season === "spring" ? 1 : 0);
}
