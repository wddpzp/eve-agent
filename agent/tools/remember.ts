import { defineTool } from "eve/tools";
import { z } from "zod";
import { memory } from "../lib/memory.js";

// 让模型主动把「值得长期记住的事实/偏好」写进 memory state。
export default defineTool({
  description:
    "Remember a durable fact or preference about the user so later turns can use it. Call this whenever the user shares something worth remembering (their name, preferences, constraints).",
  inputSchema: z.object({
    key: z.string().min(1).describe("short identifier, e.g. 'name' or 'reply_style'"),
    value: z.string().min(1).describe("the fact to remember, in a full sentence"),
  }),
  async execute({ key, value }) {
    memory.update((m) => ({ ...m, [key]: value }));
    return { remembered: { [key]: value } };
  },
});
