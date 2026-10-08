namespace ErpApi.Features.MasterData;
public sealed record PagedResult<T>(IReadOnlyList<T> Items, int Total);
