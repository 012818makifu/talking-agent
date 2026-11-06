// /api/chat：接收對話 → RAG 檢索 → Claude 串流回答。
// 回傳格式為 NDJSON（每行一個 JSON 事件），前端可以一邊收字一邊念出來（第五章 5.5 降低延遲）。

import { z } from "zod";
import { friendlyError, runAgent, type AgentEvent } from "@/lib/agent-core";
import { MAX_INPUT_CHARS, clientIp, rateLimit } from "@/lib/safety";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(4000),
      }),
    )
    .min(1)
    .max(40),
});

export async function POST(req: Request) {
  const rl = rateLimit(`chat:${clientIp(req)}`);
  if (!rl.ok) {
    return Response.json(
      { error: `請求太頻繁了，請 ${rl.retryAfter} 秒後再試。` },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return Response.json({ error: "請求格式錯誤。" }, { status: 400 });
  }

  const last = body.messages[body.messages.length - 1];
  if (last.role !== "user" || !last.content.trim()) {
    return Response.json({ error: "最後一則訊息必須是使用者的問題。" }, { status: 400 });
  }
  if (last.content.length > MAX_INPUT_CHARS) {
    return Response.json({ error: `問題太長了，請精簡到 ${MAX_INPUT_CHARS} 字以內。` }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: AgentEvent) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
        } catch {
          // 使用者已關閉連線
        }
      };
      try {
        await runAgent({
          question: last.content,
          history: body.messages.slice(0, -1),
          signal: req.signal,
          onEvent: send,
        });
      } catch (err) {
        if (!req.signal.aborted) {
          console.error("[api/chat]", err);
          send({ type: "error", message: friendlyError(err) });
        }
      } finally {
        try {
          controller.close();
        } catch {
          // 已關閉
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
