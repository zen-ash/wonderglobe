"use client";
// Root of the game UI: screens, panels, audio wiring, drag-and-drop uploads
// and recovery when something goes wrong.

import { Component, useEffect, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { useGame } from "@/state/store";
import { fetchServiceStatus } from "@/ai/services";
import { unlockAudio, onAudioUnlocked, setMusicEnabled, setMusicVolume, setSoundEnabled, setSoundVolume, isAudioUnlocked } from "@/audio/engine";
import { startMusic, stopMusic, setMusicFlavor } from "@/audio/music";
import { speech } from "@/audio/speech";
import { TitleScreen } from "./TitleScreen";
import { GameLayer } from "./GameLayer";
import { WorldLabels } from "./WorldLabels";
import { Hud } from "./Hud";
import { DrawingBoard } from "./DrawingBoard";
import { UploadPanel, setDroppedFile } from "./UploadPanel";
import { SamplesPanel } from "./SamplesPanel";
import { LifePanel } from "./LifePanel";
import { CreationPanel } from "./CreationPanel";
import { EaselForm, EaselPanel } from "./GalleryPanels";
import { CollectionDrawer } from "./CollectionDrawer";
import { SettingsPanel } from "./SettingsPanel";
import { HelpPanel } from "./HelpPanel";
import { restorePending } from "./artworkFlow";
import { setCloseUp } from "@/render/cameraControl";

const GameCanvas = dynamic(() => import("@/render/GameCanvas"), {
  ssr: false,
  loading: () => <LoadingScreen text="Unfolding your planet…" />,
});

function LoadingScreen({ text }: { text: string }) {
  return (
    <div className="loading-screen" role="status">
      <div className="spinner-planet" />
      {text}
    </div>
  );
}

class CanvasBoundary extends Component<{ children: ReactNode; onLighter: () => void; onHome: () => void }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error("World view crashed", error);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="error-screen">
        <div className="paper" style={{ padding: 24, maxWidth: 460, textAlign: "center" }}>
          <div style={{ fontSize: "3rem" }}>🙈</div>
          <h2>Oops, the planet got crumpled!</h2>
          <p style={{ fontWeight: 600 }}>Your drawings are safe. Let&apos;s try again — lighter graphics can help on some devices.</p>
          <div className="panel-actions" style={{ justifyContent: "center" }}>
            <button
              className="btn green"
              onClick={() => {
                this.props.onLighter();
                this.setState({ error: null });
              }}
            >
              Try lighter graphics
            </button>
            <button className="btn paper-btn" onClick={this.props.onHome}>
              Back to the start
            </button>
          </div>
        </div>
      </div>
    );
  }
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const fn = () => setReduced(mq.matches);
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);
  return reduced;
}

export default function App() {
  const screen = useGame((s) => s.screen);
  const loadingText = useGame((s) => s.loadingText);
  const mode = useGame((s) => s.mode);
  const panel = useGame((s) => s.panel);
  const prefs = useGame((s) => s.prefs);
  const runtime = useGame((s) => s.runtime);
  const creations = useGame((s) => s.world?.creations);
  const easels = useGame((s) => s.world?.easels);
  const osReduced = usePrefersReducedMotion();
  const reducedMotion = prefs.reducedMotion || osReduced;
  const [contextLost, setContextLost] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [readyFor, setReadyFor] = useState<unknown>(null);

  // Boot: preferences and which helpers the server offers.
  useEffect(() => {
    useGame.getState().init();
    void fetchServiceStatus().then((s) => useGame.getState().setServices(s));
  }, []);

  // Audio starts only after the first tap or key press.
  useEffect(() => {
    const unlock = () => unlockAudio();
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    const off = onAudioUnlocked(() => {
      if (useGame.getState().prefs.music) startMusic();
    });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      off();
    };
  }, []);

  useEffect(() => {
    setMusicEnabled(prefs.music);
    setMusicVolume(prefs.musicVolume);
    setSoundEnabled(prefs.sound);
    setSoundVolume(prefs.soundVolume);
    speech.setVoiceEnabled(prefs.voice);
    if (isAudioUnlocked()) {
      if (prefs.music) startMusic();
      else stopMusic();
    }
  }, [prefs.music, prefs.musicVolume, prefs.sound, prefs.soundVolume, prefs.voice]);

  useEffect(() => {
    if (mode) setMusicFlavor(mode);
  }, [mode]);

  // Bring back a drawing that was waiting when the page closed.
  useEffect(() => {
    if (screen !== "playing" || !mode) return;
    let alive = true;
    void restorePending(mode).then((p) => {
      if (alive && p && !useGame.getState().pending) useGame.getState().setPending(p);
    });
    return () => {
      alive = false;
    };
  }, [screen, mode]);

  // Look closely at whatever creation or picture is open in a panel.
  const selectedId = useGame((s) => s.selectedId);
  useEffect(() => {
    setCloseUp((panel === "creation" || panel === "easel") && selectedId ? selectedId : null);
  }, [panel, selectedId]);

  // Recover from a lost WebGL context.
  useEffect(() => {
    const onLost = (e: Event) => {
      e.preventDefault();
      setContextLost(true);
    };
    document.addEventListener("webglcontextlost", onLost, true);
    return () => document.removeEventListener("webglcontextlost", onLost, true);
  }, []);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (screen !== "playing") return;
    const f = e.dataTransfer.files?.[0];
    if (!f) return;
    setDroppedFile(f);
    useGame.getState().openPanel(null);
    setTimeout(() => useGame.getState().openPanel("upload"), 0);
  };

  return (
    <div
      className={`app-root ${reducedMotion ? "reduced-motion" : ""}`}
      onDragOver={(e) => {
        if (screen === "playing" && e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={onDrop}
    >
      {screen === "title" && <TitleScreen />}
      {screen === "loading" && <LoadingScreen text={loadingText || "Loading…"} />}
      {screen === "playing" && runtime && mode && (
        <CanvasBoundary onLighter={() => useGame.getState().setPrefs({ lightGraphics: true })} onHome={() => void useGame.getState().leaveWorld()}>
          <GameCanvas
            key={`${mode}-${runtime.seed}-${prefs.lightGraphics ? "l" : "h"}`}
            runtime={runtime}
            mode={mode}
            creations={creations ?? []}
            easels={easels ?? []}
            lightGraphics={prefs.lightGraphics}
            reducedMotion={reducedMotion}
            onReady={() => setReadyFor(runtime)}
            timeMode={prefs.timeMode}
          />
          {readyFor === runtime ? (
            <>
              <WorldLabels />
              <Hud />
              <GameLayer />
            </>
          ) : (
            <LoadingScreen text="Unfolding your planet…" />
          )}
        </CanvasBoundary>
      )}

      {panel === "draw" && <DrawingBoard />}
      {panel === "upload" && <UploadPanel />}
      {panel === "samples" && <SamplesPanel />}
      {panel === "life" && <LifePanel />}
      {panel === "creation" && <CreationPanel />}
      {panel === "easel" && <EaselPanel />}
      {panel === "easelForm" && <EaselForm />}
      {panel === "collection" && <CollectionDrawer />}
      {panel === "settings" && <SettingsPanel />}
      {panel === "help" && <HelpPanel />}

      {dragging && (
        <div className="modal-backdrop" style={{ pointerEvents: "none" }}>
          <div className="paper" style={{ padding: "24px 30px", fontSize: "1.4rem", fontWeight: 700 }}>
            📥 Drop your picture to add it!
          </div>
        </div>
      )}

      {contextLost && (
        <div className="error-screen">
          <div className="paper" style={{ padding: 24, maxWidth: 440, textAlign: "center" }}>
            <h2>The planet needs a little rest</h2>
            <p style={{ fontWeight: 600 }}>Your world is saved. Tap below to wake it up again.</p>
            <button className="btn green" onClick={() => window.location.reload()}>
              Wake it up
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
