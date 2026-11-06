// 代理人的核心流程（第一章 1.3 的 ④⑤⑥）：檢索 RAG → 呼叫 Claude（串流）→ 需要時執行工具 → 回傳答案與出處。
// /api/chat 與 scripts/eval.ts 共用這個函式，確保「網站看到的」和「評估測到的」是同一套邏輯。

import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT, buildContextBlock } from "./prompts";
import { retrieve, type Hit } from "./rag";
import { detectAlerts, redactPII, type AlertType } from "./safety";
import { DEADLINE_TOOL, DeadlineInput, calculateDeadline } from "./tools";

export const DEFAULT_MODEL = "claude-sonnet-5-5";
export const TOP_K = 5;
const MAX_TOOL_ROUNDS = 3;
const MAX_HISTORY_MESSAGES = 8;

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface SourceRef {
  n: number;
  title: string;
  text: string;
  url?: string;
  retrieved?: string;
  score: number;
  via?: "query" | "faq";
}

export type AgentEvent =
  | { type: "meta"; sources: SourceRef[]; alerts: AlertType[]; redacted: string[]; mode: "claude" | "demo" }
  | { type: "delta"; text: string }
  | { type: "reset"; text: string }
  | { type: "tool"; name: string; input: unknown; result?: unknown; error?: string }
  | { type: "done"; stopReason: string | null; model: string }
  | { type: "error"; message: string };

export function hasClaudeKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export function claudeModel(): string {
  return process.env.CLAUDE_MODEL || DEFAULT_MODEL;
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  client ??= new Anthropic(); // 自動讀取 ANTHROPIC_API_KEY
  return client;
}

function toSourceRefs(hits: Hit[]): SourceRef[] {
  return hits.map((h, i) => ({
    n: i + 1,
    title: h.title,
    text: h.text,
    url: h.url,
    retrieved: h.retrieved,
    score: h.score,
    ...(h.via ? { via: h.via } : {}),
  }));
}

/** 只保留「使用者先、輪流出現」的純文字歷史，避免格式錯誤。 */
function cleanHistory(history: ChatTurn[]): Anthropic.Beta.BetaMessageParam[] {
  const trimmed = history.slice(-MAX_HISTORY_MESSAGES);
  while (trimmed.length && trimmed[0].role !== "user") trimmed.shift();
  return trimmed
    .filter((t) => t.content.trim())
    .map((t) => ({ role: t.role, content: t.content }));
}

export function friendlyError(err: unknown): string {
  if (err instanceof Error && err.message.includes("data/index.json")) return err.message;
  if (err instanceof Anthropic.AuthenticationError) return "Claude API 金鑰無效，請檢查 .env.local 的 ANTHROPIC_API_KEY。";
  if (err instanceof Anthropic.PermissionDeniedError) return "這個 Claude API 金鑰沒有使用此模型的權限。";
  if (err instanceof Anthropic.NotFoundError) return `找不到模型「${claudeModel()}」，請檢查 CLAUDE_MODEL 設定。`;
  if (err instanceof Anthropic.RateLimitError) return "Claude API 目前請求太多，請稍等一下再試。";
  if (err instanceof Anthropic.BadRequestError) return `Claude API 拒絕了這個請求：${err.message}`;
  if (err instanceof Anthropic.APIError) return `Claude API 暫時發生錯誤（${err.status ?? "連線問題"}），請稍後再試。`;
  return "伺服器發生未預期的錯誤，請稍後再試。";
}

/**
 * 回答一個問題。透過 onEvent 一段一段回報進度（給串流用）；
 * 結束後也會回傳完整結果（給評估腳本用）。
 */
export async function runAgent(opts: {
  question: string;
  history?: ChatTurn[];
  signal?: AbortSignal;
  onEvent?: (e: AgentEvent) => void;
}) {
  const emit = opts.onEvent ?? (() => {});
  const model = claudeModel();

  // 1. 程式層防護：個資遮蔽 + 關鍵字偵測
  const { text: question, found: redacted } = redactPII(opts.question.trim());
  const alerts = detectAlerts(opts.question);

  // 2. 檢索 RAG（④）
  const hits = await retrieve(question, TOP_K);
  const sources = toSourceRefs(hits);
  const mode = hasClaudeKey() ? "claude" : "demo";
  emit({ type: "meta", sources, alerts, redacted, mode });

  let answer = "";
  const toolCalls: { name: string; input: unknown; result?: unknown; error?: string }[] = [];
  const say = (t: string) => {
    answer += t;
    emit({ type: "delta", text: t });
  };

  // 沒有 Claude 金鑰時的「示範模式」：仍可測試檢索、語音與介面
  if (mode === "demo") {
    const top = hits[0];
    if (top) {
      const body = top.text.split("\n").slice(1).join("").replace(/^答：/, "");
      const label = top.title.startsWith("問：") ? "相關的常見問答說" : `${top.title}規定`;
      say(`目前是示範模式，還沒有設定 Claude API 金鑰，所以我先念出最相關的資料。${label}：${body.slice(0, 90)}……設定好金鑰之後，我就能用白話幫你解釋。`);
    } else {
      say("目前是示範模式，而且知識庫裡沒有找到相關資料。");
    }
    emit({ type: "done", stopReason: "demo", model: "demo" });
    return { answer, sources, alerts, toolCalls, stopReason: "demo" as string | null, model: "demo" };
  }

  // 3. 組合訊息：歷史對話 + 這一輪的「資料區塊 + 問題」（⑤）
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...cleanHistory(opts.history ?? []),
    { role: "user", content: `${buildContextBlock(hits)}\n\n使用者問題：${question}` },
  ];

  const useFallback = process.env.CLAUDE_FALLBACK !== "off" && !model.includes("haiku");
  let stopReason: string | null = null;
  let jsonRetries = 0;

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const stream = getClient().beta.messages.stream(
      {
        model,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages,
        tools: [DEADLINE_TOOL],
        // 聊天用低 effort：回應更快，也更省
        output_config: { effort: "low" },
        // 自動快取：工具迴圈的第二輪可以重用第一輪的前綴
        cache_control: { type: "ephemeral" },
        // 模型安全分類器拒答時，由伺服器自動改用建議的備援模型重試
        ...(useFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      },
      { signal: opts.signal },
    );

    let roundText = "";
    stream.on("text", (delta) => {
      roundText += delta;
      say(delta);
    });

    let message: Anthropic.Beta.BetaMessage;
    try {
      message = await stream.finalMessage();
      jsonRetries = 0;
    } catch (err) {
      // 工具參數串流到一半無法解析成 JSON 時，重送這一輪（最多兩次）；API 錯誤直接往外丟
      if (err instanceof Anthropic.APIError || opts.signal?.aborted || jsonRetries++ >= 2) throw err;
      answer = answer.slice(0, answer.length - roundText.length);
      if (roundText) emit({ type: "reset", text: answer });
      round--;
      continue;
    }

    stopReason = message.stop_reason;

    if (message.stop_reason === "refusal") {
      // 安全機制拒答：清掉已輸出的部分，換成固定說明
      answer = "";
      emit({ type: "reset", text: "" });
      say("抱歉，這個問題我沒辦法回答。如果是具體的法律糾紛，建議直接諮詢律師或法律扶助基金會。");
      break;
    }

    const toolUses = message.content.filter(
      (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use",
    );
    if (toolUses.length === 0) break; // 正常結束（end_turn 或回答被 max_tokens 截斷）

    if (message.stop_reason === "max_tokens") {
      throw new Error("工具參數因 max_tokens 被截斷");
    }

    // 4. 執行工具，把結果交回 Claude（同一則 user 訊息內放全部 tool_result）
    messages.push({ role: "assistant", content: message.content });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = toolUses.map((tu) => {
      const parsed = tu.name === DEADLINE_TOOL.name ? DeadlineInput.safeParse(tu.input) : null;
      if (!parsed || !parsed.success) {
        const error = parsed ? `參數格式錯誤：${parsed.error.issues.map((i) => i.message).join("；")}` : `未知的工具 ${tu.name}`;
        toolCalls.push({ name: tu.name, input: tu.input, error });
        emit({ type: "tool", name: tu.name, input: tu.input, error });
        return { type: "tool_result", tool_use_id: tu.id, is_error: true, content: error };
      }
      try {
        const result = calculateDeadline(parsed.data);
        toolCalls.push({ name: tu.name, input: parsed.data, result });
        emit({ type: "tool", name: tu.name, input: parsed.data, result });
        return { type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(result) };
      } catch (e) {
        const error = (e as Error).message;
        toolCalls.push({ name: tu.name, input: parsed.data, error });
        emit({ type: "tool", name: tu.name, input: parsed.data, error });
        return { type: "tool_result", tool_use_id: tu.id, is_error: true, content: error };
      }
    });
    messages.push({ role: "user", content: results });
    if (answer && !/[。！？\n]$/.test(answer)) say("\n");
  }

  emit({ type: "done", stopReason, model });
  return { answer, sources, alerts, toolCalls, stopReason, model };
}
