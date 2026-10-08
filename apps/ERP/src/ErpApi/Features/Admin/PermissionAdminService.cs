using Dapper;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Admin;

// 用户权限矩阵(userbqrpower)。整组替换:删该用户全部权限,再插至少一位为 true 的菜单行。
public sealed class PermissionAdminService(ISqlConnectionFactory factory)
{
    public async Task<IReadOnlyList<MenuPermRow>> GetUserPermsAsync(string 用户名)
    {
        using var c = factory.Create();
        var existing = (await c.QueryAsync(@"
SELECT [菜单],[打开],[保存],[删除],[打印],[单价],[金额],[审核],[反审核],[功能]
FROM [userbqrpower] WHERE [用户]=@用户名", new { 用户名 }))
            // 历史改名迁移可能留下同键重复行(见 db/110):按位取"任一为 true 即 true"容错合并,不整表 500
            .GroupBy(r => (string)r.菜单)
            .ToDictionary(g => g.Key, g => g.First());
        var list = new List<MenuPermRow>();
        foreach (var m in MenuCatalog.All)
        {
            var row = new MenuPermRow { 组 = m.组, 菜单 = m.菜单 };
            if (existing.TryGetValue(m.菜单, out var e))
            {
                row.打开 = (bool?)e.打开 ?? false; row.保存 = (bool?)e.保存 ?? false; row.删除 = (bool?)e.删除 ?? false;
                row.打印 = (bool?)e.打印 ?? false; row.单价 = (bool?)e.单价 ?? false; row.金额 = (bool?)e.金额 ?? false;
                row.审核 = (bool?)e.审核 ?? false; row.反审核 = (bool?)e.反审核 ?? false; row.功能 = (bool?)e.功能 ?? false;
            }
            list.Add(row);
        }
        // 合并非目录菜单行(userbqrpower 有、MenuCatalog 未收录,如旧系统「生产排期」),
        // 防 PUT 整组替换时被清掉。userbqrpower 无组列,组留空由前端归入「(未分组)」。
        foreach (var e in existing.Values)
        {
            var 菜单 = (string)e.菜单;
            if (MenuCatalog.All.Any(m => m.菜单 == 菜单)) continue;
            list.Add(new MenuPermRow
            {
                菜单 = 菜单,
                打开 = (bool?)e.打开 ?? false, 保存 = (bool?)e.保存 ?? false, 删除 = (bool?)e.删除 ?? false,
                打印 = (bool?)e.打印 ?? false, 单价 = (bool?)e.单价 ?? false, 金额 = (bool?)e.金额 ?? false,
                审核 = (bool?)e.审核 ?? false, 反审核 = (bool?)e.反审核 ?? false, 功能 = (bool?)e.功能 ?? false,
            });
        }
        return list;
    }

    public async Task SaveUserPermsAsync(string 用户名, IReadOnlyList<MenuPermRow> rows, string operatorUser)
    {
        if (string.IsNullOrWhiteSpace(用户名)) throw new ArgumentException("用户名必填");
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        await c.ExecuteAsync("DELETE FROM [userbqrpower] WHERE [用户]=@用户名", new { 用户名 }, tx);
        foreach (var r in rows)
        {
            if (string.IsNullOrWhiteSpace(r.菜单)) continue;
            bool any = r.打开 || r.保存 || r.删除 || r.打印 || r.单价 || r.金额 || r.审核 || r.反审核 || r.功能;
            if (!any) continue;
            await c.ExecuteAsync(@"
INSERT INTO [userbqrpower]([用户],[名称],[菜单],[打开],[保存],[删除],[打印],[单价],[金额],[审核],[反审核],[功能])
VALUES(@用户名,@用户名,@菜单,@打开,@保存,@删除,@打印,@单价,@金额,@审核,@反审核,@功能)",
                new { 用户名, r.菜单, r.打开, r.保存, r.删除, r.打印, r.单价, r.金额, r.审核, r.反审核, r.功能 }, tx);
        }
        tx.Commit();
    }
}
