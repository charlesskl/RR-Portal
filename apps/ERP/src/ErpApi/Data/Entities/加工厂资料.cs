using System.ComponentModel.DataAnnotations.Schema;
namespace ErpApi.Data.Entities;

[Table("加工厂资料")]
public sealed class 加工厂资料 : MasterEntity
{
    [Column("加工厂类别")] public string? 加工厂类别 { get; set; }
    [Column("加工厂编号")] public string? 加工厂编号 { get; set; }
    [Column("加工厂名称")] public string? 加工厂名称 { get; set; }
    [Column("联系人")] public string? 联系人 { get; set; }
    [Column("手机")] public string? 手机 { get; set; }
    [Column("电话")] public string? 电话 { get; set; }
    [Column("传真")] public string? 传真 { get; set; }
    [Column("联系地址")] public string? 联系地址 { get; set; }
    [Column("付款方式")] public string? 付款方式 { get; set; }
    [Column("货币")] public string? 货币 { get; set; }
    [Column("备注")] public string? 备注 { get; set; }
}
