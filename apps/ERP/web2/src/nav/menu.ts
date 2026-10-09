import {
  Archive,
  ArrowsClockwise,
  Blueprint,
  Boat,
  Briefcase,
  ClipboardText,
  Cube,
  Cylinder,
  Factory,
  GearSix,
  GlobeHemisphereEast,
  Invoice,
  Package,
  SealCheck,
  SprayBottle,
  Truck,
  Warehouse,
  type Icon,
} from "@phosphor-icons/react";

// 菜单树:分组与条目名参考老系统(老系统已退役,全部入口以本文件为准)。
// 分组顺序按业务流程:工程 → 业务 → 仓务(原料/来料/塑胶/外发加工/半成品) → 啤机 → 喷油 →
// 装配 → 船务 → 品质 → 其他(补料/PMC/印尼) → 基础设置。
// 条目均有 path 可点(账号权限管理对非管理员置灰);
// path 为 http 开头的完整 URL = 外部系统入口,点击新标签打开,不挂权限全员可见。
export interface MenuLeaf {
  label: string;
  path?: string;
}
export interface MenuGroup {
  key: string;
  label: string;
  icon: Icon;
  children: MenuLeaf[];
}

const M = (label: string, path?: string): MenuLeaf => ({ label, path });

// RR-Portal 门户(云服务器)上的外部系统入口;↗ 标记新标签打开
const PORTAL = "http://8.148.146.194";
const X = (label: string, urlPath: string): MenuLeaf => ({
  label: `${label}↗`,
  path: `${PORTAL}${urlPath}`,
});

export const MENU_TREE: MenuGroup[] = [
  {
    key: "g-eng",
    label: "工程部",
    icon: Blueprint,
    children: [
      M("款号总表", "/master/款号资料"),
      M("BOM货号查询", "/bom-style-query"),
      M("物料资料", "/material-master"),
      M("BOM物料设置", "/bom-setup"),
      M("BOM物料查询", "/bom-material-query"),
      M("BOM层级树", "/bom-tree"),
      // 外部系统(RR-Portal)
      X("工程啤办单", "/rr/"),
      X("模具手办采购订单", "/figure-mold-cost-system/"),
      X("A-doc生成系统", "/zouhuo/"),
    ],
  },
  {
    key: "g-biz",
    label: "业务部",
    icon: Briefcase,
    children: [
      M("客户排期表", "/scheduling"),
      M("客户资料", "/master/客户资料"),
      // 生产通知单/生产单跟踪表:业务员操作(原挂装配部组)
      M("生产通知单", "/production"),
      M("生产单跟踪表", "/production-tracking"),
      // 外部系统(RR-Portal)
      X("ZURU接单表入单系统", "/zuru-order-system/"),
      X("报价系统", "/baojia/"),
      X("内部报价系统", "/internal-quote/"),
      X("TOMY排期核对系统", "/tomy-paiqi/"),
    ],
  },
  // Batch 7 原料仓(对照老系统 menuTree g-raw:原料仓库小节 + 原料报表小节;
  // 菜单项「原料采购进度表」权限键=原料采购订单,老系统 menuTree.tsx:182 同)
  {
    key: "g-raw",
    label: "原料仓",
    icon: Package,
    children: [
      M("原料资料", "/plastic-raw-material-master"),
      M("原料生产需求表", "/plastic-raw-material-demand"),
      M("原料采购分析表", "/plastic-raw-material-purchase-analysis"),
      M("原料采购订单", "/plastic-raw-material-purchase-order"),
      M("原料采购进度表", "/plastic-raw-material-purchase-progress"),
      M("原料入仓单", "/plastic-raw-material-receipt"),
      M("原料出库表", "/plastic-raw-material-stock-issue"),
      M("原料盘点单", "/plastic-raw-material-stocktake"),
      M("原料库存统计表", "/plastic-raw-material-inventory"),
      M("原料库存月报表", "/plastic-raw-material-monthly"),
      M("原料生产需求汇总", "/plastic-raw-material-demand-summary"),
      M("原料订货入库统计", "/plastic-raw-material-order-receipt-stats"),
    ],
  },
  {
    key: "g-wh",
    label: "来料仓",
    icon: Warehouse,
    children: [
      // 采购管理(对照老系统 menuTree g-wh:分析/设置/BOM订单制作 在采购订单之前)
      M("采购物料分析", "/purchase-material-analysis"),
      M("采购物料设置", "/purchase-material-settings"),
      M("BOM订单制作", "/material-order-make"),
      M("采购订单", "/purchase-orders"),
      M("采购订单进度表", "/order-progress"),
      M("来料标签单", "/material-label-orders"),
      M("采购入仓单", "/purchase-receipts"),
      M("来料领料单", "/material-issues"),
      M("采购退仓单", "/purchase-returns"),
      M("退料单", "/material-returns"),
      M("报废单", "/material-scraps"),
      M("库存统计表", "/material-inventory"),
      M("个人库存金额表", "/personal-inventory"),
      M("库存月报表", "/month-end"),
      M("订购单查询", "/purchase-order-query"),
    ],
  },
  {
    key: "g-plastic",
    label: "塑胶仓",
    icon: Cube,
    children: [
      // 分组与小节顺序对照老系统 web/src/nav/menuTree.tsx g-plastic(塑胶采购/塑胶仓库/塑胶报表)
      M("塑胶采购分析", "/plastic-material-analysis"),
      M("塑胶物料设置", "/plastic-material-settings"),
      M("塑胶采购订单", "/plastic-purchase-orders"),
      M("塑胶订单进度表", "/plastic-purchase-progress"),
      M("塑胶物料资料", "/plastic-material-master"),
      M("塑胶共用物料表", "/plastic-common-materials"),
      M("塑胶入仓单", "/plastic-receipts"),
      M("塑胶退仓单", "/plastic-warehouse-returns"),
      M("塑胶领料单", "/plastic-issues"),
      M("塑胶报废单", "/plastic-scraps"),
      M("塑胶库存统计表", "/plastic-inventory"),
      M("塑胶库存月报表", "/plastic-monthly-report"),
      M("塑胶类型客户统计", "/plastic-customer-type-stats"),
    ],
  },
  // 外发加工(对照老系统 menuTree g-outsource;加工厂资料归 Batch 8)
  {
    key: "g-outsource",
    label: "外发加工",
    icon: Truck,
    children: [
      M("加工厂资料", "/master/加工厂资料"),
      M("塑胶加工采购订单", "/plastic-process-purchase-orders"),
      M("白件领料单", "/plastic-white-part-issue"),
      M("加工入仓单", "/plastic-receipts"),
    ],
  },
  {
    key: "g-semi",
    label: "半成品仓",
    icon: Archive,
    // 分组与条目对照老系统 web/src/nav/menuTree.tsx g-semi(出仓单=领料单仓侧别名入口)
    children: [
      M("半成品共用物料表", "/semi-finished-common-materials"),
      M("半成品标签单", "/semi-finished-label-orders"),
      M("半成品入仓单", "/semi-receipts"),
      M("半成品出库单", "/semi-issues"),
      M("半成品出仓单", "/semi-outbound"),
      M("半成品报废单", "/semi-scraps"),
      M("半成品盘点单", "/semi-stocktakes"),
      M("半成品库存统计表", "/semi-inventory"),
      M("半成品库存月报表", "/semi-inventory-monthly"),
    ],
  },
  // 啤机部(流程:PMC下采购单→原料仓领料→白件入塑胶仓;外发啤由PMC/塑胶仓另外下加工订单)
  {
    key: "g-inj",
    label: "啤机部",
    icon: Cylinder,
    children: [
      // 厂内啤机
      M("原料领料单", "/plastic-raw-material-stock-issue"),
      M("白件入仓单", "/plastic-receipts"),
      // 外部系统(RR-Portal)
      X("注塑啤机排产系统", "/paiji/"),
      X("啤机外发系统", "/pi-outsource/"),
    ],
  },
  // 喷油部(复用加工订单/白件领料/塑胶入仓;对照老系统 menuTree g-spray)
  {
    key: "g-spray",
    label: "喷油部",
    icon: SprayBottle,
    children: [
      M("喷油加工订单", "/plastic-process-order-make"),
      M("喷油领料单", "/plastic-white-part-issue"),
      M("喷油件入仓单", "/plastic-receipts"),
      // 外部系统(RR-Portal)
      X("喷油排产系统(建设中)", "/sprayplan"),
      X("喷油部生产管理", "/penyou/"),
    ],
  },
  {
    key: "g-prod",
    label: "装配部(生产部)",
    icon: Factory,
    children: [
      // BOM物料设置别名入口(实际页在工程部组,权限键=款号资料)
      M("BOM物料设置", "/bom-setup"),
      // 生产通知单/生产单跟踪表已挪业务部组(业务员操作)
      M("货号接单汇总表", "/order-summary"),
      // 来料领料单别名入口(对照船务部「领料出库」挂法;实际页在来料仓组)
      M("来料领料单", "/material-issues"),
      M("塑胶领料单(塑胶仓)", "/plastic-issues"),
      M("装配物料设置", "/assembly-material-setup"),
      M("装配物料汇总表", "/assembly-material-summary"),
      M("委托加工单", "/assembly-purchases"),
      M("装配采购查询", "/assembly-purchase-query"),
      M("装配采购进度表", "/assembly-purchase-progress"),
      M("装配物料跟踪表", "/assembly-material-tracking"),
      M("加工厂库存汇总表", "/assembly-factory-inventory"),
      M("装配需领明细表", "/assembly-required-material-detail"),
      M("加工厂分类月报表", "/assembly-factory-category-monthly"),
      M("加工厂分类明细表", "/assembly-factory-category-detail"),
      // 外部系统(RR-Portal)
      X("生产计划排拉系统", "/production-plan/"),
    ],
  },
  {
    key: "g-ship",
    label: "船务部",
    icon: Boat,
    children: [
      M("成品入仓单", "/finished-receipts"),
      // 领料出库=来料领料单别名入口(对照老系统 menuTree g-ship:/materials/material-issues;
      // 装配部开领料单(仓库=成品仓),成品仓在这里审核=出库过账)
      M("领料出库", "/material-issues"),
      M("成品库存", "/finished-inventory"),
      // 外部系统(RR-Portal)
      X("船务管理系统", "/shipping/"),
    ],
  },
  // 品质部(全部为 RR-Portal 外部系统入口)
  {
    key: "g-qa",
    label: "品质部",
    icon: SealCheck,
    children: [
      X("QA测试报告周结", "/qa-weekly-report/"),
      X("QC成品报告系统", "/qc-report/"),
      X("品质管理系统(QMS)", "/qc/"),
    ],
  },
  // 打发票(发票功能待建,先挂组占位,有入口后补 children)
  {
    key: "g-invoice",
    label: "打发票",
    icon: Invoice,
    children: [],
  },
  {
    key: "g-replen",
    label: "补料区",
    icon: ArrowsClockwise,
    children: [M("补料单", "/replenishments")],
  },
  // 加工厂(外部系统入口)
  {
    key: "g-pmc",
    label: "加工厂",
    icon: ClipboardText,
    children: [X("加工厂月度评审", "/factory-review/")],
  },
  // 印尼小组(外部系统入口)
  {
    key: "g-indo",
    label: "印尼小组",
    icon: GlobeHemisphereEast,
    children: [X("印尼走货明细(印尼专用)", "/indo-shipping/")],
  },
  // 基础设置:分组与条目顺序对照老系统 web/src/nav/menuTree.tsx g-base
  // (用户权限与系统用户同页,合并为一个入口;消息中心为 web2 新增,列组尾)
  {
    key: "g-base",
    label: "基础设置",
    icon: GearSix,
    children: [
      M("物料快速建档", "/material-create"),
      M("基本资料", "/system/company-profile"),
      M("功能设置", "/system/feature-settings"),
      M("仓库位置设置", "/system/warehouse-locations"),
      M("备份数据", "/system/backup"),
      M("还原数据", "/system/restore"),
      M("塑胶原料资料表", "/plastic-raw-material-master"),
      M("啤机机型啤工表", "/system/injection-machine-rates"),
      M("供应商资料", "/master/供应商资料"),
      M("部门人事", "/hr/department-personnel"),
      M("系统用户", "/accounts"),
      M("在线人员", "/online-users"),
      M("用户修改密码", "/change-password"),
      M("网上升级", "/system/upgrade"),
      M("退出软件", "/logout"),
      M("消息中心", "/messages"),
    ],
  },
];

// 已落地页面的路径集合(内部路由叶子,与 layout/MainLayout.tsx PAGES 同步维护;
// http 开头的外部系统入口不算内部路由,不收录)。
// 跨页跳转前判断目标是否已注册:未注册不跳(否则落入未注册路由渲染宫格首页,
// keep-alive 下本页的成功 toast 不可见、新单号丢失)。
export const MENU_PATHS: ReadonlySet<string> = new Set(
  MENU_TREE.flatMap((g) => g.children.map((c) => c.path)).filter(
    (p): p is string => !!p && p.startsWith("/"),
  ),
);
