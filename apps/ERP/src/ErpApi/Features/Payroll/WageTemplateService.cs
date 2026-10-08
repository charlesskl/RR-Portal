using Dapper;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Payroll;

// 工资模板配置(整组替换)。模板=工资模板项目(类型)+工资模板公式(公式),按 模板编号+台头项目 串联。本期公式模板级(部门编号=NULL)。
public sealed class WageTemplateService(ISqlConnectionFactory factory)
{
    public async Task<IReadOnlyList<WageTemplateHeaderDto>> ListAsync(string? keyword)
    {
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        var rows = await c.QueryAsync<WageTemplateHeaderDto>(@"
SELECT [模板编号], MAX([模板名称]) AS 模板名称, COUNT(*) AS 项目数
FROM [工资模板项目]
WHERE @kw IS NULL OR [模板编号] LIKE @kw OR [模板名称] LIKE @kw
GROUP BY [模板编号] ORDER BY [模板编号];", new { kw });
        return rows.AsList();
    }

    public async Task<WageTemplateDetailDto?> GetAsync(string 模板编号)
    {
        using var c = factory.Create();
        var items = (await c.QueryAsync<WageTemplateItemDto>(@"
SELECT CAST(i.[序号] AS int) AS 序号, i.[台头项目], i.[类型], f.[公式]
FROM [工资模板项目] i
LEFT JOIN [工资模板公式] f ON f.[模板编号]=i.[模板编号] AND f.[台头项目]=i.[台头项目] AND f.[部门编号] IS NULL
WHERE i.[模板编号]=@模板编号 ORDER BY i.[序号];", new { 模板编号 })).AsList();
        if (items.Count == 0) return null;
        var 名称 = await c.ExecuteScalarAsync<string?>("SELECT MAX([模板名称]) FROM [工资模板项目] WHERE [模板编号]=@模板编号", new { 模板编号 });
        return new WageTemplateDetailDto { 模板编号 = 模板编号, 模板名称 = 名称, 明细 = items };
    }

    public async Task SaveAsync(WageTemplateSaveDto dto, string user)
    {
        if (string.IsNullOrWhiteSpace(dto.模板编号)) throw new ArgumentException("模板编号必填");
        if (dto.明细.Count == 0) throw new ArgumentException("工资模板至少要有一个工资项");
        var 项目名 = dto.明细.Select(x => (x.台头项目 ?? "").Trim()).ToList();
        if (项目名.Any(string.IsNullOrEmpty)) throw new ArgumentException("台头项目必填");
        if (项目名.Distinct().Count() != 项目名.Count) throw new ArgumentException("台头项目在模板内不能重复");

        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        await c.ExecuteAsync("DELETE FROM [工资模板项目] WHERE [模板编号]=@模板编号", new { dto.模板编号 }, tx);
        await c.ExecuteAsync("DELETE FROM [工资模板公式] WHERE [模板编号]=@模板编号", new { dto.模板编号 }, tx);
        int 序 = 0;
        foreach (var it in dto.明细)
        {
            序++;
            await c.ExecuteAsync(@"
INSERT INTO [工资模板项目]([模板编号],[模板名称],[序号],[台头项目],[类型])
VALUES(@模板编号,@模板名称,@序号,@台头项目,@类型)",
                new { dto.模板编号, dto.模板名称, 序号 = 序, it.台头项目, it.类型 }, tx);
            await c.ExecuteAsync(@"
INSERT INTO [工资模板公式]([模板编号],[模板名称],[部门编号],[部门名称],[序号],[台头项目],[公式])
VALUES(@模板编号,@模板名称,NULL,NULL,@序号,@台头项目,@公式)",
                new { dto.模板编号, dto.模板名称, 序号 = 序, it.台头项目, it.公式 }, tx);
        }
        tx.Commit();
    }

    public async Task<bool> DeleteAsync(string 模板编号)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var n = await c.ExecuteAsync("DELETE FROM [工资模板项目] WHERE [模板编号]=@模板编号", new { 模板编号 }, tx);
        await c.ExecuteAsync("DELETE FROM [工资模板公式] WHERE [模板编号]=@模板编号", new { 模板编号 }, tx);
        tx.Commit();
        return n > 0;
    }
}
