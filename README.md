# 小法：會講話的 AI 法律資訊助理

用 Claude Code 打造的「會講話的 AI 代理人網站」課程作業。使用者可以打字或按住麥克風說話，代理人「小法」會根據全國法規資料庫的條文（RAG 知識庫）回答租屋、車禍、勞資與消費糾紛等問題，附上法條出處，並用語音把答案念出來，角色圖會跟著切換「思考中／說話中」。

> 本服務由 AI 提供一般資訊，不能取代專業人員意見。

## 功能一覽（對照作業章節）

| 作業要求 | 實作 | 主要檔案 |
| --- | --- | --- |
| 3.3 串接 Claude API | 串流回答（effort `low`）、拒答時伺服器自動改用備援模型（server-side fallback） | `lib/agent-core.ts`、`app/api/chat/route.ts` |
| 3.4 系統提示 | 身分、說話風格、知識來源、必須／禁止做的事、回答格式 | `lib/prompts.ts` |
| 4 RAG 知識庫 | 10 部法規共 484 條 + 20 則自寫問答 → 509 個 chunk；法條一條一塊 | `data/raw/`、`scripts/ingest.ts`、`lib/chunk.ts` |
| 4.6 / 4.8 檢索 | BM25（中文二字詞 + 同義詞擴充）；有 OpenAI 金鑰時加向量並以 RRF 混合；問題點名條號時直接取該條；附上問答引用的條文原文 | `lib/rag.ts`、`lib/text.ts` |
| 4.9 評估 | 26 題測試集；檢索命中率、Claude 評審的答案正確率與拒答正確率 | `data/eval/testset.json`、`scripts/eval.ts`、`docs/rag-tuning.md` |
| 5.2 TTS | ElevenLabs `eleven_multilingual_v2`，stability 0.65（律師的沉穩聲音） | `app/api/tts/route.ts` |
| 5.3 / 5.5 播放與延遲 | 邊串流邊斷句，一句一句送 TTS 並預先抓下一句 | `lib/client/speech-player.ts`、`components/AgentApp.tsx` |
| 5.4 STT | 按住麥克風錄音 → ElevenLabs `scribe_v1`；未設定時改用瀏覽器 Web Speech API | `components/MicButton.tsx`、`app/api/stt/route.ts` |
| 5.6 發音 | 條號、電話、日期、金額、英文縮寫轉成好念的中文 | `lib/speech-normalize.ts` |
| 6 角色圖像 | idle／talking／thinking 三種狀態、依音量張嘴、呼吸動畫；附 ChatGPT 提示詞 | `components/Avatar.tsx`、`docs/character.md`、`public/avatar/` |
| 7.1 / 7.2 介面 | 桌機左 40% 角色、右 60% 對話；手機頂部 160px 橫條；三個範例問題；可展開參考資料；暫停／停止／靜音／語速／只看文字；免責聲明 | `components/` |
| 範例一特殊功能 | 「計算訴訟時效」Claude 工具呼叫，日期由程式依民法第 120、121 條計算 | `lib/tools.ts` |
| 9 安全與倫理 | 每 IP 每分鐘次數限制、輸入 500 字上限、個資遮蔽、緊急／刑事／時效提示卡、提示注入清除、不儲存對話、隱私說明頁 | `lib/safety.ts`、`app/privacy/page.tsx` |

## 快速開始

需要 Node.js 20 以上。

```bash
npm install
```

```bash
cp .env.local.example .env.local
```

用編輯器打開 `.env.local` 填入金鑰（見下一節），然後：

```bash
npm run ingest
```

```bash
npm run dev
```

打開 http://localhost:3000 。

### 金鑰與「沒有金鑰時」的行為

| 變數 | 用途 | 沒有設定時 |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | Claude 回答問題 | 示範模式：直接念出檢索到的第一段資料 |
| `ELEVENLABS_API_KEY`、`ELEVENLABS_VOICE_ID` | 語音合成與辨識 | 自動改用瀏覽器內建語音（作業 FAQ 建議的省額度做法） |
| `OPENAI_API_KEY`（選用） | 產生向量 | 只用 BM25 關鍵字檢索，網站仍可正常運作 |
| `CLAUDE_MODEL`（選用） | 更換模型 | 預設 `claude-sonnet-5-5` |
| `CLAUDE_FALLBACK`（選用） | 設成 `off` 關閉拒答備援 | 預設開啟 |
| `RATE_LIMIT_PER_MINUTE`（選用） | 每 IP 每分鐘聊天次數 | 預設 10 |

金鑰只在伺服器端讀取，`.env.local` 已列在 `.gitignore`，**不要**把金鑰貼進程式、截圖或對話中。

### 選擇 ElevenLabs 聲音
到 ElevenLabs 的 Voices → Voice Library 用語言篩選「Chinese」，挑沉穩、清晰、語速稍慢的成年聲音，加入 My Voices 後複製 Voice ID 填入 `ELEVENLABS_VOICE_ID`。禁止未經本人書面同意複製任何真實人物的聲音。

## 換上 ChatGPT 畫的角色圖
專案附的 `public/avatar/*.svg` 是暫代圖。依 `docs/character.md` 的提示詞用 ChatGPT 生成三張圖，存成 `public/avatar/idle.png`、`talking.png`、`thinking.png`（512×512），重新啟動 `npm run dev` 或重新部署後就會自動改用 PNG。

## 測試與評估

```bash
npm run test:unit
```

不需要金鑰，測試期限計算、語音正規化、個資遮蔽、關鍵字偵測、切塊與檢索。

```bash
npm run test:chat
```

用 5 個問題測試 `/api/chat`，需要先在另一個終端機執行 `npm run dev`。

```bash
npm run eval
```

跑完 26 題測試集，結果寫入 `docs/eval-report.md`。沒有 `ANTHROPIC_API_KEY` 時只評估檢索；加上 `-- --retrieval-only` 可強制只測檢索（免費）。目前的數據與調整過程見 `docs/rag-tuning.md`。

## 部署到 Vercel
1. 確認 `.gitignore` 內有 `.env.local` 與 `node_modules`，把專案推到 GitHub。
2. 到 vercel.com 用 GitHub 登入，Import 這個 repository。
3. 在 Vercel 專案的 Settings → Environment Variables 填入 `.env.local` 中的金鑰。
4. 按 Deploy，取得公開網址。`data/index.json` 已在 `next.config.ts` 設定為會被打包進 API 函式。
5. 用手機實測語音錄放（iOS Safari 需要先點擊畫面才能播放音訊，本專案在送出與按麥克風時會自動解鎖）。
6. 在 Anthropic 與 ElevenLabs 後台設定每月花費上限；展示結束後可暫停部署。

## 專案結構

```
app/
  page.tsx               首頁（AgentApp）
  privacy/page.tsx       隱私權與資料使用說明
  api/chat/route.ts      RAG + Claude 串流（NDJSON）
  api/tts/route.ts       ElevenLabs 文字轉語音
  api/stt/route.ts       ElevenLabs 語音轉文字
  api/config/route.ts    告訴前端哪些服務已設定（不回傳金鑰）
components/
  AgentApp.tsx           主程式：版面、串流處理、逐句朗讀、角色狀態
  Avatar.tsx             角色圖與狀態切換
  ChatPanel.tsx          對話視窗與輸入區
  ChatMessage.tsx        單則訊息、提示卡、期限試算卡、參考資料
  MicButton.tsx          按住說話
  VoiceControls.tsx      語音控制列
lib/
  agent.ts               代理人設定（名字、範例問題、聲音參數）
  prompts.ts             系統提示
  agent-core.ts          檢索 → Claude → 工具迴圈
  rag.ts / text.ts       檢索、斷詞、同義詞、條號解析
  chunk.ts               清理與切塊
  tools.ts               計算時效工具
  safety.ts              安全防護
  speech-normalize.ts    TTS 文字正規化
  client/                瀏覽器端的語音播放器與型別
scripts/                 ingest、eval、test-chat、test-unit
data/raw/                原始資料（法條、自寫問答）
data/index.json          知識庫索引（由 ingest 產生）
docs/                    角色設計書、RAG 調整紀錄、評估報告
```

## 書面報告素材對照（第十章 10.2）

| 報告章節 | 可以參考 |
| --- | --- |
| 2. 系統架構 | 本檔「功能一覽」、`lib/agent-core.ts` 開頭註解、作業 1.3 的資料流 |
| 3. 開發過程 | `CLAUDE.md`、與 Claude Code 的對話紀錄 |
| 4. 資料與 RAG | `data/README.md`、`docs/rag-tuning.md`、`docs/eval-report.md` |
| 5. 語音設計 | `lib/speech-normalize.ts`（發音問題與解法）、`lib/client/speech-player.ts`（降低延遲） |
| 6. 角色設計 | `docs/character.md` |
| 7. 網頁介面 | 桌機／手機截圖、`components/` |
| 8. 倫理與安全 | `lib/safety.ts`、`lib/prompts.ts`、`app/privacy/page.tsx` |

## 已知限制
- 次數限制存在伺服器記憶體中，Vercel 多個實例之間不共享，只能擋住簡單濫用。
- 知識庫只涵蓋選定的法規與條文，離婚、繼承、刑法等主題會回答「資料沒有涵蓋」。
- 期限試算未考慮時效中斷、不完成與國定假日順延，介面上已提示。
- 法規會修正，請定期重新擷取並執行 `npm run ingest`。
