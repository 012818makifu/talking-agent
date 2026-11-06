"use client";

// 右側對話視窗：訊息列表、範例問題、文字輸入框、麥克風與送出按鈕（第三章 3.1、第七章 7.1）

import { useEffect, useRef } from "react";
import { AGENT } from "@/lib/agent";
import { MAX_INPUT_CHARS } from "@/lib/safety";
import type { UiMessage } from "@/lib/client/types";
import { ChatMessage } from "./ChatMessage";
import { MicButton } from "./MicButton";

export function ChatPanel({
  messages,
  input,
  busy,
  serverStt,
  canReplay,
  notice,
  largeText,
  onInput,
  onSend,
  onStop,
  onReplay,
  onMicStart,
  onNotice,
}: {
  messages: UiMessage[];
  input: string;
  busy: boolean;
  serverStt: boolean;
  canReplay: boolean;
  notice: string | null;
  largeText: boolean;
  onInput: (v: string) => void;
  onSend: (text: string) => void;
  onStop: () => void;
  onReplay: (m: UiMessage) => void;
  onMicStart: () => void;
  onNotice: (msg: string | null) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const showExamples = !messages.some((m) => m.role === "user");

  // 有新內容時自動捲到最下面
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const submit = () => {
    const text = input.trim();
    if (!text || busy) return;
    onSend(text);
  };

  return (
    <>
      <div
        ref={listRef}
        role="log"
        aria-label="對話紀錄"
        aria-busy={busy}
        className={`min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 md:px-8 ${largeText ? "text-lg" : "text-base"}`}
      >
        {messages.map((m) => (
          <ChatMessage key={m.id} msg={m} onReplay={onReplay} canReplay={canReplay} />
        ))}
        {showExamples && (
          <div className="pl-10">
            <p className="mb-2 text-sm text-slate-600">可以試試這些問題：</p>
            <div className="flex flex-col items-start gap-2">
              {AGENT.exampleQuestions.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => onSend(q)}
                  disabled={busy}
                  className="rounded-full border border-navy/30 bg-white px-4 py-2 text-left text-sm text-navy shadow-sm transition hover:border-navy hover:bg-navy-50 focus-visible:outline-2 focus-visible:outline-gold"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {notice && (
        <div role="status" className="mx-4 mb-2 flex items-start justify-between gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 md:mx-8">
          <span>{notice}</span>
          <button type="button" onClick={() => onNotice(null)} aria-label="關閉提示" className="px-1">
            ✕
          </button>
        </div>
      )}

      <form
        className="border-t border-slate-200 bg-white px-4 py-3 md:px-8"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="flex items-end gap-2">
          <label htmlFor="question" className="sr-only">
            輸入你的問題
          </label>
          <textarea
            id="question"
            value={input}
            maxLength={MAX_INPUT_CHARS}
            rows={1}
            placeholder="輸入你的問題…"
            onChange={(e) => onInput(e.target.value)}
            onKeyDown={(e) => {
              // 注意輸入法選字中（isComposing）按 Enter 不能送出
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            className="max-h-40 min-h-12 flex-1 resize-none rounded-2xl border border-slate-300 px-4 py-3 leading-snug focus:border-navy focus:outline-2 focus:outline-gold"
          />
          <MicButton
            serverStt={serverStt}
            disabled={busy}
            onStart={() => {
              onNotice(null);
              onMicStart();
            }}
            onInterim={onInput}
            onTranscript={(t) => onSend(t)}
            onError={(m) => onNotice(m)}
          />
          {busy ? (
            <button
              type="button"
              onClick={onStop}
              className="h-12 shrink-0 rounded-full bg-slate-700 px-4 text-sm font-medium text-white hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
            >
              停止
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className="h-12 shrink-0 rounded-full bg-navy px-5 text-sm font-medium text-white hover:bg-navy/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold disabled:opacity-40"
            >
              送出
            </button>
          )}
        </div>
        <p className="mt-1 text-right text-xs text-slate-500" aria-live="off">
          {input.length}/{MAX_INPUT_CHARS}
        </p>
      </form>
    </>
  );
}
