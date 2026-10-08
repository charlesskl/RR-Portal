using System.ComponentModel.DataAnnotations.Schema;
namespace ErpApi.Data.Entities;

[Table("发外加工项目")]
public sealed class 发外加工项目 : MasterEntity
{
    [Column("加工项目")] public string? 加工项目 { get; set; }
    [Column("单价"), PriceField] public decimal? 单价 { get; set; }
    [Column("备注")] public string? 备注 { get; set; }
}
