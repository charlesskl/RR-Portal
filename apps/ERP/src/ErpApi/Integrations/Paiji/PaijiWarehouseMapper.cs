using System.Text.Json.Serialization;
using ErpApi.Features.Plastics.PlasticReceipt;
namespace ErpApi.Integrations.Paiji;

// 排产系统入库单拉取行(GET /warehouse-orders 返回数组元素;数字字段兼容字符串形态如 "6.0")。
public sealed class PaijiWarehouseInRow
{
    [JsonPropertyName("id")] public long Id { get; set; }
    [JsonPropertyName("workshop")] public string? Workshop { get; set; }
    [JsonPropertyName("delivery_date")] public string? DeliveryDate { get; set; }    // yyyy-MM-dd
    [JsonPropertyName("delivery_code")] public string? DeliveryCode { get; set; }    // 送货单号
    [JsonPropertyName("order_no")] public string? OrderNo { get; set; }              // 下单号(生产单号)
    [JsonPropertyName("mold_no")] public string? MoldNo { get; set; }                // 货号
    [JsonPropertyName("part_name")] public string? PartName { get; set; }            // 部件名称
    [JsonPropertyName("color")] public string? Color { get; set; }
    [JsonPropertyName("color_powder_no")] public string? ColorPowderNo { get; set; }
    [JsonPropertyName("order_qty")] public decimal? OrderQty { get; set; }
    [JsonPropertyName("delivery_shots")] public long? DeliveryShots { get; set; }    // 啤数
    [JsonPropertyName("delivery_pcs")] public decimal? DeliveryPcs { get; set; }     // 件数PCS
    [JsonPropertyName("cavity")] public decimal? Cavity { get; set; }                // 出模数
    [JsonPropertyName("shot_weight")] public decimal? ShotWeight { get; set; }
    [JsonPropertyName("material_kg")] public decimal? MaterialKg { get; set; }
    [JsonPropertyName("material_type")] public string? MaterialType { get; set; }
    [JsonPropertyName("unit_price")] public decimal? UnitPrice { get; set; }         // 单价¥/啤
    [JsonPropertyName("status")] public string? Status { get; set; }                 // pending/checked-in/settled
    [JsonPropertyName("notes")] public string? Notes { get; set; }
    [JsonPropertyName("created_at")] public string? CreatedAt { get; set; }
}

// 塑胶入仓单明细 → AI注塑啤机排产系统入库单行(POST /warehouse-orders 的 JSON body)。
// amount 由排产服务端自算 = unit_price(¥/啤) × delivery_shots(啤数)。
public sealed class PaijiWarehouseRow
{
    [JsonPropertyName("workshop")] public string Workshop { get; set; } = "";
    [JsonPropertyName("delivery_date")] public string? DeliveryDate { get; set; }    // 送货日期 yyyy-MM-dd
    [JsonPropertyName("delivery_code")] public string? DeliveryCode { get; set; }    // 送货单号
    [JsonPropertyName("order_no")] public string? OrderNo { get; set; }              // 下单号(生产单号)
    [JsonPropertyName("mold_no")] public string? MoldNo { get; set; }                // 货号
    [JsonPropertyName("part_name")] public string? PartName { get; set; }            // 部件名称
    [JsonPropertyName("color")] public string? Color { get; set; }
    [JsonPropertyName("color_powder_no")] public string? ColorPowderNo { get; set; } // 色粉编号
    [JsonPropertyName("delivery_pcs")] public decimal DeliveryPcs { get; set; }      // 件数PCS
    [JsonPropertyName("delivery_shots")] public long DeliveryShots { get; set; }     // 数量(啤数)
    [JsonPropertyName("cavity")] public long Cavity { get; set; }                    // 出模数
    [JsonPropertyName("shot_weight")] public decimal ShotWeight { get; set; }        // 啤重g
    [JsonPropertyName("material_kg")] public decimal MaterialKg { get; set; }        // 料kg
    [JsonPropertyName("material_type")] public string? MaterialType { get; set; }    // 料型
    [JsonPropertyName("unit_price")] public decimal UnitPrice { get; set; }          // 单价¥/啤
    [JsonPropertyName("status")] public string Status { get; set; } = "checked-in";  // 直接建成已入库
    [JsonPropertyName("notes")] public string? Notes { get; set; }                   // 备注(ERP追溯标记)
}

// 入仓单 → 排产入库单的字段映射与换算(纯函数,独立可测;车间/啤数/啤重/用料KG 复用 PaijiMapper)。
public static class PaijiWarehouseMapper
{
    // 每啤单价:ERP 单价是每件价,排产是每啤价,×套数换算;套数空/0 用单价原值;单价空给 0。
    // 这样排产 amount = 单价×数量(啤数×每啤价 ≈ 件数×每件价) 与 ERP 金额一致。
    public static decimal 每啤单价(decimal? 单价, decimal? 套数)
        => 单价 is null ? 0m : 套数 is null or <= 0 ? 单价.Value : 单价.Value * 套数.Value;

    // 出模数:物料资料.出模数优先,空则回落套数,再空 0。
    public static long 出模数(PaijiMaterialInfo? 物料)
        => 物料?.出模数 > 0 ? (long)物料.出模数!.Value
         : 物料?.套数 > 0 ? (long)物料.套数!.Value
         : 0;

    // 备注:ERP:{入仓单据号} 追溯标记 + 单头备注。
    public static string 备注(string 单号, string? 单头备注)
        => $"ERP:{单号}" + (string.IsNullOrWhiteSpace(单头备注) ? "" : $" {单头备注}");

    // 一行明细 → 一条排产入库单。
    public static PaijiWarehouseRow BuildRow(string workshop, PlasticReceiptHeaderDto 单头,
        PlasticReceiptLineDto 行, PaijiMaterialInfo? 物料)
    {
        var 啤数 = PaijiMapper.需啤数(行.数量 ?? 0, 物料?.套数);
        var 啤重 = PaijiMapper.啤重G(物料);
        return new PaijiWarehouseRow
        {
            Workshop = workshop,
            DeliveryDate = 单头.日期?.ToString("yyyy-MM-dd"),
            DeliveryCode = string.IsNullOrWhiteSpace(单头.入仓单号) ? 单头.单号 : 单头.入仓单号,
            OrderNo = 行.生产单号,
            MoldNo = string.IsNullOrWhiteSpace(行.塑胶货号) ? 行.款号 : 行.塑胶货号,
            PartName = 行.物料名称,
            Color = 行.颜色,
            ColorPowderNo = 物料?.色粉号,
            DeliveryPcs = 行.数量 ?? 0,
            DeliveryShots = 啤数,
            Cavity = 出模数(物料),
            ShotWeight = 啤重,
            MaterialKg = PaijiMapper.用料KG(啤重, 啤数),
            MaterialType = 物料?.用料名称,
            UnitPrice = 每啤单价(行.单价, 物料?.套数),
            Status = "checked-in",
            Notes = 备注(单头.单号 ?? "", 单头.备注),
        };
    }
}
