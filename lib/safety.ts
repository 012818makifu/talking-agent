// 程式層的安全防護（第九章）：系統提示規範模型行為，這裡則在呼叫模型「之前」先做檢查。
// 1. 每個 IP 每分鐘的次數限制  2. 輸入長度限制  3. 個資遮蔽  4. 緊急／刑事關鍵字偵測

export const MAX_INPUT_CHARS = 500;

// ---------- 1. 次數限制（記憶體版） ----------
// 注意：Vercel 上每個函式實例各自計數，只能擋住簡單的濫用；
// 正式上線可改用 Upstash Redis 等共享儲存，並在 Anthropic／ElevenLabs 後台設定每月花費上限。
const buckets = new Map<string, number[]>();

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "local").trim();
}

export function rateLimit(
  key: string,
  limit = Number(process.env.RATE_LIMIT_PER_MINUTE) || 10,
  windowMs = 60_000,
): { ok: true } | { ok: false; retryAfter: number } {
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    buckets.set(key, hits);
    return { ok: false, retryAfter: Math.ceil((windowMs - (now - hits[0])) / 1000) };
  }
  hits.push(now);
  buckets.set(key, hits);
  if (buckets.size > 5000) {
    // 避免記憶體無限成長
    for (const [k, v] of buckets) if (v.every((t) => now - t >= windowMs)) buckets.delete(k);
  }
  return { ok: true };
}

// ---------- 3. 個資遮蔽：送給第三方服務之前先遮掉 ----------
const PII_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "身分證字號", re: /\b[A-Z][12489]\d{8}\b/gi },
  { name: "居留證號", re: /\b[A-Z][A-D]\d{8}\b/gi },
  { name: "信用卡號", re: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g },
  { name: "手機號碼", re: /\b09\d{2}[-\s]?\d{3}[-\s]?\d{3}\b/g },
  { name: "電子郵件", re: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g },
];

export function redactPII(text: string): { text: string; found: string[] } {
  const found: string[] = [];
  let out = text;
  for (const { name, re } of PII_PATTERNS) {
    out = out.replace(re, () => {
      if (!found.includes(name)) found.push(name);
      return `［已遮蔽的${name}］`;
    });
  }
  return { text: out, found };
}

// ---------- 4. 關鍵字偵測：命中時前端直接顯示提示卡 ----------
export type AlertType = "emergency" | "criminal" | "deadline";

const ALERT_RULES: { type: AlertType; re: RegExp }[] = [
  {
    type: "emergency",
    re: /(家暴|家庭暴力|被打|毆打|性侵|強暴|跟蹤|騷擾|恐嚇|威脅要殺|殺了我|想死|不想活|自殺|輕生|有危險|人身安全)/,
  },
  {
    // 注意不要放「告訴」：會誤判「可以告訴我…」
    type: "criminal",
    re: /(刑事|刑法|提出告訴|被提告|被告(?!知)|傳票|地檢署|檢察官|偵查|起訴書|做筆錄|拘提|羈押|通緝|詐騙集團|車手|過失傷害|肇事逃逸|酒駕)/,
  },
  {
    type: "deadline",
    re: /(時效|期限|快到期|來不及|最後一天|最晚|哪一天前|幾天內|多久以內|還能告嗎|過期)/,
  },
];

export function detectAlerts(text: string): AlertType[] {
  return ALERT_RULES.filter((r) => r.re.test(text)).map((r) => r.type);
}

export const ALERT_MESSAGES: Record<AlertType, { title: string; body: string }> = {
  emergency: {
    title: "如果你現在有危險",
    body: "請立即撥打 110 報案；家暴、性侵害、跟蹤騷擾可撥 113 保護專線（24 小時）。如有輕生念頭，請撥 1925 安心專線。",
  },
  criminal: {
    title: "這可能涉及刑事案件",
    body: "刑事程序影響重大，建議盡快諮詢律師。經濟上有困難可洽法律扶助基金會專線 412-8518（手機請加 02），或各地律師公會的法律諮詢服務。",
  },
  deadline: {
    title: "注意時效與期限",
    body: "法律期限一旦經過可能無法補救。小法可以幫你試算到期日，但個案仍建議盡早諮詢律師或法律扶助基金會。",
  },
};
