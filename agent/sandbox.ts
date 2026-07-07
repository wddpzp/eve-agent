import { defineSandbox } from "eve/sandbox";
import { justbash } from "eve/sandbox/just-bash";
import { vercel } from "eve/sandbox/vercel";

// 本地用 justbash(纯 JS bash,不拉 Docker 镜像),避开 Docker Hub 被墙导致的
// sandbox prewarm 卡死;部署到 Vercel(VERCEL 置位)时用 Vercel Sandbox。
// 默认 defaultBackend() 会优先选本机 Docker,正是卡住的原因,所以这里显式指定。
// 整体分支而非三元:两个后端配置类型不同,联合起来 backend 字段不收。
export default process.env.VERCEL
  ? defineSandbox({ backend: vercel() })
  : defineSandbox({ backend: justbash() });
