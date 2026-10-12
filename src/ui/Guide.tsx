"use client";
// Shelly's corner: her portrait (tap to hear what she has to say) and a
// speech bubble with a short line and one or two big buttons. Never blocks
// play: the bubble can always be put away.

import { useEffect, useState } from "react";
import { useGame } from "@/state/store";
import { useGameUi } from "@/game/state";
import { openGuide, guideHide, speakLine } from "@/game/guide";
import { shellyUrl } from "@/art/guide";
import { SpeakerIcon, CloseIcon } from "./Icons";

export function Guide() {
  const bubble = useGameUi((s) => s.bubble);
  const news = useGameUi((s) => s.guideHasNews);
  const overlay = useGameUi((s) => s.overlay);
  const panel = useGame((s) => s.panel);
  const onboarding = useGame((s) => s.world?.onboarded === false);
  const [portrait, setPortrait] = useState<string | null>(null);

  useEffect(() => {
    // Drawn once on the client (canvas art).
    setPortrait(shellyUrl(160));
  }, []);

  if (overlay || panel) return null;

  return (
    <div className="guide-dock">
      <button className={`guide-portrait paper-sm ${bubble ? "talking" : ""}`} onClick={openGuide} aria-label="Shelly the snail — tap to talk" title="Shelly">
        {portrait ? <img src={portrait} alt="" draggable={false} /> : <span aria-hidden>🐌</span>}
        {news && !bubble && !onboarding && (
          <span className="guide-news" aria-hidden>
            !
          </span>
        )}
      </button>
      {bubble && (
        <div key={bubble.id} className={`guide-bubble paper mood-${bubble.mood}`} role="status" aria-live="polite">
          <button className="guide-x" onClick={guideHide} aria-label="Close" title="Close">
            <CloseIcon width={22} height={22} />
          </button>
          <p className="guide-text">{bubble.text}</p>
          <div className="guide-actions">
            {bubble.buttons.map((b, i) => (
              <button key={i} className={`btn ${b.tone === "paper" ? "paper-btn" : b.tone ?? "green"}`} onClick={b.onClick}>
                {b.label}
              </button>
            ))}
            <button className="icon-btn guide-hear" onClick={() => speakLine(bubble.text)} aria-label="Hear it again" title="Hear it again">
              <SpeakerIcon />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
