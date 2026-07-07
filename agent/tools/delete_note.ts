import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";

// 危险/不可逆操作:挂 approval: always() → 每次调用前都 park,等人批准才执行。
// 这就是 HITL:把人插进 agent 的自动循环里,关键步骤必须人拍板。
export default defineTool({
  description: "Delete a saved note by its id. This is destructive and cannot be undone.",
  inputSchema: z.object({ id: z.string().min(1).describe("the note id to delete") }),
  approval: always(),
  async execute({ id }) {
    // demo:不真删,只回执。重点是上面的审批门,不是这行。
    return { deleted: id };
  },
});
