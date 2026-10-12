// Little folded paper buildings for the scenery houses (houses, cottage, barn,
// beach huts): the drawing stands as the front and back wall, plain paper
// side walls in the drawing's wall colour join them, and a folded two-panel
// roof in the drawing's roof colour sits on top. One instanced draw call (and
// one shadow call) for all of them.
//
// Template vertex attributes: position (template coords) + aPart:
//   0 front card, 1 back card, 2 side walls, 3 / 5 left / right roof panel,
//   4 inner end walls (pentagons behind the cards).
// Per-instance: aCenter, aRight (front's right axis), aSize (card w, h),
//   aUv, aShape (body width, body centre, eave, ridge — fractions),
//   aDim (depth, anchor offset, kind, rnd), aWall, aRoof (linear rgb).

import * as THREE from "three";
import { envUniforms, ENV_PARS } from "../atmosphere/envUniforms";
import { shadowReceiveUniforms, SHADOW_VERT_PARS, SHADOW_FRAG_PARS, shadowVert } from "../materials";
import { PAPER_FRAME_GLSL, OBSTRUCT_GLSL, PAPER_LIGHT_GLSL, PAPER_SEASON_GLSL, type CardUniforms } from "./cards";
import { PLANET_RADIUS } from "@/world/sphere";

function templateGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const part: number[] = [];
  const tri = (p: number, a: number[], b: number[], c: number[]) => {
    pos.push(...a, ...b, ...c);
    part.push(p, p, p);
  };
  const quad = (p: number, a: number[], b: number[], c: number[], d: number[]) => {
    tri(p, a, b, c);
    tri(p, a, c, d);
  };
  // Cards (tx -0.5..0.5, ty 0..1). Front faces +z, back faces -z.
  quad(0, [-0.5, 0, 0.5], [0.5, 0, 0.5], [0.5, 1, 0.5], [-0.5, 1, 0.5]);
  quad(1, [0.5, 0, -0.5], [-0.5, 0, -0.5], [-0.5, 1, -0.5], [0.5, 1, -0.5]);
  // Side walls (tx = ±1, ty 0 ground .. 1 eave, tz -0.5..0.5).
  quad(2, [1, 0, 0.5], [1, 0, -0.5], [1, 1, -0.5], [1, 1, 0.5]);
  quad(2, [-1, 0, -0.5], [-1, 0, 0.5], [-1, 1, 0.5], [-1, 1, -0.5]);
  // Roof panels (tx -1 eave .. 0 ridge .. 1 eave).
  quad(3, [-1, 0, 0.5], [0, 0, 0.5], [0, 0, -0.5], [-1, 0, -0.5]);
  quad(5, [0, 0, 0.5], [1, 0, 0.5], [1, 0, -0.5], [0, 0, -0.5]);
  // Inner end walls (ty 0 ground, 1 eave, 2 ridge) at both ends.
  for (const z of [0.5, -0.5]) {
    quad(4, [-1, 0, z], [1, 0, z], [1, 1, z], [-1, 1, z]);
    tri(4, [-1, 1, z], [1, 1, z], [0, 2, z]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("aPart", new THREE.Float32BufferAttribute(part, 1));
  return g;
}

const VERT_PARS = /* glsl */ `
attribute float aPart;
attribute vec3 aCenter;
attribute vec3 aRight;
attribute vec2 aSize;
attribute vec4 aUv;
attribute vec4 aShape;
attribute vec4 aDim;
attribute vec3 aWall;
attribute vec3 aRoof;
${PAPER_FRAME_GLSL}
bool placeBuilding(out vec3 world, out vec3 nrm, out vec2 uv, out vec2 tpl) {
  float w = aSize.x;
  float h = aSize.y;
  float anchor = aDim.y;
  float hv = h - anchor;
  if (!paperVisible(aCenter, hv)) return false;
  vec3 U, Rt, F, viewDir;
  float far;
  paperFrame(aCenter, aRight, 0.0, U, Rt, F, far, viewDir);
  float d = aDim.x;
  float bw = aShape.x * w;
  float bc = (aShape.y - 0.5) * w;
  float eave = aShape.z * hv;
  float ridge = aShape.w * hv;
  float oh = 0.07 * w;
  vec3 p = position;
  vec3 lp;
  uv = vec2(0.0);
  tpl = vec2(0.0);
  int part = int(aPart + 0.5);
  if (part == 0 || part == 1) {
    lp = vec3(p.x * w, p.y * h - anchor, p.z * d);
    nrm = part == 0 ? F : -F;
    float ux = part == 0 ? p.x + 0.5 : 0.5 - p.x;
    uv = vec2(mix(aUv.x, aUv.z, ux), mix(aUv.y, aUv.w, p.y));
    tpl = vec2(ux, p.y);
  } else if (part == 2) {
    lp = vec3(bc + p.x * bw * 0.5, p.y * eave, p.z * d * 0.985);
    nrm = Rt * p.x;
    tpl = vec2(p.z * d, p.y * eave);
  } else if (part == 3 || part == 5) {
    float side = part == 3 ? -1.0 : 1.0;
    float e = abs(p.x);
    lp = vec3(bc + p.x * (bw * 0.5 + oh), mix(ridge, eave - oh * 0.5, e), p.z * d * 0.975);
    nrm = normalize(Rt * side * (ridge - eave + oh * 0.5) + U * (bw * 0.5 + oh));
    tpl = vec2(p.z * d, e * length(vec2(bw * 0.5 + oh, ridge - eave)));
  } else {
    float y = p.y < 1.5 ? p.y * eave : ridge;
    float x = p.y < 1.5 ? p.x * bw * 0.5 : 0.0;
    lp = vec3(bc + x, y, p.z * (d - 0.06));
    nrm = F * sign(p.z);
    tpl = vec2(x, y);
  }
  world = aCenter + Rt * lp.x + U * lp.y + F * lp.z;
  world += viewDir * far * hv * (0.2 + 0.35 * clamp(lp.y / max(hv, 0.01), 0.0, 1.0));
  return true;
}
`;

export function createBuildingMaterial(u: CardUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { ...shadowReceiveUniforms(), ...u, ...envUniforms },
    lights: true,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      ${VERT_PARS}
      ${SHADOW_VERT_PARS}
      ${OBSTRUCT_GLSL}
      uniform vec3 uLightDir;
      varying vec2 vUv;
      varying vec2 vTpl;
      varying vec3 vNormal;
      varying float vPart;
      varying vec3 vWall;
      varying vec3 vRoof;
      varying vec2 vKind;
      varying float vFade;
      void main() {
        vec3 world, nrm;
        vec2 uv, tpl;
        if (!placeBuilding(world, nrm, uv, tpl)) {
          gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
          return;
        }
        vUv = uv;
        vTpl = tpl;
        vNormal = nrm;
        vPart = aPart;
        vWall = aWall;
        vRoof = aRoof;
        vKind = aDim.zw;
        vec3 up = normalize(aCenter);
        vFade = obstructFade(aCenter + up * aSize.y * 0.4, aSize.x);
        vec3 toLight = dot(nrm, uLightDir) >= 0.0 ? nrm : -nrm;
        ${shadowVert("world", "toLight")}
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${SHADOW_FRAG_PARS}
      uniform sampler2D uMap;
      ${ENV_PARS}
      ${PAPER_LIGHT_GLSL}
      ${PAPER_SEASON_GLSL}
      varying vec2 vUv;
      varying vec2 vTpl;
      varying vec3 vNormal;
      varying float vPart;
      varying vec3 vWall;
      varying vec3 vRoof;
      varying vec2 vKind;
      varying float vFade;
      float bayerB(vec2 p) {
        vec2 q = mod(floor(p), 4.0);
        float a = mod(q.x + q.y * 2.0, 4.0);
        float b = mod(q.x * 3.0 + q.y, 4.0);
        return (a * 4.0 + b) / 16.0;
      }
      void main() {
        if (vFade < 0.999 && bayerB(gl_FragCoord.xy) > vFade) discard;
        int part = int(vPart + 0.5);
        float kind = vKind.x;
        float rnd = vKind.y;
        vec3 col;
        vec3 n = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);
        if (part <= 1) {
          vec4 c = texture2D(uMap, vUv);
          if (c.a < 0.5) discard;
          col = paperSeason(c.rgb, kind, rnd, vTpl);
          vec3 lit = paperLight(col, n, 0.05, smoothstep(0.0, 0.2, vTpl.y));
          gl_FragColor = vec4(paperNightLights(lit, col, kind, vTpl), 1.0);
          return;
        }
        float grain = envNoise(vec3(vTpl * 9.0, rnd * 10.0));
        if (part == 3 || part == 5) {
          // Crayon roof: shingle rows down the slope, a darker eave edge, snow in winter.
          float row = fract(vTpl.y * 3.2 + sin(vTpl.x * 5.0 + rnd * 6.0) * 0.06);
          col = vRoof * (0.9 + 0.12 * grain) * mix(0.8, 1.0, smoothstep(0.0, 0.16, row));
          float snow = smoothstep(0.05, 0.35, uEnvWeather.y) * smoothstep(0.3, 0.6, grain + uEnvWeather.y * 0.5);
          col = mix(col, vec3(0.93, 0.95, 1.0), snow * 0.95);
        } else {
          // Plain paper walls in the drawing's wall colour, with crayon strokes.
          float stroke = 0.04 * sin(vTpl.x * 38.0 + grain * 3.0);
          col = vWall * (0.9 + 0.1 * grain + stroke);
          col *= mix(0.82, 1.0, smoothstep(0.0, 0.25, vTpl.y));
        }
        vec3 lit = paperLight(col, n, 0.03, 1.0);
        gl_FragColor = vec4(lit, 1.0);
      }
    `,
  });
}

export function createBuildingDepthMaterial(u: CardUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { ...u, ...envUniforms },
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      ${VERT_PARS}
      varying vec2 vUv;
      varying float vPart;
      void main() {
        vec3 world, nrm;
        vec2 uv, tpl;
        if (!placeBuilding(world, nrm, uv, tpl)) {
          gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
          return;
        }
        vUv = uv;
        vPart = aPart;
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      varying vec2 vUv;
      varying float vPart;
      void main() {
        if (vPart < 1.5 && texture2D(uMap, vUv).a < 0.5) discard;
        gl_FragColor = vec4(1.0);
      }
    `,
  });
}

export function buildBuildingGeometry(count: number) {
  const base = templateGeometry();
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute("position", base.getAttribute("position"));
  geo.setAttribute("aPart", base.getAttribute("aPart"));
  const attr = (n: number) => new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, count) * n), n);
  const a = { center: attr(3), right: attr(3), size: attr(2), uv: attr(4), shape: attr(4), dim: attr(4), wall: attr(3), roof: attr(3) };
  geo.setAttribute("aCenter", a.center);
  geo.setAttribute("aRight", a.right);
  geo.setAttribute("aSize", a.size);
  geo.setAttribute("aUv", a.uv);
  geo.setAttribute("aShape", a.shape);
  geo.setAttribute("aDim", a.dim);
  geo.setAttribute("aWall", a.wall);
  geo.setAttribute("aRoof", a.roof);
  geo.instanceCount = count;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), PLANET_RADIUS + 12);
  return { geo, ...a };
}
