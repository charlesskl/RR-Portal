using Microsoft.EntityFrameworkCore;
using SprayPlan.Api.Data;

namespace SprayPlan.Api.Services;

// 不依赖浏览器打开页面。每五分钟检查一次预计到料逾期，只在新业务日触发一次。
public sealed class MaterialReflowWorker(IServiceScopeFactory scopes, ILogger<MaterialReflowWorker> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(5));
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try {
                using var discovery = scopes.CreateScope();
                var db = discovery.ServiceProvider.GetRequiredService<AppDbContext>();
                var factories = await db.OrderMaterials.Where(material => material.AutoScheduleEnabled && material.ExpectedDate <= MaterialReflow.Today && (material.LastReflowDate == null || material.LastReflowDate < MaterialReflow.Today))
                    .Select(material => material.FactoryId).Distinct().ToListAsync(stoppingToken);
                foreach (var factory in factories)
                {
                    using var scope = scopes.CreateScope(); var context = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                    await ReflowDue(context, factory, stoppingToken);
                }
            } catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { return; }
            catch (Exception error) { log.LogError(error, "来料定时重排失败，将在下一轮重试"); }
        }
    }
    public static async Task<MaterialReflowResult?> ReflowDue(AppDbContext db, string factory, CancellationToken token = default)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(token);
        var due = await db.OrderMaterials.Where(material => material.FactoryId == factory && material.AutoScheduleEnabled && material.Order != null && material.Order.Status != "completed" && material.Order.Status != "archived"
            && material.ExpectedDate <= MaterialReflow.Today && (material.LastReflowDate == null || material.LastReflowDate < MaterialReflow.Today))
            .Where(material => material.ArrivedQty < material.Order!.PartQtys.Where(part => part.PartName == material.PartName).Sum(part => (long)part.Qty))
            .Select(material => material.Id).ToListAsync(token);
        if (due.Count == 0) return null;
        var result = await MaterialReflow.Apply(db, factory, due.ToHashSet(), "material-clock");
        await db.SaveChangesAsync(token); await transaction.CommitAsync(token); return result;
    }
}
