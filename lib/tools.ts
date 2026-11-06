// Claude 工具呼叫（tool use）：「計算時效／期限」小工具（第八章範例一的特殊功能）。
// 日期由程式計算，避免模型心算出錯；Claude 只負責判斷該用哪一種期限、從哪天起算。

import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

interface DeadlineRule {
  label: string;
  law: string;
  unit: "year" | "day";
  amount: number;
  startMeaning: string;
}

// 每一條規則都對應 data/raw 中可以查到的條文
export const DEADLINE_RULES = {
  tort_known: {
    label: "侵權行為損害賠償請求權（知道損害及賠償義務人起算）",
    law: "民法第197條第1項",
    unit: "year", amount: 2,
    startMeaning: "知道有損害及賠償義務人（加害人）的日期",
  },
  tort_act: {
    label: "侵權行為損害賠償請求權（從侵權行為發生起算的最長期間）",
    law: "民法第197條第1項",
    unit: "year", amount: 10,
    startMeaning: "侵權行為發生的日期",
  },
  general: {
    label: "一般請求權消滅時效",
    law: "民法第125條、第128條",
    unit: "year", amount: 15,
    startMeaning: "請求權可以行使的日期",
  },
  periodic: {
    label: "利息、租金、退職金等一年以內定期給付的各期請求權",
    law: "民法第126條",
    unit: "year", amount: 5,
    startMeaning: "該期款項應給付的日期",
  },
  short_term: {
    label: "民法第127條所列短期請求權（如商品代價、承攬報酬、運送費、住宿飲食費）",
    law: "民法第127條",
    unit: "year", amount: 2,
    startMeaning: "請求權可以行使的日期",
  },
  lease_damage_or_expense: {
    label: "租賃物損害賠償、承租人償還費用及工作物取回權",
    law: "民法第456條",
    unit: "year", amount: 2,
    startMeaning: "出租人：收回房屋的日期；承租人：租約終止的日期",
  },
  auto_insurance: {
    label: "強制汽車責任保險給付請求權",
    law: "強制汽車責任保險法第14條第1項",
    unit: "year", amount: 2,
    startMeaning: "知道有損害發生及保險人的日期",
  },
  online_return: {
    label: "網購（通訊交易）七日內解除契約",
    law: "消費者保護法第19條第1項",
    unit: "day", amount: 7,
    startMeaning: "收到商品或接受服務的日期",
  },
  severance_payment: {
    label: "勞退新制資遣費的發給期限",
    law: "勞工退休金條例第12條第2項",
    unit: "day", amount: 30,
    startMeaning: "勞動契約終止的日期",
  },
} satisfies Record<string, DeadlineRule>;

export type DeadlineType = keyof typeof DEADLINE_RULES;
const TYPES = Object.keys(DEADLINE_RULES) as [DeadlineType, ...DeadlineType[]];

export const DeadlineInput = z.object({
  claim_type: z.enum(TYPES),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式需為 YYYY-MM-DD"),
});

// ---------- 日期計算（全部用 UTC，避免時區造成差一天） ----------
function parseDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    throw new Error(`不存在的日期：${s}`);
  }
  return dt;
}
const fmt = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

/**
 * 依民法第120條第2項「始日不算入」、第121條「期間末日」計算到期日。
 * - 以日定期間：事件日後第 n 天的終了。
 * - 以年定期間：從翌日起算，到最後一年「與起算日相當日的前一日」；
 *   最後一個月沒有相當日（例如 2 月 29 日）時，以該月末日為末日。
 */
export function computeDeadline(startDate: string, unit: "year" | "day", amount: number): string {
  const event = parseDate(startDate);
  if (unit === "day") return fmt(addDays(event, amount));
  const start = addDays(event, 1); // 始日不算入
  const y = start.getUTCFullYear() + amount;
  const m = start.getUTCMonth();
  const d = start.getUTCDate();
  if (d > daysInMonth(y, m)) return fmt(new Date(Date.UTC(y, m, daysInMonth(y, m))));
  return fmt(addDays(new Date(Date.UTC(y, m, d)), -1));
}

function todayInTaipei(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date());
}

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

export function calculateDeadline(input: z.infer<typeof DeadlineInput>, today = todayInTaipei()) {
  const rule = DEADLINE_RULES[input.claim_type];
  const deadline = computeDeadline(input.start_date, rule.unit, rule.amount);
  const end = parseDate(deadline);
  const daysLeft = Math.round((end.getTime() - parseDate(today).getTime()) / 86400000);
  const weekday = end.getUTCDay();
  return {
    claim: rule.label,
    law: rule.law,
    period: `${rule.amount}${rule.unit === "year" ? "年" : "日"}`,
    start_date: input.start_date,
    start_meaning: rule.startMeaning,
    counting_from: fmt(addDays(parseDate(input.start_date), 1)),
    deadline,
    deadline_weekday: `星期${WEEKDAYS[weekday]}`,
    today,
    days_left: daysLeft,
    expired: daysLeft < 0,
    notes: [
      "依民法第120條第2項，期間的第一天不算入，從隔天開始計算。",
      weekday === 0 || weekday === 6
        ? "到期日剛好是週末；依民法第122條，期間末日遇休息日時可能以次日代之，但仍建議提早處理。"
        : "如果到期日遇到國定假日，可能依民法第122條順延，但仍建議提早處理。",
      "時效可能因請求、起訴、承認等事由中斷或不完成，個案請諮詢律師或法律扶助基金會。",
    ],
  };
}

export type DeadlineResult = ReturnType<typeof calculateDeadline>;

/** 給 Claude 看的工具說明（JSON Schema）。 */
export const DEADLINE_TOOL: Anthropic.Beta.BetaTool = {
  name: "calculate_deadline",
  description:
    "計算台灣法律上的時效或期限到期日。當使用者想知道「還有多久可以提告／求償」、「幾號以前要退貨」、「資遣費最晚哪天要給」時使用。" +
    "你只需要選出 claim_type 並給起算事件的日期（YYYY-MM-DD，西元年）；日期由程式依民法第120、121條計算。" +
    "若使用者沒有提供日期，請先詢問，不要自己猜。claim_type 說明：" +
    Object.entries(DEADLINE_RULES)
      .map(([k, r]) => `${k}=${r.label}（${r.law}，起算日：${r.startMeaning}）`)
      .join("；"),
  input_schema: {
    type: "object",
    properties: {
      claim_type: { type: "string", enum: TYPES, description: "要計算的期限種類" },
      start_date: { type: "string", description: "起算事件發生日，格式 YYYY-MM-DD（西元年）" },
    },
    required: ["claim_type", "start_date"],
    additionalProperties: false,
  },
  strict: true,
  // 串流時讓工具參數邊產生邊傳送；因此伺服器不再驗證，我們自己用 zod 驗證
  eager_input_streaming: true,
};
