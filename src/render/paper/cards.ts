// Instanced paper cards: every standing scenery cut-out is built from one or
// more cards (crossed in an X or a star for plants, a single card for fences
// and benches, a single card along the heading for animals). One instance =
// one card, all drawn in ONE call from the scenery atlas, plus one shadow-map
// call through a matching depth material, so shadows have the exact cut-out
// shape and move with the bow and the wind.
//
// Per-instance attributes (InstancedBufferAttribute):
//   aCenter (vec3) – base point (top of the cardboard stand / ground / water)
//   aSize   (vec2) – card width, height (world)
//   aUv     (vec4) – atlas rect u0 v0 u1 v1
//   aParams (vec4) – sway amount, phase, bow (-1..1), base offset (world, along up)
//   aExtra  (vec4) – kind (BILLBOARD_KIND), random 0..1, hue rotation (rad), back mode
//                    (0 plain paper, 1 faded drawing, 2 drawing)
//   aRight  (vec3) – the card's right axis (a tangent at aCenter)
//   aBack   (vec3) – plain paper colour for the back (linear)

import * as THREE from "three";
import { envUniforms, ENV_PARS } from "../atmosphere/envUniforms";
import { shadowReceiveUniforms, SHADOW_VERT_PARS, SHADOW_FRAG_PARS, shadowVert } from "../materials";
import { PLANET_RADIUS } from "@/world/sphere";

/** Uniforms shared by a card mesh's colour and depth materials. */
export interface CardUniforms {
  uMap: { value: THREE.Texture };
  uTime: { value: number };
  /** The real (view) camera — the shadow pass has its own `cameraPosition`. */
  uCamPos: { value: THREE.Vector3 };
  uCamUp: { value: THREE.Vector3 };
  /** 0..1: how much single cards turn toward the camera in planet view (ambient animals). */
  uFaceCam: { value: number };
  uPlayer: { value: THREE.Vector3 };
  uFocus: { value: THREE.Vector3 };
  uFocusOn: { value: number };
}

export function createCardUniforms(map: THREE.Texture): CardUniforms {
  return {
    uMap: { value: map },
    uTime: { value: 0 },
    uCamPos: { value: new THREE.Vector3(0, 30, 40) },
    uCamUp: { value: new THREE.Vector3(0, 1, 0) },
    uFaceCam: { value: 1 },
    uPlayer: { value: new THREE.Vector3() },
    uFocus: { value: new THREE.Vector3() },
    uFocusOn: { value: 0 },
  };
}

const R = PLANET_RADIUS.toFixed(2);

/**
 * The shared paper frame: horizon culling, planet-view tilt toward the
 * camera (rigid, so crossed cards stay crossed) and an optional turn toward
 * the camera for single cards.
 */
export const PAPER_FRAME_GLSL = /* glsl */ `
uniform vec3 uCamPos;
uniform vec3 uCamUp;
uniform float uFaceCam;
vec3 paperRot(vec3 v, vec3 k, float c, float s) { return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c); }
// False when a piece of height h at 'center' is hidden behind the planet.
bool paperVisible(vec3 center, float h) {
  float camLen = length(uCamPos);
  vec3 up = normalize(center);
  float ang = acos(clamp(dot(up, uCamPos / camLen), -1.0, 1.0));
  float horizon = acos(clamp(${R} / camLen, 0.0, 1.0)) + acos(clamp(${R} / (${R} + h + 0.5), 0.0, 1.0)) + 0.06;
  return ang < horizon;
}
// Builds the frame (U up, Rt right, F front) for a piece at 'center' whose right axis is 'right'.
void paperFrame(vec3 center, vec3 right, float faceCam, out vec3 U, out vec3 Rt, out vec3 F, out float far, out vec3 viewDir) {
  vec3 up = normalize(center);
  vec3 toCam = uCamPos - center;
  viewDir = normalize(toCam);
  far = smoothstep(30.0, 46.0, length(uCamPos));
  vec3 r = right - up * dot(right, up);
  if (dot(r, r) < 1e-8) r = cross(up, abs(up.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0));
  r = normalize(r);
  if (faceCam > 0.0) {
    vec3 b = cross(up, toCam);
    if (dot(b, b) > 1e-8) {
      b = normalize(b);
      if (dot(b, r) < 0.0) b = -b;
      vec3 m = mix(r, b, clamp(far * faceCam, 0.0, 1.0));
      if (dot(m, m) > 1e-6) r = normalize(m);
    }
  }
  U = up;
  Rt = r;
  if (far > 0.0) {
    vec3 cu = uCamUp - viewDir * dot(uCamUp, viewDir);
    if (dot(cu, cu) > 1e-8) {
      cu = normalize(cu);
      vec3 axis = cross(up, cu);
      float al = length(axis);
      if (al > 1e-3) {
        axis /= al;
        float a = min(far * 0.85 * acos(clamp(dot(up, cu), -1.0, 1.0)), 1.25);
        float c = cos(a), s = sin(a);
        U = paperRot(U, axis, c, s);
        Rt = paperRot(Rt, axis, c, s);
      }
    }
  }
  F = cross(Rt, U);
}
`;

const CARD_VERT_PARS = /* glsl */ `
attribute vec3 aCenter;
attribute vec2 aSize;
attribute vec4 aUv;
attribute vec4 aParams;
attribute vec4 aExtra;
attribute vec3 aRight;
attribute vec3 aBack;
uniform float uTime;
uniform vec4 uEnvWind;
uniform vec4 uHaze;
${PAPER_FRAME_GLSL}
vec3 cardWindDir(vec3 up) {
  vec3 w = cross(uEnvWind.xyz, up);
  float l = length(w);
  return l > 1e-4 ? w / l : vec3(1.0, 0.0, 0.0);
}
// World position + bowed normal of this vertex. False = hidden (cull).
bool placeCard(out vec3 world, out vec3 nrm, out float far) {
  float h = aSize.y;
  if (!paperVisible(aCenter, h)) return false;
  vec3 U, Rt, F, viewDir;
  #ifdef CARD_FACE_CAMERA
    paperFrame(aCenter, aRight, uFaceCam, U, Rt, F, far, viewDir);
  #else
    paperFrame(aCenter, aRight, 0.0, U, Rt, F, far, viewDir);
  #endif
  float xn = position.x;
  float yn = position.y;
  float w = aSize.x;
  // Paper bow (each card its own) and a gentle top curl; normals follow the curve.
  float bow = aParams.z;
  float curl = (fract(aExtra.y * 7.31) - 0.5) * 0.7;
  float z = bow * xn * xn * w * 0.42 + curl * yn * yn * h * 0.07;
  float dzdx = bow * xn * 0.84;
  float dzdy = curl * yn * 0.14;
  nrm = normalize(F - Rt * dzdx - U * dzdy);
  // Wind: the whole piece bends the same way (crossed cards stay slotted together).
  vec3 up = normalize(aCenter);
  float motion = uHaze.w;
  float gust = uEnvWind.w;
  vec3 wt = cardWindDir(up);
  float osc = sin(uTime * 1.6 * motion + aParams.y) * (0.06 + 0.08 * gust) + sin(uTime * 4.3 * motion + aParams.y * 3.0) * gust * 0.03;
  float bend = aParams.x * yn * yn * h;
  vec3 disp = wt * (osc + gust * 0.2) * bend + cross(up, wt) * sin(uTime * 1.13 * motion + aParams.y * 1.7) * 0.04 * bend;
  world = aCenter + Rt * (xn * w) + U * (yn * h + aParams.w) + F * z + disp;
  // Planet view: lift tilted stickers toward the camera so they don't sink into hills.
  world += viewDir * far * h * (0.2 + 0.35 * yn);
  return true;
}
`;

const BAYER_GLSL = /* glsl */ `
float bayer4(vec2 p) {
  vec2 q = mod(floor(p), 4.0);
  int i = int(q.x + q.y * 4.0);
  float m[16];
  m[0]=0.0; m[1]=8.0; m[2]=2.0; m[3]=10.0; m[4]=12.0; m[5]=4.0; m[6]=14.0; m[7]=6.0;
  m[8]=3.0; m[9]=11.0; m[10]=1.0; m[11]=9.0; m[12]=15.0; m[13]=7.0; m[14]=13.0; m[15]=5.0;
  for (int k = 0; k < 16; k++) { if (k == i) return m[k] / 16.0; }
  return 0.0;
}
`;

/** Fades pieces standing between the camera and the player (or the camera's focus point). */
export const OBSTRUCT_GLSL = /* glsl */ `
uniform vec3 uPlayer;
uniform vec3 uFocus;
uniform float uFocusOn;
float obstruct(vec3 target, vec3 mid, float width) {
  vec3 seg = target - uCamPos;
  float segLen = length(seg);
  vec3 dir = seg / max(segLen, 1e-4);
  float tAlong = dot(mid - uCamPos, dir);
  float distToSeg = length(uCamPos + dir * clamp(tAlong, 0.0, segLen) - mid);
  float between = step(0.5, tAlong) * step(tAlong, segLen - 0.6);
  return between * (1.0 - smoothstep(width * 0.35, width * 0.75 + 0.4, distToSeg));
}
float obstructFade(vec3 mid, float width) {
  float fade = 1.0 - obstruct(uPlayer, mid, width) * 0.85;
  // Pieces right in front of the lens dissolve completely.
  fade = min(fade, smoothstep(0.8, 3.2, length(mid - uCamPos) - width * 0.35));
  if (uFocusOn > 0.5) fade = min(fade, 1.0 - obstruct(uFocus, mid, width) * 0.85);
  return fade;
}
`;

/** Paper lighting shared by cards and buildings: soft lambert + translucency, cast shadows, envApply. */
export const PAPER_LIGHT_GLSL = /* glsl */ `
vec3 paperLight(vec3 col, vec3 n, float translucency, float ground) {
  float ndl = dot(n, uLightDir);
  float mask = getShadowMask();
  float light = 0.8 + 0.27 * max(ndl, 0.0) * mask + max(-ndl, 0.0) * translucency;
  light *= mix(0.84, 1.0, ground);
  vec3 shade = mix(vec3(0.8, 0.82, 0.97), vec3(1.0), mask);
  return envApply(col * light * shade);
}
vec3 hueRotate(vec3 c, float a) {
  const vec3 k = vec3(0.57735);
  float ca = cos(a);
  return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}
`;

/** Seasons (autumn leaves, snow caps, frost) and night lights (windows, lamps) on a drawing. */
export const PAPER_SEASON_GLSL = /* glsl */ `
vec3 paperSeason(vec3 col, float kind, float rnd, vec2 local) {
  float green = smoothstep(0.02, 0.1, col.g - max(col.r, col.b));
  float isTree = step(2.5, kind) * step(kind, 5.5);
  if (kind > 2.5 && kind < 3.5 && uEnvWeather.z > 0.0) {
    vec3 a1 = rnd < 0.3 ? vec3(0.98, 0.45, 0.08) : rnd < 0.55 ? vec3(0.9, 0.2, 0.08) : rnd < 0.8 ? vec3(0.98, 0.7, 0.1) : vec3(0.85, 0.32, 0.12);
    vec3 a2 = rnd < 0.5 ? vec3(0.99, 0.78, 0.2) : vec3(0.95, 0.38, 0.1);
    float l = dot(col, vec3(0.3, 0.59, 0.11));
    float dapple = envNoise(vec3(local * 11.0, rnd * 13.0));
    vec3 autumn = mix(a1, a2, smoothstep(0.55, 0.75, dapple) * 0.7) * clamp(0.35 + l * 1.9, 0.45, 1.15);
    col = mix(col, autumn, smoothstep(0.0, 0.06, col.g - max(col.r, col.b)) * uEnvWeather.z);
  }
  float cover = uEnvWeather.y;
  if (cover > 0.01) {
    float edgeLine = local.y + 0.035 * sin(local.x * 26.0 + rnd * 9.0) + (envNoise(vec3(local * 7.0, rnd * 7.0)) - 0.5) * 0.12;
    float capAt = 0.8 - 0.08 * cover;
    float cap = smoothstep(capAt, capAt + 0.025, edgeLine);
    float shadeBand = 1.0 - smoothstep(0.0, 0.04, edgeLine - capAt);
    float onTree = isTree * cap * max(green, step(4.5, kind) * step(kind, 5.5) * 0.8);
    float frost = step(5.5, kind) * step(kind, 6.5) * green * 0.35;
    vec3 snowCol = mix(vec3(0.95, 0.97, 1.0), vec3(0.74, 0.82, 0.95), shadeBand * 0.75) * (0.9 + 0.35 * dot(col, vec3(0.3, 0.59, 0.11)));
    float lum = dot(col, vec3(0.3, 0.59, 0.11));
    float onRoof = step(0.5, kind) * step(kind, 1.5) * smoothstep(0.75, 0.78, edgeLine) * step(0.12, lum);
    col = mix(col, snowCol, clamp((onTree + onRoof * 0.92) * smoothstep(0.0, 0.3, cover) + frost * cover, 0.0, 1.0));
  }
  return col;
}
vec3 paperNightLights(vec3 lit, vec3 col, float kind, vec2 local) {
  float night = smoothstep(0.35, 0.8, uEnvDay.z);
  if (night > 0.0 && (kind > 0.5 && kind < 2.5 || kind > 6.5)) {
    float win = step(0.25, col.r) * step(0.6, col.g) * step(0.7, col.b) * step(col.r + 0.28, col.b);
    float lamp = step(0.85, col.r) * step(0.5, col.g) * step(col.b, 0.5) * step(0.55, local.y);
    if (kind < 1.5) lamp = 0.0;
    float glow = max(win, lamp);
    vec3 warm = mix(vec3(1.0, 0.78, 0.38), vec3(1.0, 0.93, 0.62), lamp);
    lit = mix(lit, warm * (0.95 + 0.1 * col.g), glow * night);
  }
  return lit;
}
`;

/** Colour material for instanced cards (scenery, or ambient animals with `faceCamera`). */
export function createCardMaterial(u: CardUniforms, opts: { faceCamera?: boolean } = {}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { ...shadowReceiveUniforms(), ...u, ...envUniforms },
    defines: opts.faceCamera ? { CARD_FACE_CAMERA: "" } : {},
    lights: true,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      ${CARD_VERT_PARS}
      ${SHADOW_VERT_PARS}
      ${OBSTRUCT_GLSL}
      uniform vec3 uLightDir;
      varying vec2 vUv;
      varying vec2 vLocal;
      varying vec4 vExtra;
      varying vec3 vNormal;
      varying vec3 vBack;
      varying float vFade;
      void main() {
        vec3 world, nrm;
        float far;
        if (!placeCard(world, nrm, far)) {
          gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
          return;
        }
        vUv = vec2(mix(aUv.x, aUv.z, position.x + 0.5), mix(aUv.y, aUv.w, position.y));
        vLocal = vec2(position.x + 0.5, position.y);
        vExtra = aExtra;
        vNormal = nrm;
        vBack = aBack;
        vec3 up = normalize(aCenter);
        vFade = obstructFade(aCenter + up * aSize.y * 0.5, aSize.x);
        vec3 toLight = dot(nrm, uLightDir) >= 0.0 ? nrm : -nrm;
        ${shadowVert("world", "toLight")}
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${SHADOW_FRAG_PARS}
      uniform sampler2D uMap;
      ${ENV_PARS}
      ${BAYER_GLSL}
      ${PAPER_LIGHT_GLSL}
      ${PAPER_SEASON_GLSL}
      varying vec2 vUv;
      varying vec2 vLocal;
      varying vec4 vExtra;
      varying vec3 vNormal;
      varying vec3 vBack;
      varying float vFade;
      void main() {
        vec4 c = texture2D(uMap, vUv);
        if (c.a < 0.5) discard;
        if (vFade < 0.999 && bayer4(gl_FragCoord.xy) > vFade) discard;
        float kind = vExtra.x;
        float rnd = vExtra.y;
        vec3 col = c.rgb;
        // Copy-to-copy variety: hue (flowers keep their green stems) and a little brightness.
        if (abs(vExtra.z) > 0.001) {
          float green = smoothstep(0.02, 0.1, col.g - max(col.r, col.b));
          float keep = (kind > 5.5 && kind < 6.5) ? green : 0.0;
          col = mix(hueRotate(col, vExtra.z), col, keep);
        }
        col *= 0.94 + 0.12 * fract(rnd * 13.7);
        col = paperSeason(col, kind, rnd, vLocal);
        bool front = gl_FrontFacing;
        if (!front) {
          float mode = vExtra.w;
          if (mode < 0.5) {
            // Plain paper back; the drawing shows through ever so faintly.
            float l = dot(c.rgb, vec3(0.3, 0.59, 0.11));
            col = vBack * (0.96 + 0.08 * l);
          } else if (mode < 1.5) {
            col = mix(col, vBack, 0.28);
          }
        }
        vec3 n = normalize(vNormal) * (front ? 1.0 : -1.0);
        float leafy = (kind > 2.5 && kind < 6.5) ? 0.16 : 0.07;
        vec3 lit = paperLight(col, n, leafy, smoothstep(0.0, 0.22, vLocal.y));
        lit = paperNightLights(lit, col, kind, vLocal);
        gl_FragColor = vec4(lit, 1.0);
      }
    `,
  });
}

/** Shadow-map material for instanced cards: same placement, bow and wind, cut-out alpha. */
export function createCardDepthMaterial(u: CardUniforms, opts: { faceCamera?: boolean } = {}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { ...u, ...envUniforms },
    defines: opts.faceCamera ? { CARD_FACE_CAMERA: "" } : {},
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      ${CARD_VERT_PARS}
      varying vec2 vUv;
      void main() {
        vec3 world, nrm;
        float far;
        if (!placeCard(world, nrm, far)) {
          gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
          return;
        }
        vUv = vec2(mix(aUv.x, aUv.z, position.x + 0.5), mix(aUv.y, aUv.w, position.y));
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      varying vec2 vUv;
      void main() {
        if (texture2D(uMap, vUv).a < 0.5) discard;
        gl_FragColor = vec4(1.0);
      }
    `,
  });
}

/** Instanced geometry for `count` cards (a 4x4-segment quad: x -0.5..0.5, y 0..1). */
export function buildCardGeometry(count: number) {
  const base = new THREE.PlaneGeometry(1, 1, 4, 4);
  base.translate(0, 0.5, 0);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute("position", base.getAttribute("position"));
  const attr = (n: number) => new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, count) * n), n);
  const a = {
    center: attr(3),
    size: attr(2),
    uv: attr(4),
    params: attr(4),
    extra: attr(4),
    right: attr(3),
    back: attr(3),
  };
  geo.setAttribute("aCenter", a.center);
  geo.setAttribute("aSize", a.size);
  geo.setAttribute("aUv", a.uv);
  geo.setAttribute("aParams", a.params);
  geo.setAttribute("aExtra", a.extra);
  geo.setAttribute("aRight", a.right);
  geo.setAttribute("aBack", a.back);
  geo.instanceCount = count;
  // Instances are placed in the shader; never let three cull the whole batch.
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), PLANET_RADIUS + 12);
  return { geo, ...a };
}

export type CardGeometry = ReturnType<typeof buildCardGeometry>;
