import Anthropic from "@anthropic-ai/sdk";
import { claudeModel, hasClaudeKey } from "@/lib/agent-core";
import { redactPII } from "@/lib/safety";

import { checkMapAccess } from "@/lib/child-map-access";

export async function GET() {
  const url = process.env.CHILD_MAP_VIDEO_URL || "";
  const valid = /^https:\/\/(?:www\.youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)[\w-]{11}(?:[?&].*)?$/.test(url);
  return Response.json({ video: valid ? url : null });
}

export async function POST(req: Request) {
  const denied = checkMapAccess(req);
  if (denied) return denied;
  const body = await req.json().catch(() => null);
  if (typeof body?.message !== "string" || !body.message.trim() || body.message.length > 500)
    return Response.json({ error: "請用 1 到 500 字描述情況。" }, { status: 400 });
  if (!hasClaudeKey())
    return Response.json({ error: "AI 尚未連線，可以直接使用下方五題。" }, { status: 503 });
  const choices = {
    county: { type: "string", description: "臺灣縣市全名，使用臺字，若無法確認留空" },
    town: { type: "string", description: "行政區全名，若無法確認留空" },
    age: { type: "string", enum: ["", "學齡前", "國小", "國中", "高中", "大學"] },
    status: { type: "array", items: { type: "string", enum: ["低收入戶", "中低收入戶", "急難", "經濟弱勢", "學習落後", "遺族"] } },
    need: { type: "array", items: { type: "string", enum: ["food", "cloth", "edu"] } },
    time: { type: "string", enum: ["", "now", "平日", "假日", "寒暑假"] },
  };
  try {
    const result = await new Anthropic({ timeout: 20000, maxRetries: 0 }).messages.create({
      model: claudeModel(), max_tokens: 380,
      system: "你是童行地圖的條件擷取助理。只填使用者表明的情況。請注意否定和假設，不推定法定低收資格。孩子的年級可換算學制；五專前三年用高中。查不到或無關的欄位留空字串或空陣列。food 是餐食，cloth 是衣物，edu 是教育。只呼叫工具。",
      messages: [{ role: "user", content: redactPII(body.message).text }],
      tools: [{ name: "find_resources", description: "填入地圖可供使用者核對的查詢條件", input_schema: { type: "object", properties: choices, required: Object.keys(choices) } }],
      tool_choice: { type: "tool", name: "find_resources" },
    });
    const call = result.content.find(block => block.type === "tool_use" && block.name === "find_resources");
    if (call?.type === "tool_use") return Response.json({ filters: call.input });
  } catch { /* Keep the manual search available. */ }
  return Response.json({ error: "AI 目前無法整理這句話，可以重試或直接勾選下方五題。" }, { status: 503 });
}
