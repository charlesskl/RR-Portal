using Microsoft.Extensions.Options;
namespace ErpApi.Integrations.SprayPlan;

// 喷油排期入库申请单 → ERP塑胶入仓单 反向同步器(轮询间隔走 SprayPlanOptions.SyncIntervalSeconds,下限 30s,照 PaijiSyncWorker)。
// 每趟拉全量入库申请单后交给 SprayPlanReceiptSyncService(过滤/去重/建单/写同步记录)。
// 未配置 SprayPlan 凭证不启动循环;所有异常 swallow 保证 worker 不死。
public sealed class SprayPlanSyncWorker(
    IServiceScopeFactory scopeFactory, IOptions<SprayPlanOptions> options, ILogger<SprayPlanSyncWorker> logger)
    : BackgroundService
{
    private readonly SprayPlanOptions _opt = options.Value;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (string.IsNullOrWhiteSpace(_opt.User) || string.IsNullOrWhiteSpace(_opt.Password))
        {
            logger.LogInformation("喷油排期同步未配置凭证,反向同步器不启动");
            return;
        }
        var interval = TimeSpan.FromSeconds(Math.Max(30, _opt.SyncIntervalSeconds));
        logger.LogInformation("喷油排期反向同步器已启动:间隔={Interval}s", interval.TotalSeconds);
        while (!stoppingToken.IsCancellationRequested)
        {
            await RunOnceAsync(stoppingToken);
            try { await Task.Delay(interval, stoppingToken); }
            catch (OperationCanceledException) { }
        }
    }

    private async Task RunOnceAsync(CancellationToken ct)
    {
        try
        {
            using var scope = scopeFactory.CreateScope();
            var spray = scope.ServiceProvider.GetRequiredService<SprayPlanPushService>();
            var sync = scope.ServiceProvider.GetRequiredService<SprayPlanReceiptSyncService>();
            var rows = await spray.PullInboundApplicationsAsync();
            var 建单 = await sync.SyncRowsAsync(rows);
            if (建单.Count > 0)
                logger.LogInformation("喷油同步本趟建单 {N} 张:{单号}", 建单.Count, string.Join(',', 建单));
        }
        catch (Exception ex) { logger.LogWarning(ex, "喷油排期同步轮询失败"); }
    }
}
