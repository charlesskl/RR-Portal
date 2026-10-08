namespace ErpApi.Engines.Inventory;
// 快照层占位：P0 用 Null 实现（无快照=全量实时）；P5 替换为按月滚存实现。
public interface IInventorySnapshotProvider
{
    Task<(string? 年月, IReadOnlyList<InventoryRow> 期初)> GetLatestAsync(string warehouse);
}
