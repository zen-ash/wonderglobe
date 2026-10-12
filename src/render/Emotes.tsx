"use client";
// Little paper speech bubbles above creations (and ambient animals): heart,
// "!", "?", "zzz", a music note, a sparkle. Drawn once into canvas textures
// and shown with a small pool of sprites.

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { WorldRuntime } from "@/world/runtime";
import type { Agent } from "@/world/agents";
import { stepTime } from "./creatures/stopMotion";

const INK = "#2b2320";
const PAPER = "#fffdf6";

function bubble(ctx: CanvasRenderingContext2D) {
  const S = 128;
  ctx.clearRect(0, 0, S, S);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  // Soft shadow + paper bubble with a little tail.
  ctx.save();
  ctx.translate(3, 4);
  ctx.fillStyle = "rgba(40,30,25,0.22)";
  ctx.beginPath();
  ctx.arc(64, 56, 44, 0, Math.PI * 2);
  ctx.moveTo(52, 94);
  ctx.lineTo(64, 116);
  ctx.lineTo(76, 94);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = PAPER;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(64, 56, 44, 0.62 * Math.PI, 0.38 * Math.PI + Math.PI * 2);
  ctx.lineTo(64, 114);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function heart(ctx: CanvasRenderingContext2D, color = "#ff5a7a") {
  ctx.fillStyle = color;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(64, 82);
  ctx.bezierCurveTo(30, 60, 34, 30, 52, 32);
  ctx.bezierCurveTo(60, 33, 64, 40, 64, 44);
  ctx.bezierCurveTo(64, 40, 68, 33, 76, 32);
  ctx.bezierCurveTo(94, 30, 98, 60, 64, 82);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.beginPath();
  ctx.ellipse(50, 44, 5, 8, -0.6, 0, Math.PI * 2);
  ctx.fill();
}

function star(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string) {
  ctx.fillStyle = color;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 4;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function glyph(ctx: CanvasRenderingContext2D, text: string, color: string, size: number, x = 64, y = 58) {
  ctx.font = `900 ${size}px "Trebuchet MS", "Arial Rounded MT Bold", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 7;
  ctx.strokeStyle = INK;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function note(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = "#3fae6a";
  ctx.strokeStyle = INK;
  ctx.lineWidth = 4;
  // Stem + flag.
  ctx.beginPath();
  ctx.moveTo(70, 72);
  ctx.lineTo(70, 28);
  ctx.quadraticCurveTo(84, 34, 88, 48);
  ctx.quadraticCurveTo(80, 40, 74, 42);
  ctx.lineTo(74, 72);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(60, 74, 13, 10, -0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

const DRAW: Record<string, (ctx: CanvasRenderingContext2D) => void> = {
  heart: (c) => heart(c),
  wow: (c) => {
    star(c, 64, 56, 30, "#ffd447");
    star(c, 92, 30, 9, "#ffe98a");
  },
  sparkle: (c) => {
    star(c, 58, 60, 22, "#ffe066");
    star(c, 86, 36, 12, "#ff9fb2");
    star(c, 40, 32, 9, "#9fd3ff");
  },
  exclaim: (c) => glyph(c, "!", "#ff8a3d", 76),
  question: (c) => glyph(c, "?", "#4a8fe7", 72),
  zzz: (c) => {
    glyph(c, "z", "#8a7fe0", 30, 44, 72);
    glyph(c, "z", "#8a7fe0", 40, 64, 56);
    glyph(c, "Z", "#8a7fe0", 46, 86, 36);
  },
  note: (c) => note(c),
};

let cache: Record<string, THREE.Texture> | null = null;

/** Emote textures by id (paper bubble + icon), built once. */
export function emoteTextures(): Record<string, THREE.Texture> {
  if (cache) return cache;
  cache = {};
  for (const [id, draw] of Object.entries(DRAW)) {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const ctx = c.getContext("2d")!;
    bubble(ctx);
    draw(ctx);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    cache[id] = t;
  }
  return cache;
}

const POOL = 40;
const _toCam = new THREE.Vector3();

interface Slot {
  sprite: THREE.Sprite;
}

/** Emote bubbles for creations and ambient animals (gallery visitors draw their own). */
export function EmoteLayer({ runtime, reducedMotion }: { runtime: WorldRuntime; reducedMotion: boolean }) {
  const textures = useMemo(() => emoteTextures(), []);
  const slots = useMemo<Slot[]>(
    () =>
      Array.from({ length: POOL }, () => {
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: textures.heart, transparent: true, depthWrite: false, alphaTest: 0.05 }));
        sprite.visible = false;
        sprite.renderOrder = 6;
        sprite.center.set(0.5, 0.08);
        return { sprite };
      }),
    [textures],
  );
  // When each agent's current emote started (for the pop-in).
  const born = useRef(new Map<Agent, { emote: string; at: number }>());

  useFrame((state) => {
    const now = state.clock.elapsedTime;
    const cam = state.camera.position;
    _toCam.copy(cam).normalize();
    let used = 0;
    const seen = born.current;
    const show = (a: Agent, lift: number) => {
      if (!a.emote) {
        if (seen.size) seen.delete(a);
        return;
      }
      if (used >= POOL) return;
      if (a.hidden || a.state === "carried") return;
      if (a.n.dot(_toCam) < 0.2) return; // far side of the planet
      if (a.pos.distanceToSquared(cam) > 60 * 60) return;
      let b = seen.get(a);
      if (!b || b.emote !== a.emote) {
        b = { emote: a.emote, at: now };
        seen.set(a, b);
      }
      const slot = slots[used++];
      const s = slot.sprite;
      const map = textures[a.emote] ?? textures.wow;
      if (s.material.map !== map) {
        s.material.map = map;
        s.material.needsUpdate = true;
      }
      const age = now - b.at;
      const pop = reducedMotion ? Math.min(1, age * 6) : popIn(Math.min(1, age * 4));
      const fade = Math.min(1, a.emoteTimer * 3);
      const zzz = a.emote === "zzz";
      // Bubbles bob on stop-motion frames, like the puppets below them.
      const st = stepTime(now);
      const bob = reducedMotion ? 0 : zzz ? Math.sin(st * 1.6 + a.phase) * 0.12 : Math.sin(st * 4 + a.phase) * 0.05;
      const size = 0.85 * pop * (0.6 + 0.4 * fade);
      s.scale.set(size, size, 1);
      s.material.opacity = fade;
      s.material.rotation = zzz && !reducedMotion ? Math.sin(st * 1.3 + a.phase) * 0.15 : 0;
      s.position.copy(a.pos).addScaledVector(a.n, lift + bob);
      s.visible = true;
    };
    for (const a of runtime.creations.values()) {
      const low = a.behavior === "swim" ? 0.55 : 1.05;
      show(a, a.size * low + 0.2);
    }
    for (const a of runtime.ambient) show(a, a.size + 0.2);
    for (let i = used; i < POOL; i++) slots[i].sprite.visible = false;
    // Forget removed creations.
    if (seen.size > 200) seen.clear();
  });

  return (
    <group>
      {slots.map((s, i) => (
        <primitive key={i} object={s.sprite} />
      ))}
    </group>
  );
}

function popIn(t: number): number {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}
