using QcInspection.Api.Entities;

namespace QcInspection.Api.Services;

public sealed record LegacyImportMatch(string PlanId, DateTime? InspectionDate, decimal? Quantity, decimal? Cartons,
    string InternalResult, string ThirdPartyResult, string SourceFile, string SourceSheet, int SourceRow);

public sealed record LegacyImportIssue(string Sheet, int Row, string ContractNumber, string CustomerPo, string ItemNumber, string Reason,
    DateTime? InspectionDate = null, decimal? Quantity = null, decimal? Cartons = null, IReadOnlyList<LegacyImportMatch>? Matches = null)
{
    public static LegacyImportIssue From(InspectionRecord row, string reason, IEnumerable<InspectionRecord>? matches = null) => new(
        row.SourceSheet, row.SourceRow, row.ContractNumber, row.CustomerPo, row.ItemNumber, reason,
        row.InspectionDate, row.Quantity, row.Cartons,
        matches?.Select(value => new LegacyImportMatch(value.PlanId, value.InspectionDate, value.Quantity, value.Cartons,
            value.InternalResult, value.ThirdPartyResult, value.SourceFile, value.SourceSheet, value.SourceRow)).ToArray());
}
