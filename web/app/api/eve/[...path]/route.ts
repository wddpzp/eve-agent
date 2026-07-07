import type { NextRequest } from "next/server";

// 服务端代理:浏览器 → 本应用同源 /api/eve/* → eve 部署的 /eve/v1/*
// 目的:eve 部署没开 CORS,浏览器无法跨域直连;走服务端转发即可绕过,
// 同时把 base URL 收在服务端,前端只认同源路径。
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BASE = process.env.EVE_BASE_URL ?? "https://eve-agent-ten.vercel.app";

async function proxy(req: NextRequest, path: string[]): Promise<Response> {
  const target = `${BASE}/eve/v1/${path.join("/")}${req.nextUrl.search}`;
  const isBodyless = req.method === "GET" || req.method === "HEAD";
  const isStream = path[path.length - 1] === "stream";

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers: { "content-type": req.headers.get("content-type") ?? "application/json" },
      body: isBodyless ? undefined : await req.text(),
    });
  } catch (e) {
    // 网络/代理层失败:回一个明确的 JSON,别让前端拿到空 body
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: `代理请求 eve 失败: ${msg}(检查 EVE_BASE_URL / 网络代理)` }, { status: 502 });
  }

  const contentType = upstream.headers.get("content-type") ?? "application/json";

  // stream 端点是 NDJSON 长连接 → 原样流式透传
  if (isStream) {
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { "content-type": contentType, "cache-control": "no-store" },
    });
  }

  // 其它(建会话/续写等小 JSON)→ 整段缓冲后回传,避免流式透传在 dev 下丢包成空 body
  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: { "content-type": contentType, "cache-control": "no-store" },
  });
}

type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(req: NextRequest, ctx: Ctx): Promise<Response> {
  return proxy(req, (await ctx.params).path);
}

export async function POST(req: NextRequest, ctx: Ctx): Promise<Response> {
  return proxy(req, (await ctx.params).path);
}
