namespace ErpApi.Features.Orders;

// 一行色×码数量
public sealed class OrderLineDto
{
    public string? 色号 { get; set; }
    public string? 颜色 { get; set; }
    public string? 尺码 { get; set; }
    public decimal 数量 { get; set; }
}

// 新建订单（一单一款：成品客户订单总表.单号 是 UNIQUE）
public sealed class OrderCreateDto
{
    public string 客户编号 { get; set; } = "";
    public string? 客户名称 { get; set; }
    public DateTime? 交货日期 { get; set; }
    public string? 仓库 { get; set; }
    public string 款号 { get; set; } = "";
    public string? 款式 { get; set; }
    public decimal? 单价 { get; set; }
    public string? 合同号 { get; set; }
    public string? 客户款号 { get; set; }
    public string? 备注 { get; set; }
    public List<OrderLineDto> 明细 { get; set; } = [];
}

// 列表行（订货单财务头；Dapper 按列名映射）
public sealed class OrderHeaderDto
{
    public long ID { get; set; }
    public string? 单号 { get; set; }
    public DateTime? 日期 { get; set; }
    public DateTime? 交货日期 { get; set; }
    public string? 客户编号 { get; set; }
    public string? 客户名称 { get; set; }
    public string? 仓库 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 操作员 { get; set; }
    public string? 审核 { get; set; }
    public string? 审核人 { get; set; }
    public string? 备注 { get; set; }
}

// 款号头（订单总表）
public sealed class OrderStyleDto
{
    public string? 单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 款式 { get; set; }
    public string? 生产单号 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 单价 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 颜色组 { get; set; }
    public string? 尺码组 { get; set; }
    public string? 合同号 { get; set; }
    public string? 客户款号 { get; set; }
}

// 明细行（色×码）
public sealed class OrderLineRowDto
{
    public long ID { get; set; }
    public string? 色号 { get; set; }
    public string? 颜色 { get; set; }
    public string? 尺码 { get; set; }
    public decimal? 数量 { get; set; }
    public decimal? 单价 { get; set; }
    public decimal? 金额 { get; set; }
}

// 详情 = 财务头 + 款号头 + 明细行
public sealed class OrderDetailDto
{
    public OrderHeaderDto? 订货单 { get; set; }
    public OrderStyleDto? 总表 { get; set; }
    public List<OrderLineRowDto> 明细 { get; set; } = [];
}
