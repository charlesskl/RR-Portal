namespace SprayPlan.Api.Features.Orders;

// PDF 订单导入相关 DTO（集成层）。日期统一用 string 传，格式 yyyy-MM-dd，入库时解析成 DateTime。
// 注意：订单已无 customerName（客户字段已删），数量为部位级（OrderPartQty）。

// 抬头草稿：外部订单号 + 订单/交货日期 + 解析出的款号 + 是否 MA。
public record ImportDraftHead(string ExternalOrderNo, string OrderDate, string? DeliveryDate, string ProductNo, bool IsMa);

// 草稿明细行：PDF 原始子件名 + 合计数量 + 合并行数 + 匹配到的产品库子件名（null=未命中/红）。
public record ImportDraftLine(string PdfItemName, int TotalQty, int MergedRows, string? MatchedItemName);

// import-pdf 返回的完整草稿：抬头 + 是否找到产品库 + 产品 id + 行 + PDF token + 该货号可选子件名（红行手工选用）。
public record ImportDraft(ImportDraftHead Head, bool ProductFound, int? ProductId, List<ImportDraftLine> Lines, string PdfToken, List<string> AvailableItems);

// import-confirm 入参里的确认行：已匹配子件名 + 合计数量（该子件每个部位都填此数）。
public record ImportConfirmLine(string MatchedItemName, int TotalQty);

// import-confirm 入参：抬头 + token + 是否作为待补产品（货号找不到时 true）+ 确认行。
public record ImportConfirmRequest(ImportDraftHead Head, string PdfToken, bool AsPendingProduct, List<ImportConfirmLine> Lines);

// continue-parse 入参：补上的产品 id（重新解析原 PDF 入明细）。
public record ContinueParseRequest(int ProductId);
