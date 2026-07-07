"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";

const EVE_BASE = process.env.NEXT_PUBLIC_EVE_BASE_URL ?? "https://eve-agent-ten.vercel.app";
const STORE_KEY = "eve-console-v1";

type Mode = "conversation" | "task";
type Status = "ready" | "submitted" | "streaming" | "error";

interface EveEvent {
  type: string;
  data?: Record<string, unknown>;
  meta?: { at?: string };
}

const DEMO_SCHEMA = {
  type: "object",
  properties: { answer: { type: "string" }, confidence: { type: "number" } },
  required: ["answer"],
} as const;

const TERMINAL = new Set(["session.completed", "session.failed", "session.waiting", "input.requested"]);

interface DerivedTool {
  name: string;
  input?: unknown;
  output?: unknown;
  status: "running" | "done" | "failed";
}

interface Turn {
  turnId: string;
  user?: string;
  blocks: string[];
  live: string;
  reasoning: string;
  tools: DerivedTool[];
  callIndex: Record<string, number>;
  usageIn: number;
  usageOut: number;
  finishReason?: string;
  status: "running" | "completed" | "failed";
  result?: unknown;
}

interface Derived {
  turns: Turn[];
  sessionStatus: string | null;
  totalIn: number;
  totalOut: number;
}

export default function Page() {
  const [mode, setMode] = useState<Mode>("task");
  const [message, setMessage] = useState("用一句话介绍你自己");
  const [useSchema, setUseSchema] = useState(false);
  const [events, setEvents] = useState<EveEvent[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("ready");
  const [error, setError] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);

  const tokenRef = useRef<string | null>(null);
  const seenRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const eventsRef = useRef<EveEvent[]>([]);
  const streamRef = useRef<HTMLDivElement | null>(null);

  const busy = status === "submitted" || status === "streaming";
  const { turns, sessionStatus, totalIn, totalOut } = useMemo<Derived>(() => deriveConsole(events), [events]);

  useEffect(() => {
    eventsRef.current = events;
  }, [events]);

  // 挂载时从 localStorage 恢复上次会话(只读渲染 + 保留续写游标)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      const s = JSON.parse(raw) as { sessionId?: string; mode?: Mode; token?: string | null; events?: EveEvent[] };
      if (s.sessionId && s.events?.length) {
        setSessionId(s.sessionId);
        if (s.mode) setMode(s.mode);
        tokenRef.current = s.token ?? null;
        seenRef.current = s.events.length;
        setEvents(s.events);
        setRestored(true);
      }
    } catch {
      /* ignore */
    }
  }, []);

  // 新事件时自动滚到底
  useEffect(() => {
    const el = streamRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events]);

  function persist(sid: string, m: Mode) {
    try {
      localStorage.setItem(
        STORE_KEY,
        JSON.stringify({ sessionId: sid, mode: m, token: tokenRef.current, events: eventsRef.current }),
      );
    } catch {
      /* ignore */
    }
  }

  async function stream(sid: string, signal: AbortSignal) {
    const res = await fetch(`/api/eve/session/${sid}/stream?startIndex=${seenRef.current}`, { signal });
    if (!res.body) return;
    setStatus("streaming");
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      const batch: EveEvent[] = [];
      let stop = false;
      for (const line of lines) {
        const t = line.trim();
        if (!t) continue;
        let ev: EveEvent;
        try {
          ev = JSON.parse(t) as EveEvent;
        } catch {
          continue;
        }
        seenRef.current += 1;
        batch.push(ev);
        if (TERMINAL.has(ev.type)) stop = true;
      }
      if (batch.length) setEvents((p) => [...p, ...batch]);
      if (stop) {
        await reader.cancel();
        break;
      }
    }
  }

  async function send() {
    if (!message.trim() || busy) return;
    setError(null);
    setStatus("submitted");
    const controller = new AbortController();
    abortRef.current = controller;
    const isFollow = mode === "conversation" && !!sessionId && sessionStatus === "waiting";
    try {
      let sid = sessionId;
      if (isFollow) {
        const res = await fetch(`/api/eve/session/${sid}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ continuationToken: tokenRef.current, message }),
          signal: controller.signal,
        });
        const j = await readJson<{ continuationToken?: string; error?: string }>(res);
        if (!res.ok || j.error) throw new Error(j.error ?? `HTTP ${res.status}`);
        tokenRef.current = j.continuationToken ?? tokenRef.current;
      } else {
        const body: Record<string, unknown> = { mode, message };
        if (mode === "task" && useSchema) body.outputSchema = DEMO_SCHEMA;
        const res = await fetch(`/api/eve/session`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        const j = await readJson<{ sessionId?: string; continuationToken?: string; error?: string }>(res);
        if (!res.ok || j.error || !j.sessionId) throw new Error(j.error ?? `HTTP ${res.status}`);
        tokenRef.current = j.continuationToken ?? null;
        seenRef.current = 0;
        eventsRef.current = [];
        setEvents([]);
        setSessionId(j.sessionId);
        setRestored(false);
        sid = j.sessionId;
      }
      setMessage("");
      await stream(sid!, controller.signal);
      persist(sid!, mode);
      setStatus("ready");
    } catch (e) {
      if (controller.signal.aborted) {
        setStatus("ready");
        return;
      }
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    } finally {
      abortRef.current = null;
    }
  }

  function stop() {
    abortRef.current?.abort();
    setStatus("ready");
  }

  function reset() {
    abortRef.current?.abort();
    tokenRef.current = null;
    seenRef.current = 0;
    eventsRef.current = [];
    setSessionId(null);
    setEvents([]);
    setError(null);
    setStatus("ready");
    setRestored(false);
    try {
      localStorage.removeItem(STORE_KEY);
    } catch {
      /* ignore */
    }
  }

  const canFollow = mode === "conversation" && !!sessionId && sessionStatus === "waiting" && !busy;
  const phase = pickPhase(status, busy, sessionStatus);
  const glow = { run: "var(--amber)", done: "var(--green)", wait: "var(--blue)", fail: "var(--red)", idle: "var(--amber)" }[phase];
  const runLabel = busy ? "运行中…" : canFollow ? "发送下一句" : mode === "task" ? "运行 · 单发" : "开始对话";

  return (
    <>
      <div className="bg" style={{ "--glow": glow } as CSSProperties} />
      <div className="shell">
        {/* ---------- 侧栏:控制台 ---------- */}
        <aside className="rail">
          <div className="brand">
            <div className="mark">e</div>
            <div>
              <h1>eve 会话调试台</h1>
              <div className="tag">durable agent · mission control</div>
            </div>
          </div>

          <div className="card">
            <p className="lbl">模式</p>
            <div className="seg">
              <button className={`task ${mode === "task" ? "on" : ""}`} onClick={() => setMode("task")}>
                task
                <span className="d">单发 → completed</span>
              </button>
              <button className={`conv ${mode === "conversation" ? "on" : ""}`} onClick={() => setMode("conversation")}>
                conversation
                <span className="d">多轮 → waiting</span>
              </button>
            </div>

            <div style={{ marginTop: 15 }}>
              <p className="lbl">{canFollow ? "下一句" : "消息"}</p>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") send();
                }}
                placeholder="发给 agent 的内容…  ⌘/Ctrl+Enter 发送"
              />
            </div>

            {mode === "task" && (
              <label className="check">
                <input type="checkbox" checked={useSchema} onChange={(e) => setUseSchema(e.target.checked)} />
                带 outputSchema(结构化 result.completed)
              </label>
            )}

            <div className="actions">
              {busy ? (
                <button className="btn stop" onClick={stop}>
                  ◼ 停止
                </button>
              ) : (
                <button className="btn run" onClick={send} disabled={!message.trim()}>
                  ▸ {runLabel}
                </button>
              )}
              {sessionId && !busy && (
                <button className="btn ghost" onClick={reset}>
                  新会话
                </button>
              )}
            </div>

            {mode === "conversation" && sessionId && sessionStatus === "completed" && (
              <p className="hint">conversation 竟然 completed 了?通常是 task 残留,点「新会话」重开。</p>
            )}
            {mode === "task" && sessionStatus === "completed" && (
              <p className="hint">已终结 · task 会话不可续,续写请切 conversation。</p>
            )}
            {error && <p className="err">✗ {error}</p>}
          </div>

          {/* curl 面板 */}
          <div className="card">
            <div className="curl-head">
              <p className="lbl" style={{ margin: 0 }}>对应 curl</p>
              <CopyBtn text={buildCurl(mode, message, useSchema)} />
            </div>
            <pre className="code">{buildCurl(mode, message, useSchema)}</pre>
            {sessionId && (
              <>
                <div className="curl-head">
                  <p className="lbl" style={{ margin: 0 }}>看这个会话的流</p>
                  <CopyBtn text={streamCurl(sessionId)} />
                </div>
                <pre className="code">{streamCurl(sessionId)}</pre>
              </>
            )}
            {mode === "conversation" && sessionId && (
              <>
                <div className="curl-head">
                  <p className="lbl" style={{ margin: 0 }}>续写(带 token)</p>
                  <CopyBtn text={followCurl(sessionId)} />
                </div>
                <pre className="code">{followCurl(sessionId)}</pre>
              </>
            )}
          </div>
        </aside>

        {/* ---------- 主区:会话流 ---------- */}
        <main className="main">
          <div className="topbar">
            <span className={`pill ${phase === "idle" ? "" : phase}`}>
              <span className="dot" />
              {pillText(status, sessionStatus)}
            </span>
            <span className="meta-chip">
              model <b>deepseek-chat</b>
            </span>
            {sessionId && (
              <span className="meta-chip">
                run <b>{sessionId.slice(0, 14)}…</b>
              </span>
            )}
            {restored && <span className="meta-chip">· 已恢复上次会话</span>}
            <span className="spacer" />
            {(totalIn > 0 || totalOut > 0) && (
              <span className="tok">
                <span>in <b>{totalIn}</b></span>
                <span>out <b>{totalOut}</b></span>
              </span>
            )}
          </div>

          <div className="stream" ref={streamRef}>
            {turns.length === 0 ? (
              <div className="empty">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4">
                  <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z" />
                  <path d="M8 12h8M12 8v8" strokeLinecap="round" />
                </svg>
                <div className="big">等待第一条消息</div>
                选好模式、写条消息,点运行。task 跑完即终结,conversation 会停在 waiting 等你续写。
              </div>
            ) : (
              <div className="feed">
                {turns.map((t, i) => (
                  <div className="turn" key={t.turnId + "-" + i}>
                    <div className="turn-head">turn · {t.turnId}</div>

                    {t.user && (
                      <div className="msg">
                        <div className="ava user">你</div>
                        <div className="body">
                          <div className="bubble user-text">{t.user}</div>
                        </div>
                      </div>
                    )}

                    <div className="msg">
                      <div className="ava bot">e</div>
                      <div className="body">
                        {t.reasoning && (
                          <details className="reason" open={t.status === "running"}>
                            <summary>思考过程</summary>
                            <div className="reason-body">{t.reasoning}</div>
                          </details>
                        )}

                        {t.blocks.map((b, bi) => (
                          <div className="assistant" key={bi}>
                            {b}
                          </div>
                        ))}
                        {t.live && (
                          <div className="assistant">
                            {t.live}
                            <span className="caret" />
                          </div>
                        )}
                        {!t.blocks.length && !t.live && !t.tools.length && t.status === "running" && (
                          <div className="assistant">
                            <span className="caret" />
                          </div>
                        )}

                        {t.tools.map((tool, ti) => (
                          <div className="tool" key={ti}>
                            <div className="tool-top">
                              <span className="k">🔧 {tool.name}</span>
                              <span className={`st ${tool.status}`}>{tool.status}</span>
                            </div>
                            {tool.input !== undefined && (
                              <div className="io">
                                <span className="rk">input </span>
                                {short(tool.input)}
                              </div>
                            )}
                            {tool.output !== undefined && (
                              <div className="io out">
                                <span className="rk">output </span>
                                {short(tool.output)}
                              </div>
                            )}
                          </div>
                        ))}

                        {t.result !== undefined && t.result !== null && (
                          <div className="result-box">
                            <div className="lbl2">result.completed</div>
                            <pre>{short(t.result)}</pre>
                          </div>
                        )}

                        {(t.usageIn > 0 || t.finishReason) && (
                          <div className="turn-foot">
                            {t.finishReason && <span className="fr">finish: {t.finishReason}</span>}
                            {t.usageIn > 0 && (
                              <span>
                                in {t.usageIn} · out {t.usageOut} tok
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {events.length > 0 && (
              <details className="raw">
                <summary>原始事件流({events.length})</summary>
                <div className="raw-grid">
                  {events.map((e, i) => (
                    <span key={i}>{e.type}</span>
                  ))}
                </div>
              </details>
            )}
          </div>
        </main>
      </div>
    </>
  );
}

/* ---------------- helpers ---------------- */

function CopyBtn({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      className="btn ghost mini"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setOk(true);
          setTimeout(() => setOk(false), 1200);
        } catch {
          /* ignore */
        }
      }}
    >
      {ok ? "已复制" : "复制"}
    </button>
  );
}

async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text) throw new Error(`空响应 (HTTP ${res.status}) —— 代理没拿到 body,多半是 eve 端点/网络代理的问题`);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`非 JSON 响应 (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }
}

function short(v: unknown): string {
  const s = typeof v === "string" ? v : JSON.stringify(v, null, 2);
  return s.length > 800 ? s.slice(0, 800) + "…" : s;
}

function pickPhase(status: Status, busy: boolean, sessionStatus: string | null): "run" | "done" | "wait" | "fail" | "idle" {
  if (status === "error" || sessionStatus === "failed") return "fail";
  if (busy) return "run";
  if (sessionStatus === "completed") return "done";
  if (sessionStatus === "waiting" || sessionStatus === "input") return "wait";
  return "idle";
}

function pillText(status: Status, sessionStatus: string | null): string {
  if (status === "submitted") return "SUBMITTING";
  if (status === "streaming") return "STREAMING";
  if (status === "error") return "ERROR";
  if (sessionStatus === "completed") return "COMPLETED · 已终结";
  if (sessionStatus === "waiting") return "WAITING · 可继续";
  if (sessionStatus === "failed") return "FAILED";
  if (sessionStatus === "input") return "INPUT REQUESTED";
  return "READY";
}

function deriveConsole(events: EveEvent[]): Derived {
  const turns: Turn[] = [];
  const byId = new Map<string, Turn>();
  let sessionStatus: string | null = null;
  let totalIn = 0;
  let totalOut = 0;

  const ensure = (id: string): Turn => {
    let t = byId.get(id);
    if (!t) {
      t = { turnId: id, blocks: [], live: "", reasoning: "", tools: [], callIndex: {}, usageIn: 0, usageOut: 0, status: "running" };
      byId.set(id, t);
      turns.push(t);
    }
    return t;
  };

  for (const ev of events) {
    const d = (ev.data ?? {}) as Record<string, unknown>;
    const id = typeof d.turnId === "string" ? d.turnId : undefined;
    switch (ev.type) {
      case "message.received":
        if (id) ensure(id).user = d.message as string;
        break;
      case "message.appended":
        if (id) {
          const t = ensure(id);
          t.live = (d.messageSoFar as string) ?? t.live;
        }
        break;
      case "message.completed":
        if (id) {
          const t = ensure(id);
          t.blocks.push((d.message as string) ?? t.live);
          t.live = "";
          if (typeof d.finishReason === "string") t.finishReason = d.finishReason;
        }
        break;
      case "reasoning.appended":
        if (id) {
          const t = ensure(id);
          t.reasoning = (d.reasoningSoFar as string) ?? (d.textSoFar as string) ?? t.reasoning;
        }
        break;
      case "reasoning.completed":
        if (id) {
          const t = ensure(id);
          t.reasoning = (d.reasoning as string) ?? (d.text as string) ?? t.reasoning;
        }
        break;
      case "actions.requested":
        if (id) {
          const t = ensure(id);
          const actions = (d.actions as Array<Record<string, unknown>>) ?? [];
          for (const a of actions) {
            t.callIndex[a.callId as string] = t.tools.length;
            t.tools.push({ name: (a.toolName as string) ?? "tool", input: a.input, status: "running" });
          }
        }
        break;
      case "action.result":
        if (id) {
          const t = ensure(id);
          const r = (d.result as Record<string, unknown>) ?? {};
          const idx = t.callIndex[r.callId as string];
          if (idx !== undefined) {
            t.tools[idx].output = r.output;
            t.tools[idx].status = d.status === "failed" ? "failed" : "done";
          }
        }
        break;
      case "result.completed":
        if (id) ensure(id).result = d.result;
        break;
      case "step.completed":
        if (id) {
          const t = ensure(id);
          const u = (d.usage as Record<string, number>) ?? {};
          t.usageIn += u.inputTokens ?? 0;
          t.usageOut += u.outputTokens ?? 0;
          totalIn += u.inputTokens ?? 0;
          totalOut += u.outputTokens ?? 0;
        }
        break;
      case "turn.completed":
        if (id) ensure(id).status = "completed";
        break;
      case "turn.failed":
        if (id) ensure(id).status = "failed";
        break;
      case "session.started":
        sessionStatus = "started";
        break;
      case "session.waiting":
        sessionStatus = "waiting";
        break;
      case "session.completed":
        sessionStatus = "completed";
        break;
      case "session.failed":
        sessionStatus = "failed";
        break;
      case "input.requested":
        sessionStatus = "input";
        break;
    }
  }
  return { turns, sessionStatus, totalIn, totalOut };
}

function buildCurl(mode: Mode, message: string, useSchema: boolean): string {
  const payload: Record<string, unknown> = { mode, message: message || "你的消息" };
  if (mode === "task" && useSchema) payload.outputSchema = DEMO_SCHEMA;
  return [
    `curl -s -X POST "${EVE_BASE}/eve/v1/session" \\`,
    `  -H 'content-type: application/json' \\`,
    `  -d '${JSON.stringify(payload)}'`,
  ].join("\n");
}

function streamCurl(sid: string): string {
  return [
    `curl -s "${EVE_BASE}/eve/v1/session/${sid}/stream?startIndex=0" \\`,
    `  | grep -vE '"type":"(message|reasoning).appended"'`,
  ].join("\n");
}

function followCurl(sid: string): string {
  return [
    `curl -s -X POST "${EVE_BASE}/eve/v1/session/${sid}" \\`,
    `  -H 'content-type: application/json' \\`,
    `  -d '{"continuationToken":"<上一轮返回的 token>","message":"接着聊"}'`,
  ].join("\n");
}
