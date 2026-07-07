import type { NextRequest } from "next/server";
import { Client } from "eve/client";
import type { SessionState } from "eve/client";

// eve/client 的正确归宿:server-to-server。这里在 Next Route Handler 里跑 SDK。
// 续写:浏览器把上一轮回传的 SessionState 带回来,就 client.session(state) resume 同一个会话;
// 没有则新建。每轮结束把 session.state 回传,浏览器存住给下一轮。
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HOST = process.env.EVE_BASE_URL ?? "https://eve-agent-ten.vercel.app";
const TERMINAL = new Set(["session.waiting", "session.completed", "session.failed", "input.requested"]);

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
  // 有可续写的 token 就 resume 同一会话,否则新建
  const session = body.sessionState?.continuationToken ? client.session(body.sessionState) : client.session();
  const payload = body.outputSchema ? { message, outputSchema: body.outputSchema } : { message };

  try {
    // payload 是运行时构造的合法 JSON,断言成 SDK 的入参类型(outputSchema 期望 JsonObject)
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
              // 会话 park/终结后主动收尾,否则 for await 会挂在等下一条(durable stream 不自关)
              if (TERMINAL.has(ev.type)) break;
            }
            line({ type: "__state", sessionState: session.state });
          } catch (e) {
            line({ type: "__error", message: e instanceof Error ? e.message : String(e) });
          } finally {
            controller.close();
          }
        },
      });
      return new Response(rs, { headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" } });
    }

    // —— 消费方式 B:aggregate,一行拿 typed 结果 ——
    const result = await response.result();
    return Response.json({
      sessionId: result.sessionId,
      status: result.status,
      message: result.message ?? null,
      data: result.data ?? null,
      eventCount: result.events.length,
      sessionState: session.state,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: `eve/client 调用失败: ${msg}(检查 EVE_BASE_URL / 代理)` }, { status: 502 });
  }
}
