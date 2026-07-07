import { defineEval } from "eve/evals";

// 文件路径 = eval id(word-count)。
export default defineEval({
  description: "word_count 工具被调用且返回正确词数",
  async test(t) {
    await t.send("用工具统计这句话的词数:the quick brown fox jumps");
    t.succeeded(); // gate:run 没失败、没 park
    // 断言在工具的 output 上,而不是模型措辞 → 确定性
    t.calledTool("word_count", { output: { words: 5 }, count: 1 });
  },
});
