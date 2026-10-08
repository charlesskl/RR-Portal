using System.Globalization;
using Dapper;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Payroll;

// 日报服务:取员工当日排班→班次模板(考勤_排班表)→AttendanceEngine(算法10)→日报表整条替换。
// 刷卡时刻以 日期.Date + TimeSpan 存为 datetime,写 刷卡1..刷卡N(N=min(数量,12),列名内部生成安全)。
// 部门 直接存 人事档案.部门编号(简化,不再 JOIN 部门信息)。real 列(上午/下午/合计时间/加班)读出 (decimal?)(double?)。
public sealed class DailyReportService(ISqlConnectionFactory factory)
{
    private static TimeSpan? Tod(DateTime? d) => d?.TimeOfDay;

    public async Task SaveAsync(DailySaveDto dto, string user)
    {
        if (string.IsNullOrWhiteSpace(dto.工号)) throw new ArgumentException("工号必填");
        var 工号 = dto.工号.Trim();
        var 日期 = dto.日期.Date;

        using var c = factory.Create();
        await c.OpenAsync();

        // 1. 取当日排班班次
        var 班次 = await c.ExecuteScalarAsync<string?>(
            "SELECT TOP 1 [班次] FROM [排班表] WHERE [工号]=@工号 AND [日期]=@日期", new { 工号, 日期 });
        if (string.IsNullOrWhiteSpace(班次)) throw new ArgumentException("该员工当日未排班");

        // 2. 取班次模板
        var s = await c.QueryFirstOrDefaultAsync(@"
SELECT [上午上班],[上午下班],[下午上班],[下午下班],[迟到分钟],[早退分钟]
FROM [考勤_排班表] WHERE [识别]=@班次", new { 班次 });
        if (s is null) throw new ArgumentException("班次不存在");

        // 3. 构 ShiftDef(datetime → TimeOfDay;迟到/早退分钟 real → double)
        var shiftDef = new ShiftDef(
            Tod((DateTime?)s.上午上班), Tod((DateTime?)s.上午下班),
            Tod((DateTime?)s.下午上班), Tod((DateTime?)s.下午下班),
            (double)((double?)s.迟到分钟 ?? 0), (double)((double?)s.早退分钟 ?? 0));

        // 4. 解析刷卡 "HH:mm"(过滤非法)
        var punches = (dto.刷卡 ?? [])
            .Select(x => TimeSpan.TryParse(x, CultureInfo.InvariantCulture, out var t) ? (TimeSpan?)t : null)
            .Where(t => t.HasValue).Select(t => t!.Value)
            .OrderBy(t => t).ToList();

        // 5. 算法10
        var r = AttendanceEngine.Compute(punches, shiftDef);

        // 6. 查姓名/部门(部门=人事档案.部门编号)
        var emp = await c.QueryFirstOrDefaultAsync(
            "SELECT [姓名],[部门编号] FROM [人事档案] WHERE [编号]=@工号", new { 工号 });
        string? 姓名 = emp?.姓名;
        string? 部门 = emp?.部门编号;

        // 7. 整条替换(事务):删旧 → 写刷卡1..N + 引擎结果
        var n = Math.Min(punches.Count, 12);
        var p = new DynamicParameters();
        p.Add("工号", 工号);
        p.Add("姓名", 姓名);
        p.Add("部门", 部门);
        p.Add("日期", 日期);
        p.Add("上午", r.上午);
        p.Add("下午", r.下午);
        p.Add("合计时间", r.合计);
        p.Add("加班", r.加班);
        p.Add("迟到分", r.迟到分);
        p.Add("早退分", r.早退分);
        p.Add("迟到次数", r.迟到次数);
        p.Add("早退次数", r.早退次数);

        var punchCols = new System.Text.StringBuilder();
        var punchParams = new System.Text.StringBuilder();
        for (var i = 0; i < n; i++)
        {
            var col = $"刷卡{i + 1}";          // 内部生成列名,注入安全
            punchCols.Append($",[{col}]");
            punchParams.Append($",@{col}");
            p.Add(col, 日期 + punches[i]);
        }

        var insertSql = $@"
INSERT INTO [日报表]([工号],[姓名],[部门],[日期]{punchCols},[上午],[下午],[合计时间],[加班],[迟到分],[早退分],[迟到次数],[早退次数])
VALUES(@工号,@姓名,@部门,@日期{punchParams},@上午,@下午,@合计时间,@加班,@迟到分,@早退分,@迟到次数,@早退次数)";

        using var tx = c.BeginTransaction();
        await c.ExecuteAsync("DELETE FROM [日报表] WHERE [工号]=@工号 AND [日期]=@日期", new { 工号, 日期 }, tx);
        await c.ExecuteAsync(insertSql, p, tx);
        tx.Commit();
    }

    public async Task<IReadOnlyList<DailyRow>> ListAsync(string? 工号, DateTime 开始, DateTime 结束, string? 部门)
    {
        using var c = factory.Create();
        var rows = await c.QueryAsync(@"
SELECT [工号],[姓名],[部门],[日期],
       CAST([上午] AS decimal(18,4)) AS 上午,
       CAST([下午] AS decimal(18,4)) AS 下午,
       CAST([合计时间] AS decimal(18,4)) AS 合计时间,
       CAST([加班] AS decimal(18,4)) AS 加班,
       [迟到分],[早退分],[迟到次数],[早退次数]
FROM [日报表]
WHERE [日期]>=@开始 AND [日期]<=@结束
  AND (@工号 IS NULL OR [工号]=@工号)
  AND (@部门 IS NULL OR [部门]=@部门)
ORDER BY [日期],[工号]",
            new
            {
                工号 = string.IsNullOrWhiteSpace(工号) ? null : 工号.Trim(),
                开始 = 开始.Date, 结束 = 结束.Date,
                部门 = string.IsNullOrWhiteSpace(部门) ? null : 部门.Trim()
            });
        return rows.Select(r => new DailyRow
        {
            工号 = r.工号, 姓名 = r.姓名, 部门 = r.部门, 日期 = (DateTime?)r.日期,
            上午 = (decimal?)r.上午, 下午 = (decimal?)r.下午,
            合计时间 = (decimal?)r.合计时间, 加班 = (decimal?)r.加班,
            迟到分 = (int?)r.迟到分, 早退分 = (int?)r.早退分,
            迟到次数 = (int?)r.迟到次数, 早退次数 = (int?)r.早退次数
        }).ToList();
    }
}
