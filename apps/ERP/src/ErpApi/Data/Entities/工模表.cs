using System.ComponentModel.DataAnnotations.Schema;
namespace ErpApi.Data.Entities;

[Table("工模表")]
public sealed class 工模表 : MasterEntity
{
    [Column("工模编号")] public string? 工模编号 { get; set; }
    [Column("客户")] public string? 客户 { get; set; }
    [Column("工模名称")] public string? 工模名称 { get; set; }
    [Column("整啤套数")] public decimal? 整啤套数 { get; set; }
    [Column("颜色")] public string? 颜色 { get; set; }
    [Column("色粉号")] public string? 色粉号 { get; set; }
    [Column("整啤模腔数")] public decimal? 整啤模腔数 { get; set; }
    [Column("水口比例")] public decimal? 水口比例 { get; set; }
    [Column("模具日产量")] public decimal? 模具日产量 { get; set; }
    [Column("整啤毛重")] public decimal? 整啤毛重 { get; set; }
    [Column("整啤净重")] public decimal? 整啤净重 { get; set; }
    [Column("啤机机型")] public string? 啤机机型 { get; set; }
    [Column("啤机价钱"), PriceField] public decimal? 啤机价钱 { get; set; }
    [Column("胶件啤工价"), PriceField] public decimal? 胶件啤工价 { get; set; }
    [Column("用料名称")] public string? 用料名称 { get; set; }
    [Column("胶料单价"), PriceField] public decimal? 胶料单价 { get; set; }
    [Column("原胶料单价"), PriceField] public decimal? 原胶料单价 { get; set; }
    [Column("备注")] public string? 备注 { get; set; }
}
