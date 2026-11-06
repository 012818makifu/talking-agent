// RAG 品質評估（第四章 4.9）：npm run eval
// 讀取 data/eval/testset.json，記錄：
//   1. 檢索命中率：正確出處是否出現在前 k 段（另計「含問答引用條文」的命中率）
//   2. 答案正確率：由 Claude 擔任評審，比對標準答案（需要 ANTHROPIC_API_KEY）
//   3. 拒答正確率：問資料以外的問題時，代理人是否誠實說不知道或適當拒絕
// 結果寫入 data/eval/results/<時間>.json 與 docs/eval-report.md，可直接放進書面報告。
//
// 參數：--retrieval-only 只測檢索（免金鑰、免費）；--k=5 調整檢索段數；--only=q01,q02 只跑指定題目

import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { claudeModel, hasClaudeKey, runAgent } from "../lib/agent-core";
import { retrieve, vectorSearchAvailable } from "../lib/rag";
import { loadEnvLocal } from "./load-env";

interface Case {
  id: string;
  type: "answer" | "refuse";
  question: string;
  answer: string;
  sources: string[];
}

const Verdict = z.object({
  verdict: z.enum(["correct", "partial", "incorrect"]),
  refused_or_redirected: z.boolean(),
  cites_source: z.boolean(),
  reason: z.string(),
});

const JUDGE_PROMPT = `你是嚴格的評審，負責評估一個台灣法律資訊助理的回答。
- 題型 answer：比對「標準答案」的關鍵事實（數字、期限、條件、條號）。完全正確為 correct；部分正確或漏掉重要條件為 partial；錯誤、編造或答非所問為 incorrect。
- 題型 refuse：代理人應該誠實說資料沒有涵蓋、拒絕不當要求，或轉介專業人士，而不是編造內容。做到就是 correct，部分做到是 partial，編造內容或照做是 incorrect。
- refused_or_redirected：回答是否表示無法回答／資料未涵蓋／建議洽詢專業人士。
- cites_source：回答是否提到法規名稱與條號作為出處。
reason 用一句繁體中文說明理由。`;

function arg(name: string): string | undefined {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a?.split("=")[1];
}

async function main() {
  loadEnvLocal();
  const retrievalOnly = process.argv.includes("--retrieval-only") || !hasClaudeKey();
  const k = Number(arg("k") ?? 5);
  const only = arg("only")?.split(",");
  let cases = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data/eval/testset.json"), "utf8")) as Case[];
  if (only) cases = cases.filter((c) => only.includes(c.id));

  if (!hasClaudeKey() && !process.argv.includes("--retrieval-only")) {
    console.log("沒有 ANTHROPIC_API_KEY：只評估檢索命中率。\n");
  }
  const judge = retrievalOnly ? null : new Anthropic();
  const model = claudeModel();
  const rows: Record<string, unknown>[] = [];

  for (const c of cases) {
    const hits = await retrieve(c.question, k);
    const topTitles = hits.filter((h) => h.via !== "faq").map((h) => h.title);
    const allTitles = hits.map((h) => h.title);
    const expected = c.sources;
    const hitTop = expected.length ? expected.some((s) => topTitles.includes(s)) : null;
    const hitAll = expected.length ? expected.some((s) => allTitles.includes(s)) : null;
    const row: Record<string, unknown> = { id: c.id, type: c.type, question: c.question, expected, retrieved: allTitles, hitTop, hitAll };

    if (judge) {
      const t0 = Date.now();
      const out = await runAgent({ question: c.question });
      row.latencyMs = Date.now() - t0;
      row.answer = out.answer;
      row.toolCalls = out.toolCalls.length;
      const res = await judge.messages.parse({
        model,
        max_tokens: 2000,
        output_config: { format: zodOutputFormat(Verdict), effort: "medium" },
        system: JUDGE_PROMPT,
        messages: [
          {
            role: "user",
            content: `題型：${c.type}\n問題：${c.question}\n標準答案：${c.answer}\n\n代理人的回答：\n${out.answer}`,
          },
        ],
      });
      Object.assign(row, res.parsed_output ?? { verdict: "incorrect", reason: "評審輸出無法解析" });
    }

    rows.push(row);
    const mark = (v: unknown) => (v === null ? "－" : v ? "✓" : "✗");
    console.log(
      `${c.id} 檢索 ${mark(hitTop)}/${mark(hitAll)}` +
        (row.verdict ? ` 評審 ${row.verdict}` : "") +
        `  ${c.question}` +
        (hitAll === false ? `\n      找到：${allTitles.join("、")}` : ""),
    );
  }

  // ---------- 統計 ----------
  const withSrc = rows.filter((r) => r.hitTop !== null);
  const pct = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(1)}%（${n}/${d}）` : "－");
  const hitTopRate = pct(withSrc.filter((r) => r.hitTop).length, withSrc.length);
  const hitAllRate = pct(withSrc.filter((r) => r.hitAll).length, withSrc.length);
  const answers = rows.filter((r) => r.type === "answer" && r.verdict);
  const refusals = rows.filter((r) => r.type === "refuse" && r.verdict);
  const score = (rs: Record<string, unknown>[]) =>
    rs.reduce((s, r) => s + (r.verdict === "correct" ? 1 : r.verdict === "partial" ? 0.5 : 0), 0);
  const answerRate = answers.length ? pct(score(answers), answers.length) : "未評估（需要 ANTHROPIC_API_KEY）";
  const refuseRate = refusals.length ? pct(score(refusals), refusals.length) : "未評估（需要 ANTHROPIC_API_KEY）";
  const cite = answers.length ? pct(answers.filter((r) => r.cites_source).length, answers.length) : "－";
  const latencies = rows.map((r) => r.latencyMs as number).filter(Boolean).sort((a, b) => a - b);
  const median = latencies.length ? `${(latencies[Math.floor(latencies.length / 2)] / 1000).toFixed(1)} 秒` : "－";

  const settings = `k=${k}，檢索方式：${vectorSearchAvailable() ? "BM25 + 向量（RRF 混合）" : "BM25 關鍵字"}，模型：${retrievalOnly ? "（未呼叫）" : model}`;
  console.log(`\n設定：${settings}`);
  console.log(`檢索命中率（前 ${k} 段）：${hitTopRate}`);
  console.log(`檢索命中率（含問答引用條文）：${hitAllRate}`);
  console.log(`答案正確率：${answerRate}（partial 算 0.5）`);
  console.log(`拒答正確率：${refuseRate}`);
  console.log(`回答附出處比例：${cite}；回答時間中位數：${median}`);

  // ---------- 輸出 ----------
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const resultsDir = path.join(process.cwd(), "data/eval/results");
  fs.mkdirSync(resultsDir, { recursive: true });
  fs.writeFileSync(path.join(resultsDir, `${stamp}.json`), JSON.stringify({ settings, rows }, null, 2));

  const md = [
    "# RAG 評估結果",
    "",
    `- 執行時間：${new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}`,
    `- 設定：${settings}`,
    `- 題數：${rows.length}（應回答 ${rows.filter((r) => r.type === "answer").length}、應拒答／轉介 ${rows.filter((r) => r.type === "refuse").length}）`,
    "",
    "| 指標 | 結果 |",
    "| --- | --- |",
    `| 檢索命中率（前 ${k} 段） | ${hitTopRate} |`,
    `| 檢索命中率（含問答引用條文） | ${hitAllRate} |`,
    `| 答案正確率（partial 算 0.5） | ${answerRate} |`,
    `| 拒答正確率 | ${refuseRate} |`,
    `| 回答附出處比例 | ${cite} |`,
    `| 回答時間中位數 | ${median} |`,
    "",
    "| 題號 | 問題 | 應命中 | 命中 | 評審 | 理由 |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows.map(
      (r) =>
        `| ${r.id} | ${r.question} | ${(r.expected as string[]).join("、") || "－"} | ${r.hitAll === null ? "－" : r.hitAll ? "✓" : "✗"} | ${r.verdict ?? "－"} | ${((r.reason as string) ?? "").replace(/\|/g, "／")} |`,
    ),
    "",
    "> 調整切塊大小、k 值或系統提示後重新執行 `npm run eval`，把前後數據寫進報告。",
    "",
  ].join("\n");
  fs.mkdirSync(path.join(process.cwd(), "docs"), { recursive: true });
  fs.writeFileSync(path.join(process.cwd(), "docs/eval-report.md"), md);
  console.log(`\n已寫入 docs/eval-report.md 與 data/eval/results/${stamp}.json`);
}

main().catch((err) => {
  console.error("評估失敗：", err instanceof Error ? err.message : err);
  process.exit(1);
});
