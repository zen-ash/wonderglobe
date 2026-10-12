"use client";
// The big sticker celebration: the sticker flies in, peels, sticks into the
// book, with paper confetti. One at a time; tap to skip.

import { useEffect, useMemo, useState } from "react";
import { useGame } from "@/state/store";
import { useGameUi, safeSfx } from "@/game/state";
import { STICKER_BY_ID } from "@/game/stickers";
import { speakLine } from "@/game/guide";
import { stickerUrl } from "@/art/stickers";

const CONFETTI = ["#ef5b5b", "#ff9f5a", "#ffd447", "#7fcf63", "#4fc1b5", "#6aa8ff", "#b48cff", "#ff8fc2"];
const DURATION = 3400;

export function StickerAward() {
  const queue = useGameUi((s) => s.awardQueue);
  const overlay = useGameUi((s) => s.overlay);
  const panel = useGame((s) => s.panel);
  const id = queue[0];
  const def = id ? STICKER_BY_ID[id] : null;
  const showing = !!def && !panel && !overlay;

  useEffect(() => {
    if (id && !def) useGameUi.getState().shiftAward();
  }, [id, def]);

  if (!showing || !def) return null;
  return <Celebration key={def.id} id={def.id} />;
}

function Celebration({ id }: { id: string }) {
  const def = STICKER_BY_ID[id];
  const [url, setUrl] = useState<string | null>(null);
  const confetti = useMemo(
    () =>
      Array.from({ length: 28 }, (_, i) => ({
        left: Math.round(Math.random() * 100),
        delay: Math.random() * 0.5,
        dur: 1.6 + Math.random() * 1.2,
        rot: Math.round(Math.random() * 360),
        drift: Math.round((Math.random() - 0.5) * 160),
        color: CONFETTI[i % CONFETTI.length],
        round: i % 3 === 0,
      })),
    [],
  );

  useEffect(() => {
    setUrl(stickerUrl(def, 256));
    safeSfx("sticker");
    speakLine(`New sticker! ${def.title}!`, { ifQuiet: true });
    const t = setTimeout(() => useGameUi.getState().shiftAward(), DURATION);
    return () => clearTimeout(t);
  }, [def]);

  return (
    <div className="sticker-award" onClick={() => useGameUi.getState().shiftAward()} role="status" aria-live="polite">
      <div className="sticker-confetti" aria-hidden>
        {confetti.map((c, i) => (
          <span
            key={i}
            style={{
              left: `${c.left}%`,
              background: c.color,
              borderRadius: c.round ? "50%" : "2px",
              animationDelay: `${c.delay}s`,
              animationDuration: `${c.dur}s`,
              ["--rot" as string]: `${c.rot}deg`,
              ["--drift" as string]: `${c.drift}px`,
            }}
          />
        ))}
      </div>
      <div className="sticker-award-stage">
        <div className="sticker-award-label paper-sm">
          New sticker!
          <strong>{def.title}</strong>
        </div>
        <div className="sticker-fly">
          <div className="sticker-peel">{url && <img src={url} alt={def.title} draggable={false} />}</div>
        </div>
        <div className="sticker-award-book" aria-hidden>
          <span className="page left" />
          <span className="page right" />
        </div>
      </div>
    </div>
  );
}
