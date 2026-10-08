using Dapper;
using ErpApi.Features.MasterData;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Payroll;

// 缺勤登记（请假/缺勤扁平记录,录入即生效,无审核）。b缺勤登记明细.工号→人事档案。
public sealed class AbsenceService(ISqlConnectionFactory factory)
{
    public async Task<long> CreateAsync(AbsenceCreateDto dto, string user)
    {
        if (string.IsNullOrWhiteSpace(dto.工号)) throw new ArgumentException("工号必填");
        if (dto.计算出勤 <= 0) throw new ArgumentException("计算出勤(缺勤折算天数)须大于0");
        using var c = factory.Create();
        return await c.ExecuteScalarAsync<long>(@"
INSERT INTO [b缺勤登记明细]([操作日期],[操作员],[工号],[姓名],[部门],[登记类型],[前后段],[计算出勤],[日期],[开始时间],[结束时间],[事由])
VALUES(@操作日期,@操作员,@工号,@姓名,@部门,@登记类型,@前后段,@计算出勤,@日期,@开始时间,@结束时间,@事由);
SELECT CAST(SCOPE_IDENTITY() AS bigint);",
            new { 操作日期 = DateTime.Now, 操作员 = user, dto.工号, dto.姓名, dto.部门, dto.登记类型, dto.前后段, dto.计算出勤, dto.日期, dto.开始时间, dto.结束时间, dto.事由 });
    }

    public async Task<PagedResult<AbsenceRow>> ListAsync(string? 月份, string? 工号, string? 部门编号, int page, int size)
    {
        if (page < 1) page = 1;
        if (size < 1) size = 20;
        if (size > 1000) size = 1000;
        DateTime? 月初 = null, 下月初 = null;
        if (!string.IsNullOrWhiteSpace(月份))
        {
            if (月份.Length != 6 || !int.TryParse(月份, out _)) throw new ArgumentException("月份须为 6 位 yyyyMM。");
            var y = int.Parse(月份[..4]); var m = int.Parse(月份[4..]);
            if (m < 1 || m > 12) throw new ArgumentException("月份的月份段须在 01–12 之间。");
            月初 = new DateTime(y, m, 1); 下月初 = 月初.Value.AddMonths(1);
        }
        var kwGh = string.IsNullOrWhiteSpace(工号) ? null : 工号.Trim();
        var dept = string.IsNullOrWhiteSpace(部门编号) ? null : 部门编号.Trim();
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [b缺勤登记明细] q LEFT JOIN [人事档案] b ON b.[编号]=q.[工号]
WHERE (@月初 IS NULL OR (q.[日期]>=@月初 AND q.[日期]<@下月初))
  AND (@工号 IS NULL OR q.[工号]=@工号) AND (@部门编号 IS NULL OR b.[部门编号]=@部门编号);
SELECT q.[ID],q.[工号],q.[姓名],q.[部门],q.[登记类型],q.[前后段],q.[计算出勤],q.[日期],q.[事由]
FROM [b缺勤登记明细] q LEFT JOIN [人事档案] b ON b.[编号]=q.[工号]
WHERE (@月初 IS NULL OR (q.[日期]>=@月初 AND q.[日期]<@下月初))
  AND (@工号 IS NULL OR q.[工号]=@工号) AND (@部门编号 IS NULL OR b.[部门编号]=@部门编号)
ORDER BY q.[日期] DESC, q.[ID] DESC OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;",
            new { 月初, 下月初, 工号 = kwGh, 部门编号 = dept, page, size });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<AbsenceRow>()).AsList();
        return new PagedResult<AbsenceRow>(items, total);
    }

    public async Task<bool> DeleteAsync(long id)
    {
        using var c = factory.Create();
        var n = await c.ExecuteAsync("DELETE FROM [b缺勤登记明细] WHERE [ID]=@id", new { id });
        return n > 0;
    }
}
