"use client";
// Real picture uploads: file picker or drag-and-drop, honest background
// removal, and a correction flow (crop, strength, keep/erase brush, or keep
// the whole picture) when the automatic cut-out isn't confident.

import { useCallback, useEffect, useRef, useState } from "react";
import { Modal } from "./Modal";
import { UploadIcon, CropIcon, BrushIcon, EraserIcon, CheckIcon, ArrowLeftIcon } from "./Icons";
import { openUpload, DEFAULT_UPLOAD_SETTINGS, type UploadSession, type UploadSettings, type UploadAnalysis, type ProcessedArtwork } from "@/drawing/client";
import { LOW_CONFIDENCE } from "@/drawing/process";
import { commitArtwork } from "./artworkFlow";
import { useGame } from "@/state/store";
import { playSfx } from "@/audio/sfx";
import { safeCapture } from "./pointer";

/** A file dropped onto the game window, waiting for the upload panel. */
let droppedFile: File | null = null;
export function setDroppedFile(f: File | null) {
  droppedFile = f;
}

type Stage = "pick" | "loading" | "review" | "fix";
type Tool = "crop" | "keep" | "remove";

const ISSUE_TEXT: Record<string, string> = {
  "busy-background": "The background is busy, so it's hard to tell where the drawing ends.",
  "too-little-foreground": "I can hardly find the drawing. Try cropping closer or lowering the strength.",
  "too-much-foreground": "Most of the picture looks like drawing. Try a stronger setting or crop closer.",
  "many-pieces": "The drawing came out in lots of little pieces.",
  "touches-edges": "The drawing touches the edge — crop a little wider if bits are cut off.",
};

interface RunResult {
  analysis: UploadAnalysis;
  artwork: ProcessedArtwork | null;
  maskPreviewUrl: string;
}

export function UploadPanel() {
  const { openPanel, setPending, mode } = useGame.getState();
  const [stage, setStage] = useState<Stage>("pick");
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [session, setSession] = useState<UploadSession | null>(null);
  const [settings, setSettings] = useState<UploadSettings>(mode === "gallery" ? { ...DEFAULT_UPLOAD_SETTINGS, mode: "whole" } : DEFAULT_UPLOAD_SETTINGS);
  const [result, setResult] = useState<RunResult | null>(null);
  const [running, setRunning] = useState(false);
  const [tool, setTool] = useState<Tool>("crop");
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const keepMask = useRef<Uint8Array | null>(null);
  const removeMask = useRef<Uint8Array | null>(null);
  const [paintVersion, setPaintVersion] = useState(0);
  const runId = useRef(0);

  const cleanupResult = (r: RunResult | null) => {
    if (!r) return;
    URL.revokeObjectURL(r.maskPreviewUrl);
    if (r.artwork) {
      URL.revokeObjectURL(r.artwork.cutoutUrl);
      URL.revokeObjectURL(r.artwork.originalUrl);
    }
  };

  const run = useCallback(
    async (s: UploadSettings, sess: UploadSession) => {
      const id = ++runId.current;
      setRunning(true);
      try {
        const full = buildPaint(s, sess);
        const r = await sess.run({ ...s, paint: full });
        if (id !== runId.current) {
          cleanupResult(r);
          return null;
        }
        setResult((prev) => {
          cleanupResult(prev);
          return r;
        });
        return r;
      } catch (e) {
        if (id === runId.current) setError((e as Error).message || "That picture didn't work. Try another one.");
        return null;
      } finally {
        if (id === runId.current) setRunning(false);
      }
    },
    [],
  );

  /** Cut the full-image paint masks down to the crop. */
  function buildPaint(s: UploadSettings, sess: UploadSession): UploadSettings["paint"] {
    const W = sess.image.width, H = sess.image.height;
    if (!keepMask.current && !removeMask.current) return undefined;
    const c = s.crop ?? { x: 0, y: 0, w: W, h: H };
    const cx = Math.max(0, Math.round(c.x)), cy = Math.max(0, Math.round(c.y));
    const cw = Math.max(1, Math.min(W - cx, Math.round(c.w))), ch = Math.max(1, Math.min(H - cy, Math.round(c.h)));
    const cut = (m: Uint8Array | null) => {
      if (!m) return null;
      const out = new Uint8Array(cw * ch);
      for (let y = 0; y < ch; y++) out.set(m.subarray((cy + y) * W + cx, (cy + y) * W + cx + cw), y * cw);
      return out;
    };
    return { keep: cut(keepMask.current), remove: cut(removeMask.current), width: cw, height: ch };
  }

  const openFile = async (file: File | Blob) => {
    setError(null);
    setStage("loading");
    playSfx("rustle");
    try {
      const sess = await openUpload(file);
      setSession(sess);
      keepMask.current = null;
      removeMask.current = null;
      const r = await run(settings, sess);
      if (!r) {
        setStage("fix");
        return;
      }
      // Confident results get a quick "looks good?" check; others go straight to fixing.
      setStage(r.artwork && r.analysis.confidence >= LOW_CONFIDENCE ? "review" : "fix");
    } catch (e) {
      setError((e as Error).message || "That file doesn't look like a picture.");
      setStage("pick");
      playSfx("error");
    }
  };

  useEffect(() => {
    if (droppedFile) {
      const f = droppedFile;
      droppedFile = null;
      void openFile(f);
    }
    return () => {
      setResult((prev) => {
        cleanupResult(prev);
        return null;
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => {
    if (session) URL.revokeObjectURL(session.previewUrl);
  }, [session]);

  // Re-run (debounced) when settings or paint change in the fix stage.
  const firstFix = useRef(true);
  useEffect(() => {
    if (stage !== "fix" || !session) return;
    if (firstFix.current) {
      firstFix.current = false;
      return;
    }
    const t = setTimeout(() => void run(settings, session), 320);
    return () => clearTimeout(t);
  }, [settings, paintVersion, stage, session, run]);

  const useIt = async () => {
    if (!result?.artwork) return;
    setSaving(true);
    try {
      const art = result.artwork;
      // Ownership of the artwork URLs passes to commitArtwork.
      setResult({ ...result, artwork: null });
      const pending = await commitArtwork(art, "upload");
      setPending(pending);
      playSfx("chime");
      openPanel(mode === "gallery" ? "easelForm" : "life");
    } catch (e) {
      setError((e as Error).message || "Couldn't save the picture.");
      setSaving(false);
    }
  };

  const issues = result?.analysis.issues ?? [];
  const confident = !!result?.artwork && (result?.analysis.confidence ?? 0) >= LOW_CONFIDENCE;

  return (
    <Modal
      title={stage === "fix" ? "Let's fix the cut-out" : "Add a picture"}
      onClose={() => openPanel(null)}
      size="wide"
      footer={
        stage === "review" ? (
          <>
            <button className="btn paper-btn" onClick={() => setStage("fix")}>
              <CropIcon /> Fix it
            </button>
            <span className="spacer" />
            <button className="btn green big" onClick={useIt} disabled={saving}>
              {saving ? <span className="spinner-small" /> : <CheckIcon />} Use it!
            </button>
          </>
        ) : stage === "fix" ? (
          <>
            <button className="btn paper-btn" onClick={() => setStage("pick")}>
              <ArrowLeftIcon /> Another picture
            </button>
            <span className="spacer" />
            <button className="btn green big" onClick={useIt} disabled={saving || running || !result?.artwork}>
              {saving || running ? <span className="spinner-small" /> : <CheckIcon />} Use it!
            </button>
          </>
        ) : undefined
      }
    >
      <input
        ref={fileInput}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/bmp"
        className="visually-hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void openFile(f);
        }}
      />
      {error && <p style={{ color: "#b8322a", fontWeight: 700, marginTop: 0 }}>{error}</p>}

      {stage === "pick" && (
        <div
          className={`drop-zone ${over ? "over" : ""}`}
          onClick={() => fileInput.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) void openFile(f);
          }}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && fileInput.current?.click()}
        >
          <UploadIcon />
          <span>Tap to choose a picture, or drop one here</span>
          <span className="small muted">
            A photo of a drawing on plain paper works best. Pictures with see-through backgrounds work too.
          </span>
        </div>
      )}

      {stage === "loading" && (
        <div className="status-line">
          <span className="spinner-small" /> Cutting out your picture…
        </div>
      )}

      {stage === "review" && result?.artwork && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
          <div className="result-preview" style={{ width: "min(100%, 420px)" }}>
            <img src={result.artwork.cutoutUrl} alt="Your cut-out picture" />
          </div>
          <p style={{ fontWeight: 700, margin: 0 }}>Here&apos;s your cut-out. Does it look right?</p>
        </div>
      )}

      {stage === "fix" && session && (
        <div className="upload-editor">
          <div>
            <div className="seg" role="radiogroup" aria-label="Tool">
              <button className={`chip-btn ${tool === "crop" ? "on" : ""}`} onClick={() => setTool("crop")}>
                <CropIcon width={20} height={20} style={{ verticalAlign: -4 }} /> Crop
              </button>
              <button className={`chip-btn ${tool === "keep" ? "on" : ""}`} onClick={() => setTool("keep")}>
                <BrushIcon width={20} height={20} style={{ verticalAlign: -4 }} /> Keep brush
              </button>
              <button className={`chip-btn ${tool === "remove" ? "on" : ""}`} onClick={() => setTool("remove")}>
                <EraserIcon width={20} height={20} style={{ verticalAlign: -4 }} /> Remove brush
              </button>
            </div>
            <CropPaintArea
              session={session}
              crop={settings.crop}
              tool={tool}
              onCrop={(crop) => setSettings((s) => ({ ...s, crop }))}
              keepMask={keepMask}
              removeMask={removeMask}
              onPainted={() => setPaintVersion((v) => v + 1)}
            />
            <p className="small muted" style={{ margin: "6px 0 0" }}>
              {tool === "crop" ? "Drag the yellow dots to crop." : tool === "keep" ? "Paint over parts that should stay." : "Paint over bits that should go."}
            </p>
          </div>
          <div>
            <div className="field">
              <label>How should I cut it out?</label>
              <div className="seg">
                {(
                  [
                    ["auto", "Automatic"],
                    ["edges", "Remove the paper"],
                    ["colour", "Remove a colour"],
                    ["whole", "Keep whole picture"],
                  ] as const
                ).map(([m, label]) => (
                  <button key={m} className={`chip-btn ${settings.mode === m ? "on" : ""}`} onClick={() => setSettings((s) => ({ ...s, mode: m }))}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {settings.mode !== "whole" && (
              <div className="field">
                <label htmlFor="strength">Background removal: {settings.tolerance}</label>
                <input
                  id="strength"
                  className="range"
                  type="range"
                  min={5}
                  max={95}
                  value={settings.tolerance}
                  onChange={(e) => setSettings((s) => ({ ...s, tolerance: Number(e.target.value) }))}
                />
                <div className="small muted" style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>gentle</span>
                  <span>strong</span>
                </div>
              </div>
            )}
            <div className="result-preview">
              {running && !result ? <span className="spinner-small" /> : result?.artwork ? <img src={result.artwork.cutoutUrl} alt="Cut-out preview" /> : <span className="muted">Nothing to cut out yet</span>}
            </div>
            {result && !confident && issues.length > 0 && (
              <ul className="issue-list">
                {issues.map((i) => (
                  <li key={i}>{ISSUE_TEXT[i] ?? i}</li>
                ))}
              </ul>
            )}
            {result && !result.artwork && <p style={{ fontWeight: 700 }}>I couldn&apos;t find a drawing yet — try the brushes, a gentler setting, or keep the whole picture.</p>}
          </div>
        </div>
      )}
    </Modal>
  );
}

function CropPaintArea({
  session,
  crop,
  tool,
  onCrop,
  keepMask,
  removeMask,
  onPainted,
}: {
  session: UploadSession;
  crop: UploadSettings["crop"];
  tool: Tool;
  onCrop: (c: NonNullable<UploadSettings["crop"]>) => void;
  keepMask: React.MutableRefObject<Uint8Array | null>;
  removeMask: React.MutableRefObject<Uint8Array | null>;
  onPainted: () => void;
}) {
  const W = session.image.width, H = session.image.height;
  const area = useRef<HTMLDivElement>(null);
  const paint = useRef<HTMLCanvasElement>(null);
  const c = crop ?? { x: 0, y: 0, w: W, h: H };
  const drag = useRef<{ corner: number } | null>(null);
  const painting = useRef(false);

  const toImage = (e: React.PointerEvent | PointerEvent): [number, number] => {
    const r = area.current!.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H];
  };

  const brush = Math.max(6, Math.round(Math.max(W, H) * 0.025));

  const dab = (x: number, y: number) => {
    const target = tool === "keep" ? keepMask : removeMask;
    const other = tool === "keep" ? removeMask : keepMask;
    if (!target.current) target.current = new Uint8Array(W * H);
    const r = brush;
    for (let yy = Math.max(0, Math.floor(y - r)); yy < Math.min(H, Math.ceil(y + r)); yy++) {
      for (let xx = Math.max(0, Math.floor(x - r)); xx < Math.min(W, Math.ceil(x + r)); xx++) {
        if ((xx - x) ** 2 + (yy - y) ** 2 <= r * r) {
          target.current[yy * W + xx] = 1;
          if (other.current) other.current[yy * W + xx] = 0;
        }
      }
    }
    // Show the painted area: clear what was there, then tint green (keep) or red (remove).
    const ctx = paint.current!.getContext("2d")!;
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = tool === "keep" ? "rgba(80,200,90,0.45)" : "rgba(240,70,70,0.45)";
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  };

  const onDown = (e: React.PointerEvent) => {
    e.preventDefault();
    safeCapture(area.current, e.pointerId);
    const [x, y] = toImage(e);
    if (tool === "crop") {
      const corners: Array<[number, number]> = [
        [c.x, c.y],
        [c.x + c.w, c.y],
        [c.x, c.y + c.h],
        [c.x + c.w, c.y + c.h],
      ];
      let best = 0, bd = Infinity;
      corners.forEach(([cx, cy], i) => {
        const d = Math.hypot(cx - x, cy - y);
        if (d < bd) {
          bd = d;
          best = i;
        }
      });
      drag.current = { corner: best };
    } else {
      painting.current = true;
      dab(x, y);
    }
  };

  const onMove = (e: React.PointerEvent) => {
    const [x, y] = toImage(e);
    if (drag.current) {
      const minSize = Math.max(16, Math.min(W, H) * 0.08);
      let x0 = c.x, y0 = c.y, x1 = c.x + c.w, y1 = c.y + c.h;
      const cx = Math.max(0, Math.min(W, x)), cy = Math.max(0, Math.min(H, y));
      const k = drag.current.corner;
      if (k === 0 || k === 2) x0 = Math.min(cx, x1 - minSize);
      else x1 = Math.max(cx, x0 + minSize);
      if (k === 0 || k === 1) y0 = Math.min(cy, y1 - minSize);
      else y1 = Math.max(cy, y0 + minSize);
      onCrop({ x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0) });
    } else if (painting.current) {
      dab(x, y);
    }
  };

  const onUp = () => {
    if (painting.current) onPainted();
    drag.current = null;
    painting.current = false;
  };

  const pct = (v: number, of: number) => `${(v / of) * 100}%`;

  return (
    <div className="crop-area" ref={area} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
      <img src={session.previewUrl} alt="Your picture" />
      <canvas ref={paint} className="paint-layer" width={W} height={H} />
      <div className="crop-rect" style={{ left: pct(c.x, W), top: pct(c.y, H), width: pct(c.w, W), height: pct(c.h, H) }} />
      {tool === "crop" &&
        [
          [c.x, c.y],
          [c.x + c.w, c.y],
          [c.x, c.y + c.h],
          [c.x + c.w, c.y + c.h],
        ].map(([x, y], i) => <div key={i} className="crop-handle" style={{ left: pct(x, W), top: pct(y, H) }} />)}
    </div>
  );
}
