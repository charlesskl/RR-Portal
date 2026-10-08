using System.ComponentModel.DataAnnotations.Schema;
namespace ErpApi.Data.Entities;

[Table("塑胶共用物料表")]
public sealed class 塑胶共用物料表 : MasterEntity
{
    [Column("客户")] public string? 客户 { get; set; }
    [Column("塑胶货号")] public string? 塑胶货号 { get; set; }
    [Column("工模编号")] public string? 工模编号 { get; set; }
    [Column("物料名称")] public string? 物料名称 { get; set; }
    [Column("颜色")] public string? 颜色 { get; set; }
    [Column("色粉号")] public string? 色粉号 { get; set; }
    [Column("用料名称")] public string? 用料名称 { get; set; }
    [Column("加工内容")] public string? 加工内容 { get; set; }
    [Column("加工单价"), PriceField] public decimal? 加工单价 { get; set; }
    [Column("整啤净重")] public decimal? 整啤净重 { get; set; }
    [Column("原胶件单净重")] public decimal? 原胶件单净重 { get; set; }
    [Column("整啤模腔数")] public decimal? 整啤模腔数 { get; set; }
    [Column("套数")] public decimal? 套数 { get; set; }
    [Column("用量")] public decimal? 用量 { get; set; }
    [Column("出模数")] public decimal? 出模数 { get; set; }
    [Column("水口比例")] public decimal? 水口比例 { get; set; }
    [Column("整啤毛重")] public decimal? 整啤毛重 { get; set; }
    [Column("模具日产量")] public decimal? 模具日产量 { get; set; }
    [Column("啤机机型")] public string? 啤机机型 { get; set; }
    [Column("啤机价钱"), PriceField] public decimal? 啤机价钱 { get; set; }
    [Column("胶件啤工价"), PriceField] public decimal? 胶件啤工价 { get; set; }
    [Column("胶料单价"), PriceField] public decimal? 胶料单价 { get; set; }
    [Column("原胶料单价"), PriceField] public decimal? 原胶料单价 { get; set; }
    [Column("加工总单价"), PriceField] public decimal? 加工总单价 { get; set; }
    [Column("其它成本"), PriceField] public decimal? 其它成本 { get; set; }
    [Column("二次加工内容")] public string? 二次加工内容 { get; set; }
    [Column("物料编号")] public string? 物料编号 { get; set; }
    [Column("共用原料编号")] public string? 共用原料编号 { get; set; }
    [Column("调整审核")] public string? 调整审核 { get; set; }
    [Column("备注内容")] public string? 备注内容 { get; set; }
    [Column("工模表备注")] public string? 工模表备注 { get; set; }
}
