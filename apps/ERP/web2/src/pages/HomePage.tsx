import { useQuery } from "@tanstack/react-query";
import { ClipboardText, WarningOctagon } from "@phosphor-icons/react";
import {
  assemblyPurchaseOrderApi,
  inventoryApi,
  materialIssueApi,
  productionApi,
  purchaseOrderApi,
  replenishmentApi,
} from "@/api/endpoints";
import { getUser } from "@/lib/auth";
import { MENU_TREE } from "@/nav/menu";
import { cn } from "@/lib/utils";

// 卡片宫格首页(根路由 index):按部门分组展示菜单卡片,
// 左侧部门侧栏选中哪个部门就只显示哪个部门(「全部」显示所有分组)。
// 菜单全部条目均已有路由,点击卡片即导航。
const DESCRIPTIONS: Record<string, string> = {
  "/production": "生产制单、审核流转与货号明细",
  "/purchase-orders": "来料采购开单、三级审核与补料带入",
  "/plastic-receipts": "塑胶入仓开单、审核入仓与采购单带入",
  "/material-issues": "来料领料开单、三级审核出库与领料查询",
  "/assembly-purchases": "委托加工单开单、行级客户与下加工单",
  "/scheduling": "客户排期导入、查询与排期下生产通知单",
  "/material-inventory": "物料实时库存查询与筛选",
  "/accounts": "注册账号、重置密码与菜单权限分配",
  "/replenishments": "补料开单、PMC 审核与采购带入",
  "/material-returns": "退料开单、审核入仓与退料查询",
  "/material-scraps": "报废开单、审核出库与报废查询",
  "/month-end": "库存月结快照与月报表",
  "/purchase-order-query": "订购单明细/汇总查询与导出",
  "/material-label-orders": "来料标签开单、审核与标签打印",
  "/order-progress": "采购订单整单/明细进度与欠数",
  // Batch 4 塑胶仓群
  "/plastic-material-analysis": "生产单塑胶物料分析与加工件发外需求",
  "/plastic-material-settings": "塑胶物料默认仓库与损耗率设置",
  "/plastic-purchase-orders": "塑胶采购开单、三级审核与二次加工下单",
  "/plastic-purchase-progress": "塑胶采购整单/明细进度与欠数",
  "/plastic-common-materials": "塑胶共用物料维护与工模联动",
  "/plastic-warehouse-returns": "塑胶退仓开单、审核退仓与退仓查询",
  "/plastic-scraps": "塑胶报废开单、审核出库与报废查询",
  "/plastic-inventory": "塑胶实时库存、类别树与导出",
  "/plastic-monthly-report": "塑胶月度期初/出入库/期末报表",
  "/plastic-customer-type-stats": "客户 x 类型数量金额透视统计",
  // Batch 6 喷油/加工群
  "/plastic-process-order-make": "喷油加工需求、接收订单与带入制作",
  "/plastic-white-part-issue": "白件领料开单、三级审核与清单调入",
  "/plastic-process-purchase-orders": "加工采购开单、厂类别过滤与三级审核",
  "/purchase-material-analysis": "生产单采购分析明细与下采购订单",
  "/purchase-material-settings": "物料默认供应商、最小订量与损耗率",
  "/material-order-make": "工作表勾选分组生成采购订单",
  // Batch 7 原料仓群
  "/plastic-raw-material-master": "塑胶原料类别树、建档与价格权限脱敏",
  "/plastic-raw-material-demand": "原料生产需求开单、审核与明细汇总",
  "/plastic-raw-material-purchase-analysis": "原料库存/安全库存/生产需求与可购数量分析",
  "/plastic-raw-material-purchase-order": "原料采购开单、三级审核与进度跟踪",
  "/plastic-raw-material-purchase-progress": "原料采购整单/明细进度与欠数",
  "/plastic-raw-material-receipt": "原料入仓开单、审核入仓与采购订单调入",
  "/plastic-raw-material-stock-issue": "原料出库开单、三级审核与需求表调入",
  "/plastic-raw-material-stocktake": "原料盘点开单、盈亏计算与审核校准库存",
  "/plastic-raw-material-inventory": "原料实时库存、类别筛选与零库存口径",
  "/plastic-raw-material-monthly": "原料月度期初/出入库/盘点盈亏/期末报表",
  "/plastic-raw-material-demand-summary": "原料需求按单汇总与双击查看明细",
  "/plastic-raw-material-order-receipt-stats": "原料订货/入库/相关数量金额统计",
  // Batch 8 船务部 + 业务部 + 外发加工资料
  "/finished-receipts": "成品入仓开单、审核与入仓汇总/明细查询",
  "/finished-inventory": "成品实时库存与配件出入库流水",
  "/master/客户资料": "客户建档、编辑与删除维护",
  "/master/加工厂资料": "加工类别树与加工厂建档维护",
  "/master/供应商资料": "供应商类别树与供应商建档维护",
};

const approved = (审核?: string | null) => !!审核 && 审核 !== "" && 审核 !== "0";

// 卡片信息行:真实数据,加载失败静默不显示
interface CardInfo {
  icon: React.ReactNode;
  text: string;
  tone: "amber" | "red" | "neutral";
}
const TONE_CLASS: Record<CardInfo["tone"], string> = {
  amber: "text-[#d97706]",
  red: "text-[#dc2626]",
  neutral: "text-[#5f6b7d]",
};

export default function HomePage({
  dept,
  onNavigate,
}: {
  dept: string;
  onNavigate: (path: string) => void;
}) {
  const isAdmin = getUser() === "admin";
  // 生产通知单:待审核单据数(生产单列表前 100 行按 审核 字段统计,单据量小,最轻的方式)
  const pendingQuery = useQuery({
    queryKey: ["home-production-pending"],
    queryFn: async () => {
      const r = await productionApi.list(1, 100);
      return r.items.filter((h) => !approved(h.审核)).length;
    },
    staleTime: 60_000,
  });
  // 物料库存:负库存条数(库存接口全量数组客户端计数)
  const negativeQuery = useQuery({
    queryKey: ["home-inventory-negative"],
    queryFn: async () =>
      (await inventoryApi.list({})).filter((r) => (r.库存数量 ?? 0) < 0).length,
    staleTime: 60_000,
  });
  // 单据卡待审核数(补料/来料领料/采购订单/装配加工采购;同样前 100 行客户端计数,与生产通知单同口径)
  const usePendingCount = (key: string, fetcher: () => Promise<number>) =>
    useQuery({ queryKey: [key], queryFn: fetcher, staleTime: 60_000 });
  const pendingReplen = usePendingCount("home-pending-replenishments", async () =>
    (await replenishmentApi.list(1, 100)).items.filter((h) => !approved(h.审核)).length,
  );
  const pendingIssue = usePendingCount("home-pending-material-issues", async () =>
    (await materialIssueApi.list(1, 100)).items.filter((h) => !approved(h.审核)).length,
  );
  const pendingPo = usePendingCount("home-pending-purchase-orders", async () =>
    (await purchaseOrderApi.list(1, 100)).items.filter((h) => !approved(h.审核)).length,
  );
  const pendingAp = usePendingCount("home-pending-assembly-purchases", async () =>
    (await assemblyPurchaseOrderApi.list(1, 100)).items.filter((h) => !approved(h.审核)).length,
  );
  const PENDING_CARDS: Record<string, { isSuccess: boolean; data?: number }> = {
    "/replenishments": pendingReplen,
    "/material-issues": pendingIssue,
    "/purchase-orders": pendingPo,
    "/assembly-purchases": pendingAp,
  };

  function infoFor(path?: string): CardInfo | null {
    if (path === "/production" && pendingQuery.isSuccess) {
      const n = pendingQuery.data;
      return n > 0
        ? { icon: <ClipboardText className="h-4 w-4" />, text: `${n} 单待审核`, tone: "amber" }
        : { icon: <ClipboardText className="h-4 w-4" />, text: "无待审核单据", tone: "neutral" };
    }
    if (path === "/material-inventory" && negativeQuery.isSuccess) {
      const n = negativeQuery.data;
      return n > 0
        ? { icon: <WarningOctagon className="h-4 w-4" />, text: `${n} 条负库存`, tone: "red" }
        : { icon: <WarningOctagon className="h-4 w-4" />, text: "无负库存", tone: "neutral" };
    }
    const pc = path ? PENDING_CARDS[path] : undefined;
    if (pc?.isSuccess) {
      const n = pc.data ?? 0;
      return n > 0
        ? { icon: <ClipboardText className="h-4 w-4" />, text: `${n} 单待审核`, tone: "amber" }
        : { icon: <ClipboardText className="h-4 w-4" />, text: "无待审核单据", tone: "neutral" };
    }
    return null;
  }

  // 防御:过滤不到分组时回落为全部分组,绝不渲染无内容首页
  const filtered =
    dept === "all" ? MENU_TREE : MENU_TREE.filter((g) => g.key === dept);
  const groups = filtered.length > 0 ? filtered : MENU_TREE;

  return (
    <div className="f-page mx-auto max-w-7xl px-8 py-8">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#1a2330]">工作台</h1>
          <p className="mt-1.5 text-[15px] text-[#5f6b7d]">
            按部门选择功能,打开的页面会以标签形式保留在顶部。
          </p>
        </div>
        <span className="text-xs text-disabled">WebpageERP v0.1</span>
      </div>

      {groups.map((g) => {
        const Icon = g.icon;
        return (
          <section key={g.key} className="mt-8">
            <div className="flex items-center gap-2">
              <Icon className="h-5 w-5 text-[#15803d]" weight="duotone" />
              <h2 className="text-base font-semibold text-[#1a2330]">{g.label}</h2>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {g.children.map((leaf) => {
                const fpath = leaf.path;
                const desc = leaf.path ? DESCRIPTIONS[leaf.path] : undefined;
                const info = infoFor(leaf.path);
                // 账号权限管理仅管理员可用:非管理员置灰不可点
                const adminOnly = leaf.path === "/accounts" && !isAdmin;
                // http 开头 = 外部系统入口(RR-Portal),新标签打开、不走内部路由
                const external = fpath?.startsWith("http") ?? false;
                return fpath && !adminOnly ? (
                  <button
                    key={leaf.label + leaf.path}
                    type="button"
                    onClick={() =>
                      external
                        ? window.open(fpath, "_blank", "noopener,noreferrer")
                        : onNavigate(fpath)
                    }
                    className={cn(
                      "group flex flex-col gap-3 rounded-xl border border-[#e3eae4] bg-white p-4 text-left",
                      "shadow-[0_1px_2px_rgb(26_35_48/0.05)] transition-all",
                      "hover:-translate-y-0.5 hover:border-[#16a34a]/50 hover:shadow-[0_10px_24px_-12px_rgb(22_163_74/0.3)]",
                    )}
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#16a34a]/10 text-[#15803d] transition-colors group-hover:bg-[#16a34a]/15">
                      <Icon className="h-5 w-5" weight="duotone" />
                    </div>
                    <div className="min-h-10">
                      <div className="text-[15px] font-semibold text-[#1a2330]">
                        {leaf.label}
                      </div>
                      {desc && (
                        <div className="mt-1 text-[13px] leading-snug text-[#5f6b7d]">
                          {desc}
                        </div>
                      )}
                    </div>
                    {info && (
                      <div
                        className={cn(
                          "mt-auto flex items-center gap-1.5 border-t border-black/6 pt-2.5 text-[13px] font-semibold",
                          TONE_CLASS[info.tone],
                        )}
                      >
                        {info.icon}
                        {info.text}
                      </div>
                    )}
                  </button>
                ) : (
                  <div
                    key={leaf.label}
                    title={adminOnly ? "仅管理员可用" : "试点版本暂未开放"}
                    className="flex cursor-not-allowed flex-col gap-3 rounded-xl border border-black/6 bg-black/[0.02] p-4 select-none"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-black/6 text-disabled">
                      <Icon className="h-5 w-5" weight="duotone" />
                    </div>
                    <div className="min-h-10">
                      <div className="text-[15px] font-medium text-disabled">
                        {leaf.label}
                      </div>
                      <div className="mt-1">
                        <span className="rounded-full bg-black/6 px-2 py-0.5 text-[11px] text-disabled">
                          {adminOnly ? "仅管理员" : "未开放"}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
