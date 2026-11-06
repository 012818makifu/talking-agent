// tsx 執行的腳本不會像 Next.js 一樣自動讀 .env.local，這裡手動載入（只在本機腳本使用）。
import fs from "node:fs";
import path from "node:path";

export function loadEnvLocal() {
  for (const f of [".env.local", ".env"]) {
    const p = path.join(process.cwd(), f);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !process.env[m[1]] && m[2]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}
