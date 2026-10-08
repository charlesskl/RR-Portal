using Dapper;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Engines.Authorization;

public sealed class PermissionService(ISqlConnectionFactory factory) : IPermissionService
{
    public async Task<IReadOnlyDictionary<string, PermissionFlags>> GetByUserAsync(string userName)
    {
        using var c = factory.Create();
        var rows = await c.QueryAsync(@"
SELECT [菜单],[打开],[保存],[删除],[打印],[单价],[金额],[审核],[反审核],[功能]
FROM [userbqrpower] WHERE [用户]=@userName", new { userName });

        var map = new Dictionary<string, PermissionFlags>(StringComparer.OrdinalIgnoreCase);
        foreach (var r in rows)
        {
            string menu = r.菜单 ?? "";
            if (string.IsNullOrEmpty(menu)) continue;
            map[menu] = new PermissionFlags
            {
                打开 = r.打开 ?? false, 保存 = r.保存 ?? false, 删除 = r.删除 ?? false,
                打印 = r.打印 ?? false, 单价 = r.单价 ?? false, 金额 = r.金额 ?? false,
                审核 = r.审核 ?? false, 反审核 = r.反审核 ?? false, 功能 = r.功能 ?? false
            };
        }
        return map;
    }

    public async Task<bool> HasAsync(string userName, string menu, PermissionAction action)
    {
        var map = await GetByUserAsync(userName);
        return map.TryGetValue(menu, out var f) && f.Has(action);
    }
}
