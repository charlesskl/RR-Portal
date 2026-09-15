using VoyagePlex.Api.Services;
using VoyagePlex.Api.Entities;
using System.Text.Json.Nodes;

var allowed = new[]
{
    ("PendingReview", "PendingShipment"),
    ("PendingReview", "Cancelled"),
    ("PendingShipment", "Completed"),
    ("PendingShipment", "Cancelled"),
};
var rejected = new[]
{
    ("PendingReview", "Completed"),
    ("PendingShipment", "PendingReview"),
    ("Completed", "Cancelled"),
    ("Cancelled", "PendingReview"),
};

foreach (var transition in allowed)
{
    if (!ShipmentWorkflowRules.CanTransitionStatus(transition.Item1, transition.Item2))
        throw new InvalidOperationException($"应允许状态流转：{transition.Item1} -> {transition.Item2}");
}
foreach (var transition in rejected)
{
    if (ShipmentWorkflowRules.CanTransitionStatus(transition.Item1, transition.Item2))
        throw new InvalidOperationException($"应拦截状态流转：{transition.Item1} -> {transition.Item2}");
}

Console.WriteLine("Shipment workflow transition tests passed.");
if (ShipmentWorkflowRules.CanEnterPendingShipment(null) || !ShipmentWorkflowRules.CanEnterPendingShipment(new DateOnly(2026, 9, 14)))
    throw new InvalidOperationException("没有计划走货日期时应禁止转为待走货");
Console.WriteLine("Shipment planned date readiness tests passed.");
if (ShipmentWorkflowRules.ResolvePlannedShipDate("2026-08-10", "8/9", "8/8", "2026-07-20T08:00:00+08:00") != new DateOnly(2026, 8, 10))
    throw new InvalidOperationException("邮件计划走货日期没有优先进入任务");
if (ShipmentWorkflowRules.ResolvePlannedShipDate("", "8/10", "8/9", "2026-07-20T08:00:00+08:00") != new DateOnly(2026, 8, 9))
    throw new InvalidOperationException("没有计划日期时未按截数期前一天推算");
if (ShipmentWorkflowRules.ResolvePlannedShipDate("", "", "8/9", "2026-07-20T08:00:00+08:00") != new DateOnly(2026, 8, 8))
    throw new InvalidOperationException("没有截数期时未按 SI 截止前一天推算");
if (ShipmentWorkflowRules.ResolvePlannedShipDate("", "", "20-Jul-2026 22:00", "2026-07-18T08:00:00+08:00") != new DateOnly(2026, 7, 19))
    throw new InvalidOperationException("英文月份格式的 SI 截止日期未正确推算");
Console.WriteLine("Shipment planned date resolution tests passed.");
if (DestinationCountryRules.Infer("WM US ELWOOD;SAVANNAH", "[]") != "美国" ||
    DestinationCountryRules.Infer("YTN-FELIXSTOWE, UK", "[]") != "英国" ||
    DestinationCountryRules.Infer("", "[{\"warehouse\":\"DALLAS, TX, UNITED STATES\"}]") != "美国")
    throw new InvalidOperationException("现有任务的收货国家回填规则不正确");
Console.WriteLine("Shipment destination country backfill tests passed.");

var products = new[]
{
    new ProductInfo { LegacyId=1, Customer="A", ProductCode="X1", QuantityPerBox=6, ProductName="旧版" },
    new ProductInfo { LegacyId=9, Customer="A", ProductCode=" x1 ", QuantityPerBox=6, ProductName="新版" },
    new ProductInfo { LegacyId=10, Customer="A", ProductCode="X1", QuantityPerBox=12, ProductName="另一规格" },
    new ProductInfo { LegacyId=11, Customer="A", ProductCode="X2", QuantityPerBox=4 },
    new ProductInfo { LegacyId=12, Customer="B", ProductCode="X2", QuantityPerBox=4 },
    new ProductInfo { LegacyId=13, Customer="", ProductCode="X3", QuantityPerBox=8 },
};
var selection = ProductImportRules.SelectLatest(products);
if (selection.Items.Count != 3 || selection.Items.Single(value => value.QuantityPerBox == 6).LegacyId != 9)
    throw new InvalidOperationException("同货号同规格没有保留最大旧系统记录ID");
if (selection.SkippedCodes is not ["X2"] || selection.SkippedRows != 2 || selection.SupersededRows != 1)
    throw new InvalidOperationException("跨客户跳过或旧版本统计不正确");
Console.WriteLine("Product import selection tests passed.");

var productInfos = new[]
{
    new ProductInfo { ProductCode="77772GQ1", ProductName="唱片球13个/箱", QuantityPerBox=13, GrossWeightPerBox=1.37m, NetWeightPerBox=1.05m },
    new ProductInfo { ProductCode="15792SLD1", ProductName="18寸大毛绒 75个/展示架", GrossWeightPerBox=64.02m, NetWeightPerBox=43.57m },
    new ProductInfo { ProductCode="NAMEONLY", ProductName="只有中文名6个/箱", QuantityPerBox=6 },
};
var exactProduct = ProductInfoMatching.FindExact("77772GQ1", 13, productInfos);
if (exactProduct?.ChineseName != "唱片球" || exactProduct.QuantityPerBox != 13)
    throw new InvalidOperationException("未按邮件货号和规格匹配中文货名");
var inferredProduct = ProductInfoMatching.FindExact("15792SLD1", 75, productInfos);
if (inferredProduct?.ChineseName != "18寸大毛绒")
    throw new InvalidOperationException("未从产品库货名补全缺失的装箱规格");
if (ProductInfoMatching.FindExact("77772GQ1", 52, productInfos) is not null)
    throw new InvalidOperationException("产品库不同规格不应覆盖邮件规格");
if (ProductInfoMatching.FindExact("NAMEONLY", 6, productInfos)?.ChineseName != "只有中文名")
    throw new InvalidOperationException("缺少毛净重时仍应允许准确匹配中文货名");
if (!ProductInfoMatching.ContainsLatin("DISPC 非凡系列") || ProductInfoMatching.ContainsLatin("非凡系列"))
    throw new InvalidOperationException("英文或中英混杂货名应延后到任务创建时匹配");
if (ProductInfoMatching.TotalWeight(50, 4.88m) != 244 || ProductInfoMatching.TotalWeight(25, 5.14m) != 128)
    throw new InvalidOperationException("毛净重没有按件数乘每箱重量后取整");
Console.WriteLine("Product information matching tests passed.");

var sqliteUtcValue = new DateTime(2026, 9, 11, 0, 22, 0, DateTimeKind.Unspecified);
var normalizedUtcValue = UtcDateTime.Normalize(sqliteUtcValue);
if (normalizedUtcValue.Kind != DateTimeKind.Utc || !normalizedUtcValue.ToString("O").EndsWith('Z'))
    throw new InvalidOperationException("SQLite 时间没有恢复 UTC 时区标记");
Console.WriteLine("UTC date normalization tests passed.");

var deletionTask = new ShipmentTask { Id=8, SourceImportItemId=20, SoNumber="SO-123" };
var sourceImport = new ImportEmailItem { Id=20, Fingerprint="same", ResultJson="{}" };
var duplicateImport = new ImportEmailItem { Id=21, DuplicateOfItemId=20, Fingerprint="same", ResultJson="{}" };
var updateImport = new ImportEmailItem { Id=22, Fingerprint="changed", ResultJson="{\"fields\":{\"so_number\":\"SO123\"}}" };
var unrelatedImport = new ImportEmailItem { Id=23, Fingerprint="other", ResultJson="{\"fields\":{\"so_number\":\"SO999\"}}" };
if (!ShipmentDeletionRules.IsRelatedImport(deletionTask, sourceImport, "same") ||
    !ShipmentDeletionRules.IsRelatedImport(deletionTask, duplicateImport, "same") ||
    !ShipmentDeletionRules.IsRelatedImport(deletionTask, updateImport, "same") ||
    ShipmentDeletionRules.IsRelatedImport(deletionTask, unrelatedImport, "same"))
    throw new InvalidOperationException("任务删除时关联邮件解析记录判断错误");
Console.WriteLine("Shipment deletion relation tests passed.");

var fullContainer = new ShipmentTask
{
    Id=30, Customer="ZURU", ItemsJson="""
    [{"contract_number":"4500217958","product_code":"9574GQ1","customer_po":"10001835258-3891","pieces":500,"source_file":"master.xlsx","source_row":8}]
    """
};
var looseCargo = new ShipmentTask
{
    Id=31, Customer="ZURU", ItemsJson="""
    [{"contract_number":"4500217958","product_code":"9574","customer_po":"10001835258-3891","pieces":150,"source_file":"loose.xlsx","source_row":2}]
    """
};
var repeatedMaster = new ShipmentTask
{
    Id=32, Customer="ZURU", ItemsJson=fullContainer.ItemsJson
};
var otherPo = new ShipmentTask
{
    Id=33, Customer="ZURU", ItemsJson="""
    [{"contract_number":"4500217958","product_code":"9574","customer_po":"OTHER","pieces":90,"source_file":"other.xlsx","source_row":2}]
    """
};
var cancelledLooseCargo = new ShipmentTask
{
    Id=34, Customer="ZURU", Status="Cancelled", ItemsJson="""
    [{"contract_number":"4500217958","product_code":"9574","customer_po":"10001835258-3891","pieces":70,"source_file":"cancelled.xlsx","source_row":2}]
    """
};
var exportPayload = JsonNode.Parse("""
{"customer":"ZURU","items":[{"contract_number":"4500217958","product_code":"9574UQ2","customer_po":"10001835258-3891","pieces":500}]}
""")!.AsObject();
ShipmentOrderTotals.Apply(exportPayload, [fullContainer, looseCargo, repeatedMaster, otherPo, cancelledLooseCargo]);
var calculatedOrderTotal = exportPayload["items"]![0]!["order_total_pieces"]!.GetValue<decimal>();
if (calculatedOrderTotal != 650)
    throw new InvalidOperationException($"整柜与散货总件数汇总或重复 Packing List 去重错误：{calculatedOrderTotal}");
Console.WriteLine("Shipment order total pieces tests passed.");
