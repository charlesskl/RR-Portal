using System.ComponentModel.DataAnnotations.Schema;
namespace ErpApi.Data.Entities;

[Table("加工厂类别")]
public sealed class 加工厂类别 : MasterEntity
{
    [Column("加工厂类别")] public string? 类别 { get; set; }
    [Column("加工厂名称")] public string? 名称 { get; set; }
}
