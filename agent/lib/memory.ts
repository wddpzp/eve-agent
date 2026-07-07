import { defineState } from "eve/context";

// 跨轮次持久(同一会话内),进程重启也不丢。key → value 的记忆表。
// 注意:defineState 是「按会话」的,不跨会话/跨用户。要跨会话记忆就把这里换成
// 外部存储(Postgres/Redis),读写接口不变。
export const memory = defineState("memory", (): Record<string, string> => ({}));
