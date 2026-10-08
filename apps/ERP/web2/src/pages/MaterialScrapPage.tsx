// 报废单入口(/material-scraps):通用 UsageDoc 页 + 报废配置(对照老系统 materialDocConfigs["material-scraps"])。
// 独立文件是给 MainLayout 的 lazy loader 一个单独的 default export(两条路由两个组件实例)。
import { materialScrapApi } from "@/api/endpoints";
import type { UsageDocCfg } from "@/lib/usageDoc";
import { MaterialUsageDocPage } from "./MaterialUsageDocPage";

const CFG: UsageDocCfg = {
  key: "material-scrap",
  api: materialScrapApi,
  menu: "报废单",
  title: "报废",
  deptField: "报废部门",
  personField: "报废人",
  sumField: "报废数量",
  sumLabel: "报废数量",
  exportName: "报废",
  keywordPlaceholder: "单号/生产单号/款号/报废人/物料",
};

export default function MaterialScrapPage() {
  return <MaterialUsageDocPage cfg={CFG} />;
}
