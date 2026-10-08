import {
  Component,
  Suspense,
  createElement,
  lazy,
  useCallback,
  useEffect,
  useState,
  type ComponentType,
  type LazyExoticComponent,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { X } from "@phosphor-icons/react";
import { TabsProvider, useTabs } from "./TabsContext";
import { useDocTabs } from "@/hooks/useDocTabs";
import { useHeartbeat } from "@/hooks/useHeartbeat";
import { startTableFreeze } from "@/lib/tableFreeze";
import { TopBar } from "./TopBar";
import { DeptSidebar } from "./DeptSidebar";
import { cn } from "@/lib/utils";

// react-router 的 location.pathname 对中文路由保留百分号编码,查表前统一解码,非法序列原样返回
function decodePath(pathname: string): string {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

// 主框架:根路由为卡片宫格首页,页面组件 keep-alive(隐藏不卸载),标签页切换不丢状态。
const PAGES: Record<string, string> = {
  "/production": "生产通知单",
  "/purchase-orders": "采购订单",
  "/purchase-receipts": "采购入仓单",
  "/purchase-returns": "采购退仓单",
  "/material-issues": "来料领料单",
  "/plastic-receipts": "塑胶入仓单",
  "/plastic-issues": "塑胶领料单",
  "/assembly-purchases": "委托加工单",
  "/scheduling": "客户排期表",
  "/material-inventory": "物料库存查询",
  "/accounts": "账号权限管理",
  "/online-users": "在线人员",
  "/messages": "消息中心",
  "/bom-setup": "BOM物料设置",
  "/master/款号资料": "款号总表",
  "/bom-style-query": "BOM货号查询",
  "/bom-material-query": "BOM物料查询",
  "/bom-tree": "BOM层级树",
  "/material-master": "物料资料",
  "/plastic-material-master": "塑胶物料资料",
  "/material-create": "物料快速建档",
  // Batch 2 装配部报表群
  "/production-tracking": "生产单跟踪表",
  "/order-summary": "货号接单汇总表",
  "/assembly-material-setup": "装配物料设置",
  "/assembly-material-summary": "装配物料汇总表",
  "/assembly-purchase-query": "装配采购查询",
  "/assembly-purchase-progress": "装配采购进度表",
  "/assembly-material-tracking": "装配物料跟踪表",
  "/assembly-factory-inventory": "加工厂库存汇总表",
  "/assembly-required-material-detail": "装配需领明细表",
  "/assembly-factory-category-monthly": "加工厂分类月报表",
  "/assembly-factory-category-detail": "加工厂分类明细表",
  // Batch 3 补料单 + 来料仓剩余
  "/replenishments": "补料单",
  "/material-returns": "退料单",
  "/material-scraps": "报废单",
  "/month-end": "库存月报表",
  "/purchase-order-query": "订购单查询",
  "/material-label-orders": "来料标签单",
  "/order-progress": "采购订单进度表",
  // Batch 4 塑胶仓群
  "/plastic-material-analysis": "塑胶采购分析",
  "/plastic-material-settings": "塑胶物料设置",
  "/plastic-purchase-orders": "塑胶采购订单",
  "/plastic-purchase-order-print": "塑胶采购订单打印",
  "/plastic-purchase-progress": "塑胶订单进度表",
  "/plastic-common-materials": "塑胶共用物料表",
  "/plastic-warehouse-returns": "塑胶退仓单",
  "/plastic-scraps": "塑胶报废单",
  "/plastic-inventory": "塑胶库存统计表",
  "/plastic-monthly-report": "塑胶库存月报表",
  "/plastic-customer-type-stats": "塑胶类型客户统计",
  // Batch 5 半成品仓群
  "/semi-finished-common-materials": "半成品共用物料表",
  "/semi-finished-label-orders": "半成品标签单",
  "/semi-receipts": "半成品入仓单",
  "/semi-issues": "半成品出库单",
  "/semi-outbound": "半成品出仓单",
  "/semi-scraps": "半成品报废单",
  "/semi-stocktakes": "半成品盘点单",
  "/semi-inventory": "半成品库存统计表",
  "/semi-inventory-monthly": "半成品库存月报表",
  // Batch 6 喷油/加工群
  "/plastic-process-order-make": "塑胶加工订单制作",
  "/plastic-white-part-issue": "白件领料单",
  "/plastic-process-purchase-orders": "塑胶加工采购订单",
  "/purchase-material-analysis": "采购物料分析",
  "/purchase-material-settings": "采购物料设置",
  "/material-order-make": "BOM订单制作",
  // Batch 7 原料仓群
  "/plastic-raw-material-master": "原料资料",
  "/plastic-raw-material-demand": "原料生产需求表",
  "/plastic-raw-material-purchase-analysis": "原料采购分析表",
  "/plastic-raw-material-purchase-order": "原料采购订单",
  "/plastic-raw-material-purchase-progress": "原料采购进度表",
  "/plastic-raw-material-receipt": "原料入仓单",
  "/plastic-raw-material-stock-issue": "原料出库表",
  "/plastic-raw-material-stocktake": "原料盘点单",
  "/plastic-raw-material-inventory": "原料库存统计表",
  "/plastic-raw-material-monthly": "原料库存月报表",
  "/plastic-raw-material-demand-summary": "原料生产需求汇总",
  "/plastic-raw-material-order-receipt-stats": "原料订货入库统计",
  // Batch 8 船务部 + 业务部 + 外发加工资料
  "/finished-receipts": "成品入仓单",
  "/finished-inventory": "成品库存",
  "/master/客户资料": "客户资料",
  "/master/加工厂资料": "加工厂资料",
  "/master/供应商资料": "供应商资料",
  // Batch 9 基础设置 + 工具项
  "/system/company-profile": "基本资料",
  "/system/feature-settings": "功能设置",
  "/system/warehouse-locations": "仓库位置设置",
  "/system/backup": "备份数据",
  "/system/restore": "还原数据",
  "/system/injection-machine-rates": "啤机机型啤工表",
  "/hr/department-personnel": "部门人事",
  "/change-password": "用户修改密码",
  "/system/upgrade": "网上升级",
  "/logout": "退出软件",
};

const PAGE_LOADERS: Record<string, () => Promise<{ default: ComponentType }>> = {
  "/production": () => import("@/pages/ProductionPage"),
  "/purchase-orders": () => import("@/pages/PurchaseOrderPage"),
  "/purchase-receipts": () => import("@/pages/PurchaseReceiptPage"),
  "/purchase-returns": () => import("@/pages/PurchaseReturnPage"),
  "/material-issues": () => import("@/pages/MaterialIssuePage"),
  "/plastic-receipts": () => import("@/pages/PlasticReceiptPage"),
  "/plastic-issues": () => import("@/pages/PlasticIssuePage"),
  "/assembly-purchases": () => import("@/pages/AssemblyPurchasePage"),
  "/scheduling": () => import("@/pages/SchedulingPage"),
  "/material-inventory": () => import("@/pages/InventoryPage"),
  "/accounts": () => import("@/pages/AccountsPage"),
  "/online-users": () => import("@/pages/OnlineUsersPage"),
  "/messages": () => import("@/pages/MessagesPage"),
  "/bom-setup": () => import("@/pages/BomSetupPage"),
  "/master/款号资料": () => import("@/pages/StyleMasterPage"),
  "/bom-style-query": () => import("@/pages/BomStyleQueryPage"),
  "/bom-material-query": () => import("@/pages/BomMaterialQueryPage"),
  "/bom-tree": () => import("@/pages/BomTreePage"),
  "/material-master": () => import("@/pages/MaterialMasterPage"),
  "/plastic-material-master": () => import("@/pages/PlasticMaterialMasterPage"),
  "/material-create": () => import("@/pages/MaterialCreatePage"),
  // Batch 2 装配部报表群
  "/production-tracking": () => import("@/pages/ProductionTrackingPage"),
  "/order-summary": () => import("@/pages/OrderSummaryPage"),
  // 装配物料设置与 BOM物料设置同组件(包装页传 assemblyMode;对照老系统同组件两路由)
  "/assembly-material-setup": () => import("@/pages/AssemblyMaterialSetupPage"),
  "/assembly-material-summary": () => import("@/pages/AssemblyMaterialSummaryPage"),
  "/assembly-purchase-query": () => import("@/pages/AssemblyPurchaseQueryPage"),
  "/assembly-purchase-progress": () => import("@/pages/AssemblyPurchaseProgressPage"),
  "/assembly-material-tracking": () => import("@/pages/AssemblyMaterialTrackingPage"),
  "/assembly-factory-inventory": () => import("@/pages/AssemblyFactoryInventoryPage"),
  "/assembly-required-material-detail": () => import("@/pages/AssemblyRequiredMaterialDetailPage"),
  "/assembly-factory-category-monthly": () => import("@/pages/AssemblyFactoryCategoryMonthlyPage"),
  "/assembly-factory-category-detail": () => import("@/pages/FactoryCategoryDetailPage"),
  // Batch 3 补料单 + 来料仓剩余
  "/replenishments": () => import("@/pages/ReplenishmentPage"),
  "/material-returns": () => import("@/pages/MaterialReturnPage"),
  "/material-scraps": () => import("@/pages/MaterialScrapPage"),
  "/month-end": () => import("@/pages/MonthEndPage"),
  "/purchase-order-query": () => import("@/pages/PurchaseOrderQueryPage"),
  "/material-label-orders": () => import("@/pages/MaterialLabelOrderPage"),
  "/order-progress": () => import("@/pages/OrderProgressPage"),
  // Batch 4 塑胶仓群
  "/plastic-material-analysis": () => import("@/pages/PlasticMaterialAnalysisPage"),
  "/plastic-material-settings": () => import("@/pages/PlasticMaterialSettingsPage"),
  "/plastic-purchase-orders": () => import("@/pages/PlasticPurchaseOrderPage"),
  "/plastic-purchase-order-print": () => import("@/pages/PlasticPurchaseOrderPrintPage"),
  "/plastic-purchase-progress": () => import("@/pages/PlasticPurchaseProgressPage"),
  "/plastic-common-materials": () => import("@/pages/PlasticCommonMaterialPage"),
  "/plastic-warehouse-returns": () => import("@/pages/PlasticWarehouseReturnPage"),
  "/plastic-scraps": () => import("@/pages/PlasticScrapPage"),
  "/plastic-inventory": () => import("@/pages/PlasticInventoryPage"),
  "/plastic-monthly-report": () => import("@/pages/PlasticMonthlyReportPage"),
  "/plastic-customer-type-stats": () => import("@/pages/PlasticCustomerTypeStatsPage"),
  // Batch 5 半成品仓群
  "/semi-finished-common-materials": () => import("@/pages/SemiCommonMaterialPage"),
  "/semi-finished-label-orders": () => import("@/pages/SemiLabelOrderPage"),
  "/semi-receipts": () => import("@/pages/SemiReceiptPage"),
  "/semi-issues": () => import("@/pages/SemiIssuePage"),
  "/semi-outbound": () => import("@/pages/SemiOutboundPage"),
  "/semi-scraps": () => import("@/pages/SemiScrapPage"),
  "/semi-stocktakes": () => import("@/pages/SemiStocktakePage"),
  "/semi-inventory": () => import("@/pages/SemiInventoryPage"),
  "/semi-inventory-monthly": () => import("@/pages/SemiMonthlyReportPage"),
  // Batch 6 喷油/加工群
  "/plastic-process-order-make": () => import("@/pages/PlasticProcessOrderMakePage"),
  "/plastic-white-part-issue": () => import("@/pages/PlasticWhitePartIssuePage"),
  "/plastic-process-purchase-orders": () => import("@/pages/PlasticProcessPurchaseOrderPage"),
  "/purchase-material-analysis": () => import("@/pages/PurchaseMaterialAnalysisPage"),
  "/purchase-material-settings": () => import("@/pages/PurchaseMaterialSettingsPage"),
  "/material-order-make": () => import("@/pages/MaterialOrderMakePage"),
  // Batch 7 原料仓群
  "/plastic-raw-material-master": () => import("@/pages/PlasticRawMaterialMasterPage"),
  "/plastic-raw-material-demand": () => import("@/pages/PlasticRawMaterialDemandPage"),
  "/plastic-raw-material-purchase-analysis": () => import("@/pages/PlasticRawMaterialPurchaseAnalysisPage"),
  "/plastic-raw-material-purchase-order": () => import("@/pages/PlasticRawMaterialPurchaseOrderPage"),
  "/plastic-raw-material-purchase-progress": () => import("@/pages/PlasticRawMaterialPurchaseProgressPage"),
  "/plastic-raw-material-receipt": () => import("@/pages/PlasticRawMaterialReceiptPage"),
  "/plastic-raw-material-stock-issue": () => import("@/pages/PlasticRawMaterialStockIssuePage"),
  "/plastic-raw-material-stocktake": () => import("@/pages/PlasticRawMaterialStocktakePage"),
  "/plastic-raw-material-inventory": () => import("@/pages/PlasticRawMaterialInventoryPage"),
  "/plastic-raw-material-monthly": () => import("@/pages/PlasticRawMaterialMonthlyPage"),
  "/plastic-raw-material-demand-summary": () => import("@/pages/PlasticRawMaterialDemandSummaryPage"),
  "/plastic-raw-material-order-receipt-stats": () => import("@/pages/PlasticRawMaterialOrderReceiptStatsPage"),
  // Batch 8 船务部 + 业务部 + 外发加工资料
  "/finished-receipts": () => import("@/pages/FinishedReceiptPage"),
  "/finished-inventory": () => import("@/pages/FinishedInventoryPage"),
  "/master/客户资料": () => import("@/pages/CustomerMasterPage"),
  "/master/加工厂资料": () => import("@/pages/FactoryMasterPage"),
  "/master/供应商资料": () => import("@/pages/SupplierMasterPage"),
  // Batch 9 基础设置 + 工具项
  "/system/company-profile": () => import("@/pages/CompanyProfilePage"),
  "/system/feature-settings": () => import("@/pages/FeatureSettingsPage"),
  "/system/warehouse-locations": () => import("@/pages/WarehouseLocationPage"),
  "/system/backup": () => import("@/pages/BackupPage"),
  "/system/restore": () => import("@/pages/RestorePage"),
  "/system/injection-machine-rates": () => import("@/pages/InjectionMachineRatePage"),
  "/hr/department-personnel": () => import("@/pages/DepartmentPersonnelPage"),
  "/change-password": () => import("@/pages/ChangePasswordPage"),
  "/system/upgrade": () => import("@/pages/UpgradePage"),
  "/logout": () => import("@/pages/LogoutPage"),
};
const HomePage = lazy(() => import("@/pages/HomePage"));
const lazyCache = new Map<string, LazyExoticComponent<ComponentType>>();
function pageComponent(path: string) {
  let c = lazyCache.get(path);
  if (!c) {
    c = lazy(PAGE_LOADERS[path]);
    lazyCache.set(path, c);
  }
  return c;
}

function PageSkeleton() {
  return (
    <div className="space-y-4 p-7">
      <div className="h-9 w-64 animate-pulse rounded-lg bg-black/5" />
      <div className="h-40 w-full animate-pulse rounded-[14px] bg-black/5" />
      <div className="h-72 w-full animate-pulse rounded-[14px] bg-black/5" />
    </div>
  );
}

// 标签页栏:卡片式标签,激活态绿色描边 + 淡绿底
// 导出供测试复用;关闭/激活逻辑统一走 useDocTabs
export function TabBar() {
  const { active } = useTabs();
  const { tabs, openTab, closeTab } = useDocTabs();
  return (
    <div className="relative z-10 flex h-13 shrink-0 items-center gap-2 overflow-x-auto border-b border-black/6 px-3">
      {tabs.length === 0 && (
        <span className="pl-2 text-sm text-[#5f6b7d]">
          从首页卡片或 Ctrl K 搜索打开页面
        </span>
      )}
      {tabs.map((t) => {
        const isActive = t.key === active;
        return (
          <div
            key={t.key}
            className={cn(
              "group flex h-10 cursor-pointer items-center gap-2 rounded-lg border px-4 text-[15px] transition-all select-none",
              isActive
                ? "border-[#16a34a]/50 bg-[#16a34a]/10 font-semibold text-[#15803d]"
                : "border-black/8 bg-black/[0.03] text-[#5f6b7d] hover:border-black/15 hover:text-[#3d4a5c]",
            )}
            onClick={() => openTab(t.key, t.title)}
          >
            {isActive && <span className="h-2 w-2 rounded-full bg-[#16a34a]" />}
            <span className="whitespace-nowrap">{t.title}</span>
            <button
              type="button"
              aria-label={`关闭 ${t.title}`}
              className="flex h-5 w-5 items-center justify-center rounded-full text-disabled transition-colors hover:bg-black/10 hover:text-[#3d4a5c]"
              onClick={(e) => {
                e.stopPropagation();
                closeTab(t.key);
              }}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

function Shell() {
  const location = useLocation();
  const navigate = useNavigate();
  const { tabs, active, open } = useTabs();
  const queryClient = useQueryClient();
  const [paletteOpen, setPaletteOpen] = useState(false);
  // 部门窄侧栏选中项(默认「全部」),只影响宫格首页的过滤
  const [dept, setDept] = useState("all");
  // 在线心跳(60s):驱动 /online-users 三色状态
  useHeartbeat();
  // 宽表冻结列全局管理器:给 table[data-freeze] 注入冻结钉(lib/tableFreeze.ts)
  useEffect(() => startTableFreeze(), []);

  // 中文路由的 pathname 是百分号编码形态,查 PAGES 前解码
  const path = decodePath(location.pathname);

  useEffect(() => {
    if (PAGES[path]) open({ key: path, title: PAGES[path] });
  }, [path, open]);

  // 切回标签页时刷新数据:keep-alive 隐藏页仍挂载(查询仍 active),
  // 全局 refetchOnWindowFocus=false,不 invalidate 会一直显示旧数据;
  // refetchType 默认 active,只在 active key 变化时触发一次(非每次渲染)
  useEffect(() => {
    if (active) void queryClient.invalidateQueries();
  }, [active, queryClient]);

  const go = useCallback((p: string) => navigate(p), [navigate]);
  const goHome = useCallback(() => navigate("/"), [navigate]);
  // 在任意页面点部门 = 回宫格首页并应用该部门过滤(已打开标签保留)
  const selectDept = useCallback(
    (key: string) => {
      setDept(key);
      navigate("/");
    },
    [navigate],
  );
  // 非页面路由(根路由 index)= 卡片宫格首页
  const showHome = !PAGES[path];

  return (
    <div
      data-theme="future"
      className="flex h-screen flex-col overflow-hidden bg-[#f7faf8] text-[#1a2330]"
    >
      <div className="f-aurora" />

      <div className="relative z-10 flex min-h-0 flex-1 flex-col">
        <TopBar
          paletteOpen={paletteOpen}
          onPaletteChange={setPaletteOpen}
          onNavigate={go}
          onHome={goHome}
        />
        <div className="flex min-h-0 flex-1">
          <DeptSidebar selected={dept} onSelect={selectDept} />
          <div className="flex min-w-0 flex-1 flex-col">
            <TabBar />
            <main className="min-h-0 flex-1 overflow-hidden">
              <MainErrorBoundary>
                {showHome ? (
                  <div className="h-full overflow-auto">
                    <Suspense fallback={<PageSkeleton />}>
                      <HomePage dept={dept} onNavigate={go} />
                    </Suspense>
                  </div>
                ) : tabs.length === 0 ? (
                  // 防御:页面路由下标签尚未注册的首帧,渲染骨架而不是空白
                  <PageSkeleton />
                ) : (
                  tabs.map((t) => (
                    <div key={t.key} hidden={t.key !== active} className="f-page h-full overflow-auto">
                      <Suspense fallback={<PageSkeleton />}>
                        {createElement(pageComponent(t.key))}
                      </Suspense>
                    </div>
                  ))
                )}
              </MainErrorBoundary>
            </main>
          </div>
        </div>
      </div>
    </div>
  );
}

// 主区错误边界:渲染异常时给出错误态和重载入口,不再无声白屏
class MainErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
          <div className="text-sm font-medium text-[#dc2626]">页面渲染出错</div>
          <p className="f-mono max-w-md text-xs break-all text-[#5f6b7d]">
            {this.state.error.message}
          </p>
          <button
            type="button"
            className="f-btn mt-3 h-10 text-sm"
            onClick={() => location.reload()}
          >
            重新加载
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function MainLayout() {
  return (
    <TabsProvider>
      <Shell />
    </TabsProvider>
  );
}
