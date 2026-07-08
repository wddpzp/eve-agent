import { defineTool } from "eve/tools";
import { z } from "zod";

// 文件名 multiply.ts → 工具名 multiply。只读计算,默认 never() 直接执行。
export default defineTool({
  description: "Multiply two numbers and return their product.",
  inputSchema: z.object({
    a: z.number().describe("first factor"),
    b: z.number().describe("second factor"),
  }),
  async execute({ a, b }) {
    return { product: a * b };
  },
});
