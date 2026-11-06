// /api/config：告訴前端「哪些服務已設定好」，前端據此決定要用 ElevenLabs 還是瀏覽器語音。
// 只回傳 true/false，絕不回傳金鑰本身。

import { claudeModel, hasClaudeKey } from "@/lib/agent-core";
import { loadIndex, vectorSearchAvailable } from "@/lib/rag";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  let chunks = 0;
  try {
    chunks = loadIndex().chunks.length;
  } catch {
    chunks = 0;
  }
  return Response.json({
    chat: hasClaudeKey(),
    model: hasClaudeKey() ? claudeModel() : null,
    tts: Boolean(process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_VOICE_ID),
    stt: Boolean(process.env.ELEVENLABS_API_KEY),
    vectorSearch: vectorSearchAvailable(),
    chunks,
  });
}
