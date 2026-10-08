// 半成品出仓单(/semi-outbound)= 来料领料单的仓侧别名入口(领料出库过账)。
// 对照老系统 web/src/App.tsx:245:MaterialsDocCenter forceDoc="material-issues"
// docLabel="半成品出仓单" queryLabel="半成品出仓查询" docTitle="半成品出仓"(同来料出仓单做法)。
// 权限菜单=来料领料单(老系统菜单 M("半成品出仓单","/semi-outbound","来料领料单");
// MenuCatalog 无独立「半成品出仓单」键,仓侧审核复用领料单权限)。
import MaterialIssuePage from "./MaterialIssuePage";

export default function SemiOutboundPage() {
  return (
    <MaterialIssuePage titleOverride="半成品出仓" docLabel="半成品出仓单" queryLabel="半成品出仓查询" />
  );
}
