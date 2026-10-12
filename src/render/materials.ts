// Shared materials and shaders: crayon-grain planet, shimmering water,
// camera-facing paper cut-outs (instanced), outlined toon shapes.
//
// Every material here takes part in the day/night cycle through the shared
// `envUniforms` (see ./atmosphere/envUniforms.ts): a display-space tint (cool
// blue at night, warm at dusk), a soft distance haze toward the sky colour,
// the light direction (sun by day, moon by night), wind, seasons and snow.

import * as THREE from "three";
import { envUniforms, ENV_PARS } from "./atmosphere/envUniforms";
import { WATER_LEVEL, REGION_BY_ID } from "@/world/planet";
import { PLANET_RADIUS } from "@/world/sphere";

export { envUniforms } from "./atmosphere/envUniforms";

/** Default sun direction (kept for compatibility; live value: envUniforms.uLightDir). */
export const SUN_DIR = new THREE.Vector3(0.45, 0.75, 0.5).normalize();
export const OUTLINE_COLOR = new THREE.Color("#2b2320");

// ------------------------------------------------------------ cast shadows
//
// The sun (Sky.tsx) casts real shadows. Our own ShaderMaterials receive them
// with these snippets (and `lights: true` + `shadowReceiveUniforms()`):
//   vertex:   SHADOW_VERT_PARS at the top, shadowVert("worldPos", "worldNormal") in main()
//   fragment: SHADOW_FRAG_PARS at the top, `float mask = getShadowMask();` (1 = lit)
// The shadow strength (day, dusk, moonlight, clouds) is set on the light
// (light.shadow.intensity), so the mask already includes it.

/** Uniforms three.js needs on a `lights: true` ShaderMaterial. */
export function shadowReceiveUniforms(): Record<string, THREE.IUniform> {
  return THREE.UniformsUtils.clone(THREE.UniformsLib.lights);
}

export const SHADOW_VERT_PARS = /* glsl */ `
#include <shadowmap_pars_vertex>
`;

/** Vertex code computing the shadow-map coordinates from a world position and world normal (GLSL expressions). */
export function shadowVert(world: string, normal: string): string {
  return /* glsl */ `
#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
  {
    vec3 wgShadowP = ${world};
    vec3 wgShadowN = ${normal};
    #pragma unroll_loop_start
    for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
      vDirectionalShadowCoord[ i ] = directionalShadowMatrix[ i ] * vec4( wgShadowP + wgShadowN * directionalLightShadows[ i ].shadowNormalBias, 1.0 );
    }
    #pragma unroll_loop_end
  }
#endif
`;
}

export const SHADOW_FRAG_PARS = /* glsl */ `
#include <common>
#include <packing>
uniform bool receiveShadow;
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
`;

// -------------------------------------------------------------------- planet

/** Tangent used by the farm furrows (matches Terrain.localCoord around the farm). */
function farmTangent(): THREE.Vector3 {
  const c = REGION_BY_ID.farm.center;
  const t = new THREE.Vector3(0, 1, 0).addScaledVector(c, -c.y);
  if (t.lengthSq() < 1e-6) t.set(1, 0, 0).addScaledVector(c, -c.x);
  return t.normalize();
}

/**
 * Crayon-grain planet. Optional vertex attributes (baked by buildPlanetGeometry):
 *  aPat1 (vec4) – flower speckles, forest moss, village cobbles, farm furrows
 *  aPat2 (vec4) – sand, grass, altitude 0..1, cherry petals
 */
export function createPlanetMaterial(grain: THREE.Texture): THREE.ShaderMaterial {
  grain.wrapS = grain.wrapT = THREE.RepeatWrapping;
  return new THREE.ShaderMaterial({
    uniforms: {
      ...shadowReceiveUniforms(),
      uGrain: { value: grain },
      uSun: envUniforms.uLightDir,
      uFarmT: { value: farmTangent() },
      ...envUniforms,
    },
    // Receives the sun's cast shadows (paper cut-outs, creations).
    lights: true,
    vertexColors: true,
    vertexShader: /* glsl */ `
      ${SHADOW_VERT_PARS}
      attribute vec4 aPat1;
      attribute vec4 aPat2;
      varying vec3 vColor;
      varying vec3 vNormal;
      varying vec3 vWorld;
      varying vec4 vPat1;
      varying vec4 vPat2;
      void main() {
        vColor = color;
        vPat1 = aPat1;
        vPat2 = aPat2;
        vNormal = normalize(mat3(modelMatrix) * normal);
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        ${shadowVert("w.xyz", "vNormal")}
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      ${SHADOW_FRAG_PARS}
      uniform sampler2D uGrain;
      uniform vec3 uFarmT;
      ${ENV_PARS}
      varying vec3 vColor;
      varying vec3 vNormal;
      varying vec3 vWorld;
      varying vec4 vPat1;
      varying vec4 vPat2;
      const float WATER = ${WATER_LEVEL.toFixed(4)};
      const float RADIUS = ${PLANET_RADIUS.toFixed(1)};

      vec3 hash3(vec3 c) {
        return vec3(envHash(c), envHash(c + 17.31), envHash(c + 41.7));
      }
      // Distance to the nearest and second-nearest jittered cell centre.
      vec2 voronoi(vec3 p) {
        vec3 i = floor(p);
        vec3 f = fract(p);
        float d1 = 8.0, d2 = 8.0;
        for (int z = -1; z <= 1; z++)
        for (int y = -1; y <= 1; y++)
        for (int x = -1; x <= 1; x++) {
          vec3 g = vec3(float(x), float(y), float(z));
          vec3 o = 0.15 + 0.7 * hash3(i + g);
          float d = length(g + o - f);
          if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
        }
        return vec2(d1, d2);
      }

      void main() {
        vec3 n = normalize(vNormal);
        vec3 up = normalize(vWorld);
        float r = length(vWorld);
        vec3 w = abs(up);
        w = w / (w.x + w.y + w.z);
        vec3 p = vWorld * 0.18;
        float g = texture2D(uGrain, p.yz).r * w.x + texture2D(uGrain, p.xz).r * w.y + texture2D(uGrain, p.xy).r * w.z;
        vec3 q = vWorld * 0.55 + 3.7;
        float g2 = texture2D(uGrain, q.zy).r * w.x + texture2D(uGrain, q.zx).r * w.y + texture2D(uGrain, q.yx).r * w.z;
        vec3 base = vColor;
        vec3 P = vWorld;
        float t = uEnvDay.w;
        float grass = vPat2.y;

        // ---- hand-painted regional details
        // Forest: mossy darker patches and pine-needle flecks.
        if (vPat1.y > 0.01) {
          float m = envNoise(P * 0.75) * 0.65 + envNoise(P * 2.3) * 0.35;
          float moss = smoothstep(0.5, 0.62, m) * vPat1.y * grass;
          base = mix(base, base * vec3(0.7, 0.84, 0.68), moss * 0.85);
          float fleck = step(0.94, envHash(floor(P * 6.0))) * vPat1.y * grass;
          base = mix(base, vec3(0.35, 0.5, 0.3), fleck * 0.35);
        }
        // Village: cobbles on the paths.
        if (vPat1.z > 0.01) {
          vec2 v = voronoi(P * 2.4);
          float edge = 1.0 - smoothstep(0.04, 0.11, v.y - v.x);
          float shadeV = envHash(floor(P * 2.4 + 0.5));
          vec3 stone = base * (0.92 + 0.14 * shadeV);
          stone = mix(stone, base * vec3(0.72, 0.66, 0.6), edge);
          base = mix(base, stone, vPat1.z);
        }
        // Farm: crayon furrows inside the soil stripes and little sprouts.
        if (vPat1.w > 0.01) {
          float soil = smoothstep(0.08, 0.2, base.r - base.g) * vPat1.w;
          float ph = dot(up, uFarmT) * RADIUS * 2.2;
          float line = smoothstep(0.55, 0.95, sin(ph * 4.0 + envNoise(P * 3.0) * 1.5));
          base = mix(base, base * vec3(0.78, 0.68, 0.6), line * soil * 0.7);
          float sprout = step(0.86, envHash(floor(P * 3.5))) * (1.0 - line) * soil;
          base = mix(base, vec3(0.45, 0.72, 0.32), sprout * 0.8);
        }
        // Beach: sand grain and wet sand by the water.
        if (vPat2.x > 0.01) {
          float sg = envHash(floor(P * 16.0));
          base = mix(base, base * (sg > 0.5 ? 1.06 : 0.9), step(0.8, abs(sg - 0.5) * 2.0) * vPat2.x * 0.8);
          float wet = 1.0 - smoothstep(WATER + 0.02, WATER + 0.16, r);
          base = mix(base, base * vec3(0.8, 0.78, 0.74), wet * vPat2.x);
        }
        // Meadow / garden / picnic / cherry: tiny flower dots.
        float flowers = vPat1.x * (1.0 + 0.6 * uEnvWeather.w) * (1.0 - 0.8 * uEnvWeather.z);
        if (flowers > 0.01) {
          vec3 cell = floor(P * 1.7);
          vec3 f = fract(P * 1.7);
          vec3 h = hash3(cell + 5.0);
          float d = length(f - (0.25 + 0.5 * h));
          float pick = envHash(cell + 9.1);
          float on = step(1.0 - 0.6 * min(flowers, 1.0), pick);
          float dotm = (1.0 - smoothstep(0.1, 0.14, d)) * on * grass;
          vec3 pc = h.z < 0.25 ? vec3(0.99, 0.97, 0.92) : h.z < 0.5 ? vec3(0.98, 0.84, 0.3) : h.z < 0.75 ? vec3(0.97, 0.6, 0.72) : vec3(0.93, 0.38, 0.35);
          pc = mix(pc, vec3(0.98, 0.72, 0.8), vPat2.w * 0.8);
          base = mix(base, pc, dotm);
          base = mix(base, vec3(0.99, 0.96, 0.6), (1.0 - smoothstep(0.0, 0.04, d)) * on * grass);
        }

        // ---- seasons and weather
        // Autumn: grass goes golden.
        base = mix(base, base * vec3(1.14, 0.96, 0.66), uEnvWeather.z * grass * 0.38);
        // Rain: everything a touch darker and richer.
        base *= 1.0 - 0.1 * uEnvWeather.x;
        // Snow cover: patchy on low ground, full on high ground.
        float alt = vPat2.z;
        float sn = envNoise(P * 0.6) * 0.6 + envNoise(P * 2.1) * 0.4;
        float cover = uEnvWeather.y;
        float snow = smoothstep(0.42, 0.56, cover * 0.75 + alt * 0.55 * cover + (sn - 0.5) * 0.5) * max(grass, 0.6) * step(WATER + 0.03, r);
        base = mix(base, vec3(0.95, 0.97, 1.0) * (0.96 + 0.04 * g2), snow);

        // ---- shoreline: a wobbly paper foam band where the water meets the ground
        float wob = 0.03 * sin(t * 1.4 + envNoise(P * 1.5) * 6.28) + 0.015 * sin(t * 2.3 + P.x * 3.0);
        float foamD = abs(r - (WATER + 0.01 + wob));
        float foam = 1.0 - smoothstep(0.02, 0.05, foamD);
        base = mix(base, vec3(0.99, 0.99, 0.96), foam * 0.9);
        float wetEdge = (1.0 - smoothstep(0.0, 0.1, r - WATER - 0.04)) * step(WATER + 0.04, r);
        base *= 1.0 - wetEdge * 0.12;

        // Soft, slightly stepped light like coloured paper under a lamp.
        float dl = dot(n, uLightDir);
        float light = 0.6 + 0.4 * smoothstep(-0.35, 0.6, dl);
        light = mix(light, floor(light * 4.0 + 0.5) / 4.0, 0.25);
        vec3 col = base * light * (0.82 + 0.22 * g);
        // Cast shadows from paper cut-outs: a cool, slightly violet paper shade.
        float shadowMask = getShadowMask();
        col *= mix(vec3(0.48, 0.5, 0.7), vec3(1.0), shadowMask);
        col = envApply(col);
        // Darker crayon rim on the planet's silhouette.
        vec3 view = normalize(cameraPosition - vWorld);
        float rim = 1.0 - max(dot(n, view), 0.0);
        col = mix(col, vec3(0.17, 0.14, 0.13) * (0.6 + 0.4 * uEnvTint), smoothstep(0.86, 0.97, rim) * 0.85);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

// --------------------------------------------------------------------- water

/**
 * Paper water. Optional per-vertex `aDepth` (water depth in world units,
 * negative under land) gives lighter shallows and wave strokes out at sea.
 */
export function createWaterMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uSun: envUniforms.uLightDir, ...envUniforms },
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      attribute float aDepth;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying float vDepth;
      void main() {
        vNormal = normalize(mat3(modelMatrix) * normal);
        vDepth = aDepth;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      ${ENV_PARS}
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying float vDepth;
      void main() {
        vec3 p = vWorld;
        float t = uTime * uHaze.w;
        float depth = clamp(vDepth / 1.1, 0.0, 1.0);
        // Gentle shimmer (the original ripples), softer in the shallows.
        float r1 = sin(p.x * 2.1 + p.z * 1.3 + t * 1.2) + sin(p.y * 1.7 - p.x * 0.9 + t * 0.9);
        float r2 = sin(p.z * 3.3 + p.y * 2.2 - t * 1.6);
        float ripple = smoothstep(1.6, 1.92, r1 + 0.45 * r2);
        vec3 deep = vec3(0.24, 0.58, 0.72);
        vec3 shallow = vec3(0.58, 0.86, 0.84);
        vec3 n = normalize(vNormal);
        float d = dot(n, uLightDir);
        vec3 col = mix(shallow, deep, smoothstep(0.05, 0.8, depth));
        col *= 0.92 + 0.12 * d;
        // Paper wave crests: crayon dashes that fold and unfold out where it's deep.
        float wn = envNoise(p * 0.9);
        float band = sin(dot(p, vec3(0.55, 0.62, 0.48)) * 2.6 + wn * 3.0 - t * 0.7);
        float fold = 0.5 + 0.5 * sin(t * 0.9 + wn * 9.0 + p.y * 0.7);
        float crest = smoothstep(0.86 - 0.08 * fold, 0.97 - 0.06 * fold, band) * step(0.42, envNoise(p * 2.2 + 3.0));
        crest *= smoothstep(0.25, 0.7, depth) * fold;
        col = mix(col, vec3(0.97, 0.99, 0.98), max(ripple * 0.6 * (0.4 + 0.6 * depth), crest * 0.85));
        // Shore foam (shallow edge), wobbling in and out.
        float edge = 1.0 - smoothstep(0.0, 0.14, vDepth + 0.03 * sin(t * 1.3 + wn * 6.28));
        col = mix(col, vec3(0.98, 0.99, 0.97), edge * 0.7);
        // Little sparkles in daylight.
        vec3 cell = floor(p * 1.6);
        float h = envHash(cell);
        float tw = pow(max(0.0, sin(t * 1.7 + h * 40.0)), 10.0);
        vec3 fc = fract(p * 1.6) - 0.5;
        float spark = (1.0 - smoothstep(0.03, 0.09, length(fc))) * step(0.82, h) * tw * uEnvDay.x;
        col = envApply(col);
        col += vec3(1.0, 0.98, 0.9) * spark * 0.9;
        // Moon/sun glints at night stay soft and cool.
        col = mix(col, col + vec3(0.06, 0.08, 0.14), uEnvDay.z * ripple * 0.6);
        float alpha = mix(0.66, 0.86, smoothstep(0.0, 0.6, depth));
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });
}

// ---------------------------------------------------- instanced paper cut-outs

/** Per-instance `aExtra.x` kinds used by the billboard shader. */
export const BILLBOARD_KIND = {
  none: 0,
  /** Sky-blue windows glow warm at night. */
  windows: 1,
  /** Yellow lamp glass glows at night. */
  lamp: 2,
  /** Deciduous foliage: autumn colours, snow on top in winter. */
  tree: 3,
  /** Evergreen: snow on top in winter only. */
  evergreen: 4,
  /** Blossom trees (stay pink), snow on top in winter. */
  blossom: 5,
  /** Small plants: a touch of frost in winter. */
  plant: 6,
  /** Lighthouse: lamp + windows. */
  lighthouse: 7,
} as const;

/**
 * Camera-facing (around the local up axis) paper cut-outs drawn from a
 * texture atlas in a single draw call. Per-instance attributes:
 *  aCenter (vec3)   – base point on the ground (world)
 *  aSize   (vec2)   – width, height in world units
 *  aUv     (vec4)   – atlas rect u0 v0 u1 v1
 *  aParams (vec4)   – sway amount, phase, flip (-1/1), lift (world units)
 *  aExtra  (vec4)   – kind (BILLBOARD_KIND), random 0..1, unused, unused
 * Items between the camera and the player dissolve (screen-door) so the
 * player is never fully hidden. Far away (planet view) the cut-outs tilt to
 * face the camera instead of showing up as slivers.
 */
export function createBillboardMaterial(atlas: THREE.Texture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: atlas },
      uTime: { value: 0 },
      uPlayer: { value: new THREE.Vector3() },
      uFocus: { value: new THREE.Vector3() },
      uFocusOn: { value: 0 },
      uFade: { value: 1 },
      uSun: envUniforms.uLightDir,
      ...envUniforms,
    },
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute vec3 aCenter;
      attribute vec2 aSize;
      attribute vec4 aUv;
      attribute vec4 aParams;
      attribute vec4 aExtra;
      uniform float uTime;
      uniform vec3 uPlayer;
      uniform vec3 uFocus;
      uniform float uFocusOn;
      uniform float uFade;
      uniform vec4 uEnvWind;
      uniform vec3 uLightDir;
      uniform vec4 uHaze;
      varying vec2 vUv;
      varying vec2 vLocal;
      varying vec4 vExtra;
      varying float vShade;
      varying float vFade;
      float obstruct(vec3 target, vec3 mid, vec2 size) {
        vec3 seg = target - cameraPosition;
        float segLen = length(seg);
        vec3 dir = seg / max(segLen, 1e-4);
        float tAlong = dot(mid - cameraPosition, dir);
        float distToSeg = length(cameraPosition + dir * clamp(tAlong, 0.0, segLen) - mid);
        float between = step(0.5, tAlong) * step(tAlong, segLen - 0.6);
        return between * (1.0 - smoothstep(size.x * 0.35, size.x * 0.75 + 0.4, distToSeg));
      }
      void main() {
        vec3 up = normalize(aCenter);
        vec3 toCam = cameraPosition - aCenter;
        vec3 viewDir = normalize(toCam);
        // Planet view: blend from cylindrical to spherical billboarding.
        float far = smoothstep(30.0, 46.0, length(cameraPosition));
        vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        vec3 camUpPerp = camUp - viewDir * dot(camUp, viewDir);
        camUpPerp = length(camUpPerp) > 1e-4 ? normalize(camUpPerp) : up;
        // Rotate "up" toward screen-up (capped, so items on the far limb never flip).
        vec3 bUp = up;
        if (far > 0.0) {
          vec3 axis = cross(up, camUpPerp);
          float al = length(axis);
          axis = al > 1e-3 ? axis / al : normalize(cross(up, viewDir) + vec3(1e-4, 0.0, 0.0));
          float ang = acos(clamp(dot(up, camUpPerp), -1.0, 1.0));
          float a = min(far * 0.85 * ang, 1.25);
          bUp = normalize(up * cos(a) + cross(axis, up) * sin(a));
        }
        vec3 right = cross(bUp, toCam);
        float rl = length(right);
        right = rl > 1e-4 ? right / rl : vec3(1.0, 0.0, 0.0);
        // Breeze + wind: every cut-out bends the same way at once.
        float y = position.y;
        float motion = uHaze.w;
        float gust = uEnvWind.w;
        float sway = sin(uTime * 1.6 * motion + aParams.y) * aParams.x * 0.08 * y * (0.7 + gust);
        float windSide = dot(envWindDirV(up), right);
        float bend = windSide * aParams.x * gust * 0.2 * y * y;
        float flutter = sin(uTime * 4.2 * motion + aParams.y * 3.0) * aParams.x * gust * 0.025 * y;
        vec3 world = aCenter + bUp * aParams.w
          + right * (position.x * aSize.x * aParams.z + (sway + bend + flutter) * aSize.y)
          + bUp * (y * aSize.y);
        // Lift tilted stickers toward the camera so they don't sink into hills.
        world += viewDir * far * aSize.y * (0.2 + 0.35 * y);
        vUv = vec2(mix(aUv.x, aUv.z, position.x + 0.5), mix(aUv.y, aUv.w, y));
        vLocal = vec2(position.x + 0.5, y);
        vExtra = aExtra;
        // Gentle paper shading: a touch darker on the side away from the light.
        vec3 fwd = normalize(cross(right, bUp));
        vShade = 0.86 + 0.14 * clamp(dot(fwd, uLightDir) * 0.5 + 0.5, 0.0, 1.0);
        // Obstruction: fade items close to the camera->player segment (and
        // the camera->focus segment while the camera looks at something).
        vec3 mid = aCenter + up * aSize.y * 0.5;
        float fade = 1.0 - obstruct(uPlayer, mid, aSize) * 0.85;
        if (uFocusOn > 0.5) fade = min(fade, 1.0 - obstruct(uFocus, mid, aSize) * 0.85);
        vFade = fade * uFade;
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
      }
    `.replace(
      "void main() {",
      /* glsl */ `vec3 envWindDirV(vec3 up) {
        vec3 w = cross(uEnvWind.xyz, up);
        float l = length(w);
        return l > 1e-4 ? w / l : vec3(1.0, 0.0, 0.0);
      }
      void main() {`,
    ),
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      ${ENV_PARS}
      varying vec2 vUv;
      varying vec2 vLocal;
      varying vec4 vExtra;
      varying float vShade;
      varying float vFade;
      float bayer4(vec2 p) {
        vec2 q = mod(floor(p), 4.0);
        int i = int(q.x + q.y * 4.0);
        float m[16];
        m[0]=0.0; m[1]=8.0; m[2]=2.0; m[3]=10.0; m[4]=12.0; m[5]=4.0; m[6]=14.0; m[7]=6.0;
        m[8]=3.0; m[9]=11.0; m[10]=1.0; m[11]=9.0; m[12]=15.0; m[13]=7.0; m[14]=13.0; m[15]=5.0;
        for (int k = 0; k < 16; k++) { if (k == i) return m[k] / 16.0; }
        return 0.0;
      }
      void main() {
        vec4 c = texture2D(uMap, vUv);
        if (c.a < 0.5) discard;
        if (vFade < 0.999 && bayer4(gl_FragCoord.xy) > vFade) discard;
        vec3 col = c.rgb;
        float kind = vExtra.x;
        float rnd = vExtra.y;
        float green = smoothstep(0.02, 0.1, col.g - max(col.r, col.b));
        float isTree = step(2.5, kind) * step(kind, 5.5);
        // Autumn foliage on deciduous trees (kind 3): each tree picks a warm
        // crayon colour, dappled with a second one, keeping the drawing's shading.
        if (kind > 2.5 && kind < 3.5 && uEnvWeather.z > 0.0) {
          vec3 a1 = rnd < 0.3 ? vec3(0.98, 0.45, 0.08) : rnd < 0.55 ? vec3(0.9, 0.2, 0.08) : rnd < 0.8 ? vec3(0.98, 0.7, 0.1) : vec3(0.85, 0.32, 0.12);
          vec3 a2 = rnd < 0.5 ? vec3(0.99, 0.78, 0.2) : vec3(0.95, 0.38, 0.1);
          float l = dot(col, vec3(0.3, 0.59, 0.11));
          float dapple = envNoise(vec3(vLocal * 11.0, rnd * 13.0));
          vec3 autumn = mix(a1, a2, smoothstep(0.55, 0.75, dapple) * 0.7) * clamp(0.35 + l * 1.9, 0.45, 1.15);
          col = mix(col, autumn, smoothstep(0.0, 0.06, col.g - max(col.r, col.b)) * uEnvWeather.z);
        }
        // Winter: snow settles on the tops of trees, frost on small plants.
        float cover = uEnvWeather.y;
        if (cover > 0.01) {
          // A crisp, scalloped snow cap (like a torn paper edge) on the canopy.
          float edgeLine = vLocal.y + 0.035 * sin(vLocal.x * 26.0 + rnd * 9.0) + (envNoise(vec3(vLocal * 7.0, rnd * 7.0)) - 0.5) * 0.12;
          float capAt = 0.8 - 0.08 * cover;
          float cap = smoothstep(capAt, capAt + 0.025, edgeLine);
          float shadeBand = 1.0 - smoothstep(0.0, 0.04, edgeLine - capAt);
          float onTree = isTree * cap * max(green, step(4.5, kind) * step(kind, 5.5) * 0.8);
          float frost = step(5.5, kind) * step(kind, 6.5) * green * 0.35;
          vec3 snowCol = mix(vec3(0.95, 0.97, 1.0), vec3(0.74, 0.82, 0.95), shadeBand * 0.75) * (0.9 + 0.35 * dot(col, vec3(0.3, 0.59, 0.11)));
          // Snow on house roofs too (everything above the eaves that isn't ink).
          float lum = dot(col, vec3(0.3, 0.59, 0.11));
          float onRoof = step(0.5, kind) * step(kind, 1.5) * smoothstep(0.75, 0.78, edgeLine) * step(0.12, lum);
          col = mix(col, snowCol, clamp((onTree + onRoof * 0.92) * smoothstep(0.0, 0.3, cover) + frost * cover, 0.0, 1.0));
        }
        vec3 lit = envApply(col * vShade);
        // Night lights: windows and lamps glow warm.
        float night = smoothstep(0.35, 0.8, uEnvDay.z);
        if (night > 0.0 && (kind > 0.5 && kind < 2.5 || kind > 6.5)) {
          float win = step(0.25, col.r) * step(0.6, col.g) * step(0.7, col.b) * step(col.r + 0.28, col.b);
          float lamp = step(0.85, col.r) * step(0.5, col.g) * step(col.b, 0.5) * step(0.55, vLocal.y);
          if (kind < 1.5) lamp = 0.0;
          float glow = max(win, lamp);
          vec3 warm = mix(vec3(1.0, 0.78, 0.38), vec3(1.0, 0.93, 0.62), lamp);
          lit = mix(lit, warm * (0.95 + 0.1 * col.g), glow * night);
        }
        gl_FragColor = vec4(lit, 1.0);
      }
    `,
  });
}

/** Unit quad with its bottom edge at y=0, x in [-0.5, 0.5]. */
export function createStandingQuad(): THREE.PlaneGeometry {
  const g = new THREE.PlaneGeometry(1, 1, 1, 4);
  g.translate(0, 0.5, 0);
  return g;
}

// ------------------------------------------------------------- toon + outline

let toonGradient: THREE.DataTexture | null = null;

export function getToonGradient(): THREE.DataTexture {
  if (toonGradient) return toonGradient;
  const data = new Uint8Array([150, 150, 150, 255, 205, 205, 205, 255, 255, 255, 255, 255]);
  toonGradient = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  toonGradient.minFilter = THREE.NearestFilter;
  toonGradient.magFilter = THREE.NearestFilter;
  toonGradient.needsUpdate = true;
  return toonGradient;
}

const toonCache = new Map<string, THREE.MeshToonMaterial>();

export function toonMaterial(color: string | null, opts: { vertexColors?: boolean; map?: THREE.Texture } = {}): THREE.MeshToonMaterial {
  const key = `${color}|${opts.vertexColors ? 1 : 0}|${opts.map?.uuid ?? ""}`;
  let m = toonCache.get(key);
  if (!m) {
    m = new THREE.MeshToonMaterial({ color: color ?? "#ffffff", gradientMap: getToonGradient(), map: opts.map ?? null });
    toonCache.set(key, m);
  }
  return m;
}

/**
 * Inverted-hull outline: back faces pushed out along the normal in view
 * space so the line keeps a roughly constant thickness. Works for instanced
 * meshes too.
 */
export function createOutlineMaterial(thickness = 0.045): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    uniforms: { uThickness: { value: thickness }, uColor: { value: OUTLINE_COLOR.clone() }, ...occlusionUniforms, ...envUniforms },
    side: THREE.BackSide,
    vertexShader: /* glsl */ `
      uniform float uThickness;
      varying vec3 vOcclWorld;
      void main() {
        #ifdef USE_INSTANCING
          mat4 m = modelMatrix * instanceMatrix;
        #else
          mat4 m = modelMatrix;
        #endif
        vec4 world = m * vec4(position, 1.0);
        vec3 n = normalize(mat3(m) * normal);
        // Grow with distance so the ink line keeps a similar width on screen.
        float dist = clamp(length(cameraPosition - world.xyz), 3.0, 90.0);
        world.xyz += n * uThickness * 0.09 * dist;
        vOcclWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      ${OCCLUSION_GLSL}
      ${ENV_PARS}
      void main() {
        // Ink lines vanish completely inside the see-through area.
        occlusionDither(vOcclWorld, 1.01, 1.6);
        // Far-away ink softens into the haze (miniature depth).
        gl_FragColor = vec4(mix(uColor, uHazeColor, envHazeAmount() * 0.75), 1.0);
      }
    `,
  });
  return m;
}

// ------------------------------------------------- see-through for 3D shapes

/** Shared by every patched material: where the player is. */
export const occlusionUniforms = {
  uOcclPlayer: { value: new THREE.Vector3() },
  uOcclOn: { value: 0 },
};

const OCCLUSION_GLSL = /* glsl */ `
  uniform vec3 uOcclPlayer;
  uniform float uOcclOn;
  varying vec3 vOcclWorld;
  float occlBayer(vec2 p) {
    vec2 q = mod(floor(p), 4.0);
    float a = mod(q.x + q.y * 2.0, 4.0);
    float b = mod(q.x * 3.0 + q.y, 4.0);
    return (a * 4.0 + b) / 16.0;
  }
  void occlusionDither(vec3 world, float strength, float extend) {
    if (uOcclOn < 0.5) return;
    vec3 seg = uOcclPlayer - cameraPosition;
    float len = length(seg);
    vec3 dir = seg / max(len, 1e-4);
    float t = dot(world - cameraPosition, dir);
    if (t < 0.3 || t > len - 1.0 + extend) return;
    float d = length(cameraPosition + dir * t - world);
    float k = 1.0 - smoothstep(1.1, 2.0, d);
    if (k > 0.0 && occlBayer(gl_FragCoord.xy) < k * strength) discard;
  }
`;

/** Add the see-through dithering to a built-in material's shader source. */
function injectOcclusion(shader: THREE.WebGLProgramParametersWithUniforms, strength = 0.85) {
  Object.assign(shader.uniforms, occlusionUniforms);
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\nvarying vec3 vOcclWorld;")
    .replace(
      "#include <project_vertex>",
      `#include <project_vertex>
      {
        vec4 occlP = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          occlP = instanceMatrix * occlP;
        #endif
        vOcclWorld = (modelMatrix * occlP).xyz;
      }`,
    );
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", "#include <common>\n" + OCCLUSION_GLSL)
    .replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>\nocclusionDither(vOcclWorld, ${strength.toFixed(2)}, 0.0);`);
}

/** Patch a built-in material so it dithers away between the camera and the player. */
export function applyOcclusionDither<T extends THREE.Material>(material: T): T {
  material.onBeforeCompile = (shader) => injectOcclusion(shader);
  material.customProgramCacheKey = () => "wonderglobe-occl";
  return material;
}

// ------------------------------------------------ gallery shape atmosphere

/** Instance colours that light up at night in the gallery shapes (must be unique in RECIPES). */
export const GLOW_COLORS = {
  window: "#bfe6ff",
  lamp: "#fff2a5",
  beacon: "#fff3a0",
} as const;

const shapeGlow = {
  wgWindow: { value: new THREE.Color(GLOW_COLORS.window) },
  wgLamp: { value: new THREE.Color(GLOW_COLORS.lamp) },
  wgBeacon: { value: new THREE.Color(GLOW_COLORS.beacon) },
  wgWarm: { value: new THREE.Color("#ffc96a") },
};

/**
 * Gallery scenery shapes: see-through dithering, snow settling on upward
 * faces in winter, and windows/lamps (matched by instance colour) glowing
 * warm at night.
 */
export function applyShapeEffects<T extends THREE.Material>(material: T): T {
  material.onBeforeCompile = (shader) => {
    injectOcclusion(shader);
    Object.assign(shader.uniforms, shapeGlow, { wgWeather: envUniforms.uEnvWeather, wgDay: envUniforms.uEnvDay });
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying float vWgUp;\nvarying vec3 vWgPos;")
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>
        {
          vec4 wgP = vec4(transformed, 1.0);
          vec3 wgN = objectNormal;
          #ifdef USE_INSTANCING
            wgP = instanceMatrix * wgP;
            wgN = mat3(instanceMatrix) * wgN;
          #endif
          wgP = modelMatrix * wgP;
          wgN = normalize(mat3(modelMatrix) * wgN);
          vWgUp = dot(wgN, normalize(wgP.xyz));
          vWgPos = wgP.xyz;
        }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform vec4 wgWeather;
        uniform vec4 wgDay;
        uniform vec3 wgWindow;
        uniform vec3 wgLamp;
        uniform vec3 wgBeacon;
        uniform vec3 wgWarm;
        varying float vWgUp;
        varying vec3 vWgPos;
        float wgHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        {
          float jitter = (wgHash(floor(vWgPos * 9.0)) - 0.5) * 0.25;
          float snow = smoothstep(0.38, 0.62, vWgUp + jitter) * wgWeather.y;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.95, 1.0), clamp(snow * 0.95, 0.0, 1.0));
        }`,
      )
      .replace(
        "#include <opaque_fragment>",
        `#ifdef USE_COLOR
        {
          float night = smoothstep(0.35, 0.8, wgDay.z);
          float win = 1.0 - step(0.006, distance(vColor.rgb, wgWindow));
          float lamp = max(1.0 - step(0.006, distance(vColor.rgb, wgLamp)), 1.0 - step(0.006, distance(vColor.rgb, wgBeacon)));
          outgoingLight = mix(outgoingLight, mix(wgWarm, vec3(1.0, 0.92, 0.6), lamp) * 1.05, max(win, lamp) * night);
        }
        #endif
        #include <opaque_fragment>`,
      );
  };
  material.customProgramCacheKey = () => "wonderglobe-shape";
  return material;
}

// ------------------------------------------------------- creation paper material

export interface PaperUniforms {
  uTime: { value: number };
  uWave: { value: number };
  uFold: { value: number };
  uBend: { value: number };
  uHalfWidth: { value: number };
  uHeight: { value: number };
  /**
   * Optional plain-paper back: rgb = paper colour (linear), a = strength
   * (0 = off, the default; 1 = the back shows plain paper). The "back" is any
   * back-facing fragment, or a face whose object-space normal points to -Z
   * (the back cap of an extruded cut-out card).
   */
  uBackTint?: { value: THREE.Vector4 };
}

export interface PaperMaterialOptions {
  /** Show plain paper (this colour, slightly grained) on the back instead of the drawing. */
  backTint?: THREE.ColorRepresentation | null;
}

/** The paper deformation (wave / fold / curl), shared by the colour and shadow materials. */
const PAPER_DEFORM_PARS = /* glsl */ `
uniform float uTime; uniform float uWave; uniform float uFold; uniform float uBend; uniform float uHalfWidth; uniform float uHeight;`;
const PAPER_DEFORM = /* glsl */ `
{
  float xn = transformed.x / max(uHalfWidth, 1e-3);
  float yn = transformed.y / max(uHeight, 1e-3);
  // Body wave: z offset travelling along x.
  transformed.z += sin(xn * 3.2 - uTime * 7.0) * uWave * uHalfWidth * 0.18 * abs(xn);
  // Wing fold around the centre line.
  float side = sign(transformed.x);
  float ang = uFold * 1.1;
  float ax = abs(transformed.x);
  transformed.z += -sin(ang) * ax;
  transformed.x = side * cos(ang) * ax;
  // Paper curl.
  transformed.z += uBend * yn * yn * uHeight * 0.35;
}`;

/**
 * Paper with vertex deformation for drawings:
 *  uWave – travelling body wave (fish, snakes)
 *  uFold – wings folding around the vertical centre line (butterflies, birds)
 *  uBend – paper curl leaning the top forward/back (walk rocking, sway)
 * Pass `{ backTint }` for a plain paper back (default: the drawing on both sides).
 * For a matching cast shadow use `createPaperDepthMaterial(map, uniforms)`.
 */
export function createPaperMaterial(map: THREE.Texture | null, color?: string, opts: PaperMaterialOptions = {}): { material: THREE.MeshBasicMaterial; uniforms: PaperUniforms } {
  const back = new THREE.Vector4(0.93, 0.89, 0.8, 0);
  if (opts.backTint !== undefined && opts.backTint !== null) {
    const c = new THREE.Color(opts.backTint);
    back.set(c.r, c.g, c.b, 1);
  }
  const uniforms: PaperUniforms = {
    uTime: { value: 0 },
    uWave: { value: 0 },
    uFold: { value: 0 },
    uBend: { value: 0 },
    uHalfWidth: { value: 1 },
    uHeight: { value: 1 },
    uBackTint: { value: back },
  };
  // Unlit like the scenery cut-outs: paper should read clearly from any side.
  const material = new THREE.MeshBasicMaterial({ map, color: color ?? "#f7f7f7", alphaTest: map ? 0.35 : 0, side: THREE.FrontSide });
  material.onBeforeCompile = (shader) => {
    injectOcclusion(shader);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${PAPER_DEFORM_PARS}\nvarying float vWgBack;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>\n${PAPER_DEFORM}\nvWgBack = normal.z < -0.5 ? 1.0 : 0.0;`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec4 uBackTint;\nvarying float vWgBack;")
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        if (uBackTint.a > 0.0) {
          float wgBack = max(vWgBack, gl_FrontFacing ? 0.0 : 1.0);
          float wgGrain = fract(sin(dot(floor(gl_FragCoord.xy * 0.5), vec2(12.9898, 78.233))) * 43758.5453);
          diffuseColor.rgb = mix(diffuseColor.rgb, uBackTint.rgb * (0.95 + 0.07 * wgGrain), wgBack * uBackTint.a);
        }`,
      );
  };
  material.customProgramCacheKey = () => "wonderglobe-paper";
  return { material, uniforms };
}

/**
 * Shadow caster for a paper creation: the same wave/fold/curl deformation as
 * `createPaperMaterial` (pass ITS uniforms so shadows move with the paper),
 * with the cut-out's alpha. Usage:
 *
 *   const { material, uniforms } = createPaperMaterial(texture);
 *   mesh.material = material;
 *   mesh.customDepthMaterial = createPaperDepthMaterial(texture, uniforms);
 *   mesh.castShadow = true;
 */
export function createPaperDepthMaterial(map: THREE.Texture | null, uniforms: PaperUniforms): THREE.MeshDepthMaterial {
  const material = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: map ? 0.35 : 0 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${PAPER_DEFORM_PARS}`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>\n${PAPER_DEFORM}`);
  };
  material.customProgramCacheKey = () => "wonderglobe-paper-depth";
  return material;
}
