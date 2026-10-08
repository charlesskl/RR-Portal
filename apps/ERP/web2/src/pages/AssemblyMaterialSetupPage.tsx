// 装配物料设置(/assembly-material-setup):与 BOM物料设置同组件的装配入口包装
// (对照老系统 web/src/App.tsx:213 同组件两路由)。装配模式 prop 开启 扩展段/报价/调整审核,
// 语义见 BomSetupPage.tsx 头注。
import BomSetupPage from "./BomSetupPage";

export default function AssemblyMaterialSetupPage() {
  return <BomSetupPage assemblyMode />;
}
