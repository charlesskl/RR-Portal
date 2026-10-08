using Microsoft.Extensions.Options;
namespace ErpApi.Integrations.Paiji;

// 排产系统入库单 → ERP塑胶入仓单 反向同步器(定时轮询)。
// 每趟各车间拉 warehouse-orders 后交给 PaijiReceiptSyncService(过滤/去重/分组/建单/写同步记录,webhook 也复用它)。
// 未配置凭证不启动循环;单车间失败记警告继续,所有异常 swallow 保证 worker 不死。
public sealed class PaijiSyncWorker(
    IServiceScopeFactory scopeFactory, IOptions<PaijiOptions> options, ILogger<PaijiSyncWorker> logger)
    : BackgroundService
{
    private readonly PaijiOptions _opt = options.Value;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (string.IsNullOrWhiteSpace(_opt.User) || string.IsNullOrWhiteSpace(_opt.Password))
        {
            logger.LogInformation("排产同步未配置凭证,反向同步器不启动");
            return;
        }
        var interval = TimeSpan.FromSeconds(Math.Max(30, _opt.SyncIntervalSeconds));
        logger.LogInformation("排产反向同步器已启动:车间={Workshops} 间隔={Interval}s", _opt.SyncWorkshops, interval.TotalSeconds);
        while (!stoppingToken.IsCancellationRequested)
        {
            await RunOnceAsync(stoppingToken);
            try { await Task.Delay(interval, stoppingToken); }
            catch (OperationCanceledException) { }
        }
    }

    private async Task RunOnceAsync(CancellationToken ct)
    {
        foreach (var ws in _opt.SyncWorkshops.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            try { await SyncWorkshopAsync(ws, ct); }
            catch (Exception ex) { logger.LogWarning(ex, "排产同步车间 {Workshop} 失败", ws); }
        }
    }

    private async Task SyncWorkshopAsync(string workshop, CancellationToken ct)
    {
        using var scope = scopeFactory.CreateScope();
        var paiji = scope.ServiceProvider.GetRequiredService<PaijiPushService>();
        var sync = scope.ServiceProvider.GetRequiredService<PaijiReceiptSyncService>();
        var rows = await paiji.PullWarehouseAsync(workshop, ct);
        await sync.SyncRowsAsync(rows, workshop);
    }
}
