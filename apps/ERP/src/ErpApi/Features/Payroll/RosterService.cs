using Dapper;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Payroll;

// 排班(排班表)。批量按 工号×日期范围 派班次;工号+日期去重(存在则更新);ID MAX+1。
public sealed class RosterService(ISqlConnectionFactory factory)
{
    public async Task<IReadOnlyList<RosterRow>> ListAsync(DateTime 开始, DateTime 结束, string? 部门编号)
    {
        using var c = factory.Create();
        var rows = await c.QueryAsync<RosterRow>(@"
SELECT r.[工号],r.[姓名],r.[日期],r.[班次]
FROM [排班表] r LEFT JOIN [人事档案] e ON e.[编号]=r.[工号]
WHERE r.[日期]>=@开始 AND r.[日期]<=@结束 AND (@部门编号 IS NULL OR e.[部门编号]=@部门编号)
ORDER BY r.[日期], r.[工号];", new { 开始, 结束, 部门编号 = string.IsNullOrWhiteSpace(部门编号) ? null : 部门编号 });
        return rows.AsList();
    }

    public async Task AssignAsync(RosterAssignDto dto, string user)
    {
        if (dto.工号集合.Count == 0) throw new ArgumentException("请选择工号");
        if (string.IsNullOrWhiteSpace(dto.班次)) throw new ArgumentException("班次必填");
        if (dto.结束日期 < dto.开始日期) throw new ArgumentException("结束日期不能早于开始日期");
        using var c = factory.Create();
        await c.OpenAsync();
        var shiftOk = await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM [考勤_排班表] WHERE [识别]=@班次", new { dto.班次 });
        if (shiftOk == 0) throw new ArgumentException("班次不存在");
        using var tx = c.BeginTransaction();
        for (var d = dto.开始日期.Date; d <= dto.结束日期.Date; d = d.AddDays(1))
            foreach (var 工号 in dto.工号集合)
            {
                var 姓名 = await c.ExecuteScalarAsync<string?>("SELECT [姓名] FROM [人事档案] WHERE [编号]=@工号", new { 工号 }, tx);
                var n = await c.ExecuteAsync("UPDATE [排班表] SET [班次]=@班次,[姓名]=@姓名 WHERE [工号]=@工号 AND [日期]=@d",
                    new { dto.班次, 姓名, 工号, d }, tx);
                if (n == 0)
                {
                    var nextId = await c.ExecuteScalarAsync<long>("SELECT ISNULL(MAX([ID]),0)+1 FROM [排班表]", transaction: tx);
                    await c.ExecuteAsync("INSERT INTO [排班表]([ID],[工号],[姓名],[日期],[班次]) VALUES(@nextId,@工号,@姓名,@d,@班次)",
                        new { nextId, 工号, 姓名, d, dto.班次 }, tx);
                }
            }
        tx.Commit();
    }

    public async Task<bool> RemoveAsync(string 工号, DateTime 日期)
    { using var c = factory.Create(); return await c.ExecuteAsync("DELETE FROM [排班表] WHERE [工号]=@工号 AND [日期]=@d", new { 工号, d = 日期.Date }) > 0; }
}
