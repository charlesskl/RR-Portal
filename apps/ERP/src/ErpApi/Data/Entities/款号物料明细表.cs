using System.ComponentModel.DataAnnotations.Schema;
namespace ErpApi.Data.Entities;

[Table("款号物料明细表")]
public sealed class 款号物料明细表 : MasterEntity
{
    [Column("日期")] public DateTime? 日期 { get; set; }
    [Column("顺序")] public string? 顺序 { get; set; }
    [Column("客户编号")] public string? 客户编号 { get; set; }
    [Column("客户名称")] public string? 客户名称 { get; set; }
    [Column("款号")] public string? 款号 { get; set; }
    [Column("款式")] public string? 款式 { get; set; }
    [Column("物料类别")] public string? 物料类别 { get; set; }
    [Column("物料编号")] public string? 物料编号 { get; set; }
    [Column("物料名称")] public string? 物料名称 { get; set; }
    [Column("规格")] public string? 规格 { get; set; }
    [Column("颜色")] public string? 颜色 { get; set; }
    [Column("单位")] public string? 单位 { get; set; }
    [Column("使用数量")] public decimal? 使用数量 { get; set; }
    [Column("工模编号")] public string? 工模编号 { get; set; }
    [Column("备注")] public string? 备注 { get; set; }
}
