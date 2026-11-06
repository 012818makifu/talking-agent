# 角色設計書：小法（AI 法律資訊助理）

> 第六章 6.2：Claude 負責文字層面的角色設定，ChatGPT 負責把外型畫出來。
> 專案內附的 `public/avatar/*.svg` 只是暫代圖，請依本設計書用 ChatGPT 生成正式角色圖。

## 基本設定

| 項目 | 內容 |
| --- | --- |
| 名字 | 小法（Xiao Fa） |
| 身分 | AI 法律資訊助理（明確是 AI，不是律師、不是真人） |
| 年齡感 | 約 30 歲出頭，像剛執業幾年、耐心的學長姊 |
| 個性關鍵字 | 沉穩、親切、可靠 |
| 說話方式 | 白話、短句、先講重點再講出處；不嚇人也不打包票 |
| 服裝 | 深藍色西裝外套、白襯衫、金黃色領帶 |
| 配件 | 圓框眼鏡、胸前「AI」徽章（提醒使用者這是 AI） |
| 代表道具 | 一本小法典（封面印「法」字） |
| 背景 | 淺色書架，柔和、不壓迫 |

## 配色

| 用途 | 顏色 | HEX |
| --- | --- | --- |
| 主色（外套、標題、按鈕） | 深藍 | `#1E3A5F` |
| 強調色（領帶、徽章、標籤） | 金黃 | `#F2C14E` |
| 底色 | 白 | `#FFFFFF` |

網站配色（`app/globals.css`）與角色圖使用同一組顏色，讓整體視覺一致。

## 表情與狀態（第六章 6.4）

| 狀態 | 檔名 | 表情 |
| --- | --- | --- |
| 待機 | `idle.png` | 閉嘴、溫和微笑，正視前方 |
| 說話中 | `talking.png` | 與待機完全相同，只有嘴巴張開 |
| 思考中 | `thinking.png` | 同一角色，手托下巴、眼睛看向右上方 |

## ChatGPT 提示詞

### 1. 基準圖（第一張）

```
A friendly half-body character portrait for a website AI assistant,
semi-flat illustration style, clean lines, soft shading.
Character: a Taiwanese legal information assistant named "Xiao Fa", early 30s,
navy blazer, white shirt, golden-yellow tie, round glasses,
a small gold "AI" badge on the blazer, holding a small law book with the character "法" on the cover,
calm and trustworthy smile, mouth closed.
Color palette #1E3A5F #F2C14E #FFFFFF.
Background: a light, softly blurred bookshelf.
Facing the viewer, centered, clearly an illustration (not photorealistic),
no text other than "AI" and "法", no watermark, square 1024x1024.
```

### 2. 說話中（在同一個 ChatGPT 對話中接著輸入）

```
請保持完全相同的角色、服裝、構圖、光線與背景，只把嘴巴改成正在說話的張開狀態（看得到一點牙齒），其他不變。
```

### 3. 思考中

```
同一角色、同樣的服裝與背景，改成思考的表情：一隻手輕輕托著下巴，眼睛看向右上方，嘴巴微閉，其他不變。
```

### 保持一致的技巧
- 三張圖都在同一個 ChatGPT 對話中產生，以第一張為基準要求修改。
- 若差異太大，重新上傳基準圖並說明「以這張為準，只改嘴巴」。
- 下載後用免費去背工具處理（或保留書架背景），統一裁成 512×512 PNG。
- 放到 `public/avatar/idle.png`、`talking.png`、`thinking.png`，重新啟動 `npm run dev`（或重新部署）後網站會自動改用 PNG。
- 在報告中記錄使用的提示詞與生成日期（第九章 9.4：AI 生成圖應記錄提示詞，不模仿特定在世藝術家或既有角色）。

## 角色如何動起來（第六章 6.5）
- 說話時在 `idle` 與 `talking` 兩張圖之間切換：使用 ElevenLabs 語音時依即時音量（Web Audio `AnalyserNode`）張嘴；使用瀏覽器語音時每 150 毫秒切換一次。
- 平常有輕微的呼吸縮放動畫；使用者在系統設定「減少動態」時自動關閉。
- 實作見 `components/Avatar.tsx` 與 `lib/client/speech-player.ts`。
