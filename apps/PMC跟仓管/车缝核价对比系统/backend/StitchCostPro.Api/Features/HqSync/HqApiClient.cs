namespace StitchCostPro.Api.Features.HqSync;

/// <summary>总部只读 API 客户端（Bearer 鉴权）。只负责单页拉取，翻页循环在 HqSyncService。</summary>
public class HqApiClient(HttpClient http)
{
    public Task<HqListPage<HqFactoryDto>> GetFactoriesAsync(string? updatedAfter, string? cursorId, int pageSize, CancellationToken ct)
        => GetPageAsync<HqFactoryDto>("api/integration/v1/factories", updatedAfter, cursorId, pageSize, ct);

    public Task<HqListPage<HqOrderDto>> GetOrdersAsync(string? updatedAfter, string? cursorId, int pageSize, CancellationToken ct)
        => GetPageAsync<HqOrderDto>("api/integration/v1/orders", updatedAfter, cursorId, pageSize, ct);

    private async Task<HqListPage<T>> GetPageAsync<T>(string path, string? updatedAfter, string? cursorId, int pageSize, CancellationToken ct)
    {
        // cursor_id 不能单独传入，必须与 updated_after 一起；非 2xx 直接抛异常，由调用方保留旧游标下轮重试。
        var url = $"{path}?page_size={pageSize}";
        if (!string.IsNullOrEmpty(updatedAfter))
            url += $"&updated_after={Uri.EscapeDataString(updatedAfter)}&cursor_id={Uri.EscapeDataString(cursorId ?? "")}";
        var page = await http.GetFromJsonAsync<HqListPage<T>>(url, ct);
        return page ?? new HqListPage<T>();
    }
}
