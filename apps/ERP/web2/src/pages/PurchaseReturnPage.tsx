// 采购退仓单入口:与采购入仓单共用 DocPage 实现,仅 kind 固定为退仓。
// 独立文件是给 MainLayout 的 lazy loader 一个单独的 default export(两条路由两个组件实例)。
export { PurchaseReturnsPage as default } from "./PurchaseReceiptPage";
