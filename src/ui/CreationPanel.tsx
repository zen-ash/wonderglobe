"use client";
// Inspecting a creation: original drawing, cut-out, name, a conversation,
// fixing what it is, and removing it.

import { useEffect, useState } from "react";
import { Modal } from "./Modal";
import { ChatBox } from "./ChatBox";
import { TrashIcon, SpeakerIcon, PencilIcon, CheckIcon, MoveIcon } from "./Icons";
import { useGame } from "@/state/store";
import { getArtwork, getArtworkUrls } from "@/persistence";
import { KINDS, KIND_GROUPS, BEHAVIOR_CHOICES, getKind } from "@/core/kinds";
import type { Behavior, CreationRecord, Facing } from "@/core/types";
import { speech } from "@/audio/speech";
import { playSfx } from "@/audio/sfx";

const MOVING = new Set<Behavior>(["walk", "hop", "fly", "flutter", "swim", "float", "drive", "hover"]);

export function useArtworkUrls(artworkId: string | undefined) {
  const [urls, setUrls] = useState<{ originalUrl: string; cutoutUrl: string; sampleLabel?: string } | null>(null);
  useEffect(() => {
    let alive = true;
    setUrls(null);
    if (!artworkId) return;
    Promise.all([getArtworkUrls(artworkId), getArtwork(artworkId)])
      .then(([u, rec]) => alive && u && setUrls({ ...u, sampleLabel: rec?.sampleLabel }))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [artworkId]);
  return urls;
}

export function CreationPanel() {
  const id = useGame((s) => s.selectedId);
  const record = useGame((s) => s.world?.creations.find((c) => c.id === id));
  const { openPanel } = useGame.getState();
  if (!record) return null;
  return <CreationView key={record.id} record={record} onClose={() => openPanel(null)} />;
}

function CreationView({ record, onClose }: { record: CreationRecord; onClose: () => void }) {
  const urls = useArtworkUrls(record.artworkId);
  const runtime = useGame((s) => s.runtime);
  const { updateCreation, removeCreation, toast } = useGame.getState();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [editing, setEditing] = useState(false);
  const kind = getKind(record.kind);
  const agent = runtime?.creations.get(record.id);
  const region = agent && runtime ? runtime.regionNameAt(agent.n) : "";

  const applyChange = (patch: Partial<CreationRecord>) => {
    const next = { ...record, ...patch };
    updateCreation(record.id, patch);
    if (runtime && (patch.kind || patch.behavior || patch.facing)) {
      // Rebuild its behaviour in the world (it may need to move, e.g. to water).
      const a = runtime.creations.get(record.id);
      const pos = a ? [a.n.x, a.n.y, a.n.z] : record.position;
      runtime.removeCreation(record.id);
      runtime.addCreation({ ...next, position: pos as CreationRecord["position"] }, true);
    }
  };

  return (
    <Modal
      title={
        <span>
          {kind.emoji} {record.name}
        </span>
      }
      onClose={onClose}
      placement="side"
      footer={
        confirmRemove ? (
          <>
            <span style={{ fontWeight: 700, alignSelf: "center" }}>Take {record.name} off the planet?</span>
            <span className="spacer" />
            <button className="btn green" onClick={() => setConfirmRemove(false)}>
              Keep it
            </button>
            <button
              className="btn red"
              onClick={() => {
                speech.stop();
                removeCreation(record.id);
                playSfx("rustle");
                toast(`${record.name} was folded away.`);
              }}
            >
              <TrashIcon /> Remove
            </button>
          </>
        ) : (
          <>
            <button className="btn paper-btn" onClick={() => setConfirmRemove(true)}>
              <TrashIcon /> Remove
            </button>
            <span className="spacer" />
            <button className="btn paper-btn" onClick={() => setEditing((v) => !v)}>
              <PencilIcon /> {editing ? "Done" : "Change"}
            </button>
          </>
        )
      }
    >
      <p className="muted" style={{ margin: "0 0 10px", fontWeight: 600 }}>
        {kind.label} {region && <>· lives in {region}</>} {urls?.sampleLabel && <span className="tag sample">{urls.sampleLabel}</span>}
      </p>
      <div className="art-pair">
        <div className="art-frame">
          {urls ? <img src={urls.originalUrl} alt="Original drawing" /> : <span className="spinner-small" />}
          Original
        </div>
        <div className="art-frame checker">
          {urls ? <img src={urls.cutoutUrl} alt="Paper cut-out" /> : <span className="spinner-small" />}
          Cut-out
        </div>
      </div>

      {editing ? (
        <EditCreation record={record} onChange={applyChange} />
      ) : (
        <>
          <div className="panel-actions">
            <button className="btn yellow" onClick={() => void speech.playAnimalSound(record.kind)}>
              <SpeakerIcon /> Say hi
            </button>
            {runtime?.canRide(record.id) && (
              <button
                className="btn blue"
                onClick={() => {
                  if (runtime.startRide(record.id)) {
                    playSfx("whoosh");
                    useGame.getState().openPanel(null);
                    toast(record.behavior === "swim" || record.behavior === "float" ? `Hold on! ${record.name} is taking you around the water!` : `Hold on tight! ${record.name} is flying you over the mountain!`, "happy");
                  }
                }}
              >
                {record.behavior === "swim" || record.behavior === "float" ? "🛶" : "🪁"} Take a ride!
              </button>
            )}
            <span className="small muted" style={{ alignSelf: "center", fontWeight: 600 }}>
              <MoveIcon width={18} height={18} style={{ verticalAlign: -4 }} /> Press and drag {record.name} to move it.
            </span>
          </div>
          <ChatBox
            character={{ id: record.id, kind: record.kind, name: record.name, behavior: record.behavior, region, mode: "paper" }}
            voiceType={kind.voice}
            lines={record.chat}
            onLines={(chat) => updateCreation(record.id, { chat })}
            greeting={`${kind.sound} I'm ${record.name}! Say hello!`}
          />
        </>
      )}
    </Modal>
  );
}

function EditCreation({ record, onChange }: { record: CreationRecord; onChange: (p: Partial<CreationRecord>) => void }) {
  const [name, setName] = useState(record.name);
  const [group, setGroup] = useState(KIND_GROUPS.find((g) => g.kinds.includes(record.kind))?.id ?? KIND_GROUPS[0].id);
  const kind = getKind(record.kind);
  const imaginary = kind.category === "imaginary" || kind.category === "thing";
  return (
    <div>
      <div className="field">
        <label htmlFor="rename">Name</label>
        <div style={{ display: "flex", gap: 8 }}>
          <input id="rename" className="name-input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
          <button className="btn green" onClick={() => name.trim() && onChange({ name: name.trim() })} aria-label="Save name">
            <CheckIcon />
          </button>
        </div>
      </div>
      <div className="field">
        <label>What is it?</label>
        <div className="kind-tabs">
          {KIND_GROUPS.map((g) => (
            <button key={g.id} className={`chip-btn ${group === g.id ? "on" : ""}`} onClick={() => setGroup(g.id)}>
              {g.label}
            </button>
          ))}
        </div>
        <div className="kind-grid">
          {(KIND_GROUPS.find((g) => g.id === group)?.kinds ?? []).map((id) => {
            const k = KINDS.find((x) => x.id === id)!;
            return (
              <button
                key={id}
                className={`kind-btn ${record.kind === id ? "selected" : ""}`}
                onClick={() => onChange({ kind: id, behavior: k.behavior, classifiedBy: "player", facing: k.hasFacing ? (record.facing === "none" ? "right" : record.facing) : "none" })}
              >
                <span className="emoji">{k.emoji}</span>
                {k.label}
              </button>
            );
          })}
        </div>
      </div>
      {imaginary && (
        <div className="field">
          <label>How does it move?</label>
          <div className="kind-grid">
            {BEHAVIOR_CHOICES.map((b) => (
              <button key={b.behavior} className={`kind-btn ${record.behavior === b.behavior ? "selected" : ""}`} onClick={() => onChange({ behavior: b.behavior, classifiedBy: "player" })}>
                <span className="emoji">{b.emoji}</span>
                {b.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {MOVING.has(record.behavior) && (
        <div className="field">
          <label>Which way is it looking?</label>
          <div className="seg">
            {(["left", "none", "right"] as Facing[]).map((f) => (
              <button key={f} className={`chip-btn ${record.facing === f ? "on" : ""}`} onClick={() => onChange({ facing: f })}>
                {f === "left" ? "⬅ Left" : f === "right" ? "Right ➡" : "🙂 At me"}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
