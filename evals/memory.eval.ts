import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";

// 多轮 eval:t.send 顺序驱动同一会话,state 跨轮持久。
export default defineEval({
  description: "agent 用 remember 工具记住名字,并在下一轮回忆出来",
  async test(t) {
    // 第 1 轮:告诉它一个事实,期望它调 remember 写入
    await t.send("请记住:我叫朋工。");
    t.calledTool("remember", { count: 1 });

    // 第 2 轮:问它,期望回忆出来
    await t.send("我叫什么名字?");
    t.succeeded();
    t.check(t.reply, includes("朋工"));
  },
});
