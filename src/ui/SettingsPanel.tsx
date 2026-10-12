"use client";
// Settings in plain language: sound, motion, graphics, fullscreen, name,
// saving the world to a file and loading it back.

import { useRef, useState } from "react";
import { Modal } from "./Modal";
import { MusicIcon, BellIcon, VoiceIcon, SnailIcon, FeatherIcon, ExpandIcon, DownloadIcon, OpenFileIcon, HomeIcon } from "./Icons";
import { useGame } from "@/state/store";
import { exportWorld, exportFileName, parseWorldFile, importWorld, ImportError, type ParsedImport } from "@/persistence";
import { playSfx } from "@/audio/sfx";

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button className={`toggle ${on ? "on" : ""}`} role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} />;
}

export function SettingsPanel() {
  const prefs = useGame((s) => s.prefs);
  const services = useGame((s) => s.services);
  const mode = useGame((s) => s.mode);
  const { setPrefs, openPanel, toast, flushSave, replaceWorld, leaveWorld } = useGame.getState();
  const [busy, setBusy] = useState<string | null>(null);
  const [importInfo, setImportInfo] = useState<ParsedImport | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [fullscreen, setFullscreen] = useState(typeof document !== "undefined" && !!document.fullscreenElement);

  const doExport = async () => {
    if (!mode) return;
    setBusy("export");
    try {
      await flushSave();
      const blob = await exportWorld(mode);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = exportFileName(mode);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast("Your world was saved to a file!", "happy");
      playSfx("chime");
    } catch (e) {
      toast((e as Error).message || "Couldn't save the file.", "warn");
    } finally {
      setBusy(null);
    }
  };

  const pickImport = async (file: File) => {
    setImportError(null);
    setImportInfo(null);
    setBusy("import");
    try {
      const parsed = await parseWorldFile(file);
      setImportInfo(parsed);
    } catch (e) {
      setImportError(e instanceof ImportError ? e.message : "That file couldn't be opened.");
      playSfx("error");
    } finally {
      setBusy(null);
    }
  };

  const confirmImport = async () => {
    if (!importInfo) return;
    setBusy("import");
    try {
      const world = await importWorld(importInfo);
      setImportInfo(null);
      openPanel(null);
      toast("World loaded! Welcome back.", "happy");
      await replaceWorld(world);
    } catch (e) {
      setImportError((e as Error).message || "Couldn't load that world.");
    } finally {
      setBusy(null);
    }
  };

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
      setFullscreen(!!document.fullscreenElement);
    } catch {
      toast("Full screen isn't available here.", "warn");
    }
  };

  const ServiceDot = ({ on }: { on: boolean }) => <span className="dot" style={{ background: on ? "#7fcf63" : "#e8dcc2" }} />;

  return (
    <Modal title="Settings" onClose={() => openPanel(null)}>
      <div className="setting-row">
        <span className="what">
          <MusicIcon /> Music
        </span>
        <Toggle label="Music" on={prefs.music} onChange={(v) => setPrefs({ music: v })} />
      </div>
      {prefs.music && (
        <div className="setting-row">
          <span className="what small">Music volume</span>
          <input className="range" style={{ maxWidth: 220 }} type="range" min={0} max={1} step={0.05} value={prefs.musicVolume} onChange={(e) => setPrefs({ musicVolume: Number(e.target.value) })} aria-label="Music volume" />
        </div>
      )}
      <div className="setting-row">
        <span className="what">
          <BellIcon /> Sounds
        </span>
        <Toggle label="Sounds" on={prefs.sound} onChange={(v) => setPrefs({ sound: v })} />
      </div>
      {prefs.sound && (
        <div className="setting-row">
          <span className="what small">Sound volume</span>
          <input className="range" style={{ maxWidth: 220 }} type="range" min={0} max={1} step={0.05} value={prefs.soundVolume} onChange={(e) => setPrefs({ soundVolume: Number(e.target.value) })} aria-label="Sound volume" />
        </div>
      )}
      <div className="setting-row">
        <span className="what">
          <VoiceIcon /> Talking out loud
        </span>
        <Toggle label="Talking out loud" on={prefs.voice} onChange={(v) => setPrefs({ voice: v })} />
      </div>
      <div className="setting-row">
        <span className="what">
          <SnailIcon /> Calm motion
        </span>
        <Toggle label="Calm motion" on={prefs.reducedMotion} onChange={(v) => setPrefs({ reducedMotion: v })} />
      </div>
      <div className="setting-row">
        <span className="what">
          <FeatherIcon /> Lighter graphics
        </span>
        <Toggle label="Lighter graphics" on={prefs.lightGraphics} onChange={(v) => setPrefs({ lightGraphics: v })} />
      </div>
      <div className="setting-row">
        <span className="what">
          <span aria-hidden style={{ fontSize: 26, width: 30, textAlign: "center" }}>🌙</span> Day and night
        </span>
        <div className="seg" style={{ margin: 0 }} role="radiogroup" aria-label="Day and night">
          {(
            [
              ["cycle", "Day & night"],
              ["real", "Real clock"],
              ["day", "Always day"],
            ] as const
          ).map(([m, label]) => (
            <button key={m} className={`chip-btn ${prefs.timeMode === m ? "on" : ""}`} onClick={() => setPrefs({ timeMode: m })} role="radio" aria-checked={prefs.timeMode === m}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="setting-row">
        <span className="what">
          <ExpandIcon /> Full screen
        </span>
        <button className="chip-btn" onClick={toggleFullscreen}>
          {fullscreen ? "Exit" : "Go full screen"}
        </button>
      </div>
      <div className="field" style={{ marginTop: 12 }}>
        <label htmlFor="pname">Your artist name</label>
        <input id="pname" className="text-input" value={prefs.playerName} maxLength={40} onChange={(e) => setPrefs({ playerName: e.target.value })} placeholder="Used for your gallery pictures" />
      </div>

      <h3 className="section-title">Keep your world</h3>
      <p className="small muted" style={{ marginTop: 0 }}>
        Your world saves by itself in this browser. You can also save it as a file to keep or move it to another computer.
      </p>
      <div className="panel-actions">
        <button className="btn blue" onClick={doExport} disabled={!!busy}>
          {busy === "export" ? <span className="spinner-small" /> : <DownloadIcon />} Save to a file
        </button>
        <button className="btn paper-btn" onClick={() => fileRef.current?.click()} disabled={!!busy}>
          {busy === "import" ? <span className="spinner-small" /> : <OpenFileIcon />} Load from a file
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="visually-hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void pickImport(f);
          }}
        />
      </div>
      {importError && <p style={{ color: "#b8322a", fontWeight: 700 }}>{importError}</p>}
      {importInfo && (
        <div className="paper-sm" style={{ padding: 12, margin: "8px 0" }}>
          <p style={{ margin: "0 0 6px", fontWeight: 700 }}>
            This file has a {importInfo.mode === "paper" ? "Living Paper World" : "Miniature Gallery World"} with{" "}
            {importInfo.mode === "paper" ? plural(importInfo.world.creations.length, "creation") : plural(importInfo.world.easels.length, "picture on an easel", "pictures on easels")}.
          </p>
          {importInfo.warnings.map((w, i) => (
            <p key={i} className="small" style={{ margin: "0 0 4px" }}>
              ⚠️ {w}
            </p>
          ))}
          <p className="small" style={{ margin: "0 0 8px" }}>
            Loading it will replace the {importInfo.mode === "paper" ? "Paper" : "Gallery"} world in this browser.
          </p>
          <div className="panel-actions" style={{ margin: 0 }}>
            <button className="btn paper-btn" onClick={() => setImportInfo(null)}>
              Cancel
            </button>
            <button className="btn green" onClick={confirmImport} disabled={busy === "import"}>
              Load it
            </button>
          </div>
        </div>
      )}

      <h3 className="section-title">Helpers</h3>
      <div className="services">
        <span>
          <ServiceDot on={services.recognition} /> Picture helper (guesses what you drew): {services.recognition ? "on" : "off — you choose what it is"}
        </span>
        <span>
          <ServiceDot on={services.dialogue} /> Chatty characters: {services.dialogue ? "on" : "off — simple storybook replies"}
        </span>
        <span>
          <ServiceDot on={services.voice} /> Character voices: {services.voice ? "on" : "off — using this device's voice if it has one"}
        </span>
        <span>
          <ServiceDot on={services.transcription || (typeof window !== "undefined" && ("webkitSpeechRecognition" in window || "SpeechRecognition" in window))} /> Talking with the microphone:{" "}
          {services.transcription ? "on" : "using this device if it can"}
        </span>
      </div>

      <div className="panel-actions" style={{ marginTop: 14 }}>
        <button className="btn paper-btn" onClick={() => void leaveWorld()}>
          <HomeIcon /> Back to the start
        </button>
      </div>
    </Modal>
  );
}
