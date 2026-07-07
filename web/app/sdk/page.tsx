"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

const LIST_KEY = "eve-sdk-sessions-v1";
const MAX_SESSIONS = 30;

type Consume = "aggregate" | "stream";

interface EveEvent {
  type: string;
  data?: Record<string, unknown>;
}

interface SessionState {
  continuationToken?: string;
  sessionId?: string;
  streamIndex: number;
}

interface SdkTurn {
  user: string;
  assistant: string;
  data?: unknown;
  status?: string;
  consume: Consume;
}

interface SdkSaved {
  sessionId: string;
  title: string;
  state: SessionState | null;
  turns: SdkTurn[];
  updatedAt: number;
}

const DEMO_SCHEMA = {
  type: "object",
  properties: { answer: { type: "string" }, confidence: { type: "number" } },
  required: ["answer"],
} as const;

const STREAM_TERMINAL = new Set(["session.waiting", "session.completed", "session.failed", "input.requested"]);

const SERVER_SNIPPET = `// web/app/api/sdk/route.ts —— SDK 全程在服务端
import { Client } from "eve/client";

const client = new Client({ host: HOST });
// 有上一轮的 state 就 resume 同一会话,否则新建
const session = body.sessionState
  ? client.session(body.sessionState)
  : client.session();

const response = await session.send(payload);
// ...消费 result() / for await...
return { ...result, sessionState: session.state };  // 回传给浏览器,下轮带回`;

export default function SdkPage() {
  const [message, setMessage] = useState("用一句话介绍你自己");
  const [useSchema, setUseSchema] = useState(false);
  const [consume, setConsume] = useState<Consume>("aggregate");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [turns, setTurns] = useState<SdkTurn[]>([]);
  const [live, setLive] = useState<EveEvent[]>([]);
  const [sid, setSid] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SdkSaved[]>([]);

  const stateRef = useRef<SessionState | null>(null);
  const streamRef = useRef<HTMLDivElement | null>(null);

  const continuing = !!stateRef.current?.continuationToken;
  const liveView = deriveStream(live);

  // 挂载时读取会话列表
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LIST_KEY);
      if (raw) {
        const list = JSON.parse(raw) as SdkSaved[];
        if (Array.isArray(list)) setSessions(list);
      }
    } catch {
      /* ignore */
    }
  }, []);

  function persist(sessionId: string, title: string, nextTurns: SdkTurn[]) {
    const entry: SdkSaved = { sessionId, title, state: stateRef.current, turns: nextTurns, updatedAt: Date.now() };
    setSessions((prev) => {
      const next = [entry, ...prev.filter((s) => s.sessionId !== sessionId)].slice(0, MAX_SESSIONS);
      try {
        localStorage.setItem(LIST_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  function scrollDown() {
    const el = streamRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }

  async function run() {
    if (!message.trim() || busy) return;
    const sent = message;
    setBusy(true);
    setError(null);
    setLive([]);
    setMessage("");
    const payload = {
      message: sent,
      stream: consume === "stream",
      ...(useSchema ? { outputSchema: DEMO_SCHEMA } : {}),
      ...(stateRef.current ? { sessionState: stateRef.current } : {}),
    };
    try {
      const res = await fetch("/api/sdk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      let sidValue = sid;
      let turn: SdkTurn;

      if (consume === "aggregate") {
        const text = await res.text();
        const j = text ? (JSON.parse(text) as AggResp) : ({} as AggResp);
        if (!res.ok || j.error) throw new Error(j.error ?? `HTTP ${res.status}`);
        stateRef.current = j.sessionState ?? null;
        sidValue = j.sessionId ?? sidValue;
        turn = { user: sent, assistant: j.message ?? "(无文本)", data: j.data, status: j.status, consume: "aggregate" };
      } else {
        if (!res.body) throw new Error(`空响应 (HTTP ${res.status})`);
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        const collected: EveEvent[] = [];
        let done = false;
        while (!done) {
          const r = await reader.read();
          if (r.done) break;
          buf += dec.decode(r.value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const raw of lines) {
            const t = raw.trim();
            if (!t) continue;
            let ev: EveEvent;
            try {
              ev = JSON.parse(t) as EveEvent;
            } catch {
              continue;
            }
            if (ev.type === "__meta") {
              sidValue = (ev as { sessionId?: string }).sessionId ?? sidValue;
              continue;
            }
            if (ev.type === "__state") {
              stateRef.current = (ev as { sessionState?: SessionState }).sessionState ?? null;
              continue;
            }
            if (ev.type === "__error") throw new Error((ev as { message?: string }).message ?? "stream error");
            collected.push(ev);
            if (STREAM_TERMINAL.has(ev.type)) done = true;
          }
          setLive([...collected]);
          scrollDown();
          if (done) {
            await reader.cancel();
            break;
          }
        }
        const v = deriveStream(collected);
        turn = { user: sent, assistant: v.message || "(无文本)", data: v.result, status: v.sessionStatus ?? undefined, consume: "stream" };
        setLive([]);
      }

      setSid(sidValue);
      const nextTurns = [...turns, turn];
      setTurns(nextTurns);
      if (sidValue) persist(sidValue, (nextTurns[0]?.user ?? sent).slice(0, 40), nextTurns);
      scrollDown();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function newSession() {
    if (busy) return;
    stateRef.current = null;
    setSid(null);
    setTurns([]);
    setLive([]);
    setError(null);
  }

  function loadSession(s: SdkSaved) {
    if (busy) return;
    stateRef.current = s.state;
    setSid(s.sessionId);
    setTurns(s.turns);
    setLive([]);
    setError(null);
  }

  function deleteSession(id: string) {
    setSessions((prev) => {
      const next = prev.filter((s) => s.sessionId !== id);
      try {
        localStorage.setItem(LIST_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
    if (id === sid) newSession();
  }

  const phase = busy ? "run" : continuing ? "wait" : turns.length ? "done" : "idle";
  const glow = { run: "var(--amber)", done: "var(--green)", wait: "var(--blue)", idle: "var(--teal)" }[phase];

  return (
    <>
      <div className="bg" style={{ "--glow": glow } as CSSProperties} />
      <div className="shell">
        {/* ---------- 侧栏 ---------- */}
        <aside className="rail">
          <div className="brand">
            <div className="mark">e</div>
            <div>
              <h1>eve/client SDK 演示</h1>
              <div className="tag">server-driven · typed sessions</div>
            </div>
          </div>
          <a className="navlink" href="/">← 回主控制台(原生 HTTP · 支持 task)</a>

          <div className="card">
            <p className="lbl">这是什么</p>
            <p className="hint" style={{ marginTop: 0 }}>
              浏览器只调本站 <code>/api/sdk</code>;该 Route Handler 用 <code>Client().session()</code> 驱动会话 —— SDK 全程在服务端。
              续写靠回传/带回 <code>SessionState</code>:有 token 就 <code>client.session(state)</code> resume 同一会话,否则新建。
            </p>
          </div>

          <div className="card">
            <p className="lbl">消费方式</p>
            <div className="seg">
              <button className={`task ${consume === "aggregate" ? "on" : ""}`} onClick={() => setConsume("aggregate")}>
                aggregate
                <span className="d">await result()</span>
              </button>
              <button className={`conv ${consume === "stream" ? "on" : ""}`} onClick={() => setConsume("stream")}>
                stream
                <span className="d">for await 事件</span>
              </button>
            </div>

            <div style={{ marginTop: 15 }}>
              <p className="lbl">{continuing ? "下一句(续同一 session)" : "消息"}</p>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") run();
                }}
                placeholder="发给 agent 的内容…  ⌘/Ctrl+Enter"
              />
            </div>

            <label className="check">
              <input type="checkbox" checked={useSchema} onChange={(e) => setUseSchema(e.target.checked)} />
              带 outputSchema(result.data 结构化)
            </label>

            <div className="actions">
              <button className="btn run" onClick={run} disabled={busy || !message.trim()}>
                ▸ {busy ? "运行中…" : continuing ? "发送下一句" : consume === "aggregate" ? "调用 · result()" : "调用 · 流式"}
              </button>
              {(turns.length > 0 || sid) && !busy && (
                <button className="btn ghost" onClick={newSession}>
                  新会话
                </button>
              )}
            </div>
            {continuing && <p className="hint">已在续写同一 session(带 continuationToken)。点「新会话」开新的。</p>}
            {error && <p className="err">✗ {error}</p>}
          </div>

          {sessions.length > 0 && (
            <div className="card">
              <p className="lbl">会话历史 · {sessions.length}</p>
              <div className="sess-list">
                {sessions.map((s) => (
                  <div
                    key={s.sessionId}
                    className={`sess ${s.sessionId === sid ? "on" : ""}`}
                    onClick={() => loadSession(s)}
                    title={s.sessionId}
                  >
                    <div className="sess-main">
                      <div className="sess-title">{s.title}</div>
                      <div className="sess-meta">
                        <span className="sess-badge conversation">{s.turns.length} 轮</span>
                        <span className={`sess-status ${s.state?.continuationToken ? "waiting" : "completed"}`}>
                          {s.state?.continuationToken ? "可续" : "—"}
                        </span>
                        <span>· {timeAgo(s.updatedAt)}</span>
                      </div>
                    </div>
                    <button
                      className="sess-del"
                      title="删除"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteSession(s.sessionId);
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
              <p className="hint">点一条即载回该 session,继续发就是续写(靠存住的 SessionState)。</p>
            </div>
          )}

          <div className="card">
            <p className="lbl">服务端代码</p>
            <pre className="code" style={{ marginBottom: 0 }}>{SERVER_SNIPPET}</pre>
          </div>
        </aside>

        {/* ---------- 主区 ---------- */}
        <main className="main">
          <div className="topbar">
            <span className={`pill ${phase === "idle" ? "" : phase}`}>
              <span className="dot" />
              {busy ? "RUNNING" : continuing ? "WAITING · 可续" : turns.length ? "IDLE" : "READY"}
            </span>
            <span className="meta-chip">
              via <b>eve/client</b> · {consume}
            </span>
            {sid && (
              <span className="meta-chip">
                run <b>{sid.slice(0, 14)}…</b>
              </span>
            )}
            {turns.length > 0 && <span className="meta-chip">· {turns.length} 轮(同一 session)</span>}
            <span className="spacer" />
          </div>

          <div className="stream" ref={streamRef}>
            <div className="feed">
              {turns.map((t, i) => (
                <div className="turn" key={i}>
                  <div className="turn-head">
                    turn {i + 1} · {t.consume}
                  </div>
                  <div className="msg">
                    <div className="ava user">你</div>
                    <div className="body">
                      <div className="bubble user-text">{t.user}</div>
                    </div>
                  </div>
                  <div className="msg">
                    <div className="ava bot">e</div>
                    <div className="body">
                      <div className="assistant">{t.assistant}</div>
                      {t.data != null && (
                        <div className="result-box">
                          <div className="lbl2">result.data(结构化)</div>
                          <pre>{short(t.data)}</pre>
                        </div>
                      )}
                      {t.status && (
                        <div className="turn-foot">
                          <span className="fr">status: {t.status}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}

              {/* 进行中的 stream turn */}
              {busy && consume === "stream" && (
                <div className="turn">
                  <div className="turn-head">for await · {live.length} events</div>
                  <div className="msg">
                    <div className="ava bot">e</div>
                    <div className="body">
                      <div className="assistant">
                        {liveView.message}
                        <span className="caret" />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {busy && consume === "aggregate" && (
                <div className="empty" style={{ padding: "40px 20px" }}>
                  <div className="big">调用中…</div>
                  aggregate 在服务端 <code>await result()</code> 消费完整个事件流后才返回(几秒)。
                </div>
              )}

              {turns.length === 0 && !busy && (
                <div className="empty">
                  <div className="big">等待调用</div>
                  选消费方式、写条消息,点调用。之后继续发就是**续同一个 session**(SessionState 往返),点「新会话」才换新的。
                </div>
              )}
            </div>
          </div>
        </main>
      </div>
    </>
  );
}

/* ---------------- helpers ---------------- */

interface AggResp {
  sessionId?: string;
  status?: string;
  message?: string | null;
  data?: unknown;
  eventCount?: number;
  sessionState?: SessionState | null;
  error?: string;
}

interface StreamView {
  message: string;
  result: unknown;
  sessionStatus: string | null;
}

function deriveStream(events: EveEvent[]): StreamView {
  let message = "";
  let result: unknown = undefined;
  let sessionStatus: string | null = null;
  for (const ev of events) {
    const d = (ev.data ?? {}) as Record<string, unknown>;
    switch (ev.type) {
      case "message.appended":
        message = (d.messageSoFar as string) ?? message;
        break;
      case "message.completed":
        message = (d.message as string) ?? message;
        break;
      case "result.completed":
        result = d.result ?? d;
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
    }
  }
  return { message, result, sessionStatus };
}

function short(v: unknown): string {
  const s = typeof v === "string" ? v : JSON.stringify(v, null, 2);
  return s.length > 800 ? s.slice(0, 800) + "…" : s;
}

function timeAgo(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return "刚刚";
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  return `${Math.floor(s / 86400)} 天前`;
}
