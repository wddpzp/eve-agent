import { defineChannel, GET, POST } from "eve/channels";

// 进程内暂存「待批准的审批问题」,key = sessionId。
// ⚠️ 仅本地单进程有效;serverless 不跨请求存活。真实 channel(如 Slack)是把问题
// 推到外部持久系统 / 你注册的 callback URL。这里用内存 Map 只为本地演示
// 「审批问题也从 channel 出来」这一环。
const pending = new Map<string, unknown>();

// 自定义 channel:一个能完成【完整 HITL 回路】的入口。
//   POST /ask              起会话(可能 park 在审批)→ 返回 sessionId
//   events.input.requested agent park 时触发 → 把审批问题送出去(此处暂存,供 /pending 读)
//   GET  /pending/:id      读某会话当前待批准的问题(问 → 走 channel 出来)
//   POST /answer           送回 approve/deny → 恢复会话
export default defineChannel({
  events: {
    // agent 停在审批点时,eve 触发这个 —— 这就是「把问题送给人」的钩子。
    "input.requested"(event, _channel, ctx) {
      pending.set(ctx.session.id, event);
    },
  },
  routes: [
    POST("/ask", async (req, { send }) => {
      const body = (await req.json()) as { message: string; id?: string };
      const session = await send(body.message, {
        auth: null,
        continuationToken: body.id ?? "demo",
      });
      return Response.json({ sessionId: session.id });
    }),

    // 问 → 走 channel 出来:读这个会话当前待批准的问题
    GET("/pending/:sessionId", async (_req, { params }) => {
      return Response.json({ pending: pending.get(params.sessionId) ?? null });
    }),

    // 答 → 走 channel 回去:approve/deny 恢复会话
    POST("/answer", async (req, { send }) => {
      const body = (await req.json()) as { id?: string; decision: string };
      const session = await send(body.decision, {
        auth: null,
        continuationToken: body.id ?? "demo",
      });
      pending.delete(session.id);
      return Response.json({ sessionId: session.id });
    }),
  ],
});
