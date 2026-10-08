using System.ComponentModel.DataAnnotations.Schema;
namespace ErpApi.Data.Entities;

[Table("供应商类别")]
public sealed class 供应商类别 : MasterEntity
{
    [Column("供应商类别")] public string? 类别 { get; set; }
    [Column("供应商名称")] public string? 名称 { get; set; }
}
