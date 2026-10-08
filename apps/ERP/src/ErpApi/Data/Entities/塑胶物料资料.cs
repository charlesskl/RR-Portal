using System.ComponentModel.DataAnnotations.Schema;
namespace ErpApi.Data.Entities;

[Table("塑胶物料资料")]
public sealed class 塑胶物料资料 : MasterEntity
{
    [Column("物料类别")] public string? 物料类别 { get; set; }
    [Column("物料编号")] public string? 物料编号 { get; set; }
    [Column("物料名称")] public string? 物料名称 { get; set; }
    [Column("规格")] public string? 规格 { get; set; }
    [Column("颜色")] public string? 颜色 { get; set; }
    [Column("单位")] public string? 单位 { get; set; }
    [Column("仓位号")] public string? 仓位号 { get; set; }
    [Column("单价"), PriceField] public decimal? 单价 { get; set; }
    [Column("销售价"), PriceField] public decimal? 销售价 { get; set; }
    [Column("供应商编号")] public string? 供应商编号 { get; set; }
    [Column("款号")] public string? 款号 { get; set; }
    [Column("货币")] public string? 货币 { get; set; }
    [Column("备注")] public string? 备注 { get; set; }
    // 关联工模(db/63):工模带出 + 手动补录字段
    [Column("工模编号")] public string? 工模编号 { get; set; }
    [Column("客户")] public string? 客户 { get; set; }
    [Column("色粉号")] public string? 色粉号 { get; set; }
    [Column("加工内容")] public string? 加工内容 { get; set; }
    [Column("二次加工")] public string? 二次加工 { get; set; }
    [Column("原料名称")] public string? 原料名称 { get; set; }
    [Column("用料名称")] public string? 用料名称 { get; set; }
    [Column("整啤毛重")] public decimal? 整啤毛重 { get; set; }
    [Column("整啤净重")] public decimal? 整啤净重 { get; set; }
    [Column("原胶件单净重")] public decimal? 原胶件单净重 { get; set; }
    [Column("整啤模腔数")] public decimal? 整啤模腔数 { get; set; }
    [Column("套数")] public decimal? 套数 { get; set; }
    [Column("出模数")] public decimal? 出模数 { get; set; }
    [Column("用量")] public decimal? 用量 { get; set; }
    [Column("水口比例")] public decimal? 水口比例 { get; set; }
    [Column("模具日产量")] public decimal? 模具日产量 { get; set; }
    [Column("啤机价钱"), PriceField] public decimal? 啤机价钱 { get; set; }
    [Column("胶件啤工价"), PriceField] public decimal? 胶件啤工价 { get; set; }
    [Column("原料单价"), PriceField] public decimal? 原料单价 { get; set; }
    [Column("胶件料价"), PriceField] public decimal? 胶件料价 { get; set; }
    [Column("原胶料单价"), PriceField] public decimal? 原胶料单价 { get; set; }
    [Column("二次加工价"), PriceField] public decimal? 二次加工价 { get; set; }
    [Column("加工总单价"), PriceField] public decimal? 加工总单价 { get; set; }
    [Column("其他成本"), PriceField] public decimal? 其他成本 { get; set; }
    [Column("啤机机型")] public string? 啤机机型 { get; set; }
}
