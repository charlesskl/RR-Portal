// 退料单入口(/material-returns):通用 UsageDoc 页 + 退料配置(对照老系统 materialDocConfigs["material-returns"])。
// 独立文件是给 MainLayout 的 lazy loader 一个单独的 default export(两条路由两个组件实例)。
import { materialReturnApi } from "@/api/endpoints";
import type { UsageDocCfg } from "@/lib/usageDoc";
import { MaterialUsageDocPage } from "./MaterialUsageDocPage";

const CFG: UsageDocCfg = {
  key: "material-return",
  api: materialReturnApi,
  menu: "退料单",
  title: "退料",
  deptField: "退料部门",
  personField: "退料人",
  sumField: "退料数量",
  sumLabel: "退料数量",
  exportName: "退料",
  keywordPlaceholder: "单号/生产单号/款号/退料人/物料",
};

export default function MaterialReturnPage() {
  return <MaterialUsageDocPage cfg={CFG} />;
}
