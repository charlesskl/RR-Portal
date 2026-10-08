namespace ErpApi.Features.Plastics.PlasticPurchaseOrder;

public sealed class PlasticPurchaseOrderHeaderDto
{
    public long ID { get; set; }
    public string 单号 { get; set; } = "";
    public DateTime? 日期 { get; set; }
    public DateTime? 交货日期 { get; set; }
    public string? 供应商编号 { get; set; }
    public string? 供应商名称 { get; set; }
    public string? 客户名称 { get; set; }
    public string? 交货地点 { get; set; }
    public string? 编号 { get; set; }
    public decimal? 数量 { get; set; }
    public string? 操作员 { get; set; }
    public string? 审核 { get; set; }
    public string? 审核人 { get; set; }
    public string? 备注 { get; set; }
    // 单头加工内容：喷油供应商订单必选，选项来自 塑胶物料资料/塑胶共用物料表.加工内容 去重值
    public string? 加工内容 { get; set; }
    // 加工类型：一次加工(默认)/二次加工。按库存选料的二次加工单只能挑选已完成一次加工入仓且有库存的物料;
    // 按生产单 BOM 带料的一次/二次加工单不受库存限制(不用等上道入仓,可同时下单)
    public string? 加工类型 { get; set; }
    // 三级流转:主管审核 → 经理审核 → 审核(下发,审核='1')
    public string? 主管审核 { get; set; }
    public string? 主管审核人 { get; set; }
    public string? 经理审核 { get; set; }
    public string? 经理审核人 { get; set; }
    // 供应商资料带出(仅 GetAsync 详情,打印用)
    public string? 供应商联系人 { get; set; }
    public string? 供应商电话 { get; set; }
    public string? 供应商传真 { get; set; }
    public string? 供应商联系地址 { get; set; }
}

public sealed class PlasticPurchaseOrderLineDto
{
    public long ID { get; set; }
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 模具编号 { get; set; }
    public decimal? 用量 { get; set; }
    public decimal? 套数 { get; set; }
    public decimal 数量 { get; set; }
    public string? 颜色 { get; set; }
    public string? 色粉号 { get; set; }
    public string? 用料名称 { get; set; }
    // 加工内容(优先 塑胶物料资料，回落 塑胶共用物料表 BOM)：含「喷油」的行供喷油供应商下单时过滤带入
    public string? 加工内容 { get; set; }
    public string? 备注 { get; set; }
    // 详情/进度带出(不入库):已审核入仓数量 与 欠数=订购−入仓
    public decimal? 入仓数量 { get; set; }
    public decimal? 欠数 { get; set; }
    // 塑胶物料资料带出(仅 GetAsync 详情,打印用):单件净重(克)=原胶件单净重;整啤净重(克)供啤货表
    public decimal? 单重 { get; set; }
    public decimal? 整啤净重 { get; set; }
    // 加工单价(仅 GetAsync 详情,委托加工合同打印用):塑胶共用物料表.加工单价,回落 塑胶物料资料.加工总单价;
    // 无「单价」权限时控制器置 null(打印单价/金额列留空)
    public decimal? 加工单价 { get; set; }
    // 原料快照(仅啤机单=未选加工内容的一次加工单,随单入库):用料名称→塑胶原料资料;原料用量KG=数量×单件克重/1000
    // 印喷/二次加工单不消耗原料,快照一律留空
    public string? 原料编号 { get; set; }
    public string? 原料名称 { get; set; }
    public decimal? 原料用量KG { get; set; }
    // 原料实时库存(仅 GetAsync 详情,不入库):原料扣减汇总面板用
    public decimal? 原料库存 { get; set; }
    // 塑胶物料资料.出模数(仅 basis/详情,不入库):同模分组算啤数、堵模提示用
    public decimal? 出模数 { get; set; }
}

public sealed class PlasticPurchaseOrderDetailDto
{
    public PlasticPurchaseOrderHeaderDto? 单头 { get; set; }
    public List<PlasticPurchaseOrderLineDto> 明细 { get; set; } = new();
}

public sealed class PlasticPurchaseOrderCreateLineDto
{
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 模具编号 { get; set; }
    public decimal? 用量 { get; set; }
    public decimal? 套数 { get; set; }
    public decimal 数量 { get; set; }
    public string? 颜色 { get; set; }
    public string? 色粉号 { get; set; }
    public string? 用料名称 { get; set; }
    public string? 加工内容 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class PlasticPurchaseOrderCreateDto
{
    public string? 供应商编号 { get; set; }
    public string? 供应商名称 { get; set; }
    public string? 客户名称 { get; set; }
    public DateTime? 交货日期 { get; set; }
    public string? 交货地点 { get; set; }
    public string? 编号 { get; set; }
    public string? 备注 { get; set; }
    // 单头加工内容：供应商名称含「喷油」时必填，其他供应商可空
    public string? 加工内容 { get; set; }
    // 加工类型：一次加工(默认)/二次加工。二次加工单明细必须已完成一次加工(有加工内容)入仓且库存足够
    public string? 加工类型 { get; set; }
    // 按库存选料的加工单(啤机单产出下一次加工/一次加工产出入仓后下二次加工):按物料汇总订购数量不得超过实时库存
    public bool 库存加工 { get; set; }
    public List<PlasticPurchaseOrderCreateLineDto> 明细 { get; set; } = new();
}

// 可加工库存行:已审核入仓明细.订单单号 指向 加工类型='一次加工' 的塑胶采购订单,按阶段区分——
// 阶段=一次加工 取未选加工内容的啤机单产出,阶段=二次加工 取已选加工内容的一次加工单产出;实时库存>0。
// 已加工工序=来源订单的加工内容快照(啤机产出为空);需求加工内容=塑胶物料资料 回落 BOM(选印喷只显示需要印喷的件)。
public sealed class SecondProcessStockRow
{
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 颜色 { get; set; }
    public string? 单位 { get; set; }
    public string? 已加工工序 { get; set; }
    public string? 需求加工内容 { get; set; }
    public string? 来源采购单号 { get; set; }
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    // 实时塑胶库存(物料级,库存引擎聚合)：二次加工订购数量不得超过它
    public decimal 可用库存 { get; set; }
}

public sealed class PlasticPurchaseOrderBasisRow
{
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 模具编号 { get; set; }
    public decimal? 用量 { get; set; }
    public decimal? 套数 { get; set; }
    public string? 颜色 { get; set; }
    public string? 色粉号 { get; set; }
    public string? 用料名称 { get; set; }
    // 加工内容(优先 塑胶物料资料，回落 塑胶共用物料表 BOM)：含「喷油」的行供喷油供应商下单时过滤带入
    public string? 加工内容 { get; set; }
    // 生产制单带出：计划数量(默认订购数量=计划数量×用量)、合同号(客户合同号即PO号,自动填入表头 编号)
    public decimal? 计划数量 { get; set; }
    public string? 合同号 { get; set; }
    // 该生产单下此物料(含颜色匹配)已累计下单的数量，>0 即"已下单"（防重复下单）
    public decimal? 已订数量 { get; set; }
    // 阶段已订:已订数量按订单单头加工内容拆段——啤机=单头未选加工内容的订单合计;
    // 同工序=单头加工内容=本行加工内容的订单合计。下印喷单不被啤机阶段已订误判重复
    public decimal? 已订啤机数量 { get; set; }
    public decimal? 已订同工序数量 { get; set; }
    // 实时塑胶仓库存(库存引擎聚合,非快照)：>=需求(计划数量×用量) 时前端默认不勾选下单
    public decimal? 可用库存 { get; set; }
    // 塑胶物料设置.损耗率(%):前端默认订购数量=计划数量×用量×(1+损耗率/100);空=0 不加成
    public decimal? 损耗率 { get; set; }
    // 原料关联(用料名称→塑胶原料资料):啤机下单自动扣原料;单件克重=原胶件单净重(空则整啤净重/出模数)
    public string? 原料编号 { get; set; }
    public string? 原料名称 { get; set; }
    public decimal? 单件克重 { get; set; }
    // 原料实时库存(库存引擎聚合):前端原料扣减汇总用
    public decimal? 原料库存 { get; set; }
    // 塑胶物料资料.出模数(每啤几件):同模分组算啤数=ceil(数量/出模数)、堵模提示用
    public decimal? 出模数 { get; set; }
}

public sealed class PlasticPurchaseProgressRow
{
    public DateTime? 订购日期 { get; set; }
    public DateTime? 交货日期 { get; set; }
    public string? 采购单号 { get; set; }
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 模具编号 { get; set; }
    public string? 颜色 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 订购数量 { get; set; }
    public decimal? 入仓数量 { get; set; }
    public decimal? 欠数 { get; set; }
    public string? 供应商名称 { get; set; }
    public string? 审核 { get; set; }
}

public sealed class PlasticPurchaseProgressDetailRow
{
    public DateTime? 订购日期 { get; set; }
    public DateTime? 交货日期 { get; set; }
    public string? 采购单号 { get; set; }
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 模具编号 { get; set; }
    public string? 颜色 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 订购数量 { get; set; }
    public decimal? 入仓数量 { get; set; }
    public decimal? 欠数 { get; set; }
    public DateTime? 入仓日期 { get; set; }
    public string? 入仓单号 { get; set; }
    public string? 完成情况 { get; set; }
    public string? 供应商名称 { get; set; }
    public string? 审核 { get; set; }
}
