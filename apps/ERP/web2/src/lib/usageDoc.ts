// 退料单/报废单 单据配置类型(配置实体在各入口页;独立成 lib 避免页面文件导出非组件)。
// 两单据后端同构(仅 部门/人 字段名与查询数量字段不同),对照老系统 materialDocConfigs。
import type { materialReturnApi } from "@/api/endpoints";

export interface UsageDocCfg {
  key: string; // 查询缓存前缀
  api: typeof materialReturnApi;
  menu: string; // 权限菜单(显式传 DocToolbar)
  title: string; // 退料 | 报废
  deptField: "退料部门" | "报废部门";
  personField: "退料人" | "报废人";
  sumField: "退料数量" | "报废数量";
  sumLabel: string;
  exportName: string; // 导出文件名前缀
  keywordPlaceholder: string;
}
