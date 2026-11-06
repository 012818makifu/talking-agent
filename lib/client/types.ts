// 前端用的型別。用 import type 引入後端型別：編譯後會被移除，不會把伺服器程式打包進瀏覽器。
import type { AgentEvent, SourceRef } from "@/lib/agent-core";
import type { AlertType } from "@/lib/safety";
import type { DeadlineResult } from "@/lib/tools";

export type { AgentEvent, AlertType, DeadlineResult, SourceRef };

export interface ToolCall {
  name: string;
  input: unknown;
  result?: unknown;
  error?: string;
}

export interface UiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** 歡迎詞等不送進對話歷史的訊息 */
  local?: boolean;
  pending?: boolean;
  error?: string;
  sources?: (SourceRef & { via?: "query" | "faq" })[];
  alerts?: AlertType[];
  redacted?: string[];
  tools?: ToolCall[];
  mode?: "claude" | "demo";
}

export interface ServerConfig {
  chat: boolean;
  model: string | null;
  tts: boolean;
  stt: boolean;
  vectorSearch: boolean;
  chunks: number;
}
