namespace SprayPlan.Api.Features.Products;

// ===== 预览返回 =====
public record PreviewPart(string ItemName, string PartName, string CraftDetail, string? Category,
    int DailyCapacity, int StdMachineCount, double LaborPrice, double UnitCost, double PaintCost, double QuotedPrice, string? Remark,
    int? ExistingPartId, string ChangeType, List<string> ChangedFields, CurrentPartValues? Current);
public record CurrentPartValues(string ItemName, string PartName, string CraftDetail, string Craft,
    int DailyCapacity, int StdMachineCount, double LaborPrice, double UnitCost, double PaintCost, double QuotedPrice, string? Remark);
public record PreviewProduct(string SheetName, string ProductNo, string SuggestedItemName, bool IsThreeLevel,
    bool Duplicate, int? ExistingProductId, bool HasChanges, List<PreviewPart> Parts);
public record UnrecognizedSheet(string SheetName, string Reason);
public record ImportPreviewResponse(List<PreviewProduct> Products, List<UnrecognizedSheet> Unrecognized,
    int NormalCount, int PendingCraftCount, int DuplicateCount);

// ===== 提交入参（前端把用户处理结果发回）=====
public record CommitPart(string ItemName, string PartName, string Craft, string CraftDetail,
    int DailyCapacity, int StdMachineCount, double LaborPrice, double UnitCost, double PaintCost, double QuotedPrice, string? Remark,
    int? ExistingPartId, List<string>? UpdateFields);
// Parts 声明为可空：客户端可能传 parts:null，Commit 方法里已有 null 守卫
public record CommitProduct(string ProductNo, int? ExistingProductId, List<CommitPart>? Parts);
public record ImportCommitRequest(List<CommitProduct> Products);
public record ImportCommitResult(int Created, int Updated, int AddedParts, int UpdatedFields, int Skipped, List<string> SkippedProductNos);
