using System.ComponentModel.DataAnnotations;
using ErpApi.Features.MasterData;

namespace ErpApi.Features.Warehouse.Semi.Labels;

public sealed class SemiFinishedLabelOrderLineDto
{
    public long? ID { get; set; }
    [StringLength(80)]
    public string 配件编号 { get; set; } = "";
    [StringLength(160)]
    public string? 客户 { get; set; }
    [StringLength(120)]
    public string 产品货号 { get; set; } = "";
    [StringLength(240)]
    public string? 产品名称 { get; set; }
    [StringLength(240)]
    public string? 产品装配名称 { get; set; }
    [Decimal18_4]
    public decimal 数量 { get; set; }
    [Decimal18_4]
    public decimal? 每箱数量 { get; set; }
    [Range(0, int.MaxValue)]
    public int 预计标签数 { get; set; }
    [Range(0, int.MaxValue)]
    public int 实需标签数 { get; set; }
    public bool 实需标签数已手改 { get; set; }
    [StringLength(500)]
    public string? 备注 { get; set; }
}

public sealed class SemiFinishedLabelOrderSaveDto
{
    public DateTime 日期 { get; set; }
    [StringLength(500)]
    public string? 备注一 { get; set; }
    [StringLength(500)]
    public string? 备注二 { get; set; }
    public List<SemiFinishedLabelOrderLineDto?> 明细 { get; set; } = [];
}

public sealed class SemiFinishedLabelOrderDto
{
    public long ID { get; set; }
    public string 电脑单号 { get; set; } = "";
    public DateTime 日期 { get; set; }
    public string? 备注一 { get; set; }
    public string? 备注二 { get; set; }
    public string 操作员 { get; set; } = "";
    public string 审核 { get; set; } = "0";
    public string? 审核人 { get; set; }
    public DateTime? 审核时间 { get; set; }
    public List<SemiFinishedLabelOrderLineDto> 明细 { get; set; } = [];
}

public sealed class SemiFinishedLabelOrderListRow
{
    public long ID { get; set; }
    public string 电脑单号 { get; set; } = "";
    public DateTime 日期 { get; set; }
    public string 操作员 { get; set; } = "";
    public string 审核 { get; set; } = "0";
    public string? 审核人 { get; set; }
    public DateTime? 审核时间 { get; set; }
    public string? 备注一 { get; set; }
    public string? 备注二 { get; set; }
}

public sealed class SemiFinishedLabelProductQuery
{
    public int Page { get; set; } = 1;
    public int Size { get; set; } = 20;
    public string? Field { get; set; }
    public string? Keyword { get; set; }
    public bool Exact { get; set; }
}

public sealed class SemiFinishedLabelProductRow
{
    public string 配件编号 { get; set; } = "";
    public string? 产品装配名称 { get; set; }
    public string? 客户 { get; set; }
    public string 产品货号 { get; set; } = "";
    public string? 产品名称 { get; set; }
    public decimal? 加工单价 { get; set; }
    public decimal? 库存单价 { get; set; }
    public decimal? 每箱数量 { get; set; }
}

public enum AdjacentDirection { Previous, Next }

[AttributeUsage(AttributeTargets.Property | AttributeTargets.Field | AttributeTargets.Parameter)]
public sealed class Decimal18_4Attribute : ValidationAttribute
{
    private const decimal MaxValue = 99_999_999_999_999.9999m;

    public Decimal18_4Attribute() : base("{0} 必须是 decimal(18,4) 范围内的非负数，且最多四位小数。") { }

    public override bool IsValid(object? value)
        => value is null || value is decimal number
            && number >= 0
            && number <= MaxValue
            && number == decimal.Round(number, 4);
}
