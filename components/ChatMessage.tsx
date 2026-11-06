"use client";

// 單則訊息：使用者在右、代理人在左（第七章 7.1）。
// 代理人訊息下方有：安全提示卡、時效試算結果、可展開的「參考資料」（含法條原文與官方連結）。

import { AGENT } from "@/lib/agent";
import { ALERT_MESSAGES } from "@/lib/safety";
import type { DeadlineResult, ToolCall, UiMessage } from "@/lib/client/types";

function AlertCards({ alerts }: { alerts: NonNullable<UiMessage["alerts"]> }) {
  return (
    <div className="mb-2 space-y-2">
      {alerts.map((a) => (
        <div
          key={a}
          role={a === "emergency" ? "alert" : "note"}
          className={`rounded-xl border-l-4 px-3 py-2 text-sm ${
            a === "emergency"
              ? "border-red-600 bg-red-50 text-red-900"
              : a === "criminal"
                ? "border-amber-500 bg-amber-50 text-amber-950"
                : "border-sky-600 bg-sky-50 text-sky-950"
          }`}
        >
          <p className="font-bold">{ALERT_MESSAGES[a].title}</p>
          <p>{ALERT_MESSAGES[a].body}</p>
        </div>
      ))}
    </div>
  );
}

function ToolCard({ call }: { call: ToolCall }) {
  if (call.error) {
    return <p className="mt-2 rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-600">期限試算失敗：{call.error}</p>;
  }
  const r = call.result as DeadlineResult;
  return (
    <div className="mt-2 rounded-xl border border-gold/60 bg-gold/10 px-3 py-2 text-sm text-navy">
      <p className="font-bold">期限試算（由程式計算）</p>
      <p>
        {r.claim}：{r.start_date} 起算 {r.period}，到期日 <strong>{r.deadline}（{r.deadline_weekday}）</strong>
        {r.expired ? "，已經超過期限" : `，距今還有 ${r.days_left} 天`}。
      </p>
      <p className="text-xs text-slate-600">依據：{r.law}。實際期限可能因中斷、假日等因素不同，請向律師確認。</p>
    </div>
  );
}

function Sources({ sources }: { sources: NonNullable<UiMessage["sources"]> }) {
  return (
    <details className="group mt-2 text-sm">
      <summary className="cursor-pointer select-none rounded-md py-1 text-navy underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-gold">
        參考資料（{sources.length}）
      </summary>
      <ol className="mt-1 space-y-1">
        {sources.map((s) => (
          <li key={s.n} className="rounded-lg bg-slate-50 px-3 py-2">
            <details>
              <summary className="cursor-pointer">
                <span className="font-medium text-navy">
                  [{s.n}] {s.title}
                </span>
                {s.via && (
                  <span className="ml-2 rounded bg-navy-50 px-1.5 py-0.5 text-xs text-navy">
                    {s.via === "query" ? "你提到的條文" : "問答引用的條文"}
                  </span>
                )}
              </summary>
              <p className="mt-2 whitespace-pre-wrap text-slate-700">{s.text}</p>
              <p className="mt-1 text-xs text-slate-500">
                {s.url && (
                  <a href={s.url} target="_blank" rel="noreferrer noopener" className="text-navy underline">
                    查看官方原文
                  </a>
                )}
                {s.retrieved && <span className="ml-2">資料擷取日期：{s.retrieved}</span>}
              </p>
            </details>
          </li>
        ))}
      </ol>
    </details>
  );
}

export function ChatMessage({
  msg,
  onReplay,
  canReplay,
}: {
  msg: UiMessage;
  onReplay?: (m: UiMessage) => void;
  canReplay: boolean;
}) {
  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-navy px-4 py-2 text-white">
          <span className="sr-only">你說：</span>
          {msg.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      <div
        aria-hidden="true"
        className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gold text-sm font-bold text-navy"
      >
        法
      </div>
      <div className="min-w-0 max-w-[85%]">
        <p className="mb-1 text-xs text-slate-500">
          {AGENT.name}・AI 代理人
          {msg.mode === "demo" && <span className="ml-2 rounded bg-amber-100 px-1.5 text-amber-900">示範模式</span>}
        </p>
        {msg.alerts && msg.alerts.length > 0 && <AlertCards alerts={msg.alerts} />}
        <div className="rounded-2xl rounded-tl-sm bg-white px-4 py-2 shadow-sm ring-1 ring-slate-200">
          {msg.redacted && msg.redacted.length > 0 && (
            <p className="mb-1 text-xs text-slate-500">為保護你的隱私，已在送出前遮蔽：{msg.redacted.join("、")}。</p>
          )}
          {msg.content ? (
            <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
          ) : msg.pending ? (
            <p className="text-slate-500">
              {AGENT.name}正在查資料
              <span className="thinking-dot ml-1 inline-block" />
              <span className="thinking-dot ml-1 inline-block [animation-delay:150ms]" />
              <span className="thinking-dot ml-1 inline-block [animation-delay:300ms]" />
            </p>
          ) : null}
          {msg.error && (
            <p role="alert" className="mt-1 text-sm text-red-700">
              {msg.error}
            </p>
          )}
          {msg.tools?.map((t, i) => <ToolCard key={i} call={t} />)}
          {!msg.pending && msg.sources && msg.sources.length > 0 && <Sources sources={msg.sources} />}
        </div>
        {canReplay && msg.content && !msg.pending && onReplay && (
          <button
            type="button"
            onClick={() => onReplay(msg)}
            className="mt-1 rounded px-2 py-1 text-xs text-navy hover:bg-navy-50 focus-visible:outline-2 focus-visible:outline-gold"
            aria-label="再念一次這則回答"
          >
            ▶ 再聽一次
          </button>
        )}
      </div>
    </div>
  );
}
