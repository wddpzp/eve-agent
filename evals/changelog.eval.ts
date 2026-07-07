import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";

export default defineEval({
  description: "changelog skill 被按需加载,并驱动出 Keep a Changelog 格式",
  async test(t) {
    // 给全 version + date,模型就不会用 ask_question 停下来问 → 直接写
    await t.send("帮我写 v1.2.0(2026-07-07)的 changelog 条目:新增暗色模式,修复登录崩溃");
    t.succeeded();
    t.loadedSkill("changelog"); // = calledTool("load_skill", { input: { skill: "changelog" } })
    // skill 灌进去的格式痕迹
    t.check(t.reply, includes("### Added"));
    t.check(t.reply, includes("### Fixed"));
  },
});
