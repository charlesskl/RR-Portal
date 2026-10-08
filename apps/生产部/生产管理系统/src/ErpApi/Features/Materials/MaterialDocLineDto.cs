namespace ErpApi.Features.Materials;

// 物料明细行（采购入仓/领料/退料 三单据共用）
public sealed class MaterialDocLineDto
{
    public long ID { get; set; }            // 读出用；创建时忽略
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 物料类别 { get; set; }
    public string? 规格 { get; set; }
    public string? 颜色 { get; set; }
    public string? 单位 { get; set; }
    public decimal 数量 { get; set; }
    public decimal? 已出数量 { get; set; }   // 领料单:累计已出库数量(分次出库);创建时忽略
    public decimal? 单价 { get; set; }
    public decimal? 金额 { get; set; }
    public string? 备注 { get; set; }
    public string? 订单单号 { get; set; }   // 采购入仓:调入的采购订单号(领料/退料留空)
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 备品 { get; set; }       // 采购入仓:'1'=含供应商多送的备品(配合 备品数量;不占订单欠数)
    public decimal? 备品数量 { get; set; }   // 采购入仓:备品部分数量(数量=计入订单欠数的部分;实物入库=数量+备品数量)
}
