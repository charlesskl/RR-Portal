using Dapper;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Payroll;

// 月度出勤汇总：实出勤天数 = 应出勤天数(入参) − 缺勤天数(Σ缺勤登记.计算出勤,当月)。列出在职员工。只读。
// 注：b缺勤登记明细.[计算出勤] 为 nvarchar(6)（字符串），故用 TRY_CONVERT(decimal) 安全求和（空串/非数字→NULL，不报错）。
public sealed class AttendanceService(ISqlConnectionFactory factory)
{
    private const string Sql = @"
SELECT b.[编号] AS 工号, MAX(b.[姓名]) AS 姓名, b.[部门编号], MAX(dep.[部门]) AS 部门,
       @应出勤天数 AS 应出勤天数,
       ISNULL(SUM(TRY_CONVERT(decimal(18,4), q.[计算出勤])),0) AS 缺勤天数,
       @应出勤天数 - ISNULL(SUM(TRY_CONVERT(decimal(18,4), q.[计算出勤])),0) AS 实出勤天数,
       MAX(ISNULL(d.出勤工时,0)) AS 出勤工时,
       MAX(ISNULL(d.加班工时,0)) AS 加班工时,
       MAX(ISNULL(d.迟到次数,0)) AS 迟到次数,
       MAX(ISNULL(d.早退次数,0)) AS 早退次数
FROM [人事档案] b
LEFT JOIN [b缺勤登记明细] q ON q.[工号]=b.[编号] AND q.[日期] >= @月初 AND q.[日期] < @下月初
LEFT JOIN [部门信息] dep ON dep.[编号]=b.[部门编号]
LEFT JOIN (SELECT [工号], SUM(CAST([合计时间] AS decimal(18,4))) AS 出勤工时,
              SUM(CAST([加班] AS decimal(18,4))) AS 加班工时,
              SUM(ISNULL([迟到次数],0)) AS 迟到次数, SUM(ISNULL([早退次数],0)) AS 早退次数
              FROM [日报表] WHERE [日期]>=@月初 AND [日期]<@下月初 GROUP BY [工号]) d ON d.[工号]=b.[编号]
WHERE ISNULL(b.[在职],'1')='1' AND (@部门编号 IS NULL OR b.[部门编号]=@部门编号)
GROUP BY b.[编号], b.[部门编号]
ORDER BY b.[部门编号], b.[编号];";

    public async Task<IReadOnlyList<AttendanceMonthlyRow>> MonthlyAsync(string 月份, decimal 应出勤天数, string? 部门编号)
    {
        if (string.IsNullOrWhiteSpace(月份) || 月份.Length != 6 || !int.TryParse(月份, out _))
            throw new System.ArgumentException("月份须为 6 位 yyyyMM。");
        var y = int.Parse(月份[..4]); var m = int.Parse(月份[4..]);
        if (m < 1 || m > 12) throw new System.ArgumentException("月份的月份段须在 01–12 之间。");
        var 月初 = new System.DateTime(y, m, 1); var 下月初 = 月初.AddMonths(1);
        using var c = factory.Create();
        var rows = await c.QueryAsync<AttendanceMonthlyRow>(Sql,
            new { 月初, 下月初, 应出勤天数, 部门编号 = string.IsNullOrWhiteSpace(部门编号) ? null : 部门编号.Trim() });
        return rows.AsList();
    }
}
