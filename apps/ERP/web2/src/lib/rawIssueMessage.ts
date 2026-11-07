import type { MessageRow } from "@/api/types";

// 仅依据明确消息类型和真实单号；不从单号前缀猜来源。
export function rawIssueMessageTarget(message: MessageRow): string | null {
  const number = message.单号?.trim();
  return message.类型 === "原料领料待出库" && number
    ? `/plastic-raw-material-stock-issue?open=${encodeURIComponent(number)}` : null;
}
