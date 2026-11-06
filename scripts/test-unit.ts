// 不需要任何金鑰的單元測試：npm run test:unit
// 涵蓋：期限計算、語音正規化、條號解析、個資遮蔽、關鍵字偵測、斷句、切塊、檢索。

import assert from "node:assert/strict";
import { chunkDocument, parseFrontMatter } from "../lib/chunk";
import { takeSentences } from "../lib/client/speech-player";
import { retrieve } from "../lib/rag";
import { detectAlerts, redactPII } from "../lib/safety";
import { intToChinese, normalizeForSpeech } from "../lib/speech-normalize";
import { chineseToInt, extractArticleRefs, normalizeArticleRefs } from "../lib/text";
import { calculateDeadline, computeDeadline } from "../lib/tools";

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n    ${(e as Error).message.split("\n").join("\n    ")}`);
  }
}

async function main() {
  console.log("期限計算（民法第120、121條）");
  await test("2 年：2024-03-10 發生 → 2026-03-10 屆滿", () =>
    assert.equal(computeDeadline("2024-03-10", "year", 2), "2026-03-10"));
  await test("跨年：2025-12-31 發生、2 年 → 2027-12-31", () =>
    assert.equal(computeDeadline("2025-12-31", "year", 2), "2027-12-31"));
  await test("沒有相當日：2024-02-28 發生、1 年 → 2025-02-28（月末）", () =>
    assert.equal(computeDeadline("2024-02-28", "year", 1), "2025-02-28"));
  await test("閏年：2023-02-28 發生、1 年 → 2024-02-29", () =>
    assert.equal(computeDeadline("2023-02-28", "year", 1), "2024-02-29"));
  await test("7 日：2026-11-06 收貨 → 2026-11-13", () =>
    assert.equal(computeDeadline("2026-11-06", "day", 7), "2026-11-13"));
  await test("剩餘天數與是否過期", () => {
    const r = calculateDeadline({ claim_type: "online_return", start_date: "2026-11-01" }, "2026-11-06");
    assert.equal(r.deadline, "2026-11-08");
    assert.equal(r.days_left, 2);
    assert.equal(r.expired, false);
  });
  await test("不存在的日期會報錯", () =>
    assert.throws(() => computeDeadline("2026-02-30", "day", 7)));

  console.log("數字與語音正規化");
  await test("intToChinese", () => {
    const cases: [number, string][] = [
      [10, "十"], [15, "十五"], [105, "一百零五"], [184, "一百八十四"], [1010, "一千零一十"],
      [2000, "兩千"], [20000, "兩萬"], [22000, "兩萬兩千"], [100000, "十萬"], [500000, "五十萬"],
    ];
    for (const [n, w] of cases) assert.equal(intToChinese(n), w, `${n}`);
  });
  await test("條號", () => {
    assert.equal(normalizeForSpeech("依民法第184條"), "依民法第一百八十四條");
    assert.equal(normalizeForSpeech("民法第191-2條"), "民法第一百九十一條之二");
    assert.equal(normalizeForSpeech("民事訴訟法第436條之8"), "民事訴訟法第四百三十六條之八");
  });
  await test("電話與專線逐字念", () => {
    assert.equal(normalizeForSpeech("專線412-8518"), "專線四一二，八五一八");
    assert.equal(normalizeForSpeech("撥打1955"), "撥打一九五五");
  });
  await test("單位、金額、年份、百分比、縮寫", () => {
    assert.equal(normalizeForSpeech("2年內"), "兩年內");
    assert.equal(normalizeForSpeech("第2條"), "第二條");
    assert.equal(normalizeForSpeech("工作滿6個月"), "工作滿六個月");
    assert.equal(normalizeForSpeech("100,000元以下"), "十萬元以下");
    assert.equal(normalizeForSpeech("2026年"), "二〇二六年");
    assert.equal(normalizeForSpeech("2026-03-10"), "二〇二六年三月十日");
    assert.equal(normalizeForSpeech("加給10%"), "加給百分之十");
    assert.equal(normalizeForSpeech("RAG 系統"), "R A G 系統");
  });
  await test("移除 Markdown 與網址", () =>
    assert.equal(normalizeForSpeech("**重點**：請看 https://law.moj.gov.tw"), "重點：請看"));

  console.log("條號解析");
  await test("chineseToInt / normalizeArticleRefs", () => {
    assert.equal(chineseToInt("一百八十四"), 184);
    assert.equal(chineseToInt("四百三十六"), 436);
    assert.equal(normalizeArticleRefs("第一百九十一條之二"), "第191-2條");
  });
  await test("extractArticleRefs 支援「同法」", () => {
    const refs = extractArticleRefs("依消費者保護法第43條……依同法第44條", ["消費者保護法", "民法"]);
    assert.deepEqual(refs.map(({ law, no }) => ({ law, no })), [
      { law: "消費者保護法", no: "43" },
      { law: "消費者保護法", no: "44" },
    ]);
  });

  console.log("安全防護");
  await test("遮蔽身分證字號與手機", () => {
    const r = redactPII("我是A123456789，電話0912-345-678");
    assert.ok(!r.text.includes("A123456789") && !r.text.includes("0912"));
    assert.deepEqual(r.found, ["身分證字號", "手機號碼"]);
  });
  await test("關鍵字偵測：不把「告訴我」誤判成刑事", () => {
    assert.deepEqual(detectAlerts("可以告訴我押金的規定嗎"), []);
    assert.ok(detectAlerts("我被家暴了怎麼辦").includes("emergency"));
    assert.ok(detectAlerts("我收到地檢署的傳票").includes("criminal"));
    assert.ok(detectAlerts("車禍多久時效會過").includes("deadline"));
  });

  console.log("斷句（邊串流邊念）");
  await test("短句合併、保留未完成的部分", () => {
    const r = takeSentences("你好。我是小法，很高興認識你！請問");
    assert.deepEqual(r.sentences, ["你好。我是小法，很高興認識你！"]);
    assert.equal(r.rest, "請問");
  });

  console.log("切塊");
  await test("法條一條一塊、長條文拆開並重複標題", () => {
    const raw = `---\ntype: law\nsource: x https://law.moj.gov.tw/x\n---\n### 測試法 第1條（第一章）\n短條文。\n\n### 測試法 第2條（第一章）\n${"甲".repeat(400)}\n${"乙".repeat(400)}\n`;
    const { meta, body } = parseFrontMatter(raw);
    const chunks = chunkDocument({ source: "t.md", body, meta });
    assert.equal(chunks.length, 3);
    assert.equal(chunks[0].title, "測試法 第1條");
    assert.ok(chunks[2].text.startsWith("測試法 第2條（第一章）（續）"));
    assert.equal(chunks[0].url, "https://law.moj.gov.tw/x");
  });

  console.log("檢索（需要先執行 npm run ingest）");
  await test("押金問題找得到租賃住宅條例第7條", async () => {
    const hits = await retrieve("房東退租後不還押金怎麼辦？");
    assert.ok(hits.some((h) => h.title === "租賃住宅市場發展及管理條例 第7條"), hits.map((h) => h.title).join("、"));
  });
  await test("直接問條號會把該條排第一", async () => {
    const hits = await retrieve("民法第一百八十四條在講什麼");
    assert.equal(hits[0].title, "民法 第184條");
    assert.equal(hits[0].via, "query");
  });

  console.log(`\n${passed} 通過，${failed} 失敗`);
  if (failed) process.exit(1);
}

void main();
