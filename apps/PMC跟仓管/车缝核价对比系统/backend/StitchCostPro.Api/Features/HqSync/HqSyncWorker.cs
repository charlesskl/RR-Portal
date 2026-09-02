using Microsoft.Extensions.Options;

namespace StitchCostPro.Api.Features.HqSync;

/// <summary>总部同步定时任务：按 HqSync:SyncIntervalMinutes 周期触发，与手动触发共用防并发锁。</summary>
public class HqSyncWorker(HqSyncService sync, IOptions<HqSyncOptions> options, ILogger<HqSyncWorker> logger)
    : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!options.Value.Enabled)
        {
            logger.LogInformation("总部集成同步未启用（HqSync:Enabled=false），后台任务不启动");
            return;
        }

        var interval = TimeSpan.FromMinutes(Math.Max(1, options.Value.SyncIntervalMinutes));
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await sync.RunAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "总部集成同步轮次异常");
            }

            try
            {
                await Task.Delay(interval, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }
}
