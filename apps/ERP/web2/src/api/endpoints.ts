import { api, ApiError, qs } from "@/lib/api";
import { clearToken, getToken } from "@/lib/auth";
import type {
  AccountRow,
  AssemblyFactoryCategoryMonthlyRow,
  AssemblyFactoryInventoryRow,
  AssemblyIssueView,
  AssemblyMaterialSummaryParams,
  AssemblyMaterialSummaryResult,
  AssemblyMaterialTrackingRow,
  AssemblyPurchaseDetailRow,
  AssemblyPurchaseOrderDetail,
  AssemblyPurchaseOrderHeaderRow,
  AssemblyPurchaseOrderSave,
  AssemblyPurchaseSummaryRow,
  AssemblyRequiredMaterialRow,
  BomHeaderOption,
  BomMaterialRow,
  BomSave,
  BomStyleRow,
  BomTreeResult,
  CustomerRow,
  DocQueryParams,
  EmployeeRow,
  FactoryCategoryDetailParams,
  FactoryCategoryDetailRow,
  FactoryCategoryNode,
  FactoryRow,
  FinishedStockLedgerRow,
  FinishedStockRow,
  FRCreate,
  FRDetail,
  FRHeader,
  FRQDetailRow,
  FRQSummaryRow,
  ImageNote,
  ImportResult,
  IssueBasisRow,
  LoginResult,
  MasterMaterialRow,
  MasterRow,
  MaterialCategoryNode,
  MaterialIssueCreate,
  MaterialIssueDetail,
  MaterialIssueHeader,
  MaterialIssueOutboundLine,
  MaterialIssueOutboundResult,
  MaterialIssueQueryDetailRow,
  MaterialIssueSummaryRow,
  MaterialLabelDetailRow,
  MaterialLabelMaterialRow,
  MaterialLabelOrder,
  MaterialLabelOrderListRow,
  MaterialLabelOrderSave,
  MaterialLabelSummaryRow,
  MaterialStockRow,
  PersonalInventoryBatchRow,
  MenuPermRow,
  MessageRow,
  MoLine,
  MonthEndCloseResult,
  MonthEndRow,
  MyPermMap,
  OrderQueryParams,
  OrderSummaryRow,
  Paged,
  PlasticIssueCreate,
  PlasticIssueDetail,
  PlasticIssueHeader,
  PlasticIssueQueryDetailRow,
  PlasticIssueQuerySummaryRow,
  PlasticCommonMaterialRow,
  PlasticCommonQuery,
  PlasticCustomerTypeStatRow,
  PlasticMaterialCategoryNode,
  PlasticMaterialSettingRow,
  PlasticMaterialSettingSave,
  PlasticMonthlyReportRow,
  PlasticMoldRow,
  PlasticOrderRow,
  PlasticProcessDemandCreateResult,
  PlasticProcessDemandOrderLine,
  PlasticProcessDemandRow,
  PlasticProcessPurchaseOrderCreate,
  PlasticPurchaseOrderBasisRow,
  PlasticPurchaseOrderDetail,
  PlasticPurchaseOrderHeader,
  PlasticPurchaseOrderSave,
  PlasticPurchaseProgressRow,
  PlasticReceiptCreate,
  PlasticReceiptDetail,
  PlasticReceiptHeader,
  PlasticReceiptQueryDetailRow,
  PlasticReceiptQuerySummaryRow,
  PlasticMaterialRow,
  PlasticMaterialSettingLookup,
  PlasticScrapQueryDetailRow,
  PlasticScrapQuerySummaryRow,
  PlasticStockRow,
  PlasticWhReturnQueryDetailRow,
  PlasticWhReturnQuerySummaryRow,
  SecondProcessStockRow,
  PoBindingDto,
  ProductionDetail,
  ProductionHeader,
  ProductionNoticeCreate,
  ProductionTrackingRow,
  PurchaseOrderBasisRow,
  PurchaseOrderCreate,
  PurchaseOrderDetail,
  PurchaseOrderHeader,
  PurchaseOrderProgressRow,
  PurchaseOrderQueryDetailRow,
  PurchaseOrderQuerySummaryRow,
  PurchaseReceiptCreate,
  PurchaseReceiptDetail,
  PurchaseReceiptHeader,
  PurchaseReturnCreate,
  PurchaseReturnDetail,
  PurchaseReturnHeader,
  ReceiptQueryDetailRow,
  ReceiptQuerySummaryRow,
  ReplenishmentCreate,
  ReplenishmentDetail,
  ReplenishmentHeader,
  ReturnQueryDetailRow,
  ReturnQuerySummaryRow,
  ScheduleBatch,
  ScheduleFile,
  ScheduleImportResult,
  ScheduleListParams,
  ScheduleRow,
  ScheduleRowSave,
  ScheduleStatusChange,
  ScheduleSummary,
  SemiCommonMaterialQuery,
  SemiCommonMaterialRow,
  SemiInvReportQuery,
  SemiInvReportRow,
  SemiIssueDetailRow,
  SemiIssueSummaryRow,
  SemiLabelDetailRow,
  SemiLabelOrder,
  SemiLabelOrderListRow,
  SemiLabelOrderSave,
  SemiLabelSummaryRow,
  SemiMonthlyRow,
  SemiMonthlyQuery,
  SemiOption,
  SemiProductQuery,
  SemiProductRow,
  SemiQueryParams,
  SemiReceiptDetailRow,
  SemiReceiptSummaryRow,
  SemiScrapDetailRow,
  SemiScrapSummaryRow,
  SemiSetupDef,
  SemiSetupSave,
  SemiStkQueryDetailRow,
  SemiStkQuerySummaryRow,
  SemiStockRow,
  SICreate,
  SIDetail,
  SIHeader,
  SRCreate,
  SRDetail,
  SRHeader,
  SRKitResult,
  SSDocDetail,
  SSDocHeader,
  STKBasisRow,
  STKCreate,
  STKDetail,
  STKHeader,
  StyleListItem,
  StyleMaterialsView,
  SupplierRow,
  UsageDocDetail,
  UsageDocHeader,
  UsageDocQueryDetailRow,
  UsageDocQuerySummaryRow,
  WarehouseLocationOption,
  WarehouseLocationRow,
  InjectionMachineRateRow,
  SettingItem,
  VersionInfo,
  BackupResult,
  PPPODetail,
  PPPOHeader,
  PPPOBasisRow,
  PlasticProcessOrderMakeRow,
  SprayOrderReceivedRow,
  WPIDetail,
  WPIHeader,
  WPIBasisRow,
  PurchaseAnalysisRow,
  PurchaseAnalysisSave,
  OrderWorksheetRow,
  PurchaseMaterialSettingRow,
  PurchaseMaterialSettingSave,
  PlasticRawMaterialCategoryNode,
  PlasticRawMaterialRow,
  RawMaterialInventoryRow,
  RawMaterialMonthlyRow,
  RawPurchaseAnalysisRow,
  RMDDetail,
  RMDHeader,
  RMDSummaryRow,
  RMPODetail,
  RMPOHeader,
  RawPurchaseProgressRow,
  RMRDetail,
  RMRHeader,
  RawReceiptQueryDetailRow,
  RawReceiptQuerySummaryRow,
  RSIDetail,
  RSIHeader,
  RawStockIssueQueryDetailRow,
  RawStockIssueQuerySummaryRow,
  RSTDetail,
  RSTHeader,
  RawStocktakeQueryDetailRow,
  RawStocktakeQuerySummaryRow,
  RawOrderReceiptStatRow,
} from "./types";

export const authApi = {
  login: (用户: string, 密码: string) =>
    api<LoginResult>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ 用户, 密码 }),
    }),
  // 当前用户权限(直读 userbqrpower,含 MenuCatalog 未收录菜单;旧系统同端点)
  myPermissions: () => api<MyPermMap>("/auth/me/permissions"),
  // 在线心跳:60s 一次,活动=true 表示最近 10 分钟内有鼠标/键盘操作(在线状态三色判定见 /online-users)
  heartbeat: (活动: boolean) =>
    api<{ 消息?: string }>("/auth/heartbeat", {
      method: "POST",
      body: JSON.stringify({ 活动 }),
    }),
  // 退出登录:后端立即置离线,随后前端清本地 token
  logout: () => api<{ 消息?: string }>("/auth/logout", { method: "POST" }),
  // 用户修改密码(照抄老系统 web/src/api/auth.ts changePassword)
  changePassword: (原密码: string, 新密码: string) =>
    api<{ 消息?: string }>("/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ 原密码, 新密码 }),
    }),
};

const enc = encodeURIComponent;

export const productionApi = {
  list: (page = 1, size = 20, keyword?: string) =>
    api<Paged<ProductionHeader>>(`/production${qs({ page, size, keyword })}`),
  get: (生产单号: string) =>
    api<ProductionDetail>(`/production/${enc(生产单号)}`),
  create: (body: ProductionNoticeCreate) =>
    api<{ 生产单号: string }>("/production", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  // 采购分析审核(采购物料分析页):前置=生产通知单已审核;审过才能来料下采购订单
  purchaseAnalysisAudit: (生产单号: string) =>
    api<void>(`/production/${enc(生产单号)}/purchase-analysis-audit`, { method: "POST" }),
  // 采购分析反审核(与采购订单同规则:可审可反;反审后回到未审核)
  purchaseAnalysisUnaudit: (生产单号: string) =>
    api<void>(`/production/${enc(生产单号)}/purchase-analysis-unaudit`, { method: "POST" }),
  // 表头修改(仅未审核可改):货号明细/工序/BOM 不在此更新(货号明细 传 [])
  update: (生产单号: string, body: ProductionNoticeCreate) =>
    api<void>(`/production/${enc(生产单号)}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  remove: (生产单号: string) =>
    api<void>(`/production/${enc(生产单号)}`, { method: "DELETE" }),
  approve: (生产单号: string) =>
    api<void>(`/production/${enc(生产单号)}/approve`, { method: "POST" }),
  // 反审核申请-审批流:申请(必填原因) → 经理在消息中心 同意/拒绝
  requestUnapprove: (生产单号: string, 原因: string, 含BOM: boolean) =>
    api<void>(`/production/${enc(生产单号)}/unapprove-request`, {
      method: "POST",
      body: JSON.stringify({ 原因, 含BOM }),
    }),
  // 经理批准/拒绝反审核申请(消息中心操作;URL 照抄老系统 web/src/api/production.ts,无载荷)
  approveUnapproveRequest: (生产单号: string) =>
    api<void>(`/production/${enc(生产单号)}/unapprove-request/approve`, { method: "POST" }),
  rejectUnapproveRequest: (生产单号: string) =>
    api<void>(`/production/${enc(生产单号)}/unapprove-request/reject`, { method: "POST" }),
  // 应领明细(按生产单带入;来料/塑胶=应领(接单数×BOM用量),半成品/成品=对应仓现存净额)
  // 按货号=true 时按货号分组口径返回(批量领料挑选用);档省略=全部(一键启动算料用)。照抄 web/src/api/production.ts
  issueBasis: (生产单号: string, 档?: "来料" | "塑胶" | "半成品" | "成品", 按货号?: boolean) =>
    api<IssueBasisRow[]>(`/production/${enc(生产单号)}/issue-basis${qs({ 档, 按货号 })}`),
  // MO单跟踪(生产通知单 MO单录入页签;照抄老系统 productionApi.getMo/saveMo)
  getMo: (生产单号: string) => api<MoLine[]>(`/production/${enc(生产单号)}/mo`),
  saveMo: (生产单号: string, lines: MoLine[]) =>
    api<void>(`/production/${enc(生产单号)}/mo`, {
      method: "PUT",
      body: JSON.stringify(lines),
    }),
};

// ---------- 采购订单(来料仓;URL/中文字段照抄老系统 web/src/api/purchaseOrders.ts) ----------

// 后端按 camelCase 序列化为 id,这里归一化为 ID(与全项目调用方一致)
const withId = <T extends { ID?: number }>(x: T): T => ({
  ...x,
  ID: (x as unknown as { id?: number }).id ?? x.ID,
});

export const purchaseOrderApi = {
  basis: (生产单号: string) =>
    api<PurchaseOrderBasisRow[]>(`/purchase-orders/basis${qs({ 生产单号 })}`),
  list: (page = 1, size = 20, keyword = "") =>
    api<Paged<PurchaseOrderHeader>>(`/purchase-orders${qs({ page, size, keyword })}`).then(
      (r) => ({ ...r, items: r.items.map(withId) }),
    ),
  get: (单号: string) =>
    api<PurchaseOrderDetail>(`/purchase-orders/${enc(单号)}`).then((r) => ({
      ...r,
      单头: r.单头 ? withId(r.单头) : r.单头,
      // 明细兜底空数组防止 null.map 抛错被误认为加载失败
      明细: (r.明细 ?? []).map(withId),
    })),
  create: (body: PurchaseOrderCreate) =>
    api<{ 单号: string }>("/purchase-orders", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  update: (单号: string, body: PurchaseOrderCreate) =>
    api<void>(`/purchase-orders/${enc(单号)}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  // 打印:先登记打印次数,再取最新详情按「採購單」格式打印
  print: (单号: string) =>
    api<{ 打印次数: number }>(`/purchase-orders/${enc(单号)}/print`, { method: "POST" }),
  remove: (单号: string) =>
    api<void>(`/purchase-orders/${enc(单号)}`, { method: "DELETE" }),
  supervisorApprove: (单号: string) =>
    api<void>(`/purchase-orders/${enc(单号)}/supervisor-approve`, { method: "POST" }),
  managerApprove: (单号: string) =>
    api<void>(`/purchase-orders/${enc(单号)}/manager-approve`, { method: "POST" }),
  approve: (单号: string) =>
    api<void>(`/purchase-orders/${enc(单号)}/approve`, { method: "POST" }),
  unapprove: (单号: string) =>
    api<void>(`/purchase-orders/${enc(单号)}/unapprove`, { method: "POST" }),
  // 订单进度欠数行(入仓/退仓「选订单」「整单带入」数据源;onlyOwed=仅列有欠数的行)
  // 采购订单进度表(/order-progress)也用,带 起/止 订货日期区间(对照老系统 OrderProgressPage)
  progress: (q: { 供应商?: string; keyword?: string; onlyOwed?: boolean; 起?: string; 止?: string }) =>
    api<PurchaseOrderProgressRow[]>(`/purchase-orders/progress${qs(q)}`),
  // 订购单查询·明细(价格按「单价」权限后端脱敏置 null;对照老系统 PurchaseOrderQueryPage)
  orderQueryDetail: (q: OrderQueryParams) =>
    api<PurchaseOrderQueryDetailRow[]>(`/purchase-orders/order-query/detail${qs({ ...q })}`),
  // 订购单查询·汇总(按 物料编号+规格+颜色 合并 订购数量;无价格列)
  orderQuerySummary: (q: OrderQueryParams) =>
    api<PurchaseOrderQuerySummaryRow[]>(`/purchase-orders/order-query/summary${qs({ ...q })}`),
};

// ---------- 采购入仓单(来料仓;审核=入库存。URL/中文字段照抄老系统 materialDocs.ts + purchaseReceiptQuery.ts) ----------

export const purchaseReceiptApi = {
  list: (page = 1, size = 20, keyword = "") =>
    api<Paged<PurchaseReceiptHeader>>(`/purchase-receipts${qs({ page, size, keyword })}`).then(
      (r) => ({ ...r, items: r.items.map(withId) }),
    ),
  get: (单号: string) =>
    api<PurchaseReceiptDetail>(`/purchase-receipts/${enc(单号)}`).then((r) => ({
      ...r,
      单头: r.单头 ? withId(r.单头) : r.单头,
      明细: (r.明细 ?? []).map(withId),
    })),
  create: (body: PurchaseReceiptCreate) =>
    api<{ 单号: string }>("/purchase-receipts", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  remove: (单号: string) =>
    api<void>(`/purchase-receipts/${enc(单号)}`, { method: "DELETE" }),
  approve: (单号: string) =>
    api<void>(`/purchase-receipts/${enc(单号)}/approve`, { method: "POST" }),
  unapprove: (单号: string) =>
    api<void>(`/purchase-receipts/${enc(单号)}/unapprove`, { method: "POST" }),
  // 采购入仓查询(明细/汇总;无价格列)
  queryDetail: (q: DocQueryParams) =>
    api<ReceiptQueryDetailRow[]>(`/purchase-receipts/receipt-query/detail${qs({ ...q })}`),
  querySummary: (q: DocQueryParams) =>
    api<ReceiptQuerySummaryRow[]>(`/purchase-receipts/receipt-query/summary${qs({ ...q })}`),
};

// ---------- 采购退仓单(= 退回供应商,审核即扣库存;旧名「采购出仓单」已迁移,菜单权限用新名) ----------

export const purchaseReturnApi = {
  list: (page = 1, size = 20, keyword = "") =>
    api<Paged<PurchaseReturnHeader>>(`/purchase-returns${qs({ page, size, keyword })}`).then(
      (r) => ({ ...r, items: r.items.map(withId) }),
    ),
  get: (单号: string) =>
    api<PurchaseReturnDetail>(`/purchase-returns/${enc(单号)}`).then((r) => ({
      ...r,
      单头: r.单头 ? withId(r.单头) : r.单头,
      明细: (r.明细 ?? []).map(withId),
    })),
  create: (body: PurchaseReturnCreate) =>
    api<{ 单号: string }>("/purchase-returns", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  remove: (单号: string) =>
    api<void>(`/purchase-returns/${enc(单号)}`, { method: "DELETE" }),
  approve: (单号: string) =>
    api<void>(`/purchase-returns/${enc(单号)}/approve`, { method: "POST" }),
  unapprove: (单号: string) =>
    api<void>(`/purchase-returns/${enc(单号)}/unapprove`, { method: "POST" }),
  // 采购退仓查询(明细/汇总;汇总按 物料编号+规格+颜色 合并出仓数量)
  queryDetail: (q: DocQueryParams) =>
    api<ReturnQueryDetailRow[]>(`/purchase-returns/return-query/detail${qs({ ...q })}`),
  querySummary: (q: DocQueryParams) =>
    api<ReturnQuerySummaryRow[]>(`/purchase-returns/return-query/summary${qs({ ...q })}`),
};

// ---------- 塑胶入仓单(塑胶仓;单级审核=入库存。URL/中文字段照抄老系统 plasticSupplierDoc.ts("plastic-receipts")) ----------

export const plasticReceiptApi = {
  list: (page = 1, size = 20, keyword = "", onlyUnapproved = false) =>
    api<Paged<PlasticReceiptHeader>>(`/plastic-receipts${qs({ page, size, keyword, onlyUnapproved: onlyUnapproved || undefined })}`).then(
      (r) => ({ ...r, items: r.items.map(withId) }),
    ),
  get: (单号: string) =>
    api<PlasticReceiptDetail>(`/plastic-receipts/${enc(单号)}`).then((r) => ({
      ...r,
      单头: r.单头 ? withId(r.单头) : r.单头,
      明细: (r.明细 ?? []).map(withId),
    })),
  create: (body: PlasticReceiptCreate) =>
    api<{ 单号: string }>("/plastic-receipts", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  remove: (单号: string) =>
    api<void>(`/plastic-receipts/${enc(单号)}`, { method: "DELETE" }),
  // 审核=入库存;可能返回 {提示,警告}(如已生成目标仓入仓单/排产推送失败),无则 204
  approve: (单号: string) =>
    api<{ 提示?: string; 警告?: string } | undefined>(`/plastic-receipts/${enc(单号)}/approve`, {
      method: "POST",
    }),
  unapprove: (单号: string) =>
    api<{ 警告?: string } | undefined>(`/plastic-receipts/${enc(单号)}/unapprove`, {
      method: "POST",
    }),
  // 塑胶入仓查询(明细/汇总;权限菜单为「塑胶入仓查询」,无单价位时后端置 null)
  queryDetail: (q: DocQueryParams) =>
    api<PlasticReceiptQueryDetailRow[]>(`/plastic-receipt-query/detail${qs({ ...q })}`),
  querySummary: (q: DocQueryParams) =>
    api<PlasticReceiptQuerySummaryRow[]>(`/plastic-receipt-query/summary${qs({ ...q })}`),
};

// 塑胶采购订单进度欠数行(塑胶入仓单「从采购单带入」数据源;onlyOwed=仅列有欠数的行)
export const plasticPurchaseProgressApi = {
  list: (p: { 供应商?: string; 起?: string; 止?: string; keyword?: string; onlyOwed?: boolean }) =>
    api<PlasticPurchaseProgressRow[]>(`/plastic-purchase-progress${qs(p)}`),
};

// 塑胶采购订单(塑胶仓;三级流转:主管审核 -> 经理审核 -> 审核=下发排产/喷油。
// URL/中文字段照抄老系统 web/src/api/plasticPurchaseOrder.ts)
export const plasticPurchaseOrderApi = {
  list: (page = 1, size = 10, keyword = "") =>
    api<Paged<PlasticPurchaseOrderHeader>>(`/plastic-purchase-orders${qs({ page, size, keyword })}`).then(
      (r) => ({ ...r, items: r.items.map(withId) }),
    ),
  // 塑胶采购分析 basis(塑胶共用物料表 BOM 预填;数量默认=计划数量×用量)
  basis: (生产单号: string) =>
    api<PlasticPurchaseOrderBasisRow[]>(`/plastic-purchase-orders/basis${qs({ 生产单号 })}`),
  // 单头「加工内容」下拉选项(塑胶物料资料/共用物料表去重)
  processingContents: () => api<string[]>("/plastic-purchase-orders/processing-contents"),
  // 可加工库存:阶段=一次加工 → 啤机单(无加工内容)入仓产出;阶段=二次加工 → 一次加工(有加工内容)入仓产出
  secondProcessStock: (keyword = "", 阶段 = "二次加工") =>
    api<SecondProcessStockRow[]>(`/plastic-purchase-orders/second-process-stock${qs({ keyword, 阶段 })}`),
  get: (单号: string) =>
    api<PlasticPurchaseOrderDetail>(`/plastic-purchase-orders/${enc(单号)}`).then((r) => ({
      ...r,
      单头: r.单头 ? withId(r.单头) : r.单头,
      明细: (r.明细 ?? []).map(withId),
    })),
  create: (body: PlasticPurchaseOrderSave) =>
    api<{ 单号: string }>("/plastic-purchase-orders", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  // 未审核单整单更新(已审核只读)
  update: (单号: string, body: PlasticPurchaseOrderSave) =>
    api<void>(`/plastic-purchase-orders/${enc(单号)}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  remove: (单号: string) =>
    api<void>(`/plastic-purchase-orders/${enc(单号)}`, { method: "DELETE" }),
  // 三级流转接口;审核可能返回 {警告}(排产推送失败)
  supervisorApprove: (单号: string) =>
    api<{ 警告?: string } | undefined>(`/plastic-purchase-orders/${enc(单号)}/supervisor-approve`, {
      method: "POST",
    }),
  managerApprove: (单号: string) =>
    api<{ 警告?: string } | undefined>(`/plastic-purchase-orders/${enc(单号)}/manager-approve`, {
      method: "POST",
    }),
  approve: (单号: string) =>
    api<{ 警告?: string } | undefined>(`/plastic-purchase-orders/${enc(单号)}/approve`, {
      method: "POST",
    }),
  unapprove: (单号: string) =>
    api<{ 警告?: string } | undefined>(`/plastic-purchase-orders/${enc(单号)}/unapprove`, {
      method: "POST",
    }),
};

// 仓库位置设置(权限菜单「仓库位置设置」,MenuCatalog.cs:101 实证:系统管理组;CRUD 照抄老系统 systemMasters.ts)
export const warehouseLocationApi = {
  list: (page = 1, size = 10, keyword = "") =>
    api<Paged<WarehouseLocationRow>>(`/master/warehouse-locations${qs({ page, size, keyword })}`),
  // 单据表头「仓库」下拉选项(登录即可,不限 仓库位置设置 权限)
  options: () => api<WarehouseLocationOption[]>("/master/warehouse-locations/options"),
  create: (body: Omit<WarehouseLocationRow, "id">) =>
    api<WarehouseLocationRow>("/master/warehouse-locations", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  update: (id: number, body: Omit<WarehouseLocationRow, "id">) =>
    api<void>(`/master/warehouse-locations/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  remove: (id: number) => api<void>(`/master/warehouse-locations/${id}`, { method: "DELETE" }),
};

// 啤机机型啤工表(权限菜单「啤机机型啤工表」,MenuCatalog.cs:102 实证:系统管理组)
export const injectionMachineRateApi = {
  list: (page = 1, size = 10, keyword = "") =>
    api<Paged<InjectionMachineRateRow>>(`/master/injection-machine-rates${qs({ page, size, keyword })}`),
  create: (body: Omit<InjectionMachineRateRow, "id">) =>
    api<InjectionMachineRateRow>("/master/injection-machine-rates", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  update: (id: number, body: Omit<InjectionMachineRateRow, "id">) =>
    api<void>(`/master/injection-machine-rates/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  remove: (id: number) => api<void>(`/master/injection-machine-rates/${id}`, { method: "DELETE" }),
};

// ---------- 塑胶领料单(塑胶仓;三级流转:主管审核 -> 经理审核 -> 审核=出库。URL/中文字段照抄老系统 plasticIssue.ts + plasticIssueQuery.ts) ----------

export const plasticIssueApi = {
  list: (page = 1, size = 20, keyword = "") =>
    api<Paged<PlasticIssueHeader>>(`/plastic-issues${qs({ page, size, keyword })}`).then(
      (r) => ({ ...r, items: r.items.map(withId) }),
    ),
  get: (单号: string) =>
    api<PlasticIssueDetail>(`/plastic-issues/${enc(单号)}`).then((r) => ({
      ...r,
      单头: r.单头 ? withId(r.单头) : r.单头,
      明细: (r.明细 ?? []).map(withId),
    })),
  create: (body: PlasticIssueCreate) =>
    api<{ 单号: string }>("/plastic-issues", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  remove: (单号: string) =>
    api<void>(`/plastic-issues/${enc(单号)}`, { method: "DELETE" }),
  supervisorApprove: (单号: string) =>
    api<void>(`/plastic-issues/${enc(单号)}/supervisor-approve`, { method: "POST" }),
  managerApprove: (单号: string) =>
    api<void>(`/plastic-issues/${enc(单号)}/manager-approve`, { method: "POST" }),
  // 审核=塑胶仓出库(扣库存)
  approve: (单号: string) =>
    api<void>(`/plastic-issues/${enc(单号)}/approve`, { method: "POST" }),
  unapprove: (单号: string) =>
    api<void>(`/plastic-issues/${enc(单号)}/unapprove`, { method: "POST" }),
  // 塑胶领料查询(明细/汇总;权限菜单为「塑胶领料查询」,无单价位时后端置 null)
  queryDetail: (q: DocQueryParams) =>
    api<PlasticIssueQueryDetailRow[]>(`/plastic-issue-query/detail${qs({ ...q })}`),
  querySummary: (q: DocQueryParams) =>
    api<PlasticIssueQuerySummaryRow[]>(`/plastic-issue-query/summary${qs({ ...q })}`),
};

// ---------- 来料领料单(来料仓;三级流转:主管审核 -> 经理审核 -> 审核=出库。URL/中文字段照抄老系统 materialDocs.ts("material-issues") + materialIssueQuery.ts) ----------

export const materialIssueApi = {
  list: (page = 1, size = 20, keyword = "") =>
    api<Paged<MaterialIssueHeader>>(`/material-issues${qs({ page, size, keyword })}`).then(
      (r) => ({ ...r, items: r.items.map(withId) }),
    ),
  get: (单号: string) =>
    api<MaterialIssueDetail>(`/material-issues/${enc(单号)}`).then((r) => ({
      ...r,
      单头: r.单头 ? withId(r.单头) : r.单头,
      明细: (r.明细 ?? []).map(withId),
    })),
  create: (body: MaterialIssueCreate) =>
    api<{ 单号: string }>("/material-issues", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  remove: (单号: string) =>
    api<void>(`/material-issues/${enc(单号)}`, { method: "DELETE" }),
  supervisorApprove: (单号: string) =>
    api<void>(`/material-issues/${enc(单号)}/supervisor-approve`, { method: "POST" }),
  managerApprove: (单号: string) =>
    api<void>(`/material-issues/${enc(单号)}/manager-approve`, { method: "POST" }),
  // 审核=整单出库(后端 SyncIssuedWithAudit 把全部行置已出并扣库存)
  approve: (单号: string) =>
    api<void>(`/material-issues/${enc(单号)}/approve`, { method: "POST" }),
  // 分次出库:只提交 本次出库>0 的行,立即扣库存;全部出完单据自动置已审核
  // (URL/载荷照抄老系统 materialDocs.ts("material-issues").outbound)
  outbound: (单号: string, 明细: MaterialIssueOutboundLine[]) =>
    api<MaterialIssueOutboundResult>(`/material-issues/${enc(单号)}/outbound`, {
      method: "POST",
      body: JSON.stringify({ 明细 }),
    }),
  // 反审核=撤销全部出库(库存回滚)
  unapprove: (单号: string) =>
    api<void>(`/material-issues/${enc(单号)}/unapprove`, { method: "POST" }),
  // 来料领料查询(明细/汇总;与单据共用权限菜单「来料领料单」,后端无独立查询菜单,无价格列)
  queryDetail: (q: DocQueryParams) =>
    api<MaterialIssueQueryDetailRow[]>(`/material-issues/issue-query/detail${qs({ ...q })}`),
  querySummary: (q: DocQueryParams) =>
    api<MaterialIssueSummaryRow[]>(`/material-issues/issue-query/summary${qs({ ...q })}`),
};

// 人事档案(领料人选择器/接受人=仓管/PMC 下拉;照抄老系统 masterApi("employees"))
export const employeesApi = {
  list: (page = 1, size = 200, keyword = "") =>
    api<Paged<EmployeeRow>>(`/master/employees${qs({ page, size, keyword })}`),
};

// 半成品/成品库存(领料明细「库存」列:表头仓库=半成品仓/成品仓时;照抄老系统 semi.ts/finished.ts)
export const semiInventoryApi = {
  list: (仓库: string) => api<SemiStockRow[]>(`/semi-inventory${qs({ 仓库 })}`),
  // 半成品库存统计表(权限菜单「半成品库存」,MenuCatalog.cs:30 实证)
  report: (q: SemiInvReportQuery = {}) =>
    api<SemiInvReportRow[]>(`/semi-inventory/report${qs({ ...q })}`),
  // 半成品库存月报表(权限菜单同为「半成品库存」)
  monthly: (q: SemiMonthlyQuery = {}) =>
    api<SemiMonthlyRow[]>(`/semi-inventory/monthly${qs({ ...q })}`),
};

export const finishedInventoryApi = {
  list: (仓库: string) => api<FinishedStockRow[]>(`/finished-inventory${qs({ 仓库 })}`),
  // 某配件编号在该仓库的出入库流水(结存由前端按返回顺序累计;照抄老系统 finishedInventoryApi.ledger)
  ledger: (仓库: string, 配件编号: string) =>
    api<FinishedStockLedgerRow[]>(`/finished-inventory/ledger${qs({ 仓库, 配件编号 })}`),
};

// ---------- 塑胶侧主数据/库存(照抄 web/src/api/plastic*.ts) ----------

export const plasticInventoryApi = {
  list: (仓库?: string, keyword?: string, 物料类别?: string) =>
    api<PlasticStockRow[]>(`/plastic-inventory${qs({ 仓库, keyword, 物料类别 })}`),
};

export const plasticMaterialSettingsApi = {
  // 列表(塑胶物料设置页;后端按 camelCase 序列化为 id,归一化为 ID,页面据此判断「已设置」)
  list: (page = 1, size = 20, keyword = "") =>
    api<Paged<PlasticMaterialSettingRow>>(
      `/plastic-material-settings${qs({ page, size, keyword })}`,
    ).then((r) => ({
      ...r,
      items: r.items.map((x) => ({
        ...x,
        ID: (x as unknown as { id?: number }).id ?? x.ID,
      })),
    })),
  // 下游单据预填用(任何登录用户可读),未设置后端返回 404
  lookup: (物料编号: string) =>
    api<PlasticMaterialSettingLookup>(`/plastic-material-settings/lookup/${enc(物料编号)}`),
  save: (物料编号: string, body: PlasticMaterialSettingSave) =>
    api<PlasticMaterialSettingRow>(`/plastic-material-settings/${enc(物料编号)}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  remove: (物料编号: string) =>
    api<void>(`/plastic-material-settings/${enc(物料编号)}`, { method: "DELETE" }),
};

export const plasticMaterialMasterApi = {
  list: (类别?: string, keyword?: string, page = 1, size = 50, onlyStock?: boolean, 含子级?: boolean, 款号?: string) =>
    api<Paged<PlasticMaterialRow>>(`/plastic-material-master${qs({ 类别, keyword, page, size, onlyStock, 含子级, 款号 })}`).then(
      (r) => ({ ...r, items: r.items.map(withId) }),
    ),
  // 塑胶物料类别树(塑胶领料查询的类别过滤)
  categories: () => api<PlasticMaterialCategoryNode[]>("/plastic-material-master/categories"),
  // Excel 导入(塑胶物料资料页「导入表格」)
  importRows: (rows: Record<string, unknown>[]) =>
    api<ImportResult>("/plastic-material-master/import", {
      method: "POST",
      body: JSON.stringify({ rows }),
    }),
};

// ---------- Batch 4 塑胶仓群(共用物料表/月报/类型客户统计/退仓/报废/采购分析/发外需求;照抄老系统 web/src/api/plastic*.ts) ----------

// 塑胶共用物料表(列表;新增/编辑/删除走 masterDataApi("plastic-common-materials"),对照老系统 masterApi 同资源)
export const plasticCommonMaterialApi = {
  list: (q: PlasticCommonQuery) =>
    api<Paged<PlasticCommonMaterialRow>>(`/plastic-common-materials${qs({ ...q })}`).then((r) => ({
      ...r,
      items: r.items.map((x) => ({ ...x, ID: (x as unknown as { id?: number }).id ?? x.ID })),
    })),
};

// 塑胶库存月报表(/plastic-monthly-report;权限菜单「塑胶库存月报表」)
export const plasticMonthlyReportApi = {
  list: (月份: string, 物料类别?: string, keyword?: string) =>
    api<PlasticMonthlyReportRow[]>(`/plastic-monthly-report${qs({ 月份, 物料类别, keyword })}`),
};

// 塑胶类型客户统计(/plastic-customer-type-stats;权限菜单「塑胶类型客户统计」,「金额」位控制金额列)
export const plasticCustomerTypeApi = {
  list: (起: string, 止: string, 客户?: string) =>
    api<PlasticCustomerTypeStatRow[]>(`/plastic-customer-type-stats${qs({ 起, 止, 客户 })}`),
};

// 塑胶退仓单/塑胶报废单(供应商单据同构:单级审核=过账;照抄老系统 plasticSupplierDoc.ts)
function plasticSupplierDocApi(resource: "plastic-warehouse-returns" | "plastic-scraps") {
  const base = `/${resource}`;
  return {
    list: (page = 1, size = 20, keyword = "") =>
      api<Paged<PlasticReceiptHeader>>(`${base}${qs({ page, size, keyword })}`).then((r) => ({
        ...r,
        items: r.items.map(withId),
      })),
    get: (单号: string) =>
      api<PlasticReceiptDetail>(`${base}/${enc(单号)}`).then((r) => ({
        ...r,
        单头: r.单头 ? withId(r.单头) : r.单头,
        明细: (r.明细 ?? []).map(withId),
      })),
    create: (body: PlasticReceiptCreate) =>
      api<{ 单号: string }>(base, { method: "POST", body: JSON.stringify(body) }),
    remove: (单号: string) => api<void>(`${base}/${enc(单号)}`, { method: "DELETE" }),
    approve: (单号: string) =>
      api<{ 警告?: string } | undefined>(`${base}/${enc(单号)}/approve`, { method: "POST" }),
    unapprove: (单号: string) =>
      api<{ 警告?: string } | undefined>(`${base}/${enc(单号)}/unapprove`, { method: "POST" }),
  };
}

export const plasticWarehouseReturnApi = {
  ...plasticSupplierDocApi("plastic-warehouse-returns"),
  // 塑胶退仓查询(明细/汇总;权限菜单「塑胶退仓查询」,无单价位时后端置 null)
  queryDetail: (q: DocQueryParams) =>
    api<PlasticWhReturnQueryDetailRow[]>(`/plastic-warehouse-return-query/detail${qs({ ...q })}`),
  querySummary: (q: DocQueryParams) =>
    api<PlasticWhReturnQuerySummaryRow[]>(`/plastic-warehouse-return-query/summary${qs({ ...q })}`),
};

export const plasticScrapApi = {
  ...plasticSupplierDocApi("plastic-scraps"),
  // 塑胶报废查询(明细/汇总;权限菜单「塑胶报废查询」)
  queryDetail: (q: DocQueryParams) =>
    api<PlasticScrapQueryDetailRow[]>(`/plastic-scrap-query/detail${qs({ ...q })}`),
  querySummary: (q: DocQueryParams) =>
    api<PlasticScrapQuerySummaryRow[]>(`/plastic-scrap-query/summary${qs({ ...q })}`),
};

// 塑胶采购分析:生产单列表(权限菜单「塑胶物料单」;照抄老系统 plasticMaterialDocApi.orders)
// 下单情况="未下单"/"已下单":服务端按 塑胶采购订单明细 是否引用该生产单分组(已保存/未保存)
export const plasticMaterialDocApi = {
  orders: (起?: string, 止?: string, keyword?: string, page = 1, size = 50, 下单情况?: string) =>
    api<Paged<PlasticOrderRow>>(`/plastic-material-docs/orders${qs({ 起, 止, keyword, page, size, 下单情况 })}`),
};

// 加工件发外需求(塑胶采购分析页上半区;照抄老系统 plasticProcessDemandApi)
export const plasticProcessDemandApi = {
  demand: (生产单号: string) =>
    api<PlasticProcessDemandRow[]>(`/plastic-process-demand${qs({ 生产单号 })}`),
  // 生成加工采购单(同 生产单号+物料编号+加工内容 已有明细的行自动跳过,幂等防重)
  createOrders: (生产单号: string, 行: PlasticProcessDemandOrderLine[]) =>
    api<PlasticProcessDemandCreateResult>("/plastic-process-demand/create-orders", {
      method: "POST",
      body: JSON.stringify({ 生产单号, 行 }),
    }),
};

// 工程部查询报表(BOM货号查询/BOM物料查询;照抄老系统 productionReportApi.bomStyles/bomMaterials)
export const bomQueryApi = {
  bomStyles: (keyword?: string) =>
    api<BomStyleRow[]>(`/production-reports/bom-styles${qs({ keyword })}`),
  bomMaterials: (keyword?: string) =>
    api<BomMaterialRow[]>(`/production-reports/bom-materials${qs({ keyword })}`),
  // BOM 层级树:任一货号的 MA 上级链 + 子孙树(实单/半成品递归组成)
  bomTree: (货号: string) =>
    api<BomTreeResult>(`/production-reports/bom-tree${qs({ 货号 })}`),
};

export const productionReportApi = {
  // 生产制单选择器数据源:仅列已审核(审核="1"),完成不限;生产单跟踪表页亦用(全字段行)
  tracking: (keyword?: string, 审核?: string, 完成?: string) =>
    api<ProductionTrackingRow[]>(`/production-reports/tracking${qs({ keyword, 审核, 完成 })}`),
  // 货号接单汇总表(货号即款号;照抄老系统 productionReportApi.orderSummary)
  orderSummary: (keyword?: string) =>
    api<OrderSummaryRow[]>(`/production-reports/order-summary${qs({ keyword })}`),
  // 采购物料分析明细(采购物料分析页详情;照抄老系统 productionReportApi.purchaseAnalysis)
  purchaseAnalysis: (keyword?: string) =>
    api<PurchaseAnalysisRow[]>(`/production-reports/purchase-analysis${qs({ keyword })}`),
  // 采购分析明细保存(详情页,可改 需订数量/供应商):仅分析未审核可改
  savePurchaseAnalysis: (body: PurchaseAnalysisSave) =>
    api<{ 更新行数: number }>(`/production-reports/purchase-analysis`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  // BOM订单制作工作表(照抄老系统 productionReportApi.orderWorksheet)
  orderWorksheet: (keyword?: string) =>
    api<OrderWorksheetRow[]>(`/production-reports/order-worksheet${qs({ keyword })}`),
};

// ---------- 补料单(采购订单「从补料单带入」:待采购列表 + 带入明细 + 保存后标记已采购) ----------

export const replenishmentApi = {
  list: (page = 1, size = 20, keyword = "", 审核情况?: string, 仓库?: string, 待采购?: boolean) =>
    api<Paged<ReplenishmentHeader>>(
      `/replenishments${qs({ page, size, keyword, 审核情况, 仓库, 待采购 })}`,
    ),
  get: (单号: string) => api<ReplenishmentDetail>(`/replenishments/${enc(单号)}`),
  create: (body: ReplenishmentCreate) =>
    api<{ 单号: string }>("/replenishments", { method: "POST", body: JSON.stringify(body) }),
  // 审核=通知 PMC 安排采购(不扣库存;扣库存走 采购入库->领料单);反审核同挂「审核」位(后端如此)
  audit: (单号: string) =>
    api<void>(`/replenishments/${enc(单号)}/audit`, { method: "POST" }),
  reverseAudit: (单号: string) =>
    api<void>(`/replenishments/${enc(单号)}/reverse-audit`, { method: "POST" }),
  remove: (单号: string) =>
    api<void>(`/replenishments/${enc(单号)}`, { method: "DELETE" }),
  // 采购订单保存成功后标记已采购(幂等,防重复带入)
  markPurchased: (单号: string) =>
    api<void>(`/replenishments/${enc(单号)}/mark-purchased`, { method: "POST" }),
};

// ---------- 退料单 / 报废单(来料仓;单级审核=过账。URL/中文字段照抄老系统 materialDocs.ts + returnQuery/scrapQuery) ----------

// 退料/报废同构(仅 部门/人 字段名与查询数量字段不同),API 形状一致,工厂函数按 resource 生成
function usageDocApi(resource: "material-returns" | "material-scraps", querySegment: string) {
  const base = `/${resource}`;
  return {
    list: (page = 1, size = 20, keyword = "") =>
      api<Paged<UsageDocHeader>>(`${base}${qs({ page, size, keyword })}`).then((r) => ({
        ...r,
        items: r.items.map(withId),
      })),
    get: (单号: string) =>
      api<UsageDocDetail>(`${base}/${enc(单号)}`).then((r) => ({
        ...r,
        单头: r.单头 ? withId(r.单头) : r.单头,
        明细: (r.明细 ?? []).map(withId),
      })),
    create: (body: Record<string, unknown>) =>
      api<{ 单号: string }>(base, { method: "POST", body: JSON.stringify(body) }),
    remove: (单号: string) => api<void>(`${base}/${enc(单号)}`, { method: "DELETE" }),
    approve: (单号: string) => api<void>(`${base}/${enc(单号)}/approve`, { method: "POST" }),
    unapprove: (单号: string) => api<void>(`${base}/${enc(单号)}/unapprove`, { method: "POST" }),
    // 查询(明细/汇总;权限菜单与单据同,无价格列)
    queryDetail: (q: DocQueryParams) =>
      api<UsageDocQueryDetailRow[]>(`${base}/${querySegment}/detail${qs({ ...q })}`),
    querySummary: (q: DocQueryParams) =>
      api<UsageDocQuerySummaryRow[]>(`${base}/${querySegment}/summary${qs({ ...q })}`),
  };
}

export const materialReturnApi = usageDocApi("material-returns", "return-query");
export const materialScrapApi = usageDocApi("material-scraps", "scrap-query");

// ---------- 库存月结(月结管理;照抄老系统 web/src/api/monthEnd.ts) ----------

export const monthEndApi = {
  report: (年月: string, 口径: string, 仓库?: string) =>
    api<MonthEndRow[]>(`/month-end${qs({ 年月, 口径, 仓库 })}`),
  periods: (口径: string) => api<string[]>(`/month-end/periods${qs({ 口径 })}`),
  close: (body: { 年月: string; 口径: string; 仓库?: string }) =>
    api<MonthEndCloseResult>("/month-end/close", { method: "POST", body: JSON.stringify(body) }),
  reopen: (body: { 年月: string; 口径: string; 仓库?: string }) =>
    api<{ 删数: number }>("/month-end/reopen", { method: "POST", body: JSON.stringify(body) }),
};

// ---------- 来料标签单(照抄老系统 web/src/api/materialLabelOrders.ts + materialLabel.ts) ----------

export const materialLabelOrderApi = {
  list: (page = 1, size = 20, keyword = "") =>
    api<Paged<MaterialLabelOrderListRow>>(`/material-label-orders${qs({ page, size, keyword })}`).then(
      (r) => ({ ...r, items: r.items.map(withId) }),
    ),
  get: (电脑单号: string) => api<MaterialLabelOrder>(`/material-label-orders/${enc(电脑单号)}`),
  create: (body: MaterialLabelOrderSave) =>
    api<{ 电脑单号: string }>("/material-label-orders", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  update: (电脑单号: string, body: MaterialLabelOrderSave) =>
    api<MaterialLabelOrder>(`/material-label-orders/${enc(电脑单号)}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  remove: (电脑单号: string) =>
    api<void>(`/material-label-orders/${enc(电脑单号)}`, { method: "DELETE" }),
  audit: (电脑单号: string) =>
    api<void>(`/material-label-orders/${enc(电脑单号)}/audit`, { method: "POST" }),
  reverseAudit: (电脑单号: string) =>
    api<void>(`/material-label-orders/${enc(电脑单号)}/reverse-audit`, { method: "POST" }),
  // 前单/后单;无相邻单后端 204
  adjacent: (电脑单号: string, direction: "previous" | "next") =>
    api<MaterialLabelOrder | undefined>(
      `/material-label-orders/${enc(电脑单号)}/adjacent${qs({ direction })}`,
    ),
  // 物料选择器数据源(来料仓物料,服务端分页)
  materials: (p: { page?: number; size?: number; keyword?: string }) =>
    api<Paged<MaterialLabelMaterialRow>>(`/material-label-orders/materials${qs({ ...p })}`),
  // 来料标签查询(明细/汇总;权限菜单「来料标签查询」)
  labelQueryDetail: (q: DocQueryParams) =>
    api<MaterialLabelDetailRow[]>(`/material-label-orders/label-query/detail${qs({ ...q })}`),
  labelQuerySummary: (q: DocQueryParams) =>
    api<MaterialLabelSummaryRow[]>(`/material-label-orders/label-query/summary${qs({ ...q })}`),
};

// ---------- 主数据选择器(供应商资料 / 物料资料) ----------

export const suppliersApi = {
  list: (page = 1, size = 500, keyword = "") =>
    api<Paged<SupplierRow>>(`/master/suppliers${qs({ page, size, keyword })}`),
};

export const materialMasterApi = {
  // onlyStock=只查有库存(后端仅回 库存>0;采购订单物料选择器用,对照老系统 MaterialPicker)
  // 含子级=类别过滤含子类别(物料资料页左树选中父类别时;照抄老系统 materialMasterApi.list)
  list: (类别?: string, keyword?: string, page = 1, size = 50, onlyStock?: boolean, 含子级?: boolean) =>
    api<Paged<MasterMaterialRow>>(`/material-master${qs({ 类别, keyword, page, size, onlyStock, 含子级 })}`).then(
      (r) => ({ ...r, items: r.items.map(withId) }),
    ),
  // 物料类别树(入仓/退仓查询的类别过滤;照抄老系统 materialMasterApi.categories)
  categories: () => api<MaterialCategoryNode[]>("/material-master/categories"),
  // 新增物料编号预填(留空保存时后端兜底生成;照抄老系统 materialMasterApi.nextCode)
  nextCode: (类别?: string) =>
    api<{ 编号: string }>(`/material-master/next-code${qs({ 类别 })}`).then((r) => r.编号),
  create: (body: Record<string, unknown>) =>
    api<MasterMaterialRow>("/material-master", { method: "POST", body: JSON.stringify(body) }),
  // Excel 导入(物料资料页「导入表格」;行内未映射列已由前端打包进备注)
  importRows: (rows: Record<string, unknown>[]) =>
    api<ImportResult>("/material-master/import", { method: "POST", body: JSON.stringify({ rows }) }),
};

// 通用主数据 CRUD(/master/{resource};照抄老系统 web/src/api/master.ts 的 masterApi)
export function masterDataApi(resource: string) {
  const base = `/master/${resource}`;
  return {
    list: (page = 1, size = 20, keyword = "") =>
      api<Paged<MasterRow>>(`${base}${qs({ page, size, keyword })}`),
    get: (id: number) => api<MasterRow>(`${base}/${id}`),
    create: (body: Record<string, unknown>) =>
      api<MasterRow>(base, { method: "POST", body: JSON.stringify(body) }),
    update: (id: number, body: Record<string, unknown>) =>
      api<MasterRow>(`${base}/${id}`, { method: "PUT", body: JSON.stringify(body) }),
    remove: (id: number) => api<void>(`${base}/${id}`, { method: "DELETE" }),
  };
}

// 半成品设置(BOM物料设置页下方「设置半成品」;照抄老系统 web/src/api/semiSetup.ts)
export const semiSetupApi = {
  list: (货号: string) => api<SemiSetupDef[]>(`/semi-setups${qs({ 货号 })}`),
  create: (body: SemiSetupSave) =>
    api<{ id: number }>("/semi-setups", { method: "POST", body: JSON.stringify(body) }),
  update: (id: number, body: SemiSetupSave) =>
    api<void>(`/semi-setups/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  remove: (id: number) => api<void>(`/semi-setups/${id}`, { method: "DELETE" }),
};

// 塑胶工模表(塑胶物料资料「选工模」选择器数据源;照抄老系统 web/src/api/plasticMold.ts)
export const plasticMoldApi = {
  list: (page = 1, size = 20, keyword = "") =>
    api<Paged<PlasticMoldRow>>(`/master/plastic-molds${qs({ page, size, keyword })}`).then(
      (r) => ({ ...r, items: r.items.map(withId) }),
    ),
};

export const stylesApi = {
  // 生产通知单 货号选择:已做 BOM 物料设置的款号及单头信息
  bomHeaders: (keyword = "") =>
    api<BomHeaderOption[]>(`/styles/bom-headers${qs({ keyword })}`),
  // BOM 按 PO 号绑定:查询该 BOM(款号)已绑定的 PO 列表(保存生产单时由后端绑定,前端仅查询)
  poBindings: (款号: string) =>
    api<PoBindingDto[]>(`/styles/${enc(款号)}/po-bindings`),
  // 装配BOM 领料展开(来料领料单「按装配BOM带入」):半成品行 × 半成品设置明细 → 组成物料(带仓库分类)
  assemblyIssue: (款号: string, 数量: number) =>
    api<AssemblyIssueView>(`/styles/${enc(款号)}/assembly-issue${qs({ 数量 })}`),
  // 款号列表(装配加工采购单 产品货号下拉;照抄老系统 stylesApi.list)
  list: (keyword = "", page = 1, size = 50) =>
    api<Paged<StyleListItem>>(`/master/styles${qs({ page, size, keyword })}`),
  // BOM物料设置 轻量载入(款式+物料+单头;装配加工采购单 loadProduct/辅料重算/下加工单弹窗数据源)
  // 报价行后端按 camelCase 序列化为 id,归一化为 ID(载入/保存均读 ID;照抄老系统 stylesApi.materials)
  materials: (款号: string) =>
    api<StyleMaterialsView>(`/styles/${enc(款号)}/materials`).then((r) => ({
      ...r,
      报价:
        r.报价?.map((q) => ({ ...q, ID: (q as unknown as { id?: number }).id ?? q.ID })) ??
        r.报价,
    })),
  // BOM物料设置 保存(单头+明细;排期「去建 BOM」跳入时带 待绑定PO号,后端审核后自动绑定)
  saveMaterials: (款号: string, body: BomSave) =>
    api<{ 警告?: string[] } | undefined>(`/styles/${enc(款号)}/materials`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  // 真删除整张 BOM(台头+明细):未审核才能删,已被生产通知单引用的拒绝
  deleteBom: (款号: string) =>
    api<void>(`/styles/${enc(款号)}/materials`, { method: "DELETE" }),
  // 复制整张 BOM 到目标款号(409=目标已有 BOM,前端弹覆盖确认后带 覆盖=true 重试)
  copyBom: (款号: string, body: { 目标款号: string; 覆盖?: boolean }) =>
    api<void>(`/styles/${enc(款号)}/copy`, { method: "POST", body: JSON.stringify(body) }),
  // BOM 台头审核(翻转 款号物料总表.审核;区别于装配入口的 调整审核)
  bomAudit: (款号: string) =>
    api<void>(`/styles/${enc(款号)}/bom-audit`, { method: "POST" }),
  // 装配物料设置 调整审核/反审核(装配扩展段.调整审核;URL 照抄老系统 BomSetupPage changeAudit)
  assemblyAudit: (款号: string) =>
    api<void>(`/styles/${enc(款号)}/audit`, { method: "POST" }),
  assemblyReverseAudit: (款号: string) =>
    api<void>(`/styles/${enc(款号)}/reverse-audit`, { method: "POST" }),
  // BOM 反审核申请-审批流:申请(必填原因) → 经理在消息中心 同意/拒绝
  requestBomReverseAudit: (款号: string, 原因: string) =>
    api<void>(`/styles/${enc(款号)}/bom-reverse-audit-request`, {
      method: "POST",
      body: JSON.stringify({ 原因 }),
    }),
  // 已设置的半成品/成品款号(BOM 明细「选半成品」数据源;接口失败时页面降级为不可选)
  semiOptions: () => api<SemiOption[]>("/styles/semi-options"),
  // 经理批准/拒绝 BOM 反审核申请(消息中心操作;URL 照抄老系统 web/src/api/styles.ts,无载荷)
  approveBomReverseAuditRequest: (款号: string) =>
    api<void>(`/styles/${enc(款号)}/bom-reverse-audit-request/approve`, { method: "POST" }),
  rejectBomReverseAuditRequest: (款号: string) =>
    api<void>(`/styles/${enc(款号)}/bom-reverse-audit-request/reject`, { method: "POST" }),
};

// ---------- 装配加工采购单(发外加工;URL/中文字段照抄老系统 web/src/api/assemblyPurchaseOrder.ts) ----------

export const assemblyPurchaseOrderApi = {
  list: (page = 1, size = 50, keyword = "") =>
    api<Paged<AssemblyPurchaseOrderHeaderRow>>(
      `/assembly-purchase-orders${qs({ page, size, keyword })}`,
    ),
  get: (单号: string) =>
    api<AssemblyPurchaseOrderDetail>(`/assembly-purchase-orders/${enc(单号)}`),
  create: (body: AssemblyPurchaseOrderSave) =>
    api<{ 单号: string }>("/assembly-purchase-orders", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  update: (单号: string, body: AssemblyPurchaseOrderSave) =>
    api<void>(`/assembly-purchase-orders/${enc(单号)}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  remove: (单号: string) =>
    api<void>(`/assembly-purchase-orders/${enc(单号)}`, { method: "DELETE" }),
  supervisorApprove: (单号: string) =>
    api<void>(`/assembly-purchase-orders/${enc(单号)}/supervisor-approve`, { method: "POST" }),
  managerApprove: (单号: string) =>
    api<void>(`/assembly-purchase-orders/${enc(单号)}/manager-approve`, { method: "POST" }),
  approve: (单号: string) =>
    api<void>(`/assembly-purchase-orders/${enc(单号)}/approve`, { method: "POST" }),
  unapprove: (单号: string) =>
    api<void>(`/assembly-purchase-orders/${enc(单号)}/unapprove`, { method: "POST" }),
};

// 行级加工单价记忆:选半成品/物料入行时按货号批量带出最近单价(保存单据时后端自动记录)
export const processingPriceApi = {
  get: (items: string[]) =>
    api<{ prices: Record<string, number> }>(`/processing-prices${qs({ items: items.join(",") })}`),
};

// 装配采购查询:打开未落库的旧虚拟单(实时展开)用;优先读落库单,取不到才走这里(照抄老系统 openGeneratedDoc)
// 装配部报表群 6 个报表端点同挂此控制器(权限菜单=款号资料;照抄老系统 web/src/api/assemblyPurchaseQuery.ts)
export const assemblyPurchaseQueryApi = {
  get: (单号: string) =>
    api<AssemblyPurchaseOrderDetail>(`/assembly-purchase-query/${enc(单号)}`),
  summary: (p: { 起: string; 止: string; keyword?: string; 收货仓库?: string; 审核情况?: string }) =>
    api<AssemblyPurchaseSummaryRow[]>(`/assembly-purchase-query/summary${qs({ ...p })}`),
  detail: (p: { 起: string; 止: string; keyword?: string; 收货仓库?: string; 审核情况?: string }) =>
    api<AssemblyPurchaseDetailRow[]>(`/assembly-purchase-query/detail${qs({ ...p })}`),
  tracking: (p: { 起: string; 止: string; keyword?: string; 收货仓库?: string; 截止统计?: boolean }) =>
    api<AssemblyMaterialTrackingRow[]>(`/assembly-purchase-query/tracking${qs({ ...p })}`),
  factoryInventory: (p: {
    启用日期: boolean;
    起?: string;
    止?: string;
    截止日期: string;
    加工厂?: string;
    物料分类?: string;
    收货仓库?: string;
    keyword?: string;
  }) => api<AssemblyFactoryInventoryRow[]>(`/assembly-purchase-query/factory-inventory${qs({ ...p })}`),
  requiredMaterials: (p: {
    起: string;
    止: string;
    keyword?: string;
    收货仓库?: string;
    类型?: string;
    审核情况?: string;
  }) => api<AssemblyRequiredMaterialRow[]>(`/assembly-purchase-query/required-materials${qs({ ...p })}`),
  factoryCategoryMonthly: (p: { 起: string; 止: string; 加工厂?: string; keyword?: string }) =>
    api<AssemblyFactoryCategoryMonthlyRow[]>(`/assembly-purchase-query/factory-category-monthly${qs({ ...p })}`),
};

// 装配物料汇总表(汇总+明细一次返回;权限菜单=款号资料;照抄老系统 assemblyMaterialSummary.ts)
export const assemblyMaterialSummaryApi = {
  list: (p: AssemblyMaterialSummaryParams) =>
    api<AssemblyMaterialSummaryResult>(`/assembly-material-summary${qs({ ...p })}`),
};

// 加工厂分类明细表(权限菜单=款号资料;照抄老系统 factoryCategoryDetail.ts)
export const factoryCategoryDetailApi = {
  list: (p: FactoryCategoryDetailParams) =>
    api<FactoryCategoryDetailRow[]>(`/assembly-factory-category-detail${qs({ ...p })}`),
};

// 加工厂类别树(加工厂分类明细表 类别下拉;照抄老系统 factoryMasterApi.categories)
export const factoryMasterApi = {
  categories: () => api<FactoryCategoryNode[]>("/factory-master/categories"),
  // 加工厂资料页列表(类别过滤+关键字+服务端分页;后端按 camelCase 序列化 id,归一化为 ID,照抄老系统)
  list: (类别?: string, keyword?: string, page = 1, size = 50) =>
    api<Paged<FactoryRow>>(`/factory-master${qs({ 类别, keyword, page, size })}`).then((r) => ({
      ...r,
      items: r.items.map((x) => ({ ...x, ID: x.id ?? x.ID })),
    })),
};

// ---------- 塑胶加工采购单(发外加工;装配页「下加工单」生成用;Batch 6 补齐整单 CRUD/三级审核,照抄老系统 web/src/api/plasticProcessPurchaseOrder.ts) ----------

export const plasticProcessPurchaseOrderApi = {
  list: (page = 1, size = 10, keyword = "") =>
    api<Paged<PPPOHeader>>(`/plastic-process-purchase-orders${qs({ page, size, keyword })}`),
  // 调入加工清单基准(按生产单 BOM;二次加工类别行前端展开 第一次/第二次 两条)
  basis: (生产单号: string) =>
    api<PPPOBasisRow[]>(`/plastic-process-purchase-orders/basis${qs({ 生产单号 })}`),
  get: (单号: string) =>
    api<PPPODetail>(`/plastic-process-purchase-orders/${enc(单号)}`),
  create: (body: PlasticProcessPurchaseOrderCreate) =>
    api<{ 单号: string }>("/plastic-process-purchase-orders", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  remove: (单号: string) =>
    api<void>(`/plastic-process-purchase-orders/${enc(单号)}`, { method: "DELETE" }),
  supervisorApprove: (单号: string) =>
    api<void>(`/plastic-process-purchase-orders/${enc(单号)}/supervisor-approve`, { method: "POST" }),
  managerApprove: (单号: string) =>
    api<void>(`/plastic-process-purchase-orders/${enc(单号)}/manager-approve`, { method: "POST" }),
  approve: (单号: string) =>
    api<void>(`/plastic-process-purchase-orders/${enc(单号)}/approve`, { method: "POST" }),
  unapprove: (单号: string) =>
    api<void>(`/plastic-process-purchase-orders/${enc(单号)}/unapprove`, { method: "POST" }),
};

// ---------- 主数据选择器(客户资料/加工厂资料;照抄老系统 masterApi("customers"/"factories")) ----------

export const customersApi = {
  list: (page = 1, size = 500, keyword = "") =>
    api<Paged<CustomerRow>>(`/master/customers${qs({ page, size, keyword })}`),
};

export const factoriesApi = {
  list: (page = 1, size = 300, keyword = "") =>
    api<Paged<FactoryRow>>(`/master/factories${qs({ page, size, keyword })}`),
};

export const inventoryApi = {
  list: (p: { 仓库?: string; keyword?: string; 物料类别?: string; 含零库存?: boolean }) =>
    api<MaterialStockRow[]>(`/material-inventory${qs(p)}`),
  categories: () => api<MaterialCategoryNode[]>("/material-inventory/categories"),
};

// 个人库存金额表:剩余库存按批次倒推 FIFO 归到下单人
export const personalInventoryApi = {
  list: (范围?: string) =>
    api<PersonalInventoryBatchRow[]>(`/personal-inventory${qs({ 范围: 范围 || undefined })}`),
};

// ---------- 消息中心(URL/中文字段照抄老系统 web/src/api/messages.ts;参数 onlyUnread/page/size 与后端 MessageController 一致) ----------

export const messagesApi = {
  list: (page = 1, size = 20, onlyUnread = false) =>
    api<Paged<MessageRow>>(`/messages${qs({ onlyUnread, page, size })}`).then(
      // 后端按 camelCase 序列化 id,归一化为 ID(行查看/标记已读要用;同老系统)
      (r) => ({ ...r, items: r.items.map((x) => ({ ...x, ID: x.ID ?? x.id })) }),
    ),
  unreadCount: () => api<{ count: number }>("/messages/unread-count"),
  markRead: (id: number) => api<void>(`/messages/${id}/read`, { method: "POST" }),
};

export const accountApi = {
  list: (keyword = "") => api<AccountRow[]>(`/admin/accounts${qs({ keyword })}`),
  register: (body: { 用户名: string; 初始密码: string }) =>
    api<void>("/admin/accounts", { method: "POST", body: JSON.stringify(body) }),
  resetPassword: (用户: string, body: { 新密码: string }) =>
    api<void>(`/admin/accounts/${enc(用户)}/reset-password`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  lock: (用户: string) => api<void>(`/admin/accounts/${enc(用户)}/lock`, { method: "POST" }),
  unlock: (用户: string) => api<void>(`/admin/accounts/${enc(用户)}/unlock`, { method: "POST" }),
  remove: (用户: string) => api<void>(`/admin/accounts/${enc(用户)}`, { method: "DELETE" }),
};

export const userPermApi = {
  get: (用户: string) => api<MenuPermRow[]>(`/admin/accounts/${enc(用户)}/perms`),
  save: (用户: string, 明细: MenuPermRow[]) =>
    api<void>(`/admin/accounts/${enc(用户)}/perms`, {
      method: "PUT",
      body: JSON.stringify({ 用户名: 用户, 明细 }),
    }),
};

// ---------- 客户排期表(URL/中文字段照抄老系统 web/src/api/scheduling.ts;DTO 的 ID 后端已固定大写) ----------

export const schedulingApi = {
  list: (p: ScheduleListParams) =>
    api<Paged<ScheduleRow>>(`/scheduling${qs({ ...p })}`),
  files: (排期客户?: string, keyword?: string) =>
    api<ScheduleFile[]>(`/scheduling/files${qs({ 排期客户, keyword })}`),
  batches: () => api<ScheduleBatch[]>("/scheduling/batches"),
  summary: () => api<ScheduleSummary[]>("/scheduling/summary"),
  customers: () => api<string[]>("/scheduling/customers"),
  import: (排期客户: string, 文件名: string, rows: Record<string, unknown>[]) =>
    api<ScheduleImportResult>("/scheduling/import", {
      method: "POST",
      body: JSON.stringify({ 排期客户, 文件名, rows }),
    }),
  removeBatch: (批次ID: number) =>
    api<void>(`/scheduling/batches/${批次ID}`, { method: "DELETE" }),
  create: (body: ScheduleRowSave) =>
    api<{ id: number }>("/scheduling", { method: "POST", body: JSON.stringify(body) }),
  update: (id: number, body: ScheduleRowSave) =>
    api<{ 状态待审核: boolean }>(`/scheduling/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  remove: (id: number) =>
    api<void>(`/scheduling/${id}`, { method: "DELETE" }),
  statusChanges: (审核状态?: string) =>
    api<ScheduleStatusChange[]>(`/scheduling/status-changes${qs({ 审核状态 })}`),
  statusPending: () =>
    api<{ 待审数: number; 是否经理: boolean }>("/scheduling/status-changes/pending"),
  approveStatusChange: (id: number, 审核备注?: string) =>
    api<void>(`/scheduling/status-changes/${id}/approve`, {
      method: "POST",
      body: JSON.stringify({ 审核备注 }),
    }),
  rejectStatusChange: (id: number, 审核备注?: string) =>
    api<void>(`/scheduling/status-changes/${id}/reject`, {
      method: "POST",
      body: JSON.stringify({ 审核备注 }),
    }),
};

// ---------- 图片备注(URL/字段照抄老系统 web/src/api/imageNotes.ts;模块=生产单/BOM) ----------

export const imageNoteApi = {
  list: (模块: string, 单号: string) =>
    api<ImageNote[]>(`/image-notes${qs({ 模块, 单号 })}`),
  // 上传是 multipart/form-data,不能用 api()(其固定 JSON Content-Type);
  // 自带 fetch 并沿用同一套约定:Bearer 令牌 / 401 清令牌跳登录 / 错误取后端 {消息}
  upload: async (模块: string, 单号: string, file: File, 备注?: string): Promise<ImageNote> => {
    const fd = new FormData();
    fd.append("模块", 模块);
    fd.append("单号", 单号);
    if (备注) fd.append("备注", 备注);
    fd.append("file", file);
    const token = getToken();
    const res = await fetch(`${import.meta.env.BASE_URL}api/image-notes`, {
      method: "POST",
      body: fd,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (res.status === 401) {
      clearToken();
      if (!location.pathname.endsWith("/login")) location.assign(`${import.meta.env.BASE_URL}login`);
      throw new ApiError(401, "登录已过期，请重新登录");
    }
    const text = await res.text();
    let data: { 消息?: string } | null = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      // 与 api() 同一约定:500 等异常返回 text/plain 时按状态码给干净文案,不抛 JSON 解析错
      if (res.ok) throw new ApiError(res.status, "响应格式异常");
    }
    if (!res.ok) throw new ApiError(res.status, data?.消息 ?? `请求失败 (${res.status})`);
    return data as ImageNote;
  },
  remove: (id: number) => api<void>(`/image-notes/${id}`, { method: "DELETE" }),
};

// 静态文件在站点根 /uploads 下(api 在 /api 下),dev 由 vite proxy 转发;云端部署在 /erp/ 子路径,需带 BASE_URL 前缀
export const imageNoteUrl = (n: ImageNote) => `${import.meta.env.BASE_URL}${n.存储路径 ?? ""}`;

// ---------- Batch 5 半成品仓群(照抄老系统 web/src/api/semi.ts + semiFinishedLabelOrders.ts + semiFinishedCommonMaterials.ts) ----------

// 半成品共用物料表(权限菜单「半成品共用物料表」,MenuCatalog.cs:31 实证)
export const semiCommonMaterialApi = {
  list: (q: SemiCommonMaterialQuery = {}) =>
    api<Paged<SemiCommonMaterialRow>>(`/semi-finished-common-materials${qs({ ...q })}`),
  audit: (产品货号: string) =>
    api<void>(`/semi-finished-common-materials/${enc(产品货号)}/audit`, { method: "POST" }),
  reverseAudit: (产品货号: string) =>
    api<void>(`/semi-finished-common-materials/${enc(产品货号)}/reverse-audit`, { method: "POST" }),
};

// 半成品标签单(权限菜单「半成品标签单」,MenuCatalog.cs:32 实证;查询页签同菜单)
export const semiLabelOrderApi = {
  list: (page = 1, size = 20, keyword = "") =>
    api<Paged<SemiLabelOrderListRow>>(`/semi-finished-label-orders${qs({ page, size, keyword })}`),
  get: (电脑单号: string) =>
    api<SemiLabelOrder>(`/semi-finished-label-orders/${enc(电脑单号)}`),
  create: (body: SemiLabelOrderSave) =>
    api<{ 电脑单号: string }>("/semi-finished-label-orders", { method: "POST", body: JSON.stringify(body) }),
  update: (电脑单号: string, body: SemiLabelOrderSave) =>
    api<SemiLabelOrder>(`/semi-finished-label-orders/${enc(电脑单号)}`, { method: "PUT", body: JSON.stringify(body) }),
  remove: (电脑单号: string) =>
    api<void>(`/semi-finished-label-orders/${enc(电脑单号)}`, { method: "DELETE" }),
  audit: (电脑单号: string) =>
    api<void>(`/semi-finished-label-orders/${enc(电脑单号)}/audit`, { method: "POST" }),
  reverseAudit: (电脑单号: string) =>
    api<void>(`/semi-finished-label-orders/${enc(电脑单号)}/reverse-audit`, { method: "POST" }),
  adjacent: (电脑单号: string, direction: "previous" | "next") =>
    api<SemiLabelOrder | undefined>(`/semi-finished-label-orders/${enc(电脑单号)}/adjacent${qs({ direction })}`),
  products: (params: SemiProductQuery = {}) =>
    api<Paged<SemiProductRow>>(`/semi-finished-label-orders/products${qs({ ...params })}`),
  // 半成品标签查询(汇总/明细;老系统 semiLabelQueryApi)
  querySummary: (q: SemiQueryParams) =>
    api<SemiLabelSummaryRow[]>(`/semi-label-query/summary${qs({ ...q })}`),
  queryDetail: (q: SemiQueryParams) =>
    api<SemiLabelDetailRow[]>(`/semi-label-query/detail${qs({ ...q })}`),
};

// 半成品入仓单(权限菜单「半成品入仓」,MenuCatalog.cs:30 实证;查询页签同菜单)
export const semiReceiptApi = {
  list: (page = 1, size = 20, keyword = "") =>
    api<Paged<SRHeader>>(`/semi-receipts${qs({ page, size, keyword })}`),
  get: (单号: string) => api<SRDetail>(`/semi-receipts/${enc(单号)}`),
  create: (body: SRCreate) =>
    api<{ 单号: string }>("/semi-receipts", { method: "POST", body: JSON.stringify(body) }),
  update: (单号: string, body: SRCreate) =>
    api<SRDetail>(`/semi-receipts/${enc(单号)}`, { method: "PUT", body: JSON.stringify(body) }),
  remove: (单号: string) => api<void>(`/semi-receipts/${enc(单号)}`, { method: "DELETE" }),
  approve: (单号: string) => api<void>(`/semi-receipts/${enc(单号)}/approve`, { method: "POST" }),
  unapprove: (单号: string) => api<void>(`/semi-receipts/${enc(单号)}/unapprove`, { method: "POST" }),
  adjacent: (单号: string, direction: "previous" | "next") =>
    api<SRDetail | undefined>(`/semi-receipts/${enc(单号)}/adjacent${qs({ direction })}`),
  products: (params: SemiProductQuery = {}) =>
    api<Paged<SemiProductRow>>(`/semi-receipts/products${qs({ ...params })}`),
  kitCheck: (p: { 半成品: string; 货号?: string; 生产单号?: string; 数量?: number }) =>
    api<SRKitResult>(`/semi-receipts/kit-check${qs(p)}`),
  querySummary: (q: SemiQueryParams) =>
    api<SemiReceiptSummaryRow[]>(`/semi-receipt-query/summary${qs({ ...q })}`),
  queryDetail: (q: SemiQueryParams) =>
    api<SemiReceiptDetailRow[]>(`/semi-receipt-query/detail${qs({ ...q })}`),
};

// 成品入仓单(/finished-receipts;权限菜单「成品入仓」,MenuCatalog.cs:28 实证;照抄老系统 web/src/api/finished.ts)
export const finishedReceiptApi = {
  list: (page = 1, size = 20, keyword = "") =>
    api<Paged<FRHeader>>(`/finished-receipts${qs({ page, size, keyword })}`),
  get: (单号: string) => api<FRDetail>(`/finished-receipts/${enc(单号)}`),
  create: (body: FRCreate) =>
    api<{ 单号: string }>("/finished-receipts", { method: "POST", body: JSON.stringify(body) }),
  update: (单号: string, body: FRCreate) =>
    api<FRDetail>(`/finished-receipts/${enc(单号)}`, { method: "PUT", body: JSON.stringify(body) }),
  remove: (单号: string) => api<void>(`/finished-receipts/${enc(单号)}`, { method: "DELETE" }),
  approve: (单号: string) => api<void>(`/finished-receipts/${enc(单号)}/approve`, { method: "POST" }),
  unapprove: (单号: string) =>
    api<void>(`/finished-receipts/${enc(单号)}/unapprove`, { method: "POST" }),
  adjacent: (单号: string, direction: "previous" | "next") =>
    api<FRDetail | undefined>(`/finished-receipts/${enc(单号)}/adjacent${qs({ next: direction === "next" })}`),
  products: (params: SemiProductQuery = {}) =>
    api<Paged<SemiProductRow>>(`/finished-receipts/products${qs({ ...params })}`),
  querySummary: (q: SemiQueryParams) =>
    api<FRQSummaryRow[]>(`/finished-receipt-query/summary${qs({ ...q })}`),
  queryDetail: (q: SemiQueryParams) =>
    api<FRQDetailRow[]>(`/finished-receipt-query/detail${qs({ ...q })}`),
};

// 半成品出库单(领料;权限菜单「半成品领料」,MenuCatalog.cs:30 实证;三级审核链:主管->经理->审核)
export const semiIssueApi = {
  list: (page = 1, size = 20, keyword = "") =>
    api<Paged<SIHeader>>(`/semi-issues${qs({ page, size, keyword })}`),
  get: (单号: string) => api<SIDetail>(`/semi-issues/${enc(单号)}`),
  create: (body: SICreate) =>
    api<{ 单号: string }>("/semi-issues", { method: "POST", body: JSON.stringify(body) }),
  update: (单号: string, body: SICreate) =>
    api<SIDetail>(`/semi-issues/${enc(单号)}`, { method: "PUT", body: JSON.stringify(body) }),
  remove: (单号: string) => api<void>(`/semi-issues/${enc(单号)}`, { method: "DELETE" }),
  supervisorApprove: (单号: string) =>
    api<void>(`/semi-issues/${enc(单号)}/supervisor-approve`, { method: "POST" }),
  managerApprove: (单号: string) =>
    api<void>(`/semi-issues/${enc(单号)}/manager-approve`, { method: "POST" }),
  approve: (单号: string) => api<void>(`/semi-issues/${enc(单号)}/approve`, { method: "POST" }),
  unapprove: (单号: string) => api<void>(`/semi-issues/${enc(单号)}/unapprove`, { method: "POST" }),
  adjacent: (单号: string, next: boolean) =>
    api<SIDetail | undefined>(`/semi-issues/${enc(单号)}/adjacent${qs({ next })}`),
  products: (params: SemiProductQuery = {}) =>
    api<Paged<SemiProductRow>>(`/semi-issues/products${qs({ ...params })}`),
  querySummary: (q: SemiQueryParams) =>
    api<SemiIssueSummaryRow[]>(`/semi-issue-query/summary${qs({ ...q })}`),
  queryDetail: (q: SemiQueryParams) =>
    api<SemiIssueDetailRow[]>(`/semi-issue-query/detail${qs({ ...q })}`),
};

// 半成品报废单(权限菜单「半成品报废」,MenuCatalog.cs:36 实证;查询页签同菜单)
export const semiScrapApi = {
  list: (page = 1, size = 20, keyword = "") =>
    api<Paged<SSDocHeader>>(`/semi-scraps${qs({ page, size, keyword })}`),
  get: (单号: string) => api<SSDocDetail>(`/semi-scraps/${enc(单号)}`),
  create: (body: Record<string, unknown>) =>
    api<{ 单号: string }>("/semi-scraps", { method: "POST", body: JSON.stringify(body) }),
  update: (单号: string, body: Record<string, unknown>) =>
    api<SSDocDetail>(`/semi-scraps/${enc(单号)}`, { method: "PUT", body: JSON.stringify(body) }),
  remove: (单号: string) => api<void>(`/semi-scraps/${enc(单号)}`, { method: "DELETE" }),
  approve: (单号: string) => api<void>(`/semi-scraps/${enc(单号)}/approve`, { method: "POST" }),
  unapprove: (单号: string) => api<void>(`/semi-scraps/${enc(单号)}/unapprove`, { method: "POST" }),
  adjacent: (单号: string, next: boolean) =>
    api<SSDocDetail | undefined>(`/semi-scraps/${enc(单号)}/adjacent${qs({ next })}`),
  products: (params: SemiProductQuery = {}) =>
    api<Paged<SemiProductRow>>(`/semi-scraps/products${qs({ ...params })}`),
  querySummary: (q: SemiQueryParams) =>
    api<SemiScrapSummaryRow[]>(`/semi-scrap-query/summary${qs({ ...q })}`),
  queryDetail: (q: SemiQueryParams) =>
    api<SemiScrapDetailRow[]>(`/semi-scrap-query/detail${qs({ ...q })}`),
};

// 半成品盘点单(权限菜单「半成品盘点」,MenuCatalog.cs:30 实证;查询页签同菜单)
export const semiStocktakeApi = {
  // 盘点基准(半成品仓库存按配件编号汇总的系统数量)
  basis: (仓库: string) => api<STKBasisRow[]>(`/semi-stocktakes/basis${qs({ 仓库 })}`),
  list: (page = 1, size = 20, keyword = "") =>
    api<Paged<STKHeader>>(`/semi-stocktakes${qs({ page, size, keyword })}`),
  get: (单号: string) => api<STKDetail>(`/semi-stocktakes/${enc(单号)}`),
  create: (body: STKCreate) =>
    api<{ 单号: string }>("/semi-stocktakes", { method: "POST", body: JSON.stringify(body) }),
  update: (单号: string, body: STKCreate) =>
    api<STKDetail>(`/semi-stocktakes/${enc(单号)}`, { method: "PUT", body: JSON.stringify(body) }),
  remove: (单号: string) => api<void>(`/semi-stocktakes/${enc(单号)}`, { method: "DELETE" }),
  approve: (单号: string) => api<void>(`/semi-stocktakes/${enc(单号)}/approve`, { method: "POST" }),
  unapprove: (单号: string) => api<void>(`/semi-stocktakes/${enc(单号)}/unapprove`, { method: "POST" }),
  adjacent: (单号: string, next: boolean) =>
    api<STKDetail | undefined>(`/semi-stocktakes/${enc(单号)}/adjacent${qs({ next })}`),
  products: (params: SemiProductQuery = {}) =>
    api<Paged<SemiProductRow>>(`/semi-stocktakes/products${qs({ ...params })}`),
  querySummary: (q: SemiQueryParams) =>
    api<SemiStkQuerySummaryRow[]>(`/semi-stocktake-query/summary${qs({ ...q })}`),
  queryDetail: (q: SemiQueryParams) =>
    api<SemiStkQueryDetailRow[]>(`/semi-stocktake-query/detail${qs({ ...q })}`),
};

// ---------- Batch 6 喷油/加工群(照抄老系统 web/src/api/{plasticWhitePartIssue,plasticProcessOrderMake,purchaseMaterialSettings}.ts) ----------

// 白件领料单(权限菜单「白件领料单」,MenuCatalog.cs:23 实证;三级审核链:主管->经理->审核(下发))
export const plasticWhitePartIssueApi = {
  list: (page = 1, size = 10, keyword = "") =>
    api<Paged<WPIHeader>>(`/plastic-white-part-issue${qs({ page, size, keyword })}`),
  // 调入清单基准(按生产单带白件 BOM 清单,数量默认 0 手填)
  basis: (生产单号: string) =>
    api<WPIBasisRow[]>(`/plastic-white-part-issue/basis${qs({ 生产单号 })}`),
  get: (单号: string) => api<WPIDetail>(`/plastic-white-part-issue/${enc(单号)}`),
  create: (body: Record<string, unknown>) =>
    api<{ 单号: string }>("/plastic-white-part-issue", { method: "POST", body: JSON.stringify(body) }),
  remove: (单号: string) =>
    api<void>(`/plastic-white-part-issue/${enc(单号)}`, { method: "DELETE" }),
  supervisorApprove: (单号: string) =>
    api<void>(`/plastic-white-part-issue/${enc(单号)}/supervisor-approve`, { method: "POST" }),
  managerApprove: (单号: string) =>
    api<void>(`/plastic-white-part-issue/${enc(单号)}/manager-approve`, { method: "POST" }),
  approve: (单号: string) =>
    api<void>(`/plastic-white-part-issue/${enc(单号)}/approve`, { method: "POST" }),
  unapprove: (单号: string) =>
    api<void>(`/plastic-white-part-issue/${enc(单号)}/unapprove`, { method: "POST" }),
};

// 塑胶加工订单制作(喷油部;权限菜单「塑胶加工订单制作」,MenuCatalog.cs:19 实证)
export const plasticProcessOrderMakeApi = {
  list: (p: { 起: string; 止: string; keyword?: string }) =>
    api<PlasticProcessOrderMakeRow[]>(`/plastic-process-order-make${qs({ ...p })}`),
  // 已下喷油订单(已审核塑胶采购订单中供应商含「喷油」的单,按明细行展开)
  received: (p: { 起: string; 止: string; keyword?: string }) =>
    api<SprayOrderReceivedRow[]>(`/plastic-process-order-make/received${qs({ ...p })}`),
  // 接收=喷油部确认收到该订单(未接收时调;已接收直接带入;单号走 query,对照老系统 params)
  receive: (单号: string) =>
    api<void>(`/plastic-process-order-make/receive${qs({ 单号 })}`, { method: "POST" }),
};

// 采购物料设置(权限菜单「采购物料设置」,MenuCatalog.cs:106 实证;功能位 打开/保存/删除)
export const purchaseMaterialSettingsApi = {
  list: (page = 1, size = 50, keyword = "") =>
    api<Paged<PurchaseMaterialSettingRow>>(
      `/purchase-material-settings${qs({ page, size, keyword })}`,
      // 后端按 camelCase 序列化为 id,归一化为 ID(页面据此判断「已设置」;同老系统)
    ).then((r) => ({
      ...r,
      items: r.items.map((x) => ({ ...x, ID: (x as unknown as { id?: number }).id ?? x.ID })),
    })),
  save: (物料编号: string, body: PurchaseMaterialSettingSave) =>
    api<PurchaseMaterialSettingRow>(`/purchase-material-settings/${enc(物料编号)}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  remove: (物料编号: string) =>
    api<void>(`/purchase-material-settings/${enc(物料编号)}`, { method: "DELETE" }),
};

// ---------- Batch 7 原料仓群(URL/中文字段照抄老系统 web/src/api/plasticRawMaterial*.ts) ----------

// 塑胶原料资料表(权限菜单「塑胶原料资料表」;CRUD 走 /master/plastic-raw-materials,同老系统 masterApi)
export const plasticRawMaterialMasterApi = {
  categories: () =>
    api<PlasticRawMaterialCategoryNode[]>("/plastic-raw-material-master/categories"),
  list: (类别?: string, keyword?: string, page = 1, size = 50, onlyStock?: boolean) =>
    api<Paged<PlasticRawMaterialRow>>(
      `/plastic-raw-material-master${qs({ 类别, keyword, page, size, onlyStock })}`,
    ).then((r) => ({ ...r, items: r.items.map(withId) })),
};

// 原料库存统计表 / 原料库存月报表(权限菜单各自同名)
export const rawMaterialReportApi = {
  inventory: (物料类别?: string, keyword?: string, displayMode = "occurred") =>
    api<RawMaterialInventoryRow[]>(
      `/plastic-raw-material-inventory${qs({ 物料类别, keyword, displayMode })}`,
    ),
  monthly: (起: string, 止: string, 物料类别?: string, keyword?: string) =>
    api<RawMaterialMonthlyRow[]>(
      `/plastic-raw-material-monthly${qs({ 起, 止, 物料类别, keyword })}`,
    ),
};

// 原料采购分析表(权限菜单「原料采购分析表」)
export const rawPurchaseAnalysisApi = {
  list: (p: { 物料类别?: string; keyword?: string; onlyBuy?: boolean }) =>
    api<RawPurchaseAnalysisRow[]>(`/plastic-raw-material-purchase-analysis${qs({ ...p })}`),
};

// 原料生产需求表(单级审核;查询汇总同资源 /summary)
export const rawMaterialDemandApi = {
  list: (page = 1, size = 10, keyword = "") =>
    api<Paged<RMDHeader>>(`/plastic-raw-material-demand${qs({ page, size, keyword })}`),
  summary: (p: { 起: string; 止: string; keyword?: string; 领料备注?: string; 审核情况?: string }) =>
    api<RMDSummaryRow[]>(`/plastic-raw-material-demand/summary${qs({ ...p })}`),
  get: (单号: string) => api<RMDDetail>(`/plastic-raw-material-demand/${enc(单号)}`),
  create: (body: Record<string, unknown>) =>
    api<{ 单号: string }>("/plastic-raw-material-demand", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  remove: (单号: string) =>
    api<void>(`/plastic-raw-material-demand/${enc(单号)}`, { method: "DELETE" }),
  approve: (单号: string) =>
    api<void>(`/plastic-raw-material-demand/${enc(单号)}/approve`, { method: "POST" }),
  unapprove: (单号: string) =>
    api<void>(`/plastic-raw-material-demand/${enc(单号)}/unapprove`, { method: "POST" }),
};

// 原料采购订单(三级流转:主管审核 -> 经理审核 -> 审核=下发)
export const rawPurchaseOrderApi = {
  list: (page = 1, size = 10, keyword = "") =>
    api<Paged<RMPOHeader>>(`/plastic-raw-material-purchase-order${qs({ page, size, keyword })}`),
  get: (单号: string) => api<RMPODetail>(`/plastic-raw-material-purchase-order/${enc(单号)}`),
  create: (body: Record<string, unknown>) =>
    api<{ 单号: string }>("/plastic-raw-material-purchase-order", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  remove: (单号: string) =>
    api<void>(`/plastic-raw-material-purchase-order/${enc(单号)}`, { method: "DELETE" }),
  supervisorApprove: (单号: string) =>
    api<void>(`/plastic-raw-material-purchase-order/${enc(单号)}/supervisor-approve`, { method: "POST" }),
  managerApprove: (单号: string) =>
    api<void>(`/plastic-raw-material-purchase-order/${enc(单号)}/manager-approve`, { method: "POST" }),
  approve: (单号: string) =>
    api<void>(`/plastic-raw-material-purchase-order/${enc(单号)}/approve`, { method: "POST" }),
  unapprove: (单号: string) =>
    api<void>(`/plastic-raw-material-purchase-order/${enc(单号)}/unapprove`, { method: "POST" }),
};

// 原料采购进度表(gate「原料采购订单·打开」;日期类型=订购日期/交货日期/不选择日期)
export const rawPurchaseProgressApi = {
  list: (p: {
    供应商?: string;
    日期类型?: string;
    起?: string;
    止?: string;
    onlyOwed?: boolean;
    keyword?: string;
  }) => api<RawPurchaseProgressRow[]>(`/plastic-raw-material-purchase-progress${qs({ ...p })}`),
};

// 原料入仓单(单级审核=入库存;「订单调入」数据源=已审核原料采购订单)
export const rawReceiptApi = {
  list: (page = 1, size = 10, keyword = "") =>
    api<Paged<RMRHeader>>(`/plastic-raw-material-receipt${qs({ page, size, keyword })}`),
  get: (单号: string) => api<RMRDetail>(`/plastic-raw-material-receipt/${enc(单号)}`),
  create: (body: Record<string, unknown>) =>
    api<{ 单号: string }>("/plastic-raw-material-receipt", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  remove: (单号: string) =>
    api<void>(`/plastic-raw-material-receipt/${enc(单号)}`, { method: "DELETE" }),
  approve: (单号: string) =>
    api<void>(`/plastic-raw-material-receipt/${enc(单号)}/approve`, { method: "POST" }),
  unapprove: (单号: string) =>
    api<void>(`/plastic-raw-material-receipt/${enc(单号)}/unapprove`, { method: "POST" }),
  // 原料入仓查询(明细/汇总;权限菜单「原料入仓查询」)
  queryDetail: (q: DocQueryParams) =>
    api<RawReceiptQueryDetailRow[]>(`/plastic-raw-material-receipt-query/detail${qs({ ...q })}`),
  querySummary: (q: DocQueryParams) =>
    api<RawReceiptQuerySummaryRow[]>(`/plastic-raw-material-receipt-query/summary${qs({ ...q })}`),
};

// 原料出库表(三级流转;「调入清单」数据源=已审核原料生产需求表)
export const rawStockIssueApi = {
  list: (page = 1, size = 10, keyword = "") =>
    api<Paged<RSIHeader>>(`/plastic-raw-material-stock-issue${qs({ page, size, keyword })}`),
  get: (单号: string) => api<RSIDetail>(`/plastic-raw-material-stock-issue/${enc(单号)}`),
  create: (body: Record<string, unknown>) =>
    api<{ 单号: string }>("/plastic-raw-material-stock-issue", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  remove: (单号: string) =>
    api<void>(`/plastic-raw-material-stock-issue/${enc(单号)}`, { method: "DELETE" }),
  supervisorApprove: (单号: string) =>
    api<void>(`/plastic-raw-material-stock-issue/${enc(单号)}/supervisor-approve`, { method: "POST" }),
  managerApprove: (单号: string) =>
    api<void>(`/plastic-raw-material-stock-issue/${enc(单号)}/manager-approve`, { method: "POST" }),
  approve: (单号: string) =>
    api<void>(`/plastic-raw-material-stock-issue/${enc(单号)}/approve`, { method: "POST" }),
  unapprove: (单号: string) =>
    api<void>(`/plastic-raw-material-stock-issue/${enc(单号)}/unapprove`, { method: "POST" }),
  // 原料出库查询(明细/汇总;权限菜单「原料出库查询」,多 领料备注/制单人 过滤)
  queryDetail: (q: DocQueryParams & { 领料备注?: string; 制单人?: string }) =>
    api<RawStockIssueQueryDetailRow[]>(`/plastic-raw-material-stock-issue-query/detail${qs({ ...q })}`),
  querySummary: (q: DocQueryParams & { 领料备注?: string; 制单人?: string }) =>
    api<RawStockIssueQuerySummaryRow[]>(`/plastic-raw-material-stock-issue-query/summary${qs({ ...q })}`),
};

// 原料盘点单(单级审核=盘点过账校准库存)
export const rawStocktakeApi = {
  list: (page = 1, size = 10, keyword = "") =>
    api<Paged<RSTHeader>>(`/plastic-raw-material-stocktake${qs({ page, size, keyword })}`),
  get: (单号: string) => api<RSTDetail>(`/plastic-raw-material-stocktake/${enc(单号)}`),
  create: (body: Record<string, unknown>) =>
    api<{ 单号: string }>("/plastic-raw-material-stocktake", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  remove: (单号: string) =>
    api<void>(`/plastic-raw-material-stocktake/${enc(单号)}`, { method: "DELETE" }),
  approve: (单号: string) =>
    api<void>(`/plastic-raw-material-stocktake/${enc(单号)}/approve`, { method: "POST" }),
  unapprove: (单号: string) =>
    api<void>(`/plastic-raw-material-stocktake/${enc(单号)}/unapprove`, { method: "POST" }),
  // 原料盘点查询(明细/汇总;权限菜单「原料盘点查询」)
  queryDetail: (q: DocQueryParams) =>
    api<RawStocktakeQueryDetailRow[]>(`/plastic-raw-material-stocktake-query/detail${qs({ ...q })}`),
  querySummary: (q: DocQueryParams) =>
    api<RawStocktakeQuerySummaryRow[]>(`/plastic-raw-material-stocktake-query/summary${qs({ ...q })}`),
};

// 原料订货入库统计(权限菜单「原料订货入库统计」,MenuCatalog.cs:78 实证:原料报表组)
export const rawOrderReceiptStatsApi = {
  list: (起: string, 止: string, keyword?: string) =>
    api<RawOrderReceiptStatRow[]>(
      `/plastic-raw-material-order-receipt-stats${qs({ 起, 止, keyword })}`,
    ),
};

// ---------- Batch 9 基础设置 + 工具项(照抄老系统 web/src/api/systemSettings.ts 与 adminTools.ts) ----------

// 基本资料(公司资料):一组存于系统配置表的键值,后端固定键白名单(权限菜单「基本资料」,MenuCatalog.cs:99 实证:系统管理组)
export const companyProfileApi = {
  get: () => api<SettingItem[]>("/company-profile"),
  save: (值: Record<string, string>) =>
    api<{ 消息?: string }>("/company-profile", { method: "PUT", body: JSON.stringify({ 值 }) }),
};

// 功能设置:系统级参数(默认货币/单价小数位/数量小数位),存于系统配置表(权限菜单「功能设置」,MenuCatalog.cs:100 实证)
export const featureSettingsApi = {
  get: () => api<SettingItem[]>("/feature-settings"),
  save: (值: Record<string, string>) =>
    api<{ 消息?: string }>("/feature-settings", { method: "PUT", body: JSON.stringify({ 值 }) }),
};

// 系统工具:版本信息(网上升级) + 数据库备份(备份数据,权限菜单「备份数据」功能位,MenuCatalog.cs:103 实证)
export const adminToolsApi = {
  version: () => api<VersionInfo>("/admin/version"),
  backup: () => api<BackupResult>("/admin/backup", { method: "POST" }),
};
