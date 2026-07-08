import type { NextRequest } from "next/server";
import { Client } from "eve/client";
import type { SessionState } from "eve/client";

// eve/client 的正确归宿:server-to-server。这里在 Next Route Handler 里跑 SDK。
// 续写:浏览器把上一轮回传的 SessionState 带回来 → client.session(state) resume 同一会话;没有则新建。
// 每轮把 session.state 回传给浏览器,下轮带回。
// 兜底:45s AbortSignal —— eve 的 durable stream 在 session.waiting 后不自关,
// 万一 SDK 迭代器没 yield 终结事件,超时中止,返回明确错误而不是无限挂住。
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HOST = process.env.EVE_BASE_URL ?? "https://eve-agent-ten.vercel.app";
const TERMINAL = new Set(["session.waiting", "session.completed", "session.failed", "input.requested"]);
const TURN_TIMEOUT_MS = 45_000;

interface Body {
  message?: string;
  outputSchema?: Record<string, unknown>;
  stream?: boolean;
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
  const base = body.outputSchema ? { message, outputSchema: body.outputSchema } : { message };
  const payload = { ...base, signal: abort.signal };

  try {
    const response = await session.send(payload as unknown as Parameters<typeof session.send>[0]);

    // —— 消费方式 A:for await 流式,逐条 NDJSON 回传;结束再回传 sessionState ——
    if (body.stream) {
      const enc = new TextEncoder();
      const rs = new ReadableStream<Uint8Array>({
        async start(controller) {
          const line = (o: unknown) => controller.enqueue(enc.encode(JSON.stringify(o) + "\n"));
          try {
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

    // —— 消费方式 B:aggregate,手动消费到 terminal 再聚合(不用 result():它没 break,会偶发挂住)——
    let msg: string | null = null;
    let status = "unknown";
    let data: unknown = null;
    let count = 0;
    for await (const ev of response) {
      count += 1;
      const e = ev as { type: string; data?: Record<string, unknown> };
      const d = e.data ?? {};
      if (e.type === "message.completed") msg = (d.message as string) ?? msg;
      else if (e.type === "result.completed") data = d.result ?? null;
      else if (e.type === "session.waiting") status = "waiting";
      else if (e.type === "session.completed") status = "completed";
      else if (e.type === "session.failed") status = "failed";
      if (TERMINAL.has(e.type)) break;
    }
    clearTimeout(timer);
    return Response.json({
      sessionId: response.sessionId,
      status,
      message: msg,
      data,
      eventCount: count,
      sessionState: session.state,
    });
  } catch (e) {
    clearTimeout(timer);
    const msg = abort.signal.aborted
      ? `turn 超时(>${TURN_TIMEOUT_MS / 1000}s)—— eve 流未在时限内结束`
      : `eve/client 调用失败: ${e instanceof Error ? e.message : String(e)}(检查 EVE_BASE_URL / 代理)`;
    return Response.json({ error: msg }, { status: 504 });
  }
}
