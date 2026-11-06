import fs from "node:fs";
import type { NextConfig } from "next";

// 角色圖：public/avatar/ 裡有 ChatGPT 畫的 idle.png 就用 PNG，否則用內附的 SVG 暫代圖。
// 在建置時決定，換圖後請重新啟動 npm run dev 或重新部署。
const avatarExt = ["idle", "talking", "thinking"].every((s) => fs.existsSync(`public/avatar/${s}.png`)) ? "png" : "svg";

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_AVATAR_EXT: avatarExt },
  // /api/chat 在執行時用 fs 讀取 data/index.json，部署到 Vercel 時要明確把它打包進函式
  outputFileTracingIncludes: {
    "/api/chat": ["./data/index.json"],
    "/api/config": ["./data/index.json"],
  },
  // 金鑰只在伺服器端讀取，不需要任何 NEXT_PUBLIC_ 的金鑰變數
  poweredByHeader: false,
};

export default nextConfig;
