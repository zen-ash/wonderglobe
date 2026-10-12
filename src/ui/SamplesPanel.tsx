"use client";
// Prepared sample drawings, clearly labelled as samples. They go through the
// very same cut-out pipeline as a child's own drawing.

import { useMemo, useState } from "react";
import { Modal } from "./Modal";
import { SAMPLE_DRAWINGS, renderSample, renderSampleArtwork } from "@/art/samples";
import { processBoardCanvas, openUpload, DEFAULT_UPLOAD_SETTINGS } from "@/drawing/client";
import { commitArtwork } from "./artworkFlow";
import { useGame } from "@/state/store";
import { playSfx } from "@/audio/sfx";

export function SamplesPanel() {
  const { openPanel, setPending, mode } = useGame.getState();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const thumbs = useMemo(
    () => SAMPLE_DRAWINGS.map((s) => ({ ...s, url: (mode === "gallery" ? renderSampleArtwork(s.id, 256) : renderSample(s.id, 256)).toDataURL("image/png") })),
    [mode],
  );

  const choose = async (id: string, label: string, kind: string) => {
    setBusy(id);
    setError(null);
    try {
      let pending;
      if (mode === "gallery") {
        // A full framed picture: use the upload path in "whole picture" mode.
        const canvas = renderSampleArtwork(id, 768);
        const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("Could not prepare the sample."))), "image/png"));
        const session = await openUpload(blob);
        const run = await session.run({ ...DEFAULT_UPLOAD_SETTINGS, mode: "whole" });
        URL.revokeObjectURL(session.previewUrl);
        URL.revokeObjectURL(run.maskPreviewUrl);
        if (!run.artwork) throw new Error("Could not prepare the sample.");
        pending = await commitArtwork(run.artwork, "sample", { sampleLabel: `Sample: ${label}`, suggestedKind: kind });
      } else {
        const processed = await processBoardCanvas(renderSample(id, 768));
        pending = await commitArtwork(processed, "sample", { sampleLabel: `Sample: ${label}`, suggestedKind: kind });
      }
      setPending(pending);
      playSfx("chime");
      openPanel(mode === "gallery" ? "easelForm" : "life");
    } catch (e) {
      console.warn(e);
      setError((e as Error).message || "That sample didn't load. Try another one.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal title="Sample drawings" onClose={() => openPanel(null)} size="wide">
      <p className="muted" style={{ marginTop: 0, fontWeight: 600 }}>
        These are ready-made <strong>sample</strong> drawings to try things out. Your own drawings are even better!
      </p>
      {error && <p style={{ color: "#b8322a", fontWeight: 700 }}>{error}</p>}
      <div className="samples-grid">
        {thumbs.map((s) => (
          <button key={s.id} className="sample-card" onClick={() => choose(s.id, s.label, s.suggestedKind)} disabled={!!busy}>
            <img src={s.url} alt={`Sample drawing: ${s.label}`} />
            <span>
              {busy === s.id ? <span className="spinner-small" /> : null} {s.label}
            </span>
            <span className="tag sample">Sample</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
