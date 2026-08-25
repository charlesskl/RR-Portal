namespace SprayPlan.Api.Features.Inventory;

public record InventoryStepRow(int StepNo, string Craft, int TotalGood, int Backlog);

// 库存查询页一行 = 一个（货号·子件·部位）的工序积压、成品和车间存数。
public record InventoryRow(
    int ProductId, string ProductNo,
    string ItemName, string PartName,
    string OrderNos, List<InventoryStepRow> Steps,
    int WipTotal, int FinishedStock, int WorkshopStock);
