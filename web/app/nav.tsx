"use client";

import { usePathname } from "next/navigation";
import type { CSSProperties } from "react";

const LINKS = [
  { href: "/", label: "聊天" },
  { href: "/hitl", label: "HITL 审批" },
  { href: "/sdk", label: "SDK 演示" },
];

export default function Nav() {
  const path = usePathname();
  return (
    <nav style={bar}>
      <span style={brand}>eve</span>
      <div style={{ display: "flex", gap: 4 }}>
        {LINKS.map((l) => {
          const on = l.href === "/" ? path === "/" : path.startsWith(l.href);
          return (
            <a key={l.href} href={l.href} style={{ ...link, ...(on ? active : {}) }}>
              {l.label}
            </a>
          );
        })}
      </div>
      <span style={{ flex: 1 }} />
      <span style={host}>eve-agent-ten.vercel.app</span>
    </nav>
  );
}

const bar: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 14,
  height: 48,
  flexShrink: 0,
  padding: "0 16px",
  background: "#ffffff",
  borderBottom: "1px solid #e4e7ee",
  fontFamily: "ui-sans-serif, system-ui, sans-serif",
};
const brand: CSSProperties = { fontWeight: 800, fontSize: 15, color: "#2563eb", letterSpacing: 0.5 };
const link: CSSProperties = { padding: "6px 12px", borderRadius: 8, fontSize: 13.5, color: "#5a6270", textDecoration: "none" };
const active: CSSProperties = { background: "#eef2ff", color: "#2563eb", fontWeight: 600 };
const host: CSSProperties = { fontSize: 12, color: "#a0a6b4", fontFamily: "ui-monospace, monospace" };
