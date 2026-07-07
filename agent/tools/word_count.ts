import { defineTool } from "eve/tools";
import { z } from "zod";

// 文件名 word_count.ts → 模型看到的工具名就是 word_count(必须 snake_case)。
// 没写 approval 就是默认 never():直接执行、不提示。只读工具这样没问题;
// 换成扣款/删除类务必加 approval: always()。
export default defineTool({
  description: "Count the words, characters, and lines in a piece of text.",
  inputSchema: z.object({
    text: z.string().min(1).describe("The text to analyze"),
  }),
  async execute({ text }) {
    // 返回值必须 JSON 可序列化
    return {
      words: text.trim().split(/\s+/).filter(Boolean).length,
      characters: text.length,
      lines: text.split("\n").length,
    };
  },
});
