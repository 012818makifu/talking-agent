// 代理人的基本設定：名字、專長、歡迎詞、範例問題、聲音參數。
// 這個檔案前端和後端都會讀，所以「不可以」放任何金鑰。
// 若要做第七章 7.3 的多代理人切換，可以把這個物件改成 AGENTS = { lawyer: {...}, translator: {...} }。

export const AGENT = {
  id: "lawyer",
  name: "小法",
  title: "AI 法律資訊助理",
  tagline: "用白話文陪你看懂租屋、車禍、勞資與消費糾紛的法律規定",
  tags: ["租屋押金", "車禍理賠", "勞資爭議", "消費糾紛", "訴訟時效"],
  welcome:
    "你好，我是小法，一個 AI 法律資訊助理。我會根據全國法規資料庫的條文，用白話解釋租屋、車禍、勞資和消費糾紛的規定，並告訴你可以找誰幫忙。我提供的是一般法律資訊，不是律師的正式意見喔。",
  exampleQuestions: [
    "房東退租後不還押金怎麼辦？",
    "公司要資遣我，資遣費怎麼算？",
    "網購的東西不喜歡，可以退貨嗎？",
  ],
  avatar: {
    // 先找 PNG（ChatGPT 畫好的角色圖），找不到就用專案內附的 SVG 暫代圖
    basePath: "/avatar",
    states: ["idle", "talking", "thinking"] as const,
  },
  voice: {
    // 第八章範例一：律師聲音要沉穩，stability 調高到 0.6–0.7
    stability: 0.65,
    similarityBoost: 0.8,
    browserLang: "zh-TW",
  },
  disclaimer: "本服務由 AI 提供一般資訊，不能取代專業人員意見。",
} as const;

export type AvatarState = (typeof AGENT.avatar.states)[number];
