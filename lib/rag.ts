// 檢索函式（第四章 4.6、4.8）：混合檢索 = BM25 關鍵字 + 向量相似度。
// - 沒有 OPENAI_API_KEY 或索引沒有向量時，只用 BM25（免費、離線也能跑）。
// - 兩者都有時，用 RRF（Reciprocal Rank Fusion）合併兩份排名，
//   對「民法第184條」這種專有名詞與條號特別有幫助。

import fs from "node:fs";
import path from "node:path";
import OpenAI from "openai";
import type { Chunk } from "./chunk";
import { expandQuery, extractArticleRefs, normalizeArticleRefs, tokenize } from "./text";

export const EMBEDDING_MODEL = "text-embedding-3-small";
// text-embedding-3 系列可以指定較小的維度，讓 index.json 小很多、部署更快
export const EMBEDDING_DIMENSIONS = 512;

export interface Hit {
  id: string;
  title: string;
  text: string;
  source: string;
  page: number | null;
  url?: string;
  retrieved?: string;
  /** 最終排序分數 */
  score: number;
  bm25: number;
  vector: number | null;
  /** 不是靠相似度找到、而是因為「被點名的條號」加進來的：query＝問題直接問到；faq＝問答引用到 */
  via?: "query" | "faq";
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] ** 2;
    nb += b[i] ** 2;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

// ---------- BM25 ----------
interface Bm25Index {
  tf: Map<string, number>[];
  len: number[];
  df: Map<string, number>;
  avgLen: number;
}

function buildBm25(chunks: Chunk[]): Bm25Index {
  const tf: Map<string, number>[] = [];
  const len: number[] = [];
  const df = new Map<string, number>();
  for (const c of chunks) {
    const toks = tokenize(c.text);
    const m = new Map<string, number>();
    for (const t of toks) m.set(t, (m.get(t) ?? 0) + 1);
    for (const t of m.keys()) df.set(t, (df.get(t) ?? 0) + 1);
    tf.push(m);
    len.push(toks.length);
  }
  const avgLen = len.reduce((a, b) => a + b, 0) / Math.max(1, len.length);
  return { tf, len, df, avgLen };
}

function bm25Scores(idx: Bm25Index, query: string, k1 = 1.2, b = 0.75): number[] {
  const N = idx.tf.length;
  const terms = [...new Set(tokenize(query))];
  return idx.tf.map((tf, i) => {
    let s = 0;
    for (const t of terms) {
      const f = tf.get(t);
      if (!f) continue;
      const df = idx.df.get(t) ?? 0;
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      s += (idf * f * (k1 + 1)) / (f + k1 * (1 - b + (b * idx.len[i]) / idx.avgLen));
    }
    return s;
  });
}

// ---------- 載入索引（只讀一次，檔案更新時自動重讀） ----------
interface LoadedIndex {
  chunks: Chunk[];
  bm25: Bm25Index;
  hasEmbeddings: boolean;
  mtime: number;
  /** 「民法 第184條」→ 這一條的 chunk 位置（長條文可能拆成多塊） */
  byTitle: Map<string, number[]>;
  lawNames: string[];
}
let loaded: LoadedIndex | null = null;

export function indexPath(): string {
  return path.join(process.cwd(), "data", "index.json");
}

export function loadIndex(): LoadedIndex {
  const p = indexPath();
  if (!fs.existsSync(p)) {
    throw new Error("找不到 data/index.json，請先執行 npm run ingest 建立知識庫");
  }
  const mtime = fs.statSync(p).mtimeMs;
  if (loaded && loaded.mtime === mtime) return loaded;
  const chunks = JSON.parse(fs.readFileSync(p, "utf8")) as Chunk[];
  const byTitle = new Map<string, number[]>();
  const lawNames = new Set<string>();
  chunks.forEach((c, i) => {
    const m = c.title.match(/^(.+?) 第[\d-]+條$/);
    if (!m) return;
    lawNames.add(m[1]);
    byTitle.set(c.title, [...(byTitle.get(c.title) ?? []), i]);
  });
  loaded = {
    chunks,
    bm25: buildBm25(chunks),
    hasEmbeddings: chunks.length > 0 && chunks.every((c) => Array.isArray(c.embedding)),
    mtime,
    byTitle,
    lawNames: [...lawNames],
  };
  return loaded;
}

let openai: OpenAI | null = null;
function getOpenAI(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) return null;
  openai ??= new OpenAI();
  return openai;
}

/** 批次產生向量（ingest 與查詢共用同一個模型與維度，否則無法比較）。 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  const client = getOpenAI();
  if (!client) throw new Error("缺少 OPENAI_API_KEY");
  const res = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts,
    dimensions: EMBEDDING_DIMENSIONS,
  });
  return res.data.map((d) => d.embedding);
}

export function vectorSearchAvailable(): boolean {
  try {
    return loadIndex().hasEmbeddings && getOpenAI() !== null;
  } catch {
    return false;
  }
}

/** 取出與問題最相關的 k 段資料（另加最多 3 段被問答引用的條文原文）。 */
export async function retrieve(query: string, k = 5): Promise<Hit[]> {
  const idx = loadIndex();
  const n = idx.chunks.length;
  if (n === 0) return [];

  // BM25 用擴充過同義詞的查詢；向量用原始問題
  const bm = bm25Scores(idx.bm25, expandQuery(query));
  let vec: number[] | null = null;
  if (idx.hasEmbeddings && getOpenAI()) {
    try {
      const [q] = await embedTexts([query]);
      vec = idx.chunks.map((c) => cosine(q, c.embedding!));
    } catch (err) {
      // 向量服務暫時失敗時，退回只用 BM25，網站不會因此掛掉
      console.warn("[rag] embedding 失敗，改用 BM25：", (err as Error).message);
    }
  }

  const order = (scores: number[]) =>
    scores.map((s, i) => [i, s] as const).sort((a, b) => b[1] - a[1]).map(([i]) => i);

  let final: number[];
  if (vec) {
    // RRF：兩份排名各自給分 1/(60+名次)，再相加
    const rrf = new Array<number>(n).fill(0);
    order(bm).forEach((i, rank) => (rrf[i] += bm[i] > 0 ? 1 / (60 + rank + 1) : 0));
    order(vec).forEach((i, rank) => (rrf[i] += 1 / (60 + rank + 1)));
    final = rrf;
  } else {
    final = bm;
  }

  const toHit = (i: number, via?: Hit["via"]): Hit => {
    const c = idx.chunks[i];
    return {
      id: c.id,
      title: c.title,
      text: c.text,
      source: c.source,
      page: c.page,
      url: c.url,
      retrieved: c.retrieved,
      score: Number(final[i].toFixed(4)),
      bm25: Number(bm[i].toFixed(3)),
      vector: vec ? Number(vec[i].toFixed(4)) : null,
      ...(via ? { via } : {}),
    };
  };
  const refIndices = (text: string) =>
    extractArticleRefs(text, idx.lawNames).flatMap((r) => idx.byTitle.get(`${r.law} 第${r.no}條`) ?? []);

  // 1. 問題直接點名的條文（例如「民法第184條是什麼」）放最前面
  const pinned = [...new Set(refIndices(query))].slice(0, 3);
  // 同一條長條文拆成多塊時，只留分數最高的那塊，避免佔滿名額
  const seenTitles = new Set(pinned.map((i) => idx.chunks[i].title));
  const ranked = order(final).filter((i) => {
    if (final[i] <= 0 || pinned.includes(i) || seenTitles.has(idx.chunks[i].title)) return false;
    seenTitles.add(idx.chunks[i].title);
    return true;
  });
  const top = [...pinned.map((i) => toHit(i, "query")), ...ranked.slice(0, Math.max(0, k - pinned.length)).map((i) => toHit(i))];

  // 2. 引用擴充：排名前面的問答（FAQ）引用了哪些條文，就把條文原文也附上（最多 4 段），
  //    讓 Claude 有原文可以引用，使用者也能點開看法條。
  //    一則問答常引用很多條，所以依「條號前後文字和問題有多相關」排序，再輪流從每則問答挑一條。
  const have = new Set(top.map((h) => h.id));
  const qTokens = new Set(tokenize(query));
  const perFaq = top
    .slice(0, 3)
    .filter((h) => h.source.startsWith("faq"))
    .map((h) => rankCitations(h.text, qTokens, idx));
  const extra: Hit[] = [];
  for (let round = 0; extra.length < 4 && perFaq.some((list) => list.length > round); round++) {
    for (const list of perFaq) {
      const i = list[round];
      if (i === undefined || extra.length >= 4 || have.has(idx.chunks[i].id)) continue;
      have.add(idx.chunks[i].id);
      extra.push(toHit(i, "faq"));
    }
  }
  return [...top, ...extra];
}

/** 一則問答裡引用的條文，依「條號附近 40 字」與問題的重疊詞數排序（同分維持原順序）。 */
function rankCitations(faqText: string, qTokens: Set<string>, idx: LoadedIndex): number[] {
  // 只看「答：」的部分；第一行的問句和使用者問題很像，會讓第一個條號分數虛高
  const answer = faqText.slice(faqText.indexOf("\n") + 1);
  const norm = normalizeArticleRefs(answer);
  const refs = extractArticleRefs(answer, idx.lawNames);
  return refs
    .map((r, j) => {
      const prevEnd = j > 0 ? refs[j - 1].end : 0;
      const nextStart = j + 1 < refs.length ? refs[j + 1].start : norm.length;
      // 「……慰撫金（民法第195條）」這種括號註記，說明文字在條號「前面」；否則前後都看
      const parenthetical = norm.slice(Math.max(0, r.start - 2), r.start).includes("（") || norm[r.end] === "）";
      const before = norm.slice(Math.max(prevEnd, r.start - 40), r.start);
      const after = parenthetical ? "" : norm.slice(r.end, Math.min(nextStart, r.end + 40));
      const context = before + after;
      const overlap = new Set(tokenize(context).filter((t) => qTokens.has(t))).size;
      return { indices: idx.byTitle.get(`${r.law} 第${r.no}條`) ?? [], overlap, j };
    })
    .sort((a, b) => b.overlap - a.overlap || a.j - b.j)
    .flatMap((r) => r.indices.slice(0, 1));
}
