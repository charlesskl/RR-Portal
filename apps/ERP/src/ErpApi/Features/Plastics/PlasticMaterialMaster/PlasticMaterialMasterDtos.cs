namespace ErpApi.Features.Plastics.PlasticMaterialMaster;

// 左树节点:一个物料类别 + 该类塑胶物料数(主数据带父子:编号/父级=父类别编号,由前端组树)
public sealed class PlasticMaterialCategoryNode
{
    public string? 编号 { get; set; }
    public string? 类别 { get; set; }
    public int 数量 { get; set; }
    public string? 父级 { get; set; }
}

// 右网格行(旧系统固定表头:塑胶货号=款号,原胶件单价=单价;库存/最低/最高/供应商名称 为只读列,实体未映射)
public sealed class PlasticMaterialRow
{
    public long ID { get; set; }
    public string? 物料类别 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 客户 { get; set; }
    public string? 款号 { get; set; }
    public string? 工模编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 颜色 { get; set; }
    public string? 色粉号 { get; set; }
    public string? 原料名称 { get; set; }
    public string? 用料名称 { get; set; }
    public string? 加工内容 { get; set; }
    public decimal? 加工总单价 { get; set; }
    public string? 二次加工 { get; set; }
    public decimal? 二次加工价 { get; set; }
    public decimal? 整啤净重 { get; set; }
    public decimal? 原胶件单净重 { get; set; }
    public decimal? 整啤模腔数 { get; set; }
    public decimal? 套数 { get; set; }
    public decimal? 出模数 { get; set; }
    public decimal? 用量 { get; set; }
    public string? 啤机机型 { get; set; }
    public decimal? 模具日产量 { get; set; }
    public decimal? 啤机价钱 { get; set; }
    public decimal? 胶件啤工价 { get; set; }
    public decimal? 原料单价 { get; set; }
    public decimal? 胶件料价 { get; set; }
    public decimal? 其他成本 { get; set; }
    public string? 规格 { get; set; }
    public string? 单位 { get; set; }
    public string? 仓位号 { get; set; }
    public decimal? 单价 { get; set; }
    public decimal? 销售价 { get; set; }
    public decimal? 库存 { get; set; }
    public decimal? 最低库存 { get; set; }
    public decimal? 最高库存 { get; set; }
    public string? 供应商编号 { get; set; }
    public string? 供应商名称 { get; set; }
    public string? 备注 { get; set; }
}
