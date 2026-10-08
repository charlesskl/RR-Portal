using System.Text.Json.Serialization;
using ErpApi.Features.Plastics.PlasticPurchaseOrder;
using ErpApi.Features.Plastics.PlasticReceipt;
namespace ErpApi.Integrations.Paiji;

// 塑胶采购订单明细 → AI注塑啤机排产系统订单导入行(POST /orders 的 JSON body)。
public sealed class PaijiOrderRow
{
    [JsonPropertyName("workshop")] public string Workshop { get; set; } = "";
    [JsonPropertyName("product_code")] public string? ProductCode { get; set; }   // 产品货号
    [JsonPropertyName("mold_name")] public string? MoldName { get; set; }         // 模号名称
    [JsonPropertyName("mold_no")] public string? MoldNo { get; set; }             // 模具编号(可空)
    [JsonPropertyName("color")] public string? Color { get; set; }
    [JsonPropertyName("color_powder_no")] public string? ColorPowderNo { get; set; } // 色粉号
    [JsonPropertyName("material_type")] public string? MaterialType { get; set; }    // 料型
    [JsonPropertyName("shot_weight")] public decimal ShotWeight { get; set; }        // 啤重G
    [JsonPropertyName("quantity_needed")] public long QuantityNeeded { get; set; }   // 需啤数(>0)
    [JsonPropertyName("material_kg")] public decimal MaterialKg { get; set; }        // 用料KG
    [JsonPropertyName("order_no")] public string? OrderNo { get; set; }              // 下单单号(生产单号)
    [JsonPropertyName("serial_no")] public string? SerialNo { get; set; }            // 单号(PO号)
    [JsonPropertyName("packing_qty")] public long PackingQty { get; set; }           // 装箱量
    [JsonPropertyName("order_notes")] public string? OrderNotes { get; set; }        // 备注(ERP追溯标记)
}

// 塑胶物料资料中参与换算的字段(按 物料编号 查;采购订单推送只用净重,入仓单推送用全字段)。
public sealed class PaijiMaterialInfo
{
    public string 物料编号 { get; set; } = "";
    public decimal? 整啤净重 { get; set; }     // 每啤次净重g
    public decimal? 原胶件单净重 { get; set; } // 每件净重g(整啤净重查不到时回落)
    public decimal? 套数 { get; set; }         // 每啤次出几件
    public decimal? 出模数 { get; set; }
    public string? 色粉号 { get; set; }
    public string? 用料名称 { get; set; }
}

// 字段映射与换算的纯函数(独立可测,不碰 HTTP/DB)。
public static class PaijiMapper
{
    // 车间映射:含「兴信A」→AT(兴信A测试版,含 兴信A车间/兴信A(测试版));
    // 含「B车间」→B,含「华登」→C,其余→W(外发部)。兴信装配A车间/兴信喷油车间 不含「兴信A」子串,不受影响。
    public static string 车间(string? 供应商名称)
    {
        var n = 供应商名称 ?? "";
        if (n.Contains("兴信A")) return "AT";
        if (n.Contains("A车间")) return "A";
        if (n.Contains("B车间")) return "B";
        if (n.Contains("华登")) return "C";
        return "W";
    }

    // 需啤数(啤次数)=ceil(数量/套数);套数空或0时=数量。
    public static long 需啤数(decimal 数量, decimal? 套数)
        => 套数 is null or <= 0 ? (long)Math.Ceiling(数量) : (long)Math.Ceiling(数量 / 套数.Value);

    // 啤重G:整啤净重优先,查不到回落原胶件单净重,再查不到 0。
    public static decimal 啤重G(PaijiMaterialInfo? 物料)
        => 物料?.整啤净重 > 0 ? 物料.整啤净重!.Value
         : 物料?.原胶件单净重 > 0 ? 物料.原胶件单净重!.Value
         : 0m;

    // 用料KG=啤重G×需啤数/1000(排产系统口径),保留2位;啤重0时给0。
    public static decimal 用料KG(decimal 啤重G, long 需啤数)
        => 啤重G <= 0 ? 0m : Math.Round(啤重G * 需啤数 / 1000m, 2);

    // 备注:ERP:{塑胶采购订单号} 追溯标记 + 交期 + 单头备注。
    public static string 备注(string 单号, DateTime? 交货日期, string? 单头备注)
        => $"ERP:{单号}"
         + (交货日期.HasValue ? $" 交期:{交货日期.Value:yyyy-MM-dd}" : "")
         + (string.IsNullOrWhiteSpace(单头备注) ? "" : $" {单头备注}");

    // 一行明细 → 一条排产订单。
    public static PaijiOrderRow BuildRow(string workshop, PlasticPurchaseOrderHeaderDto 单头,
        PlasticPurchaseOrderLineDto 行, PaijiMaterialInfo? 物料)
    {
        var 啤重 = 啤重G(物料);
        var 需啤 = 需啤数(行.数量, 行.套数);
        return new PaijiOrderRow
        {
            Workshop = workshop,
            ProductCode = 行.款号,
            MoldName = 行.模具编号,
            MoldNo = null,
            Color = 行.颜色,
            ColorPowderNo = 行.色粉号,
            MaterialType = 行.用料名称,
            ShotWeight = 啤重,
            QuantityNeeded = 需啤,
            MaterialKg = 用料KG(啤重, 需啤),
            OrderNo = 行.生产单号,
            SerialNo = 单头.编号,
            PackingQty = 0,
            OrderNotes = 备注(单头.单号, 单头.交货日期, 单头.备注),
        };
    }

    // ==================== 反向同步(排产入库单 → ERP塑胶入仓单) ====================

    // 车间→ERP供应商映射(排产同步建入仓单用)。
    public static (string 编号, string 名称) 车间供应商(string? workshop) => workshop switch
    {
        "AT" => ("292", "兴信A(测试版)"),
        "A" => ("101", "兴信A车间"),
        "B" => ("102", "兴信B车间"),
        "C" => ("112", "东莞华登塑胶制品有限公司"),
        _ => ("291", "外发部"),
    };

    // 排产入库行物料解析结果:命中时给出 ERP 物料编号/物料名称;null=未命中(回落旧口径)。
    public sealed record Paiji物料匹配(string 物料编号, string 物料名称);

    // 排产入库行 → ERP 入仓明细行。ERP 单价是每件价 ← 排产 unit_price(¥/啤) ÷ 出模数(cavity),
    // cavity 空/0 时用 unit_price 原值;unit_price 空则单价留空。物料匹配结果由调用方(同步服务)解析后传入,保持纯函数可测。
    // 字段口径:排产 mold_no 回传货号(下单时的 product_code),part_name 回传模号(下单时的 mold_name=ERP模具编号);
    // 工模编号直接落 part_name;物料编号/名称用匹配结果,匹配不到回落旧口径(编号=货号,名称=part_name)。
    public static PlasticReceiptCreateLineDto ToReceiptLine(PaijiWarehouseInRow r, Paiji物料匹配? 匹配)
    {
        decimal? 单价 = r.UnitPrice is null ? null
            : r.Cavity is > 0 ? Math.Round(r.UnitPrice.Value / r.Cavity.Value, 6)
            : r.UnitPrice;
        return new PlasticReceiptCreateLineDto
        {
            生产单号 = r.OrderNo,
            款号 = r.MoldNo,
            塑胶货号 = r.MoldNo,
            工模编号 = r.PartName,
            物料编号 = 匹配?.物料编号 ?? r.MoldNo,
            物料名称 = 匹配?.物料名称 ?? r.PartName,
            颜色 = r.Color,
            单位 = "个",
            数量 = r.DeliveryPcs ?? 0,
            单价 = 单价,
            备注 = $"排产#{r.Id}",
        };
    }

    // 分组规则:按送货单号 delivery_code 分组(一组一张 ERP 入仓单);空则每行各自成组。
    public static IEnumerable<IGrouping<string, PaijiWarehouseInRow>> 入库分组(IEnumerable<PaijiWarehouseInRow> rows)
        => rows.GroupBy(r => string.IsNullOrWhiteSpace(r.DeliveryCode) ? $"#{r.Id}" : r.DeliveryCode!);

    // 反向同步防回环：只跳过 ERP 回推的入仓行(notes 以 "ERP:SR" 开头,SR=塑胶入仓单号,
    // 见 PaijiWarehouseMapper.备注)。车间对 ERP 推送采购单的真实入库 notes 是 "ERP:SP..."(SP=塑胶采购订单号),
    // 不能跳——那正是要同步进 ERP 的单子。
    public static bool 是ERP回推入仓行(string? notes)
        => notes?.TrimStart().StartsWith("ERP:SR", StringComparison.OrdinalIgnoreCase) ?? false;
}
