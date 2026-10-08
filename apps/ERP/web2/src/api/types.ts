// 与后端 DTO 对应的中文字段类型(参考 src/ErpApi/Features/Production/ProductionDtos.cs
// 与 Engines/Inventory/MaterialStockRow)。注意:.NET 默认 camelCase 只影响 ASCII 属性名
// (ID -> id, PagedResult -> { items, total }),中文字段名原样序列化。

export interface Paged<T> {
  items: T[];
  total: number;
}

// ---------- 生产通知单 ----------

export interface ProductionHeader {
  id?: number;
  ID?: number;
  生产单号?: string | null;
  款号?: string | null;
  款式?: string | null;
  合同号?: string | null;
  客户编号?: string | null;
  客户名称?: string | null;
  加工厂编号?: string | null;
  加工厂名称?: string | null;
  日期?: string | null;
  交货日期?: string | null;
  下单日期?: string | null;
  接单数量?: number | null;
  客户款号?: string | null;
  订单类型?: string | null;
  标识?: string | null;
  装箱方式?: string | null;
  订单总箱数?: number | null;
  默认单价?: string | null;
  制单人?: string | null;
  跟单员?: string | null;
  计划数量?: number | null;
  工序数?: number | null;
  工序单价?: number | null;
  物料金额?: number | null;
  出货单价?: number | null;
  入半成品数量?: number | null;
  入成品数量?: number | null;
  审核?: string | null;
  审核人?: string | null;
  // 采购分析审核(采购物料分析独立审核层,≠ 生产通知单审核):'1'=已审核,审过才能来料下采购订单
  采购分析审核?: string | null;
  采购分析审核人?: string | null;
  采购分析审核时间?: string | null;
  完成?: string | null;
  反审核申请?: string | null;
  反审核申请人?: string | null;
  反审核申请原因?: string | null;
  备注?: string | null;
}

export interface ProductionGoodsRow {
  id?: number;
  序号?: number | null;
  货号?: string | null;
  BOM款号?: string | null;
  款号名称?: string | null;
  数量?: number | null;
  比例?: number | null;
  分析?: boolean | null;
}

// 色码数量行(详情返回与创建载荷共用字段)
export interface ProductionQty {
  货号?: string;
  颜色?: string;
  尺码?: string;
  数量?: number;
}

// 货号明细行(创建用,与老系统 web/src/api/production.ts 一致)
export interface ProductionGoodsLine {
  货号: string;
  BOM款号: string;
  款号名称?: string;
  比例?: number;
  分析?: boolean;
  数量明细: ProductionQty[];
}

// 单据创建/表头修改 DTO(一单多货号;表头修改时 货号明细 传 [])
export interface ProductionNoticeCreate {
  生产单号?: string; // 留空则后端自动生成;可手动指定(如沿用客户单号)
  接单数量?: number; // 留空回落为明细合计(计划数量)
  订单类型?: string;
  标识?: string;
  装箱方式?: string;
  订单总箱数?: number;
  默认单价?: string;
  客户编号?: string;
  客户名称?: string;
  客户款号?: string;
  合同号?: string;
  加工厂编号?: string;
  加工厂名称?: string;
  交货日期?: string;
  跟单员?: string;
  下单日期?: string;
  备注?: string;
  订单单号?: string;
  货号明细: ProductionGoodsLine[];
}

// 工序工费行(详情快照;照抄老系统 web/src/api/production.ts ProductionDetail.工序)
export interface ProductionProcRow {
  货号?: string;
  工序号?: string;
  工序名称?: string;
  单价?: number | null;
  工序类型?: string;
}

// BOM 展开物料行(详情快照;照抄老系统 ProductionDetail.物料)
export interface ProductionMatRow {
  货号?: string;
  物料编号?: string;
  物料名称?: string;
  规格?: string;
  颜色?: string;
  单位?: string;
  总数量?: number;
  库存数量?: number;
  可用库存?: number;
  需订数量?: number;
  预算单价?: number | null;
  金额?: number | null;
  供应商编号?: string;
  供应商名称?: string;
}

// MO单跟踪行(生产通知单MO单;照抄老系统 MoLine)
export interface MoLine {
  序号?: number | null;
  接单日期?: string | null;
  正单合同号?: string | null;
  产品货号?: string | null;
  产品名称?: string | null;
  接单数量?: number | null;
  装箱方式?: string | null;
  订单总箱数?: number | null;
  验货日期?: string | null;
  备注?: string | null;
}

// 图片备注元数据(对应后端 ImageNoteDto);文件经 /uploads/... 静态路径访问
export interface ImageNote {
  ID: number;
  模块: string;
  单号: string;
  文件名?: string | null;
  存储路径?: string | null;
  备注?: string | null;
  上传人?: string | null;
  上传时间?: string | null;
}

export interface ProductionDetail {
  单头?: ProductionHeader | null;
  货号明细: ProductionGoodsRow[];
  数量: ProductionQty[];
  工序: ProductionProcRow[];
  物料: ProductionMatRow[];
  // 半成品需求(展示用):实单版 BOM 的半成品行 用量×货号数量;由半成品仓/装配领料,不参与采购
  半成品需求?: ProductionSemiNeed[];
}

// 生产单详情 半成品需求行
export interface ProductionSemiNeed {
  货号?: string;
  物料编号?: string;
  物料名称?: string;
  规格?: string;
  颜色?: string;
  单位?: string;
  用量?: number;
  总数量?: number;
}

// ---------- 款号(BOM) ----------

// 生产通知单 货号选择:已做 BOM 物料设置的款号及单头信息
export interface BomHeaderOption {
  款号?: string;
  款式?: string;
  客户编号?: string;
  客户名称?: string;
  单位?: string;
  默认单价?: string;
  类型?: string;
  // 从排期跳转建 BOM 带入的待绑定 PO(BOM 未审核时绑定未落 款号物料PO绑定;生产单页据此预填合同号)
  待绑定PO号?: string;
}

// BOM 按 PO 号绑定记录(GET /styles/{款号}/po-bindings)
export interface PoBindingDto {
  PO号: string;
  绑定时间: string;
}

// ---------- 物料库存 ----------

export interface MaterialStockRow {
  物料编号: string;
  物料名称?: string;
  规格?: string;
  单位?: string;
  仓库?: string;
  库存数量: number;
  货号?: string;
  物料类别?: string;
  每单位数值?: string;
  仓库位置?: string;
}

export interface MaterialCategoryNode {
  编号?: string;
  类别?: string;
  数量: number;
  父级?: string | null;
}

// ---------- 采购订单(来料仓;照抄老系统 web/src/api/purchaseOrders.ts) ----------

// 采购物料分析带出的待采购物料行(按生产单BOM展开)
export interface PurchaseOrderBasisRow {
  ID?: number; // 生产BOM物料清单.ID(分析页勾选行随 URL「行」参数带入时按它对齐勾选)
  物料编号: string;
  物料名称?: string;
  物料类别?: string;
  规格?: string;
  颜色?: string;
  单位?: string;
  总数量?: number;
  库存数量?: number;
  可用库存?: number;
  需订数量?: number;
  预算单价?: number | null;
  供应商编号?: string;
  供应商名称?: string;
  合同号?: string;
  已订数量?: number;
  // 采购物料设置.采购损耗率(%):默认下单数量=需订×(1+损耗率/100);空=0 不加成
  采购损耗率?: number | null;
}

export interface PurchaseOrderHeader {
  id?: number;
  ID?: number;
  单号: string;
  日期?: string;
  交货日期?: string;
  供应商编号?: string;
  供应商名称?: string;
  仓库?: string;
  数量?: number | null;
  金额?: number | null;
  操作员?: string;
  审核?: string;
  审核人?: string;
  备注?: string;
  生产单号?: string;
  PO号?: string;
  收件人?: string;
  打印次数?: number | null;
  // 三级流转:主管审核 -> 经理审核 -> 审核(下发,审核='1')
  主管审核?: string;
  主管审核人?: string;
  经理审核?: string;
  经理审核人?: string;
  // 供应商资料带出(详情,打印用)
  供应商联系人?: string;
  供应商电话?: string;
  供应商传真?: string;
  供应商货币?: string;
  供应商付款方式?: string;
}

export interface PurchaseOrderLine {
  id?: number;
  ID?: number;
  物料编号?: string;
  物料名称?: string;
  物料类别?: string;
  规格?: string;
  颜色?: string;
  单位?: string;
  数量?: number | null;
  单价?: number | null;
  金额?: number | null;
  预算数量?: number | null;
  材料?: string;
  生产单号?: string;
  款号?: string;
  备注?: string;
  // 行级供应商(下单时=单头供应商,随明细落库;「默认供应商」列重开已存单时显示用)
  供应商编号?: string;
  供应商名称?: string;
  // 实时可用库存(仅详情返回,与 basis/采购分析同口径)
  可用库存?: number | null;
}

export interface PurchaseOrderDetail {
  单头: PurchaseOrderHeader | null;
  明细: PurchaseOrderLine[];
}

export interface PurchaseOrderCreateLine {
  物料编号: string;
  物料名称?: string;
  物料类别?: string;
  规格?: string;
  颜色?: string;
  单位?: string;
  数量: number;
  单价?: number;
  预算数量?: number;
  材料?: string;
  生产单号?: string;
  款号?: string;
  备注?: string;
}

export interface PurchaseOrderCreate {
  生产单号?: string;
  供应商编号: string;
  供应商名称?: string;
  日期?: string;
  交货日期?: string;
  收件人?: string;
  仓库?: string;
  款号?: string;
  合同号?: string;
  PO号?: string;
  备注?: string;
  明细: PurchaseOrderCreateLine[];
}

// ---------- 采购入仓单 / 采购退仓单(来料仓;照抄老系统 web/src/api/materialDocs.ts 与后端 DTO) ----------

// 物料明细行(采购入仓/退仓共用;后端 MaterialDocLineDto)
export interface MaterialDocLine {
  id?: number;
  ID?: number;
  物料编号?: string;
  物料名称?: string;
  物料类别?: string;
  规格?: string;
  颜色?: string;
  单位?: string;
  数量?: number;
  已出数量?: number | null; // 领料单:累计已出库数量(分次出库);创建时忽略
  单价?: number | null;
  金额?: number | null;
  备注?: string;
  订单单号?: string; // 采购入仓:调入的采购订单号
  生产单号?: string;
  款号?: string;
  备品?: string; // 采购入仓:"1"=含供应商多送的备品(配合备品数量;不占订单欠数)
  备品数量?: number | null; // 采购入仓:备品部分数量(数量=计入订单欠数的部分;实物入仓=数量+备品数量)
}

export interface PurchaseReceiptHeader {
  id?: number;
  ID?: number;
  单号?: string; // = 供应商送货单号(手填唯一);留空则后端 CG+日期+流水 生成
  日期?: string;
  供应商编号?: string;
  供应商名称?: string;
  仓库?: string;
  付款方式?: string;
  数量?: number | null;
  金额?: number | null;
  操作员?: string;
  审核?: string;
  审核人?: string;
  备注?: string;
}

export interface PurchaseReceiptDetail {
  单头: PurchaseReceiptHeader | null;
  明细: MaterialDocLine[];
}

export interface PurchaseReceiptCreate {
  单号?: string; // 送货单号:手填,全表唯一
  供应商编号?: string;
  供应商名称?: string;
  日期?: string;
  付款方式?: string;
  仓库?: string;
  备注?: string;
  明细: MaterialDocLine[];
}

export interface PurchaseReturnHeader {
  id?: number;
  ID?: number;
  单号?: string; // 电脑单号(后端生成)
  日期?: string;
  入仓单号?: string;
  供应商编号?: string;
  供应商名称?: string;
  仓库?: string;
  数量?: number | null;
  金额?: number | null;
  操作员?: string;
  审核?: string;
  审核人?: string;
  备注?: string;
}

export interface PurchaseReturnDetail {
  单头: PurchaseReturnHeader | null;
  明细: MaterialDocLine[];
}

// 采购退仓 = 退回供应商(审核即扣库存)
export interface PurchaseReturnCreate {
  入仓单号?: string;
  供应商编号?: string;
  供应商名称?: string;
  日期?: string;
  仓库?: string;
  备注?: string;
  明细: MaterialDocLine[];
}

// 采购订单进度欠数行(入仓/退仓「选订单」「整单带入」数据源;照抄 web/src/api/purchaseOrders.ts)
export interface PurchaseOrderProgressRow {
  订购日期?: string;
  交货日期?: string;
  采购单号?: string;
  生产单号?: string;
  款号?: string;
  物料编号?: string;
  物料名称?: string;
  物料类别?: string;
  规格?: string;
  颜色?: string;
  单位?: string;
  订购数量?: number | null;
  入仓数量?: number | null;
  欠数?: number | null;
  供应商编号?: string;
  供应商名称?: string;
  操作员?: string;
  审核?: string;
  备注?: string;
}

// ---------- 入仓/退仓查询(明细/汇总;查询参数同老系统 buildLabelQuery) ----------

export interface DocQueryParams {
  起?: string;
  止?: string;
  keyword?: string;
  物料类别?: string;
  审核情况?: string;
}

// 订购单查询参数(比 DocQueryParams 多 供应商/日期类型;对照老系统 buildOrderQuery)
export interface OrderQueryParams {
  供应商?: string;
  keyword?: string;
  物料类别?: string;
  起?: string;
  止?: string;
  日期类型?: string; // 订货日期 | 交货日期
}

// 采购入仓查询·明细行(全列·无价格;入库单号=采购入仓单号,单号=条码号)
export interface ReceiptQueryDetailRow {
  日期?: string;
  单号?: string;
  入库单号?: string;
  订单单号?: string;
  供应商编号?: string;
  供应商名称?: string;
  生产单号?: string;
  款号?: string;
  物料编号?: string;
  物料名称?: string;
  物料类别?: string;
  规格?: string;
  颜色?: string;
  单位?: string;
  数量?: number | null;
  备注?: string;
  审核?: string;
}

// 入仓查询·汇总行(按 物料编号+规格+颜色 合并,SUM(数量))
export interface ReceiptQuerySummaryRow {
  物料编号?: string;
  物料名称?: string;
  物料类别?: string;
  规格?: string;
  颜色?: string;
  单位?: string;
  数量?: number | null;
}

// 采购退仓查询·明细行(无价格)
export interface ReturnQueryDetailRow {
  日期?: string;
  单号?: string;
  供应商编号?: string;
  供应商名称?: string;
  生产单号?: string;
  款号?: string;
  物料编号?: string;
  物料名称?: string;
  物料类别?: string;
  规格?: string;
  颜色?: string;
  单位?: string;
  数量?: number | null;
  备注?: string;
  审核?: string;
}

// 退仓查询·汇总行(按 物料编号+规格+颜色 合并,退仓数量)
export interface ReturnQuerySummaryRow {
  物料编号?: string;
  物料名称?: string;
  物料类别?: string;
  规格?: string;
  颜色?: string;
  单位?: string;
  退仓数量?: number | null;
}

// ---------- 塑胶入仓单(塑胶仓;单级审核=入库存。照抄老系统 web/src/api/plasticSupplierDoc.ts 与后端 PlasticReceiptDtos.cs) ----------

export interface PlasticReceiptLine {
  id?: number;
  ID?: number;
  生产单号?: string;
  款号?: string;
  工模编号?: string;
  物料编号?: string;
  物料名称?: string;
  规格?: string;
  颜色?: string;
  塑胶货号?: string;
  仓位号?: string;
  单位?: string;
  数量?: number;
  单价?: number | null;
  金额?: number | null;
  备注?: string;
  订单单号?: string;
  // 已加工工序快照:入仓时从来源塑胶采购订单带出(明细加工内容 回落 单头加工内容)
  加工内容?: string;
  // "1"=供应商多送的备品(允许超订单入库,不占订单欠数)
  备品?: string;
}

export interface PlasticReceiptHeader {
  id?: number;
  ID?: number;
  // 入仓单号=供应商送货单号(手填必填,全表唯一);留空则后端 SR+日期+流水 自动生成
  单号?: string;
  日期?: string;
  供应商编号?: string;
  供应商名称?: string;
  仓库?: string;
  数量?: number | null;
  金额?: number | null;
  操作员?: string;
  审核?: string;
  审核人?: string;
  备注?: string;
  出库单号?: string;
  入仓单号?: string;
  电脑单号?: string;
  订单单号?: string;
}

export interface PlasticReceiptDetail {
  单头?: PlasticReceiptHeader | null;
  明细: PlasticReceiptLine[];
}

// 创建载荷(后端 PlasticReceiptCreateDto;日期/操作员由后端落)
export interface PlasticReceiptCreate {
  单号?: string;
  供应商编号?: string;
  供应商名称?: string;
  仓库?: string;
  备注?: string;
  出库单号?: string;
  入仓单号?: string;
  电脑单号?: string;
  订单单号?: string;
  明细: PlasticReceiptLine[];
}

// 塑胶入仓查询·明细行(后端 PlasticReceiptQueryDetailRow;无价格位时后端把 单价/金额 置 null)
export interface PlasticReceiptQueryDetailRow {
  日期?: string;
  单号?: string;
  订单单号?: string;
  生产单号?: string;
  款号?: string;
  工模编号?: string;
  物料编号?: string;
  物料名称?: string;
  颜色?: string;
  塑胶货号?: string;
  共用货号?: string;
  供应商?: string;
  单位?: string;
  数量?: number | null;
  单价?: number | null;
  金额?: number | null;
  备注?: string;
  审核?: string;
}

// 塑胶入仓查询·汇总行(后端 PlasticReceiptQuerySummaryRow)
export interface PlasticReceiptQuerySummaryRow {
  物料编号?: string;
  物料名称?: string;
  颜色?: string;
  塑胶货号?: string;
  共用货号?: string;
  共用物料?: string;
  物料类别?: string;
  单位?: string;
  数量?: number | null;
  金额?: number | null;
}

// 塑胶采购订单进度欠数行(「从采购单带入」数据源;照抄 web/src/api/plasticPurchaseProgress.ts)
export interface PlasticPurchaseProgressRow {
  订购日期?: string;
  交货日期?: string;
  采购单号?: string;
  生产单号?: string;
  款号?: string;
  物料编号?: string;
  物料名称?: string;
  模具编号?: string;
  颜色?: string;
  单位?: string;
  订购数量?: number | null;
  入仓数量?: number | null;
  欠数?: number | null;
  供应商名称?: string;
  审核?: string;
}

// 塑胶采购订单单头(三级流转:主管审核 -> 经理审核 -> 审核=下发;照抄老系统 PPOHeader)
export interface PlasticPurchaseOrderHeader {
  id?: number;
  ID?: number;
  单号?: string;
  日期?: string;
  交货日期?: string;
  供应商编号?: string;
  供应商名称?: string;
  客户名称?: string;
  交货地点?: string;
  编号?: string;
  数量?: number | null;
  操作员?: string;
  审核?: string;
  审核人?: string;
  备注?: string;
  加工内容?: string;
  加工类型?: string; // 一次加工(默认)/二次加工
  主管审核?: string;
  主管审核人?: string;
  经理审核?: string;
  经理审核人?: string;
  // 供应商资料带出(详情,打印用)
  供应商联系人?: string;
  供应商电话?: string;
  供应商传真?: string;
  供应商联系地址?: string;
}
export interface PlasticPurchaseOrderDetail {
  单头?: PlasticPurchaseOrderHeader | null;
  明细: PlasticPurchaseOrderLine[];
}

// 仓库位置下拉选项(单据表头「仓库」;照抄 web/src/api/systemMasters.ts warehouseLocationApi.options)
export interface WarehouseLocationOption {
  编号?: string;
  名称?: string;
}

// ---------- 塑胶领料单(塑胶仓;审核=出库。照抄老系统 web/src/api/plasticIssue.ts 与后端 PlasticIssueDtos.cs) ----------

// 应领明细行(按生产单带入数据源;照抄 web/src/api/production.ts IssueBasisRow)
export interface IssueBasisRow {
  生产单号?: string;
  款号?: string;
  货号?: string;
  物料编号?: string;
  物料名称?: string;
  规格?: string;
  颜色?: string;
  单位?: string;
  数量: number;
}

export interface PlasticIssueLine {
  id?: number;
  ID?: number;
  装配采购?: string;
  生产单号?: string;
  款号?: string;
  物料编号?: string;
  模具编号?: string;
  物料名称?: string;
  规格?: string;
  颜色?: string;
  色粉号?: string;
  用料名称?: string;
  仓位号?: string;
  单位?: string;
  数量?: number;
  单价?: number | null;
  金额?: number | null;
  备注?: string;
}

export interface PlasticIssueHeader {
  id?: number;
  ID?: number;
  单号?: string;
  日期?: string;
  领料部门?: string;
  领料人?: string;
  仓库?: string;
  数量?: number | null;
  金额?: number | null;
  操作员?: string;
  审核?: string;
  审核人?: string;
  备注?: string;
  胶箱数?: number | null;
  纸箱数?: number | null;
  钙塑箱数?: number | null;
  卡板数?: number | null;
  收件人?: string;
  电脑单号?: string;
  领料备注?: string;
  // 三级流转:主管审核 -> 经理审核 -> 塑胶仓出库(审核='1')
  主管审核?: string;
  主管审核人?: string;
  经理审核?: string;
  经理审核人?: string;
}

export interface PlasticIssueDetail {
  单头?: PlasticIssueHeader | null;
  明细: PlasticIssueLine[];
}

// 创建载荷(后端 PlasticIssueCreateDto;日期/操作员由后端落,单号后端生成)
export interface PlasticIssueCreate {
  领料部门?: string;
  领料人?: string;
  仓库?: string;
  备注?: string;
  胶箱数?: number;
  纸箱数?: number;
  钙塑箱数?: number;
  卡板数?: number;
  收件人?: string;
  电脑单号?: string;
  领料备注?: string;
  明细: PlasticIssueLine[];
}

// 塑胶领料查询·明细行(后端 PlasticIssueQueryDetailRow;无价格位时后端把 单价/金额 置 null)
export interface PlasticIssueQueryDetailRow {
  日期?: string;
  单号?: string;
  生产单号?: string;
  款号?: string;
  领料部门?: string;
  领料人?: string;
  装配采购?: string;
  物料编号?: string;
  物料名称?: string;
  颜色?: string;
  塑胶货号?: string;
  共用物料?: string;
  共用货号?: string;
  单位?: string;
  数量?: number | null;
  单价?: number | null;
  金额?: number | null;
  备注?: string;
  审核?: string;
}

// 塑胶领料查询·汇总行(按 生产单号+款号+物料编号 合并)
export interface PlasticIssueQuerySummaryRow {
  生产单号?: string;
  款号?: string;
  物料编号?: string;
  物料名称?: string;
  颜色?: string;
  塑胶货号?: string;
  共用物料?: string;
  共用货号?: string;
  物料类别?: string;
  单位?: string;
  数量?: number | null;
  单价?: number | null;
  金额?: number | null;
}

// ---------- 来料领料单(来料仓;三级流转:主管审核 -> 经理审核 -> 审核=出库。照抄老系统 web/src/api/materialDocs.ts("material-issues") + materialIssueQuery.ts 与后端 MaterialIssueDtos.cs) ----------

export interface MaterialIssueHeader {
  id?: number;
  ID?: number;
  单号?: string; // 电脑单号(后端生成)
  日期?: string;
  领料部门?: string;
  领料人?: string;
  仓库?: string;
  数量?: number | null;
  金额?: number | null; // 无「单价」位时后端置 null
  操作员?: string;
  审核?: string;
  审核人?: string;
  接受人?: string; // 仓管/PMC(职称),经理审完后接收该单
  备注?: string;
  // 三级流转:主管审核 -> 经理审核 -> 审核=出库(来料仓扣库存)
  主管审核?: string;
  主管审核人?: string;
  经理审核?: string;
  经理审核人?: string;
}

export interface MaterialIssueDetail {
  单头?: MaterialIssueHeader | null;
  明细: MaterialDocLine[]; // MaterialDocLineDto 含 已出数量(分次出库累计)
}

// 分次出库提交行/结果(后端 MaterialIssueOutboundLineDto/MaterialIssueOutboundResult;
// 行ID=领料明细单.ID,数量=本次出库数量(≤ 申请数量-已出数量);完成=true 时单据自动置已审核)
export interface MaterialIssueOutboundLine {
  行ID: number;
  数量: number;
}
export interface MaterialIssueOutboundResult {
  单号?: string;
  出库行数: number;
  完成: boolean;
}

// 创建载荷(后端 MaterialIssueCreateDto;操作员由后端落,单号后端生成)
export interface MaterialIssueCreate {
  领料部门?: string;
  领料人?: string;
  日期?: string;
  仓库?: string;
  接受人?: string;
  备注?: string;
  明细: MaterialDocLine[];
}

// 来料领料查询·明细行(后端 MaterialIssueQueryDetailRow;无价格列,双击 单号 看整单)
export interface MaterialIssueQueryDetailRow {
  类型?: string;
  日期?: string;
  单号?: string;
  生产单号?: string;
  款号?: string;
  领料部门?: string;
  领料人?: string;
  物料编号?: string;
  物料名称?: string;
  物料类别?: string;
  规格?: string;
  颜色?: string;
  单位?: string;
  数量?: number | null;
  备注?: string;
  审核?: string;
}

// 来料领料查询·汇总行(按 物料编号+规格+颜色 合并,领用数量)
export interface MaterialIssueSummaryRow {
  物料编号?: string;
  物料名称?: string;
  物料类别?: string;
  规格?: string;
  颜色?: string;
  单位?: string;
  领用数量?: number | null;
}

// 人事档案行(领料人选择器/接受人下拉;照抄老系统 masterApi("employees"))
export interface EmployeeRow {
  编号?: string;
  姓名?: string;
  部门编号?: string;
  职称?: string;
}

// 半成品/成品库存行(领料明细「库存」列:表头仓库=半成品仓/成品仓时;照抄老系统 semi.ts/finished.ts)
export interface SemiStockRow {
  物料编号: string;
  物料名称?: string;
  规格?: string;
  颜色?: string;
  库存: number;
}

export interface FinishedStockRow {
  配件编号: string;
  客户?: string | null;
  产品货号?: string | null;
  产品名称?: string | null;
  产品装配名称?: string | null;
  库存数量: number;
}

// 成品库存出入库流水行(/finished-inventory/ledger;结存由前端按返回顺序累计,照抄老系统 finished.ts)
export interface FinishedStockLedgerRow {
  日期?: string | null;
  单号?: string | null;
  类型: string;
  入库数量?: number | null;
  出库数量?: number | null;
}

// ---------- 塑胶侧主数据/库存选择器(照抄 web/src/api/plastic*.ts) ----------

// 塑胶库存行(库存参考面板数据源;/plastic-inventory)
export interface PlasticStockRow {
  物料编号?: string;
  物料名称?: string;
  规格?: string;
  单位?: string;
  仓库?: string;
  库存数量: number;
  物料类别?: string;
  仓位号?: string;
  颜色?: string;
  工模编号?: string;
  塑胶货号?: string;
  // 无「塑胶库存·单价」位时后端置 null(塑胶库存统计表不出价格列)
  单价?: number | null;
  金额?: number | null;
  // 已加工工序标记:有已审核入仓(订单单号指向一次加工塑胶采购订单)时带出加工内容
  已加工工序?: string;
}

// 塑胶物料设置查询结果(选物料后预填表头默认仓库;未设置后端 404)
export interface PlasticMaterialSettingLookup {
  物料编号: string;
  默认仓库?: string | null;
  损耗率?: number | null;
}

// P0 塑胶物料资料行(物料选择器;字段照抄 web/src/api/plasticMaterialMaster.ts,只留本页用到的)
export interface PlasticMaterialRow {
  id?: number;
  ID?: number;
  物料类别?: string;
  物料编号?: string;
  物料名称?: string;
  规格?: string;
  颜色?: string;
  色粉号?: string;
  用料名称?: string;
  单位?: string;
  仓位号?: string;
  库存?: number | null;
  // 装配加工采购单「下加工单」默认值:加工内容/二次加工价(照抄老系统 plasticMaterialMaster.ts)
  加工内容?: string;
  二次加工价?: number | null;
  // 塑胶物料资料页全字段(照抄老系统 PlasticMaterialRow;塑胶货号=款号,原胶件单价=单价)
  工模编号?: string;
  客户?: string;
  款号?: string;
  二次加工?: string;
  原料名称?: string;
  啤机机型?: string;
  单价?: number | null;
  销售价?: number | null;
  加工总单价?: number | null;
  其他成本?: number | null;
  整啤毛重?: number | null;
  整啤净重?: number | null;
  原胶件单净重?: number | null;
  整啤模腔数?: number | null;
  套数?: number | null;
  出模数?: number | null;
  用量?: number | null;
  水口比例?: number | null;
  模具日产量?: number | null;
  啤机价钱?: number | null;
  胶件啤工价?: number | null;
  原料单价?: number | null;
  胶件料价?: number | null;
  原胶料单价?: number | null;
  最低库存?: number | null;
  最高库存?: number | null;
  供应商编号?: string;
  供应商名称?: string;
  备注?: string;
}

export interface PlasticMaterialCategoryNode {
  编号?: string;
  类别?: string;
  数量: number;
  父级?: string;
}

// 生产制单跟踪行(生产单号/款号选择器只消费子集;字段全集照抄 web/src/api/productionReports.ts)
export interface ProductionTrackingRow {
  生产单号?: string;
  标识?: string;
  款号?: string;
  款式?: string;
  客户编号?: string;
  客户名称?: string;
  日期?: string | null;
  下单日期?: string | null;
  交货日期?: string | null;
  计划数量?: number | null;
  裁床数量?: number | null;
  录入数量?: number | null;
  未完成数?: number | null;
  装箱方式?: string;
  订单总箱数?: number | null;
  完成?: string;
  审核?: string;
  // 实单关联的MA单(非空=已关联MA,塑胶不能再对该实单下单)
  关联MA货号?: string;
}

// 货号接单汇总表行(GET /production-reports/order-summary;货号即款号)
export interface OrderSummaryRow {
  货号?: string;
  款式?: string;
  接单数量?: number | null;
  订单数: number;
}

// ---------- 装配部报表群(照抄 web/src/api/assemblyPurchaseQuery.ts / assemblyMaterialSummary.ts / factoryCategoryDetail.ts) ----------

export interface AssemblyPurchaseSummaryRow {
  单号?: string;
  收货仓库?: string;
  产品货号?: string;
  配件编号?: string;
  产品装配名称?: string;
  装配方式?: string;
  生产单号?: string;
  加工数量?: number | null;
}

export interface AssemblyPurchaseDetailRow {
  开单日期?: string;
  单号?: string;
  完成日期?: string;
  收货仓库?: string;
  供应商编号?: string;
  供应商名称?: string;
  产品货号?: string;
  配件编号?: string;
  产品装配名称?: string;
  装配方式?: string;
  生产单号?: string;
  货币?: string;
  数量?: number | null;
  备注?: string;
  审核?: string;
}

export interface AssemblyMaterialTrackingRow {
  订购日期?: string;
  订单单号?: string;
  收货仓库?: string;
  加工厂编号?: string;
  加工厂名称?: string;
  产品货号?: string;
  产品名称?: string;
  配件编号?: string;
  产品装配名称?: string;
  装配方式?: string;
  生产单号?: string;
  物料编号?: string;
  物料名称?: string;
  规格?: string;
  材料?: string;
  颜色?: string;
  单位?: string;
  单件用量?: number | null;
  加工数量?: number | null;
  需求数量?: number | null;
  已入仓数量?: number | null;
  未入仓数量?: number | null;
  审核?: string;
}

export interface AssemblyFactoryInventoryRow {
  加工厂编号?: string;
  加工厂名称?: string;
  收货仓库?: string;
  物料分类?: string;
  产品货号?: string;
  产品名称?: string;
  物料编号?: string;
  物料名称?: string;
  规格?: string;
  材料?: string;
  颜色?: string;
  单位?: string;
  领料数量?: number | null;
  送货数量?: number | null;
  库存数量?: number | null;
  最后订购日期?: string;
  领料送货截止日期?: string;
}

export interface AssemblyRequiredMaterialRow {
  日期?: string;
  单号?: string;
  收货仓库?: string;
  供应商编号?: string;
  供应商名称?: string;
  产品货号?: string;
  产品装配名称?: string;
  装配方式?: string;
  生产单号?: string;
  物料编号?: string;
  物料名称?: string;
  需领数量?: number | null;
  审核?: string;
}

export interface AssemblyFactoryCategoryMonthlyRow {
  加工厂编号?: string;
  加工厂名称?: string;
  收货仓库?: string;
  物料分类?: string;
  产品款数?: number;
  物料款数?: number;
  领料数量?: number | null;
  送货数量?: number | null;
  库存数量?: number | null;
  起始日期?: string;
  截止日期?: string;
}

export interface AssemblyMaterialSummaryRow {
  客户?: string;
  产品货号?: string;
  产品名称?: string;
  配件编号?: string;
  产品装配名称?: string;
  日期?: string;
  加工厂名称?: string;
  装配方式?: string;
  对比相差?: number | null;
  相关比例?: string;
  仓库位置?: string;
  需求用量?: number | null;
  操作员?: string;
  备注?: string;
}

export interface AssemblyMaterialDetailRow {
  客户?: string;
  产品货号?: string;
  产品名称?: string;
  配件编号?: string;
  产品装配名称?: string;
  日期?: string;
  装配方式?: string;
  物料编号?: string;
  物料名称?: string;
  规格?: string;
  材料?: string;
  颜色?: string;
  单位?: string;
  用量?: number | null;
  备注?: string;
  操作员?: string;
}

// 装配物料汇总表响应(汇总+明细一次返回)
export interface AssemblyMaterialSummaryResult {
  汇总: AssemblyMaterialSummaryRow[];
  明细: AssemblyMaterialDetailRow[];
}

export interface AssemblyMaterialSummaryParams {
  起?: string;
  止?: string;
  启用日期?: boolean;
  客户?: string;
  装配方式?: string;
  完成情况?: string;
  keyword?: string;
}

export interface FactoryCategoryDetailRow {
  加工厂类别?: string;
  加工厂编号?: string;
  加工厂名称?: string;
  单据类型?: string;
  单号?: string;
  日期?: string;
  交货日期?: string;
  客户名称?: string;
  数量?: number | null;
  金额?: number | null;
  审核?: string;
}

export interface FactoryCategoryDetailParams {
  起?: string;
  止?: string;
  类别?: string;
  加工厂?: string;
  keyword?: string;
}

// 加工厂类别树节点(加工厂分类明细表 类别下拉;GET /factory-master/categories)
export interface FactoryCategoryNode {
  类别?: string;
  数量: number;
}

// ---------- 补料单(采购订单「从补料单带入」消费;照抄 web/src/api/replenishments.ts) ----------

export interface ReplenishmentHeader {
  id?: number;
  ID?: number;
  单号?: string;
  日期?: string;
  部门?: string;
  生产单号?: string;
  款号?: string;
  仓库?: string;
  数量?: number | null;
  PMC?: string;
  操作员?: string;
  审核?: string;
  审核人?: string;
  审核时间?: string | null;
  已采购?: string;
  采购时间?: string | null;
  备注?: string;
}

export interface ReplenishmentLine {
  ID?: number;
  物料编号?: string;
  物料名称?: string;
  规格?: string;
  颜色?: string;
  单位?: string;
  数量?: number;
  备注?: string;
}

export interface ReplenishmentDetail {
  单头: ReplenishmentHeader | null;
  明细: ReplenishmentLine[];
}

// 新建补料单载荷(照抄老系统 web/src/api/replenishments.ts ReplenishmentCreate)
export interface ReplenishmentCreate {
  日期?: string;
  部门?: string;
  生产单号?: string;
  款号?: string;
  仓库?: string;
  PMC?: string;
  备注?: string;
  明细: ReplenishmentLine[];
}

// ---------- 退料单 / 报废单(来料仓;照抄老系统 materialDocs.ts + MaterialReturn/MaterialScrap DTO) ----------

// 退料/报废单头(两单据同构,仅部门/人字段名不同,用索引签名兼容)
export interface UsageDocHeader {
  id?: number;
  ID?: number;
  单号?: string; // 电脑单号(后端生成)
  日期?: string;
  退料部门?: string;
  退料人?: string;
  报废部门?: string;
  报废人?: string;
  仓库?: string;
  数量?: number | null;
  金额?: number | null; // 无单价位时后端置 null,显示 ***
  操作员?: string;
  审核?: string;
  审核人?: string;
  备注?: string;
}

export interface UsageDocDetail {
  单头: UsageDocHeader | null;
  明细: MaterialDocLine[];
}

// 退料/报废查询·明细行(无价格;双击 单号 看整单)
export interface UsageDocQueryDetailRow {
  生产单号?: string;
  款号?: string;
  日期?: string;
  单号?: string;
  退料部门?: string;
  退料人?: string;
  报废部门?: string;
  报废人?: string;
  物料编号?: string;
  物料名称?: string;
  物料类别?: string;
  规格?: string;
  颜色?: string;
  单位?: string;
  数量?: number | null;
  备注?: string;
  审核?: string;
}

// 退料/报废查询·汇总行(按 生产单号+物料编号+规格+颜色 合并;数量字段名各自不同)
export interface UsageDocQuerySummaryRow {
  生产单号?: string;
  款号?: string;
  物料编号?: string;
  物料名称?: string;
  物料类别?: string;
  规格?: string;
  颜色?: string;
  单位?: string;
  退料数量?: number | null;
  报废数量?: number | null;
}

// ---------- 库存月结(照抄老系统 web/src/api/monthEnd.ts) ----------

export interface MonthEndRow {
  年月?: string;
  仓库?: string;
  口径?: string;
  款号?: string;
  款式?: string;
  色号?: string;
  颜色?: string;
  尺码?: string;
  物料编号?: string;
  物料名称?: string;
  规格?: string;
  单位?: string;
  期初: number;
  本期入: number;
  本期出: number;
  结存: number;
  期初金额?: number | null;
  本期入金额?: number | null;
  本期出金额?: number | null;
  结存金额?: number | null;
  加权单价?: number | null;
}
export interface MonthEndCloseResult {
  结数: number;
  仓库: string[];
}

// ---------- 来料标签单(照抄老系统 web/src/api/materialLabelOrders.ts + materialLabel.ts) ----------

export interface MaterialLabelOrderLine {
  ID?: number;
  物料编号: string;
  物料名称?: string | null;
  规格?: string | null;
  颜色?: string | null;
  单位?: string | null;
  数量: number;
  标签数: number;
  备注?: string | null;
}

export interface MaterialLabelOrderSave {
  日期: string;
  备注一?: string | null;
  备注二?: string | null;
  明细: MaterialLabelOrderLine[];
}

export interface MaterialLabelOrder extends MaterialLabelOrderSave {
  ID: number;
  电脑单号?: string;
  操作员?: string;
  审核?: string;
  审核人?: string | null;
  审核时间?: string | null;
}

export interface MaterialLabelOrderListRow {
  ID: number;
  电脑单号: string;
  日期: string;
  操作员: string;
  审核: string;
  审核人: string | null;
  审核时间: string | null;
  备注一: string | null;
  备注二: string | null;
}

export interface MaterialLabelMaterialRow {
  物料编号: string;
  物料名称?: string | null;
  规格?: string | null;
  颜色?: string | null;
  单位?: string | null;
  单价?: number | null;
}

// 来料标签查询·明细行(每行一条来料标签明细,双击 电脑单号 看整单)
export interface MaterialLabelDetailRow {
  日期?: string;
  电脑单号?: string;
  物料编号?: string;
  物料名称?: string;
  物料类别?: string;
  规格?: string;
  颜色?: string;
  单位?: string;
  数量?: number | null;
  标签数?: number | null;
  备注?: string;
  审核?: string;
}

// 来料标签查询·汇总行(按 物料编号+规格+颜色 合并 数量与标签数)
export interface MaterialLabelSummaryRow {
  物料编号?: string;
  物料名称?: string;
  物料类别?: string;
  规格?: string;
  颜色?: string;
  单位?: string;
  数量?: number | null;
  标签数?: number | null;
}

// ---------- 订购单查询(照抄老系统 web/src/api/purchaseOrders.ts 的 Query 行) ----------

// 订购单查询·明细行(价格按「单价」权限后端脱敏置 null)
export interface PurchaseOrderQueryDetailRow {
  日期?: string;
  单号?: string;
  供应商编号?: string;
  供应商名称?: string;
  生产单号?: string;
  款号?: string;
  物料编号?: string;
  物料名称?: string;
  物料类别?: string;
  规格?: string;
  颜色?: string;
  单位?: string;
  数量?: number | null;
  单价?: number | null;
  金额?: number | null;
  审核?: string;
  备注?: string;
}

// 订购单查询·汇总行(按 物料编号+规格+颜色 合并 订购数量)
export interface PurchaseOrderQuerySummaryRow {
  物料编号?: string;
  物料名称?: string;
  物料类别?: string;
  规格?: string;
  颜色?: string;
  单位?: string;
  订购数量?: number | null;
}

// ---------- 主数据选择器(供应商/物料资料) ----------

export interface SupplierRow {
  供应商编号?: string;
  供应商名称?: string;
  货币?: string; // 报价默认货币(装配物料设置报价行带入)
}

export interface MasterMaterialRow {
  id?: number;
  ID?: number;
  物料类别?: string;
  物料编号?: string;
  物料名称?: string;
  规格?: string;
  颜色?: string;
  单位?: string;
  单价?: number | null;
  库存?: number | null;
  供应商编号?: string;
  供应商名称?: string;
  备注?: string;
  // 物料资料页扩展字段(照抄老系统 web/src/api/materialMaster.ts MaterialRow)
  销售价?: number | null;
  最低库存?: number | null;
  最高库存?: number | null;
  仓库位置?: string;
  款号?: string;
  货币?: string;
}

// ---------- 登录 ----------

export interface LoginResult {
  成功: boolean;
  令牌: string | null;
  消息: string | null;
}

// ---------- 消息中心 ----------

// 后端字段首字母大写;已读/读取时间为 '0'/'1' 与日期字符串(id 经 camelCase 序列化)
export interface MessageRow {
  id?: number;
  ID?: number;
  接收人?: string;
  类型?: string;
  单号?: string;
  标题?: string;
  内容?: string;
  已读?: string;
  创建时间?: string;
  读取时间?: string | null;
}

// ---------- 账号与权限(管理后台) ----------

export interface AccountRow {
  用户?: string;
  登录状态?: string;
  上次登录?: string;
  日期?: string;
  登录失败次数?: number;
  锁定到期?: string;
  已锁定?: boolean;
  最后心跳时间?: string;
  最后活动时间?: string;
  在线状态?: string;
}

export interface MenuPermRow {
  组?: string;
  菜单: string;
  打开: boolean;
  保存: boolean;
  删除: boolean;
  打印: boolean;
  单价: boolean;
  金额: boolean;
  审核: boolean;
  反审核: boolean;
  功能: boolean;
}

// 当前用户权限:菜单 -> 9 功能位(对照旧系统 web/src/auth/permissions.ts PermMap;
// /auth/me/permissions 直读 userbqrpower,含 MenuCatalog 未收录的菜单如 生产排期)
export type MyPermMap = Record<string, Partial<Record<PermBit, boolean>>>;
export type PermBit = "打开" | "保存" | "删除" | "打印" | "单价" | "金额" | "审核" | "反审核" | "功能";

// ---------- 装配加工采购单(发外加工;URL/中文字段照抄老系统 web/src/api/assemblyPurchaseOrder.ts + assemblyPurchaseQuery.ts) ----------

export interface AssemblyPurchaseOrderHeaderRow {
  id?: number;
  ID?: number;
  单号?: string;
  日期?: string;
  供应商编号?: string;
  供应商名称?: string;
  客户编号?: string;
  客户名称?: string;
  收货仓库?: string;
  电脑单号?: string;
  装配方式?: string;
  开始交货日期?: string;
  每天交货?: number | null;
  完成日期?: string;
  收货人?: string;
  单价?: number | null;
  数量?: number | null;
  金额?: number | null;
  操作员?: string;
  审核?: string;
  审核人?: string;
  审核日期?: string;
  备注?: string;
  // 三级流转:主管审核 -> 经理审核 -> 审核(下发,审核='1')
  主管审核?: string;
  主管审核人?: string;
  经理审核?: string;
  经理审核人?: string;
}

// 保存载荷·生产明细行(行级 客户编号/客户名称/装配方式/备注 可选,为空时后端回落单头;db/105)
export interface AssemblyPurchaseOrderSaveProductionLine {
  接单日期?: string;
  生产单号?: string;
  款号?: string;
  产品名称?: string;
  配件编号?: string;
  产品装配名称?: string;
  加工数量?: number | null;
  单价?: number | null;
  客户编号?: string;
  客户名称?: string;
  装配方式?: string;
  备注?: string;
}

export interface AssemblyPurchaseOrderSaveMaterialLine {
  生产单号?: string;
  款号?: string;
  物料编号?: string;
  物料名称?: string;
  单位?: string;
  用量?: number | null;
  需求数量?: number | null;
  单价?: number | null;
  备注?: string;
}

export interface AssemblyPurchaseOrderSave {
  供应商编号?: string;
  供应商名称?: string;
  客户编号?: string;
  客户名称?: string;
  出单日期?: string;
  收货仓库?: string;
  电脑单号?: string;
  装配方式?: string;
  开始交货日期?: string;
  每天交货?: number | null;
  完成日期?: string;
  收货人?: string;
  单价?: number | null;
  备注?: string;
  生产明细: AssemblyPurchaseOrderSaveProductionLine[];
  物料明细: AssemblyPurchaseOrderSaveMaterialLine[];
}

// 详情单头(打印带出:操作员 + 供应商资料联系人/电话/传真)
export interface AssemblyPurchaseOrderHeader {
  单号?: string;
  供应商编号?: string;
  供应商名称?: string;
  出单日期?: string;
  单价?: number | null;
  金额?: number | null;
  收货仓库?: string;
  电脑单号?: string;
  客户?: string;
  备注?: string;
  开始交货日期?: string;
  每天交货?: number | null;
  完成日期?: string;
  收货人?: string;
  审核?: string;
  操作员?: string;
  供应商联系人?: string;
  供应商电话?: string;
  供应商传真?: string;
  主管审核?: string;
  主管审核人?: string;
  经理审核?: string;
  经理审核人?: string;
}

// 产品明细行:行级客户为 "编号，名称" 单字符串(前端拆回 编号/名称)
export interface AssemblyPurchaseProductLine {
  客户?: string;
  产品货号?: string;
  产品装配名称?: string;
  配件编号?: string;
  装配方式?: string;
  加工数量?: number | null;
  备注?: string;
}

export interface AssemblyPurchaseProductionLine {
  接单日期?: string;
  生产单号?: string;
  产品货号?: string;
  产品名称?: string;
  配件编号?: string;
  产品装配名称?: string;
  加工数量?: number | null;
  单价?: number | null;
  金额?: number | null;
}

export interface AssemblyPurchaseAccessoryLine {
  序号?: number;
  辅料编号?: string;
  辅料名称?: string;
  加工总数量?: number | null;
  单个产品需求量?: number | null;
  需求数克?: number | null;
  需求数个?: number | null;
}

export interface AssemblyPurchaseOrderDetail {
  单头?: AssemblyPurchaseOrderHeader;
  产品明细: AssemblyPurchaseProductLine[];
  生产明细: AssemblyPurchaseProductionLine[];
  辅料表: AssemblyPurchaseAccessoryLine[];
}

// ---------- 塑胶加工采购单(发外加工;本页「下加工单」只消费 create;照抄 web/src/api/plasticProcessPurchaseOrder.ts) ----------

export interface PlasticProcessPurchaseLineCreate {
  生产单号?: string;
  款号?: string;
  模具编号?: string;
  物料编号?: string;
  物料名称?: string;
  用料名称?: string;
  颜色?: string;
  加工内容?: string;
  加工次序?: string;
  加工字母?: string;
  数量?: number;
  单价?: number | null;
  备注?: string;
}

export interface PlasticProcessPurchaseOrderCreate {
  加工厂编号?: string;
  加工厂名称?: string;
  客户名称?: string;
  // Batch 6 塑胶加工采购订单页补齐的单头字段(照抄老系统 create 载荷 {...表单值, 交货日期, 明细})
  日期?: string;
  交货日期?: string | null;
  收货仓库?: string;
  收货人?: string;
  备注?: string;
  操作员?: string;
  明细: PlasticProcessPurchaseLineCreate[];
}

// ---------- 主数据选择器(客户资料/加工厂资料/款号列表/BOM物料;照抄老系统 masterApi + styles.ts) ----------

export interface CustomerRow {
  客户编号?: string;
  客户名称?: string;
}

export interface FactoryRow {
  ID?: number;
  id?: number;
  加工厂编号?: string;
  加工厂名称?: string;
  加工厂类别?: string;
  联系人?: string;
  手机?: string;
  电话?: string;
  传真?: string;
  联系地址?: string;
  付款方式?: string;
  货币?: string;
  备注?: string;
}

// 款号列表项(GET /api/master/styles,款号资料·打开权限)
export interface StyleListItem {
  id?: number;
  ID?: number;
  款号?: string;
  款式?: string;
}

export interface StyleBomLine {
  id?: number;
  ID?: number;
  物料编号?: string;
  物料名称?: string;
  物料类别?: string | null;
  规格?: string | null;
  颜色?: string | null;
  单位?: string;
  使用数量?: number | null;
  // BOM物料设置页扩展字段(照抄老系统 web/src/api/styles.ts StyleBomLine)
  客户编号?: string | null;
  客户名称?: string | null;
  日期?: string | null;
  工模编号?: string | null;
  备注?: string | null;
}

// BOM物料设置编辑行(保存载荷明细;用量=使用数量,材料=物料类别)
export interface StyleMaterial {
  物料编号?: string | null;
  物料名称?: string | null;
  物料类别?: string | null;
  规格?: string | null;
  颜色?: string | null;
  单位?: string | null;
  使用数量?: number | null;
  工模编号?: string | null;
  备注?: string | null;
}

// 装配物料扩展(装配物料设置入口用;BOM 入口不持久化)
export interface AssemblyMaterialExtension {
  产品装配名称?: string | null;
  配件编号?: string | null;
  共用物料编号?: string | null;
  装配方式?: string | null;
  类别?: string | null;
  库存单价HK?: number | null;
  其他成本HK?: number | null;
  需求用量?: number | null;
  单位?: string | null;
  半成品计算库存?: boolean;
  备注内容?: string | null;
  调整审核?: boolean;
  审核人?: string | null;
  审核时间?: string | null;
}

export interface AssemblyMaterialQuote {
  ID?: number | null;
  物料编号?: string | null;
  物料名称?: string | null;
  合作方类型: string;
  合作方编号?: string | null;
  合作方名称?: string | null;
  报价日期?: string | null;
  货币?: string | null;
  单价?: number | null;
  港币价?: number | null;
  对比相差?: number | null;
  相差比例?: number | null;
  是否默认?: boolean;
  顺序?: number;
  备注?: string | null;
}

// BOM 台头(款号物料总表 台头行;老数据可能为 null,页面回落"第一行物料"水合)
export interface BomHead {
  日期?: string;
  客户编号?: string;
  客户名称?: string;
  单位?: string;
  默认单价?: string;
  类型?: string;
  操作员?: string;
  审核?: string;
  备注?: string;
  // 反审核申请中('1'=待经理批准)
  反审核申请?: string;
  反审核申请人?: string;
  反审核申请原因?: string;
  // 实单版关联的模板 MA 货号(MA 版为 null)
  MA货号?: string | null;
  // 有效 PO(待绑定PO号 优先,审核绑定清空后回落最近绑定);装配物料设置据此区分同货号不同实单
  PO号?: string | null;
}

// 装配BOM 领料展开一行(GET /styles/{款号}/assembly-issue):仓库=来料/塑胶
export interface AssemblyIssueRow {
  物料编号: string;
  物料名称?: string | null;
  规格?: string | null;
  颜色?: string | null;
  单位?: string | null;
  数量: number;
  仓库: string;
}

// 装配BOM 领料展开结果:行=组成物料(同物料合并);跳过半成品=无定义、无法展开的 BOM 半成品行
export interface AssemblyIssueView {
  行: AssemblyIssueRow[];
  跳过半成品: string[];
}

// BOM物料设置 轻量载入(款式+物料+单头;装配加工采购单 loadProduct/下加工单弹窗亦用)
export interface StyleMaterialsView {
  款号: string;
  款式?: string | null;
  物料: StyleBomLine[];
  扩展?: AssemblyMaterialExtension | null;
  报价?: AssemblyMaterialQuote[] | null;
  单头?: BomHead | null;
}

// BOM物料设置保存载荷(照抄老系统 BomSave):单头逐行落库,默认单价/类型 upsert 到款号物料总表
export interface BomSave {
  客户编号?: string | null;
  客户名称?: string | null;
  日期?: string | null;
  单位?: string | null;
  默认单价?: string;
  类型?: string;
  款式?: string; // 新款号保存时自动建档到款号总表(取表单产品名称)
  MA货号?: string | null; // 实单版关联的模板 MA 货号(MA 版不传/传 null)
  待绑定PO号?: string; // 排期「去建 BOM」跳入(po 参数):后端审核后自动把 BOM 绑定到该 PO
  明细: StyleMaterial[];
  扩展?: AssemblyMaterialExtension | null;
  报价?: AssemblyMaterialQuote[] | null;
}

// 已设置的半成品/成品款号(BOM 明细可调入下级半成品)
export interface SemiOption {
  款号: string;
  款式?: string | null;
  类别?: string | null;
  需求用量?: number | null;
  单位?: string | null;
}

// BOM 物料设置「设置半成品」定义(照抄老系统 web/src/api/semiSetup.ts;包装类型已并入半成品)
export type SemiSetupType = "半成品";
export interface SemiSetupLine {
  物料编号: string;
  物料名称?: string | null;
  规格?: string | null;
  颜色?: string | null;
  单位?: string | null;
  使用数量?: number | null;
}
export interface SemiSetupDef {
  ID: number;
  货号: string;
  名称: string;
  类型: SemiSetupType;
  顺序: number;
  // 用量=做 1 个成品要几个该半成品;与明细.使用数量(做 1 个半成品要多少物料)是两个层级
  用量?: number | null;
  操作员?: string | null;
  创建时间: string;
  明细: SemiSetupLine[];
}
export interface SemiSetupSave {
  货号: string;
  名称: string;
  类型: SemiSetupType;
  用量?: number | null;
  明细: SemiSetupLine[];
}

// BOM货号查询行/BOM物料查询行(照抄老系统 web/src/api/productionReports.ts)
export interface BomStyleDetailRow {
  物料编号?: string;
  物料名称?: string;
}
export interface BomStyleRow {
  款号?: string;
  款式?: string;
  单价?: number | null;
  物料项数: number;
  日期?: string | null;
  台头?: string;
  审核?: string;
  操作员?: string;
  明细?: BomStyleDetailRow[];
}
// BOM 层级树(工程部 BOM层级树页):上级链=MA货号 逐级向上;树=BOM/半成品/物料 嵌套
export interface BomTreeChainRow {
  款号?: string;
  MA货号?: string;
  款式?: string;
  客户名称?: string;
  审核?: string;
}
export interface BomTreeNode {
  类型: "BOM" | "半成品" | "物料";
  编号?: string;
  名称?: string;
  副标题?: string;
  用量?: number | null;
  审核?: string;
  明细行数?: number | null;
  下级?: BomTreeNode[];
}
export interface BomTreeResult {
  货号?: string;
  上级链: BomTreeChainRow[];
  树?: BomTreeNode | null;
}
export interface BomMaterialRow {
  款号?: string;
  款式?: string;
  物料编号?: string;
  物料名称?: string;
  物料类别?: string;
  规格?: string;
  颜色?: string;
  单位?: string;
  使用数量?: number | null;
}

// 物料档案导入结果(POST /material-master/import 等;照抄老系统 web/src/api/importResult.ts)
export interface ImportResult {
  新增: number;
  跳过: number;
  失败: number;
  失败明细: { 行号: number; 物料编号?: string; 原因: string }[];
}

// 塑胶工模表行(塑胶物料资料「选工模」带出工模字段;照抄老系统 web/src/api/plasticMold.ts)
export interface PlasticMoldRow {
  ID: number;
  工模编号?: string;
  工模名称?: string;
  颜色?: string;
  色粉号?: string;
  整啤模腔数?: number | null;
  水口比例?: number | null;
  模具日产量?: number | null;
  整啤毛重?: number | null;
  整啤净重?: number | null;
  啤机机型?: string;
  啤机价钱?: number | null;
  胶件啤工价?: number | null;
  用料名称?: string;
  胶料单价?: number | null;
  原胶料单价?: number | null;
  备注?: string;
}

// 通用主数据行(款号总表/物料资料编辑等;/master/{resource} 返回的动态字段)
export type MasterRow = Record<string, unknown> & { id?: number; ID?: number };

// ---------- 客户排期表(字段/结构照抄老系统 web/src/api/scheduling.ts) ----------

export interface ScheduleRow {
  ID: number; 批次ID?: number | null; 排期客户?: string; 状态?: string;
  接单日期?: string; 客户名称?: string; 国家?: string;
  PO号?: string; 客PO?: string; SKU?: string; 货号?: string; 品名?: string;
  数量?: number; 内箱?: number; 外箱?: number; 总箱数?: number;
  走货期?: string; 验货期?: string; 第三方验货?: string; 车间?: string;
  来源工作表?: string; 备注?: string; 原始数据?: string; 创建日期?: string; 操作员?: string;
  待审新状态?: string; // 该行有待经理审核的状态变更时=目标状态
  // MA 规则:货号 -MA 结尾=MA单(全部物料下单做半成品),否则实单(半成品做成品)
  单类型?: string;
  // 实单才有:前缀-MA 的 MA 单货号;同排期客户下存在该 MA 行时带出它的状态
  关联MA货号?: string;
  关联MA状态?: string;
  // BOM 关联:BOM 业务键=货号(一个 BOM 可供多个实单/MA单用);
  // BOM款号 空=未建 BOM;绑定PO数=该 BOM 已绑 PO 个数;已绑本PO=是否绑了本行 PO号
  BOM款号?: string;
  绑定PO数?: number;
  已绑本PO?: boolean;
}
// 状态变更申请(GET /api/scheduling/status-changes)
export interface ScheduleStatusChange {
  ID: number; 排期ID: number; 原状态?: string; 新状态?: string; 审核状态?: string;
  申请人?: string; 申请日期?: string; 审核人?: string; 审核日期?: string; 审核备注?: string;
  排期客户?: string; PO号?: string; 货号?: string; 品名?: string;
}
// 手工新增/编辑排期行(POST/PUT /api/scheduling;字段与后端 ScheduleRowSaveRequest 一致)
export interface ScheduleRowSave {
  排期客户?: string; 状态?: string; 接单日期?: string; 客户名称?: string; 国家?: string;
  PO号?: string; 客PO?: string; SKU?: string; 货号?: string; 品名?: string;
  数量?: number; 内箱?: number; 外箱?: number; 总箱数?: number;
  走货期?: string; 验货期?: string; 第三方验货?: string; 车间?: string; 备注?: string;
}
export interface ScheduleBatch {
  ID: number; 排期客户?: string; 文件名?: string; 导入日期?: string;
  操作员?: string; 新增: number; 更新: number; 行数: number; 备注?: string;
}
export interface ScheduleSummary { 排期客户?: string; 状态?: string; 行数: number; 数量?: number }
export interface ScheduleFile {
  ID: number; 排期客户?: string; 文件名?: string; 导入日期?: string; 操作员?: string;
  行数: number; 货号数: number; 在排: number; 已走货: number; 已取消: number;
}
export interface ScheduleImportResult {
  批次ID: number; 新增: number; 更新: number; 跳过: number; 失败: number;
  失败明细: { 行号: number; 物料编号?: string; 原因: string }[];
}
export interface ScheduleListParams {
  page?: number; size?: number; keyword?: string;
  排期客户?: string; 状态?: string; 走货期从?: string; 走货期至?: string; 批次ID?: number;
  单类型?: string; // MA单/实单(空=全部)
}

// ---------- Batch 4 塑胶仓群(字段照抄老系统 web/src/api/plastic*.ts) ----------

// 塑胶物料设置行(/plastic-material-settings;ID 可空=该物料未设置过,页面据此显「已设置」)
export interface PlasticMaterialSettingRow {
  ID?: number | null;
  物料编号: string;
  物料名称?: string | null;
  规格?: string | null;
  单位?: string | null;
  默认仓库?: string | null;
  损耗率?: number | null;
  备注?: string | null;
  操作员?: string | null;
  更新时间?: string | null;
}
export interface PlasticMaterialSettingSave {
  默认仓库?: string | null;
  损耗率?: number | null;
  备注?: string | null;
}

// 塑胶共用物料表行(/plastic-common-materials;CRUD 走 /master/plastic-common-materials)
export interface PlasticCommonMaterialRow {
  ID: number;
  客户?: string;
  塑胶货号?: string;
  工模编号?: string;
  物料名称?: string;
  颜色?: string;
  色粉号?: string;
  用料名称?: string;
  加工内容?: string;
  加工单价?: number | null;
  整啤净重?: number | null;
  原胶件单净重?: number | null;
  整啤模腔数?: number | null;
  套数?: number | null;
  用量?: number | null;
  物料编号?: string;
  共用原料编号?: string;
  调整审核?: string;
  备注内容?: string;
  工模表备注?: string;
  出模数?: number | null;
  水口比例?: number | null;
  整啤毛重?: number | null;
  模具日产量?: number | null;
  啤机机型?: string;
  啤机价钱?: number | null;
  胶件啤工价?: number | null;
  胶料单价?: number | null;
  原胶料单价?: number | null;
  加工总单价?: number | null;
  其它成本?: number | null;
  二次加工内容?: string;
}
export interface PlasticCommonQuery {
  客户?: string;
  塑胶货号?: string;
  工模编号?: string;
  keyword?: string;
  审核情况?: string;
  page?: number;
  size?: number;
}

// 塑胶采购订单明细行(详情/进度带出 入仓数量/欠数;打印带出 单重/整啤净重)
export interface PlasticPurchaseOrderLine {
  id?: number;
  ID?: number;
  生产单号?: string;
  款号?: string;
  物料编号?: string;
  物料名称?: string;
  模具编号?: string;
  用量?: number | null;
  套数?: number | null;
  数量?: number;
  颜色?: string;
  色粉号?: string;
  用料名称?: string;
  加工内容?: string;
  备注?: string;
  入仓数量?: number | null;
  欠数?: number | null;
  单重?: number | null;
  整啤净重?: number | null;
  // 加工单价(仅详情,委托加工合同打印用):塑胶共用物料表.加工单价 回落 塑胶物料资料.加工总单价;无单价权限为 null
  加工单价?: number | null;
  // 原料快照(啤机下单自动扣原料,随单入库):原料用量KG=数量×单件克重/1000;原料库存=实时原料仓库存
  原料编号?: string;
  原料名称?: string;
  原料用量KG?: number | null;
  原料库存?: number | null;
  // 塑胶物料资料.出模数(每啤几件):同模分组算啤数=ceil(数量/出模数)、堵模提示用
  出模数?: number | null;
}

// 塑胶采购订单分析 basis 行(塑胶共用物料表 BOM 预填;照抄 PPOBasisRow)
export interface PlasticPurchaseOrderBasisRow {
  生产单号?: string;
  款号?: string;
  物料编号?: string;
  物料名称?: string;
  模具编号?: string;
  用量?: number | null;
  套数?: number | null;
  颜色?: string;
  色粉号?: string;
  用料名称?: string;
  加工内容?: string;
  计划数量?: number | null;
  合同号?: string;
  已订数量?: number | null;
  // 阶段已订(按订单单头加工内容拆段):已订啤机=单头未选加工内容的订单合计;
  // 已订同工序=单头加工内容=本行加工内容的订单合计——下印喷单不被啤机阶段已订误判重复
  已订啤机数量?: number | null;
  已订同工序数量?: number | null;
  可用库存?: number | null;
  // 塑胶物料设置.损耗率(%):默认订购数量=计划数量×用量×(1+损耗率/100);空=0 不加成
  损耗率?: number | null;
  // 原料关联(用料名称→塑胶原料资料):啤机下单自动扣原料;单件克重=原胶件单净重(空则整啤净重/出模数)
  原料编号?: string;
  原料名称?: string;
  单件克重?: number | null;
  原料库存?: number | null;
  // 塑胶物料资料.出模数(每啤几件):同模分组算啤数、堵模提示用
  出模数?: number | null;
}

// 可二次加工库存行(二次加工下单数据源;已完成一次加工入仓且实时库存>0)
export interface SecondProcessStockRow {
  物料编号?: string;
  物料名称?: string;
  颜色?: string;
  单位?: string;
  已加工工序?: string;
  // 需求加工内容=塑胶物料资料 回落 BOM:一次加工下单选「印喷」时只显示需要印喷的件
  需求加工内容?: string;
  来源采购单号?: string;
  生产单号?: string;
  款号?: string;
  可用库存: number;
}

// 塑胶采购订单创建/更新载荷(后端 PlasticPurchaseOrderCreateDto;日期/操作员由后端落)
export interface PlasticPurchaseOrderSave {
  供应商编号?: string;
  供应商名称?: string;
  客户名称?: string;
  交货地点?: string;
  交货日期?: string | null;
  编号?: string;
  备注?: string;
  加工内容?: string;
  加工类型?: string;
  // 按库存选料的加工单(一次/二次):后端按物料汇总订购数量≤实时库存 校验
  库存加工?: boolean;
  明细: PlasticPurchaseOrderLine[];
}

// 塑胶库存月报表行(/plastic-monthly-report)
export interface PlasticMonthlyReportRow {
  物料编号?: string;
  物料名称?: string;
  规格?: string;
  颜色?: string;
  物料类别?: string;
  单位?: string;
  期初数量: number;
  本期入库: number;
  本期出库: number;
  期末数量: number;
}

// 塑胶类型客户统计行(/plastic-customer-type-stats;无「金额」位时后端金额置 null)
export interface PlasticCustomerTypeStatRow {
  客户?: string;
  类型?: string;
  数量: number;
  金额?: number | null;
}

// 塑胶退仓查询行(/plastic-warehouse-return-query;权限菜单「塑胶退仓查询」)
export interface PlasticWhReturnQueryDetailRow {
  日期?: string;
  单号?: string;
  订单单号?: string;
  生产单号?: string;
  款号?: string;
  工模编号?: string;
  物料编号?: string;
  物料名称?: string;
  颜色?: string;
  塑胶货号?: string;
  共用货号?: string;
  供应商?: string;
  单位?: string;
  数量?: number | null;
  单价?: number | null;
  金额?: number | null;
  备注?: string;
  审核?: string;
}
export interface PlasticWhReturnQuerySummaryRow {
  物料编号?: string;
  物料名称?: string;
  颜色?: string;
  塑胶货号?: string;
  共用货号?: string;
  共用物料?: string;
  物料类别?: string;
  单位?: string;
  数量?: number | null;
  金额?: number | null;
}

// 塑胶报废查询行(/plastic-scrap-query;权限菜单「塑胶报废查询」)
export interface PlasticScrapQueryDetailRow {
  日期?: string;
  单号?: string;
  生产单号?: string;
  款号?: string;
  报废部门?: string;
  报废人?: string;
  物料编号?: string;
  物料名称?: string;
  颜色?: string;
  塑胶货号?: string;
  共用物料?: string;
  共用货号?: string;
  单位?: string;
  数量?: number | null;
  单价?: number | null;
  金额?: number | null;
  备注?: string;
  审核?: string;
}
export interface PlasticScrapQuerySummaryRow {
  物料编号?: string;
  物料名称?: string;
  颜色?: string;
  塑胶货号?: string;
  共用物料?: string;
  共用货号?: string;
  物料类别?: string;
  单位?: string;
  数量?: number | null;
  单价?: number | null;
  金额?: number | null;
}

// 塑胶采购分析生产单行(/plastic-material-docs/orders;权限菜单「塑胶物料单」)
export interface PlasticOrderRow {
  ID: number;
  生产单号?: string;
  款号?: string;
  款式?: string;
  合同号?: string;
  客户名称?: string;
  计划数量?: number | null;
  日期?: string;
  交货日期?: string;
  审核?: string;
  已下单?: boolean;
  采购单号?: string | null;
}

// 加工件发外需求行(/plastic-process-demand;塑胶采购分析页「计算发外需求」)
export interface PlasticProcessDemandRow {
  生产单号?: string;
  款号?: string;
  工模编号?: string;
  物料编号?: string;
  物料名称?: string;
  颜色?: string;
  单位?: string;
  加工内容?: string;
  加工次序?: string | null;
  加工字母?: string;
  需求量?: number | null;
  白件库存?: number | null;
  已发未回?: number | null;
  需发数量?: number | null;
  出模数?: number | null;
}
export interface PlasticProcessDemandOrderLine {
  款号?: string;
  物料编号?: string;
  物料名称?: string;
  颜色?: string;
  工模编号?: string;
  加工内容?: string;
  加工次序?: string | null;
  加工字母?: string;
  数量: number;
  加工厂编号: string;
  加工厂名称?: string;
  单价?: number | null;
}
export interface PlasticProcessDemandCreateResult {
  单号列表: string[];
  跳过: number;
}

// ---------- Batch 5 半成品仓群(照抄老系统 web/src/api/semi.ts + semiFinishedLabelOrders.ts + semiFinishedCommonMaterials.ts) ----------

// 半成品共用物料表(/semi-finished-common-materials)
export interface SemiCommonMaterialQuery {
  重复内容?: string;
  待操作物料?: string;
  审核情况?: string;
  查询字段?: string;
  keyword?: string;
  精确?: boolean;
  page?: number;
  size?: number;
}
export interface SemiCommonMaterialRow {
  产品货号: string;
  客户?: string | null;
  产品名称?: string | null;
  产品装配名称?: string | null;
  库存单价?: number | null;
  配件编号?: string | null;
  共用物料编号?: string | null;
  调整审核: "已审核" | "未审核";
  备注内容?: string | null;
}

// 半成品标签单(/semi-finished-label-orders)
export interface SemiLabelOrderLine {
  ID?: number;
  配件编号: string;
  客户?: string | null;
  产品货号: string;
  产品名称?: string | null;
  产品装配名称?: string | null;
  数量: number;
  每箱数量?: number | null;
  预计标签数: number;
  实需标签数: number;
  实需标签数已手改?: boolean;
  备注?: string | null;
}
export interface SemiLabelOrderSave {
  日期: string;
  备注一?: string | null;
  备注二?: string | null;
  明细: SemiLabelOrderLine[];
}
export interface SemiLabelOrder extends SemiLabelOrderSave {
  ID: number;
  电脑单号?: string;
  操作员?: string;
  审核?: string;
  审核人?: string | null;
  审核时间?: string | null;
}
export interface SemiLabelOrderListRow {
  ID: number;
  电脑单号: string;
  日期: string;
  操作员: string;
  审核: string;
  审核人: string | null;
  审核时间: string | null;
  备注一: string | null;
  备注二: string | null;
}
// 半成品产品选择器行(标签单/入仓/出库/报废/盘点共用;老系统 SemiFinishedLabelProduct)
export interface SemiProductRow {
  ID?: number | string;
  配件编号: string;
  客户?: string | null;
  产品货号: string;
  产品名称?: string | null;
  产品装配名称?: string | null;
  生产单号?: string | null;
  数量?: number | null;
  每箱数量?: number | null;
  加工单价?: number | null;
  库存单价?: number | null;
}
export interface SemiProductQuery {
  page?: number;
  size?: number;
  field?: string;
  keyword?: string;
  exact?: boolean;
}

// 半成品标签查询(/semi-label-query)
export interface SemiLabelSummaryRow {
  配件编号?: string | null; 客户?: string | null; 产品货号?: string | null;
  产品名称?: string | null; 产品装配名称?: string | null;
  数量: number; 每箱数量?: number | null; 预计标签数: number; 实需标签数: number;
}
export interface SemiLabelDetailRow {
  日期: string; 单号?: string | null; 配件编号?: string | null; 客户?: string | null;
  产品货号?: string | null; 产品名称?: string | null; 产品装配名称?: string | null;
  数量: number; 每箱数量?: number | null; 预计标签数: number; 实需标签数: number;
  备注?: string | null; 审核?: string | null;
}

// 半成品入仓单(/semi-receipts)
export interface SRLine {
  订单单号?: string; 配件编号?: string; 客户?: string; 产品货号?: string;
  产品名称?: string; 产品装配名称?: string; 生产单号?: string | null;
  物料编号?: string; 物料名称?: string; 规格?: string; 颜色?: string;
  单位?: string; 数量: number; 单价?: number; 备注?: string;
}
export interface SRCreate {
  日期?: string; 订单单号?: string; 仓库: string; 生产单号?: string; 款号?: string;
  供应商编号?: string; 供应商名称?: string; 部门?: string; 备注?: string; 明细: SRLine[];
}
export interface SRHeader {
  id: number; 单号?: string; 订单单号?: string; 供应商编号?: string; 供应商名称?: string;
  部门?: string; 生产单号?: string; 款号?: string; 仓库?: string; 日期?: string;
  数量?: number; 金额?: number | null; 操作员?: string; 审核?: string; 备注?: string;
}
export interface SRDetail {
  单头: SRHeader | null;
  明细: (SRLine & { id: number; 金额?: number | null })[];
}
// 半成品入仓齐套检查(/semi-receipts/kit-check)
export interface SRKitLine {
  物料编号?: string | null; 物料名称?: string | null; 单位?: string | null;
  每件用量: number; 需要: number; 已回: number; 还差: number;
}
export interface SRKitResult {
  有定义: boolean; 齐套: boolean; 组成: SRKitLine[];
}
export interface SemiReceiptSummaryRow {
  配件编号?: string | null; 产品货号?: string | null; 产品名称?: string | null;
  产品装配名称?: string | null; 供应商编号?: string | null; 供应商名称?: string | null;
  入仓数量: number;
}
export interface SemiReceiptDetailRow {
  日期?: string | null; 单号?: string | null; 入库单号?: string | null; 订单单号?: string | null;
  供应商编号?: string | null; 供应商名称?: string | null; 生产单号?: string | null;
  配件编号?: string | null; 产品货号?: string | null; 产品名称?: string | null;
  产品装配名称?: string | null; 数量: number; 备注?: string | null; 审核?: string | null;
}

// 成品入仓单(/finished-receipts;照抄老系统 web/src/api/finished.ts,明细多 箱数 列)
export interface FRLine {
  订单单号?: string | null; 配件编号: string; 客户?: string | null; 产品货号?: string | null;
  产品名称?: string | null; 产品装配名称?: string | null; 生产单号?: string | null;
  箱数?: number | null; 数量: number; 单价?: number | null; 备注?: string | null;
}
export interface FRCreate {
  日期?: string; 订单单号?: string; 入库单号?: string; 仓库: string;
  供应商编号?: string; 供应商名称?: string; 备注?: string; 明细: FRLine[];
}
export interface FRHeader {
  ID?: number; id?: number; 单号?: string; 订单单号?: string | null; 入库单号?: string | null;
  供应商编号?: string | null; 供应商名称?: string | null; 仓库?: string; 日期?: string;
  数量?: number; 金额?: number | null; 操作员?: string | null; 审核?: string;
  审核人?: string | null; 备注?: string;
}
export interface FRLineRow {
  ID?: number; 订单单号?: string | null; 配件编号?: string | null; 客户?: string | null;
  产品货号?: string | null; 产品名称?: string | null; 产品装配名称?: string | null;
  生产单号?: string | null; 箱数?: number | null; 数量?: number | null;
  单价?: number | null; 金额?: number | null; 备注?: string | null;
}
export interface FRDetail {
  单头: FRHeader | null;
  明细: FRLineRow[];
}
export interface FRQSummaryRow {
  客户?: string | null; 配件编号?: string | null; 产品货号?: string | null;
  产品名称?: string | null; 产品装配名称?: string | null; 供应商编号?: string | null;
  供应商名称?: string | null; 入仓箱数: number; 入仓数量: number;
}
export interface FRQDetailRow {
  日期?: string | null; 单号?: string | null; 入库单号?: string | null; 订单单号?: string | null;
  供应商编号?: string | null; 供应商名称?: string | null; 生产单号?: string | null;
  配件编号?: string | null; 客户?: string | null; 产品货号?: string | null;
  产品名称?: string | null; 产品装配名称?: string | null; 箱数?: number | null;
  数量: number; 备注?: string | null; 审核?: string | null;
}

// 半成品出库单(领料;三级审核:主管->经理->审核;/semi-issues)
export interface SILineInput {
  配件编号: string; 客户?: string | null; 产品货号?: string | null; 产品名称?: string | null;
  产品装配名称?: string | null; 生产单号?: string | null; 数量: number; 备注?: string | null;
}
export interface SILineRow extends Partial<SILineInput> {
  ID?: number; 规格?: string | null; 颜色?: string | null; 单位?: string | null;
  单价?: number | null; 金额?: number | null;
}
export interface SICreate {
  日期?: string; 仓库: string; 部门?: string | null; 领料人?: string | null;
  拉长?: string | null; 收件人?: string | null; 领料备注?: string | null;
  件数?: number | null; 卡板数?: number | null; 制单人?: string | null;
  备注?: string | null; 明细: SILineInput[];
}
export interface SIHeader {
  ID?: number; id?: number; 单号?: string; 仓库?: string; 部门?: string | null;
  领料人?: string | null; 拉长?: string | null; 收件人?: string | null;
  领料备注?: string | null; 件数?: number | null; 卡板数?: number | null;
  制单人?: string | null; 日期?: string; 审核日期?: string | null;
  数量?: number | null; 金额?: number | null; 操作员?: string | null;
  审核?: string; 审核人?: string | null;
  主管审核?: string | null; 主管审核人?: string | null;
  经理审核?: string | null; 经理审核人?: string | null; 备注?: string | null;
}
export interface SIDetail { 单头: SIHeader | null; 明细: SILineRow[] }
export interface SemiIssueSummaryRow {
  领料备注?: string | null; 装配采购?: string | null; 配件编号?: string | null;
  产品货号?: string | null; 产品名称?: string | null; 产品装配名称?: string | null;
  领料数量: number; 备注?: string | null;
}
export interface SemiIssueDetailRow {
  领料备注?: string | null; 装配采购?: string | null; 日期?: string | null;
  单号?: string | null; 领料人?: string | null; 生产单号?: string | null;
  配件编号?: string | null; 产品货号?: string | null; 产品名称?: string | null;
  产品装配名称?: string | null; 数量: number; 备注?: string | null;
  制单人?: string | null; 审核?: string | null;
}

// 半成品报废单(/semi-scraps;无价,库存 -)
export interface SSDocHeader {
  ID?: number; id?: number; 单号?: string; 仓库?: string; 部门?: string | null;
  报废人?: string | null; 日期?: string; 审核日期?: string | null;
  数量?: number | null; 金额?: number | null; 操作员?: string | null;
  审核?: string; 审核人?: string | null; 备注?: string | null;
}
export interface SSDocDetail { 单头: SSDocHeader | null; 明细: SILineRow[] }
export interface SemiScrapSummaryRow {
  配件编号?: string | null; 产品货号?: string | null; 产品名称?: string | null;
  产品装配名称?: string | null; 报废数量: number;
}
export interface SemiScrapDetailRow {
  日期?: string | null; 单号?: string | null; 仓库?: string | null;
  报废部门?: string | null; 报废人?: string | null; 配件编号?: string | null;
  产品货号?: string | null; 产品名称?: string | null; 产品装配名称?: string | null;
  数量: number; 备注?: string | null; 审核?: string | null;
}

// 半成品盘点单(/semi-stocktakes)
export interface STKBasisRow { 物料编号?: string; 物料名称?: string; 规格?: string; 颜色?: string | null; 系统数量: number }
export interface STKLineInput {
  配件编号: string; 客户?: string | null; 产品货号?: string | null; 产品名称?: string | null;
  产品装配名称?: string | null; 系统数量: number; 盘点数量: number; 备注?: string | null;
}
export interface STKLineRow extends Partial<STKLineInput> { ID?: number; 盈亏数量?: number | null }
export interface STKCreate { 日期?: string; 仓库: string; 备注?: string | null; 明细: STKLineInput[] }
export interface STKHeader {
  ID?: number; id?: number; 单号?: string; 仓库?: string; 日期?: string;
  系统数量?: number | null; 盘点数量?: number | null; 盈亏数量?: number | null;
  操作员?: string | null; 审核?: string; 审核人?: string | null; 备注?: string | null;
}
export interface STKDetail { 单头: STKHeader | null; 明细: STKLineRow[] }
export interface SemiStkQuerySummaryRow {
  配件编号?: string | null; 产品货号?: string | null; 产品名称?: string | null;
  产品装配名称?: string | null; 系统数: number; 盘点数: number; 盈亏数: number;
}
export interface SemiStkQueryDetailRow {
  日期?: string | null; 单号?: string | null; 配件编号?: string | null;
  产品货号?: string | null; 产品名称?: string | null; 产品装配名称?: string | null;
  系统数量: number; 盘点数量: number; 盈亏数量: number; 备注?: string | null; 审核?: string | null;
}

// 半成品库存统计表/月报表(/semi-inventory/report|monthly)
export interface SemiInvReportRow {
  配件编号?: string | null; 客户?: string | null; 产品货号?: string | null;
  产品名称?: string | null; 产品装配名称?: string | null; 库存数量: number; 仓库位置?: string | null;
}
export interface SemiMonthlyRow {
  配件编号?: string | null; 客户?: string | null; 产品货号?: string | null;
  产品名称?: string | null; 产品装配名称?: string | null;
  期初库存: number; 本期入库: number; 本期出库: number; 本期报废: number;
  盘点盈亏: number; 期末库存: number;
}

// 半成品查询页签共用筛选参数(老系统各 query params 的并集;qs 跳过空值)
export interface SemiQueryParams {
  起日期?: string;
  止日期?: string;
  field?: string;
  keyword?: string;
  exact?: boolean;
  审核?: string;
  客户?: string;
  领料备注?: string;
  制单人?: string;
  materialOnly?: boolean;
  bySupplier?: boolean;
  byOrderNo?: boolean;
  byIssueRemark?: boolean;
}
export interface SemiInvReportQuery {
  仓库?: string;
  field?: string;
  keyword?: string;
  exact?: boolean;
  includeZero?: boolean;
  showAll?: boolean;
}
export interface SemiMonthlyQuery {
  起日期?: string;
  止日期?: string;
  仓库?: string;
  field?: string;
  keyword?: string;
  exact?: boolean;
}

// ---------- Batch 6 喷油/加工群(照抄老系统 web/src/api/{plasticProcessOrderMake,plasticWhitePartIssue,plasticProcessPurchaseOrder,purchaseMaterialSettings,productionReports}.ts) ----------

// 塑胶加工采购单(发外加工;权限菜单「塑胶加工采购单」,MenuCatalog.cs:20 实证:发外加工组)
export interface PPPOLine {
  id?: number;
  生产单号?: string;
  款号?: string;
  模具编号?: string;
  物料编号?: string;
  物料名称?: string;
  用料名称?: string;
  颜色?: string;
  加工内容?: string;
  加工次序?: string;
  加工字母?: string;
  数量?: number;
  单价?: number | null;
  金额?: number | null;
  备注?: string;
}
export interface PPPOHeader {
  id?: number;
  ID?: number;
  单号?: string;
  日期?: string;
  交货日期?: string;
  加工厂编号?: string;
  加工厂名称?: string;
  客户名称?: string;
  收货仓库?: string;
  收货人?: string;
  数量?: number | null;
  金额?: number | null;
  操作员?: string;
  审核?: string;
  审核人?: string;
  备注?: string;
  // 三级流转:主管审核 -> 经理审核 -> 审核(下发,审核='1')
  主管审核?: string;
  主管审核人?: string;
  经理审核?: string;
  经理审核人?: string;
}
export interface PPPODetail {
  单头?: PPPOHeader;
  明细: PPPOLine[];
}
export interface PPPOBasisRow {
  生产单号?: string;
  款号?: string;
  模具编号?: string;
  物料编号?: string;
  物料名称?: string;
  用料名称?: string;
  颜色?: string;
  加工内容?: string;
  二次加工内容?: string;
  二次加工类别?: string;
  单价?: number | null;
}

// 白件领料单(发外加工:白件领给加工厂;权限菜单「白件领料单」,MenuCatalog.cs:23 实证)
export interface WPILine {
  id?: number;
  发外采购?: string;
  生产单号?: string;
  款号?: string;
  物料编号?: string;
  模具编号?: string;
  物料名称?: string;
  颜色?: string;
  用料名称?: string;
  单位?: string;
  数量?: number;
  备注?: string;
}
export interface WPIHeader {
  id?: number;
  ID?: number;
  单号?: string;
  日期?: string;
  领料部门?: string;
  领料人?: string;
  胶箱数?: number | null;
  卡板数?: number | null;
  领料备注?: string;
  数量?: number | null;
  操作员?: string;
  电脑单号?: string;
  审核?: string;
  审核人?: string;
  备注?: string;
  // 三级流转:主管审核 -> 经理审核 -> 审核(下发)
  主管审核?: string;
  主管审核人?: string;
  经理审核?: string;
  经理审核人?: string;
}
export interface WPIDetail {
  单头?: WPIHeader;
  明细: WPILine[];
}
export interface WPIBasisRow {
  生产单号?: string;
  款号?: string;
  模具编号?: string;
  物料编号?: string;
  物料名称?: string;
  颜色?: string;
  用料名称?: string;
  单位?: string;
}

// 塑胶加工订单制作(喷油部;权限菜单「塑胶加工订单制作」,MenuCatalog.cs:19 实证)
export interface PlasticProcessOrderMakeRow {
  单据日期?: string;
  生产单号?: string;
  款号?: string;
  塑胶货号?: string;
  工模编号?: string;
  物料编号?: string;
  物料名称?: string;
  颜色?: string;
  色粉号?: string;
  加工内容?: string;
  二次加工内容?: string;
  二次加工类别?: string;
  加工次序?: string;
  加工字母?: string;
  用料名称?: string;
  单位?: string;
  用量?: number | null;
  计划数量?: number | null;
  订购数量?: number | null;
  加工单价?: number | null;
  金额?: number | null;
}
// 已下喷油订单行(喷油部收件:已审核塑胶采购订单中供应商含「喷油」的单,按明细行展开)
export interface SprayOrderReceivedRow {
  采购单号?: string;
  单据日期?: string;
  交货日期?: string;
  供应商名称?: string;
  生产单号?: string;
  款号?: string;
  物料编号?: string;
  物料名称?: string;
  模具编号?: string;
  颜色?: string;
  色粉号?: string;
  用料名称?: string;
  数量?: number | null;
  备注?: string;
  塑胶货号?: string;
  加工内容?: string;
  喷油接收?: string;
  喷油接收人?: string;
  喷油接收时间?: string;
}

// 采购物料分析行(生产制单;权限菜单「生产制单」,MenuCatalog.cs:15 实证:业务单据组)
export interface PurchaseAnalysisRow {
  ID: number; // 生产BOM物料清单.ID(详情页修改回写键)
  制单日期?: string | null;
  生产单号?: string;
  款号?: string;
  合同号?: string;
  物料编号?: string;
  物料名称?: string;
  规格?: string;
  颜色?: string;
  单位?: string;
  总数量?: number | null;
  库存数量?: number | null;
  可用库存?: number | null;
  需订数量?: number | null;
  预算单价?: number | null;
  金额?: number | null;
  供应商编号?: string;
  供应商名称?: string;
  // 该生产单下此物料已累计下单数量:>=需订=已下满(详情页锁「已下单」)
  已订数量?: number | null;
}
// 采购分析明细保存(详情页):仅分析未审核可改
export interface PurchaseAnalysisSaveLine {
  ID: number;
  需订数量?: number;
  供应商编号?: string;
}
export interface PurchaseAnalysisSave {
  生产单号: string;
  明细: PurchaseAnalysisSaveLine[];
  // 绑定供应商时同步写物料默认供应商(日后新单自动带出);解绑不同步
  同步物料默认供应商?: boolean;
}

// BOM订单制作工作表行(权限菜单「生产制单」;生成采购订单再校验「采购订单·保存」位)
export interface OrderWorksheetRow {
  生产单号?: string;
  款号?: string;
  物料编号?: string;
  物料名称?: string;
  规格?: string;
  颜色?: string;
  单位?: string;
  总数量?: number | null;
  库存数量?: number | null;
  可用库存?: number | null;
  需订数量?: number | null;
  预算单价?: number | null;
  供应商编号?: string;
  供应商名称?: string;
}

// 采购物料设置(权限菜单「采购物料设置」,MenuCatalog.cs:106 实证:物料管理组)
export interface PurchaseMaterialSettingRow {
  ID?: number | null;
  物料编号: string;
  物料名称?: string | null;
  规格?: string | null;
  单位?: string | null;
  默认供应商?: string | null;
  最小订量?: number | null;
  采购损耗率?: number | null;
  备注?: string | null;
  操作员?: string | null;
  更新时间?: string | null;
}
export interface PurchaseMaterialSettingSave {
  默认供应商?: string | null;
  最小订量?: number | null;
  采购损耗率?: number | null;
  备注?: string | null;
}

// ---------- Batch 7 原料仓群(类型逐字对照老系统 web/src/api/plasticRawMaterial*.ts) ----------

// 塑胶原料资料(权限菜单「塑胶原料资料表」,MenuCatalog.cs:14 实证:基础资料组)
export interface PlasticRawMaterialCategoryNode {
  类别?: string;
  数量: number;
}

export interface PlasticRawMaterialRow {
  ID: number;
  物料类别?: string;
  物料编号?: string;
  物料名称?: string;
  规格?: string;
  颜色?: string;
  单位?: string;
  仓位号?: string;
  商品名称?: string;
  单价?: number | null;
  销售价?: number | null;
  起订量?: number | null;
  安全库存?: number | null;
  库存?: number | null;
  最低库存?: number | null;
  最高库存?: number | null;
  供应商编号?: string;
  供应商名称?: string;
  产地?: string;
  每包重量?: number | null;
  备注?: string;
}

// 原料库存统计表行(displayMode: stock=只显示库存数 / zero=零库存 / all=全部)
export interface RawMaterialInventoryRow {
  原料编号?: string;
  原料名称?: string;
  产地?: string;
  每包重量?: number | null;
  单位?: string;
  库存数量: number;
  物料类别?: string;
  有发生: boolean;
}

// 原料库存月报表行
export interface RawMaterialMonthlyRow {
  原料编号?: string;
  原料名称?: string;
  产地?: string;
  每包重量?: number | null;
  单位?: string;
  期初库存: number;
  本期入库: number;
  本期出库: number;
  盘点盈亏: number;
  期末库存: number;
  外发库存: number;
  物料类别?: string;
}

// 原料采购分析表行(可购数量>0 红)
export interface RawPurchaseAnalysisRow {
  原料编号?: string;
  原料名称?: string;
  规格?: string;
  物料类别?: string;
  单位?: string;
  当前库存?: number | null;
  安全库存?: number | null;
  生产需求?: number | null;
  在途数量?: number | null;
  可购数量?: number | null;
}

// 原料生产需求表(权限菜单「原料生产需求表」;单级审核)
export interface RMDLine {
  id?: number;
  原料编号?: string;
  原料名称?: string;
  每包重量?: number | null;
  单位?: string;
  需求数量KG?: number;
  需求数量包?: number;
  备注?: string;
}
export interface RMDHeader {
  id: number;
  单号?: string;
  啤机生产单号?: string;
  开单日期?: string;
  制单人?: string;
  领料备注?: string;
  生产车间?: string;
  操作员?: string;
  数量KG?: number | null;
  数量包?: number | null;
  审核?: string;
  审核人?: string;
  备注?: string;
}
export interface RMDDetail {
  单头?: RMDHeader;
  明细: RMDLine[];
}
// 原料生产需求汇总行(权限菜单「原料生产需求汇总」)
export interface RMDSummaryRow {
  单号: string;
  开单日期?: string;
  生产车间?: string;
  领料备注?: string;
  啤机生产单号?: string;
  原料编号?: string;
  原料名称?: string;
  每包重量?: number | null;
  单位?: string;
  需求数量KG: number;
  需求数量包: number;
  备注?: string;
  制单人?: string;
  操作员?: string;
  审核?: string;
}

// 原料采购订单(权限菜单「原料采购订单」;三级流转:主管审核 -> 经理审核 -> 审核=下发)
export interface RMPOLine {
  id?: number;
  原料编号?: string;
  原料名称?: string;
  规格?: string;
  单位?: string;
  单价类型?: string;
  订货数量?: number;
  单价?: number | null;
  金额?: number | null;
  备注?: string;
}
export interface RMPOHeader {
  id: number;
  单号?: string;
  供应商编号?: string;
  供应商名称?: string;
  订购日期?: string;
  交货日期?: string;
  数量?: number | null;
  金额?: number | null;
  操作员?: string;
  审核?: string;
  审核人?: string;
  备注?: string;
  主管审核?: string;
  主管审核人?: string;
  经理审核?: string;
  经理审核人?: string;
}
export interface RMPODetail {
  单头?: RMPOHeader;
  明细: RMPOLine[];
}

// 原料采购进度表行(gate 同「原料采购订单·打开」,对照老系统注释)
export interface RawPurchaseProgressRow {
  订购日期?: string;
  交货日期?: string;
  采购单号?: string;
  供应商编号?: string;
  供应商名称?: string;
  原料编号?: string;
  原料名称?: string;
  规格?: string;
  单位?: string;
  单价类型?: string;
  订货数量?: number | null;
  入仓数量?: number | null;
  欠数?: number | null;
  进度?: number | null;
  操作员?: string;
  审核?: string;
  备注?: string;
}

// 原料入仓单(权限菜单「原料入仓单」;单级审核=入库存)
export interface RMRLine {
  id?: number;
  原料编号?: string;
  原料名称?: string;
  产地?: string;
  每包重量?: number | null;
  单价类型?: string;
  单位?: string;
  数量?: number;
  单价?: number | null;
  金额?: number | null;
  备注?: string;
  备品?: string; // "1"=供应商多送的备品(允许超订单入库,不占订单欠数)
}
export interface RMRHeader {
  id: number;
  单号?: string;
  供应商编号?: string;
  供应商名称?: string;
  日期?: string;
  电脑单号?: string;
  订单单号?: string;
  单价类型?: string;
  数量?: number | null;
  金额?: number | null;
  操作员?: string;
  审核?: string;
  审核人?: string;
  备注?: string;
}
export interface RMRDetail {
  单头?: RMRHeader;
  明细: RMRLine[];
}

// 原料入仓查询(权限菜单「原料入仓查询」;无「单价」位不出价格列)
export interface RawReceiptQuerySummaryRow {
  原料编号?: string;
  原料名称?: string;
  产地?: string;
  单位?: string;
  入仓数量?: number | null;
  金额?: number | null;
}
export interface RawReceiptQueryDetailRow {
  日期?: string;
  单号?: string;
  入库单号?: string;
  订单单号?: string;
  供应商编号?: string;
  供应商名称?: string;
  原料编号?: string;
  原料名称?: string;
  产地?: string;
  单价类型?: string;
  单位?: string;
  数量?: number | null;
  单价?: number | null;
  金额?: number | null;
  备注?: string;
  审核?: string;
}

// 原料出库表(权限菜单「原料出库表」;三级流转:主管审核 -> 经理审核 -> 审核=下发)
export interface RSILine {
  id?: number;
  啤机生产单号?: string;
  生产单号?: string; // 联动生产制单.生产单号(与啤机生产单号并存,语义不同)
  开单日期?: string;
  啤机外发单号?: string;
  原料编号?: string;
  原料名称?: string;
  产地?: string;
  每包重量?: number | null;
  单位?: string;
  数量?: number;
  备注?: string;
}
export interface RSIHeader {
  id: number;
  单号?: string;
  生产车间?: string;
  日期?: string;
  电脑单号?: string;
  领料备注?: string;
  制单人?: string;
  操作员?: string;
  数量?: number | null;
  审核?: string;
  审核人?: string;
  备注?: string;
  主管审核?: string;
  主管审核人?: string;
  经理审核?: string;
  经理审核人?: string;
}
export interface RSIDetail {
  单头?: RSIHeader;
  明细: RSILine[];
}

// 原料出库查询(权限菜单「原料出库查询」;比通用查询多 领料备注/制单人 过滤)
export interface RawStockIssueQuerySummaryRow {
  领料备注?: string;
  开单日期?: string;
  啤机生产单号?: string;
  啤机外发单号?: string;
  原料编号?: string;
  原料名称?: string;
  产地?: string;
  单位?: string;
  领料数量包?: number | null;
  备注?: string;
}
export interface RawStockIssueQueryDetailRow {
  领料备注?: string;
  开单日期?: string;
  啤机生产单号?: string;
  日期?: string;
  审核日期?: string;
  单号?: string;
  生产车间?: string;
  啤机外发单号?: string;
  原料编号?: string;
  原料名称?: string;
  产地?: string;
  单位?: string;
  数量包?: number | null;
  备注?: string;
  制单人?: string;
  审核?: string;
}

// 原料盘点单(权限菜单「原料盘点单」;审核=盘点过账校准库存)
export interface RSTLine {
  id?: number;
  原料编号?: string;
  原料名称?: string;
  产地?: string;
  每包重量?: number | null;
  单位?: string;
  系统数量?: number;
  盘点数量?: number;
  盈亏数量?: number;
  备注?: string;
}
export interface RSTHeader {
  id: number;
  单号?: string;
  日期?: string;
  电脑单号?: string;
  操作员?: string;
  审核?: string;
  审核人?: string;
  备注?: string;
}
export interface RSTDetail {
  单头?: RSTHeader;
  明细: RSTLine[];
}

// 原料盘点查询(权限菜单「原料盘点查询」)
export interface RawStocktakeQuerySummaryRow {
  原料编号?: string;
  原料名称?: string;
  产地?: string;
  单位?: string;
  系统数?: number | null;
  盘点数?: number | null;
  盈亏数?: number | null;
}
export interface RawStocktakeQueryDetailRow {
  日期?: string;
  单号?: string;
  原料编号?: string;
  原料名称?: string;
  产地?: string;
  单位?: string;
  系统数量?: number | null;
  盘点数量?: number | null;
  盈亏数量?: number | null;
  备注?: string;
  审核?: string;
}

// 原料订货入库统计行(分组列:订货情况/入库情况/相关情况)
export interface RawOrderReceiptStatRow {
  订购日期?: string;
  交货日期?: string;
  订购单号?: string;
  供应商名称?: string;
  原料编号?: string;
  原料名称?: string;
  单位?: string;
  采购单价?: number | null;
  单价HKDLb?: number | null;
  其他成本单价HKDLb?: number | null;
  订货数量包: number;
  订货金额HKD: number;
  入库数量包: number;
  入库订货金额HKD: number;
  入库其他费用HKD: number;
  入库金额合计HKD: number;
  相关数量包: number;
  相关金额HKD: number;
}


// ---------- Batch 9 基础设置 + 工具项 ----------

// 键值型设置项(基本资料/功能设置;照抄 web/src/api/systemSettings.ts SettingItem)
export interface SettingItem {
  键: string;
  标签: string;
  值?: string | null;
}

// 系统版本信息(网上升级;照抄 web/src/api/adminTools.ts VersionInfo)
export interface VersionInfo {
  版本?: string;
  信息版本?: string;
  框架?: string;
  环境?: string;
}

// 备份结果(备份数据;服务端 BACKUP DATABASE 返回文件路径)
export interface BackupResult {
  文件?: string;
  消息?: string;
}

// 仓库位置设置行(仓库/仓位主数据,物料资料.仓位号 引用;照抄 web/src/api/systemMasters.ts)
export interface WarehouseLocationRow {
  id: number;
  编号?: string;
  名称?: string;
  备注?: string;
}

// 啤机机型啤工行(机型 + 啤工价主数据,工模表.啤机机型 引用)
export interface InjectionMachineRateRow {
  id: number;
  啤机机型?: string;
  啤工价?: number | null;
  备注?: string;
}
