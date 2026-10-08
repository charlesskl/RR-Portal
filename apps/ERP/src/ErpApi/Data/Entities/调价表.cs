using System.ComponentModel.DataAnnotations.Schema;
namespace ErpApi.Data.Entities;

[Table("调价表")]
public sealed class 调价表 : MasterEntity
{
    [Column("单号")] public string? 单号 { get; set; }
    [Column("日期")] public DateTime? 日期 { get; set; }
    [Column("操作员")] public string? 操作员 { get; set; }
    [Column("审核")] public string? 审核 { get; set; }
    [Column("备注")] public string? 备注 { get; set; }
}
