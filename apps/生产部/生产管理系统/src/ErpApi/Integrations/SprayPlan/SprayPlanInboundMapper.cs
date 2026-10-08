using System.Text.Json.Serialization;
namespace ErpApi.Integrations.SprayPlan;

// 喷油排期入库申请单拉取行(GET /inventory/inbound-applications 返回 items 元素)。
// 对方为 append-only 台账:无状态字段、无删除;申请单号唯一;quantity 是入库增量(PCS),可为负(调减单);
// 已同步过的申请单被对方编辑时 updatedAt 变新,反向同步据此自动更新未审核入仓单(SprayPlanReceiptSyncService)。
public sealed class SprayPlanInboundRow
{
    [JsonPropertyName("applicationNo")] public string ApplicationNo { get; set; } = "";
    [JsonPropertyName("sourcePlanId")] public long? SourcePlanId { get; set; }
    [JsonPropertyName("productionDate")] public string? ProductionDate { get; set; }  // 生产日期
    [JsonPropertyName("orderNo")] public string? OrderNo { get; set; }                // =ERP推送时写的 externalOrderNo 或手工单号
    [JsonPropertyName("productNo")] public string? ProductNo { get; set; }            // 款号
    [JsonPropertyName("itemName")] public string? ItemName { get; set; }
    [JsonPropertyName("partName")] public string? PartName { get; set; }              // 部位名称
    [JsonPropertyName("quantity")] public decimal Quantity { get; set; }              // 入库增量(PCS),可为负
    [JsonPropertyName("createdBy")] public string? CreatedBy { get; set; }
    [JsonPropertyName("createdAt")] public string? CreatedAt { get; set; }
    [JsonPropertyName("updatedAt")] public string? UpdatedAt { get; set; }          // 对方最近编辑时间(ISO);改单自动更新据此与 [喷油同步记录].[同步时间] 比较
    [JsonPropertyName("remark")] public string? Remark { get; set; }
}

// GET /inventory/inbound-applications 分页响应包装。
public sealed class SprayPlanInboundPage
{
    [JsonPropertyName("items")] public List<SprayPlanInboundRow> Items { get; set; } = [];
    [JsonPropertyName("total")] public int Total { get; set; }
    [JsonPropertyName("page")] public int Page { get; set; }
    [JsonPropertyName("pageSize")] public int PageSize { get; set; }
}

// 喷油排期入库申请单 → ERP塑胶入仓单 的字段映射与解析(纯函数,独立可测)。
public static class SprayPlanSyncMapper
{
    // 是否同步:数量>0 才同步;0 无意义跳过,负数(调减单)由调用方记警告跳过(ERP 入仓单不支持负数量)。
    public static bool 要同步(decimal 数量) => 数量 > 0;

    // 物料名称:itemName 非空时 "itemName/partName",否则 partName。
    public static string? 物料名称(string? itemName, string? partName)
        => !string.IsNullOrWhiteSpace(itemName)
            ? string.IsNullOrWhiteSpace(partName) ? itemName.Trim() : $"{itemName.Trim()}/{partName.Trim()}"
            : string.IsNullOrWhiteSpace(partName) ? null : partName.Trim();

    // 塑胶采购订单号候选:先精确 orderNo;含 '-' 时追加最后一个 '-' 前的前缀
    // (多款号推送 externalOrderNo=SPxxx-款号,见 SprayPlanMapper.ExternalOrderNo;也可能是 CMC2600129 这类手工单号)。
    public static IReadOnlyList<string> 采购单号候选(string? orderNo)
    {
        if (string.IsNullOrWhiteSpace(orderNo)) return [];
        var no = orderNo.Trim();
        var i = no.LastIndexOf('-');
        return i > 0 ? [no, no[..i]] : [no];
    }
}
