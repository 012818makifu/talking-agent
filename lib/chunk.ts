// 資料清理與切塊（第四章 4.2、4.5）。由 scripts/ingest.ts 使用。
// 原則：先依「標題、空行、句號」切出自然段，再合併太短的、拆開太長的。
// 法條與 FAQ 以「一條」「一題」為單位，並把標題（例如「民法 第184條」）重複寫在每塊開頭。

export interface Chunk {
  id: string;
  /** 送給檢索與 Claude 的內容（開頭含標題） */
  text: string;
  /** 原始檔名，例如 law_civil_code.md */
  source: string;
  /** 給使用者看的出處，例如「民法 第184條」 */
  title: string;
  /** PDF 頁碼；Markdown／TXT 為 null */
  page: number | null;
  /** 官方來源網址（從檔案開頭的 frontmatter 取得） */
  url?: string;
  /** 擷取日期，提醒資料可能過時 */
  retrieved?: string;
  embedding?: number[];
}

export interface FrontMatter {
  title?: string;
  source?: string;
  retrieved?: string;
  type?: string;
  [k: string]: string | undefined;
}

export const CHUNK_TARGET = 500; // 每塊約 500 個中文字
export const CHUNK_OVERLAP = 80; // 相鄰塊重疊 80 字
const CHUNK_MAX = 700; // 超過就拆開

/** 讀取檔案開頭 --- 包起來的 key: value 設定。 */
export function parseFrontMatter(raw: string): { meta: FrontMatter; body: string } {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { meta: {}, body: raw };
  const meta: FrontMatter = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { meta, body: raw.slice(m[0].length) };
}

// 提示注入（prompt injection）防護：下載的資料若夾帶這類文字就刪掉（第九章 9.6）
const INJECTION_PATTERNS = [
  /忽略(?:先前|之前|以上|前面|所有)?的?(?:所有)?(?:指示|指令|規則|設定)/,
  /(?:無視|不要理會)(?:先前|之前|以上)?的?(?:指示|指令|規則)/,
  /ignore\s+(?:all\s+|any\s+)?(?:previous|prior|above)\s+instructions/i,
  /you\s+are\s+now\s+/i,
  /(?:system|developer)\s*prompt/i,
  /<\/?\s*(?:system|instructions?)\s*>/i,
];

export function removeInjections(text: string): { text: string; removed: number } {
  let removed = 0;
  const kept = text.split("\n").filter((line) => {
    const bad = INJECTION_PATTERNS.some((re) => re.test(line));
    if (bad) removed++;
    return !bad;
  });
  return { text: kept.join("\n"), removed };
}

/** 基本清理：去掉零寬字元、頁碼行、多餘空白。 */
export function cleanText(text: string): string {
  return text
    .replace(/[​-‍﻿]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/^[ \t]*(?:[-—–]\s*\d+\s*[-—–]|第\s*\d+\s*頁(?:\s*[/／]\s*共\s*\d+\s*頁)?|page\s*\d+(?:\s*of\s*\d+)?)[ \t]*$/gim, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** PDF 的頁首頁尾：在超過一半頁面重複出現的短行，視為頁首頁尾刪除。 */
export function stripRepeatedLines(pages: string[]): string[] {
  if (pages.length < 3) return pages;
  const count = new Map<string, number>();
  for (const p of pages) {
    const seen = new Set(
      p.split("\n").map((l) => l.trim()).filter((l) => l.length > 0 && l.length <= 30),
    );
    for (const l of seen) count.set(l, (count.get(l) ?? 0) + 1);
  }
  const repeated = new Set(
    [...count.entries()].filter(([, n]) => n > pages.length / 2).map(([l]) => l),
  );
  return pages.map((p) =>
    p.split("\n").filter((l) => !repeated.has(l.trim())).join("\n"),
  );
}

/** 依句號切句（保留標點）。 */
function splitSentences(text: string): string[] {
  return text.match(/[^。！？!?；;\n]+[。！？!?；;]*\n?|\n/g)?.filter((s) => s.trim()) ?? [text];
}

/** 把一段長文字切成 ≤ CHUNK_TARGET 的塊，相鄰塊重疊 CHUNK_OVERLAP 字。 */
export function splitLong(text: string, target = CHUNK_TARGET, overlap = CHUNK_OVERLAP): string[] {
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const pieces: string[] = [];
  for (const p of paragraphs) {
    if (p.length <= target) pieces.push(p);
    else {
      let buf = "";
      for (const s of splitSentences(p)) {
        if (buf && (buf + s).length > target) {
          pieces.push(buf.trim());
          buf = "";
        }
        buf += s;
      }
      if (buf.trim()) pieces.push(buf.trim());
    }
  }
  // 合併太短的段落
  const merged: string[] = [];
  for (const p of pieces) {
    const last = merged[merged.length - 1];
    if (last !== undefined && (last + "\n" + p).length <= target) merged[merged.length - 1] = last + "\n" + p;
    else merged.push(p);
  }
  // 加上重疊：每塊開頭帶上前一塊最後 overlap 個字
  return merged.map((m, i) => (i === 0 ? m : "…" + merged[i - 1].slice(-overlap) + "\n" + m));
}

/** 「民法 第184條（第二編債 › …）」→ 標題「民法 第184條」 */
function shortTitle(heading: string): string {
  return heading.replace(/（[^（）]*）$/, "").trim();
}

/** 法條／FAQ：一個 ### 段落就是一塊；太長的條文依「項」拆開，每塊都重複標題。 */
function chunkBySection(body: string): { title: string; text: string }[] {
  const out: { title: string; text: string }[] = [];
  const sections = body.split(/\n(?=### )/);
  for (const sec of sections) {
    if (!sec.startsWith("### ")) continue;
    const nl = sec.indexOf("\n");
    const heading = sec.slice(4, nl === -1 ? undefined : nl).trim();
    const content = (nl === -1 ? "" : sec.slice(nl + 1)).trim();
    if (!content) continue;
    const title = shortTitle(heading);
    if (heading.length + content.length <= CHUNK_MAX) {
      out.push({ title, text: `${heading}\n${content}` });
      continue;
    }
    // 長條文：以行（項／款）為單位累積
    let buf = "";
    let part = 1;
    for (const line of content.split("\n")) {
      if (buf && (buf + "\n" + line).length > CHUNK_TARGET) {
        out.push({ title, text: `${heading}${part > 1 ? "（續）" : ""}\n${buf}` });
        part++;
        buf = "";
      }
      buf = buf ? buf + "\n" + line : line;
    }
    if (buf) out.push({ title, text: `${heading}${part > 1 ? "（續）" : ""}\n${buf}` });
  }
  return out;
}

/** 一般文件：先依 Markdown 標題分節，再切成約 500 字的塊。 */
function chunkGeneric(body: string, docTitle: string): { title: string; text: string }[] {
  const out: { title: string; text: string }[] = [];
  const sections = body.split(/\n(?=#{1,4} )/);
  for (const sec of sections) {
    const hm = sec.match(/^#{1,4} (.+)\n?/);
    const heading = hm ? hm[1].trim() : "";
    const content = hm ? sec.slice(hm[0].length) : sec;
    if (!content.trim()) continue;
    const title = heading ? `${docTitle}：${heading}` : docTitle;
    for (const piece of splitLong(content)) {
      out.push({ title, text: heading ? `${heading}\n${piece}` : piece });
    }
  }
  return out;
}

export function chunkDocument(opts: {
  source: string;
  body: string;
  meta: FrontMatter;
  page?: number | null;
}): Chunk[] {
  const { source, body, meta } = opts;
  const url = meta.source?.match(/https?:\/\/\S+/)?.[0];
  const docTitle = meta.title ?? source.replace(/\.[^.]+$/, "");
  const parts =
    meta.type === "law" || meta.type === "faq" ? chunkBySection(body) : chunkGeneric(body, docTitle);
  return parts.map((p, i) => ({
    id: `${source}${opts.page ? `#p${opts.page}` : ""}#${i + 1}`,
    text: p.text,
    source,
    // PDF 的出處加上頁碼，例如「講義 第3頁」
    title: opts.page ? `${p.title} 第${opts.page}頁` : p.title,
    page: opts.page ?? null,
    url,
    retrieved: meta.retrieved,
  }));
}
