"use client";
// Screen-level paper feel: a fixed film-grain layer (SVG turbulence, blended
// as an overlay, jittering at ~8 fps in CSS) and a soft vignette that warms at
// dusk and deepens at night. No per-frame JavaScript: the time-of-day tint is
// a data attribute updated by a slow timer, and the layers cross-fade in CSS.
//
// Mounted once from app/layout.tsx (outside the app root, above everything,
// ignoring the pointer). It only imports SSR-safe modules.

import { useEffect, useRef } from "react";
import { environment } from "@/world/environment";
import { view } from "@/render/viewState";

export type VignetteTone = "day" | "dusk" | "night";

/** Which vignette tint fits the current light (pure, for tests). */
export function vignetteTone(daylight: number, dusk: number): VignetteTone {
  if (daylight < 0.35) return "night";
  if (dusk > 0.35 && daylight < 0.9) return "dusk";
  return "day";
}

export function ScreenFX() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const apply = () => {
      // A world is running while the 3D view shares its camera.
      const world = !!view.camera;
      const tone = world ? vignetteTone(environment.daylight, environment.dusk) : "day";
      if (el.dataset.tone !== tone) el.dataset.tone = tone;
      const calm = world && environment.reducedMotion ? "1" : "0";
      if (el.dataset.calm !== calm) el.dataset.calm = calm;
    };
    apply();
    const id = window.setInterval(apply, 1500);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div ref={ref} className="screen-fx" data-tone="day" data-calm="0" aria-hidden>
      <div className="screen-fx-vignette v-day" />
      <div className="screen-fx-vignette v-dusk" />
      <div className="screen-fx-vignette v-night" />
      <div className="screen-fx-grain" />
    </div>
  );
}

export default ScreenFX;
