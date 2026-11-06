// 資料匯入與向量化腳本（第四章 4.4）：npm run ingest
// 1. 讀取 data/raw/ 下所有 .pdf .txt .md（含子資料夾）
// 2. 清理（頁首頁尾、頁碼、多餘空白、提示注入文字）並切塊（法條一條一塊，其餘約 500 字、重疊 80 字）
// 3. 有 OPENAI_API_KEY 時，用 text-embedding-3-small 每批 100 塊轉成向量；沒有時只建 BM25 用的文字索引
// 4. 輸出 data/index.json：[{ id, text, source, title, page, url, retrieved, embedding? }]
//
// 參數：--no-embed 強制不產生向量

import fs from "node:fs";
import path from "node:path";
import { PDFParse } from "pdf-parse";
import {
  type Chunk,
  chunkDocument,
  cleanText,
  parseFrontMatter,
  removeInjections,
  stripRepeatedLines,
} from "../lib/chunk";
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, embedTexts } from "../lib/rag";
import { loadEnvLocal } from "./load-env";

const RAW_DIR = path.join(process.cwd(), "data", "raw");
const OUT = path.join(process.cwd(), "data", "index.json");
const BATCH = 100;

function listFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return listFiles(p);
    return /\.(pdf|txt|md)$/i.test(e.name) && !e.name.startsWith("_") ? [p] : [];
  });
}

async function readPdf(file: string): Promise<string[]> {
  const parser = new PDFParse({ data: fs.readFileSync(file) });
  try {
    const result = await parser.getText();
    return result.pages.map((p) => p.text);
  } finally {
    await parser.destroy();
  }
}

async function main() {
  loadEnvLocal();
  const noEmbed = process.argv.includes("--no-embed");
  if (!fs.existsSync(RAW_DIR)) throw new Error("找不到 data/raw 資料夾");

  const files = listFiles(RAW_DIR).sort();
  const chunks: Chunk[] = [];
  let injectionsRemoved = 0;

  for (const file of files) {
    const source = path.relative(RAW_DIR, file).split(path.sep).join("/");
    if (file.toLowerCase().endsWith(".pdf")) {
      const pages = stripRepeatedLines(await readPdf(file));
      pages.forEach((pageText, i) => {
        const { text, removed } = removeInjections(cleanText(pageText));
        injectionsRemoved += removed;
        if (text.length < 20) return;
        chunks.push(...chunkDocument({ source, body: text, meta: {}, page: i + 1 }));
      });
    } else {
      const { meta, body } = parseFrontMatter(fs.readFileSync(file, "utf8"));
      const { text, removed } = removeInjections(cleanText(body));
      injectionsRemoved += removed;
      chunks.push(...chunkDocument({ source, body: text, meta }));
    }
    console.log(`  ✓ ${source}`);
  }

  if (chunks.length === 0) throw new Error("data/raw 裡沒有可用的資料");

  const canEmbed = !noEmbed && Boolean(process.env.OPENAI_API_KEY);
  if (canEmbed) {
    console.log(`\n產生向量：${EMBEDDING_MODEL}（${EMBEDDING_DIMENSIONS} 維），每批 ${BATCH} 塊…`);
    for (let i = 0; i < chunks.length; i += BATCH) {
      const batch = chunks.slice(i, i + BATCH);
      const vectors = await embedTexts(batch.map((c) => c.text));
      // 只保留 6 位小數，讓 index.json 小一點
      batch.forEach((c, j) => (c.embedding = vectors[j].map((v) => Number(v.toFixed(6)))));
      console.log(`  ${Math.min(i + BATCH, chunks.length)} / ${chunks.length}`);
    }
  } else {
    console.log(
      noEmbed
        ? "\n已指定 --no-embed，只建立 BM25 關鍵字索引。"
        : "\n沒有 OPENAI_API_KEY，只建立 BM25 關鍵字索引（網站仍可正常檢索）。",
    );
  }

  fs.writeFileSync(OUT, JSON.stringify(chunks));
  const lens = chunks.map((c) => c.text.length);
  const avg = Math.round(lens.reduce((a, b) => a + b, 0) / lens.length);
  console.log(`\n完成：${files.length} 個檔案 → ${chunks.length} 個 chunk`);
  console.log(`  平均 ${avg} 字，最短 ${Math.min(...lens)}、最長 ${Math.max(...lens)} 字`);
  console.log(`  移除可疑的提示注入文字：${injectionsRemoved} 行`);
  console.log(`  向量：${canEmbed ? "有" : "無"}；輸出 ${path.relative(process.cwd(), OUT)}（${(fs.statSync(OUT).size / 1024).toFixed(0)} KB）`);
}

main().catch((err) => {
  console.error("\n匯入失敗：", err instanceof Error ? err.message : err);
  process.exit(1);
});
