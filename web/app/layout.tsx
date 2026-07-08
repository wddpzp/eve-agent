import type { Metadata } from "next";
import "./globals.css";
import Nav from "./nav";

export const metadata: Metadata = {
  title: "eve 调试台",
  description: "聊天 · HITL 审批 · eve/client SDK 演示",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body style={{ margin: 0 }}>
        <div style={{ height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <Nav />
          <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>{children}</div>
        </div>
      </body>
    </html>
  );
}
