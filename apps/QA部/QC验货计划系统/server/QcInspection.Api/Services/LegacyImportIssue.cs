using QcInspection.Api.Entities;

namespace QcInspection.Api.Services;

public sealed record LegacyImportIssue(string Sheet, int Row, string ContractNumber, string CustomerPo, string ItemNumber, string Reason)
{
    public static LegacyImportIssue From(InspectionRecord row, string reason) => new(
        row.SourceSheet, row.SourceRow, row.ContractNumber, row.CustomerPo, row.ItemNumber, reason);
}
