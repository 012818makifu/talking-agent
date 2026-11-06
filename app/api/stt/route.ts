// /api/stt：語音轉文字（第五章 5.4）。接收前端錄好的音檔，轉送 ElevenLabs Speech-to-Text。
// 隱私：音檔只在記憶體中處理，不寫入硬碟、不保留（第九章 9.3）。

import { clientIp, rateLimit } from "@/lib/safety";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB，約數分鐘的錄音

export async function POST(req: Request) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "尚未設定 ElevenLabs 金鑰", fallback: "browser" }, { status: 501 });
  }

  const rl = rateLimit(`stt:${clientIp(req)}`, 20);
  if (!rl.ok) return Response.json({ error: "錄音請求太頻繁，請稍後再試" }, { status: 429 });

  let file: File | null = null;
  try {
    const form = await req.formData();
    const f = form.get("file");
    file = f instanceof File ? f : null;
  } catch {
    // 下面統一回錯誤
  }
  if (!file || file.size === 0) return Response.json({ error: "沒有收到錄音檔" }, { status: 400 });
  if (file.size > MAX_BYTES) return Response.json({ error: "錄音太長了" }, { status: 413 });

  const upstream = new FormData();
  upstream.append("file", file, file.name || "speech.webm");
  upstream.append("model_id", process.env.ELEVENLABS_STT_MODEL || "scribe_v1");
  upstream.append("language_code", "zho");

  const r = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": apiKey },
    body: upstream,
    signal: req.signal,
  });

  if (!r.ok) {
    console.error("[api/stt] ElevenLabs", r.status, await r.text().catch(() => ""));
    return Response.json({ error: `語音辨識失敗（${r.status}）` }, { status: 502 });
  }
  const data = (await r.json()) as { text?: string };
  return Response.json({ text: (data.text ?? "").trim() });
}
