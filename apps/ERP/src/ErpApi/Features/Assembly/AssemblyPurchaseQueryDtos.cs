namespace ErpApi.Features.Assembly;

public sealed class AssemblyPurchaseSummaryRow
{
    public string? 单号 { get; set; }
    public string? 收货仓库 { get; set; }
    public string? 产品货号 { get; set; }
    public string? 配件编号 { get; set; }
    public string? 产品装配名称 { get; set; }
    public string? 装配方式 { get; set; }
    public string? 生产单号 { get; set; }
    public decimal? 加工数量 { get; set; }
}

public sealed class AssemblyPurchaseDetailRow
{
    public DateTime? 开单日期 { get; set; }
    public string? 单号 { get; set; }
    public DateTime? 完成日期 { get; set; }
    public string? 收货仓库 { get; set; }
    public string? 供应商编号 { get; set; }
    public string? 供应商名称 { get; set; }
    public string? 产品货号 { get; set; }
    public string? 配件编号 { get; set; }
    public string? 产品装配名称 { get; set; }
    public string? 装配方式 { get; set; }
    public string? 生产单号 { get; set; }
    public string? 货币 { get; set; }
    public decimal? 数量 { get; set; }
    public string? 备注 { get; set; }
    public string? 审核 { get; set; }
}

public sealed class AssemblyMaterialTrackingRow
{
    public DateTime? 订购日期 { get; set; }
    public string? 订单单号 { get; set; }
    public string? 收货仓库 { get; set; }
    public string? 加工厂编号 { get; set; }
    public string? 加工厂名称 { get; set; }
    public string? 产品货号 { get; set; }
    public string? 产品名称 { get; set; }
    public string? 配件编号 { get; set; }
    public string? 产品装配名称 { get; set; }
    public string? 装配方式 { get; set; }
    public string? 生产单号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 材料 { get; set; }
    public string? 颜色 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 单件用量 { get; set; }
    public decimal? 加工数量 { get; set; }
    public decimal? 需求数量 { get; set; }
    public decimal? 已入仓数量 { get; set; }
    public decimal? 未入仓数量 { get; set; }
    public string? 审核 { get; set; }
}

public sealed class AssemblyFactoryInventoryRow
{
    public string? 加工厂编号 { get; set; }
    public string? 加工厂名称 { get; set; }
    public string? 收货仓库 { get; set; }
    public string? 物料分类 { get; set; }
    public string? 产品货号 { get; set; }
    public string? 产品名称 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 材料 { get; set; }
    public string? 颜色 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 领料数量 { get; set; }
    public decimal? 送货数量 { get; set; }
    public decimal? 库存数量 { get; set; }
    public DateTime? 最后订购日期 { get; set; }
    public DateTime? 领料送货截止日期 { get; set; }
}

public sealed class AssemblyRequiredMaterialRow
{
    public DateTime? 日期 { get; set; }
    public string? 单号 { get; set; }
    public string? 收货仓库 { get; set; }
    public string? 供应商编号 { get; set; }
    public string? 供应商名称 { get; set; }
    public string? 产品货号 { get; set; }
    public string? 产品装配名称 { get; set; }
    public string? 装配方式 { get; set; }
    public string? 生产单号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public decimal? 需领数量 { get; set; }
    public string? 审核 { get; set; }
}

public sealed class AuxiliaryIssueProgressRow
{
    public DateTime? 开单日期 { get; set; }
    public string? 装配生产单号 { get; set; }
    public string? 领料备注 { get; set; }
    public string? 辅料编号 { get; set; }
    public string? 辅料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 需求数量 { get; set; }
    public decimal? 已领数量 { get; set; }
    public decimal? 未领数量 { get; set; }
    public string? 操作员 { get; set; }
}

public sealed class AssemblyFactoryCategoryMonthlyRow
{
    public string? 加工厂编号 { get; set; }
    public string? 加工厂名称 { get; set; }
    public string? 收货仓库 { get; set; }
    public string? 物料分类 { get; set; }
    public int 产品款数 { get; set; }
    public int 物料款数 { get; set; }
    public decimal? 领料数量 { get; set; }
    public decimal? 送货数量 { get; set; }
    public decimal? 库存数量 { get; set; }
    public DateTime? 起始日期 { get; set; }
    public DateTime? 截止日期 { get; set; }
}

public sealed class AssemblyPurchaseOrderHeaderDto
{
    public string? 单号 { get; set; }
    public string? 供应商编号 { get; set; }
    public string? 供应商名称 { get; set; }
    public DateTime? 出单日期 { get; set; }
    public decimal? 单价 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 收货仓库 { get; set; }
    public string? 电脑单号 { get; set; }
    public string? 客户 { get; set; }
    public string? 备注 { get; set; }
    public DateTime? 开始交货日期 { get; set; }
    public decimal? 每天交货 { get; set; }
    public DateTime? 完成日期 { get; set; }
    public string? 收货人 { get; set; }
    public string? 审核 { get; set; }
    // 三级流转:主管审核 → 经理审核 → 审核(下发,审核='1');前端据此切换 审核按钮/流程条
    public string? 主管审核 { get; set; }
    public string? 主管审核人 { get; set; }
    public string? 经理审核 { get; set; }
    public string? 经理审核人 { get; set; }
    // 详情带出(打印用):操作员 + 供应商资料联系人/电话/传真
    public string? 操作员 { get; set; }
    public string? 供应商联系人 { get; set; }
    public string? 供应商电话 { get; set; }
    public string? 供应商传真 { get; set; }
}

public sealed class AssemblyPurchaseProductLineDto
{
    public string? 客户 { get; set; }
    public string? 产品货号 { get; set; }
    public string? 产品装配名称 { get; set; }
    public string? 配件编号 { get; set; }
    public string? 装配方式 { get; set; }
    public decimal? 加工数量 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class AssemblyPurchaseProductionLineDto
{
    public DateTime? 接单日期 { get; set; }
    public string? 生产单号 { get; set; }
    public string? 产品货号 { get; set; }
    public string? 产品名称 { get; set; }
    public string? 配件编号 { get; set; }
    public string? 产品装配名称 { get; set; }
    public decimal? 加工数量 { get; set; }
    public decimal? 单价 { get; set; }
    public decimal? 金额 { get; set; }
}

public sealed class AssemblyPurchaseAccessoryLineDto
{
    public int 序号 { get; set; }
    public string? 辅料编号 { get; set; }
    public string? 辅料名称 { get; set; }
    public decimal? 加工总数量 { get; set; }
    public decimal? 单个产品需求量 { get; set; }
    public decimal? 需求数克 { get; set; }
    public decimal? 需求数个 { get; set; }
}

public sealed class AssemblyPurchaseOrderDetailDto
{
    public AssemblyPurchaseOrderHeaderDto? 单头 { get; set; }
    public List<AssemblyPurchaseProductLineDto> 产品明细 { get; set; } = new();
    public List<AssemblyPurchaseProductionLineDto> 生产明细 { get; set; } = new();
    public List<AssemblyPurchaseAccessoryLineDto> 辅料表 { get; set; } = new();
}
