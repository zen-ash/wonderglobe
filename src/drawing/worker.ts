// Web Worker entry for the drawing pipeline. Load with:
//   new Worker(new URL("./worker.ts", import.meta.url), { type: "module" })
//
// No `/// <reference lib="webworker" />` here: the project tsconfig uses the
// DOM lib and the two conflict. The tiny slice of the worker global we need
// is typed locally instead.

import { DrawingError, processBoardDrawing, processUpload, type CutoutResult } from "./process";
import type { WorkerRequest, WorkerResponse } from "./protocol";

interface WorkerScope {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse, transfer: Transferable[]): void;
}

const scope = globalThis as unknown as WorkerScope;

const FALLBACK_ERROR = "Oops, the scissors slipped! Please try again.";

function transfers(result: CutoutResult | null): Transferable[] {
  return result ? [result.cutout.data.buffer as ArrayBuffer] : [];
}

scope.onmessage = (event) => {
  const req = event.data;
  try {
    if (req.type === "board") {
      const result = processBoardDrawing(req.image);
      scope.postMessage({ id: req.id, ok: true, type: "board", result }, transfers(result));
    } else if (req.type === "upload") {
      const { analysis, result } = processUpload(req.image, req.settings);
      scope.postMessage({ id: req.id, ok: true, type: "upload", analysis, result }, [
        analysis.mask.buffer as ArrayBuffer,
        ...transfers(result),
      ]);
    } else {
      scope.postMessage({ id: (req as { id: number }).id, ok: false, error: FALLBACK_ERROR }, []);
    }
  } catch (err) {
    if (err instanceof DrawingError) {
      scope.postMessage({ id: req.id, ok: false, error: err.message, code: err.code }, []);
    } else {
      console.error("[drawing worker]", err);
      scope.postMessage({ id: req.id, ok: false, error: FALLBACK_ERROR }, []);
    }
  }
};
