using System.ComponentModel.DataAnnotations.Schema;
namespace ErpApi.Data.Entities;

[Table("部门信息")]
public sealed class 部门信息 : MasterEntity
{
    [Column("编号")] public string? 编号 { get; set; }
    [Column("部门")] public string? 部门 { get; set; }
    [Column("备注")] public string? 备注 { get; set; }
}
