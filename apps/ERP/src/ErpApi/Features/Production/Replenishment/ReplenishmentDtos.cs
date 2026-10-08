using System.Text.Json.Serialization;
namespace ErpApi.Features.Production.Replenishment;

public sealed class ReplenishmentLineDto
{
    [JsonPropertyName("ID")]   // 全大写 ID,camelCase 会拼成 id,钉死原名(前端 rowKey="ID")
    public long ID { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 规格 { get; set; }
    public string? 颜色 { get; set; }
    public string? 单位 { get; set; }
    public decimal 数量 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class ReplenishmentCreateDto
{
    public DateTime? 日期 { get; set; }
    public string? 部门 { get; set; }
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 仓库 { get; set; }   // 来料仓/塑胶仓 二选一
    [JsonPropertyName("PMC")]   // 全大写 PMC,camelCase 会拼成 pmc,钉死原名
    public string? PMC { get; set; }    // 必填：负责该补料单的 PMC（人事档案 职称='PMC'）
    public string? 备注 { get; set; }
    public List<ReplenishmentLineDto> 明细 { get; set; } = [];
}

public sealed class ReplenishmentHeaderDto
{
    [JsonPropertyName("ID")]   // 同上
    public long ID { get; set; }
    public string? 单号 { get; set; }
    public DateTime? 日期 { get; set; }
    public string? 部门 { get; set; }
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 仓库 { get; set; }
    public decimal? 数量 { get; set; }
    [JsonPropertyName("PMC")]   // 同上
    public string? PMC { get; set; }
    public string? 操作员 { get; set; }
    public string? 审核 { get; set; }
    public string? 审核人 { get; set; }
    public DateTime? 审核时间 { get; set; }
    // 转采购标记：采购订单保存成功后置 已采购='1'，防重复带入
    public string? 已采购 { get; set; }
    public DateTime? 采购时间 { get; set; }
    public string? 备注 { get; set; }
}

public sealed class ReplenishmentDetailDto
{
    public ReplenishmentHeaderDto? 单头 { get; set; }
    public List<ReplenishmentLineDto> 明细 { get; set; } = [];
}
