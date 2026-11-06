# 知識庫資料來源清單

`data/raw/` 中的資料由 `npm run ingest` 切塊後寫入 `data/index.json`。檔名以 `_` 開頭的檔案不會被匯入。

| 檔案 | 內容 | 來源 | 法規修正日期 | 擷取日期 |
| --- | --- | --- | --- | --- |
| `law_civil_code.md` | 民法（節錄：成年、期間、消滅時效、侵權行為、損害賠償、物之瑕疵擔保、租賃），121 條 | [全國法規資料庫 B0000001](https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=B0000001) | 民國 115 年 08 月 17 日 | 2026-11-06 |
| `law_consumer_protection.md` | 消費者保護法（全文） | [J0170001](https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=J0170001) | 民國 104 年 06 月 17 日 | 2026-11-06 |
| `law_labor_standards.md` | 勞動基準法（全文） | [N0030001](https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=N0030001) | 民國 113 年 07 月 31 日 | 2026-11-06 |
| `law_labor_pension.md` | 勞工退休金條例（節錄：第1、6、7、12–14、31條） | [N0030020](https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=N0030020) | 民國 108 年 05 月 15 日 | 2026-11-06 |
| `law_rental_housing.md` | 租賃住宅市場發展及管理條例（全文） | [D0060125](https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=D0060125) | 民國 112 年 02 月 08 日 | 2026-11-06 |
| `law_road_traffic_penalty.md` | 道路交通管理處罰條例（節錄：第35、62條；第35條附施行註記） | [K0040012](https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=K0040012) | 民國 115 年 08 月 17 日 | 2026-11-06 |
| `law_compulsory_auto_insurance.md` | 強制汽車責任保險法（全文） | [G0390060](https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=G0390060) | 民國 111 年 06 月 15 日 | 2026-11-06 |
| `law_civil_procedure.md` | 民事訴訟法（節錄：調解、簡易訴訟範圍、小額訴訟程序） | [B0010001](https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=B0010001) | 民國 112 年 11 月 29 日 | 2026-11-06 |
| `law_township_mediation.md` | 鄉鎮市調解條例（全文） | [I0020003](https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=I0020003) | 民國 112 年 01 月 13 日 | 2026-11-06 |
| `law_legal_aid.md` | 法律扶助法（節錄：第1–5、13–16條） | [A0030157](https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=A0030157) | 民國 104 年 07 月 01 日 | 2026-11-06 |
| `faq_legal_help.md` | 常見問答 20 則與求助電話（問答格式） | 自行撰寫，依上列條文整理 | － | 2026-11-06 |

## 合法性與可信度（第四章 4.3、第九章 9.4）
- 法律條文屬於政府法令，依著作權法第 9 條不得為著作權之標的，可自由使用；皆直接擷取自法務部全國法規資料庫官方網頁。
- 每個檔案開頭的 frontmatter 都記錄來源網址與擷取日期，網站「參考資料」會顯示擷取日期並連到官方原文。
- 常見問答為自行撰寫，每一題都標註依據的條號；電話號碼等服務資訊請以各機關官方公告為準。
- 法規會修正：建議每學期重新擷取一次並執行 `npm run ingest`。道路交通管理處罰條例第 35 條有部分項次尚未施行，已在條文末加註。

## 新增資料
1. 把 `.md`、`.txt` 或 `.pdf` 放進 `data/raw/`（可建立子資料夾）。
2. 法條請用「`### 法規名稱 第N條（章節）`」作為每一條的標題，並在檔案開頭加上 `type: law` 的 frontmatter（可參考現有檔案）；問答請用「`### 問：…`」並加上 `type: faq`。
3. 執行 `npm run ingest`，再執行 `npm run eval -- --retrieval-only` 確認檢索命中率沒有下降。
