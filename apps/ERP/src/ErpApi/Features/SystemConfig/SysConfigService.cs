using Dapper;
using ErpApi.Infrastructure.Db;
using ErpApi.Infrastructure.Security;
namespace ErpApi.Features.SystemConfig;

// 系统参数 CRUD。加密值写时 AES 加密、读时脱敏(值=null);明文仅 GetValueAsync 服务端可取。
public sealed class SysConfigService(ISqlConnectionFactory factory, IConfigProtector protector)
{
    public async Task<IReadOnlyList<SysConfigRow>> ListAsync(string? keyword)
    {
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        var rows = (await c.QueryAsync<SysConfigRow>(@"
SELECT [键],[值],[是否加密],[备注] FROM [系统配置表]
WHERE @kw IS NULL OR [键] LIKE @kw OR [备注] LIKE @kw ORDER BY [键];", new { kw })).AsList();
        foreach (var r in rows) if (r.是否加密) r.值 = null;  // 脱敏
        return rows;
    }

    public async Task<SysConfigRow?> GetAsync(string 键)
    {
        using var c = factory.Create();
        var r = await c.QueryFirstOrDefaultAsync<SysConfigRow>(
            "SELECT [键],[值],[是否加密],[备注] FROM [系统配置表] WHERE [键]=@键", new { 键 });
        if (r is null) return null;
        if (r.是否加密) r.值 = null;
        return r;
    }

    public async Task UpsertAsync(SysConfigDto dto, string user)
    {
        if (string.IsNullOrWhiteSpace(dto.键)) throw new ArgumentException("键必填");
        using var c = factory.Create();
        string? 存值;
        if (dto.是否加密)
        {
            if (string.IsNullOrEmpty(dto.值))
                存值 = await c.ExecuteScalarAsync<string?>("SELECT [值] FROM [系统配置表] WHERE [键]=@键", new { dto.键 }); // 保留旧密文
            else
                存值 = protector.Encrypt(dto.值);
        }
        else 存值 = dto.值;

        await c.ExecuteAsync(@"
MERGE [系统配置表] AS t USING (SELECT @键 AS 键) AS s ON t.[键]=s.键
WHEN MATCHED THEN UPDATE SET [值]=@值,[是否加密]=@是否加密,[备注]=@备注
WHEN NOT MATCHED THEN INSERT([键],[值],[是否加密],[备注]) VALUES(@键,@值,@是否加密,@备注);",
            new { dto.键, 值 = 存值, 是否加密 = dto.是否加密, dto.备注 });
    }

    public async Task<bool> DeleteAsync(string 键)
    {
        using var c = factory.Create();
        return await c.ExecuteAsync("DELETE FROM [系统配置表] WHERE [键]=@键", new { 键 }) > 0;
    }

    // 服务端消费者取明文（不暴露 API）
    public async Task<string?> GetValueAsync(string 键)
    {
        using var c = factory.Create();
        var r = await c.QueryFirstOrDefaultAsync<SysConfigRow>(
            "SELECT [值],[是否加密] FROM [系统配置表] WHERE [键]=@键", new { 键 });
        if (r is null) return null;
        return r.是否加密 && r.值 is not null ? protector.TryDecrypt(r.值) : r.值;
    }
}
