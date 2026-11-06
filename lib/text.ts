// 中文文字處理小工具：國字數字轉阿拉伯數字、BM25 用的斷詞。
// 前後端都可以用（沒有 Node 專屬的 API）。

const DIGITS: Record<string, number> = {
  零: 0, 〇: 0, 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};
const UNITS: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };

/** 「一百八十四」→ 184；不是國字數字時回傳 null。支援到「萬」。 */
export function chineseToInt(s: string): number | null {
  if (!s || !/^[零〇一二兩三四五六七八九十百千萬]+$/.test(s)) return null;
  let total = 0;
  let section = 0;
  let digit = 0;
  for (const ch of s) {
    if (ch in DIGITS) {
      digit = DIGITS[ch];
    } else if (ch in UNITS) {
      section += (digit || 1) * UNITS[ch];
      digit = 0;
    } else if (ch === "萬") {
      total += (section + digit) * 10000;
      section = 0;
      digit = 0;
    }
  }
  return total + section + digit;
}

/** 把「第一百八十四條之二」這類條號統一成「第184-2條」，讓查詢和條文比對得起來。 */
export function normalizeArticleRefs(text: string): string {
  return text
    .replace(
      /第([零〇一二兩三四五六七八九十百千]+)條(?:之([一二三四五六七八九十]+))?/g,
      (m, a: string, b?: string) => {
        const n = chineseToInt(a);
        if (n === null) return m;
        const sub = b ? chineseToInt(b) : null;
        return `第${n}${sub ? `-${sub}` : ""}條`;
      },
    )
    .replace(/第\s*(\d+)\s*條\s*之\s*(\d+)/g, "第$1-$2條")
    .replace(/(\d+)\s*條\s*之\s*(\d+)/g, "$1-$2條");
}

const CJK = /[㐀-鿿豈-﫿]/;

// 問句常見、但對找資料沒有幫助的二字詞
const STOP_BIGRAMS = new Set([
  "什麼", "是什", "麼是", "怎麼", "麼辦", "怎樣", "如何", "哪些", "請問", "為什",
  "我的", "我們", "你們", "他們", "一下", "可以", "應該", "是不", "不是", "有沒", "沒有",
]);

export interface ArticleRef {
  law: string;
  no: string;
  /** 在 normalizeArticleRefs(raw) 後文字中的位置 */
  start: number;
  end: number;
}

/**
 * 從文字中找出「法規名稱＋條號」的引用，例如「消費者保護法第19條」「同法第14條」。
 * lawNames 由知識庫的標題自動產生。
 */
export function extractArticleRefs(raw: string, lawNames: string[]): ArticleRef[] {
  if (lawNames.length === 0) return [];
  const text = normalizeArticleRefs(raw);
  const names = [...lawNames].sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`(${names.join("|")}|同法|同條例|本法)?\\s*第\\s*(\\d+(?:-\\d+)?)\\s*條`, "g");
  const out: ArticleRef[] = [];
  let last = "";
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const law = m[1] && !/^(同法|同條例|本法)$/.test(m[1]) ? m[1] : last;
    if (!law) continue;
    last = law;
    if (!out.some((r) => r.law === law && r.no === m![2])) {
      out.push({ law, no: m[2], start: m.index, end: m.index + m[0].length });
    }
  }
  return out;
}

/**
 * BM25 斷詞：中文用「二字詞（bigram）」，英文與數字用整個詞。
 * 中文沒有空格，bigram 是不需要字典也能運作的簡單方法。
 * 法規名稱與條號（例如「184-2」）會被保留成完整的詞。
 */
export function tokenize(raw: string): string[] {
  const text = normalizeArticleRefs(raw).toLowerCase();
  const tokens: string[] = [];
  const re = /[a-z]+|\d+(?:-\d+)?|[㐀-鿿豈-﫿]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const w = m[0];
    if (CJK.test(w[0])) {
      // 單一個字（例如日期裡的「年」「月」）不當成詞，避免誤配
      for (let i = 0; i < w.length - 1; i++) {
        const bg = w.slice(i, i + 2);
        if (!STOP_BIGRAMS.has(bg)) tokens.push(bg);
      }
    } else if (/^\d/.test(w)) {
      // 數字只在「第184條」這種條號中才有意義；日期、金額裡的數字會誤配到「第10條」之類的條文
      if (text.slice(0, m.index).trimEnd().endsWith("第")) tokens.push(w);
    } else {
      tokens.push(w);
    }
  }
  return tokens;
}

// 口語 → 法條用語的同義詞（查詢擴充）。法條寫「出租人」「通訊交易」，使用者會說「房東」「網購」。
// 只用在 BM25 關鍵字檢索；向量檢索本身就能理解語意。
const SYNONYMS: [RegExp, string][] = [
  [/房東/, "出租人"],
  [/房客|租客/, "承租人"],
  [/押金|保證金/, "押金 押租金"],
  [/網購|網路購物|電視購物|線上購買/, "通訊交易"],
  [/退貨|退錢|不想要了|不喜歡/, "解除契約"],
  [/老闆|公司/, "雇主"],
  [/薪水|薪資/, "工資"],
  [/加班/, "延長工作時間"],
  [/特休|年假/, "特別休假"],
  [/資遣|裁員|開除|解僱/, "終止勞動契約 資遣費 預告"],
  [/撞|車禍|擦撞/, "侵權行為 損害賠償"],
  [/慰撫金|精神賠償|精神損害/, "非財產上之損害 慰撫金"],
  [/壞了|故障|漏水|不修/, "修繕"],
  [/最晚|多久|期限|來得及|過期/, "時效 期間 消滅"],
  [/告|求償|要錢|賠錢/, "請求權 賠償"],
  [/調解/, "調解委員會"],
  [/請不起律師|沒錢請律師|免費律師/, "法律扶助 無資力"],
];

export function expandQuery(query: string): string {
  const extra = SYNONYMS.filter(([re]) => re.test(query)).map(([, add]) => add);
  return extra.length ? `${query} ${extra.join(" ")}` : query;
}
