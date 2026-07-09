import { githubChannel } from "eve/channels/github";

// GitHub channel = 一个「@mention 触发、带仓库上下文」的问答 bot。
//
// 不传任何 handler → 用 eve 内置默认行为(default harness 那套):
//   · onComment 默认门槛:仅当评论文本里出现 @<botName> 才派发(正则词边界匹配)
//   · turn.started:自动给评论加 👀 + 把目标 repo checkout 进 sandbox(仅部署时)
//   · message.completed:把模型回复贴成 issue/PR 评论(过长自动拆多条)
//   · turn.failed / session.failed:贴一条带 error id 的错误评论
//
// 凭证与 botName 全部走环境变量回退,所以这里无需硬编码:
//   botName        ← GITHUB_APP_SLUG   (必须等于 GitHub App 的 slug,决定 @谁 才触发)
//   credentials    ← GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY / GITHUB_WEBHOOK_SECRET
//
// webhook 入口固定为 /eve/v1/github —— GitHub App 的 Webhook URL 要指到
// 你的 eve agent 部署:https://eve-agent-ten.vercel.app/eve/v1/github
//
// ⚠️ 本地 eve dev 不 checkout 仓库(文件操作不可用),且 localhost 收不到 GitHub webhook;
//    真正的效果只有部署后才有。想本地联调需要 tunnel(如 cloudflared)转发到 :3100。
export default githubChannel();
