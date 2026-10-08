using Dapper;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Payroll;

// 计件归集（算法2）：按员工×月归集已审核有效计件的计件工资合计(Σ金额)。只读,不持久化。
public sealed class PieceworkPayrollService(ISqlConnectionFactory factory)
{
    private const string Sql = @"
SELECT b.[编号], MAX(b.[姓名]) AS 姓名, b.[部门编号], MAX(d.[部门]) AS 部门,
       SUM(ISNULL(a.[数量],0)) AS 数量, SUM(ISNULL(a.[金额],0)) AS 计件工资
FROM [计件表] a
JOIN [人事档案] b ON a.[员工号]=b.[编号]
LEFT JOIN [部门信息] d ON d.[编号]=b.[部门编号]
WHERE ISNULL(a.[审核],'0')='1' AND ISNULL(a.[有效],'1')<>'0'
  AND a.[日期] >= @月初 AND a.[日期] < @下月初
  AND (@部门编号 IS NULL OR b.[部门编号]=@部门编号)
GROUP BY b.[编号], b.[部门编号]
ORDER BY b.[部门编号], b.[编号];";

    public async Task<IReadOnlyList<PieceworkPayrollRow>> MonthlyAsync(string 月份, string? 部门编号)
    {
        if (string.IsNullOrWhiteSpace(月份) || 月份.Length != 6 || !int.TryParse(月份, out _))
            throw new System.ArgumentException("月份须为 6 位 yyyyMM。");
        var y = int.Parse(月份[..4]); var m = int.Parse(月份[4..]);
        if (m < 1 || m > 12) throw new System.ArgumentException("月份的月份段须在 01–12 之间。");
        var 月初 = new System.DateTime(y, m, 1);
        var 下月初 = 月初.AddMonths(1);
        using var c = factory.Create();
        var rows = await c.QueryAsync<PieceworkPayrollRow>(Sql,
            new { 月初, 下月初, 部门编号 = string.IsNullOrWhiteSpace(部门编号) ? null : 部门编号.Trim() });
        return rows.AsList();
    }
}
