// Hand-drawn style icons (thick ink strokes, crayon fills).

import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement>;
const base = { viewBox: "0 0 48 48", fill: "none", stroke: "#2b2320", strokeWidth: 3.2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

export const PencilIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M9 39l3-10 20-20c2-2 5-2 7 0s2 5 0 7L19 36z" fill="#ffd447" />
    <path d="M12 29l7 7M29 12l7 7" />
    <path d="M9 39l3.5-10.5 7 7z" fill="#f6d2b4" />
    <path d="M9.3 38.6l2-6 4 4z" fill="#2b2320" />
  </svg>
);

export const UploadIcon = (p: P) => (
  <svg {...base} {...p}>
    <rect x="7" y="11" width="34" height="28" rx="4" fill="#9fd3ff" />
    <path d="M7 33l10-10 8 8 5-5 11 9" fill="#7fcf63" />
    <circle cx="33" cy="19" r="3.5" fill="#ffd447" />
  </svg>
);

export const SampleIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M10 8h22l6 6v26H10z" fill="#fff8e7" />
    <path d="M32 8v6h6" />
    <path d="M16 30c3-6 7-8 10-6s5 6 8 2" stroke="#ef5b5b" />
    <circle cx="19" cy="19" r="3" stroke="#6aa8ff" />
  </svg>
);

export const GlobeIcon = (p: P) => (
  <svg {...base} {...p}>
    <circle cx="24" cy="24" r="16" fill="#9fdad3" />
    <path d="M13 17c4 1 6 4 5 7s3 5 6 4M31 11c-2 4 1 6 4 6M28 38c0-4 3-5 6-5" fill="none" />
    <path d="M14 18c3 0 5 3 4 6s2 4 5 4l-2 8c-6-1-10-6-11-11z" fill="#8fd46c" stroke="none" />
    <circle cx="24" cy="24" r="16" />
  </svg>
);

export const ExploreIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M6 36c6-6 12-6 18-2s12 4 18-2" fill="none" />
    <path d="M18 31v-9l6-5 6 5v9" fill="#ffd447" />
    <path d="M24 31v-5" />
  </svg>
);

export const DrawerIcon = (p: P) => (
  <svg {...base} {...p}>
    <rect x="7" y="9" width="34" height="30" rx="4" fill="#d9a86c" />
    <path d="M7 24h34" />
    <path d="M20 16h8M20 31h8" />
  </svg>
);

export const GearIcon = (p: P) => (
  <svg {...base} {...p}>
    <path
      d="M24 6l3 5 6-2 1 6 6 2-3 5 3 5-6 2-1 6-6-2-3 5-3-5-6 2-1-6-6-2 3-5-3-5 6-2 1-6 6 2z"
      fill="#b48cff"
    />
    <circle cx="24" cy="24" r="5.5" fill="#fff8e7" />
  </svg>
);

export const HelpIcon = (p: P) => (
  <svg {...base} {...p}>
    <circle cx="24" cy="24" r="17" fill="#9fd3ff" />
    <path d="M18.5 19c0-3.5 2.6-5.5 5.6-5.5s5.4 2 5.4 4.8c0 4.2-5.5 4.2-5.5 8.4" />
    <circle cx="24" cy="33.5" r="1.2" fill="#2b2320" />
  </svg>
);

export const HomeIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M8 23L24 9l16 14" />
    <path d="M12 21v18h24V21" fill="#ff8fc2" />
    <path d="M21 39v-9h6v9" fill="#fff8e7" />
  </svg>
);

export const CloseIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M14 14l20 20M34 14L14 34" strokeWidth={4.2} />
  </svg>
);

export const UndoIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M14 18h15a9 9 0 010 18H18" />
    <path d="M19 11l-7 7 7 7" />
  </svg>
);

export const EraserIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M8 32l16-16 10 10-12 12H14z" fill="#ff8fc2" />
    <path d="M24 16l6-6 10 10-6 6" fill="#fff8e7" />
    <path d="M22 38h18" />
  </svg>
);

export const TrashIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M10 14h28M19 14V9h10v5" />
    <path d="M13 14l2 25h18l2-25" fill="#e8dcc2" />
    <path d="M20 20v13M28 20v13" />
  </svg>
);

export const CheckIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M10 25l9 9 19-20" strokeWidth={4.4} />
  </svg>
);

export const ArrowLeftIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M30 10L16 24l14 14" strokeWidth={4} />
  </svg>
);

export const ArrowRightIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M18 10l14 14-14 14" strokeWidth={4} />
  </svg>
);

export const MicIcon = (p: P) => (
  <svg {...base} {...p}>
    <rect x="18" y="7" width="12" height="21" rx="6" fill="#ff8fc2" />
    <path d="M12 23a12 12 0 0024 0M24 35v6M18 41h12" />
  </svg>
);

export const StopIcon = (p: P) => (
  <svg {...base} {...p}>
    <rect x="13" y="13" width="22" height="22" rx="4" fill="#fff" />
  </svg>
);

export const SpeakerIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M8 19h7l9-8v26l-9-8H8z" fill="#ffd447" />
    <path d="M30 18c3 3 3 9 0 12M34 13c6 6 6 16 0 22" />
  </svg>
);

export const SendIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M7 24l33-15-10 32-6-13z" fill="#9fd3ff" />
    <path d="M24 28l16-19" />
  </svg>
);

export const MusicIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M18 34V12l20-4v22" />
    <circle cx="13.5" cy="34.5" r="5" fill="#ff8fc2" />
    <circle cx="33.5" cy="30.5" r="5" fill="#9fd3ff" />
  </svg>
);

export const BellIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M12 33c3-3 3-6 3-12a9 9 0 0118 0c0 6 0 9 3 12z" fill="#ffd447" />
    <path d="M20 38a4 4 0 008 0" />
  </svg>
);

export const VoiceIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M8 12h32v20H22l-8 7v-7H8z" fill="#9fdad3" />
    <path d="M15 22h2M23 19v6M31 21v2" />
  </svg>
);

export const SnailIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M6 36h30c4 0 6-3 6-6" />
    <circle cx="22" cy="26" r="10" fill="#ffd447" />
    <path d="M22 26c0-2 3-2 3 0s-2 5-5 4-4-6 0-8" />
    <path d="M38 30l2-9M42 30l2-8" />
  </svg>
);

export const FeatherIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M10 38C14 22 24 10 40 8c-2 16-14 26-30 30z" fill="#7fcf63" />
    <path d="M10 38l18-18" />
  </svg>
);

export const ExpandIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M9 18V9h9M30 9h9v9M39 30v9h-9M18 39H9v-9" strokeWidth={4} />
  </svg>
);

export const DownloadIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M24 8v22M15 21l9 9 9-9" />
    <path d="M9 34v6h30v-6" />
  </svg>
);

export const OpenFileIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M7 13h12l3 4h19v21H7z" fill="#ffd447" />
    <path d="M24 34V22M18 27l6-6 6 6" />
  </svg>
);

export const MoveIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M24 6v36M6 24h36M18 12l6-6 6 6M18 36l6 6 6-6M12 18l-6 6 6 6M36 18l6 6-6 6" />
  </svg>
);

export const NoteIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M9 9h30v22l-8 8H9z" fill="#ffe066" />
    <path d="M31 39v-8h8M15 17h18M15 23h12" />
  </svg>
);

export const EyeIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M5 24c6-9 13-13 19-13s13 4 19 13c-6 9-13 13-19 13S11 33 5 24z" fill="#fff8e7" />
    <circle cx="24" cy="24" r="6" fill="#6aa8ff" />
  </svg>
);

export const SparkleIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M24 6l4 13 13 5-13 5-4 13-4-13-13-5 13-5z" fill="#ffd447" />
  </svg>
);

export const CropIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M14 6v28h28M6 14h28v28" />
  </svg>
);

export const BrushIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M30 8l10 10-14 14-10-10z" fill="#9fd3ff" />
    <path d="M16 22l-4 4c-4 4-4 10-4 14 4 0 10 0 14-4l4-4" fill="#ff8fc2" />
  </svg>
);
