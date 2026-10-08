using System.Text.Json.Serialization;
using ErpApi.Features.Plastics.PlasticPurchaseOrder;
namespace ErpApi.Integrations.SprayPlan;

// sprayplan 请求 DTO(camelCase,对齐对方 CreateProductRequest / CreateOrderRequest)。
public sealed class SprayPlanPartDto
{
    [JsonPropertyName("partName")] public string? PartName { get; set; }
    [JsonPropertyName("craft")] public string? Craft { get; set; }
}

public sealed class SprayPlanProductRequest
{
    [JsonPropertyName("productNo")] public string? ProductNo { get; set; }
    [JsonPropertyName("remark")] public string? Remark { get; set; }
    [JsonPropertyName("parts")] public List<SprayPlanPartDto>? Parts { get; set; }
}

public sealed class SprayPlanOrderPartQtyDto
{
    [JsonPropertyName("partName")] public string? PartName { get; set; }
    [JsonPropertyName("qty")] public int Qty { get; set; }
    [JsonPropertyName("partOrder")] public int PartOrder { get; set; }
}

public sealed class SprayPlanOrderRequest
{
    [JsonPropertyName("externalOrderNo")] public string? ExternalOrderNo { get; set; }
    [JsonPropertyName("productId")] public int? ProductId { get; set; }
    [JsonPropertyName("orderDate")] public string? OrderDate { get; set; }      // yyyy-MM-dd
    [JsonPropertyName("deliveryDate")] public string? DeliveryDate { get; set; }
    [JsonPropertyName("remark")] public string? Remark { get; set; }
    [JsonPropertyName("isMA")] public bool? IsMA { get; set; }
    [JsonPropertyName("isUrgent")] public bool? IsUrgent { get; set; }
    [JsonPropertyName("partQtys")] public List<SprayPlanOrderPartQtyDto>? PartQtys { get; set; }
}

// 推送草稿:一款号一张 sprayplan 订单。ProductId 推送时按 ProductNo 查找/创建后回填。
public sealed class SprayPlanOrderDraft
{
    public string ProductNo { get; set; } = "";              // 款号
    public SprayPlanProductRequest Product { get; set; } = new();
    public SprayPlanOrderRequest Order { get; set; } = new();
}

// 塑胶采购订单 → 喷油部排期系统的字段映射(纯函数,独立可测)。
public static class SprayPlanMapper
{
    // 触发条件:供应商名称含「喷油」(与前端 is喷油供应商 同口径;喷油车间供应商名是「兴信喷油车间」,
    // 早期按「喷油部」匹配永远命不中,喷油单全被错推排产 W 车间)。印刷/喷码类供应商不含「喷油」子串,不受影响
    public static bool 要推送(string? 供应商名称) => 供应商名称?.Contains("喷油") == true;

    // externalOrderNo:单款号=ERP采购单号;多款号=单号-款号
    public static string ExternalOrderNo(string 单号, int 款号数, string 款号)
        => 款号数 <= 1 ? 单号 : $"{单号}-{款号}";

    public static string Remark(string 单号, string? 供应商名称)
        => $"ERP:塑胶采购订单 {单号} 供应商 {供应商名称}";

    // 换号重推:反审核软删(archived)后原 externalOrderNo 仍占号(唯一约束),新单依次试
    // 基础号-R2、-R3… 取第一个空闲号(已占用集合须含 archived 单)。重推得到的是全新 draft 单。
    public static string 空闲重推号(string 基础号, ISet<string> 已占用)
    {
        var n = 2;
        while (已占用.Contains($"{基础号}-R{n}")) n++;
        return $"{基础号}-R{n}";
    }

    // 按款号分组,一组一张订单草稿(跳过 数量<=0 的行由调用方保证)。
    public static List<SprayPlanOrderDraft> BuildDrafts(PlasticPurchaseOrderHeaderDto 单头,
        IReadOnlyList<PlasticPurchaseOrderLineDto> 明细)
    {
        var groups = 明细.GroupBy(l => l.款号 ?? "").ToList();
        return groups.Select(g => new SprayPlanOrderDraft
        {
            ProductNo = g.Key,
            Product = new SprayPlanProductRequest
            {
                ProductNo = g.Key,
                Remark = Remark(单头.单号, 单头.供应商名称),
                Parts = g.Select(l => new SprayPlanPartDto { PartName = l.物料名称, Craft = null }).ToList(),
            },
            Order = new SprayPlanOrderRequest
            {
                ExternalOrderNo = ExternalOrderNo(单头.单号, groups.Count, g.Key),
                OrderDate = 单头.日期?.ToString("yyyy-MM-dd"),
                DeliveryDate = 单头.交货日期?.ToString("yyyy-MM-dd"),
                Remark = Remark(单头.单号, 单头.供应商名称),
                IsMA = false,
                IsUrgent = false,
                PartQtys = g.Select((l, i) => new SprayPlanOrderPartQtyDto
                {
                    PartName = l.物料名称,
                    Qty = (int)Math.Round(l.数量, MidpointRounding.AwayFromZero),
                    PartOrder = i + 1,
                }).ToList(),
            },
        }).ToList();
    }
}
