"use client";

// 首頁主程式：左邊角色區（40%）、右邊對話區（60%）；手機版角色區縮成頂部 160px 的橫條（第七章 7.2）。
// 資料流：送出問題 → /api/chat 串流回傳 → 一邊顯示文字、一邊把完整句子交給語音播放器 → 角色切換狀態。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AGENT, type AvatarState } from "@/lib/agent";
import { SpeechPlayer, takeSentences, type PlayerState } from "@/lib/client/speech-player";
import type { AgentEvent, ServerConfig, UiMessage } from "@/lib/client/types";
import { Avatar } from "./Avatar";
import { ChatPanel } from "./ChatPanel";
import { VoiceControls } from "./VoiceControls";

const SETTINGS_KEY = "talking-agent:settings";
let idCounter = 0;
const newId = () => `m${Date.now().toString(36)}${(idCounter++).toString(36)}`;

const WELCOME: UiMessage = { id: "welcome", role: "assistant", content: AGENT.welcome, local: true };

export function AgentApp() {
  const [config, setConfig] = useState<ServerConfig | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([WELCOME]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [playerState, setPlayerState] = useState<PlayerState>("idle");
  const [muted, setMuted] = useState(false);
  const [textOnly, setTextOnly] = useState(false);
  const [rate, setRate] = useState(1);

  const playerRef = useRef<SpeechPlayer | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const voiceOn = !muted && !textOnly;
  const voiceOnRef = useRef(voiceOn);
  voiceOnRef.current = voiceOn;

  // 讀取伺服器設定（哪些服務有金鑰）與使用者偏好
  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((c: ServerConfig) => setConfig(c))
      .catch(() => setConfig({ chat: false, model: null, tts: false, stt: false, vectorSearch: false, chunks: 0 }));
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") as Partial<{ muted: boolean; textOnly: boolean; rate: number }>;
      if (typeof saved.muted === "boolean") setMuted(saved.muted);
      if (typeof saved.textOnly === "boolean") setTextOnly(saved.textOnly);
      if (saved.rate === 0.8 || saved.rate === 1 || saved.rate === 1.2) setRate(saved.rate);
    } catch {
      // 無痕模式等情況讀不到也沒關係
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ muted, textOnly, rate }));
    } catch {
      // 忽略
    }
  }, [muted, textOnly, rate]);

  const player = useCallback(() => {
    playerRef.current ??= new SpeechPlayer(setPlayerState, config?.tts ?? false, AGENT.voice.browserLang);
    return playerRef.current;
  }, [config?.tts]);

  useEffect(() => {
    playerRef.current?.setUseServerTts(config?.tts ?? false);
  }, [config?.tts]);

  useEffect(() => {
    playerRef.current?.setRate(rate);
  }, [rate]);

  useEffect(() => {
    if (!voiceOn) playerRef.current?.stop();
  }, [voiceOn]);

  const getLevel = useCallback(() => playerRef.current?.getLevel() ?? null, []);

  const updateMsg = (id: string, fn: (m: UiMessage) => UiMessage) =>
    setMessages((ms) => ms.map((m) => (m.id === id ? fn(m) : m)));

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || busy) return;
      setNotice(null);
      setInput("");

      // 在使用者手勢中解鎖音訊（iOS Safari 必須先點擊才能播放）
      const p = player();
      p.stop();
      if (voiceOnRef.current) p.unlock();

      const history = messages
        .filter((m) => !m.local && !m.error && m.content.trim())
        .map((m) => ({ role: m.role, content: m.content }));
      const userMsg: UiMessage = { id: newId(), role: "user", content: text };
      const botId = newId();
      setMessages((ms) => [...ms, userMsg, { id: botId, role: "assistant", content: "", pending: true }]);
      setBusy(true);

      const ac = new AbortController();
      abortRef.current = ac;
      let sentenceBuf = "";
      const speak = (chunk: string, flush = false) => {
        if (!voiceOnRef.current) return;
        sentenceBuf += chunk;
        const { sentences, rest } = takeSentences(sentenceBuf);
        sentences.forEach((s) => p.enqueue(s));
        sentenceBuf = rest;
        if (flush && sentenceBuf.trim()) {
          p.enqueue(sentenceBuf);
          sentenceBuf = "";
        }
      };

      const handle = (e: AgentEvent) => {
        switch (e.type) {
          case "meta":
            updateMsg(botId, (m) => ({ ...m, sources: e.sources, alerts: e.alerts, redacted: e.redacted, mode: e.mode }));
            break;
          case "delta":
            updateMsg(botId, (m) => ({ ...m, content: m.content + e.text }));
            speak(e.text);
            break;
          case "reset":
            p.stop();
            sentenceBuf = "";
            updateMsg(botId, (m) => ({ ...m, content: e.text }));
            break;
          case "tool":
            updateMsg(botId, (m) => ({ ...m, tools: [...(m.tools ?? []), { name: e.name, input: e.input, result: e.result, error: e.error }] }));
            break;
          case "error":
            updateMsg(botId, (m) => ({ ...m, error: e.message }));
            break;
          case "done":
            speak("", true);
            break;
        }
      };

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: [...history, { role: "user", content: text }] }),
          signal: ac.signal,
        });
        if (!res.ok || !res.body) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error || `伺服器錯誤（${res.status}）`);
        }
        // 讀取 NDJSON 串流：每一行是一個事件
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (line) handle(JSON.parse(line) as AgentEvent);
          }
        }
        if (buf.trim()) handle(JSON.parse(buf) as AgentEvent);
        speak("", true);
      } catch (err) {
        if (!ac.signal.aborted) {
          updateMsg(botId, (m) => ({ ...m, error: (err as Error).message || "連線失敗，請稍後再試。" }));
        }
      } finally {
        updateMsg(botId, (m) => ({ ...m, pending: false, content: m.content || (ac.signal.aborted ? "（已停止）" : m.content) }));
        setBusy(false);
        abortRef.current = null;
      }
    },
    [busy, messages, player],
  );

  const stopAll = () => {
    abortRef.current?.abort();
    playerRef.current?.stop();
  };

  const replay = (m: UiMessage) => {
    const p = player();
    p.stop();
    p.unlock();
    const { sentences, rest } = takeSentences(m.content + "\n");
    [...sentences, rest].forEach((s) => p.enqueue(s));
  };

  const last = messages[messages.length - 1];
  const avatarState: AvatarState = useMemo(() => {
    if (playerState === "speaking") return "talking";
    if (busy && (voiceOn || (last?.pending && !last.content))) return "thinking";
    return "idle";
  }, [playerState, busy, voiceOn, last]);

  const voiceLabel = textOnly
    ? "語音已關閉"
    : config?.tts
      ? "語音：ElevenLabs"
      : "語音：瀏覽器內建（未設定 ElevenLabs）";

  return (
    <div className="flex h-dvh flex-col bg-cream text-slate-900 md:flex-row">
      {!textOnly && (
        <aside
          aria-label={`${AGENT.name}的角色介紹`}
          className="flex h-40 shrink-0 items-center gap-4 bg-navy px-4 text-white md:h-auto md:w-2/5 md:flex-col md:justify-center md:gap-6 md:px-10"
        >
          <Avatar state={avatarState} getLevel={getLevel} className="aspect-square h-32 shrink-0 md:h-auto md:w-full md:max-w-sm" />
          <div className="min-w-0 md:text-center">
            <p className="inline-block rounded-full bg-gold px-2 py-0.5 text-xs font-bold text-navy">我是 AI 代理人</p>
            <h1 className="mt-1 text-2xl font-bold md:text-4xl">{AGENT.name}</h1>
            <p className="text-sm text-white/90 md:text-lg">{AGENT.title}</p>
            <p className="mt-2 hidden text-white/80 md:block">{AGENT.tagline}</p>
            <ul className="mt-2 flex flex-wrap gap-1 md:justify-center" aria-label="專長">
              {AGENT.tags.map((t, i) => (
                <li
                  key={t}
                  className={`rounded-full border border-white/40 px-2 py-0.5 text-xs ${i > 2 ? "hidden md:block" : ""}`}
                >
                  {t}
                </li>
              ))}
            </ul>
          </div>
        </aside>
      )}

      <main className="flex min-h-0 flex-1 flex-col md:w-3/5">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-2 md:px-8">
          {textOnly ? (
            <h1 className="text-lg font-bold text-navy">
              {AGENT.name}｜{AGENT.title}
              <span className="ml-2 rounded-full bg-gold px-2 py-0.5 align-middle text-xs text-navy">AI 代理人</span>
            </h1>
          ) : (
            <span className="sr-only">對話區</span>
          )}
          <VoiceControls
            playerState={playerState}
            muted={muted}
            textOnly={textOnly}
            rate={rate}
            voiceLabel={voiceLabel}
            onPauseResume={() => (playerState === "paused" ? playerRef.current?.resume() : playerRef.current?.pause())}
            onStop={() => playerRef.current?.stop()}
            onToggleMute={() => setMuted((v) => !v)}
            onToggleTextOnly={() => setTextOnly((v) => !v)}
            onRate={setRate}
          />
        </header>

        <ChatPanel
          messages={messages}
          input={input}
          busy={busy}
          serverStt={config?.stt ?? false}
          canReplay={voiceOn}
          notice={notice}
          largeText={textOnly}
          onInput={setInput}
          onSend={(t) => void send(t)}
          onStop={stopAll}
          onReplay={replay}
          onMicStart={() => {
            playerRef.current?.stop();
            if (voiceOnRef.current) player().unlock();
          }}
          onNotice={setNotice}
        />

        <footer className="border-t border-slate-200 bg-white px-4 pb-3 text-xs text-slate-600 md:px-8">
          <p>
            <strong className="text-navy">免責聲明：</strong>
            {AGENT.disclaimer}對話內容不會被儲存。
            <Link href="/privacy" className="ml-2 text-navy underline">
              隱私權與資料使用說明
            </Link>
          </p>
          {config && !config.chat && (
            <p className="mt-1 text-amber-800">目前為示範模式：尚未設定 ANTHROPIC_API_KEY，回答只會列出檢索到的資料。</p>
          )}
        </footer>
      </main>
    </div>
  );
}
