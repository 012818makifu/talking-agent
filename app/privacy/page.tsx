import Link from "next/link";
import { AGENT } from "@/lib/agent";

export const metadata = { title: `隱私權與資料使用說明｜${AGENT.name}` };

// 第九章 9.1、9.3：透明揭露與個人資料保護
export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10 leading-relaxed">
      <h1 className="text-2xl font-bold text-navy">隱私權與資料使用說明</h1>
      <p className="mt-2 text-sm text-slate-600">最後更新：2026 年 11 月</p>

      <h2 className="mt-8 text-lg font-bold text-navy">你在和 AI 對話</h2>
      <p className="mt-2">
        「{AGENT.name}」是由人工智慧產生回答的 AI 代理人，不是真人，也不是律師，不代表任何政府機關、法院或律師事務所。
        {AGENT.disclaimer}
      </p>

      <h2 className="mt-8 text-lg font-bold text-navy">我們如何處理你的資料</h2>
      <ul className="mt-2 list-disc space-y-1 pl-6">
        <li>本網站不儲存對話內容，關閉或重新整理頁面後對話就會消失。</li>
        <li>錄音只在伺服器記憶體中轉送給語音辨識服務，辨識完成即丟棄，不會存檔。</li>
        <li>送出問題前，系統會自動遮蔽看起來像身分證字號、信用卡號、手機號碼與電子郵件的內容。</li>
        <li>請不要輸入身分證字號、病歷、帳號密碼等敏感個人資料。</li>
        <li>你的語音設定（靜音、語速）只存在你自己的瀏覽器中。</li>
      </ul>

      <h2 className="mt-8 text-lg font-bold text-navy">使用的第三方服務</h2>
      <p className="mt-2">為了產生回答與語音，你的問題文字或錄音會傳送給下列服務處理，各服務依其資料使用政策處理資料：</p>
      <ul className="mt-2 list-disc space-y-1 pl-6">
        <li>Anthropic（Claude API）：理解問題並產生回答。</li>
        <li>ElevenLabs：把回答轉成語音、把你的錄音轉成文字。</li>
        <li>OpenAI（若有啟用）：把問題轉成向量以檢索資料。</li>
        <li>Vercel：網站主機。</li>
      </ul>

      <h2 className="mt-8 text-lg font-bold text-navy">資料來源</h2>
      <p className="mt-2">
        法律條文擷取自法務部「全國法規資料庫」（擷取日期 2026-11-06），常見問答為作者自行整理。法規可能修正，請以官方最新版本為準。
      </p>

      <p className="mt-10">
        <Link href="/" className="text-navy underline">
          ← 回到{AGENT.name}
        </Link>
      </p>
    </main>
  );
}
