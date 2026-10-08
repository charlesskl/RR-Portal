namespace ErpApi.Engines.Inventory;
public interface IInventorySummaryService
{
    Task<IReadOnlyList<InventoryRow>> FinishedGoodsAsync(string warehouse);
    Task<IReadOnlyList<SemiFinishedRow>> SemiFinishedAsync(string warehouse);
    Task<IReadOnlyList<FinishedItemStockRow>> FinishedGoodsByItemAsync(string warehouse);
    Task<IReadOnlyList<FinishedItemLedgerRow>> FinishedGoodsLedgerAsync(string warehouse, string itemKey);
}
