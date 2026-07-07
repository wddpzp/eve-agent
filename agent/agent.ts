import { deepseek } from "@ai-sdk/deepseek";
import { defineAgent } from "eve";

export default defineAgent({
  model: deepseek("deepseek-chat"), // 换 "deepseek-reasoner" 用 R1 思考模型
});
