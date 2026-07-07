import { defineEvalConfig } from "eve/evals";

// 每个 app 恰好一个 evals.config.ts。这里的 eval 都是确定性断言,不用 LLM-judge,
// 所以不配 judge;要用 t.judge.* 时再加 judge: { model: deepseek("deepseek-chat") }。
export default defineEvalConfig({
  maxConcurrency: 2,
});
