// 送 TTS 前的文字正規化（第五章 5.6）：語音合成常把「第184條」、電話號碼、英文縮寫念錯。
// 前端（瀏覽器語音）與後端（ElevenLabs）共用。

const D = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
const DIGIT_READ = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];

function under10000(n: number): string {
  const units = ["千", "百", "十", ""];
  const digits = [Math.floor(n / 1000), Math.floor(n / 100) % 10, Math.floor(n / 10) % 10, n % 10];
  let out = "";
  let zero = false;
  digits.forEach((d, i) => {
    if (d === 0) {
      if (out) zero = true;
      return;
    }
    if (zero) out += "零";
    zero = false;
    out += D[d] + units[i];
  });
  return out;
}

/** 184 → 一百八十四；2000 → 兩千；10 → 十。 */
export function intToChinese(n: number): string {
  if (!Number.isFinite(n) || n < 0 || n >= 1e12) return String(n);
  if (n === 0) return "零";
  const yi = Math.floor(n / 1e8);
  const wan = Math.floor(n / 1e4) % 1e4;
  const rest = n % 1e4;
  let out = "";
  if (yi) out += under10000(yi) + "億";
  if (wan) out += (yi && wan < 1000 ? "零" : "") + under10000(wan) + "萬";
  if (rest) out += ((yi || wan) && rest < 1000 ? "零" : "") + under10000(rest);
  out = out.replace(/^一十/, "十");
  // 口語：開頭的「二千／二百／二萬」念成「兩千／兩百／兩萬」
  return out.replace(/^二(?=[千百萬億])/, "兩").replace(/(?<=[萬億])二(?=[千百])/g, "兩");
}

const readDigits = (s: string) => s.replace(/\d/g, (d) => DIGIT_READ[Number(d)]);

const UNIT_AFTER = "條項款年月日元塊萬千百歲天個次週周名人位份張間倍頁件小時分鐘秒公里度";

export function normalizeForSpeech(input: string): string {
  let t = input;

  // 1. 去掉 Markdown、網址、表情符號
  t = t
    .replace(/https?:\/\/\S+/g, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*?|__|~~|^#+\s*|^[-*•]\s+|^\d+\.\s+/gm, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "");

  // 2. 條號：第184條之2、第184-2條 → 第一百八十四條之二
  t = t.replace(/第\s*(\d+)\s*(?:-|條之)\s*(\d+)\s*條?/g, (_, a, b) => `第${intToChinese(+a)}條之${intToChinese(+b)}`);
  t = t.replace(/§\s*(\d+)/g, (_, a) => `第${intToChinese(+a)}條`);

  // 3. 日期：2026-03-10、2026/3/10 → 二〇二六年三月十日
  t = t.replace(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/g, (_, y, m, d) =>
    `${y.replace(/\d/g, (c: string) => (c === "0" ? "〇" : D[+c]))}年${intToChinese(+m)}月${intToChinese(+d)}日`);
  // 民國 115 年、2026 年：年份逐字念
  t = t.replace(/(\d{4})\s*年/g, (_, y) => `${y.replace(/\d/g, (c: string) => (c === "0" ? "〇" : D[+c]))}年`);

  // 4. 電話：412-8518、02-2345-6789 → 逐字念，中間停頓
  t = t.replace(/\b\d{2,4}(?:-\d{3,4}){1,2}\b/g, (m) => readDigits(m).replace(/-/g, "，"));

  // 5. 金額與百分比：NT$5,000、50,000元、10%
  t = t.replace(/(?:NT\$|新臺幣|新台幣)\s*([\d,]+)/g, (_, n) => `新臺幣${intToChinese(+n.replace(/,/g, ""))}元`);
  t = t.replace(/(\d{1,3}(?:,\d{3})+)/g, (m) => m.replace(/,/g, ""));
  t = t.replace(/(\d+(?:\.\d+)?)\s*%/g, (_, n) => `百分之${numberWords(n)}`);

  // 6. 其他數字：後面接單位 → 數值念法；三位數以上又沒有單位（如 110、1955 專線）→ 逐字念
  t = t.replace(/(第)?(\d+(?:\.\d+)?)(?=\s*([^\s\d]?))/g, (m, di: string | undefined, n: string, next: string) => {
    if (UNIT_AFTER.includes(next || "∅") || di || n.includes(".") || n.length <= 2) {
      let w = numberWords(n);
      if (w === "二" && !di && /[年個天次週周歲萬千百位份張間倍名件]/.test(next || "")) w = "兩";
      return (di ?? "") + w;
    }
    return readDigits(n);
  });

  // 7. 英文縮寫：RAG → R A G（AI、OK 這類常見詞保留）
  t = t.replace(/\b[A-Z]{2,5}\b/g, (m) => (["AI", "OK", "LINE"].includes(m) ? m : m.split("").join(" ")));

  return t.replace(/[ \t]{2,}/g, " ").replace(/\n{2,}/g, "\n").trim();
}

function numberWords(n: string): string {
  if (n.includes(".")) {
    const [a, b] = n.split(".");
    return `${intToChinese(+a)}點${readDigits(b)}`;
  }
  return intToChinese(+n);
}
