using Microsoft.EntityFrameworkCore;
using System.ComponentModel.DataAnnotations;

namespace StitchCostPro.Api.Entities;

/// <summary>采购订单明细行：一行 = 订单中的一个款式。</summary>
public class PurchaseOrderLine
{
    public int LineId { get; set; }
    [MaxLength(100)] public string? ContractNo { get; set; }
    public int OrderId { get; set; }                                  // 所属订单
    public int ProductId { get; set; }                               // 具体款式
    [Precision(14, 2)] public decimal? Qty { get; set; }             // 数量
    public string? Unit { get; set; }                                // 单位
    [Precision(14, 4)] public decimal? OutsourcePriceExcl { get; set; } // 订单实际外发价(不含税)；空=待核价
    [Precision(14, 4)] public decimal? CustomerQuoteExcl { get; set; }  // 报客价快照
    [Precision(14, 4)] public decimal? InternalPriceExcl { get; set; }  // 本厂核价快照
    [Precision(14, 4)] public decimal? DongguanPriceExcl { get; set; }  // 东莞参考价快照
    [Precision(14, 4)] public decimal? HunanPriceExcl { get; set; }     // 湖南参考价快照
    public string? ExtMainId { get; set; }                            // 总部订单记录 id（总部同步幂等键）
    public DateTime? SourceUpdatedAt { get; set; }                    // 总部 updated_at 快照(UTC)

    public PurchaseOrder? Order { get; set; }
}
