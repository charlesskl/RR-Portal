namespace ErpApi.Features.Materials.MaterialMaster;

// 左树节点：一个物料类别 + 该类物料数（直接物料数，不含子级）。
// 编号/父级 来自物料类别主数据（父级=父类别编号，空=顶级）；仅存在于物料行的类别 编号/父级 为 null。
// 扁平返回，前端按 父级 组树（数据结构支持多层，UI 两层够用）。
public sealed class MaterialCategoryNode
{
    public string? 编号 { get; set; }
    public string? 类别 { get; set; }
    public int 数量 { get; set; }
    public string? 父级 { get; set; }
}

// 右网格行（展示用；库存/最低/最高/供应商名称 为只读展示列，实体未映射不可编辑）
public sealed class MaterialRow
{
    public long ID { get; set; }
    public string? 物料类别 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 颜色 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 单价 { get; set; }
    public decimal? 销售价 { get; set; }
    public decimal? 库存 { get; set; }
    public decimal? 最低库存 { get; set; }
    public decimal? 最高库存 { get; set; }
    public string? 供应商编号 { get; set; }
    public string? 供应商名称 { get; set; }
    public string? 备注 { get; set; }
    public string? 仓库位置 { get; set; }
    public string? 码换算 { get; set; }
}

public sealed class AuxiliaryPurchaseAnalysisRow
{
    public string? 辅料编号 { get; set; }
    public string? 辅料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 库存数量 { get; set; }
    public decimal? 在途数量 { get; set; }
    public decimal? 需领数量 { get; set; }
    public decimal? 可用库存 { get; set; }
    public decimal? 订货数量 { get; set; }
    // 采购物料设置.采购损耗率(%): 仅内部用于订货数量加成计算, 不输出到 API。
    [System.Text.Json.Serialization.JsonIgnore]
    public decimal? 采购损耗率 { get; set; }
    public string? 供应商 { get; set; }
}
