"use client";
// Little bursts of paper stars (arrivals, notes, celebrations).

import { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { getAssets } from "./assets";

interface Particle {
  sprite: THREE.Sprite;
  vel: THREE.Vector3;
  up: THREE.Vector3;
  life: number;
  max: number;
  spin: number;
}

const queue: Array<{ point: THREE.Vector3; up: THREE.Vector3; count: number }> = [];

/** Request a star burst at a world point. */
export function burstStars(point: THREE.Vector3, up: THREE.Vector3, count = 14) {
  queue.push({ point: point.clone(), up: up.clone().normalize(), count });
}

const POOL = 80;
const TINTS = ["#ffffff", "#fff2b0", "#ffd0e0", "#d0f0ff", "#e0ffd0"];

export function Bursts({ reducedMotion }: { reducedMotion: boolean }) {
  const particles = useMemo<Particle[]>(() => {
    const map = getAssets().star;
    return Array.from({ length: POOL }, (_, i) => {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map, color: TINTS[i % TINTS.length], depthWrite: false, transparent: true }));
      sprite.visible = false;
      return { sprite, vel: new THREE.Vector3(), up: new THREE.Vector3(), life: 0, max: 1, spin: 0 };
    });
  }, []);
  const tmp = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    while (queue.length) {
      const b = queue.shift()!;
      const count = reducedMotion ? Math.min(5, b.count) : b.count;
      let made = 0;
      for (const p of particles) {
        if (made >= count) break;
        if (p.life > 0) continue;
        p.life = p.max = 0.9 + Math.random() * 0.6;
        p.up.copy(b.up);
        // Random direction in the tangent plane plus an upward kick.
        tmp.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
        tmp.addScaledVector(b.up, -tmp.dot(b.up)).normalize();
        p.vel.copy(tmp).multiplyScalar(reducedMotion ? 1 : 2 + Math.random() * 2.5).addScaledVector(b.up, reducedMotion ? 1.5 : 3 + Math.random() * 3);
        p.sprite.position.copy(b.point).addScaledVector(b.up, 0.6);
        p.sprite.visible = true;
        p.spin = (Math.random() - 0.5) * 8;
        made++;
      }
    }
    for (const p of particles) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.sprite.visible = false;
        continue;
      }
      p.vel.addScaledVector(p.up, -7 * dt);
      p.vel.multiplyScalar(1 - dt * 1.2);
      p.sprite.position.addScaledVector(p.vel, dt);
      const k = p.life / p.max;
      const s = 0.45 * Math.min(1, (1 - k) * 6) * (0.4 + 0.6 * k);
      p.sprite.scale.set(s, s, 1);
      p.sprite.material.rotation += p.spin * dt;
      p.sprite.material.opacity = Math.min(1, k * 2);
    }
  });

  return (
    <group>
      {particles.map((p, i) => (
        <primitive key={i} object={p.sprite} />
      ))}
    </group>
  );
}
