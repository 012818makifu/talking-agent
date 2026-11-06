// 用 5 個問題測試 /api/chat，印出回答與來源（附錄 D「測試」提示詞）：npm run test:chat
// 先在另一個終端機執行 npm run dev。可用 BASE_URL=https://你的網址 npm run test:chat 測試已部署的網站。

const BASE = process.env.BASE_URL ?? "http://localhost:3000";

const QUESTIONS = [
  "你好，你是誰？",
  "房東退租後不還押金怎麼辦？",
  "我 2026 年 3 月 10 日騎車被撞，最晚哪一天前要求償？",
  "網購的東西不喜歡，可以退貨嗎？",
  "我想離婚，財產怎麼分？",
];

interface Ev {
  type: string;
  text?: string;
  message?: string;
  sources?: { n: number; title: string }[];
  alerts?: string[];
  name?: string;
  result?: { deadline?: string };
  error?: string;
}

async function ask(q: string) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: q }] }),
  });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  let text = "";
  let sources: string[] = [];
  const notes: string[] = [];
  const lines = (await res.text()).split("\n").filter(Boolean);
  for (const line of lines) {
    const e = JSON.parse(line) as Ev;
    if (e.type === "meta") {
      sources = (e.sources ?? []).map((s) => s.title);
      if (e.alerts?.length) notes.push(`提示卡：${e.alerts.join("、")}`);
    } else if (e.type === "delta") text += e.text;
    else if (e.type === "reset") text = e.text ?? "";
    else if (e.type === "tool") notes.push(`工具 ${e.name}：${e.error ?? e.result?.deadline}`);
    else if (e.type === "error") notes.push(`錯誤：${e.message}`);
  }
  console.log(`\n問：${q}`);
  console.log(`答：${text.trim()}`);
  console.log(`來源：${sources.join("、") || "（無）"}`);
  notes.forEach((n) => console.log(n));
  console.log(`（總時間 ${((Date.now() - t0) / 1000).toFixed(1)} 秒）`);
}

async function main() {
  console.log(`測試 ${BASE}/api/chat`);
  for (const q of QUESTIONS) await ask(q);
}

main().catch((err) => {
  console.error("測試失敗：", err instanceof Error ? err.message : err, "\n請確認已執行 npm run dev。");
  process.exit(1);
});
