"use client";
// A short illustrated "how to play".

import { Modal } from "./Modal";
import { useGame } from "@/state/store";

const S = { stroke: "#2b2320", strokeWidth: 3, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

const cards: Array<{ title: string; text: string; art: React.ReactNode }> = [
  {
    title: "1. Draw",
    text: "Tap Draw and make anything — a fish, a house, a dragon!",
    art: (
      <svg viewBox="0 0 200 90">
        <rect x="30" y="8" width="140" height="74" rx="8" fill="#fffdf6" {...S} />
        <path d="M60 50c10-18 40-18 52 0-12 18-42 18-52 0zM112 50l18-12v24z" fill="#4dabf7" {...S} />
        <circle cx="72" cy="46" r="3" fill="#2b2320" />
        <path d="M150 20l12 12-26 26-14 3 3-14z" fill="#ffd447" {...S} />
      </svg>
    ),
  },
  {
    title: "2. It comes alive",
    text: "Your drawing is cut out like paper and jumps into the world.",
    art: (
      <svg viewBox="0 0 200 90">
        <ellipse cx="100" cy="80" rx="80" ry="10" fill="#8fd46c" {...S} />
        <path d="M70 48c10-18 40-18 52 0-12 18-42 18-52 0zM122 48l18-12v24z" fill="#4dabf7" stroke="#fff" strokeWidth="9" strokeLinejoin="round" />
        <path d="M70 48c10-18 40-18 52 0-12 18-42 18-52 0zM122 48l18-12v24z" fill="#4dabf7" {...S} />
        <path d="M40 30l4 8 8 2-8 3-3 8-3-8-8-3 8-2zM160 18l3 6 6 2-6 2-2 6-2-6-6-2 6-2z" fill="#ffd447" {...S} />
      </svg>
    ),
  },
  {
    title: "3. Walk around",
    text: "Use the arrow keys or W A S D, tap the ground, or use the joystick.",
    art: (
      <svg viewBox="0 0 200 90">
        {[
          [85, 10, "▲"],
          [55, 46, "◀"],
          [85, 46, "▼"],
          [115, 46, "▶"],
        ].map(([x, y, t], i) => (
          <g key={i}>
            <rect x={x as number} y={y as number} width="30" height="30" rx="6" fill="#fff8e7" {...S} />
            <text x={(x as number) + 15} y={(y as number) + 21} textAnchor="middle" fontSize="16" fontWeight="700" fill="#2b2320">
              {t}
            </text>
          </g>
        ))}
        <circle cx="168" cy="50" r="22" fill="#fff8e7" {...S} />
        <circle cx="174" cy="44" r="10" fill="#ffd447" {...S} />
      </svg>
    ),
  },
  {
    title: "4. Look around",
    text: "Drag empty space to turn. Pinch or scroll to zoom out and see the whole planet.",
    art: (
      <svg viewBox="0 0 200 90">
        <circle cx="100" cy="46" r="34" fill="#9fdad3" {...S} />
        <path d="M76 36c8 2 12 8 10 14s6 10 12 8l-4 14c-12-2-20-10-22-22z" fill="#8fd46c" {...S} />
        <path d="M30 46a70 30 0 0140-26M170 46a70 30 0 01-40 26" fill="none" {...S} />
        <path d="M66 14l6 6-8 3M134 78l-6-6 8-3" fill="none" {...S} />
      </svg>
    ),
  },
  {
    title: "5. Say hello",
    text: "Tap a creation to see it up close and chat with it.",
    art: (
      <svg viewBox="0 0 200 90">
        <path d="M30 20h90v36H66l-14 14V56H30z" fill="#eaf7ff" {...S} />
        <path d="M46 36h10M66 36h30" {...S} />
        <path d="M128 40h46v28h-10v10l-12-10h-24z" fill="#fff3b8" {...S} />
      </svg>
    ),
  },
  {
    title: "6. Move things",
    text: "Press and drag a creation or easel to carry it somewhere new.",
    art: (
      <svg viewBox="0 0 200 90">
        <path d="M60 60l30-30M90 30h-14M90 30v14" fill="none" {...S} />
        <rect x="100" y="12" width="44" height="40" rx="4" fill="#ff8fc2" {...S} />
        <path d="M150 74h-40" strokeDasharray="6 6" {...S} />
        <path d="M40 66c4-8 14-8 18 0" fill="#f6d2b4" {...S} />
      </svg>
    ),
  },
];

export function HelpPanel() {
  const { openPanel } = useGame.getState();
  const mode = useGame((s) => s.mode);
  return (
    <Modal title="How to play" onClose={() => openPanel(null)} size="wide">
      <div className="help-grid">
        {cards.map((c) => (
          <div key={c.title} className="help-card">
            {c.art}
            <strong>{c.title}</strong>
            <p>{mode === "gallery" && c.title.startsWith("2.") ? "Your picture goes up on an easel, and visitors come to look." : c.text}</p>
          </div>
        ))}
      </div>
      <p className="small muted" style={{ marginBottom: 0 }}>
        Everything saves by itself. Come back any time and your world will be waiting.
      </p>
    </Modal>
  );
}
