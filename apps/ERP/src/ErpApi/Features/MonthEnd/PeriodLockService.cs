using Dapper;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
namespace ErpApi.Features.MonthEnd;

public sealed class PeriodLockedException(string message) : Exception(message);

// 硬月结锁期：已结期间(该仓+口径,年月>=单据月)禁止录入/审核/反审核。读 结存快照表 判锁。
public sealed class PeriodLockService(ISqlConnectionFactory factory)
{
    public async Task<bool> IsLockedAsync(string 口径, string? 仓库, DateTime 日期, SqlConnection c, SqlTransaction? tx = null)
    {
        if (string.IsNullOrWhiteSpace(仓库)) return false;
        var ym = 日期.ToString("yyyyMM");
        var n = await c.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM [结存快照表] WHERE 口径=@口径 AND 仓库=@仓 AND 年月>=@ym",
            new { 口径, 仓 = 仓库.Trim(), ym }, tx);
        return n > 0;
    }
    private static PeriodLockedException Locked(string 口径, string 仓库, DateTime d) =>
        new($"仓库[{仓库}] {d:yyyy-MM} 期间已月结锁定（{口径}），不能录入/审核/反审核该期间单据，请先反月结。");

    public async Task EnsureWarehouseOpenAsync(string 口径, string? 仓库, DateTime 日期)
    {
        if (string.IsNullOrWhiteSpace(仓库)) return;
        using var c = factory.Create(); await c.OpenAsync();
        if (await IsLockedAsync(口径, 仓库, 日期, c)) throw Locked(口径, 仓库!.Trim(), 日期);
    }
    public async Task EnsureHeaderOpenAsync(string 口径, string table, string 单号)
    {
        using var c = factory.Create(); await c.OpenAsync();
        var row = await c.QueryFirstOrDefaultAsync(
            $"SELECT [仓库] AS 仓库,[日期] AS 日期 FROM [{table}] WHERE [单号]=@单号", new { 单号 });
        if (row is null) return;
        string? 仓库 = row.仓库; DateTime? 日期 = row.日期;
        if (仓库 != null && 日期 != null && await IsLockedAsync(口径, 仓库, 日期.Value, c))
            throw Locked(口径, 仓库, 日期.Value);
    }
    public async Task EnsureTransferOpenAsync(string 单号)
    {
        using var c = factory.Create(); await c.OpenAsync();
        var 日期 = await c.ExecuteScalarAsync<DateTime?>("SELECT [日期] FROM [成品调拨单] WHERE [单号]=@单号", new { 单号 });
        if (日期 is null) return;
        var whs = await c.QueryAsync<string>(
            @"SELECT 源仓库 FROM [成品调拨明细单] WHERE 单号=@单号 AND 源仓库 IS NOT NULL
              UNION SELECT 目标仓库 FROM [成品调拨明细单] WHERE 单号=@单号 AND 目标仓库 IS NOT NULL", new { 单号 });
        foreach (var w in whs)
            if (await IsLockedAsync("成品", w, 日期.Value, c)) throw Locked("成品", w, 日期.Value);
    }
}
