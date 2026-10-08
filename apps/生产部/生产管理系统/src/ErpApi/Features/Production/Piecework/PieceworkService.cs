using Dapper;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Production.Piecework;

// 计件（车缝完成量，P7 工资归集源头）。计件表为扁平记录，无单号头。
// 单价取自该生产单该工序的 生产制单工序表.单价（服务端查，不信任前端）；金额=数量×单价。
public sealed class PieceworkService(ISqlConnectionFactory factory)
{
    // 批量录入；返回录入条数
    public async Task<int> RecordAsync(PieceworkRecordDto dto, string user)
    {
        if (dto.明细.Count == 0) throw new ArgumentException("计件至少要有一行");
        if (string.IsNullOrWhiteSpace(dto.生产单号)) throw new ArgumentException("生产单号必填");
        var now = DateTime.Now;

        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();

        var n = 0;
        foreach (var l in dto.明细)
        {
            if (string.IsNullOrWhiteSpace(l.工序号)) throw new ArgumentException("工序号必填");
            if (string.IsNullOrWhiteSpace(l.员工号)) throw new ArgumentException("员工号必填");
            if (l.数量 <= 0) throw new ArgumentException("计件数量必须大于0");

            // 单价按 生产单号+货号+工序号 取(一单多货号:同一工序号在不同货号下可有不同单价)。
            // 货号为空(旧单/未传)时退化为 生产单号+工序号 匹配，兼容回填前的历史数据。
            var 单价 = await c.ExecuteScalarAsync<decimal?>(@"
SELECT [单价] FROM [生产制单工序表]
WHERE [生产单号]=@生产单号 AND [工序号]=@工序号
  AND (@货号 IS NULL OR [货号]=@货号)",
                new { dto.生产单号, l.货号, l.工序号 }, tx);
            if (单价 is null)
                throw new ArgumentException(
                    l.货号 is null
                        ? $"工序 [{l.工序号}] 不在生产单 [{dto.生产单号}] 的工序表中"
                        : $"工序 [{l.工序号}] 不在生产单 [{dto.生产单号}] 货号 [{l.货号}] 的工序表中");

            await c.ExecuteAsync(@"
INSERT INTO [计件表]([生产单号],[裁床单号],[货号],[床号],[裁床日期],[颜色],[尺码],[扎号],
    [工序号],[数量],[单价],[金额],[操作员],[员工号],[日期],[审核],[有效])
VALUES(@生产单号,@裁床单号,@货号,@床号,@裁床日期,@颜色,@尺码,@扎号,
    @工序号,@数量,@单价,@金额,@操作员,@员工号,@日期,'0','1')",
                new
                {
                    dto.生产单号, dto.裁床单号, l.货号, dto.床号, dto.裁床日期, l.颜色, l.尺码, l.扎号,
                    l.工序号, l.数量, 单价, 金额 = l.数量 * 单价.Value, 操作员 = user, l.员工号, 日期 = now
                }, tx);
            n++;
        }
        tx.Commit();
        return n;
    }

    // 列出某生产单的有效计件（JOIN 工序表带工序名称、JOIN 人事带姓名）
    public async Task<IReadOnlyList<PieceworkRowDto>> ListByOrderAsync(string 生产单号)
    {
        using var c = factory.Create();
        var rows = await c.QueryAsync<PieceworkRowDto>(@"
SELECT j.[ID],j.[生产单号],j.[裁床单号],j.[货号],j.[工序号],p.[工序名称],j.[员工号],e.[姓名],
       j.[颜色],j.[尺码],j.[扎号],j.[数量],j.[单价],j.[金额],j.[审核]
FROM [计件表] j
LEFT JOIN [生产制单工序表] p ON p.[生产单号]=j.[生产单号] AND p.[工序号]=j.[工序号]
    AND (j.[货号] IS NULL OR p.[货号]=j.[货号])
LEFT JOIN [人事档案] e ON e.[编号]=j.[员工号]
WHERE j.[生产单号]=@生产单号 AND ISNULL(j.[有效],'1')<>'0'
ORDER BY j.[ID] DESC", new { 生产单号 });
        return rows.AsList();
    }

    // 批量审核某生产单的未审核计件；返回审核条数。
    // 注：计件表无审核人/审核日期列，user 仅为与其它审核接口签名对称，不落库。
    public async Task<int> ApproveByOrderAsync(string 生产单号, string user)
    {
        using var c = factory.Create();
        return await c.ExecuteAsync(
            "UPDATE [计件表] SET [审核]='1' WHERE [生产单号]=@生产单号 AND ISNULL([审核],'0')='0' AND ISNULL([有效],'1')<>'0'",
            new { 生产单号 });
    }

    // 删除单条计件（仅未审核）；单句条件 DELETE 保证原子(避免读审核位与删除之间的竞态)
    public async Task<bool> DeleteAsync(long id)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        var rows = await c.ExecuteAsync(
            "DELETE FROM [计件表] WHERE [ID]=@id AND ISNULL([审核],'0')='0'", new { id });
        if (rows > 0) return true;
        // 没删成：区分"不存在"与"已审核"
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [计件表] WHERE [ID]=@id", new { id });
        if (审核 is null) return false;
        throw new InvalidOperationException("已审核的计件不能删除，请先反审核。");
    }

    // 计件汇总（算法2 前身）：按 员工×工序 归集已审核计件的数量与金额
    public async Task<IReadOnlyList<PieceworkSummaryRow>> SummaryAsync(string 生产单号)
    {
        using var c = factory.Create();
        var rows = await c.QueryAsync<PieceworkSummaryRow>(@"
SELECT j.[员工号], MAX(e.[姓名]) AS 姓名, j.[工序号], MAX(p.[工序名称]) AS 工序名称,
       SUM(j.[数量]) AS 数量, SUM(j.[金额]) AS 金额
FROM [计件表] j
LEFT JOIN [生产制单工序表] p ON p.[生产单号]=j.[生产单号] AND p.[工序号]=j.[工序号]
    AND (j.[货号] IS NULL OR p.[货号]=j.[货号])
LEFT JOIN [人事档案] e ON e.[编号]=j.[员工号]
WHERE j.[生产单号]=@生产单号 AND ISNULL(j.[审核],'0')='1' AND ISNULL(j.[有效],'1')<>'0'
GROUP BY j.[员工号], j.[工序号]
ORDER BY j.[员工号], j.[工序号]", new { 生产单号 });
        return rows.AsList();
    }
}
