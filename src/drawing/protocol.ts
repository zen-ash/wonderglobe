// Message protocol between the main thread (client.ts) and the drawing
// worker (worker.ts). All payloads are structured-cloneable; result pixel
// buffers are transferred, not copied.

import type { CutoutResult, RGBAImage, UploadAnalysis, UploadSettings } from "./process";

export type WorkerRequest =
  | { id: number; type: "board"; image: RGBAImage }
  | { id: number; type: "upload"; image: RGBAImage; settings: UploadSettings };

export type WorkerResponse =
  | { id: number; ok: true; type: "board"; result: CutoutResult }
  | { id: number; ok: true; type: "upload"; analysis: UploadAnalysis; result: CutoutResult | null }
  | {
      id: number;
      ok: false;
      /** Child-friendly message, safe to show as-is. */
      error: string;
      /** DrawingError code when the failure was an expected one. */
      code?: string;
    };
