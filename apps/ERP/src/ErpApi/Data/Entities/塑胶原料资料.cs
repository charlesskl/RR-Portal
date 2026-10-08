using System.ComponentModel.DataAnnotations.Schema;
namespace ErpApi.Data.Entities;

[Table("塑胶原料资料")]
public sealed class 塑胶原料资料 : MasterEntity
{
    [Column("物料类别")] public string? 物料类别 { get; set; }
    [Column("物料编号")] public string? 物料编号 { get; set; }
    [Column("物料名称")] public string? 物料名称 { get; set; }
    [Column("规格")] public string? 规格 { get; set; }
    [Column("颜色")] public string? 颜色 { get; set; }
    [Column("单位")] public string? 单位 { get; set; }
    [Column("仓位号")] public string? 仓位号 { get; set; }
    [Column("商品名称")] public string? 商品名称 { get; set; }
    [Column("单价"), PriceField] public decimal? 单价 { get; set; }
    [Column("销售价"), PriceField] public decimal? 销售价 { get; set; }
    [Column("起订量")] public decimal? 起订量 { get; set; }
    [Column("安全库存")] public decimal? 安全库存 { get; set; }
    [Column("供应商编号")] public string? 供应商编号 { get; set; }
    [Column("款号")] public string? 款号 { get; set; }
    [Column("货币")] public string? 货币 { get; set; }
    [Column("产地")] public string? 产地 { get; set; }
    [Column("每包重量")] public decimal? 每包重量 { get; set; }
    [Column("备注")] public string? 备注 { get; set; }
}
