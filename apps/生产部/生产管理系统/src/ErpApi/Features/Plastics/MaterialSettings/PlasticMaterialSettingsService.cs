using Dapper;
using ErpApi.Engines.Authorization;
using ErpApi.Features.MasterData;
using ErpApi.Infrastructure.Db;

namespace ErpApi.Features.Plastics.MaterialSettings;

// 塑胶物料设置: 按塑胶物料(塑胶物料资料)设置参数(默认仓库/损耗率%)。
// 列表 = 塑胶物料资料 LEFT JOIN 塑胶物料设置, 未设置的物料显示空参数, 保存即 upsert。
public sealed class PlasticMaterialSettingsService(ISqlConnectionFactory factory, IAuditLogger audit)
{
    public const string Menu = "塑胶物料设置";

    // 下游消费用单条查询(预填默认仓库/损耗率), 未设置返回 null。
    public async Task<PlasticMaterialSettingLookup?> FindAsync(string materialCode)
    {
        var code = materialCode?.Trim() ?? "";
        if (code.Length == 0) return null;
        using var c = factory.Create();
        await c.OpenAsync();
        return await c.QuerySingleOrDefaultAsync<PlasticMaterialSettingLookup>(@"
SELECT [物料编号], [默认仓库], [损耗率]
FROM [塑胶物料设置] WHERE [物料编号]=@code;", new { code });
    }

    public async Task<PagedResult<PlasticMaterialSettingRow>> ListAsync(int page, int size, string? keyword)
    {
        page = Math.Max(page, 1);
        size = Math.Clamp(size, 1, 1000);
        var match = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        await c.OpenAsync();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [塑胶物料资料] m
WHERE NULLIF(LTRIM(RTRIM(m.[物料编号])), N'') IS NOT NULL
  AND (@match IS NULL OR m.[物料编号] LIKE @match OR m.[物料名称] LIKE @match OR m.[规格] LIKE @match);
SELECT s.[ID],
       LTRIM(RTRIM(m.[物料编号])) AS [物料编号],
       NULLIF(LTRIM(RTRIM(m.[物料名称])), N'') AS [物料名称],
       NULLIF(LTRIM(RTRIM(m.[规格])), N'') AS [规格],
       NULLIF(LTRIM(RTRIM(m.[单位])), N'') AS [单位],
       s.[默认仓库], s.[损耗率], s.[备注], s.[操作员], s.[更新时间]
FROM [塑胶物料资料] m
LEFT JOIN [塑胶物料设置] s ON s.[物料编号] = LTRIM(RTRIM(m.[物料编号]))
WHERE NULLIF(LTRIM(RTRIM(m.[物料编号])), N'') IS NOT NULL
  AND (@match IS NULL OR m.[物料编号] LIKE @match OR m.[物料名称] LIKE @match OR m.[规格] LIKE @match)
ORDER BY m.[物料编号]
OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;", new { page, size, match });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<PlasticMaterialSettingRow>()).AsList();
        return new PagedResult<PlasticMaterialSettingRow>(items, total);
    }

    public async Task<PlasticMaterialSettingRow> UpsertAsync(string materialCode,
        PlasticMaterialSettingSaveDto dto, string user)
    {
        var code = Validate(materialCode, dto, user);
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        try
        {
            var exists = await c.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM [塑胶物料资料] WHERE LTRIM(RTRIM([物料编号]))=@code", new { code }, tx);
            if (exists == 0) throw new KeyNotFoundException($"塑胶物料 [{code}] 不存在于塑胶物料资料。");
            await c.ExecuteAsync(@"
IF EXISTS (SELECT 1 FROM [塑胶物料设置] WITH (UPDLOCK,HOLDLOCK) WHERE [物料编号]=@code)
    UPDATE [塑胶物料设置]
    SET [默认仓库]=@默认仓库,[损耗率]=@损耗率,
        [备注]=@备注,[操作员]=@操作员,[更新时间]=SYSDATETIME()
    WHERE [物料编号]=@code;
ELSE
    INSERT INTO [塑胶物料设置]([物料编号],[默认仓库],[损耗率],[备注],[操作员])
    VALUES(@code,@默认仓库,@损耗率,@备注,@操作员);",
                new
                {
                    code,
                    默认仓库 = dto.默认仓库?.Trim(),
                    dto.损耗率,
                    备注 = dto.备注?.Trim(),
                    操作员 = user
                }, tx);
            await audit.WriteAsync(Menu, "保存", user, $"物料编号={code}", c, tx);
            tx.Commit();
        }
        catch
        {
            try { tx.Rollback(); } catch { }
            throw;
        }
        return (await GetRowAsync(code))!;
    }

    public async Task<bool> DeleteAsync(string materialCode, string user)
    {
        var code = materialCode?.Trim() ?? "";
        if (code.Length == 0) throw new ArgumentException("物料编号必填。");
        if (string.IsNullOrWhiteSpace(user)) throw new ArgumentException("操作员必填。", nameof(user));
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        try
        {
            var affected = await c.ExecuteAsync(
                "DELETE FROM [塑胶物料设置] WHERE [物料编号]=@code", new { code }, tx);
            if (affected > 0)
                await audit.WriteAsync(Menu, "删除", user, $"物料编号={code}", c, tx);
            tx.Commit();
            return affected > 0;
        }
        catch
        {
            try { tx.Rollback(); } catch { }
            throw;
        }
    }

    private async Task<PlasticMaterialSettingRow?> GetRowAsync(string code)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        return await c.QuerySingleOrDefaultAsync<PlasticMaterialSettingRow>(@"
SELECT s.[ID],
       LTRIM(RTRIM(m.[物料编号])) AS [物料编号],
       NULLIF(LTRIM(RTRIM(m.[物料名称])), N'') AS [物料名称],
       NULLIF(LTRIM(RTRIM(m.[规格])), N'') AS [规格],
       NULLIF(LTRIM(RTRIM(m.[单位])), N'') AS [单位],
       s.[默认仓库], s.[损耗率], s.[备注], s.[操作员], s.[更新时间]
FROM [塑胶物料资料] m
LEFT JOIN [塑胶物料设置] s ON s.[物料编号] = LTRIM(RTRIM(m.[物料编号]))
WHERE LTRIM(RTRIM(m.[物料编号]))=@code;", new { code });
    }

    private static string Validate(string materialCode, PlasticMaterialSettingSaveDto dto, string user)
    {
        var code = materialCode?.Trim() ?? "";
        if (code.Length == 0) throw new ArgumentException("物料编号必填。");
        if (code.Length > 80) throw new ArgumentException("物料编号不能超过 80 个字符。");
        if (string.IsNullOrWhiteSpace(user)) throw new ArgumentException("操作员必填。", nameof(user));
        if (user.Length > 80) throw new ArgumentException("操作员不能超过 80 个字符。");
        if (dto.默认仓库?.Length > 80) throw new ArgumentException("默认仓库不能超过 80 个字符。");
        if (dto.备注?.Length > 500) throw new ArgumentException("备注不能超过 500 个字符。");
        if (dto.损耗率 is < 0 or > 100) throw new ArgumentException("损耗率必须在 0 到 100 之间。");
        return code;
    }
}
