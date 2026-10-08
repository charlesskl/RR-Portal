using System.ComponentModel.DataAnnotations.Schema;
namespace ErpApi.Data.Entities;

[Table("物料类别")]
public sealed class 物料类别 : MasterEntity
{
    [Column("编号")] public string? 编号 { get; set; }
    [Column("名称")] public string? 名称 { get; set; }
    [Column("类别")] public string? 类别 { get; set; }
    [Column("备注")] public string? 备注 { get; set; }
}
