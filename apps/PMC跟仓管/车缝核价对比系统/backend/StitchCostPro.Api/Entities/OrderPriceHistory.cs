using Microsoft.EntityFrameworkCore;

namespace StitchCostPro.Api.Entities;

/// <summary>订单产品外发价变更历史：首次核价和每次改价均留痕。</summary>
public class OrderPriceHistory
{
    public int HistoryId { get; set; }
    public int LineId { get; set; }
    [Precision(14, 4)] public decimal? OldPriceExcl { get; set; }
    [Precision(14, 4)] public decimal NewPriceExcl { get; set; }
    public string? ChangeReason { get; set; }
    public int? ChangedBy { get; set; }
    public DateTime ChangedAt { get; set; }
}
