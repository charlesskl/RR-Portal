using Dapper;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Payroll;

// 工资表只读查询：列表(工资总表) + 详情(单头/项目映射ZGnn/动态明细行)。
public sealed class PayrollQueryService(ISqlConnectionFactory factory)
{
    private static readonly string[] StandardCols =
        ["编号", "姓名", "部门", "职称", "基本工资", "计件工资", "应发合计", "应扣合计", "实发合计"];

    public async Task<IReadOnlyList<PayrollSummaryRow>> ListAsync(string? 月份, string? 部门编号)
    {
        var m = string.IsNullOrWhiteSpace(月份) ? null : 月份!.Trim();
        var d = string.IsNullOrWhiteSpace(部门编号) ? null : 部门编号!.Trim();
        using var c = factory.Create();
        await c.OpenAsync();
        var rows = await c.QueryAsync<PayrollSummaryRow>(@"
SELECT [工资表编号],[月份],[部门编号],[模板编号],[基本工资],[计件工资],[应发合计],[应扣合计],[实发合计]
FROM [工资总表]
WHERE (@月份 IS NULL OR [月份]=@月份) AND (@部门编号 IS NULL OR [部门编号]=@部门编号)
ORDER BY [工资表编号] DESC", new { 月份 = m, 部门编号 = d });
        return rows.AsList();
    }

    public async Task<PayrollDetailDto?> GetDetailAsync(string 工资表编号)
    {
        using var c = factory.Create();
        await c.OpenAsync();

        var 单头 = await c.QueryFirstOrDefaultAsync<PayrollSummaryRow>(@"
SELECT [工资表编号],[月份],[部门编号],[模板编号],[基本工资],[计件工资],[应发合计],[应扣合计],[实发合计]
FROM [工资总表] WHERE [工资表编号]=@工资表编号", new { 工资表编号 });
        if (单头 is null) return null;

        var 项目 = (await c.QueryAsync<PayrollItemCol>(@"
SELECT [列名],[台头项目],[类型] FROM [工资表项目公式] WHERE [工资表编号]=@工资表编号 ORDER BY [列名]",
            new { 工资表编号 })).AsList();

        // 允许返回的键：标准列 + 本表 ZGnn 列名集合。
        var allowed = new HashSet<string>(StandardCols);
        foreach (var it in 项目)
            if (!string.IsNullOrEmpty(it.列名)) allowed.Add(it.列名!);

        var zgCols = string.Concat(项目
            .Where(it => !string.IsNullOrEmpty(it.列名))
            .Select(it => $",[{it.列名}]"));
        var sql = $@"
SELECT [编号],[姓名],[部门],[职称],[基本工资],[计件工资],[应发合计],[应扣合计],[实发合计]{zgCols}
FROM [工资明细表] WHERE [工资表编号]=@工资表编号 ORDER BY [编号]";

        var raw = await c.QueryAsync(sql, new { 工资表编号 });
        var 明细 = new List<Dictionary<string, object?>>();
        foreach (var r in raw)
        {
            var src = (IDictionary<string, object>)r;
            var dict = new Dictionary<string, object?>();
            foreach (var kv in src)
                if (allowed.Contains(kv.Key)) dict[kv.Key] = kv.Value;
            明细.Add(dict);
        }

        return new PayrollDetailDto { 单头 = 单头, 项目 = 项目, 明细 = 明细 };
    }
}
