// Hand-drawn icons for the sticker book, camera and storybook buttons
// (same ink style as ./Icons).

import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement>;
const base = { viewBox: "0 0 48 48", fill: "none", stroke: "#2b2320", strokeWidth: 3.2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

export const StickerBookIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M8 10c6-2 11-1 16 3v27c-5-4-10-5-16-3z" fill="#ff9fb2" />
    <path d="M40 10c-6-2-11-1-16 3v27c5-4 10-5 16-3z" fill="#fff8e7" />
    <circle cx="32" cy="21" r="5" fill="#ffd447" />
    <path d="M30 31l2-2 2 2" />
  </svg>
);

export const CameraIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M17 13l3-5h8l3 5" fill="#b3a79c" />
    <rect x="6" y="13" width="36" height="25" rx="5" fill="#4fc1b5" />
    <circle cx="24" cy="25.5" r="8" fill="#9fdad3" />
    <circle cx="35.5" cy="18.5" r="1.5" fill="#ffd447" />
  </svg>
);

export const StorybookIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M10 8h24a4 4 0 0 1 4 4v28H14a4 4 0 0 1-4-4z" fill="#6aa8ff" />
    <path d="M10 36a4 4 0 0 1 4-4h24" />
    <path d="M18 15h12M18 21h8" stroke="#fff8e7" />
    <path d="M30 24l1.5 3 3 .4-2.2 2 .6 3-2.9-1.5-2.9 1.5.6-3-2.2-2 3-.4z" fill="#ffd447" strokeWidth="2" />
  </svg>
);

export const ShutterIcon = (p: P) => (
  <svg {...base} {...p}>
    <circle cx="24" cy="24" r="16" fill="#fff8e7" />
    <circle cx="24" cy="24" r="9" fill="#ef5b5b" />
  </svg>
);
