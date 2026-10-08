using System.ComponentModel.DataAnnotations.Schema;
namespace ErpApi.Data.Entities;

[Table("款号总表")]
public sealed class 款号总表 : MasterEntity
{
    [Column("款号")] public string? 款号 { get; set; }
    [Column("款式")] public string? 款式 { get; set; }
    [Column("单价"), PriceField] public decimal? 单价 { get; set; }
    [Column("成本价"), PriceField] public decimal? 成本价 { get; set; }
    [Column("批发价"), PriceField] public decimal? 批发价 { get; set; }
    [Column("零售价"), PriceField] public decimal? 零售价 { get; set; }
}
