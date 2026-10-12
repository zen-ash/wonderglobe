// Microphone capture for talking to characters. The microphone is requested
// ONLY when start() is called (i.e. after the player pressed the mic button),
// and tracks are released as soon as recording stops.

export type RecorderState = "idle" | "requesting" | "recording" | "processing" | "error";

export const MAX_RECORDING_MS = 12_000;

export interface VoiceRecorderOptions {
  maxMs?: number;
  onStateChange?: (state: RecorderState) => void;
  /** Called when recording stopped automatically (time limit); stop() then resolves with the blob. */
  onAutoStop?: () => void;
}

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4", "audio/wav"];
  return candidates.find((t) => MediaRecorder.isTypeSupported?.(t));
}

export function microphoneAvailable(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== "undefined"
  );
}

export class VoiceRecorder {
  private _state: RecorderState = "idle";
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private result: Promise<Blob> | null = null;
  private cancelled = false;
  /** Last error (e.g. permission denied), if state is "error". */
  error: Error | null = null;

  constructor(private readonly opts: VoiceRecorderOptions = {}) {}

  get state(): RecorderState {
    return this._state;
  }

  private setState(s: RecorderState): void {
    this._state = s;
    this.opts.onStateChange?.(s);
  }

  /** Ask for the microphone (first time shows the browser prompt) and start recording. */
  async start(): Promise<void> {
    if (this._state === "requesting" || this._state === "recording") return;
    if (!microphoneAvailable()) {
      this.fail(new Error("Microphone recording is not supported in this browser"));
      throw this.error;
    }
    this.cancelled = false;
    this.error = null;
    this.chunks = [];
    this.setState("requesting");
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      });
    } catch (e) {
      this.fail(e instanceof Error ? e : new Error(String(e)));
      throw this.error;
    }
    if (this.cancelled) {
      this.releaseTracks();
      this.setState("idle");
      return;
    }
    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(this.stream, mimeType ? { mimeType, audioBitsPerSecond: 32_000 } : undefined);
    this.recorder = recorder;
    recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) this.chunks.push(ev.data);
    };
    this.result = new Promise<Blob>((resolve, reject) => {
      recorder.onstop = () => {
        this.clearTimer();
        this.releaseTracks();
        const type = recorder.mimeType || mimeType || "audio/webm";
        const blob = new Blob(this.chunks, { type: type.split(";")[0] });
        this.chunks = [];
        if (this.cancelled) reject(new DOMException("Recording cancelled", "AbortError"));
        else resolve(blob);
      };
      recorder.onerror = () => {
        this.clearTimer();
        this.releaseTracks();
        reject(new Error("Recording failed"));
      };
    });
    // Avoid unhandled rejection warnings if nobody awaits a cancelled recording.
    this.result.catch(() => undefined);
    recorder.start(250);
    this.setState("recording");
    this.timer = setTimeout(() => {
      if (this.recorder?.state === "recording") {
        this.recorder.stop();
        this.setState("processing");
        this.opts.onAutoStop?.();
      }
    }, this.opts.maxMs ?? MAX_RECORDING_MS);
  }

  /**
   * Stop recording and get the audio. State moves to "processing"; call
   * `finish()` (or `cancel()`) once you're done with the blob to return to "idle".
   */
  async stop(): Promise<Blob> {
    if (!this.result) throw new Error("Not recording");
    if (this.recorder?.state === "recording") {
      this.recorder.stop();
      this.setState("processing");
    }
    try {
      return await this.result;
    } catch (e) {
      this.fail(e instanceof Error ? e : new Error(String(e)));
      throw e;
    } finally {
      this.result = null;
      this.recorder = null;
    }
  }

  /** Mark processing finished (e.g. after transcription) and return to idle. */
  finish(): void {
    if (this._state !== "recording" && this._state !== "requesting") this.setState("idle");
  }

  /** Abort without producing audio; releases the microphone immediately. */
  cancel(): void {
    this.cancelled = true;
    this.clearTimer();
    if (this.recorder && this.recorder.state !== "inactive") {
      try {
        this.recorder.stop();
      } catch {
        /* ignore */
      }
    }
    this.recorder = null;
    this.result = null;
    this.releaseTracks();
    this.chunks = [];
    if (this._state !== "requesting") this.setState("idle");
  }

  private fail(err: Error): void {
    this.error = err;
    this.clearTimer();
    this.releaseTracks();
    this.setState("error");
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private releaseTracks(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }
}

// ---------------------------------------------------------------- browser speech recognition

/** Minimal Web Speech API typings (not in lib.dom for all TS versions). */
export interface SpeechRecognitionAlternativeLike {
  transcript: string;
  confidence: number;
}
export interface SpeechRecognitionResultLike {
  readonly length: number;
  readonly isFinal: boolean;
  [index: number]: SpeechRecognitionAlternativeLike;
}
export interface SpeechRecognitionEventLike extends Event {
  readonly resultIndex: number;
  readonly results: { readonly length: number; [index: number]: SpeechRecognitionResultLike };
}
export interface SpeechRecognitionErrorEventLike extends Event {
  readonly error: string;
}
export interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((ev: SpeechRecognitionErrorEventLike) => void) | null;
  onend: ((ev: Event) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
export type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function browserSpeechRecognitionAvailable(): boolean {
  return getSpeechRecognitionCtor() !== null;
}

/**
 * Fallback when server transcription is unavailable: listen once with the
 * browser's built-in recogniser (may use the browser vendor's service).
 * Resolves with the transcript ("" if nothing was heard); rejects if
 * unsupported, denied, or aborted via `signal`.
 */
export function listenWithBrowser(signal?: AbortSignal, lang?: string): Promise<string> {
  const Ctor = getSpeechRecognitionCtor();
  if (!Ctor) return Promise.reject(new Error("Speech recognition is not supported in this browser"));
  if (signal?.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));

  return new Promise<string>((resolve, reject) => {
    const rec = new Ctor();
    rec.lang = lang ?? (typeof navigator !== "undefined" ? navigator.language : "en-US") ?? "en-US";
    rec.continuous = false;
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    let transcript = "";
    let settled = false;
    const limit = setTimeout(() => rec.stop(), MAX_RECORDING_MS);

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(limit);
      signal?.removeEventListener("abort", onAbort);
      fn();
    };
    const onAbort = () => {
      try {
        rec.abort();
      } catch {
        /* ignore */
      }
      finish(() => reject(new DOMException("Aborted", "AbortError")));
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    rec.onresult = (ev) => {
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal && r[0]) transcript += r[0].transcript;
      }
    };
    rec.onerror = (ev) => {
      if (ev.error === "no-speech" || ev.error === "aborted") finish(() => resolve(transcript.trim()));
      else finish(() => reject(new Error(`Speech recognition error: ${ev.error}`)));
    };
    rec.onend = () => finish(() => resolve(transcript.trim().slice(0, 300)));
    try {
      rec.start();
    } catch (e) {
      finish(() => reject(e instanceof Error ? e : new Error(String(e))));
    }
  });
}
