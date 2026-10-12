"use client";
// Postcard photo mode: the buttons step aside, a viewfinder appears, and the
// shutter turns the current view into a crayon-framed postcard that can be
// saved as a picture. The last few postcards of this visit stay in a strip.

import { useEffect, useState } from "react";
import { useGame } from "@/state/store";
import { useGameUi, safeSfx, closeGameOverlay, type Postcard } from "@/game/state";
import { reportEvent, speakLine } from "@/game/guide";
import { stickersForMode } from "@/game/stickers";
import { photoBridge } from "@/render/PhotoCapture";
import { composePostcard } from "@/art/postcard";
import { CloseIcon, DownloadIcon } from "./Icons";
import { CameraIcon } from "./GameIcons";

type Stage = "aim" | "flash" | "card";

function fileName(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `wonderglobe-postcard-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.png`;
}

export function PhotoMode() {
  const postcards = useGameUi((s) => s.postcards);
  const [stage, setStage] = useState<Stage>("aim");
  const [card, setCard] = useState<Postcard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (card) {
          setCard(null);
          setStage("aim");
        } else closeGameOverlay();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [card]);

  const shoot = () => {
    if (stage !== "aim") return;
    const capture = photoBridge.capture;
    const shot = capture?.();
    if (!shot) {
      setError("The camera isn't ready yet. Try again!");
      safeSfx("error");
      return;
    }
    setError(null);
    safeSfx("camera");
    setStage("flash");
    // Let the flash paint before the (slightly heavy) card drawing.
    setTimeout(() => {
      const { world, runtime, mode, region } = useGame.getState();
      const regionName = runtime ? runtime.regionNameAt(runtime.player.n) : region?.name ?? "";
      const earned = stickersForMode(mode ?? "paper").filter((s) => (world?.stickers ?? []).includes(s.id));
      const pick = [...earned].sort(() => Math.random() - 0.5).slice(0, 3);
      const now = new Date();
      let url = "";
      try {
        const canvas = composePostcard({ photo: shot, region: regionName, date: now, stickers: pick, seed: now.getTime() & 0xffff });
        url = canvas.toDataURL("image/png");
      } catch (e) {
        console.warn("[wonderglobe] postcard failed", e);
      }
      if (!url) {
        setStage("aim");
        setError("Hmm, that picture didn't work. Try again!");
        return;
      }
      useGameUi.getState().addPostcard({ url, region: regionName, at: now.getTime() });
      const latest = useGameUi.getState().postcards[0];
      setCard(latest);
      setStage("card");
      safeSfx("sparkle");
      reportEvent("photo");
      speakLine("What a lovely postcard!");
    }, 260);
  };

  const save = (p: Postcard) => {
    const a = document.createElement("a");
    a.href = p.url;
    a.download = fileName(new Date(p.at));
    document.body.appendChild(a);
    a.click();
    a.remove();
    safeSfx("pop");
  };

  if (card) {
    return (
      <div className="postcard-view" role="dialog" aria-modal="true" aria-label="Your postcard">
        <div className="postcard-flutter">
          <img src={card.url} alt={`Postcard from ${card.region}`} draggable={false} />
        </div>
        <div className="postcard-actions">
          <button className="btn blue big" onClick={() => save(card)}>
            <DownloadIcon /> Save picture
          </button>
          <button
            className="btn green big"
            onClick={() => {
              setCard(null);
              setStage("aim");
            }}
          >
            <CameraIcon /> Another!
          </button>
          <button className="btn paper-btn big" onClick={closeGameOverlay}>
            Close
          </button>
        </div>
        {postcards.length > 1 && <Strip postcards={postcards} current={card.id} onPick={setCard} />}
      </div>
    );
  }

  return (
    <div className={`photo-mode ${stage === "flash" ? "flash" : ""}`}>
      <div className="viewfinder" aria-hidden>
        <span className="corner tl" />
        <span className="corner tr" />
        <span className="corner bl" />
        <span className="corner br" />
      </div>
      <div className="photo-top paper-sm">📸 Find a nice view!</div>
      {error && <div className="photo-error paper-sm">{error}</div>}
      <div className="photo-controls">
        <button className="icon-btn photo-close" onClick={closeGameOverlay} aria-label="Close camera" title="Close">
          <CloseIcon />
        </button>
        <button className="shutter" onClick={shoot} aria-label="Take a picture" title="Take a picture" disabled={stage !== "aim"}>
          <span />
        </button>
        <span className="photo-spacer" />
      </div>
      {postcards.length > 0 && <Strip postcards={postcards} onPick={(p) => setCard(p)} />}
    </div>
  );
}

function Strip({ postcards, current, onPick }: { postcards: Postcard[]; current?: number; onPick: (p: Postcard) => void }) {
  return (
    <div className="postcard-strip" aria-label="Your postcards">
      {postcards.map((p) => (
        <button key={p.id} className={`postcard-thumb ${p.id === current ? "on" : ""}`} onClick={() => onPick(p)} aria-label={`Postcard from ${p.region}`}>
          <img src={p.url} alt="" draggable={false} />
        </button>
      ))}
    </div>
  );
}
