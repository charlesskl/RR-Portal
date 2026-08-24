namespace SprayPlan.Api.Features.Inventory;

// 库存查询页一行 = 一个 (款号·部位) 键的当前成品在库 + 车间存数 + 工序半成品（散件）
// 成品在库 = 最后工序实际入库；车间存数 = 最后工序完成数 − 实际入库；散件 = 相邻工序完成数差额之和。
public record InventoryRow(
    int ProductId, string ProductNo,
    string ItemName, string PartName,
    int FinishedInStock, int WorkshopStock, int LooseAvailable);
