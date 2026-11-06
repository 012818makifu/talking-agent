# 專案：會講話的 AI 代理人網站 —— AI 法律資訊助理「小法」

## 技術選型
- 框架：Next.js 15（App Router）+ TypeScript + Tailwind CSS 4
- LLM：Anthropic Claude API（`@anthropic-ai/sdk`），模型 `claude-sonnet-5-5`（可用環境變數 `CLAUDE_MODEL` 覆寫），串流回答、effort `low`
- 檢索：本地 `data/index.json`；BM25 關鍵字檢索（中文二字詞 + 同義詞擴充），有 `OPENAI_API_KEY` 時加上 `text-embedding-3-small`（512 維）向量並以 RRF 混合
- 語音：ElevenLabs TTS（`eleven_multilingual_v2`）與 STT（`scribe_v1`）；沒設定時前端自動改用瀏覽器內建語音
- 工具呼叫：`calculate_deadline`（lib/tools.ts）由程式計算時效到期日

## 規範
- 所有金鑰放在 `.env.local`，只能在伺服器端（`app/api/**`、`lib/agent-core.ts`、`lib/rag.ts`）讀取；前端元件不可 import 讀取金鑰的程式（型別用 `import type`）
- 介面語言：繁體中文（台灣用語）；代理人回答必須附上資料出處（法規名稱 + 條號）
- 回答會被念出來：系統提示要求口語、短句、不用 Markdown；送 TTS 前一律經過 `lib/speech-normalize.ts`
- 法條資料一條一個 chunk，標題格式固定為「法規名稱 第N條」（`lib/rag.ts` 依此建立條號索引）
- 修改資料後執行 `npm run ingest`；修改程式後執行 `npm run test:unit` 與 `npm run build` 確認沒有錯誤
- 調整檢索或提示詞後執行 `npm run eval`，把前後數據記在 `docs/rag-tuning.md`

## 常用指令
- `npm run dev`：開發伺服器（http://localhost:3000）
- `npm run ingest`：重建知識庫索引（`--no-embed` 不產生向量）
- `npm run test:unit`：單元測試（不需金鑰）
- `npm run test:chat`：用 5 個問題測試 /api/chat（需先 `npm run dev`）
- `npm run eval`：RAG 評估（`--retrieval-only` 只測檢索）
- `npm run build`：正式建置

## 重要檔案
- `lib/prompts.ts`：系統提示（人格與規矩）
- `lib/agent-core.ts`：檢索 → Claude 串流 → 工具迴圈（/api/chat 與 eval 共用）
- `lib/rag.ts`、`lib/text.ts`、`lib/chunk.ts`：檢索、斷詞、切塊
- `lib/safety.ts`：次數限制、個資遮蔽、緊急／刑事／時效關鍵字偵測
- `components/AgentApp.tsx`：前端主程式（串流、逐句朗讀、角色狀態）
