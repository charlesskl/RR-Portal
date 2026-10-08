namespace ErpApi.Integrations.SprayPlan;

// 喷油部排期系统(sprayplan-test)接入配置。
// 应用层登录账号走环境变量 SprayPlan__User / SprayPlan__Password;
// nginx Basic 凭据复用排产的 Paiji__User / Paiji__Password(同一台 nginx),均不入库不入仓。
public sealed class SprayPlanOptions
{
    public string BaseUrl { get; set; } = "";
    public string User { get; set; } = "";
    public string Password { get; set; } = "";
    // 反向同步(喷油入库申请单→ERP塑胶入仓单)轮询间隔(秒),生效下限 30(照 PaijiOptions.SyncIntervalSeconds)
    public int SyncIntervalSeconds { get; set; } = 30;

    // BaseUrl 空/非法时视为未配置(推送与反向同步整体跳过);
    // Program.cs 注册 HttpClient 也用同一判断,非法则不设 BaseAddress,避免 DI 解析抛 UriFormatException。
    public bool BaseUrl合法 =>
        !string.IsNullOrWhiteSpace(BaseUrl) && Uri.TryCreate(BaseUrl.TrimEnd('/') + "/", UriKind.Absolute, out _);
}
