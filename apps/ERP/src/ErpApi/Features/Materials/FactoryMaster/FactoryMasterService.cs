using Dapper;
using ErpApi.Features.MasterData;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Materials.FactoryMaster;

// 加工厂资料左树 + 右表的只读查询。增删改复用 MasterCrudController(/api/master/factories)。
public sealed class FactoryMasterService(ISqlConnectionFactory factory)
{
    // 左树：加工厂上实际出现的非空分类 + 该类加工厂数
    public async Task<IReadOnlyList<FactoryCategoryNode>> CategoriesAsync()
    {
        using var c = factory.Create();
        var rows = await c.QueryAsync<FactoryCategoryNode>(@"
SELECT [加工厂类别] AS 类别, COUNT(*) AS 数量
FROM [加工厂资料]
WHERE [加工厂类别] IS NOT NULL AND LTRIM(RTRIM([加工厂类别])) <> ''
GROUP BY [加工厂类别]
ORDER BY [加工厂类别];");
        return rows.AsList();
    }

    // 右表：按精确分类(@类别 空=不过滤) + 关键字 过滤的分页
    public async Task<PagedResult<FactoryRow>> ListAsync(string? 类别, string? keyword, int page, int size)
    {
        if (page < 1) page = 1;
        if (size < 1) size = 20;
        if (size > 1000) size = 1000;
        var cat = string.IsNullOrWhiteSpace(类别) ? null : 类别.Trim();
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [加工厂资料]
WHERE (@cat IS NULL OR [加工厂类别] = @cat)
  AND (@kw IS NULL OR [加工厂编号] LIKE @kw OR [加工厂名称] LIKE @kw OR [联系人] LIKE @kw);
SELECT [ID],[加工厂类别],[加工厂编号],[加工厂名称],[联系人],[手机],[电话],[传真],[联系地址],[付款方式],[货币],[备注]
FROM [加工厂资料]
WHERE (@cat IS NULL OR [加工厂类别] = @cat)
  AND (@kw IS NULL OR [加工厂编号] LIKE @kw OR [加工厂名称] LIKE @kw OR [联系人] LIKE @kw)
ORDER BY [加工厂编号] OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;",
            new { cat, kw, page, size });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<FactoryRow>()).AsList();
        return new PagedResult<FactoryRow>(items, total);
    }
}
