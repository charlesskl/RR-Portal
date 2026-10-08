// Batch 7 原料仓群共享逻辑(对照老系统 web/src/pages/plastics/PlasticRawMaterial*.tsx 的公共件):
// 领料备注/单价类型下拉选项、三级流转状态、可编辑明细行类型、打印规格(复用 semiDocs 通用打印)。
import {
  printSemiDoc,
  type SemiDocPrintCfg,
} from "./semiDocs";

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : "操作失败");
export const date10 = (v?: string | null) => (v ? String(v).slice(0, 10) : "");
// ISO 格式:后端 DateTime 反序列化要求(老系统同款 today())
export const today = () => new Date().toISOString().slice(0, 10);

// 领料备注下拉(原料生产需求表/原料出库表共用;对照老系统 Select options)
export const ISSUE_REMARKS = ["生产领料", "样品领料", "维修领料"] as const;

// 单价类型下拉:明细行 含税/未税(采购订单/入仓单),入仓单头 格式HK$/Lb 等(老系统两处分列)
export const LINE_PRICE_TYPES = ["含税", "未税"] as const;
export const RECEIPT_PRICE_TYPES = ["格式HK$/Lb", "格式HK$/kg", "格式RMB/kg"] as const;

// 三级流转状态(原料采购订单/原料出库表):未审核 -> 主管已审 -> 经理已审 -> 已审核(已下发)
// 对照老系统 statusTag
export interface TripleAuditLike {
  审核?: string;
  主管审核?: string;
  主管审核人?: string;
  经理审核?: string;
  经理审核人?: string;
}
export function tripleAuditStage(h: TripleAuditLike): 0 | 1 | 2 | 3 {
  if (h.审核 === "1") return 3;
  if (h.经理审核 === "1") return 2;
  if (h.主管审核 === "1") return 1;
  return 0;
}
export function tripleAuditLabel(h: TripleAuditLike): string {
  switch (tripleAuditStage(h)) {
    case 3:
      return "已审核";
    case 2:
      return `经理已审${h.经理审核人 ? `(${h.经理审核人})` : ""}`;
    case 1:
      return `主管已审${h.主管审核人 ? `(${h.主管审核人})` : ""}`;
    default:
      return "未审核";
  }
}

// 原料单据打印(单头项+明细列配置;实现复用 Batch 5 通用打印,行为一致)
export type RawDocPrintCfg = SemiDocPrintCfg;
export function printRawDoc(
  title: string,
  detail: { 单头: Record<string, unknown> | null; 明细: Record<string, unknown>[] },
  cfg: RawDocPrintCfg,
): void {
  printSemiDoc(title, detail, cfg);
}

// 明细编辑行通用:每行带稳定 key(删除/局部更新用)
let rawRowSeq = 1;
export const nextRowKey = () => rawRowSeq++;
