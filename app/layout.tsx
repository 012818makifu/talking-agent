import type { Metadata, Viewport } from "next";
import { AGENT } from "@/lib/agent";
import "./globals.css";

export const metadata: Metadata = {
  title: `${AGENT.name}｜${AGENT.title}（AI 代理人）`,
  description: `${AGENT.tagline}。${AGENT.disclaimer}`,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1e3a5f",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant-TW">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
