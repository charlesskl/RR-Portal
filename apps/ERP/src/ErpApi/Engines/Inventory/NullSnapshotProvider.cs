namespace ErpApi.Engines.Inventory;
public sealed class NullSnapshotProvider : IInventorySnapshotProvider
{
    public Task<(string?, IReadOnlyList<InventoryRow>)> GetLatestAsync(string warehouse)
        => Task.FromResult<(string?, IReadOnlyList<InventoryRow>)>((null, Array.Empty<InventoryRow>()));
}
