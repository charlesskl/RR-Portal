using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using VoyagePlex.Api.Data;
using VoyagePlex.Api.Services;
using VoyagePlex.Api.Entities;
using System.Text.Json.Nodes;

var mailboxOwner = new AppUser { Username = "huadeng-shipping", MailboxAddress = "owner@163.com" };
Environment.SetEnvironmentVariable(ServerMailboxConfiguration.EnvironmentVariable,
    """[{"username":"huadeng-shipping","address":"owner@163.com","authCode":"test-code","host":"imap.163.com","folder":"INBOX"}]""");
if (!ServerMailboxConfiguration.TryGet(mailboxOwner, out var mailboxCredentials, out _) ||
    mailboxCredentials.AuthCode != "test-code" || mailboxCredentials.Host != "imap.163.com")
    throw new InvalidOperationException("服务器邮箱配置没有按用户账号解析");
var rotatedCredentials = mailboxCredentials with { AuthCode = "rotated-test-code" };
if (ServerMailboxConfiguration.MailboxIdentity(mailboxCredentials) != ServerMailboxConfiguration.MailboxIdentity(rotatedCredentials) ||
    ServerMailboxConfiguration.ConfigurationKey(mailboxCredentials) == ServerMailboxConfiguration.ConfigurationKey(rotatedCredentials) ||
    ServerMailboxConfiguration.MailboxIdentity(mailboxCredentials) == ServerMailboxConfiguration.MailboxIdentity(mailboxCredentials with { Folder = "Archive" }) ||
    ServerMailboxConfiguration.MailboxIdentity(mailboxCredentials) == ServerMailboxConfiguration.MailboxIdentity(mailboxCredentials with { Host = "other.example.com" }))
    throw new InvalidOperationException("授权码轮换必须保持邮箱身份，服务器或文件夹变更必须隔离同步断点");
mailboxOwner.MailboxAddress = "other@163.com";
if (ServerMailboxConfiguration.IsConfigured(mailboxOwner))
    throw new InvalidOperationException("服务器邮箱配置与用户绑定地址不一致时必须拒绝连接");
Environment.SetEnvironmentVariable(ServerMailboxConfiguration.EnvironmentVariable, null);
mailboxOwner.MailboxAddress = "owner@163.com";
foreach (var invalidConfiguration in new[] { "invalid", "[null]", "{}", "[{\"username\":\"huadeng-shipping\"},{\"username\":\"huadeng-shipping\"}]" })
{
    Environment.SetEnvironmentVariable(ServerMailboxConfiguration.EnvironmentVariable, invalidConfiguration);
    if (ServerMailboxConfiguration.TryGet(mailboxOwner, out _, out _))
        throw new InvalidOperationException("无效或重复的服务器邮箱配置必须拒绝连接");
}
Environment.SetEnvironmentVariable(ServerMailboxConfiguration.EnvironmentVariable, null);
Console.WriteLine("Server-managed mailbox configuration tests passed.");
var explicitCabinets = JsonNode.Parse("""
{"fields":{"explicit_container_allocation":"true"},"shipment_groups":[{"group_key":"C1","so_number":"SO1","container_type":"45HQ"},{"group_key":"C2","so_number":"SO1","container_type":"40HQ"}],"items":[{"product_code":"A","container_assignment":"C1","quantity":12,"pieces":3},{"product_code":"A","container_assignment":"C2","quantity":24,"pieces":6}]}
""")!.AsObject();
var explicitTasks = MultiContainerRules.Split(explicitCabinets);
if (explicitTasks.Count != 2 || explicitTasks[0].Payload["items"]![0]!["quantity"]!.GetValue<int>() != 12 ||
    explicitTasks[1].Payload["items"]![0]!["quantity"]!.GetValue<int>() != 24 ||
    explicitTasks[1].Payload["fields"]!["container_type"]!.ToString() != "40HQ")
    throw new InvalidOperationException("附件明确分柜必须保留原始数量及柜型，不得重新平均分配");
explicitCabinets["items"]![0]!["container_assignment"] = "UNKNOWN";
try { MultiContainerRules.Split(explicitCabinets); throw new Exception("应拒绝未分配货物"); }
catch (InvalidOperationException) { }
Console.WriteLine("Explicit cabinet assignment tests passed.");

if (MailboxDateRules.ReceivedDate("2026-09-17T15:59:00+00:00") != "2026-09-17" ||
    MailboxDateRules.ReceivedDate("2026-09-17T16:00:00+00:00") != "2026-09-18" ||
    MailboxDateRules.ReceivedDate("2026-09-18T00:30:00+08:00") != "2026-09-18")
    throw new InvalidOperationException("邮箱邮件未按北京时间收件日期归类");
Console.WriteLine("Mailbox received-date tests passed.");
var initializationToday = new DateOnly(2026, 9, 28);
if (MailInitializationRules.SafeSo("""{"so_numbers":["SO123"],"fields":{"ship_date":"2026-09-28"}}""", initializationToday) != "SO123" ||
    MailInitializationRules.SafeSo("""{"so_numbers":["SO123"],"fields":{"ship_date":"2026-09-27"}}""", initializationToday) is not null ||
    MailInitializationRules.SafeSo("""{"so_numbers":["SO123","SO124"],"fields":{"ship_date":"2026-09-29"}}""", initializationToday) is not null ||
    MailInitializationRules.SafeSo("""{"so_numbers":["SO123"],"fields":{"ship_date":""}}""", initializationToday) is not null)
    throw new InvalidOperationException("历史初始化只能自动确认明确的未来单 SO 任务");
Console.WriteLine("Mailbox initialization safety tests passed.");
var shipmentClassification = MailClassificationRules.Classify("转发：《出货通知》 SO#123");
var changeClassification = MailClassificationRules.Classify("更新：截补延迟 SO#123");
var unknownClassification = MailClassificationRules.Classify("Hello");
if (shipmentClassification.Category != "Shipment" || shipmentClassification.NeedsReview ||
    changeClassification.Category != "Change" || changeClassification.NeedsReview ||
    unknownClassification.Category != "Unclassified" || !unknownClassification.NeedsReview)
    throw new InvalidOperationException("邮件自动分类规则不正确");
if (MailClassificationRules.NormalizeEmail("姓名 <TEST@Example.COM>") != "test@example.com")
    throw new InvalidOperationException("联系人邮箱标准化不正确");
Console.WriteLine("Mailbox automatic classification tests passed.");
if (!MailContactRules.IsInternal("name@hanson2.com") || !MailContactRules.IsInternal("NAME@ROYALREGENT.NET") ||
    MailContactRules.IsInternal("name@customer.com"))
    throw new InvalidOperationException("公司内部邮箱域名判断不正确");
Console.WriteLine("Mailbox internal-domain tests passed.");

var parsedWarehouse = DailyMailRules.Parse("""{"message":{"body_text":"交仓通知"},"fields":{"so_number":"SO-W"},"items":[{"product_code":"P1"}]}""");
var parsedContainer = DailyMailRules.Parse("""{"fields":{"container_type":"1*40HQ"},"items":[{"product_code":"P2"}]}""");
if (MailClassificationRules.ClassifyParsed("交仓通知", parsedWarehouse) is not { Category: "Shipment", Mode: "Warehouse", NeedsReview: false } ||
    MailClassificationRules.ClassifyParsed("附件资料", parsedContainer) is not { Category: "Shipment", Mode: "Container" } ||
    MailClassificationRules.ClassifyStored("资料", "invalid") is not { Category: "Unclassified", NeedsReview: true })
    throw new InvalidOperationException("解析后的自动用途与出货方式分类不正确");
var parsedChange = DailyMailRules.Parse("""{"message":{"body_text":"计划日期变更为明天"},"fields":{"so_number":"SO-C"}}""");
if (MailClassificationRules.ClassifyParsed("补充资料", parsedChange).Category != "Change")
    throw new InvalidOperationException("正文变更资料应由系统识别为变更");
var ordinaryReply = DailyMailRules.Parse("""{"message":{"body_text":"已收到，谢谢\nFrom: Old sender\n交仓通知"}}""");
if (MailClassificationRules.ClassifyParsed("回执", ordinaryReply) is not { Category: "Other", Mode: "Unknown" })
    throw new InvalidOperationException("引用中的历史邮件不能把收件回执变成任务邮件");
var mailForTask = new ImportEmailItem { Id=900, Status="pending", WorkCategory="Shipment", NeedsClassificationReview=false, MailSubject="新增 SO900" };
if (!DailyMailRules.CanCreateTask(mailForTask)) throw new InvalidOperationException("待确认新增资料应支持建任务");
foreach (var state in new[] { "failed", "duplicate", "confirmed" })
{
    mailForTask.Status=state;
    if (DailyMailRules.CanCreateTask(mailForTask)) throw new InvalidOperationException("失败、重复和已确认邮件不能再次建立任务");
}
mailForTask.Status="pending"; mailForTask.HandlingStatus="Processed"; mailForTask.HandlingOutcome="NoTask";
if (DailyMailRules.CanCreateTask(mailForTask)) throw new InvalidOperationException("无需建任务的已确认邮件不能建立任务");
var sourceTask = new ShipmentTask();
try { DailyMailRules.RecordSource(sourceTask,mailForTask,true); throw new Exception("应拒绝未确认邮件来源"); }
catch (InvalidOperationException) { }
mailForTask.Status="confirmed";
DailyMailRules.RecordSource(sourceTask,mailForTask,true);
DailyMailRules.RecordSource(sourceTask,mailForTask,false);
if (JsonNode.Parse(sourceTask.SourceEmailsJson)!.AsArray().Count!=1)
    throw new InvalidOperationException("确认来源摘要必须去重并保存在任务内");
var changedTask = new ShipmentTask { PlannedShipDate=new DateOnly(2026,10,15), Port="原装货港", ContainerType="1*40HQ", Status="PendingShipment" };
DailyMailRules.ApplyConfirmedChanges(changedTask,DailyMailRules.Parse("""{"fields":{"ship_date":"2026-10-16","port":"","si_deadline":"2026-10-12T12:00"}}"""));
if (changedTask.PlannedShipDate!=new DateOnly(2026,10,16) || changedTask.Port!="原装货港" || changedTask.ContainerType!="1*40HQ" || changedTask.Status!="PendingShipment")
    throw new InvalidOperationException("确认变更应更新船期，保留缺失字段及任务状态");
try { DailyMailRules.ApplyConfirmedChanges(changedTask,DailyMailRules.Parse("""{"fields":{"ship_date":"not-a-date"}}"""));throw new Exception("应拒绝无效船期变更"); }
catch (InvalidOperationException) { }
Console.WriteLine("Daily mailbox confirmation and task-source snapshot tests passed.");

var allowed = new[]
{
    ("PendingReview", "PendingShipment"),
    ("PendingReview", "Cancelled"),
    ("PendingShipment", "PendingReview"),
    ("PendingShipment", "Completed"),
    ("PendingShipment", "Cancelled"),
};
var rejected = new[]
{
    ("PendingReview", "Completed"),
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
var existingCargo = JsonNode.Parse("""[{"source_file":"packing.xlsx","source_row":6,"product_code":"A1","quantity":99}]""")!.AsArray();
var reimportedCargo = JsonNode.Parse("""[{"source_file":"packing.xlsx","source_row":6,"product_code":"A1","quantity":10},{"source_file":"packing.xlsx","source_row":7,"product_code":"B1","quantity":20}]""")!.AsArray();
var mergedCargo = ShipmentImportMerge.AppendNewItems(existingCargo, reimportedCargo);
if (mergedCargo.Count != 2 || mergedCargo[0]?["quantity"]?.GetValue<int>() != 99 || mergedCargo[1]?["product_code"]?.ToString() != "B1" ||
    ShipmentImportMerge.AppendNewItems(mergedCargo, reimportedCargo).Count != 2)
    throw new InvalidOperationException("重复导入应保留手工修改，只补入新来源行且不得重复添加");
var manuallyRemovedCargo = ShipmentImportMerge.AppendNewItems(new JsonArray(), reimportedCargo,
    JsonNode.Parse("""[{"source_file":"packing.xlsx","source_row":6,"product_code":"A1","quantity":10}]""")!.AsArray());
if (manuallyRemovedCargo.Count != 1 || manuallyRemovedCargo[0]?["product_code"]?.ToString() != "B1")
    throw new InvalidOperationException("重复导入不得恢复用户手工删除的旧货物");
var existingGroups = JsonNode.Parse("""[{"warehouse":"人工修改的仓库","references":["PL260901360"],"items":[{"source_row":6,"product_code":"A1","quantity":99}]}]""")!.AsArray();
var incomingGroups = JsonNode.Parse("""[{"warehouse":"待确认仓库","references":["PL260901360"],"items":[{"source_row":6,"product_code":"A1","quantity":10},{"source_row":7,"product_code":"B1","quantity":20}]}]""")!.AsArray();
var mergedGroups = ShipmentImportMerge.AppendNewGroups(existingGroups, incomingGroups);
if (mergedGroups.Count != 1 || mergedGroups[0]?["warehouse"]?.ToString() != "人工修改的仓库" || mergedGroups[0]?["items"]?.AsArray().Count != 2)
    throw new InvalidOperationException("重复导入分组应保留手工修改的仓库并补入新货物");
Console.WriteLine("Shipment re-import merge tests passed.");
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
var extractedPayload = JsonNode.Parse("""
{"customer":"ZURU","items":[{"contract_number":"4500217958","product_code":"9574UQ2","customer_po":"10001835258-3891","pieces":500,"order_total_pieces":888}]}
""")!.AsObject();
ShipmentOrderTotals.Apply(extractedPayload, [fullContainer, looseCargo]);
if (extractedPayload["items"]![0]!["order_total_pieces"]!.GetValue<decimal>() != 888)
    throw new InvalidOperationException("邮件已提取的每单总件数不应被系统汇总覆盖");
Console.WriteLine("Shipment order total pieces tests passed.");
var mixedTask = new ShipmentTask { Id=99, Customer="ZURU", ItemsJson="""
    [{"contract_number":"4500217958","product_code":"9574A","customer_po":"10001835258-3891","pieces":50,"packing_group":"mix","source_file":"mixed.xlsx","source_row":2},
     {"contract_number":"4500217958","product_code":"9574B","customer_po":"10001835258-3891","pieces":50,"packing_group":"mix","source_file":"mixed.xlsx","source_row":3}]
    """ };
var mixedPayload = JsonNode.Parse("""{"customer":"ZURU","items":[{"contract_number":"4500217958","product_code":"9574A","customer_po":"10001835258-3891","pieces":50}]}""")!.AsObject();
ShipmentOrderTotals.Apply(mixedPayload, [mixedTask]);
if (mixedPayload["items"]![0]!["order_total_pieces"]!.GetValue<decimal>() != 50)
    throw new InvalidOperationException("同货号不同款混装的每单总件数不得重复计算");

var categoryProducts = new[] { new ProductInfo { ProductCode="CAT-01", QuantityPerBox=12, ToyCategory="电子" } };
var categoryItem = JsonNode.Parse("""{"product_code":"CAT01","spec":12}""")!.AsObject();
ProductInfoMatching.FillCategory(categoryItem, categoryProducts);
if (categoryItem["category"]?.ToString() != "电子") throw new InvalidOperationException("产品类别应按货号和规格带入");
categoryItem["category"]="塑胶";
ProductInfoMatching.FillCategory(categoryItem, categoryProducts);
if (categoryItem["category"]?.ToString() != "塑胶") throw new InvalidOperationException("人工类别应保留");
foreach (var spec in new[] { "24", "invalid" })
{
    var unmatched = new JsonObject { ["product_code"]="CAT01", ["spec"]=spec };
    ProductInfoMatching.FillCategory(unmatched, categoryProducts);
    if (unmatched["category"] is not null) throw new InvalidOperationException("无匹配规格不能推断类别");
}
var ambiguousCategory = new JsonObject { ["product_code"]="CAT01", ["spec"]=12 };
ProductInfoMatching.FillCategory(ambiguousCategory, [categoryProducts[0], new ProductInfo { ProductCode="CAT01", QuantityPerBox=12, ToyCategory="塑胶" }]);
if (ambiguousCategory["category"] is not null) throw new InvalidOperationException("多重匹配不能推断类别");
Console.WriteLine("Shipment product category tests passed.");

var splitCargo = JsonNode.Parse("""{"fields":{"cargo_split_required":"true","ship_date":"2026-09-26","cutoff_date":"2026-09-30T12:00","container_type":"1*40HQ"},"items":[{"product_code":"A","shipment_scope":"current"},{"product_code":"B","shipment_scope":"waiting"}],"warehouse_groups":[{"warehouse":"W","items":[{"product_code":"A"},{"product_code":"B"}]}]}""")!.AsObject();
var cargoTasks = CargoNotificationRules.Split("", splitCargo);
if (cargoTasks.Count != 2 || cargoTasks[0].Payload["items"]!.AsArray().Count != 1 ||
    cargoTasks[0].Payload["fields"]!["cutoff_date"]!.ToString() != "2026-09-30T12:00" ||
    cargoTasks[1].Payload["fields"]!["waiting_notification"]!.ToString() != "true" ||
    cargoTasks[1].Payload["fields"]!["cutoff_date"]!.ToString() != "2026-09-30T12:00" ||
    cargoTasks[1].Payload["fields"]!["ship_date"]!.ToString() != "" ||
    cargoTasks[1].Payload["warehouse_groups"]![0]!["items"]!.AsArray().Count != 1 ||
    splitCargo["items"]!.AsArray().Count != 2)
    throw new InvalidOperationException("本次出运与剩余等待通知货物必须独立建任务并保留来源");
splitCargo["items"]![0]!["shipment_scope"] = "unassigned";
if (CargoNotificationRules.Validate(splitCargo) is null) throw new InvalidOperationException("未分配货物不得确认");
if (!ShipmentWorkflowRules.CanTransitionStatus("WaitingNotification", "PendingReview") ||
    ShipmentWorkflowRules.CanTransitionStatus("WaitingNotification", "PendingShipment"))
    throw new InvalidOperationException("等待通知任务必须重新复核才能出运");
if (ShipmentWorkflowRules.ResolvePlannedShipDate("2026-09-26", "2026-09-30T12:00", "", null) != new DateOnly(2026,9,26) ||
    ShipmentWorkflowRules.ResolvePlannedShipDate("", "2026-09-30T12:00", "", null) != new DateOnly(2026,9,29))
    throw new InvalidOperationException("明确出货日优先，无出货日沿用原推算规则");
var validTemplate = new ExportTemplate { Name="兴信交仓船务表",ShipmentMode="Warehouse",Purpose="Shipping",IsDefault=true };
if (ExportTemplateRules.Validate(validTemplate) is not null) throw new InvalidOperationException("有效模板被拒绝");
validTemplate.IsEnabled=false;
if (ExportTemplateRules.Validate(validTemplate) is null) throw new InvalidOperationException("停用模板不得设为默认");
validTemplate.IsDefault=false;validTemplate.ShipmentMode="Invalid";
if (ExportTemplateRules.Validate(validTemplate) is null) throw new InvalidOperationException("无效业务类型应被拒绝");
Console.WriteLine("Cargo waiting-notification, explicit ship-date and template validation tests passed.");

if (!ExportTemplateRules.CanManage("admin") || !ExportTemplateRules.CanManage("supervisor") || !ExportTemplateRules.CanManage("shipping") || ExportTemplateRules.CanManage("warehouse"))
    throw new InvalidOperationException("模板管理必须允许管理员和主管，拒绝普通船务和仓管");
Console.WriteLine("Export template role permission tests passed.");
var specialTemplate = new ExportTemplate { Name="华登特殊表", LayoutKey="SkyCastle", ShipmentMode="Warehouse" };
if (ExportTemplateRules.Validate(specialTemplate) is null) throw new InvalidOperationException("多柜特殊表不得用于交仓");
specialTemplate.ShipmentMode="Container";
if (ExportTemplateRules.Validate(specialTemplate) is not null) throw new InvalidOperationException("做柜特殊版式应被允许");
validTemplate.ShipmentMode="Container";validTemplate.WeightRule="Exact";
if (ExportTemplateRules.Validate(validTemplate) is not null) throw new InvalidOperationException("小数模板公式应被允许");
validTemplate.WeightRule="Truncate";
if (ExportTemplateRules.Validate(validTemplate) is not null) throw new InvalidOperationException("取整模板公式应被允许");
validTemplate.WeightRule="Invalid";
if (ExportTemplateRules.Validate(validTemplate) is null) throw new InvalidOperationException("无效模板公式应被拒绝");

var multiPlan = JsonNode.Parse("""{"fields":{"multi_container":"true","export_template":"sky-castle-multi"},"shipment_groups":[{"group_key":"container-1","so_number":"SO111111","container_type":"40HQ","cutoff_date":"2026-09-27T09:00"},{"group_key":"container-2","so_number":"SO222222","container_type":"40HQ","cutoff_date":"2026-10-02T12:00"}],"items":[{"product_code":"A","pieces":3,"quantity":36,"net_net_weight":14.04,"order_total_pieces":10},{"product_code":"B","pieces":7,"quantity":84,"net_net_weight":32.76,"order_total_pieces":10}]}""")!.AsObject();
var cabinets = MultiContainerRules.Split(multiPlan);
if (cabinets.Count != 2 || cabinets.Sum(c => c.Payload["items"]!.AsArray().Sum(i => decimal.Parse(i!["pieces"]!.ToString()))) != 10 ||
    cabinets.Sum(c => c.Payload["items"]!.AsArray().Sum(i => decimal.Parse(i!["net_net_weight"]!.ToString()))) != 46.80m ||
    cabinets.SelectMany(c => c.Payload["items"]!.AsArray()).Any(i => i!["order_total_pieces"]!.ToString() != "10") ||
    cabinets[1].Payload["fields"]!["cutoff_date"]!.ToString() != "2026-10-02T12:00") throw new InvalidOperationException("分柜数量、重量、PO整批口径或SO日期错误");
var inferredPoPlan = multiPlan.DeepClone().AsObject();
foreach (var item in inferredPoPlan["items"]!.AsArray()) { item!.AsObject().Remove("order_total_pieces"); item["customer_po"] = "PO-SAME"; }
if (MultiContainerRules.Split(inferredPoPlan).SelectMany(c => c.Payload["items"]!.AsArray()).Any(i => i!["order_total_pieces"]!.ToString() != "10"))
    throw new InvalidOperationException("同PO多个产品须保留整批PO总箱数");
var emptyPlan = multiPlan.DeepClone().AsObject(); emptyPlan["items"] = new JsonArray();
if (MultiContainerRules.Split(emptyPlan).Any(c => c.Payload["fields"]?["export_template"] is not null)) throw new InvalidOperationException("无产品邮件必须导出普通模板");
var invalidPlan = multiPlan.DeepClone().AsObject(); invalidPlan["items"]![0]!["pieces"] = 1.5;
try { MultiContainerRules.Split(invalidPlan); throw new Exception("不应允许小数箱数"); } catch (InvalidOperationException) { }
Console.WriteLine("Multi-container carton/weight conservation, PO context and no-cargo rules passed.");

var sharedWarehouse = JsonNode.Parse("""{"fields":{"separate_warehouse_so":"true"},"items":[{"product_code":"A","source_row":1,"quantity":12},{"product_code":"B","source_row":2,"quantity":24}],"warehouse_groups":[{"warehouse":"同一仓库","so_number":"SO1","items":[{"product_code":"A","source_row":1}]},{"warehouse":"同一仓库","so_number":"SO2","items":[{"product_code":"B","source_row":2}]}]}""")!.AsObject();
var warehouseTasks = WarehouseSoRules.Split(sharedWarehouse);
if (warehouseTasks.Count != 2 || warehouseTasks[0].Payload["fields"]!["so_number"]!.ToString() != "SO1" || warehouseTasks[1].Payload["items"]![0]!["quantity"]!.GetValue<int>() != 24)
    throw new InvalidOperationException("同仓不同SO必须分别建任务，保留对应货物数量");
sharedWarehouse["warehouse_groups"]!.AsArray().RemoveAt(1);
try { WarehouseSoRules.Split(sharedWarehouse); throw new Exception("必须拒绝遗漏货物"); } catch (InvalidOperationException) { }
Console.WriteLine("Warehouse SO isolation tests passed.");

var warehouseScopes = JsonNode.Parse("""
{"fields":{"separate_warehouse_so":"true","cargo_split_required":"true","ship_date":"2026-10-26","cutoff_date":"2026-10-30T12:00"},"items":[{"source_file":"fake.xlsx","source_row":1,"product_code":"A","quantity":10,"shipment_scope":"current"},{"source_file":"fake.xlsx","source_row":2,"product_code":"B","quantity":20,"shipment_scope":"waiting"},{"source_file":"fake.xlsx","source_row":3,"product_code":"C","quantity":30,"shipment_scope":"current"},{"source_file":"fake.xlsx","source_row":4,"product_code":"D","quantity":40,"shipment_scope":"waiting"}],"warehouse_groups":[{"warehouse":"同一仓库","so_number":"SO1","items":[{"source_file":"fake.xlsx","source_row":1,"product_code":"A"},{"source_file":"fake.xlsx","source_row":2,"product_code":"B"}]},{"warehouse":"同一仓库","so_number":"SO2","items":[{"source_file":"fake.xlsx","source_row":3,"product_code":"C"},{"source_file":"fake.xlsx","source_row":4,"product_code":"D"}]}]}
""")!.AsObject();
var originalWarehouseScopes = warehouseScopes.ToJsonString();
var scopedWarehouseTasks = WarehouseSoRules.Split(warehouseScopes);
if (scopedWarehouseTasks.Count != 4 || scopedWarehouseTasks.Select(task => task.GroupKey).Distinct().Count() != 4 ||
    warehouseScopes.ToJsonString() != originalWarehouseScopes ||
    scopedWarehouseTasks.Sum(task => task.Payload["items"]!.AsArray().Sum(item => item!["quantity"]!.GetValue<int>())) != 100)
    throw new InvalidOperationException("同仓不同SO及本次/等待范围必须独立，保留来源及货物总量");
foreach (var task in scopedWarehouseTasks)
{
    var cargo = task.Payload["items"]!.AsArray().Single()!;
    var waiting = cargo["shipment_scope"]!.ToString() == "waiting";
    var so = task.Payload["fields"]!["so_number"]!.ToString();
    var product = cargo["product_code"]!.ToString();
    if ((so == "SO1" ? product is not ("A" or "B") : product is not ("C" or "D")) ||
        !task.GroupKey.EndsWith(waiting ? ":waiting-notification" : ":current", StringComparison.Ordinal) ||
        task.Payload["warehouse_groups"]!.AsArray().Count != 1 ||
        task.Payload["warehouse_groups"]![0]!["items"]!.AsArray().Single()!["product_code"]!.ToString() != product ||
        task.Payload["fields"]!["cutoff_date"]!.ToString() != "2026-10-30T12:00" ||
        (waiting ? task.Payload["fields"]!["waiting_notification"]?.ToString() != "true" || task.Payload["fields"]!["ship_date"]!.ToString() != ""
            : task.Payload["fields"]!["waiting_notification"]?.ToString() == "true" || task.Payload["fields"]!["ship_date"]!.ToString() != "2026-10-26"))
        throw new InvalidOperationException("仓库SO或等待状态、日期及货物明细被交叉覆盖");
}
warehouseScopes["items"]![0]!["shipment_scope"] = "unassigned";
try { WarehouseSoRules.Split(warehouseScopes); throw new Exception("应拒绝未核对的交仓范围"); }
catch (InvalidOperationException) { }
Console.WriteLine("Warehouse SO/current-waiting composition and quantity conservation tests passed.");

var previewDates = JsonNode.Parse("""
{"items":[{"fields":{"task_type":"Delivery","ship_date":"","cutoff_date":"2026-10-30T12:00","si_deadline":"2026-10-29T10:00"}},{"fields":{"task_type":"Delivery","ship_date":"2026-10-26","cutoff_date":"2026-10-30T12:00"}},{"fields":{"ship_date":"","cutoff_date":"2026-10-30T12:00"}},{"fields":{"multi_container":"true","ship_date":"","cutoff_date":"2026-10-30T12:00"}}]}
""")!.AsObject();
MailClassificationRules.PopulatePreviewPlannedShipDates(previewDates);
if (previewDates["items"]![0]!["fields"]!["ship_date"]!.ToString() != "" ||
    previewDates["items"]![1]!["fields"]!["ship_date"]!.ToString() != "2026-10-26" ||
    previewDates["items"]![2]!["fields"]!["ship_date"]!.ToString() != "2026-10-29" ||
    previewDates["items"]![3]!["fields"]!["ship_date"]!.ToString() != "")
    throw new InvalidOperationException("Delivery预览不能按截期捏造送货日期，明确日期及普通邮件原推算规则应保留");
Console.WriteLine("Preview Delivery unknown/explicit dates and standard fallback tests passed.");

var correctedWarehouseSo = JsonNode.Parse("""
{"fields":{"separate_warehouse_so":"true","so_number":" SO123 "},"so_numbers":["SO123"],"items":[{"source_file":"fake.xlsx","source_row":1,"product_code":"A","quantity":12},{"source_file":"fake.xlsx","source_row":2,"product_code":"B","quantity":24}],"warehouse_groups":[{"warehouse":"仓库一","so_number":"","items":[{"source_file":"fake.xlsx","source_row":1,"product_code":"A"}]},{"warehouse":"仓库二","so_number":"","items":[{"source_file":"fake.xlsx","source_row":2,"product_code":"B"}]}]}
""")!.AsObject();
var originalCorrectedWarehouseSo = correctedWarehouseSo.ToJsonString();
var correctedWarehouseTasks = WarehouseSoRules.Split(correctedWarehouseSo);
if (correctedWarehouseTasks.Count != 2 || correctedWarehouseTasks.Select(task => task.GroupKey).Distinct().Count() != 2 ||
    correctedWarehouseTasks.Sum(task => task.Payload["items"]!.AsArray().Sum(item => item!["quantity"]!.GetValue<int>())) != 36 ||
    correctedWarehouseTasks.Any(task => task.Payload["fields"]!["so_number"]!.ToString() != "SO123" ||
        task.Payload["warehouse_groups"]![0]!["so_number"]!.ToString() != "SO123") ||
    correctedWarehouseSo.ToJsonString() != originalCorrectedWarehouseSo)
    throw new InvalidOperationException("唯一人工SO应补齐缺号仓库分组，保留各仓货物总量且不修改候选来源");
var singleWarehouseSo = correctedWarehouseSo.DeepClone().AsObject();
singleWarehouseSo["items"]!.AsArray().RemoveAt(1);
singleWarehouseSo["warehouse_groups"]!.AsArray().RemoveAt(1);
if (WarehouseSoRules.Split(singleWarehouseSo).Single().Payload["items"]![0]!["quantity"]!.GetValue<int>() != 12)
    throw new InvalidOperationException("单仓邮件的人工SO修正不能丢失货物");
correctedWarehouseSo["warehouse_groups"]![0]!["so_number"] = " SO456 ";
var preservedWarehouseTasks = WarehouseSoRules.Split(correctedWarehouseSo);
if (preservedWarehouseTasks[0].Payload["fields"]!["so_number"]!.ToString() != "SO456" ||
    preservedWarehouseTasks[0].Payload["warehouse_groups"]![0]!["so_number"]!.ToString() != "SO456" ||
    preservedWarehouseTasks[1].Payload["fields"]!["so_number"]!.ToString() != "SO123")
    throw new InvalidOperationException("明确分组SO不能被总SO修正覆盖");
foreach (var unresolvedSo in new[] { "", "SO1,SO2", "SO1，SO2" })
{
    singleWarehouseSo["fields"]!["so_number"] = unresolvedSo;
    try { WarehouseSoRules.Split(singleWarehouseSo); throw new Exception("缺分组SO时不能用未知或多号总SO确认"); }
    catch (InvalidOperationException) { }
}
foreach (var unresolvedSo in new[] { "SO1,SO2", "SO1，SO2" })
{
    singleWarehouseSo["fields"]!["so_number"] = "SO123";
    singleWarehouseSo["warehouse_groups"]![0]!["so_number"] = unresolvedSo;
    try { WarehouseSoRules.Split(singleWarehouseSo); throw new Exception("多号分组SO不能被唯一总SO替代"); }
    catch (InvalidOperationException) { }
}
Console.WriteLine("Warehouse reviewed single-SO fallback, existing assignments and ambiguity rejection tests passed.");

var explicitSchedules = JsonNode.Parse("""
{"fields":{"explicit_container_allocation":"true","multi_container":"true","si_deadline":"","cutoff_date":"","vessel_name":""},"shipment_groups":[{"group_key":"C1","so_number":"SO1","container_type":"40HQ","si_deadline":"2026-10-25T10:00","cutoff_date":"2026-10-27T12:00","vessel_name":"VESSEL-ONE"},{"group_key":"C2","so_number":"SO2","container_type":"40HQ","si_deadline":"2026-10-28T11:00","cutoff_date":"2026-10-30T13:00","vessel_name":"VESSEL-TWO"}],"items":[{"product_code":"A","container_assignment":"C1","quantity":12},{"product_code":"B","container_assignment":"C2","quantity":24}]}
""")!.AsObject();
var originalExplicitSchedules = explicitSchedules.ToJsonString();
var scheduledCabinets = MultiContainerRules.Split(explicitSchedules);
if (scheduledCabinets.Count != 2 || scheduledCabinets.Sum(task => task.Payload["items"]!.AsArray().Sum(item => item!["quantity"]!.GetValue<int>())) != 36 ||
    explicitSchedules.ToJsonString() != originalExplicitSchedules)
    throw new InvalidOperationException("明确分柜船期复制不能改变货物分配或原邮件");
for (var index = 0; index < scheduledCabinets.Count; index++)
{
    var expectedGroup = explicitSchedules["shipment_groups"]![index]!;
    if (scheduledCabinets[index].GroupKey != expectedGroup["group_key"]!.ToString() ||
        new[] { "so_number", "container_type", "si_deadline", "cutoff_date", "vessel_name" }.Any(key =>
            scheduledCabinets[index].Payload["fields"]![key]!.ToString() != expectedGroup[key]!.ToString()))
        throw new InvalidOperationException("各柜SO、SI、截期和船名应保留各自安排，不得混用");
}
var commonExplicitSchedule = JsonNode.Parse("""
{"fields":{"explicit_container_allocation":"true","multi_container":"false","si_deadline":"2026-10-25T10:00","cutoff_date":"2026-10-27T12:00","vessel_name":"COMMON-VESSEL"},"shipment_groups":[{"group_key":"C1","so_number":"SO1","container_type":"40HQ"}],"items":[{"product_code":"A","container_assignment":"C1","quantity":12}]}
""")!.AsObject();
var commonScheduleTask = MultiContainerRules.Split(commonExplicitSchedule).Single();
if (new[] { "si_deadline", "cutoff_date", "vessel_name" }.Any(key =>
    commonScheduleTask.Payload["fields"]![key]!.ToString() != commonExplicitSchedule["fields"]![key]!.ToString()))
    throw new InvalidOperationException("单柜附件未提供船期字段时应保留公共船期");
commonExplicitSchedule["shipment_groups"]![0]!["si_deadline"] = null;
commonExplicitSchedule["shipment_groups"]![0]!["cutoff_date"] = "";
var explicitlyClearedSchedule = MultiContainerRules.Split(commonExplicitSchedule).Single();
if (explicitlyClearedSchedule.Payload["fields"]!["si_deadline"] is not null ||
    explicitlyClearedSchedule.Payload["fields"]!["cutoff_date"]!.ToString() != "" ||
    explicitlyClearedSchedule.Payload["fields"]!["vessel_name"]!.ToString() != "COMMON-VESSEL")
    throw new InvalidOperationException("分柜明确空船期应覆盖公共值，缺失字段才沿用公共值");
Console.WriteLine("Explicit cabinet per-group schedules and absent/common metadata tests passed.");

var tripPlan = JsonNode.Parse("""
{"fields":{"separate_warehouse_so":"true","so_number":"SO-A,SO-B"},"items":[{"product_code":"A","quantity":100,"pieces":10,"volume":40,"gross_weight_per_box":2}],"warehouse_trip_plan":{"confirmed":true,"trips":[{"key":"first","warehouse":"裕泰仓","vehicle_type":"1*8T","allocations":[{"item_index":0,"quantity":"50","pieces":"5","volume":"20"}]},{"key":"second","warehouse":"裕泰仓","vehicle_type":"","allocations":[{"item_index":0,"quantity":"50","pieces":"5","volume":"20"}]}]}}
""")!.AsObject();
var tripTasks = WarehouseTripRules.Split(tripPlan);
if (tripTasks.Count != 2 || tripTasks[0].GroupKey != "truck:first" || tripTasks[0].Payload["items"]![0]!["pieces"]!.ToString() != "5" || tripTasks[0].Payload["items"]![0]!["gross_weight_per_box"]!.ToString() != "2" || tripTasks[0].Payload["fields"]!["so_number"]!.ToString() != "SO-A,SO-B") throw new Exception("分车须保留人工数量、每箱重量和原SO信息");
foreach(var invalid in new[] {"unconfirmed", "overflow", "missing", "quantity", "duplicate", "tonnes"})
{
    var bad = tripPlan.DeepClone().AsObject();
    var plan = bad["warehouse_trip_plan"]!;
    if(invalid=="unconfirmed")plan["confirmed"]=false;
    if(invalid=="overflow")plan["trips"]![0]!["allocations"]![0]!["volume"]=36;
    if(invalid=="missing")plan["trips"]!.AsArray().RemoveAt(1);
    if(invalid=="quantity")plan["trips"]![0]!["allocations"]![0]!["quantity"]=51;
    if(invalid=="duplicate")plan["trips"]![1]!["key"]="first";
    if(invalid=="tonnes")plan["trips"]![0]!["vehicle_type"]="wrong";
    try { WarehouseTripRules.Split(bad); throw new Exception($"应拒绝无效分车{invalid}"); } catch(InvalidOperationException) { }
}
var exactTrip = tripPlan.DeepClone().AsObject();
exactTrip["items"]![0]!["volume"]=70;
foreach(var trip in exactTrip["warehouse_trip_plan"]!["trips"]!.AsArray())trip!["allocations"]![0]!["volume"]=35;
if(WarehouseTripRules.Split(exactTrip).Count!=2)throw new Exception("裕泰仓35CBM边界应允许确认");
Console.WriteLine("Warehouse manual truck allocation, 35 CBM limit, conservation and confirmation tests passed.");

var palletTrip=tripPlan.DeepClone().AsObject();palletTrip["items"]![0]!["pallet_count"]=4;
foreach(var trip in palletTrip["warehouse_trip_plan"]!["trips"]!.AsArray())trip!["allocations"]![0]!["pallet_count"]=2;
if(WarehouseTripRules.Split(palletTrip).Sum(trip=>decimal.Parse(trip.Payload["items"]![0]!["pallet_count"]!.ToString()))!=4)throw new Exception("分车卡板合计错误");
palletTrip["warehouse_trip_plan"]!["trips"]![1]!["allocations"]![0]!["pallet_count"]=4;
try { WarehouseTripRules.Split(palletTrip); throw new Exception("应拒绝重复分配卡板"); } catch(InvalidOperationException) { }

var huadengDisplay = new ExportTemplate { Company="Huadeng",Name="华登普通做柜表",ShipmentMode="Container",Purpose="Shipping",WeightRule="DisplayInteger" };
if(ExportTemplateRules.Validate(huadengDisplay) is not null)throw new Exception("华登显示整数公式应允许");
huadengDisplay.Company="Xingxin";
if(ExportTemplateRules.Validate(huadengDisplay) is null)throw new Exception("华登新增模板公式不得扩散到兴信");
huadengDisplay.Company="Huadeng";huadengDisplay.LayoutKey="CustomerItem";
if(ExportTemplateRules.Validate(huadengDisplay) is null)throw new Exception("华登客户ITEM不得作为独立模板");
huadengDisplay.LayoutKey="CartonMarks";
if(ExportTemplateRules.Validate(huadengDisplay) is null)throw new Exception("箱唛尺寸版仅限交仓");
huadengDisplay.ShipmentMode="Warehouse";
if(ExportTemplateRules.Validate(huadengDisplay) is null)throw new Exception("华登箱唛交仓版不得作为独立模板");
huadengDisplay.LayoutKey="Standard";huadengDisplay.WeightRule="Truncate";
if(ExportTemplateRules.Validate(huadengDisplay) is null)throw new Exception("华登INT不得作为独立模板");
huadengDisplay.LayoutKey="SkyCastle";huadengDisplay.WeightRule="Template";huadengDisplay.ShipmentMode="Container";
if(ExportTemplateRules.Validate(huadengDisplay) is not null)throw new Exception("SKY分柜特殊表必须保留");
Console.WriteLine("Huadeng layout and formula-version isolation tests passed.");

var sparsePackingTrip = JsonNode.Parse("""
{"items":[{"product_code":"PACK-A","quantity":100,"pieces":10,"volume":20,"pallet_count":2,"net_weight":3,"packing_group":"mix","source_file":"packing.xlsx"},{"product_code":"PACK-B","quantity":50,"pieces":null,"volume":null,"pallet_count":null,"net_weight":4,"packing_group":"mix","source_file":"packing.xlsx"}],"warehouse_trip_plan":{"confirmed":true,"trips":[{"key":"one","warehouse":"裕泰仓","vehicle_type":"1*8T","allocations":[{"item_index":0,"quantity":"100","pieces":"10","volume":"20","pallet_count":"2"},{"item_index":1,"quantity":"50","pieces":"","volume":"","pallet_count":""}]}]}}
""")!.AsObject();
var sparsePackingTasks = WarehouseTripRules.Split(sparsePackingTrip);
if (sparsePackingTasks.Count != 1 || sparsePackingTasks[0].Payload["items"]!.AsArray().Count != 2 ||
    sparsePackingTasks[0].Payload["items"]![1]!["pieces"] is not null || sparsePackingTasks[0].Payload["items"]![1]!["volume"] is not null ||
    sparsePackingTasks[0].Payload["items"]![1]!["net_weight"]!.GetValue<int>() != 4)
    throw new Exception("混装空后行须保留，逐款数量和净重不得当共享字段合并");
foreach (var invalidPacking in new[] { "original-pieces", "original-volume", "original-pallets", "allocation", "clear-original", "missing-pieces", "missing-volume", "cross-truck", "duplicate-sku", "invent-pallets" })
{
    var bad = sparsePackingTrip.DeepClone().AsObject();
    var first = bad["items"]![0]!; var second = bad["items"]![1]!;
    var allocations = bad["warehouse_trip_plan"]!["trips"]![0]!["allocations"]!.AsArray();
    if (invalidPacking == "original-pieces") second["pieces"] = 15;
    if (invalidPacking == "original-volume") second["volume"] = 21;
    if (invalidPacking == "original-pallets") second["pallet_count"] = 3;
    if (invalidPacking == "allocation") allocations[1]!["pieces"] = "15";
    if (invalidPacking == "clear-original") allocations[0]!["pieces"] = "";
    if (invalidPacking == "missing-pieces") first["pieces"] = null;
    if (invalidPacking == "missing-volume") first["volume"] = null;
    if (invalidPacking == "duplicate-sku") allocations.Add(allocations[1]!.DeepClone());
    if (invalidPacking == "invent-pallets") { first["pallet_count"] = null; allocations[0]!["pallet_count"] = "0"; }
    if (invalidPacking == "cross-truck")
    {
        var moved = allocations[1]!.DeepClone(); allocations.RemoveAt(1);
        bad["warehouse_trip_plan"]!["trips"]!.AsArray().Add(new JsonObject { ["key"] = "two", ["warehouse"] = "裕泰仓", ["vehicle_type"] = "1*8T", ["allocations"] = new JsonArray(moved) });
    }
    try { WarehouseTripRules.Split(bad); throw new Exception($"应拒绝混装异常 {invalidPacking}"); } catch (InvalidOperationException) { }
}
var repeatedPacking = sparsePackingTrip.DeepClone().AsObject();
foreach (var field in new[] { "pieces", "volume", "pallet_count" })
{
    repeatedPacking["items"]![1]![field] = repeatedPacking["items"]![0]![field]!.DeepClone();
    repeatedPacking["warehouse_trip_plan"]!["trips"]![0]!["allocations"]![1]![field] = repeatedPacking["warehouse_trip_plan"]!["trips"]![0]!["allocations"]![0]![field]!.DeepClone();
}
if (WarehouseTripRules.Split(repeatedPacking).Count != 1) throw new Exception("重复展示的共享体积只能按组计算一次");
var withoutPallets = sparsePackingTrip.DeepClone().AsObject(); withoutPallets["items"]![0]!["pallet_count"] = null;
withoutPallets["warehouse_trip_plan"]!["trips"]![0]!["allocations"]![0]!["pallet_count"] = "";
if (WarehouseTripRules.Split(withoutPallets)[0].Payload["items"]![0]!["pallet_count"] is not null) throw new Exception("无卡板资料不得发明卡板数");
Console.WriteLine("Warehouse mixed-packing sparse shared fields, consistency, whole-group assignment and optional pallets passed.");

var mixedOrderedTrip = sparsePackingTrip.DeepClone().AsObject();
mixedOrderedTrip["items"]!.AsArray().Add(new JsonObject { ["product_code"] = "PLAIN", ["quantity"] = 1, ["pieces"] = 1, ["volume"] = 1 });
mixedOrderedTrip["warehouse_trip_plan"]!["trips"]![0]!["allocations"]!.AsArray().Insert(1,
    new JsonObject { ["item_index"] = 2, ["quantity"] = "1", ["pieces"] = "1", ["volume"] = "1" });
var orderedCargo = WarehouseTripRules.Split(mixedOrderedTrip)[0].Payload["items"]!.AsArray();
if (!orderedCargo.Select(item => item!["product_code"]!.ToString()).SequenceEqual(new[] { "PACK-A", "PACK-B", "PLAIN" }))
    throw new Exception("移动分配后须按原货物顺序稳定输出，避免拆散混装组");
var repeatedSlices = tripPlan.DeepClone().AsObject();
var slices = repeatedSlices["warehouse_trip_plan"]!["trips"]![0]!["allocations"]!.AsArray();
slices[0]!["quantity"] = "20"; slices[0]!["pieces"] = "2"; slices[0]!["volume"] = "8";
slices.Add(new JsonObject { ["item_index"] = 0, ["quantity"] = "30", ["pieces"] = "3", ["volume"] = "12" });
if (!WarehouseTripRules.Split(repeatedSlices)[0].Payload["items"]!.AsArray().Select(item => item!["quantity"]!.GetValue<decimal>()).SequenceEqual(new decimal[] { 20, 30 }))
    throw new Exception("同一普通SKU的多个分片须保留原片顺序");
var mixedScopes = sparsePackingTrip.DeepClone().AsObject();
mixedScopes["fields"] = new JsonObject { ["cargo_split_required"] = "true" };
mixedScopes["items"]![0]!["shipment_scope"] = "current"; mixedScopes["items"]![1]!["shipment_scope"] = "waiting";
try { WarehouseTripRules.Split(mixedScopes); throw new Exception("混装组不得被二次按本次/等待范围拆开"); } catch (InvalidOperationException) { }
mixedScopes["items"]![1]!["shipment_scope"] = "current";
if (WarehouseTripRules.Split(mixedScopes).Count != 1) throw new Exception("同范围混装应保持一个任务");
foreach (var invalidGross in new[] { "99", "-1", "not-a-number" })
{
    var bad = sparsePackingTrip.DeepClone().AsObject(); bad["items"]![0]!["gross_weight"] = "25.2"; bad["items"]![1]!["gross_weight"] = invalidGross;
    try { WarehouseTripRules.Split(bad); throw new Exception("混装原共享毛重无效或不一致应拒绝"); } catch (InvalidOperationException) { }
}
var ordinaryCbmAlias = tripPlan.DeepClone().AsObject(); ordinaryCbmAlias["items"]![0]!["volume"] = ""; ordinaryCbmAlias["items"]![0]!["cbm"] = 40;
if (WarehouseTripRules.Split(ordinaryCbmAlias).Count != 2) throw new Exception("普通货物空volume须与初稿一致使用cbm");
Console.WriteLine("Warehouse stable source order, unchanged slice order, shared source gross and whole-group notification scopes passed.");

using (var schemaConnection = new SqliteConnection("Data Source=:memory:"))
{
    schemaConnection.Open();
    using var schemaDb = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(schemaConnection).Options);
    schemaDb.Database.ExecuteSqlRaw("""
        CREATE TABLE ExportTemplates (Id INTEGER PRIMARY KEY AUTOINCREMENT,Company TEXT NOT NULL,Name TEXT NOT NULL,
            ShipmentMode TEXT NOT NULL,Purpose TEXT NOT NULL,Version TEXT NOT NULL,Notes TEXT NOT NULL,
            IsEnabled INTEGER NOT NULL,IsDefault INTEGER NOT NULL,UpdatedAt TEXT NOT NULL);
        INSERT INTO ExportTemplates VALUES
            (1,'Huadeng','华登柜船务表','Container','Shipping','1.0','',1,1,'2026-10-01 00:00:00'),
            (2,'Huadeng','华登柜仓务表','Container','Warehouse','1.0','',0,0,'2026-10-02 00:00:00'),
            (3,'Huadeng','华登车（交仓）船务表','Warehouse','Shipping','1.0','',1,0,'2026-10-03 00:00:00'),
            (4,'Huadeng','人工名称','Warehouse','Warehouse','custom','人工说明',1,1,'2026-10-04 00:00:00');
        """);
    ExportTemplateEndpoints.EnsureSchema(schemaDb);
    var migrated = schemaDb.ExportTemplates.IgnoreQueryFilters().AsNoTracking().OrderBy(t => t.Id).ToArray();
    var untouchedDefault = migrated.Single(t => t.Id == 1);
    if (untouchedDefault.Version != "2.0" || untouchedDefault.WeightRule != "DisplayInteger" || untouchedDefault.Name != "普通走柜表")
        throw new Exception("未改过的华登默认模板应升级显示整数公式");
    foreach (var id in new long[] { 2, 3, 4 })
    {
        var template = migrated.Single(t => t.Id == id);
        var expectedName = id == 2 ? "华登柜仓务表" : id == 3 ? "华登车（交仓）船务表" : "人工名称";
        if (template.Name != expectedName || template.Version != (id == 4 ? "custom" : "1.0") || template.Notes != (id == 4 ? "人工说明" : "") ||
            template.WeightRule != "Template" || template.LayoutKey != "Standard" || template.IsDefault || template.IsEnabled)
            throw new Exception("旧版本须保留历史内容但停用，不能混入三种模板选项");
    }
    var activeCatalog = migrated.Where(t => t.Company == "Huadeng" && t.IsEnabled).ToArray();
    foreach (var purpose in new[] { "Shipping", "Warehouse" })
        if (!activeCatalog.Where(t => t.Purpose == purpose).Select(t => t.Name).Order().SequenceEqual(new[] { "SKY分柜特殊表", "普通交仓表", "普通走柜表" }.Order()))
            throw new Exception("任何历史配置下均须补齐每个用途的三种模板");
    var typedBeforeRestart = System.Text.Json.JsonSerializer.Serialize(migrated);
    ExportTemplateEndpoints.EnsureSchema(schemaDb);
    if (System.Text.Json.JsonSerializer.Serialize(schemaDb.ExportTemplates.IgnoreQueryFilters().AsNoTracking().OrderBy(t => t.Id).ToArray()) != typedBeforeRestart)
        throw new Exception("再次启动模板迁移须逐字段幂等，不得覆盖人工设置或更新已有时间戳");
}
Console.WriteLine("Export-template actual SQLite schema upgrade, manual disabled/default preservation and restart idempotence passed.");
