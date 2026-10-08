using System.ComponentModel.DataAnnotations.Schema;
namespace ErpApi.Data.Entities;

[Table("客户资料")]
public sealed class 客户资料 : MasterEntity
{
    [Column("客户类别")] public string? 客户类别 { get; set; }
    [Column("客户编号")] public string? 客户编号 { get; set; }
    [Column("客户名称")] public string? 客户名称 { get; set; }
    [Column("联系人")] public string? 联系人 { get; set; }
    [Column("手机")] public string? 手机 { get; set; }
    [Column("电话")] public string? 电话 { get; set; }
    [Column("联系地址")] public string? 联系地址 { get; set; }
    [Column("付款方式")] public string? 付款方式 { get; set; }
    [Column("备注")] public string? 备注 { get; set; }
}
