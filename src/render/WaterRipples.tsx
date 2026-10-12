"use client";
// <Ripples/> (WaterRipples.tsx): draws the ripple pool from ./ripples.ts (one instanced draw
// call), and spawns ripples by itself for rain on the water, local showers
// and floating ambient creatures (ducks, boats).

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { WorldRuntime } from "@/world/runtime";
import { environment } from "@/world/environment";
import { getAssets } from "./assets";
import { ENV_PARS, envUniforms, atmosphere } from "./atmosphere/envUniforms";
import { MAX_RIPPLES, rippleState, setRippleTerrain, addRipple } from "./ripples";
import { showers, showerStrength, nowSeconds } from "./atmosphere/showers";
import { randomInCap } from "@/world/sphere";

export { addRipple } from "./ripples";

const _p = new THREE.Vector3();
const _c = new THREE.Vector3();

function createRippleMaterial(map: THREE.Texture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uMap: { value: map }, uNow: { value: 0 }, ...envUniforms },
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      attribute vec3 aPos;
      attribute vec4 aData; // start, size, life, seed
      uniform float uNow;
      varying vec2 vUv;
      varying float vAlpha;
      void main() {
        float age = (uNow - aData.x) / max(aData.z, 0.01);
        if (age < 0.0 || age > 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
        vec3 n = normalize(aPos);
        vec3 a = abs(n.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
        vec3 e1 = normalize(cross(n, a));
        vec3 e2 = cross(n, e1);
        float ease = 1.0 - pow(1.0 - age, 2.2);
        float s = aData.y * (0.25 + 0.95 * ease);
        float rot = aData.w * 6.28;
        vec2 q = vec2(cos(rot) * position.x - sin(rot) * position.y, sin(rot) * position.x + cos(rot) * position.y);
        vec3 world = aPos + (e1 * q.x + e2 * q.y) * s * 2.0;
        vUv = uv;
        vAlpha = pow(1.0 - age, 1.4) * smoothstep(0.0, 0.08, age);
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      ${ENV_PARS}
      varying vec2 vUv;
      varying float vAlpha;
      void main() {
        vec4 c = texture2D(uMap, vUv);
        float a = c.a * vAlpha * 0.85;
        if (a < 0.02) discard;
        vec3 col = envApply(vec3(0.97, 0.99, 1.0));
        gl_FragColor = vec4(col, a);
      }
    `,
  });
}

export function Ripples({ runtime, lightGraphics = environment.lightGraphics }: { runtime?: WorldRuntime; lightGraphics?: boolean }) {
  const assets = getAssets();
  useEffect(() => {
    if (runtime) setRippleTerrain(runtime.terrain);
    return () => setRippleTerrain(null);
  }, [runtime]);

  const { mesh, material, posAttr, dataAttr } = useMemo(() => {
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute("position", base.getAttribute("position"));
    geo.setAttribute("uv", base.getAttribute("uv"));
    const posAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_RIPPLES * 3), 3).setUsage(THREE.DynamicDrawUsage);
    const dataAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_RIPPLES * 4).fill(-100), 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("aPos", posAttr);
    geo.setAttribute("aData", dataAttr);
    geo.instanceCount = MAX_RIPPLES;
    const material = createRippleMaterial(assets.ripple);
    const mesh = new THREE.Mesh(geo, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    mesh.name = "ripples";
    return { mesh, material, posAttr, dataAttr };
  }, [assets]);

  useEffect(() => () => mesh.geometry.dispose(), [mesh]);

  const seen = useRef(-1);
  const rainAcc = useRef(0);
  const duckTimers = useRef<number[]>([]);
  const rng = useMemo(() => {
    let a = 1234567;
    return () => {
      a = (a * 1664525 + 1013904223) >>> 0;
      return a / 4294967296;
    };
  }, []);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const now = nowSeconds();
    material.uniforms.uNow.value = now;

    // Rain on the water around the view (and under local showers).
    if (atmosphere.planetView < 0.9) {
      const rate = environment.rain * (lightGraphics ? 6 : 16);
      rainAcc.current += rate * dt;
      if (rainAcc.current > 0) {
        _c.copy(atmosphere.up);
        while (rainAcc.current >= 1) {
          rainAcc.current -= 1;
          randomInCap(_c, 0.55, rng, _p);
          addRipple(_p, 0.25 + rng() * 0.35);
        }
      }
      for (const s of showers) {
        const k = showerStrength(s, now);
        if (k > 0 && rng() < k * dt * 10) {
          randomInCap(s.dir, 0.07, rng, _p);
          addRipple(_p, 0.25 + rng() * 0.3);
        }
      }
    }
    // Floating creatures leave little rings behind them.
    if (runtime) {
      const timers = duckTimers.current;
      runtime.ambient.forEach((a, i) => {
        if (a.behavior !== "float") return;
        timers[i] = (timers[i] ?? rng() * 2) - dt;
        if (timers[i] <= 0) {
          timers[i] = 1.1 + rng() * 1.4;
          if (a.moveAmount > 0.1 || rng() < 0.3) addRipple(a.pos, a.size * 0.55, { life: 2.2 });
        }
      });
    }

    if (seen.current !== rippleState.version) {
      seen.current = rippleState.version;
      const d = rippleState.data;
      for (let i = 0; i < MAX_RIPPLES; i++) {
        const o = i * 8;
        posAttr.setXYZ(i, d[o], d[o + 1], d[o + 2]);
        dataAttr.setXYZW(i, d[o + 3] || -100, d[o + 4], d[o + 5], d[o + 6]);
      }
      posAttr.needsUpdate = true;
      dataAttr.needsUpdate = true;
    }
  });

  return <primitive object={mesh} />;
}
