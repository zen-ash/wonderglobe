"use client";
// "Bring it to life": show the original drawing, reveal the real cut-out
// boundary, find out what it is (picture helper when available, otherwise —
// or whenever unsure — ask the child), then send it into the world.

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Modal } from "./Modal";
import { CheckIcon, ArrowLeftIcon, ArrowRightIcon, SparkleIcon } from "./Icons";
import { useGame, newId, type PendingArtwork } from "@/state/store";
import type { Behavior, CreationRecord, Facing } from "@/core/types";
import { KINDS, KIND_GROUPS, BEHAVIOR_CHOICES, getKind, sizeFor } from "@/core/kinds";
import { recognizeDrawing, type RecognitionOutcome } from "@/ai/services";
import { suggestName } from "@/ai/names";
import { rememberPending } from "./artworkFlow";
import { travelNear, distanceFromPlayer } from "./travel";
import { toVec3 } from "@/world/sphere";
import { focusCamera, setCameraMode, showcaseAt } from "@/render/cameraControl";

const reducedMotionNow = () => useGame.getState().prefs.reducedMotion;
import { playSfx } from "@/audio/sfx";

type Stage = "reveal" | "confirm" | "ask" | "details";

interface Choice {
  kind: string;
  behavior: Behavior;
  facing: Facing;
  name: string;
  classifiedBy: "ai" | "player";
}

const MOVING = new Set<Behavior>(["walk", "hop", "fly", "flutter", "swim", "float", "drive", "hover"]);

export function LifePanel() {
  const pending = useGame((s) => s.pending);
  const services = useGame((s) => s.services);
  const { openPanel } = useGame.getState();
  if (!pending) return null;
  return <LifeFlow key={pending.artworkId} pending={pending} recognitionOn={services.recognition} onClose={() => openPanel(null)} />;
}

function LifeFlow({ pending, recognitionOn, onClose }: { pending: PendingArtwork; recognitionOn: boolean; onClose: () => void }) {
  const [stage, setStage] = useState<Stage>("reveal");
  const [revealed, setRevealed] = useState(false);
  const [outcome, setOutcome] = useState<RecognitionOutcome | null>(null);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [group, setGroup] = useState(KIND_GROUPS[0].id);
  const reduced = useGame((s) => s.prefs.reducedMotion);

  // Start recognition right away (in parallel with the reveal animation).
  useEffect(() => {
    if (!recognitionOn) return;
    const ctrl = new AbortController();
    (async () => {
      try {
        const blob = await fetch(pending.cutoutUrl).then((r) => r.blob());
        const out = await recognizeDrawing(blob, ctrl.signal);
        if (!ctrl.signal.aborted) setOutcome(out);
      } catch {
        if (!ctrl.signal.aborted) setOutcome({ status: "failed" });
      }
    })();
    return () => ctrl.abort();
  }, [pending, recognitionOn]);

  // The reveal "show" (see <Reveal/>) calls back when the cut-out has popped.
  const onRevealDone = useCallback(() => setRevealed(true), []);

  // Decide what happens once the reveal is done and the helper has answered.
  const waiting = recognitionOn && !outcome;
  useEffect(() => {
    if (stage !== "reveal" || !revealed || waiting) return;
    const t = setTimeout(() => {
      if (outcome?.status === "ok" && !outcome.uncertain) {
        const r = outcome.result;
        setChoice({ kind: r.kind, behavior: r.behavior, facing: getKind(r.kind).hasFacing || MOVING.has(r.behavior) ? r.facing : "none", name: r.name, classifiedBy: "ai" });
        setStage("confirm");
      } else if (pending.suggestedKind && !(outcome?.status === "ok")) {
        const k = getKind(pending.suggestedKind);
        setChoice({ kind: k.id, behavior: k.behavior, facing: k.hasFacing ? "right" : "none", name: suggestName(k.id, pending.artworkId), classifiedBy: "player" });
        setStage("confirm");
      } else {
        if (outcome?.status === "ok") {
          const g = KIND_GROUPS.find((g) => g.kinds.includes(outcome.result.kind));
          if (g) setGroup(g.id);
        }
        setStage("ask");
      }
      playSfx("pop");
    }, outcome?.status === "ok" && !outcome.uncertain && !reduced ? 1000 : 400);
    return () => clearTimeout(t);
  }, [stage, revealed, waiting, outcome, pending, reduced]);

  const guess = outcome?.status === "ok" ? outcome.result : null;

  const pickKind = (kindId: string) => {
    const k = getKind(kindId);
    const fromGuess = guess && guess.kind === kindId;
    setChoice({
      kind: k.id,
      behavior: fromGuess ? guess.behavior : k.behavior,
      facing: fromGuess ? guess.facing : k.hasFacing ? "right" : "none",
      name: fromGuess ? guess.name : suggestName(k.id, pending.artworkId),
      classifiedBy: "player",
    });
    playSfx("click");
    setStage("details");
  };

  const bringToLife = () => {
    if (!choice) return;
    const { runtime, addCreation, setPending, toast, openPanel } = useGame.getState();
    if (!runtime) return;
    const size = sizeFor(choice.kind);
    const spot = runtime.spawnPointFor(choice.behavior, size, choice.kind);
    const heading = runtime.spawnHeadingFor(choice.kind, spot, choice.behavior);
    const record: CreationRecord = {
      id: newId("c"),
      artworkId: pending.artworkId,
      kind: choice.kind,
      name: choice.name.trim().slice(0, 40) || getKind(choice.kind).label,
      behavior: choice.behavior,
      facing: MOVING.has(choice.behavior) ? choice.facing : "none",
      classifiedBy: choice.classifiedBy,
      position: toVec3(spot),
      heading: toVec3(heading),
      createdAt: Date.now(),
      chat: [],
    };
    // Far-away homes (a pond for a fish): hop over there to watch it arrive.
    if (distanceFromPlayer(spot) > 9) travelNear(spot, { standOff: choice.behavior === "swim" || choice.behavior === "float" ? 5 : 4.2 });
    addCreation(record);
    setCameraMode("explore");
    const h = runtime.terrain.heightAt(spot);
    focusCamera(spot.clone().multiplyScalar(h + 1), 3.5, performance.now() / 1000);
    // After it lands, the camera circles slowly around the new arrival.
    setTimeout(() => showcaseAt(spot.clone().multiplyScalar(h), reducedMotionNow() ? 2.5 : 5, reducedMotionNow() ? 0.4 : 1.8), 1300);
    rememberPending(null);
    setPending(null);
    openPanel(null);
    playSfx("whoosh");
    const region = runtime.regionNameAt(spot);
    toast(`${record.name} ${verbFor(record.behavior)} in ${region}!`, "happy");
    // Its voice plays when it touches down (see the store's "arrived" listener).
  };

  const k = choice ? getKind(choice.kind) : null;
  const imaginary = !!k && (k.category === "imaginary" || k.id === "sculpture" || k.category === "thing");

  return (
    <Modal
      title={stage === "ask" ? "What did you draw?" : stage === "details" ? "Almost ready!" : stage === "confirm" ? "Look what you made!" : "Cutting it out…"}
      onClose={onClose}
      closeLabel="Not now"
      dismissOnBackdrop={false}
      footer={
        stage === "confirm" ? (
          <>
            <button className="btn paper-btn" onClick={() => setStage("ask")}>
              No, it&apos;s something else
            </button>
            <span className="spacer" />
            <button className="btn green big" onClick={bringToLife}>
              <SparkleIcon /> Bring it to life!
            </button>
          </>
        ) : stage === "details" ? (
          <>
            <button className="btn paper-btn" onClick={() => setStage("ask")}>
              <ArrowLeftIcon /> Back
            </button>
            <span className="spacer" />
            <button className="btn green big" onClick={bringToLife}>
              <SparkleIcon /> Bring it to life!
            </button>
          </>
        ) : undefined
      }
    >
      {stage === "reveal" && (
        <Reveal
          pending={pending}
          reduced={reduced}
          status={waiting ? "looking" : null}
          found={outcome?.status === "ok" && !outcome.uncertain ? getKind(outcome.result.kind).label.toLowerCase() : null}
          onDone={onRevealDone}
        />
      )}

      {stage === "confirm" && choice && k && (
        <div>
          <div className="confirm-card">
            <img className="preview" src={pending.cutoutUrl} alt="Your cut-out" />
            <div style={{ flex: 1, minWidth: 220 }}>
              {choice.classifiedBy === "ai" ? (
                <p className="big-guess" style={{ margin: "0 0 4px" }}>
                  It looks like a {k.label.toLowerCase()}! {k.emoji}
                </p>
              ) : (
                <p className="big-guess" style={{ margin: "0 0 4px" }}>
                  This {pending.sampleLabel ? "sample" : "drawing"} is a {k.label.toLowerCase()}! {k.emoji}
                </p>
              )}
              <p className="muted" style={{ margin: "0 0 10px", fontWeight: 600 }}>
                {choice.classifiedBy === "ai" ? (
                  <>
                    <span className="tag ai">Picture helper</span> guessed this. Not right? Tap “something else”.
                  </>
                ) : (
                  <span className="tag sample">{pending.sampleLabel}</span>
                )}
              </p>
              <NameField choice={choice} setChoice={setChoice} />
              <p style={{ margin: "6px 0 0", fontWeight: 700 }}>
                It will <BehaviorWord b={choice.behavior} />.
              </p>
            </div>
          </div>
          {MOVING.has(choice.behavior) && <FacingPicker pending={pending} choice={choice} setChoice={setChoice} />}
        </div>
      )}

      {stage === "ask" && (
        <div>
          <p className="muted" style={{ margin: "0 0 10px", fontWeight: 600 }}>
            {outcome?.status === "ok" && outcome.uncertain
              ? `I'm not sure — maybe a ${getKind(outcome.result.kind).label.toLowerCase()}? Pick what it really is.`
              : outcome?.status === "timeout" || outcome?.status === "failed"
                ? "I couldn't tell this time. Can you help me? Your drawing is safe."
                : "Pick what it is, and I'll make it move the right way."}
          </p>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
            <img src={pending.cutoutUrl} alt="Your cut-out" style={{ width: 110, height: 110, objectFit: "contain" }} />
            <div style={{ flex: 1, minWidth: 240 }}>
              <div className="kind-tabs" role="tablist">
                {KIND_GROUPS.map((g) => (
                  <button key={g.id} className={`chip-btn ${group === g.id ? "on" : ""}`} onClick={() => setGroup(g.id)} role="tab" aria-selected={group === g.id}>
                    {g.label}
                  </button>
                ))}
              </div>
              <div className="kind-grid">
                {(KIND_GROUPS.find((g) => g.id === group)?.kinds ?? []).map((id) => {
                  const kk = KINDS.find((x) => x.id === id)!;
                  return (
                    <button key={id} className={`kind-btn ${guess?.kind === id ? "suggested" : ""}`} onClick={() => pickKind(id)}>
                      <span className="emoji" aria-hidden>
                        {kk.emoji}
                      </span>
                      {kk.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {stage === "details" && choice && k && (
        <div>
          <div className="confirm-card" style={{ marginBottom: 10 }}>
            <img className="preview" src={pending.cutoutUrl} alt="Your cut-out" style={{ width: 120, height: 120 }} />
            <div style={{ flex: 1, minWidth: 220 }}>
              <p className="big-guess" style={{ margin: "0 0 8px" }}>
                {k.emoji} {k.label}
              </p>
              <NameField choice={choice} setChoice={setChoice} />
            </div>
          </div>
          {imaginary && (
            <div className="field">
              <label>How does it move?</label>
              <div className="kind-grid">
                {BEHAVIOR_CHOICES.map((b) => (
                  <button
                    key={b.behavior}
                    className={`kind-btn ${choice.behavior === b.behavior ? "selected" : ""}`}
                    onClick={() => setChoice({ ...choice, behavior: b.behavior, facing: choice.facing === "none" && MOVING.has(b.behavior) ? "right" : choice.facing })}
                    aria-pressed={choice.behavior === b.behavior}
                  >
                    <span className="emoji" aria-hidden>
                      {b.emoji}
                    </span>
                    {b.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {!imaginary && (
            <p style={{ fontWeight: 700, margin: "0 0 8px" }}>
              It will <BehaviorWord b={choice.behavior} />.
            </p>
          )}
          {MOVING.has(choice.behavior) && <FacingPicker pending={pending} choice={choice} setChoice={setChoice} />}
        </div>
      )}
    </Modal>
  );
}

function verbFor(b: Behavior): string {
  switch (b) {
    case "swim":
      return "is swimming";
    case "fly":
      return "is flying";
    case "flutter":
      return "is fluttering";
    case "float":
      return "is floating";
    case "drive":
      return "is driving";
    case "grow":
      return "is growing";
    case "build":
      return "was built";
    case "hover":
      return "is drifting";
    case "hop":
      return "is hopping";
    case "still":
      return "is standing";
    default:
      return "is walking";
  }
}

function BehaviorWord({ b }: { b: Behavior }) {
  const words: Record<Behavior, string> = {
    walk: "walk around 🚶",
    hop: "hop about 🐇",
    fly: "fly in the sky 🕊️",
    flutter: "flutter around 🦋",
    swim: "swim in the water 🐠",
    float: "float on the water 🛟",
    drive: "drive around 🛞",
    grow: "grow in the ground 🌱",
    build: "become a little paper building 🏠",
    hover: "drift in the air 🎈",
    still: "stand proudly 🗿",
  };
  return <>{words[b]}</>;
}

function NameField({ choice, setChoice }: { choice: Choice; setChoice: (c: Choice) => void }) {
  return (
    <div className="field" style={{ marginBottom: 0 }}>
      <label htmlFor="creation-name">Name</label>
      <input
        id="creation-name"
        className="name-input"
        value={choice.name}
        maxLength={40}
        onChange={(e) => setChoice({ ...choice, name: e.target.value })}
        placeholder="Give it a name"
        autoComplete="off"
      />
    </div>
  );
}

function FacingPicker({ pending, choice, setChoice }: { pending: PendingArtwork; choice: Choice; setChoice: (c: Choice) => void }) {
  return (
    <div className="field" style={{ marginTop: 10 }}>
      <label>Which way is it looking?</label>
      <div className="facing-row">
        {(
          [
            ["left", "Left", <ArrowLeftIcon key="l" width={22} height={22} />],
            ["none", "At me", <span key="m">🙂</span>],
            ["right", "Right", <ArrowRightIcon key="r" width={22} height={22} />],
          ] as const
        ).map(([f, label, icon]) => (
          <button key={f} className={`facing-btn ${choice.facing === f ? "selected" : ""}`} style={choice.facing === f ? { background: "var(--yellow)" } : undefined} onClick={() => setChoice({ ...choice, facing: f })} aria-pressed={choice.facing === f}>
            <img src={pending.cutoutUrl} alt="" />
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              {f === "left" && icon} {label} {f !== "left" && icon}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- the reveal show

type ShowPhase = "original" | "scan" | "cut" | "pop";

/** Timeline (ms) of the cut-out show; about three seconds in all. */
export const REVEAL_TIMING = { scanAt: 250, cutAt: 1000, cutMs: 1500, popMs: 600 } as const;

/**
 * Where the scissors are along the cut line: which polygon, and how far along
 * it, for an overall 0..1 progress (time is shared by length, so the scissors
 * move at an even pace across every piece).
 */
export function cutProgress(lengths: number[], progress: number): { index: number; along: number; drawn: number[] } {
  const total = lengths.reduce((a, b) => a + b, 0);
  let s = Math.min(1, Math.max(0, progress)) * total;
  const drawn = lengths.map((len) => {
    const d = Math.min(len, Math.max(0, s));
    s -= len;
    return d;
  });
  let index = drawn.findIndex((d, i) => d < lengths[i]);
  if (index < 0) index = lengths.length - 1;
  return { index, along: drawn[index] ?? 0, drawn };
}

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const anArticle = (word: string) => (/^[aeiou]/i.test(word) ? "an" : "a");

const CONFETTI = Array.from({ length: 16 }, (_, i) => {
  const a = (i / 16) * Math.PI * 2 + (i % 3) * 0.2;
  const d = 120 + (i % 4) * 26;
  return { dx: Math.cos(a) * d, dy: Math.sin(a) * d * 0.85 - 40, rot: (i % 2 ? 1 : -1) * (90 + i * 23), color: ["#ffd447", "#ff8fc2", "#6aa8ff", "#7fcf63", "#ff9f5a", "#b48cff"][i % 6], delay: (i % 5) * 0.03 };
});

const SPARKLES = [
  [16, 22, 0],
  [78, 16, 0.18],
  [86, 64, 0.32],
  [24, 76, 0.1],
  [52, 10, 0.42],
  [60, 86, 0.25],
] as const;

/** Little crayon scissors (local units, pivot at 0,0, pointing along +x). */
function Scissors({ bladeA, bladeB }: { bladeA: React.Ref<SVGGElement>; bladeB: React.Ref<SVGGElement> }) {
  const ink = { stroke: "#2b2320", strokeWidth: 3, strokeLinejoin: "round" as const, strokeLinecap: "round" as const };
  return (
    <>
      <g ref={bladeB}>
        <path d="M-6 3 L-22 14" {...ink} strokeWidth={9} />
        <path d="M-6 3 L-22 14" stroke="#6aa8ff" strokeWidth={4.5} strokeLinecap="round" />
        <circle cx={-31} cy={19} r={12} fill="none" stroke="#2b2320" strokeWidth={12} />
        <circle cx={-31} cy={19} r={12} fill="none" stroke="#6aa8ff" strokeWidth={7} />
        <path d="M-6 1 L62 1 C67 1 67 5 62 7 L-2 13 Q-9 9 -6 1 Z" fill="#dfe7ee" {...ink} />
      </g>
      <g ref={bladeA}>
        <path d="M-6 -3 L-22 -14" {...ink} strokeWidth={9} />
        <path d="M-6 -3 L-22 -14" stroke="#ef5b5b" strokeWidth={4.5} strokeLinecap="round" />
        <circle cx={-31} cy={-19} r={12} fill="none" stroke="#2b2320" strokeWidth={12} />
        <circle cx={-31} cy={-19} r={12} fill="none" stroke="#ef5b5b" strokeWidth={7} />
        <path d="M-6 -1 L62 -1 C67 -1 67 -5 62 -7 L-2 -13 Q-9 -9 -6 -1 Z" fill="#f4f8fb" {...ink} />
        <path d="M6 -6 L48 -4" stroke="#ffffff" strokeWidth={2.4} strokeLinecap="round" opacity={0.9} />
      </g>
      <circle cx={0} cy={0} r={4.5} fill="#ffd447" {...ink} strokeWidth={2.2} />
    </>
  );
}

/**
 * The cut-out "show": the original drawing gets a gentle scan with a few
 * sparkles, then little crayon scissors snip along the real traced outline
 * (leaving the dashed cut line behind), then the paper cut-out pops out with
 * star confetti. About three seconds; tap to skip; calm motion = instant.
 */
function Reveal({ pending, reduced, status, found, onDone }: { pending: PendingArtwork; reduced: boolean; status: "looking" | null; found: string | null; onDone: () => void }) {
  const m = pending.meta;
  const [calm] = useState(() => reduced || (typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches));
  const [phase, setPhase] = useState<ShowPhase>(calm ? "pop" : "original");
  const maskId = `cut-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const maskRefs = useRef<SVGPathElement[]>([]);
  const scissorsRef = useRef<SVGGElement>(null);
  const bladeA = useRef<SVGGElement>(null);
  const bladeB = useRef<SVGGElement>(null);
  const timers = useRef<number[]>([]);
  const raf = useRef(0);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const paths = useMemo(() => m.polygons.map((poly) => "M" + poly.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join("L") + "Z"), [m]);
  const sw = Math.max(3, Math.max(m.width, m.height) / 90);
  const scissorScale = (Math.max(m.width, m.height) * 0.26) / 100;

  const clearAll = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    cancelAnimationFrame(raf.current);
  };
  const later = (fn: () => void, ms: number) => timers.current.push(window.setTimeout(fn, ms));

  const showAllCut = () => {
    maskRefs.current.forEach((p) => p && (p.style.strokeDashoffset = "0"));
  };

  const pop = (wait: number) => {
    clearAll();
    showAllCut();
    setPhase("pop");
    if (!calm) playSfx("pop");
    later(() => doneRef.current(), wait);
  };

  // The timeline.
  useEffect(() => {
    if (calm) {
      later(() => doneRef.current(), 300);
      return clearAll;
    }
    later(() => {
      setPhase("scan");
      playSfx("sparkle", { volume: 0.6 });
    }, REVEAL_TIMING.scanAt);
    later(() => setPhase("cut"), REVEAL_TIMING.cutAt);
    return clearAll;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calm]);

  // Scissors travel along the real cut line, snipping as they go.
  useEffect(() => {
    if (phase !== "cut") return;
    const els = maskRefs.current.filter(Boolean);
    const lengths = els.map((p) => {
      const len = p.getTotalLength();
      p.style.strokeDasharray = `${len + 1}`;
      p.style.strokeDashoffset = `${len + 1}`;
      return len;
    });
    if (lengths.length === 0 || lengths.every((l) => l < 1)) {
      pop(REVEAL_TIMING.popMs);
      return;
    }
    const start = performance.now();
    let lastSnip = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / REVEAL_TIMING.cutMs);
      const { index, along, drawn } = cutProgress(lengths, easeInOut(t));
      drawn.forEach((d, i) => (els[i].style.strokeDashoffset = `${lengths[i] + 1 - d}`));
      const path = els[index];
      const p = path.getPointAtLength(along);
      const q = path.getPointAtLength(Math.min(lengths[index], along + 4));
      const back = path.getPointAtLength(Math.max(0, along - 4));
      const ang = Math.atan2(q.y - back.y, q.x - back.x);
      const flip = Math.cos(ang) < 0 ? -1 : 1;
      scissorsRef.current?.setAttribute(
        "transform",
        `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)}) rotate(${((ang * 180) / Math.PI).toFixed(1)}) scale(${scissorScale.toFixed(3)} ${(scissorScale * flip).toFixed(3)}) translate(-24 0)`,
      );
      // Blades open and close about six times a second.
      const open = 4 + 20 * Math.abs(Math.sin(((now - start) / 1000) * Math.PI * 6));
      bladeA.current?.setAttribute("transform", `rotate(${-open})`);
      bladeB.current?.setAttribute("transform", `rotate(${open})`);
      if (now - lastSnip > 330) {
        lastSnip = now;
        playSfx("click", { volume: 0.4, pitch: 1.5 });
      }
      if (t < 1) raf.current = requestAnimationFrame(tick);
      else pop(REVEAL_TIMING.popMs);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Calm motion: the cut line is simply there.
  useEffect(() => {
    if (phase === "pop") showAllCut();
  }, [phase]);

  const skip = () => {
    if (phase !== "pop") pop(350);
  };

  const cutting = phase === "cut";
  return (
    <div>
      <div
        className={`reveal-stage show-${phase} ${phase === "pop" ? "done" : ""} ${calm ? "calm" : ""}`}
        onClick={skip}
        role={phase !== "pop" ? "button" : undefined}
        aria-label={phase !== "pop" ? "Skip the cutting show" : undefined}
      >
        <img className="orig" src={pending.originalUrl} alt="Your original drawing" style={{ opacity: phase === "original" || phase === "scan" ? 1 : 0, transition: "opacity 0.5s" }} />
        <img className="cut" src={pending.cutoutUrl} alt="Your paper cut-out" />
        {phase === "scan" && (
          <>
            <div className="reveal-scan" aria-hidden />
            {SPARKLES.map(([x, y, d], i) => (
              <span key={i} className="reveal-sparkle" style={{ left: `${x}%`, top: `${y}%`, animationDelay: `${d}s` }} aria-hidden>
                ✦
              </span>
            ))}
          </>
        )}
        <svg
          viewBox={`0 0 ${m.width} ${m.height}`}
          style={{ width: "88%", height: "88%", opacity: cutting ? 1 : 0, transition: "opacity 0.45s", overflow: "visible" }}
          preserveAspectRatio="xMidYMid meet"
          aria-hidden
        >
          <defs>
            <mask id={maskId} maskUnits="userSpaceOnUse" x={-m.width} y={-m.height} width={m.width * 3} height={m.height * 3}>
              {paths.map((d, i) => (
                <path
                  key={i}
                  ref={(el) => void (el && (maskRefs.current[i] = el))}
                  d={d}
                  fill="none"
                  stroke="#fff"
                  strokeWidth={sw * 3}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ strokeDasharray: 1e6, strokeDashoffset: phase === "pop" ? 0 : 1e6 }}
                />
              ))}
            </mask>
          </defs>
          <image href={pending.cutoutUrl} x={0} y={0} width={m.width} height={m.height} opacity={0.6} />
          <g mask={`url(#${maskId})`}>
            {paths.map((d, i) => (
              <path key={i} d={d} className="trace-path" style={{ strokeWidth: sw, strokeDasharray: `${(sw * 1.7).toFixed(1)} ${(sw * 1.5).toFixed(1)}` }} />
            ))}
          </g>
          {cutting && (
            <g ref={scissorsRef} className="reveal-scissors" transform="translate(-9999 -9999)">
              <Scissors bladeA={bladeA} bladeB={bladeB} />
            </g>
          )}
        </svg>
        {phase === "pop" && !calm && (
          <div className="reveal-confetti" aria-hidden>
            {CONFETTI.map((c, i) => (
              <span key={i} style={{ ["--dx" as string]: `${c.dx.toFixed(0)}px`, ["--dy" as string]: `${c.dy.toFixed(0)}px`, ["--rot" as string]: `${c.rot}deg`, color: c.color, animationDelay: `${c.delay}s` }}>
                ★
              </span>
            ))}
          </div>
        )}
        {phase !== "pop" && <span className="reveal-skip">Tap to skip</span>}
      </div>
      <div className="status-line" aria-live="polite">
        {phase === "pop" ? (
          status === "looking" ? (
            <>
              <span className="spinner-small" /> Looking at your drawing…
            </>
          ) : found ? (
            <span className="status-found">
              <SparkleIcon width={26} height={26} /> I found {anArticle(found)} {found}!
            </span>
          ) : (
            <>
              <CheckIcon width={26} height={26} /> Snip snip — all cut out!
            </>
          )
        ) : phase === "cut" ? (
          <>✂️ Snip, snip… cutting along your lines</>
        ) : (
          <>🖍️ What a great drawing!</>
        )}
      </div>
    </div>
  );
}
