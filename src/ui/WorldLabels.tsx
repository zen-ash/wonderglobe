"use client";
// Little pill labels over the planet in the whole-planet view: every region
// (emoji + name), the child's creations or gallery pictures, and a bright
// "You" pill over the player. Positions are projected with the live camera
// (render/viewState) in one requestAnimationFrame loop and written straight
// to element styles, so nothing re-renders per frame.

import { memo, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useGame } from "@/state/store";
import { REGIONS } from "@/world/planet";
import { PLANET_RADIUS } from "@/world/sphere";
import { getKind } from "@/core/kinds";
import { getArtworkUrls } from "@/persistence";
import { view } from "@/render/viewState";
import { camera, setCameraMode } from "@/render/cameraControl";
import { travelNear, travelTo } from "./travel";
import { playSfx } from "@/audio/sfx";

type LabelKind = "region" | "thing" | "you";

interface LabelItem {
  key: string;
  kind: LabelKind;
  text: string;
  emoji: string;
  /** Creation / easel id (things), region index (regions). */
  id: string;
  artworkId?: string;
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/**
 * How visible a label is (0..1) for a surface point whose outward direction
 * has `facing` = dot(dir, cameraDir), seen from `camDist` world units out.
 * Fades out before the horizon so labels never sit on the planet's edge.
 */
export function labelFacingFade(facing: number, camDist: number, radius = PLANET_RADIUS): number {
  const horizon = radius / Math.max(camDist, radius + 0.01);
  return smooth(horizon + 0.03, horizon + 0.15, facing);
}

/** Planet-view strength 0..1 from the camera blend (explore 0 → planet 1). */
export function planetViewFade(blend: number): number {
  return smooth(0.55, 0.95, blend);
}

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _camDir = new THREE.Vector3();

interface Slot {
  op: number;
  halfW: number;
  h: number;
  x: number;
  y: number;
  z: number;
  interactive: boolean;
}

export function WorldLabels() {
  const runtime = useGame((s) => s.runtime);
  const mode = useGame((s) => s.mode);
  const creations = useGame((s) => s.world?.creations);
  const easels = useGame((s) => s.world?.easels);
  const riding = useGame((s) => s.riding);
  const els = useRef(new Map<string, HTMLElement>());
  const slots = useRef(new Map<string, Slot>());
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const upd = () => setReduced(mq.matches || useGame.getState().prefs.reducedMotion);
    upd();
    mq.addEventListener("change", upd);
    const unsub = useGame.subscribe((s, p) => s.prefs.reducedMotion !== p.prefs.reducedMotion && upd());
    return () => {
      mq.removeEventListener("change", upd);
      unsub();
    };
  }, []);

  const items = useMemo<LabelItem[]>(() => {
    const out: LabelItem[] = REGIONS.map((r, i) => ({ key: `r:${r.id}`, kind: "region", text: r.name, emoji: r.emoji, id: String(i) }));
    if (mode === "gallery") {
      for (const e of easels ?? []) out.push({ key: `e:${e.id}`, kind: "thing", text: e.title || "My picture", emoji: "🖼️", id: e.id, artworkId: e.artworkId });
    } else {
      for (const c of creations ?? []) out.push({ key: `c:${c.id}`, kind: "thing", text: c.name, emoji: getKind(c.kind).emoji, id: c.id, artworkId: c.artworkId });
    }
    out.push({ key: "you", kind: "you", text: "You", emoji: "⭐", id: "you" });
    return out;
  }, [mode, creations, easels]);

  // Region anchors: a little above the ground at each region's centre.
  const regionAnchors = useMemo(() => {
    if (!runtime) return [];
    return REGIONS.map((r) => r.center.clone().multiplyScalar(Math.max(runtime.terrain.heightAt(r.center), PLANET_RADIUS) + 0.8));
  }, [runtime]);

  useEffect(() => {
    if (!runtime) return;
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const cam = view.camera;
      const W = view.width || window.innerWidth;
      const H = view.height || window.innerHeight;
      const show = cam && !riding ? planetViewFade(camera.blend) : 0;
      let camDist = 1;
      if (cam) {
        camDist = cam.position.length();
        _camDir.copy(cam.position).normalize();
      }
      const k = reduced ? 1 : Math.min(1, dt * 7);
      // Pass 1: where each label wants to be, and how visible.
      const live: Array<{ it: LabelItem; el: HTMLElement; slot: Slot; target: number; x: number; y: number; facing: number; rank: number }> = [];
      for (const it of items) {
        const el = els.current.get(it.key);
        if (!el) continue;
        let slot = slots.current.get(it.key);
        if (!slot) {
          slot = { op: 0, halfW: 0, h: 0, x: -999, y: -999, z: -1, interactive: false };
          slots.current.set(it.key, slot);
        }
        let target = 0;
        let x = slot.x, y = slot.y, facing = 0;
        if (show > 0.001 && cam) {
          let ok = true;
          if (it.kind === "region") _v.copy(regionAnchors[Number(it.id)]);
          else if (it.kind === "you") _v.copy(runtime.player.pos).addScaledVector(runtime.player.n, 1.9);
          else {
            const agent = runtime.creations.get(it.id);
            const easel = runtime.easels.get(it.id);
            if (agent) _v.copy(agent.pos).addScaledVector(agent.n, agent.size * 0.9 + 0.5);
            else if (easel) _v.copy(easel.n).multiplyScalar(runtime.terrain.heightAt(easel.n) + 2.6);
            else ok = false;
            if (agent?.hidden) ok = false;
          }
          if (ok) {
            _n.copy(_v).normalize();
            facing = _n.dot(_camDir);
            const vis = labelFacingFade(facing, camDist);
            if (vis > 0.001) {
              _v.project(cam);
              if (_v.z < 1) {
                x = (_v.x * 0.5 + 0.5) * W;
                y = (-_v.y * 0.5 + 0.5) * H;
                if (slot.halfW === 0 || slot.h === 0) {
                  slot.halfW = el.offsetWidth / 2;
                  slot.h = el.offsetHeight;
                }
                // Off to the side (narrow phone screens): fade out, don't pile up at the edge.
                const over = Math.max(-x, x - W, 0);
                const edge = 1 - smooth(0, 60, over);
                x = Math.min(W - slot.halfW - 6, Math.max(slot.halfW + 6, x));
                y = Math.min(H - 8, Math.max(slot.h + 6, y));
                target = vis * edge * show;
              }
            }
          }
        }
        const rank = it.kind === "you" ? 10 : facing + (it.kind === "region" ? 0.15 : 0) + (slot.op > 0.5 ? 0.2 : 0);
        live.push({ it, el, slot, target, x, y, facing, rank });
      }
      // Pass 2: declutter — a label that would mostly cover a more important one waits its turn.
      const placed: Array<[number, number, number, number]> = [];
      live
        .filter((l) => l.target > 0.05)
        .sort((a, b) => b.rank - a.rank)
        .forEach((l) => {
          const x0 = l.x - l.slot.halfW, x1 = l.x + l.slot.halfW, y0 = l.y - l.slot.h, y1 = l.y;
          for (const [a0, b0, a1, b1] of placed) {
            const ix = Math.min(x1, a1) - Math.max(x0, a0);
            const iy = Math.min(y1, b1) - Math.max(y0, b0);
            if (ix > 0 && iy > 0 && ix * iy > 0.22 * Math.min((x1 - x0) * (y1 - y0), (a1 - a0) * (b1 - b0))) {
              l.target = 0;
              return;
            }
          }
          placed.push([x0, y0, x1, y1]);
        });
      // Pass 3: ease and write styles.
      for (const { it, el, slot, target, x, y, facing } of live) {
        slot.op += (target - slot.op) * k;
        if (target === 0 && slot.op < 0.02) slot.op = 0;
        const op = slot.op;
        if (op <= 0) {
          if (el.style.visibility !== "hidden") el.style.visibility = "hidden";
          if (slot.interactive) {
            slot.interactive = false;
            el.style.pointerEvents = "none";
          }
          continue;
        }
        if (el.style.visibility !== "visible") el.style.visibility = "visible";
        if (Math.abs(x - slot.x) > 0.25 || Math.abs(y - slot.y) > 0.25) {
          slot.x = x;
          slot.y = y;
          el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -100%) scale(${(0.86 + 0.14 * op).toFixed(3)})`;
        }
        el.style.opacity = op.toFixed(3);
        const z = it.kind === "you" ? 300 : Math.round(facing * 100) + (it.kind === "thing" ? 100 : 0);
        if (z !== slot.z) {
          slot.z = z;
          el.style.zIndex = String(z);
        }
        const interactive = op > 0.5;
        if (interactive !== slot.interactive) {
          slot.interactive = interactive;
          el.style.pointerEvents = interactive ? "auto" : "none";
        }
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [runtime, items, regionAnchors, reduced, riding]);

  // Re-measure when the text changes (renamed creations).
  useEffect(() => {
    slots.current.forEach((s) => {
      s.halfW = 0;
      s.h = 0;
    });
  }, [items]);

  if (!runtime) return null;

  const go = (it: LabelItem) => {
    playSfx("whoosh");
    if (it.kind === "you") {
      setCameraMode("explore");
    } else if (it.kind === "region") {
      const c = REGIONS[Number(it.id)].center;
      const spot = runtime.findLandNear(c, 0.35) ?? c;
      travelNear(spot.clone(), { standOff: 1.5 });
    } else {
      travelTo(it.id);
    }
  };

  return (
    <div className="world-labels" aria-label="Places on the planet">
      {items.map((it) => (
        <Label
          key={it.key}
          item={it}
          onGo={go}
          setRef={(el) => {
            if (el) els.current.set(it.key, el);
            else {
              els.current.delete(it.key);
              slots.current.delete(it.key);
            }
          }}
        />
      ))}
    </div>
  );
}

const Label = memo(function Label({ item, onGo, setRef }: { item: LabelItem; onGo: (it: LabelItem) => void; setRef: (el: HTMLElement | null) => void }) {
  const title = item.kind === "you" ? "Go back to you" : item.kind === "region" ? `Go to ${item.text}` : `Visit ${item.text}`;
  return (
    <button ref={setRef} type="button" className={`wl-pill wl-${item.kind}`} style={{ visibility: "hidden", opacity: 0, pointerEvents: "none" }} onClick={() => onGo(item)} aria-label={title} title={title} tabIndex={-1}>
      {item.kind === "thing" && item.artworkId ? <Thumb artworkId={item.artworkId} emoji={item.emoji} /> : <span className="wl-emoji" aria-hidden>{item.emoji}</span>}
      <span className="wl-text">{item.text}</span>
    </button>
  );
});

function Thumb({ artworkId, emoji }: { artworkId: string; emoji: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    getArtworkUrls(artworkId)
      .then((u) => alive && u && setUrl(u.cutoutUrl))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [artworkId]);
  return url ? <img className="wl-thumb" src={url} alt="" draggable={false} /> : <span className="wl-emoji" aria-hidden>{emoji}</span>;
}

export default WorldLabels;
