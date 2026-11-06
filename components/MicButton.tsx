"use client";

// 按住說話的麥克風按鈕（第五章 5.4、第七章 7.1）
// - server 模式：MediaRecorder 錄音 → 放開後上傳 /api/stt（ElevenLabs Speech-to-Text）
// - browser 模式：沒有設定 ElevenLabs 時，改用瀏覽器內建的 Web Speech API（免費替代方案）
// - 錄音中按鈕變紅並顯示秒數；最長 30 秒自動停止
// - 滑鼠、觸控、鍵盤（按住空白鍵或 Enter）都能操作

import { useCallback, useEffect, useRef, useState } from "react";

const MAX_SECONDS = 30;

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type RecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export type MicMode = "server" | "browser";

export function MicButton({
  serverStt,
  disabled,
  onStart,
  onInterim,
  onTranscript,
  onError,
}: {
  serverStt: boolean;
  disabled?: boolean;
  onStart?: () => void;
  onInterim?: (text: string) => void;
  onTranscript: (text: string) => void;
  onError: (msg: string) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [supported, setSupported] = useState<MicMode | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const stopRequestedRef = useRef(false);
  const transcriptRef = useRef("");

  useEffect(() => {
    const canRecord = typeof window !== "undefined" && "MediaRecorder" in window && !!navigator.mediaDevices?.getUserMedia;
    if (serverStt && canRecord) setSupported("server");
    else if (getRecognitionCtor()) setSupported("browser");
    else setSupported(null);
  }, [serverStt]);

  // 錄音秒數與 30 秒上限
  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => {
      const s = Math.floor((Date.now() - startedAtRef.current) / 1000);
      setSeconds(s);
      if (s >= MAX_SECONDS) stop();
    }, 250);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording]);

  const releaseMic = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const upload = useCallback(
    async (blob: Blob, durationMs: number) => {
      if (durationMs < 500 || blob.size < 1000) {
        onError("錄音太短了，請按住按鈕說完再放開。");
        return;
      }
      setBusy(true);
      try {
        const form = new FormData();
        const ext = blob.type.includes("mp4") ? "m4a" : "webm";
        form.append("file", blob, `speech.${ext}`);
        const r = await fetch("/api/stt", { method: "POST", body: form });
        const data = (await r.json().catch(() => ({}))) as { text?: string; error?: string };
        if (!r.ok) throw new Error(data.error || `語音辨識失敗（${r.status}）`);
        if (!data.text) throw new Error("沒有聽清楚，可以再說一次嗎？");
        onTranscript(data.text);
      } catch (e) {
        onError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [onError, onTranscript],
  );

  const start = useCallback(async () => {
    if (disabled || busy || recording || !supported) return;
    stopRequestedRef.current = false;
    onStart?.();

    if (supported === "browser") {
      const Ctor = getRecognitionCtor()!;
      const rec = new Ctor();
      rec.lang = "zh-TW";
      rec.continuous = true;
      rec.interimResults = true;
      transcriptRef.current = "";
      rec.onresult = (e) => {
        let finalText = "";
        let interim = "";
        for (let i = 0; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) finalText += r[0].transcript;
          else interim += r[0].transcript;
        }
        transcriptRef.current = finalText + interim;
        onInterim?.(transcriptRef.current);
      };
      rec.onerror = (e) => {
        if (e.error === "not-allowed") onError("沒有麥克風權限，請在瀏覽器設定中允許使用麥克風。");
        else if (e.error !== "aborted" && e.error !== "no-speech") onError(`語音辨識錯誤：${e.error}`);
      };
      rec.onend = () => {
        setRecording(false);
        const text = transcriptRef.current.trim();
        if (text) onTranscript(text);
      };
      recognitionRef.current = rec;
      startedAtRef.current = Date.now();
      setSeconds(0);
      setRecording(true);
      rec.start();
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      if (stopRequestedRef.current) {
        // 使用者在授權視窗出現時就已經放開按鈕
        releaseMic();
        return;
      }
      const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((t) => MediaRecorder.isTypeSupported(t));
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data);
      rec.onstop = () => {
        const duration = Date.now() - startedAtRef.current;
        releaseMic();
        setRecording(false);
        void upload(new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" }), duration);
      };
      recorderRef.current = rec;
      startedAtRef.current = Date.now();
      setSeconds(0);
      setRecording(true);
      rec.start();
    } catch {
      releaseMic();
      onError("無法使用麥克風，請確認已允許瀏覽器使用麥克風。");
    }
  }, [busy, disabled, onError, onInterim, onStart, onTranscript, recording, supported, upload]);

  const stop = useCallback(() => {
    stopRequestedRef.current = true;
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    recorderRef.current = null;
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
  }, []);

  useEffect(() => () => {
    stop();
    releaseMic();
  }, [stop]);

  const unavailable = supported === null;
  const label = unavailable
    ? "這個瀏覽器不支援語音輸入"
    : recording
      ? `錄音中 ${seconds} 秒，放開即送出`
      : busy
        ? "辨識中"
        : "按住說話";

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={recording}
      disabled={disabled || busy || unavailable}
      onPointerDown={(e) => {
        e.preventDefault();
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        void start();
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onKeyDown={(e) => {
        if ((e.key === " " || e.key === "Enter") && !e.repeat) {
          e.preventDefault();
          void start();
        }
      }}
      onKeyUp={(e) => {
        if (e.key === " " || e.key === "Enter") stop();
      }}
      onContextMenu={(e) => e.preventDefault()}
      className={`flex h-12 shrink-0 select-none items-center justify-center gap-1 rounded-full px-4 text-sm font-medium transition [touch-action:none] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-gold disabled:cursor-not-allowed disabled:opacity-40 ${
        recording ? "bg-red-600 text-white shadow-lg ring-4 ring-red-200" : "bg-navy-50 text-navy hover:bg-navy-100"
      }`}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
        <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-2.08A7 7 0 0 0 19 12h-2Z" />
      </svg>
      <span className="hidden sm:inline">{recording ? `${seconds}s` : busy ? "辨識中…" : "按住說話"}</span>
      {recording && <span className="sm:hidden">{seconds}s</span>}
    </button>
  );
}
