import { defineTool } from "eve/tools";
import { z } from "zod";

// 文件名 reverse.ts → 工具名 reverse。纯字符串处理,默认 never() 直接执行。
export default defineTool({
  description: "Reverse a string and return the reversed text.",
  inputSchema: z.object({
    text: z.string().min(1).describe("The text to reverse"),
  }),
  async execute({ text }) {
    return { reversed: [...text].reverse().join("") };
  },
});
