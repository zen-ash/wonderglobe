"use client";
// The in-game drawing board: 12 crayons, 3 sizes, eraser, undo, clear.
// Strokes are kept as vectors (for undo) and painted with a crayon-grain
// pattern. The canvas stays transparent where nothing is drawn so the
// cut-out pipeline knows exactly what is ink.

import { useEffect, useRef, useState, useCallback } from "react";
import { Modal } from "./Modal";
import { UndoIcon, EraserIcon, TrashIcon, CheckIcon, PencilIcon } from "./Icons";
import { useGame } from "@/state/store";
import { processBoardCanvas } from "@/drawing/client";
import { commitArtwork, rememberPending } from "./artworkFlow";
import { playSfx } from "@/audio/sfx";
import { useGameUi, type DrawPurpose } from "@/game/state";
import { reportEvent } from "@/game/guide";
import { safeCapture } from "./pointer";

export const CRAYONS = [
  { name: "Red", color: "#e8453c" },
  { name: "Orange", color: "#ff8a2b" },
  { name: "Yellow", color: "#ffd23f" },
  { name: "Lime", color: "#8fd14f" },
  { name: "Green", color: "#2f9e44" },
  { name: "Sky", color: "#4dabf7" },
  { name: "Blue", color: "#3b5bdb" },
  { name: "Purple", color: "#8e5bd6" },
  { name: "Pink", color: "#ff7eb6" },
  { name: "Brown", color: "#8b5a2b" },
  { name: "Grey", color: "#8a8f98" },
  { name: "Black", color: "#2b2320" },
];

const SIZES = [
  { label: "Thin", px: 7 },
  { label: "Medium", px: 15 },
  { label: "Thick", px: 30 },
];

/** Paper size: landscape normally, portrait on tall phone screens. */
function boardSize(): [number, number] {
  if (typeof window !== "undefined" && window.innerHeight > window.innerWidth * 1.15) return [900, 1200];
  return [1200, 900];
}

interface Stroke {
  color: string;
  size: number;
  erase: boolean;
  points: Array<[number, number, number]>; // x, y, width factor
}

type HistoryItem = Stroke | "clear";

const patternCache = new Map<string, HTMLCanvasElement>();

/** Opaque crayon grain tile for a colour (light/dark speckles, waxy streaks). */
function crayonTile(color: string): HTMLCanvasElement {
  const hit = patternCache.get(color);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = c.height = 96;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 96, 96);
  const img = ctx.getImageData(0, 0, 96, 96);
  let seed = 1234;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < img.data.length; i += 4) {
    const y = (i / 4 / 96) | 0;
    const streak = Math.sin(y * 0.9 + rnd() * 0.6) * 0.04;
    const k = 1 + (rnd() - 0.5) * 0.16 + streak;
    img.data[i] = Math.min(255, img.data[i] * k);
    img.data[i + 1] = Math.min(255, img.data[i + 1] * k);
    img.data[i + 2] = Math.min(255, img.data[i + 2] * k);
  }
  ctx.putImageData(img, 0, 0);
  patternCache.set(color, c);
  return c;
}

function paintStroke(ctx: CanvasRenderingContext2D, s: Stroke) {
  const pts = s.points;
  if (!pts.length) return;
  ctx.save();
  ctx.globalCompositeOperation = s.erase ? "destination-out" : "source-over";
  const pat = s.erase ? "#000" : ctx.createPattern(crayonTile(s.color), "repeat")!;
  ctx.strokeStyle = pat;
  ctx.fillStyle = pat;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (pts.length === 1) {
    ctx.beginPath();
    ctx.arc(pts[0][0], pts[0][1], (s.size * pts[0][2]) / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      ctx.lineWidth = s.size * (a[2] + b[2]) * 0.5;
      ctx.beginPath();
      const prev = pts[i - 2];
      if (prev) {
        // Smooth with midpoint quadratic segments.
        const m1x = (prev[0] + a[0]) / 2, m1y = (prev[1] + a[1]) / 2;
        const m2x = (a[0] + b[0]) / 2, m2y = (a[1] + b[1]) / 2;
        ctx.moveTo(m1x, m1y);
        ctx.quadraticCurveTo(a[0], a[1], m2x, m2y);
      } else {
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      }
      ctx.stroke();
    }
    const last = pts[pts.length - 1];
    const prev = pts[pts.length - 2];
    ctx.lineWidth = s.size * last[2];
    ctx.beginPath();
    ctx.moveTo((prev[0] + last[0]) / 2, (prev[1] + last[1]) / 2);
    ctx.lineTo(last[0], last[1]);
    ctx.stroke();
  }
  ctx.restore();
}

export interface DrawingBoardProps {
  /** "creation" (default) brings the drawing to life; "player" makes it the child's own character. */
  purpose?: DrawPurpose;
  /** Optional header text, e.g. "Draw a bridge!" (quests). */
  prompt?: string | null;
}

export function DrawingBoard(props: DrawingBoardProps = {}) {
  // Read once: the purpose/prompt belong to this one drawing (the store is
  // reset when the board closes, so the next drawing is a normal one).
  const [{ purpose, prompt }] = useState<{ purpose: DrawPurpose; prompt: string | null }>(() => {
    const ui = useGameUi.getState();
    return { purpose: props.purpose ?? ui.drawPurpose, prompt: props.prompt ?? ui.drawPrompt };
  });
  useEffect(() => () => useGameUi.getState().setDraw("creation", null), []);
  const [[W, H]] = useState(boardSize);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [color, setColor] = useState(CRAYONS[0].color);
  const [size, setSize] = useState(1);
  const [erasing, setErasing] = useState(false);
  const history = useRef<HistoryItem[]>([]);
  const [, setVersion] = useState(0);
  const active = useRef<{ stroke: Stroke; pointerId: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const { openPanel, setPending, mode, toast, patchWorld } = useGame.getState();

  const ctx = () => canvasRef.current!.getContext("2d")!;

  const redraw = useCallback(() => {
    const c = ctx();
    c.clearRect(0, 0, W, H);
    // Only strokes after the last "clear" matter.
    let start = 0;
    history.current.forEach((h, i) => {
      if (h === "clear") start = i + 1;
    });
    for (let i = start; i < history.current.length; i++) paintStroke(c, history.current[i] as Stroke);
  }, [W, H]);

  const hasInk = () => {
    let start = 0;
    history.current.forEach((h, i) => {
      if (h === "clear") start = i + 1;
    });
    return history.current.slice(start).some((h) => h !== "clear" && !h.erase);
  };

  const toCanvas = (e: PointerEvent | React.PointerEvent): [number, number] => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return [((e.clientX - rect.left) / rect.width) * W, ((e.clientY - rect.top) / rect.height) * H];
  };

  const widthFactor = (e: PointerEvent | React.PointerEvent) => (e.pointerType === "pen" && e.pressure > 0 ? 0.55 + e.pressure * 0.9 : 1);

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (busy || active.current) return;
    e.preventDefault();
    safeCapture(canvasRef.current, e.pointerId);
    const [x, y] = toCanvas(e);
    const stroke: Stroke = { color, size: SIZES[size].px * (erasing ? 1.8 : 1), erase: erasing, points: [[x, y, widthFactor(e)]] };
    active.current = { stroke, pointerId: e.pointerId };
    paintStroke(ctx(), stroke);
  };

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const a = active.current;
    if (!a || a.pointerId !== e.pointerId) return;
    e.preventDefault();
    const events = typeof e.nativeEvent.getCoalescedEvents === "function" ? e.nativeEvent.getCoalescedEvents() : [e.nativeEvent];
    const c = ctx();
    for (const ev of events.length ? events : [e.nativeEvent]) {
      const [x, y] = toCanvas(ev);
      const last = a.stroke.points[a.stroke.points.length - 1];
      if (Math.hypot(x - last[0], y - last[1]) < 1.5) continue;
      a.stroke.points.push([x, y, widthFactor(ev)]);
      // Paint just the newest piece.
      const tail: Stroke = { ...a.stroke, points: a.stroke.points.slice(-3) };
      paintStroke(c, tail);
    }
  };

  const onUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const a = active.current;
    if (!a || a.pointerId !== e.pointerId) return;
    active.current = null;
    history.current.push(a.stroke);
    redraw();
    setVersion((v) => v + 1);
    setError(null);
  };

  const undo = useCallback(() => {
    if (!history.current.length) return;
    history.current.pop();
    redraw();
    setVersion((v) => v + 1);
    playSfx("rustle");
  }, [redraw]);

  const clear = () => {
    if (!hasInk()) return;
    history.current.push("clear");
    redraw();
    setVersion((v) => v + 1);
    playSfx("rustle");
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo]);

  // Stop the page from scrolling/zooming while drawing on touch screens.
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const stop = (e: TouchEvent) => e.preventDefault();
    c.addEventListener("touchstart", stop, { passive: false });
    c.addEventListener("touchmove", stop, { passive: false });
    return () => {
      c.removeEventListener("touchstart", stop);
      c.removeEventListener("touchmove", stop);
    };
  }, []);

  const finish = async () => {
    if (!hasInk()) {
      setError("Draw something first — any squiggle will do!");
      playSfx("error");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const processed = await processBoardCanvas(canvasRef.current!);
      const pending = await commitArtwork(processed, "drawing");
      if (purpose === "player") {
        // The child's own character: not a creation, so nothing is left waiting.
        rememberPending(null);
        patchWorld({ playerArtworkId: pending.artworkId });
        playSfx("chime");
        openPanel(null);
        toast("That's you! Hello!", "happy");
        reportEvent("player-drawn", { artworkId: pending.artworkId });
        return;
      }
      setPending(pending);
      playSfx("chime");
      openPanel(mode === "gallery" ? "easelForm" : "life");
    } catch (e) {
      console.warn(e);
      const msg = (e as Error).message;
      setError(msg && msg.length < 120 ? msg : "Hmm, that didn't work. Your drawing is still here — try Finish again.");
      playSfx("error");
      if ((e as Error).name === "StorageFullError") toast(msg, "warn");
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    if (hasInk() && !confirmCancel) {
      setConfirmCancel(true);
      return;
    }
    openPanel(null);
  };

  const anyHistory = history.current.length > 0;

  return (
    <Modal
      title={
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <PencilIcon width={34} height={34} /> {purpose === "player" ? "Draw yourself!" : prompt || "Draw something!"}
        </span>
      }
      size="board"
      onClose={cancel}
      closeLabel="Cancel"
      dismissOnBackdrop={false}
      footer={
        confirmCancel ? (
          <>
            <span style={{ fontWeight: 700, alignSelf: "center" }}>Throw this drawing away?</span>
            <span className="spacer" />
            <button className="btn green" onClick={() => setConfirmCancel(false)}>
              Keep drawing
            </button>
            <button className="btn red" onClick={() => openPanel(null)}>
              Throw away
            </button>
          </>
        ) : (
          <>
            {error && <span style={{ fontWeight: 700, alignSelf: "center", color: "#b8322a" }}>{error}</span>}
            <span className="spacer" />
            <button className="btn paper-btn" onClick={cancel} disabled={busy}>
              Cancel
            </button>
            <button className="btn green big" onClick={finish} disabled={busy}>
              {busy ? <span className="spinner-small" /> : <CheckIcon />}
              {busy ? "Cutting it out…" : "Finish"}
            </button>
          </>
        )
      }
    >
      {purpose === "player" && <p className="board-hint">Draw your face and your clothes!</p>}
      <div className="board-wrap">
        <div className="board-canvas-holder">
          <canvas
            ref={canvasRef}
            className="board-canvas"
            width={W}
            height={H}
            style={{ aspectRatio: `${W} / ${H}` }}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            onLostPointerCapture={onUp}
            aria-label="Drawing paper"
            role="img"
          />
        </div>
        <div className="board-tools">
          <div className="palette" role="radiogroup" aria-label="Crayon colours">
            {CRAYONS.map((c) => (
              <button
                key={c.color}
                className={`swatch ${!erasing && color === c.color ? "selected" : ""}`}
                style={{ background: c.color }}
                onClick={() => {
                  setColor(c.color);
                  setErasing(false);
                  playSfx("click", { pitch: 1.2 });
                }}
                aria-label={c.name}
                title={c.name}
                role="radio"
                aria-checked={!erasing && color === c.color}
              />
            ))}
          </div>
          <div className="tool-row" role="radiogroup" aria-label="Brush size">
            {SIZES.map((s, i) => (
              <button key={s.label} className={`tool-btn ${size === i ? "selected" : ""}`} onClick={() => setSize(i)} aria-label={s.label} title={s.label} role="radio" aria-checked={size === i}>
                <span className="size-dot" style={{ width: 6 + i * 7, height: 6 + i * 7, background: erasing ? "#bbb" : color }} />
              </button>
            ))}
          </div>
          <div className="tool-row">
            <button className={`tool-btn ${erasing ? "selected" : ""}`} onClick={() => setErasing((v) => !v)} aria-pressed={erasing} title="Eraser">
              <EraserIcon /> Eraser
            </button>
          </div>
          <div className="tool-row">
            <button className="tool-btn" onClick={undo} disabled={!anyHistory} title="Undo">
              <UndoIcon /> Undo
            </button>
            <button className="tool-btn" onClick={clear} title="Clear">
              <TrashIcon /> Clear
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
