namespace ErpApi.Features.Assembly;

public sealed class AssemblyPurchaseOrderHeaderRow
{
    public long ID { get; set; }
    public string 单号 { get; set; } = "";
    public DateTime? 日期 { get; set; }
    public string? 供应商编号 { get; set; }
    public string? 供应商名称 { get; set; }
    public string? 客户编号 { get; set; }
    public string? 客户名称 { get; set; }
    public string? 收货仓库 { get; set; }
    public string? 电脑单号 { get; set; }
    public string? 装配方式 { get; set; }
    public DateTime? 开始交货日期 { get; set; }
    public decimal? 每天交货 { get; set; }
    public DateTime? 完成日期 { get; set; }
    public string? 收货人 { get; set; }
    public decimal? 单价 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 操作员 { get; set; }
    public string? 审核 { get; set; }
    public string? 审核人 { get; set; }
    public DateTime? 审核日期 { get; set; }
    public string? 备注 { get; set; }
    // 三级流转:主管审核 → 经理审核 → 审核(下发,审核='1')
    public string? 主管审核 { get; set; }
    public string? 主管审核人 { get; set; }
    public string? 经理审核 { get; set; }
    public string? 经理审核人 { get; set; }
    // 供应商资料带出(仅 GetAsync 详情,打印用)
    public string? 供应商联系人 { get; set; }
    public string? 供应商电话 { get; set; }
    public string? 供应商传真 { get; set; }
}

public sealed class AssemblyPurchaseOrderMaterialLineDto
{
    public int 行号 { get; set; }
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 用量 { get; set; }
    public decimal? 需求数量 { get; set; }
    public decimal? 单价 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class AssemblyPurchaseOrderProductionLineDto
{
    public int 行号 { get; set; }
    public string? 接单日期 { get; set; }
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 产品名称 { get; set; }
    public string? 配件编号 { get; set; }
    public string? 产品装配名称 { get; set; }
    public decimal? 加工数量 { get; set; }
    public decimal? 单价 { get; set; }
    public decimal? 金额 { get; set; }
    // 行级客户/装配方式/备注(105 起): 为空时取单回落单头
    public string? 客户编号 { get; set; }
    public string? 客户名称 { get; set; }
    public string? 装配方式 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class AssemblyPurchaseOrderSaveLineDto
{
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 用量 { get; set; }
    public decimal? 需求数量 { get; set; }
    public decimal? 单价 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class AssemblyPurchaseOrderSaveProductionLineDto
{
    public string? 接单日期 { get; set; }
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 产品名称 { get; set; }
    public string? 配件编号 { get; set; }
    public string? 产品装配名称 { get; set; }
    public decimal? 加工数量 { get; set; }
    public decimal? 单价 { get; set; }
    // 行级客户/装配方式/备注(105 起,可选): 为空时取单回落单头
    public string? 客户编号 { get; set; }
    public string? 客户名称 { get; set; }
    public string? 装配方式 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class AssemblyPurchaseOrderSaveDto
{
    public string? 供应商编号 { get; set; }
    public string? 供应商名称 { get; set; }
    public string? 客户编号 { get; set; }
    public string? 客户名称 { get; set; }
    public DateTime? 出单日期 { get; set; }
    public string? 收货仓库 { get; set; }
    public string? 电脑单号 { get; set; }
    public string? 装配方式 { get; set; }
    public DateTime? 开始交货日期 { get; set; }
    public decimal? 每天交货 { get; set; }
    public DateTime? 完成日期 { get; set; }
    public string? 收货人 { get; set; }
    public decimal? 单价 { get; set; }
    public string? 备注 { get; set; }
    public List<AssemblyPurchaseOrderSaveProductionLineDto> 生产明细 { get; set; } = new();
    public List<AssemblyPurchaseOrderSaveLineDto> 物料明细 { get; set; } = new();
}
