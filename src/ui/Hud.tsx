"use client";
// On-screen controls: region name, view/collection/settings/help buttons,
// the big Draw / Add picture / Samples buttons, toasts and the joystick.

import { useEffect, useRef, useState } from "react";
import { useGame } from "@/state/store";
import { PencilIcon, UploadIcon, SampleIcon, GlobeIcon, ExploreIcon, DrawerIcon, GearIcon, HelpIcon } from "./Icons";
import { camera, onCameraMode, setCameraMode } from "@/render/cameraControl";
import { StickerBookIcon, CameraIcon, StorybookIcon } from "./GameIcons";
import { openStickerBook, openPhotoMode, openStorybook } from "@/game/state";
import { useStickerTally } from "./StickerBook";
import { playSfx } from "@/audio/sfx";

/** Play a sound by name, tolerating names other modules may add later. */
function sfx(name: Parameters<typeof playSfx>[0]) {
  playSfx(name);
}
import { safeCapture } from "./pointer";

export function Hud() {
  const mode = useGame((s) => s.mode);
  const region = useGame((s) => s.region);
  const toasts = useGame((s) => s.toasts);
  const carrying = useGame((s) => s.carrying);
  const pending = useGame((s) => s.pending);
  const panel = useGame((s) => s.panel);
  const saveError = useGame((s) => s.saveError);
  const ribbon = useGame((s) => s.ribbon);
  const tally = useStickerTally();
  const riding = useGame((s) => s.riding);
  const { openPanel, runtime } = useGame.getState();
  const [view, setView] = useState(camera.mode);
  const [toastRegion, setToastRegion] = useState<typeof region>(null);
  const firstRegion = useRef(true);

  useEffect(() => onCameraMode(setView), []);
  useEffect(() => {
    if (!region) return;
    if (firstRegion.current) {
      firstRegion.current = false;
      return;
    }
    setToastRegion(region);
    playSfx("chime", { volume: 0.5 });
  }, [region]);

  const toggleView = () => {
    playSfx("whoosh");
    const rt = useGame.getState().runtime;
    if (camera.mode === "planet") setCameraMode("explore");
    else if (rt) {
      setCameraMode("planet", rt.player.n, rt.player.camForward);
      camera.planetDistance = 62;
    }
  };

  const open = (p: Parameters<typeof openPanel>[0]) => {
    playSfx("click");
    openPanel(p);
  };

  return (
    <>
      <div className="hud-top">
        <div className="region-chip paper-sm" aria-live="polite">
          <span aria-hidden style={{ fontSize: "1.4rem" }}>
            {mode === "gallery" ? "🖼️" : "🌍"}
          </span>
          <span>
            <span className="world-name">{mode === "gallery" ? "Miniature Gallery World" : "Living Paper World"}</span>
            {region?.name ?? ""}
          </span>
        </div>
        <div className="hud-buttons">
          <button className={`icon-btn ${view === "planet" ? "active" : ""}`} onClick={toggleView} disabled={!!riding} aria-label={view === "planet" ? "Go back down" : "See the whole planet"} title={view === "planet" ? "Go back down" : "Whole planet"}>
            {view === "planet" ? <ExploreIcon /> : <GlobeIcon />}
            <span className="label">{view === "planet" ? "Explore" : "Planet"}</span>
          </button>
          <button className="icon-btn" onClick={() => open("collection")} aria-label={mode === "gallery" ? "My gallery" : "My drawings"} title={mode === "gallery" ? "My gallery" : "My drawings"}>
            <DrawerIcon />
            <span className="label">{mode === "gallery" ? "Gallery" : "Drawings"}</span>
          </button>
          <button className="icon-btn" onClick={() => { playSfx("click"); openStickerBook(); }} aria-label="Sticker book" title="Sticker book">
            <StickerBookIcon />
            {tally.earned > 0 && <span className="badge">{tally.earned}</span>}
            <span className="label">Stickers</span>
          </button>
          <button className="icon-btn" onClick={() => { playSfx("click"); openPhotoMode(); }} aria-label="Take a postcard" title="Take a postcard">
            <CameraIcon />
            <span className="label">Postcard</span>
          </button>
          <button className="icon-btn" onClick={() => { playSfx("click"); openStorybook(); }} aria-label="My storybook" title="My storybook">
            <StorybookIcon />
            <span className="label">Story</span>
          </button>
          <button className="icon-btn" onClick={() => open("settings")} aria-label="Settings" title="Settings">
            <GearIcon />
            <span className="label">Settings</span>
          </button>
          <button className="icon-btn" onClick={() => open("help")} aria-label="How to play" title="How to play">
            <HelpIcon />
            <span className="label">Help</span>
          </button>
        </div>
      </div>

      {toastRegion && (
        <div key={toastRegion.key} className="region-toast paper" onAnimationEnd={() => setToastRegion(null)}>
          {toastRegion.emoji} {toastRegion.name}
        </div>
      )}

      <div className="toasts" role="status">
        {toasts.map((t) => (
          <div key={t.id} className={`toast paper-sm ${t.tone}`}>
            {t.text}
          </div>
        ))}
      </div>

      {carrying && (
        <div className={`carry-hint paper-sm ${carrying.ok ? "" : "bad"}`}>{carrying.ok ? "Let go to put it down here" : "Not here — try another spot"}</div>
      )}

      {saveError && !panel && <div className="banner paper-sm">⚠️ {saveError}</div>}

      {pending && !panel && (
        <div className="waiting-chip">
          <button className="btn pink" onClick={() => open(mode === "gallery" ? "easelForm" : "life")}>
            <img src={pending.cutoutUrl} alt="" style={{ width: 36, height: 36, objectFit: "contain" }} /> A drawing is waiting!
          </button>
        </div>
      )}

      {riding && !panel && (
        <div className="hud-bottom">
          <button
            className="btn big orange"
            onClick={() => {
              playSfx("boing");
              useGame.getState().runtime?.endRide();
            }}
          >
            🪂 Hop off
          </button>
        </div>
      )}

      {ribbon && !panel && !riding && (
        <div className="hud-bottom">
          <button
            className="btn big red"
            onClick={() => {
              sfx("ribbon");
              setTimeout(() => sfx("cheer"), 250);
              useGame.getState().cutRibbon();
            }}
          >
            ✂️ Cut the ribbon!
          </button>
        </div>
      )}

      {!panel && !ribbon && !riding && (
        <div className="hud-bottom">
          <button className="btn big green" onClick={() => open("draw")}>
            <PencilIcon /> Draw
          </button>
          <button className="btn big blue" onClick={() => open("upload")}>
            <UploadIcon /> Add picture
          </button>
          <button className="btn big paper-btn" onClick={() => open("samples")}>
            <SampleIcon /> Samples
          </button>
        </div>
      )}

      {runtime && !panel && <Joystick />}
    </>
  );
}

/** Touch joystick (only on touch-first devices). */
function Joystick() {
  const [coarse, setCoarse] = useState(false);
  const knob = useRef<HTMLDivElement>(null);
  const active = useRef<number | null>(null);
  const center = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse)");
    setCoarse(mq.matches);
    const fn = () => setCoarse(mq.matches);
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);

  const set = (x: number, y: number) => {
    const rt = useGame.getState().runtime;
    if (rt) {
      rt.input.x = x;
      rt.input.y = y;
    }
    if (knob.current) knob.current.style.transform = `translate(${x * 34}px, ${-y * 34}px)`;
  };

  useEffect(() => () => set(0, 0), []);

  if (!coarse) return null;
  return (
    <div
      className="joystick"
      aria-label="Walk joystick"
      onPointerDown={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        center.current = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        active.current = e.pointerId;
        safeCapture(e.currentTarget, e.pointerId);
        if (camera.mode === "planet") setCameraMode("explore");
      }}
      onPointerMove={(e) => {
        if (active.current !== e.pointerId) return;
        let dx = (e.clientX - center.current.x) / 50;
        let dy = (e.clientY - center.current.y) / 50;
        const len = Math.hypot(dx, dy);
        if (len > 1) {
          dx /= len;
          dy /= len;
        }
        set(dx, -dy);
      }}
      onPointerUp={() => {
        active.current = null;
        set(0, 0);
      }}
      onPointerCancel={() => {
        active.current = null;
        set(0, 0);
      }}
    >
      <div className="knob" ref={knob} />
    </div>
  );
}
