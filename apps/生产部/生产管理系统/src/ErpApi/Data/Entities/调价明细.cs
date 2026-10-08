using System.ComponentModel.DataAnnotations.Schema;
namespace ErpApi.Data.Entities;

[Table("调价明细表")]
public sealed class 调价明细 : MasterEntity
{
    [Column("单号")] public string? 单号 { get; set; }
    [Column("日期")] public DateTime? 日期 { get; set; }
    [Column("物料类别")] public string? 物料类别 { get; set; }
    [Column("物料编号")] public string? 物料编号 { get; set; }
    [Column("物料名称")] public string? 物料名称 { get; set; }
    [Column("规格")] public string? 规格 { get; set; }
    [Column("颜色")] public string? 颜色 { get; set; }
    [Column("单位")] public string? 单位 { get; set; }
    [Column("原单价"), PriceField] public decimal? 原单价 { get; set; }
    [Column("修改单价"), PriceField] public decimal? 修改单价 { get; set; }
    [Column("修改原因")] public string? 修改原因 { get; set; }
}
