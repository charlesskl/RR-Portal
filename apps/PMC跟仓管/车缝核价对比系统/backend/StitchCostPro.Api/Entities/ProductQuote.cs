using Microsoft.EntityFrameworkCore;

namespace StitchCostPro.Api.Entities;

/// <summary>产品价格库：一行 = 一个具体款式。所有价格均为人民币不含税单价。</summary>
public class ProductQuote : AuditableEntity
{
    public int QuoteId { get; set; }
    public int ProductId { get; set; }
    public string? CustomerName { get; set; }                       // 客户仅作参考
    [Precision(14, 4)] public decimal? CustomerQuoteExcl { get; set; } // 报客价
    [Precision(14, 4)] public decimal InternalPriceExcl { get; set; }  // 本厂核价
    [Precision(14, 4)] public decimal? DongguanPriceExcl { get; set; } // 外发东莞参考价
    [Precision(14, 4)] public decimal? HunanPriceExcl { get; set; }    // 外发湖南参考价
    public string? Remark { get; set; }
    public int DeptId { get; set; }
}
