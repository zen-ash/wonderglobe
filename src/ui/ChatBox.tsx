"use client";
// Conversation with a creation (or a gallery picture). Uses the dialogue
// service when it's configured; otherwise clearly-labelled storybook replies.
// Optional microphone input asks for permission only when the mic is pressed.

import { useEffect, useRef, useState } from "react";
import type { ChatLine } from "@/core/types";
import { askCharacter } from "@/ai/services";
import { localReply } from "@/ai/localReplies";
import type { ChatCharacter, VoiceType } from "@/ai/schemas";
import { VoiceRecorder, microphoneAvailable, browserSpeechRecognitionAvailable, listenWithBrowser, type RecorderState } from "@/ai/mic";
import { transcribeAudio } from "@/ai/services";
import { speech } from "@/audio/speech";
import { useGame } from "@/state/store";
import { SendIcon, MicIcon, StopIcon, SpeakerIcon } from "./Icons";
import { playSfx } from "@/audio/sfx";

export function ChatBox({
  character,
  voiceType,
  lines,
  onLines,
  greeting,
}: {
  character: ChatCharacter;
  voiceType: VoiceType;
  lines: ChatLine[];
  onLines: (lines: ChatLine[]) => void;
  greeting: string;
}) {
  const services = useGame((s) => s.services);
  const voiceOn = useGame((s) => s.prefs.voice);
  const [text, setText] = useState("");
  const [thinking, setThinking] = useState(false);
  const [speakingVia, setSpeakingVia] = useState<string | null>(null);
  const [micState, setMicState] = useState<RecorderState | "listening">("idle");
  const [micError, setMicError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const abort = useRef<AbortController | null>(null);
  const recorder = useRef<VoiceRecorder | null>(null);
  const linesRef = useRef(lines);
  linesRef.current = lines;

  const canRecord = services.transcription && microphoneAvailable();
  const canBrowserListen = !services.transcription && browserSpeechRecognitionAvailable();

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [lines, thinking]);

  useEffect(
    () => () => {
      abort.current?.abort();
      recorder.current?.cancel();
      speech.stop();
    },
    [],
  );

  const say = async (line: string) => {
    if (!voiceOn) return;
    setSpeakingVia("…");
    const res = await speech.say({
      text: line,
      characterId: character.id,
      voiceType,
      kindId: character.kind,
      onStart: (via) => setSpeakingVia(via),
    });
    setSpeakingVia(null);
    return res;
  };

  const send = async (raw: string) => {
    const message = raw.trim().slice(0, 300);
    if (!message || thinking) return;
    setText("");
    playSfx("click");
    const history = linesRef.current.slice(-12).map((l) => ({ role: l.role, text: l.text.slice(0, 300) }));
    const withMine: ChatLine[] = [...linesRef.current, { role: "player", text: message, at: Date.now() }];
    onLines(withMine);
    setThinking(true);
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    let reply: string;
    let via: "ai" | "local" = "local";
    if (services.dialogue) {
      const res = await askCharacter({ character, history, message }, ctrl.signal);
      if (ctrl.signal.aborted) return;
      if (res.status === "ok") {
        reply = res.reply;
        via = "ai";
      } else {
        reply = localReply(character, message, history);
      }
    } else {
      // A tiny pause feels more natural for the storybook replies too.
      await new Promise((r) => setTimeout(r, 450));
      reply = localReply(character, message, history);
    }
    setThinking(false);
    const next: ChatLine[] = [...withMine, { role: "character", text: reply, via, at: Date.now() }];
    onLines(next.slice(-20));
    void say(reply);
  };

  const startMic = async () => {
    setMicError(null);
    if (canRecord) {
      const rec = new VoiceRecorder({ onStateChange: (s) => setMicState(s), onAutoStop: () => void stopMic() });
      recorder.current = rec;
      try {
        speech.stop();
        await rec.start();
      } catch {
        setMicError("I can't hear you — the microphone isn't allowed. You can type instead!");
        setMicState("idle");
      }
    } else if (canBrowserListen) {
      const ctrl = new AbortController();
      abort.current = ctrl;
      setMicState("listening");
      try {
        speech.stop();
        const heard = await listenWithBrowser(ctrl.signal);
        setMicState("idle");
        if (heard) await send(heard);
      } catch {
        setMicState("idle");
        setMicError("I didn't catch that. Try again or type instead!");
      }
    }
  };

  const stopMic = async () => {
    const rec = recorder.current;
    if (!rec) {
      abort.current?.abort();
      setMicState("idle");
      return;
    }
    try {
      const blob = await rec.stop();
      const res = await transcribeAudio(blob);
      rec.finish();
      recorder.current = null;
      setMicState("idle");
      if (res.status === "ok" && res.text.trim()) await send(res.text);
      else setMicError("I didn't catch that. Try again or type instead!");
    } catch {
      rec.cancel();
      recorder.current = null;
      setMicState("idle");
      setMicError("I didn't catch that. Try again or type instead!");
    }
  };

  const recording = micState === "recording" || micState === "listening" || micState === "requesting";
  const lastCharacter = [...lines].reverse().find((l) => l.role === "character");

  return (
    <div className="chat">
      <div className="chat-log" ref={logRef} aria-live="polite">
        {lines.length === 0 && <div className="bubble">{greeting}</div>}
        {lines.map((l, i) => (
          <div key={i} className={`bubble ${l.role === "player" ? "me" : ""}`}>
            {l.text}
            {l.role === "character" && l.via === "local" && (
              <span className="meta">
                <span className="tag local" title="The talking helper isn't connected, so this is a simple built-in reply.">
                  storybook reply
                </span>
              </span>
            )}
          </div>
        ))}
        {thinking && (
          <div className="bubble" aria-label="Thinking">
            <span className="spinner-small" style={{ width: 18, height: 18, borderWidth: 3 }} />
          </div>
        )}
      </div>
      <form
        className="chat-form"
        onSubmit={(e) => {
          e.preventDefault();
          void send(text);
        }}
      >
        <input
          className="text-input"
          value={text}
          maxLength={300}
          onChange={(e) => setText(e.target.value)}
          placeholder={`Say something to ${character.name}…`}
          aria-label={`Message to ${character.name}`}
          autoComplete="off"
          enterKeyHint="send"
        />
        {(canRecord || canBrowserListen) && (
          <button
            type="button"
            className={`icon-btn mic-btn ${recording ? "recording" : ""}`}
            onClick={() => (recording ? void stopMic() : void startMic())}
            aria-label={recording ? "Stop recording" : "Talk with the microphone"}
            title={recording ? "Stop" : "Talk"}
            disabled={micState === "processing"}
          >
            {micState === "processing" ? <span className="spinner-small" /> : recording ? <StopIcon /> : <MicIcon />}
          </button>
        )}
        <button type="submit" className="btn blue" disabled={!text.trim() || thinking} aria-label="Send">
          <SendIcon /> <span className="send-label">Send</span>
        </button>
      </form>
      <div className="small muted" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", fontWeight: 600 }}>
        {micState === "requesting" && <span>Asking to use the microphone…</span>}
        {micState === "recording" && <span style={{ color: "#c0392b" }}>● Listening… tap the square to stop</span>}
        {micState === "listening" && <span style={{ color: "#c0392b" }}>● Listening…</span>}
        {micState === "processing" && <span>Working out what you said…</span>}
        {micError && <span style={{ color: "#b8322a" }}>{micError}</span>}
        {speakingVia && speakingVia !== "…" && <span>🔊 Speaking{speakingVia === "browser" ? " (device voice)" : ""}</span>}
        {lastCharacter && voiceOn && !speakingVia && (
          <button type="button" className="chip-btn" onClick={() => void say(lastCharacter.text)} style={{ minHeight: 34, padding: "0.1rem 0.6rem" }}>
            <SpeakerIcon width={18} height={18} style={{ verticalAlign: -3 }} /> Say it again
          </button>
        )}
      </div>
    </div>
  );
}
