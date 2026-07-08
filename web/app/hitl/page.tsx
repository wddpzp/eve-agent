"use client";

import { useRef, useState } from "react";
import type { CSSProperties } from "react";

// HITL 回放台:发一条会触发审批的消息 → 订阅事件流 → 抓到 input.requested 就
// 渲染成审批卡片(带 approve/deny 按钮)→ 点按钮把决定送回 → 看它从原地恢复执行。
// 全程走同源代理 /api/eve/*(见 app/api/eve/[...path]/route.ts),不用 curl。

interface EveEvent {
  type: string;
  data?: Record<string, unknown>;
  meta?: { at?: string };
}

interface Pending {
  requestId: string;
  toolName: string;
  input: unknown;
  prompt?: string;
  options: { id: string; label: string }[];
}

type Phase = "idle" | "streaming" | "await" | "done" | "failed";

export default function HitlPage() {
  const [message, setMessage] = useState("删掉 id 为 note-1 的笔记");
  const [events, setEvents] = useState<EveEvent[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const tokenRef = useRef<string | null>(null);
  const seenRef = useRef(0);
  const eventsRef = useRef<EveEvent[]>([]);

  const busy = phase === "streaming";

  async function readStream(sid: string) {
    setPhase("streaming");
    const res = await fetch(`/api/eve/session/${sid}/stream?startIndex=${seenRef.current}`);
    if (!res.body) {
      setError("流没有 body(代理/网络问题)");
      setPhase("failed");
      return;
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let localPending: Pending | null = null;
    let terminal: string | null = null;

    outer: for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const s = line.trim();
        if (!s) continue;
        let ev: EveEvent;
        try {
          ev = JSON.parse(s) as EveEvent;
        } catch {
          continue;
        }
        seenRef.current += 1;
        eventsRef.current = [...eventsRef.current, ev];
        setEvents(eventsRef.current);

        // ★ 关键:订阅到 HITL 审批事件
        if (ev.type === "input.requested") {
          const r = (ev.data?.requests as Array<Record<string, unknown>> | undefined)?.[0];
          if (r) {
            const action = (r.action ?? {}) as Record<string, unknown>;
            localPending = {
              requestId: String(r.requestId ?? ""),
              toolName: String(action.toolName ?? "tool"),
              input: action.input,
              prompt: typeof r.prompt === "string" ? r.prompt : undefined,
              options: (r.options as { id: string; label: string }[] | undefined) ?? [
                { id: "approve", label: "批准" },
                { id: "deny", label: "拒绝" },
              ],
            };
          }
        }

        if (ev.type === "session.waiting" || ev.type === "session.completed" || ev.type === "session.failed") {
          terminal = ev.type;
          await reader.cancel();
          break outer;
        }
      }
    }

    setPending(localPending);
    if (terminal === "session.failed") setPhase("failed");
    else if (localPending) setPhase("await");
    else setPhase("done");
  }

  async function start() {
    if (!message.trim() || busy) return;
    setError(null);
    setPending(null);
    seenRef.current = 0;
    eventsRef.current = [];
    setEvents([]);
    setPhase("streaming");
    try {
      // conversation 模式:HITL 需要 park 等人,task 模式碰 HITL 会直接失败
      const res = await fetch(`/api/eve/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "conversation", message }),
      });
      const j = (await res.json()) as { sessionId?: string; continuationToken?: string; error?: string };
      if (!res.ok || j.error || !j.sessionId) throw new Error(j.error ?? `HTTP ${res.status}`);
      tokenRef.current = j.continuationToken ?? null;
      setSessionId(j.sessionId);
      await readStream(j.sessionId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("failed");
    }
  }

  async function answer(optionId: string) {
    if (!sessionId || busy) return;
    setPending(null);
    setPhase("streaming");
    try {
      // 把决定当作跟进消息送回(eve 把 "approve"/"deny" 匹配成审批答复)
      const res = await fetch(`/api/eve/session/${sessionId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ continuationToken: tokenRef.current, message: optionId }),
      });
      const j = (await res.json().catch(() => ({}))) as { continuationToken?: string; error?: string };
      if (j.continuationToken) tokenRef.current = j.continuationToken;
      await readStream(sessionId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("failed");
    }
  }

  const timeline = deriveTimeline(events);
  const glow = { idle: "#f5a623", streaming: "#f5a623", await: "#3b82f6", done: "#22c55e", failed: "#ef4444" }[phase];

  return (
    <div style={S.page as CSSProperties}>
      <div style={{ ...S.wrap }}>
        <header style={S.head}>
          <div>
            <h1 style={S.h1}>HITL 事件回放台</h1>
            <p style={S.sub}>发一条触发审批的消息 → 订阅 input.requested → 点按钮批准/拒绝 → 看它恢复。零 curl。</p>
          </div>
          <a href="/" style={S.navlink}>← 会话调试台</a>
        </header>

        <div style={S.composer}>
          <input
            style={S.input}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && start()}
            placeholder="试试:删掉 id 为 note-1 的笔记"
            disabled={busy}
          />
          <button style={{ ...S.btn, ...S.run, opacity: busy || !message.trim() ? 0.5 : 1 }} onClick={start} disabled={busy || !message.trim()}>
            {busy ? "运行中…" : "▸ 发送"}
          </button>
          <span style={{ ...S.pill, borderColor: glow, color: glow }}>
            <span style={{ ...S.dot, background: glow }} />
            {PHASE_TEXT[phase]}
          </span>
        </div>

        {error && <div style={S.err}>✗ {error}</div>}

        {/* ★ 审批卡片:订阅到 input.requested 时出现 */}
        {pending && (
          <div style={S.approval}>
            <div style={S.approvalTop}>
              <span style={S.approvalBadge}>⏸ 需要人工审批</span>
              <span style={S.mono}>{sessionId?.slice(0, 16)}…</span>
            </div>
            <div style={S.approvalBody}>
              <div style={S.row}>
                <span style={S.k}>工具</span>
                <b>{pending.toolName}</b>
              </div>
              <div style={S.row}>
                <span style={S.k}>参数</span>
                <code style={S.code}>{JSON.stringify(pending.input)}</code>
              </div>
              {pending.prompt && <div style={S.prompt}>{pending.prompt}</div>}
            </div>
            <div style={S.approvalActions}>
              {pending.options.map((o) => {
                const deny = /deny|no|拒/i.test(o.id + o.label);
                return (
                  <button
                    key={o.id}
                    style={{ ...S.btn, ...(deny ? S.deny : S.approve) }}
                    onClick={() => answer(o.id)}
                  >
                    {deny ? "✗" : "✓"} {o.label}
                    <span style={S.optId}>{o.id}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* 时间线 */}
        <div style={S.timeline}>
          {timeline.length === 0 ? (
            <div style={S.empty}>发一条消息开始 —— 试试触发 delete_note(需审批)的那句。</div>
          ) : (
            timeline.map((item, i) => (
              <div key={i} style={{ ...S.item, ...(item.kind === "approval" ? S.itemApproval : {}) }}>
                <span style={S.itemIcon}>{item.icon}</span>
                <span style={S.itemText}>{item.text}</span>
              </div>
            ))
          )}
        </div>

        {events.length > 0 && (
          <details style={S.raw}>
            <summary style={S.rawSum}>原始事件({events.length})</summary>
            <div style={S.rawGrid}>
              {events.map((e, i) => (
                <span key={i} style={S.rawTag}>
                  {e.type}
                </span>
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}

/* ---------- 事件 → 时间线 ---------- */

interface TimelineItem {
  icon: string;
  text: string;
  kind: "user" | "tool" | "result" | "assistant" | "session" | "approval";
}

function deriveTimeline(events: EveEvent[]): TimelineItem[] {
  const out: TimelineItem[] = [];
  for (const ev of events) {
    const d = (ev.data ?? {}) as Record<string, unknown>;
    switch (ev.type) {
      case "message.received":
        out.push({ icon: "👤", text: String(d.message ?? ""), kind: "user" });
        break;
      case "actions.requested":
        for (const a of (d.actions as Array<Record<string, unknown>>) ?? []) {
          out.push({ icon: "🔧", text: `调用 ${a.toolName} · ${JSON.stringify(a.input)}`, kind: "tool" });
        }
        break;
      case "input.requested":
        out.push({ icon: "⏸", text: "请求审批(等待人工批准)", kind: "approval" });
        break;
      case "action.result": {
        const r = (d.result as Record<string, unknown>) ?? {};
        out.push({ icon: "✅", text: `${r.toolName} 执行 → ${JSON.stringify(r.output)}`, kind: "result" });
        break;
      }
      case "message.completed":
        if (d.finishReason === "stop") out.push({ icon: "💬", text: String(d.message ?? ""), kind: "assistant" });
        break;
      case "session.waiting":
        out.push({ icon: "💤", text: "session.waiting(park)", kind: "session" });
        break;
      case "session.completed":
        out.push({ icon: "🏁", text: "session.completed", kind: "session" });
        break;
      case "session.failed":
        out.push({ icon: "⛔", text: `session.failed · ${String(d.message ?? "")}`, kind: "session" });
        break;
    }
  }
  return out;
}

const PHASE_TEXT: Record<Phase, string> = {
  idle: "READY",
  streaming: "STREAMING",
  await: "等待审批",
  done: "完成",
  failed: "失败",
};

/* ---------- 内联样式(自包含,不依赖 globals.css)---------- */

const S: Record<string, CSSProperties> = {
  page: { minHeight: "100%", background: "#0b0d12", color: "#e6e9ef", fontFamily: "ui-sans-serif, system-ui, sans-serif", padding: "32px 20px" },
  wrap: { maxWidth: 760, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 },
  head: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  h1: { margin: 0, fontSize: 22, fontWeight: 700 },
  sub: { margin: "6px 0 0", fontSize: 13, color: "#8b93a7", lineHeight: 1.5 },
  navlink: { color: "#8b93a7", fontSize: 13, textDecoration: "none", whiteSpace: "nowrap" },
  composer: { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" },
  input: { flex: 1, minWidth: 260, background: "#151922", border: "1px solid #262c3a", borderRadius: 10, padding: "11px 13px", color: "#e6e9ef", fontSize: 14, outline: "none" },
  btn: { border: "none", borderRadius: 10, padding: "11px 16px", fontSize: 14, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8 },
  run: { background: "#f5a623", color: "#1a1200" },
  pill: { display: "inline-flex", alignItems: "center", gap: 7, border: "1px solid", borderRadius: 999, padding: "6px 12px", fontSize: 12, fontWeight: 600, letterSpacing: 0.4 },
  dot: { width: 7, height: 7, borderRadius: 999 },
  err: { background: "#2a1416", border: "1px solid #5b2327", color: "#f7a3aa", padding: "10px 13px", borderRadius: 10, fontSize: 13 },
  approval: { background: "linear-gradient(180deg,#141a2b,#101521)", border: "1px solid #2c3a5e", borderRadius: 14, overflow: "hidden", boxShadow: "0 0 0 1px #1e2a4a, 0 12px 40px -12px #1e3a8a55" },
  approvalTop: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid #222a3d" },
  approvalBadge: { color: "#93b4ff", fontWeight: 700, fontSize: 14 },
  approvalBody: { padding: "14px 16px", display: "flex", flexDirection: "column", gap: 9 },
  row: { display: "flex", gap: 10, alignItems: "baseline", fontSize: 14 },
  k: { color: "#8b93a7", width: 40, flexShrink: 0, fontSize: 12 },
  code: { background: "#0c101a", border: "1px solid #222a3d", borderRadius: 6, padding: "2px 7px", fontSize: 13, fontFamily: "ui-monospace, monospace", color: "#c7d2fe" },
  prompt: { color: "#b8c0d4", fontSize: 13, lineHeight: 1.5, marginTop: 2 },
  approvalActions: { display: "flex", gap: 10, padding: "0 16px 16px" },
  approve: { background: "#22c55e", color: "#052e12" },
  deny: { background: "#2a1a1c", color: "#f7a3aa", border: "1px solid #5b2327" },
  optId: { fontSize: 11, opacity: 0.6, fontWeight: 400 },
  mono: { fontFamily: "ui-monospace, monospace", fontSize: 12, color: "#5f6879" },
  timeline: { display: "flex", flexDirection: "column", gap: 6, background: "#0e1119", border: "1px solid #1c2230", borderRadius: 12, padding: 14, minHeight: 120 },
  empty: { color: "#5f6879", fontSize: 13, textAlign: "center", padding: "24px 0" },
  item: { display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13, lineHeight: 1.5, padding: "4px 6px", borderRadius: 8 },
  itemApproval: { background: "#141a2b", color: "#93b4ff" },
  itemIcon: { flexShrink: 0 },
  itemText: { whiteSpace: "pre-wrap", wordBreak: "break-word", color: "#cbd2e0" },
  raw: { fontSize: 12, color: "#8b93a7" },
  rawSum: { cursor: "pointer", padding: "6px 0" },
  rawGrid: { display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 },
  rawTag: { background: "#151922", border: "1px solid #262c3a", borderRadius: 6, padding: "2px 8px", fontSize: 11, fontFamily: "ui-monospace, monospace" },
};
