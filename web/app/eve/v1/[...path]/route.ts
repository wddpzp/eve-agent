import type { NextRequest } from "next/server";

// 同源代理:浏览器 → 本应用 /eve/v1/* → eve 部署的 /eve/v1/*。
// useEveAgent 默认就打同源 /eve/v1/*,而 eve 部署没开 CORS,浏览器无法跨域直连,
// 所以在这里服务端转发,把 base URL 收在服务端。stream 端点原样流式透传。
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BASE = process.env.EVE_BASE_URL ?? "https://eve-agent-ten.vercel.app";

async function proxy(req: NextRequest, path: string[]): Promise<Response> {
  const target = `${BASE}/eve/v1/${path.join("/")}${req.nextUrl.search}`;
  const bodyless = req.method === "GET" || req.method === "HEAD";
  const isStream = path[path.length - 1] === "stream";

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers: { "content-type": req.headers.get("content-type") ?? "application/json" },
      body: bodyless ? undefined : await req.text(),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: `代理 eve 失败: ${msg}(检查 EVE_BASE_URL / 网络代理)` }, { status: 502 });
  }

  const contentType = upstream.headers.get("content-type") ?? "application/json";
  if (isStream) {
    return new Response(upstream.body, { status: upstream.status, headers: { "content-type": contentType, "cache-control": "no-store" } });
  }
  const text = await upstream.text();
  return new Response(text, { status: upstream.status, headers: { "content-type": contentType, "cache-control": "no-store" } });
}

type Ctx = { params: Promise<{ path: string[] }> };
export async function GET(req: NextRequest, ctx: Ctx): Promise<Response> {
  return proxy(req, (await ctx.params).path);
}
export async function POST(req: NextRequest, ctx: Ctx): Promise<Response> {
  return proxy(req, (await ctx.params).path);
}
