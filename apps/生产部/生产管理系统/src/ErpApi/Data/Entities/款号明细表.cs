using System.ComponentModel.DataAnnotations.Schema;
namespace ErpApi.Data.Entities;

[Table("款号明细表")]
public sealed class 款号明细表 : MasterEntity
{
    [Column("款号")] public string? 款号 { get; set; }
    [Column("款式")] public string? 款式 { get; set; }
    [Column("工序号")] public string? 工序号 { get; set; }
    [Column("工序名称")] public string? 工序名称 { get; set; }
    [Column("单价"), PriceField] public decimal? 单价 { get; set; }
    [Column("工序类型")] public string? 工序类型 { get; set; }
    [Column("备注")] public string? 备注 { get; set; }
}
