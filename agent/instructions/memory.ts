import { defineDynamic, defineInstructions } from "eve/instructions";
import { memory } from "../lib/memory.js";

// 每轮开始把「已记住的东西」注入 system prompt。这就是上下文工程/RAG 的注入半边:
// 数据(这里是 memory state)在每次模型调用前动态拼进指令。
// 与根 agent/instructions.md 共存,不冲突。
export default defineDynamic({
  events: {
    "turn.started": () => {
      const entries = Object.entries(memory.get());
      if (entries.length === 0) return null; // 没记忆就不注入
      const lines = entries.map(([k, v]) => `- ${k}: ${v}`).join("\n");
      return defineInstructions({
        markdown: `Known memory about the current user (honor it):\n${lines}`,
      });
    },
  },
});
