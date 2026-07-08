import type { NextRequest } from "next/server";
import { Client } from "eve/client";
import type { SessionState } from "eve/client";

// 聊天页的服务端:用 eve/client SDK 跑一轮对话(server-to-server 的正确姿势)。
// 浏览器每轮带上一轮回传的 sessionState → client.session(state) resume 同一会话;
// 没有 sessionState 则 client.session() 新建。每轮结束把新的 session.state 回传。
// 流式协议(NDJSON):
//   {type:"__meta", sessionId}   —— 先告诉前端这轮的 sessionId
//   ...eve 事件逐条...
//   {type:"__state", sessionState} —— 这轮结束后的续写游标,前端存下轮带回
//   {type:"__error", message}      —— 出错
// 兜底:60s AbortSignal —— eve durable 流在 session.waiting 后不自关,靠 TERMINAL break;
// 万一 SDK 迭代器没 yield 终结事件,超时中止,返回明确错误而不是无限挂。
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HOST = process.env.EVE_BASE_URL ?? "https://eve-agent-ten.vercel.app";
const TERMINAL = new Set(["session.waiting", "session.completed", "session.failed", "input.requested"]);
const TURN_TIMEOUT_MS = 60_000;

interface Body {
  message?: string;
  sessionState?: SessionState | null;
}

export async function POST(req: NextRequest): Promise<Response> {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  const message = body.message?.trim();
  if (!message) return Response.json({ error: "message 不能为空" }, { status: 400 });

  const client = new Client({ host: HOST });
  const session = body.sessionState?.continuationToken ? client.session(body.sessionState) : client.session();

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TURN_TIMEOUT_MS);
  const enc = new TextEncoder();

  const rs = new ReadableStream<Uint8Array>({
    async start(controller) {
      const line = (o: unknown) => controller.enqueue(enc.encode(JSON.stringify(o) + "\n"));
      try {
        const response = await session.send({ message, signal: abort.signal } as unknown as Parameters<typeof session.send>[0]);
        line({ type: "__meta", sessionId: response.sessionId });
        for await (const ev of response) {
          line(ev);
          if (TERMINAL.has((ev as { type: string }).type)) break;
        }
        line({ type: "__state", sessionState: session.state });
      } catch (e) {
        const msg = abort.signal.aborted ? `turn 超时(>${TURN_TIMEOUT_MS / 1000}s)` : e instanceof Error ? e.message : String(e);
        line({ type: "__error", message: msg });
      } finally {
        clearTimeout(timer);
        controller.close();
      }
    },
  });

  return new Response(rs, { headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" } });
}
