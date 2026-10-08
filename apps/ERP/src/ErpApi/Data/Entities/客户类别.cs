using System.ComponentModel.DataAnnotations.Schema;
namespace ErpApi.Data.Entities;

[Table("客户类别")]
public sealed class 客户类别 : MasterEntity
{
    [Column("客户类别")] public string? 类别 { get; set; }
    [Column("客户名称")] public string? 名称 { get; set; }
}
