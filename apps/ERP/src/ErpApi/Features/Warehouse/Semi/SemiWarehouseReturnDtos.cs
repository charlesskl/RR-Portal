using ErpApi.Features.MasterData;

namespace ErpApi.Features.Warehouse.Semi;

public sealed class SemiWarehouseReturnLineInput
{
    public string 配件编号 { get; set; } = "";
    public string? 客户 { get; set; }
    public string? 产品货号 { get; set; }
    public string? 产品名称 { get; set; }
    public string? 产品装配名称 { get; set; }
    public string? 生产单号 { get; set; }
    public decimal 数量 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class SemiWarehouseReturnCreateDto
{
    public string 入仓单号 { get; set; } = "";
    public DateTime? 日期 { get; set; }
    public string? 供应商编号 { get; set; }
    public string? 供应商名称 { get; set; }
    public string 仓库 { get; set; } = "";
    public string? 备注 { get; set; }
    public List<SemiWarehouseReturnLineInput> 明细 { get; set; } = [];
}

public sealed class SemiWarehouseReturnHeaderDto
{
    public long ID { get; set; }
    public string 单号 { get; set; } = "";
    public string 入仓单号 { get; set; } = "";
    public DateTime 日期 { get; set; }
    public string? 供应商编号 { get; set; }
    public string? 供应商名称 { get; set; }
    public string 仓库 { get; set; } = "";
    public decimal 数量 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 操作员 { get; set; }
    public string? 审核 { get; set; }
    public string? 审核人 { get; set; }
    public DateTime? 审核日期 { get; set; }
    public string? 备注 { get; set; }
}

public class SemiWarehouseReturnBasisRow
{
    public long 入仓明细ID { get; set; }
    public string? 订单单号 { get; set; }
    public string? 客户 { get; set; }
    public string? 生产单号 { get; set; }
    public string? 产品货号 { get; set; }
    public string? 产品名称 { get; set; }
    public string? 配件编号 { get; set; }
    public string? 产品装配名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 颜色 { get; set; }
    public string? 单位 { get; set; }
    public decimal 原入仓数量 { get; set; }
    public decimal 已退数量 { get; set; }
    public decimal 可退数量 { get; set; }
    public decimal? 单价 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class SemiWarehouseReturnLineRowDto : SemiWarehouseReturnBasisRow
{
    public long ID { get; set; }
    public decimal 数量 { get; set; }
    public decimal? 金额 { get; set; }
}

public sealed class SemiWarehouseReturnDetailDto
{
    public SemiWarehouseReturnHeaderDto 单头 { get; set; } = new();
    public List<SemiWarehouseReturnLineRowDto> 明细 { get; set; } = [];
}

public sealed class SemiWarehouseReturnProductQuery
{
    public int Page { get; set; } = 1;
    public int Size { get; set; } = 50;
    public string? Field { get; set; }
    public string? Keyword { get; set; }
    public bool Exact { get; set; }
}

public sealed class SemiWarehouseReturnProductRow
{
    public string 配件编号 { get; set; } = "";
    public string? 客户 { get; set; }
    public string? 产品货号 { get; set; }
    public string? 产品名称 { get; set; }
    public string? 产品装配名称 { get; set; }
    public string? 生产单号 { get; set; }
    public decimal? 加工单价 { get; set; }
    public decimal? 库存单价 { get; set; }
}
