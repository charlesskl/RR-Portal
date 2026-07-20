namespace IndoShipping.Api.Contracts;

public record PagedQuery(int Page = 1, int PageSize = 50, string? Keyword = null);

public record PagedResult<T>(IReadOnlyList<T> Items, int Total, int Page, int PageSize);
