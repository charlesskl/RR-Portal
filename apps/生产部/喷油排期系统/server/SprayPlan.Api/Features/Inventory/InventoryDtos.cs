namespace SprayPlan.Api.Features.Inventory;

// 库存查询页一行 = 一个 (款号·子件·部位) 键的当前成品在库 + 车间存数 + 散件可用
// 车间存数 = Σ员工报数 − Σ入库数(良品)：做了但还没入库、堆在车间的量
public record InventoryRow(
    int ProductId, string ProductNo,
    string ItemName, string PartName,
    int FinishedInStock, int WorkshopStock, int LooseAvailable);
