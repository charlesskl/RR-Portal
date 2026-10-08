namespace ErpApi.Features.Warehouse.Semi.ShortageAnalysis;

public interface ISemiFinishedShortageService
{
    Task<SemiFinishedShortageResult> ListAsync(SemiFinishedShortageQuery query);
    Task<IReadOnlyList<SemiFinishedShortageRow>> ExportAsync(SemiFinishedShortageQuery query);
}
