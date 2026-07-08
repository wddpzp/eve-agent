"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useEveAgent } from "eve/react";
import type { HandleMessageStreamEvent, SessionState } from "eve/client";

// 聊天页:useEveAgent(eve/react 官方 hook)原生处理 流式 + 续写 + HITL。
// 打同源 /eve/v1/*(见 app/eve/v1/[...path] 代理)。多会话靠 key 重挂子组件。

const LIST_KEY = "eve-chat-hook-v1";
const MAX = 40;

interface SavedThread {
  id: string; // 稳定的本地 thread id(= 重挂 key)
  title: string;
  events: HandleMessageStreamEvent[];
  session: SessionState | undefined;
  updatedAt: number;
}

/* ================= 父:会话列表 + 装载当前 thread ================= */

export default function Page() {
  const [threads, setThreads] = useState<SavedThread[]>([]);
  const [activeId, setActiveId] = useState<string>(""); // 空到客户端 effect 再定,避免 hydration 不一致

  useEffect(() => {
    let list: SavedThread[] = [];
    try {
      const raw = localStorage.getItem(LIST_KEY);
      if (raw) list = JSON.parse(raw) as SavedThread[];
    } catch {
      list = [];
    }
    if (Array.isArray(list) && list.length) {
      setThreads(list);
      setActiveId(list[0].id);
    } else {
      setActiveId(freshId());
    }
  }, []);

  const active = threads.find((t) => t.id === activeId);

  function upsert(t: SavedThread) {
    setThreads((prev) => {
      const next = [t, ...prev.filter((x) => x.id !== t.id)].slice(0, MAX);
      try {
        localStorage.setItem(LIST_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  function newChat() {
    setActiveId(freshId());
  }

  function del(id: string) {
    setThreads((prev) => {
      const next = prev.filter((x) => x.id !== id);
      try {
        localStorage.setItem(LIST_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
    if (id === activeId) setActiveId(freshId());
  }

  return (
    <div style={X.app}>
      <aside style={X.rail}>
        <button style={X.newBtn} onClick={newChat}>
          ＋ 新建会话
        </button>
        <div style={X.list}>
          {threads.length === 0 && <div style={X.listEmpty}>还没有会话</div>}
          {threads.map((t) => (
            <div key={t.id} style={{ ...X.sess, ...(t.id === activeId ? X.sessOn : {}) }} onClick={() => setActiveId(t.id)}>
              <div style={X.sessMain}>
                <div style={X.sessTitle}>{t.title}</div>
                <div style={X.sessMeta}>{timeAgo(t.updatedAt)}</div>
              </div>
              <button
                style={X.sessDel}
                title="删除"
                onClick={(e) => {
                  e.stopPropagation();
                  del(t.id);
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <div style={X.railFoot}>前端:eve/react useEveAgent · 原生 HITL</div>
      </aside>

      {activeId ? (
        <ChatThread
          key={activeId}
          threadId={activeId}
          initialEvents={active?.events ?? []}
          initialSession={active?.session}
          onPersist={upsert}
        />
      ) : (
        <main style={X.main} />
      )}
    </div>
  );
}

/* ================= 子:一个会话(useEveAgent) ================= */

interface Opt {
  id: string;
  label: string;
  description?: string;
}
interface IReq {
  requestId: string;
  prompt?: string;
  display?: string;
  options?: Opt[];
}
interface Part {
  type: string;
  text?: string;
  toolName?: string;
  input?: unknown;
  toolMetadata?: { eve?: { inputRequest?: IReq } };
}
interface Msg {
  id: string;
  role: string;
  parts: Part[];
}

function ChatThread({
  threadId,
  initialEvents,
  initialSession,
  onPersist,
}: {
  threadId: string;
  initialEvents: HandleMessageStreamEvent[];
  initialSession: SessionState | undefined;
  onPersist: (t: SavedThread) => void;
}) {
  const agent = useEveAgent({
    initialEvents,
    initialSession,
    onFinish(snap) {
      const session = snap.session as SessionState | undefined;
      const msgs = snap.data.messages as unknown as Msg[];
      onPersist({
        id: threadId,
        title: firstUserText(msgs) || "新会话",
        events: snap.events as HandleMessageStreamEvent[],
        session,
        updatedAt: Date.now(),
      });
    },
  });

  const [text, setText] = useState("");
  const [answered, setAnswered] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const busy = agent.status === "submitted" || agent.status === "streaming";
  const messages = agent.data.messages as unknown as Msg[];

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy]);

  function submit() {
    const m = text.trim();
    if (!m || busy) return;
    setText("");
    void agent.send({ message: m });
  }

  function answer(req: IReq, optionId: string) {
    if (busy) return;
    setAnswered((prev) => new Set(prev).add(req.requestId));
    void agent.send({ inputResponses: [{ requestId: req.requestId, optionId }] });
  }

  const title = firstUserText(messages) || "新会话";

  return (
    <main style={X.main}>
      <header style={X.topbar}>
        <div style={X.ttl}>{title}</div>
        <span style={{ ...X.pill, ...pillStyle(agent.status) }}>{pillText(agent.status)}</span>
      </header>

      <div style={X.scroll} ref={scrollRef}>
        {messages.length === 0 ? (
          <div style={X.empty}>
            <div style={X.emptyBig}>开始一个对话</div>
            <div>输入消息即可。若模型用 ask_question 提问或工具需审批,会在这里出现可点的选项按钮。</div>
          </div>
        ) : (
          <div style={X.feed}>
            {messages.map((m) => (
              <div key={m.id} style={X.turn}>
                {m.parts.map((p, i) => {
                  // 文本
                  if (p.type === "text" && p.text) {
                    return m.role === "user" ? (
                      <div key={i} style={X.rowUser}>
                        <div style={X.bubbleUser}>{p.text}</div>
                      </div>
                    ) : (
                      <div key={i} style={X.rowBot}>
                        <div style={X.avatar}>e</div>
                        <div style={X.bubbleBot}>{p.text}</div>
                      </div>
                    );
                  }
                  // HITL:input.requested(审批 or ask_question)
                  const req = p.toolMetadata?.eve?.inputRequest;
                  if (req) {
                    const done = answered.has(req.requestId);
                    return (
                      <div key={i} style={X.rowBot}>
                        <div style={X.avatar}>e</div>
                        <div style={X.hitl}>
                          <div style={X.hitlPrompt}>{req.display === "confirmation" ? "⏸ 需要审批" : "❓ 请选择"} · {req.prompt}</div>
                          <div style={X.hitlOpts}>
                            {(req.options ?? []).map((o) => {
                              const deny = /deny|no|拒/i.test(o.id + o.label);
                              return (
                                <button
                                  key={o.id}
                                  disabled={done || busy}
                                  style={{ ...X.optBtn, ...(deny ? X.optDeny : X.optOk), opacity: done ? 0.45 : 1 }}
                                  onClick={() => answer(req, o.id)}
                                  title={o.description}
                                >
                                  {o.label}
                                </button>
                              );
                            })}
                          </div>
                          {done && <div style={X.hitlDone}>已回复</div>}
                        </div>
                      </div>
                    );
                  }
                  // 工具调用(非 HITL)
                  if (p.type === "dynamic-tool" && p.toolName) {
                    return (
                      <div key={i} style={X.rowBot}>
                        <div style={X.avatar}>e</div>
                        <div style={X.tool}>🔧 {p.toolName}</div>
                      </div>
                    );
                  }
                  return null;
                })}
              </div>
            ))}
            {busy && <div style={X.typing}>生成中…</div>}
          </div>
        )}
      </div>

      {agent.error && <div style={X.err}>✗ {agent.error.message}</div>}

      <div style={X.composer}>
        <div style={X.composerInner}>
          <textarea
            style={X.input}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="发条消息…（Enter 发送，Shift+Enter 换行）"
            rows={1}
          />
          {busy ? (
            <button style={{ ...X.sendBtn, ...X.stopBtn }} onClick={() => agent.stop()}>
              ◼ 停止
            </button>
          ) : (
            <button style={{ ...X.sendBtn, opacity: text.trim() ? 1 : 0.5 }} onClick={submit} disabled={!text.trim()}>
              ↑ 发送
            </button>
          )}
        </div>
      </div>
    </main>
  );
}

/* ================= helpers ================= */

function freshId(): string {
  return "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function firstUserText(messages: Msg[]): string {
  for (const m of messages) {
    if (m.role === "user") {
      const p = m.parts.find((x) => x.type === "text" && x.text);
      if (p?.text) return p.text.length > 32 ? p.text.slice(0, 32) + "…" : p.text;
    }
  }
  return "";
}

function timeAgo(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return "刚刚";
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  return `${Math.floor(s / 86400)} 天前`;
}

type Status = "ready" | "submitted" | "streaming" | "error";
function pillText(s: Status): string {
  return { ready: "就绪", submitted: "提交中", streaming: "生成中…", error: "出错" }[s];
}
function pillStyle(s: Status): CSSProperties {
  if (s === "error") return { color: "#c0392b", borderColor: "#f3c2bd" };
  if (s === "submitted" || s === "streaming") return { color: "#b7791f", borderColor: "#ecd9a8" };
  return { color: "#8a90a0", borderColor: "#dfe3ea" };
}

/* ================= 内联样式(light) ================= */

const X: Record<string, CSSProperties> = {
  app: { height: "100%", display: "flex", background: "#f6f7f9", color: "#202430", fontFamily: "ui-sans-serif, system-ui, sans-serif", overflow: "hidden" },
  rail: { width: 260, flexShrink: 0, borderRight: "1px solid #e4e7ee", background: "#eef0f4", display: "flex", flexDirection: "column", padding: 12, gap: 10 },
  newBtn: { background: "#ffffff", border: "1px solid #d6dae2", color: "#2b303c", borderRadius: 10, padding: "10px 12px", fontSize: 14, fontWeight: 600, cursor: "pointer", textAlign: "left" },
  list: { flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 },
  listEmpty: { color: "#9aa0ae", fontSize: 13, padding: "12px 4px" },
  sess: { display: "flex", gap: 6, alignItems: "center", padding: "8px 10px", borderRadius: 9, cursor: "pointer", border: "1px solid transparent" },
  sessOn: { background: "#ffffff", border: "1px solid #cfd8ea", boxShadow: "0 1px 2px #0000000a" },
  sessMain: { flex: 1, minWidth: 0 },
  sessTitle: { fontSize: 13.5, color: "#333a48", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  sessMeta: { marginTop: 3, fontSize: 11, color: "#98a0b0" },
  sessDel: { background: "none", border: "none", color: "#b6bcc8", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: "0 2px" },
  railFoot: { borderTop: "1px solid #e4e7ee", paddingTop: 10, fontSize: 11, color: "#98a0b0", lineHeight: 1.5 },

  main: { flex: 1, display: "flex", flexDirection: "column", minWidth: 0, background: "#ffffff" },
  topbar: { display: "flex", alignItems: "center", gap: 12, padding: "14px 20px", borderBottom: "1px solid #eceef3" },
  ttl: { fontSize: 15, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  pill: { marginLeft: "auto", flexShrink: 0, border: "1px solid", borderRadius: 999, padding: "4px 11px", fontSize: 12, fontWeight: 600 },

  scroll: { flex: 1, overflowY: "auto", padding: "20px 0" },
  empty: { maxWidth: 520, margin: "12vh auto 0", textAlign: "center", color: "#98a0b0", fontSize: 14, lineHeight: 1.6 },
  emptyBig: { fontSize: 20, color: "#4a505e", fontWeight: 600, marginBottom: 8 },
  feed: { maxWidth: 760, margin: "0 auto", padding: "0 20px", display: "flex", flexDirection: "column", gap: 14 },
  turn: { display: "flex", flexDirection: "column", gap: 10 },
  rowUser: { display: "flex", justifyContent: "flex-end" },
  bubbleUser: { maxWidth: "78%", background: "#2563eb", color: "#fff", padding: "10px 14px", borderRadius: "14px 14px 4px 14px", fontSize: 14.5, lineHeight: 1.55, whiteSpace: "pre-wrap", wordBreak: "break-word" },
  rowBot: { display: "flex", gap: 10, alignItems: "flex-start" },
  avatar: { width: 28, height: 28, flexShrink: 0, borderRadius: 8, background: "#eef0f4", border: "1px solid #dbe0ea", display: "grid", placeItems: "center", fontSize: 13, fontWeight: 700, color: "#5a6b8c" },
  bubbleBot: { background: "#f4f6fa", border: "1px solid #e6e9f0", color: "#2b303c", padding: "10px 14px", borderRadius: "14px 14px 14px 4px", fontSize: 14.5, lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word", maxWidth: "88%" },
  tool: { background: "#f0f2f6", border: "1px solid #e3e6ee", borderRadius: 9, padding: "7px 11px", fontSize: 12.5, color: "#4a505e" },

  hitl: { background: "#eef3ff", border: "1px solid #cdddfb", borderRadius: 12, padding: "12px 14px", maxWidth: "88%", display: "flex", flexDirection: "column", gap: 10 },
  hitlPrompt: { fontSize: 14, color: "#20386b", fontWeight: 500, lineHeight: 1.5 },
  hitlOpts: { display: "flex", gap: 8, flexWrap: "wrap" },
  optBtn: { border: "none", borderRadius: 9, padding: "8px 14px", fontSize: 13.5, fontWeight: 600, cursor: "pointer" },
  optOk: { background: "#2563eb", color: "#fff" },
  optDeny: { background: "#fdecea", color: "#c0392b", border: "1px solid #f3c2bd" },
  hitlDone: { fontSize: 12, color: "#6b7280" },
  typing: { color: "#98a0b0", fontSize: 13, padding: "2px 4px 0 48px" },

  err: { maxWidth: 760, margin: "0 auto", width: "100%", padding: "8px 20px", color: "#c0392b", fontSize: 13 },
  composer: { padding: "14px 20px 18px", borderTop: "1px solid #eceef3" },
  composerInner: { maxWidth: 760, margin: "0 auto", display: "flex", gap: 10, alignItems: "flex-end" },
  input: { flex: 1, minWidth: 0, background: "#ffffff", border: "1px solid #d6dae2", borderRadius: 12, padding: "12px 14px", color: "#202430", fontSize: 14.5, outline: "none", resize: "none", minHeight: 46, maxHeight: 180, lineHeight: 1.5, fontFamily: "inherit" },
  sendBtn: { flexShrink: 0, background: "#2563eb", color: "#fff", border: "none", borderRadius: 12, padding: "12px 18px", fontSize: 14, fontWeight: 600, cursor: "pointer" },
  stopBtn: { background: "#fdecea", color: "#c0392b", border: "1px solid #f3c2bd" },
};
