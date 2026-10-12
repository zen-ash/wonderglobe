"use client";
// Gallery World panels: hanging a new picture on an easel, and inspecting a
// picture (title, artist, story, sticky notes, previous/next, a little chat).

import { useEffect, useState } from "react";
import { Modal } from "./Modal";
import { ChatBox } from "./ChatBox";
import { useArtworkUrls } from "./CreationPanel";
import { CheckIcon, ArrowLeftIcon, ArrowRightIcon, TrashIcon, NoteIcon, PencilIcon, EyeIcon } from "./Icons";
import { useGame, newId } from "@/state/store";
import { rememberPending } from "./artworkFlow";
import type { EaselRecord } from "@/core/types";
import { NOTE_COLORS } from "@/core/types";
import { toVec3 } from "@/world/sphere";
import { travelTo } from "./travel";
import { focusCamera, setCameraMode } from "@/render/cameraControl";
import { playSfx } from "@/audio/sfx";
import { speech } from "@/audio/speech";

export function EaselForm() {
  const pending = useGame((s) => s.pending);
  const prefs = useGame((s) => s.prefs);
  const { openPanel, setPending, addEasel, setPrefs, toast } = useGame.getState();
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState(prefs.playerName);
  const [story, setStory] = useState("");
  if (!pending) return null;

  const hang = () => {
    const runtime = useGame.getState().runtime;
    if (!runtime) return;
    const { n, t } = runtime.easelSpawnPoint();
    const rec: EaselRecord = {
      id: newId("e"),
      artworkId: pending.artworkId,
      title: title.trim().slice(0, 60) || "Untitled",
      artist: artist.trim().slice(0, 40),
      story: story.trim().slice(0, 600),
      notes: [],
      position: toVec3(n),
      heading: toVec3(t),
      createdAt: Date.now(),
    };
    addEasel(rec);
    // Opening ceremony: a ribbon waits on the easel until the child cuts it.
    useGame.getState().setRibbon(rec.id);
    if (artist.trim() && artist.trim() !== prefs.playerName) setPrefs({ playerName: artist.trim().slice(0, 40) });
    rememberPending(null);
    setPending(null);
    openPanel(null);
    setCameraMode("explore");
    focusCamera(n.clone().multiplyScalar(runtime.terrain.heightAt(n) + 1.5), 3, performance.now() / 1000);
    playSfx("stamp");
    toast(`Visitors are gathering for “${rec.title}”. Cut the ribbon to open it!`, "happy");
  };

  return (
    <Modal
      title="Hang it in the gallery"
      onClose={() => openPanel(null)}
      closeLabel="Not now"
      dismissOnBackdrop={false}
      footer={
        <>
          <span className="spacer" />
          <button className="btn green big" onClick={hang}>
            <CheckIcon /> Hang it up!
          </button>
        </>
      }
    >
      <div className="picture-view">
        <img src={pending.originalUrl} alt="Your picture" />
      </div>
      {pending.sampleLabel && (
        <p style={{ marginTop: 0 }}>
          <span className="tag sample">{pending.sampleLabel}</span>
        </p>
      )}
      <div className="field">
        <label htmlFor="title">Title</label>
        <input id="title" className="text-input" value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} placeholder="My amazing picture" autoComplete="off" />
      </div>
      <div className="field">
        <label htmlFor="artist">Artist</label>
        <input id="artist" className="text-input" value={artist} maxLength={40} onChange={(e) => setArtist(e.target.value)} placeholder="Your name" autoComplete="off" />
      </div>
      <div className="field">
        <label htmlFor="story">Story (optional)</label>
        <textarea id="story" className="text-area" value={story} maxLength={600} onChange={(e) => setStory(e.target.value)} placeholder="What is happening in your picture?" />
      </div>
    </Modal>
  );
}

export function EaselPanel() {
  const id = useGame((s) => s.selectedId);
  const easels = useGame((s) => s.world?.easels ?? []);
  const record = easels.find((e) => e.id === id);
  const { openPanel } = useGame.getState();
  if (!record) return null;
  const index = easels.indexOf(record);
  const go = (delta: number) => {
    const next = easels[(index + delta + easels.length) % easels.length];
    if (!next || next.id === record.id) return;
    playSfx("rustle");
    travelTo(next.id);
    openPanel("easel", next.id);
  };
  return <EaselView key={record.id} record={record} position={`${index + 1} of ${easels.length}`} onPrev={easels.length > 1 ? () => go(-1) : undefined} onNext={easels.length > 1 ? () => go(1) : undefined} />;
}

export { travelTo } from "./travel";

function EaselView({ record, position, onPrev, onNext }: { record: EaselRecord; position: string; onPrev?: () => void; onNext?: () => void }) {
  const urls = useArtworkUrls(record.artworkId);
  const runtime = useGame((s) => s.runtime);
  const { updateEasel, removeEasel, openPanel, toast } = useGame.getState();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(record.title);
  const [artist, setArtist] = useState(record.artist);
  const [story, setStory] = useState(record.story);
  const [noteText, setNoteText] = useState("");
  const [noteColor, setNoteColor] = useState<string>(NOTE_COLORS[0]);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [talking, setTalking] = useState(false);
  const [chat, setChat] = useState<import("@/core/types").ChatLine[]>([]);
  const region = runtime ? runtime.regionNameAt(runtime.easels.get(record.id)?.n ?? runtime.player.n) : "";

  useEffect(() => () => speech.stop(), []);

  const save = () => {
    updateEasel(record.id, { title: title.trim().slice(0, 60) || "Untitled", artist: artist.trim().slice(0, 40), story: story.trim().slice(0, 600) });
    setEditing(false);
    playSfx("stamp");
  };

  const addNote = () => {
    const text = noteText.trim().slice(0, 140);
    if (!text) return;
    if (record.notes.length >= 40) {
      toast("This picture is covered in notes already!", "warn");
      return;
    }
    updateEasel(record.id, { notes: [...record.notes, { id: newId("n"), color: noteColor, text, createdAt: Date.now() }] });
    setNoteText("");
    playSfx("note");
  };

  return (
    <Modal
      title={<span>🖼️ {record.title}</span>}
      onClose={() => openPanel(null)}
      placement="side"
      footer={
        confirmRemove ? (
          <>
            <span style={{ fontWeight: 700, alignSelf: "center" }}>Take this picture down?</span>
            <span className="spacer" />
            <button className="btn green" onClick={() => setConfirmRemove(false)}>
              Keep it
            </button>
            <button className="btn red" onClick={() => removeEasel(record.id)}>
              <TrashIcon /> Take down
            </button>
          </>
        ) : (
          <>
            <button className="btn paper-btn" onClick={() => setConfirmRemove(true)}>
              <TrashIcon /> Take down
            </button>
            <span className="spacer" />
            <div className="nav-arrows">
              <button className="btn paper-btn" onClick={onPrev} disabled={!onPrev} aria-label="Previous picture">
                <ArrowLeftIcon />
              </button>
              <span style={{ alignSelf: "center", fontWeight: 700, minWidth: 64, textAlign: "center" }}>{position}</span>
              <button className="btn paper-btn" onClick={onNext} disabled={!onNext} aria-label="Next picture">
                <ArrowRightIcon />
              </button>
            </div>
          </>
        )
      }
    >
      <div className="picture-view">{urls ? <img src={urls.originalUrl} alt={record.title} /> : <span className="spinner-small" />}</div>
      {editing ? (
        <div>
          <div className="field">
            <label htmlFor="e-title">Title</label>
            <input id="e-title" className="text-input" value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="e-artist">Artist</label>
            <input id="e-artist" className="text-input" value={artist} maxLength={40} onChange={(e) => setArtist(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="e-story">Story</label>
            <textarea id="e-story" className="text-area" value={story} maxLength={600} onChange={(e) => setStory(e.target.value)} />
          </div>
          <button className="btn green" onClick={save}>
            <CheckIcon /> Save
          </button>
        </div>
      ) : (
        <div>
          <p className="easel-artist" style={{ margin: "0 0 4px", fontWeight: 700, fontSize: "1.1rem" }}>
            by {record.artist || "a mystery artist"} {urls?.sampleLabel && <span className="tag sample">{urls.sampleLabel}</span>}
          </p>
          {record.story ? <p className="easel-story" style={{ margin: "0 0 8px", lineHeight: 1.45, whiteSpace: "pre-wrap" }}>{record.story}</p> : <p className="muted" style={{ margin: "0 0 8px" }}>No story yet.</p>}
          <div className="panel-actions">
            <button className="btn paper-btn" onClick={() => setEditing(true)}>
              <PencilIcon /> Edit
            </button>
            <button className="btn blue" onClick={() => setTalking((v) => !v)}>
              <EyeIcon /> {talking ? "Stop talking" : "Talk to the picture"}
            </button>
          </div>
        </div>
      )}

      {talking && (
        <div style={{ margin: "6px 0 12px" }}>
          <ChatBox
            character={{ id: record.id, kind: "sculpture", name: record.title.slice(0, 60), behavior: "still", region, mode: "gallery", title: record.title, artist: record.artist, story: record.story.slice(0, 400) }}
            voiceType="calm"
            lines={chat}
            onLines={setChat}
            greeting={`Hello! I'm “${record.title}”. Ask me about my story!`}
          />
        </div>
      )}

      <h3 className="section-title">
        <NoteIcon width={26} height={26} style={{ verticalAlign: -6 }} /> Sticky notes
      </h3>
      <div className="notes-row">
        {record.notes.length === 0 && <span className="muted">No notes yet — leave the first one!</span>}
        {record.notes.map((n) => (
          <div key={n.id} className="sticky" style={{ background: n.color }}>
            {n.text}
            <button className="x" aria-label="Remove note" onClick={() => updateEasel(record.id, { notes: record.notes.filter((x) => x.id !== n.id) })}>
              ×
            </button>
          </div>
        ))}
      </div>
      <div className="field">
        <label htmlFor="note">Write a note</label>
        <div className="color-row" role="radiogroup" aria-label="Note colour" style={{ marginBottom: 6 }}>
          {NOTE_COLORS.map((c) => (
            <button key={c} className={`color-dot ${noteColor === c ? "selected" : ""}`} style={{ background: c }} onClick={() => setNoteColor(c)} aria-label={`Note colour ${c}`} role="radio" aria-checked={noteColor === c} />
          ))}
        </div>
        <form
          className="chat-form"
          onSubmit={(e) => {
            e.preventDefault();
            addNote();
          }}
        >
          <input id="note" className="text-input note-input" value={noteText} maxLength={140} onChange={(e) => setNoteText(e.target.value)} placeholder="I love the colours!" autoComplete="off" style={{ background: noteColor }} />
          <button type="submit" className="btn green" disabled={!noteText.trim()}>
            Stick it!
          </button>
        </form>
      </div>
    </Modal>
  );
}
