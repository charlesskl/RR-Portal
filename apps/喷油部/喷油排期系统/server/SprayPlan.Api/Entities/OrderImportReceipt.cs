namespace SprayPlan.Api.Entities;

// 每次导入的来源与承接数量快照；重复订单合并时追加记录，不覆盖历史。
public class OrderImportReceipt
{
    public int Id { get; set; }
    public int OrderId { get; set; }
    public Order? Order { get; set; }
    public string FactoryId { get; set; } = "XINGXIN";
    public string? SourceFactoryId { get; set; }
    public long AcceptedQty { get; set; }
    public string Details { get; set; } = "[]";
    public bool PendingDetails { get; set; }
    public string PdfToken { get; set; } = "";
    public string CreatedBy { get; set; } = "";
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}
