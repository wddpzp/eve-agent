import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "eve 会话调试台",
  description: "调用 eve 部署的 session 接口:选 mode、看流式、拿 curl",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
