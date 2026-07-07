import { defineEval } from "eve/evals";

// HITL:请求危险操作 → park 在审批 → 批准 → 执行。
export default defineEval({
  description: "delete_note 需要审批:请求时 park,批准后才执行",
  async test(t) {
    const first = await t.send("删掉 id 为 note-42 的笔记");
    // 第一轮应停在审批上(delete_note 处于 pending,未执行)
    first.calledTool("delete_note", { status: "pending", count: 1 });

    // 批准所有待答请求
    await t.respondAll("approve");

    // 恢复后:整体成功,且 delete_note 真执行了
    t.succeeded();
    t.calledTool("delete_note", { status: "completed", output: { deleted: "note-42" } });
  },
});
