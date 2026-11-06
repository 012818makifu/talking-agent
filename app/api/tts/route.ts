// /api/tts：文字轉語音（第五章 5.2）。呼叫 ElevenLabs，回傳 audio/mpeg 串流。
// 沒有設定金鑰時回傳 501，前端會自動改用瀏覽器內建語音（作業 FAQ 建議的省額度做法）。

import { z } from "zod";
import { AGENT } from "@/lib/agent";
import { clientIp, rateLimit } from "@/lib/safety";
import { normalizeForSpeech } from "@/lib/speech-normalize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ text: z.string().min(1).max(600) });

export async function POST(req: Request) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  if (!apiKey || !voiceId) {
    return Response.json({ error: "尚未設定 ElevenLabs 金鑰或 Voice ID", fallback: "browser" }, { status: 501 });
  }
  if (!/^[A-Za-z0-9]+$/.test(voiceId)) {
    return Response.json({ error: "ELEVENLABS_VOICE_ID 格式不正確" }, { status: 500 });
  }

  // 前端會一句一句送，所以上限比聊天寬鬆
  const rl = rateLimit(`tts:${clientIp(req)}`, 60);
  if (!rl.ok) return Response.json({ error: "語音請求太頻繁", fallback: "browser" }, { status: 429 });

  let text: string;
  try {
    text = normalizeForSpeech(Body.parse(await req.json()).text);
  } catch {
    return Response.json({ error: "請求格式錯誤" }, { status: 400 });
  }
  if (!text) return new Response(null, { status: 204 });

  const r = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: process.env.ELEVENLABS_TTS_MODEL || "eleven_multilingual_v2",
        voice_settings: {
          stability: AGENT.voice.stability,
          similarity_boost: AGENT.voice.similarityBoost,
        },
      }),
      signal: req.signal,
    },
  );

  if (!r.ok || !r.body) {
    console.error("[api/tts] ElevenLabs", r.status, await r.text().catch(() => ""));
    return Response.json({ error: `ElevenLabs 回傳錯誤 ${r.status}`, fallback: "browser" }, { status: 502 });
  }

  return new Response(r.body, {
    headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
  });
}
