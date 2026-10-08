namespace ErpApi.Integrations.Paiji;

// AI注塑啤机排产系统 接入配置。真实凭证走环境变量 Paiji__User / Paiji__Password,不入库不入仓。
public sealed class PaijiOptions
{
    public string BaseUrl { get; set; } = "";
    public string User { get; set; } = "";
    public string Password { get; set; } = "";
    // 反向同步(排产入库单→ERP塑胶入仓单):逗号分隔的车间列表与轮询间隔(秒)
    public string SyncWorkshops { get; set; } = "AT";
    public int SyncIntervalSeconds { get; set; } = 30;
    // 入库 webhook(POST /api/integrations/paiji/warehouse-checkin)共享令牌,走环境变量 Paiji__WebhookToken;
    // 未配置 = webhook 未启用,端点直接 503。
    public string WebhookToken { get; set; } = "";

    // BaseUrl 空/非法时视为未配置(推送与反向同步整体跳过);
    // Program.cs 注册 HttpClient 也用同一判断,非法则不设 BaseAddress,避免 DI 解析抛 UriFormatException。
    public bool BaseUrl合法 =>
        !string.IsNullOrWhiteSpace(BaseUrl) && Uri.TryCreate(BaseUrl.TrimEnd('/') + "/", UriKind.Absolute, out _);
}
