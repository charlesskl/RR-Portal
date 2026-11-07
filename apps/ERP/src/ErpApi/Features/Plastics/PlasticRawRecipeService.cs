using Dapper;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.Inventory;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;

namespace ErpApi.Features.Plastics;

public sealed class PlasticRawRecipeService(ISqlConnectionFactory factory, IAuditLogger audit)
{
    internal sealed class RawIdentity
    {
        public long ID { get; set; }
        public string 物料编号 { get; set; } = "";
        public string 物料名称 { get; set; } = "";
    }

    internal static async Task LockRecipesAsync(SqlConnection c, SqlTransaction tx, bool write)
    {
        var result = await c.ExecuteScalarAsync<int>(@"DECLARE @r int;
EXEC @r=sys.sp_getapplock @Resource=N'erp:plastic-raw-recipes',@LockMode=@mode,@LockOwner=N'Transaction',@LockTimeout=15000;
SELECT @r;", new { mode = write ? "Exclusive" : "Shared" }, tx);
        if (result < 0) throw new InvalidOperationException("原料配方正在修改，请稍后重试。");
    }

    internal static async Task<RawIdentity> IdentityAsync(SqlConnection c, SqlTransaction? tx, string code)
    {
        var rows = (await c.QueryAsync<RawIdentity>(@"SELECT TOP(2) [ID],[物料编号],[物料名称]
FROM [塑胶原料资料] WHERE [物料编号]=@code ORDER BY [ID]", new { code }, tx)).AsList();
        if (rows.Count == 0) throw new KeyNotFoundException($"原料编号 {code} 不存在，请先建立真实原料资料。");
        if (rows.Count != 1) throw new InvalidOperationException($"原料编号 {code} 存在重复档案，请先核对，不能猜测配方成员。");
        rows[0].物料编号 = rows[0].物料编号.Trim();
        if (rows[0].物料编号.Length > 40 || rows[0].物料名称?.Length > 80)
            throw new InvalidOperationException($"原料 {code} 的编号或名称超出配方快照长度，请先核对原料资料。");
        return rows[0];
    }

    public async Task<PlasticRawRecipeDto> GetAsync(string code)
    {
        using var c = factory.Create();
        var parent = await IdentityAsync(c, null, code);
        var lines = (await c.QueryAsync<PlasticRawRecipeLine>(@"SELECT m.[物料编号] AS 原料编号,m.[物料名称] AS 原料名称,
d.[比例],d.[库存单位],d.[每库存单位KG]
FROM [塑胶原料配方明细] d LEFT JOIN [塑胶原料资料] m ON m.[ID]=d.[原料ID]
WHERE d.[配方原料ID]=@id ORDER BY m.[物料编号],m.[ID]", new { id = parent.ID })).AsList();
        if (lines.Any(x => string.IsNullOrWhiteSpace(x.原料编号)))
            throw new InvalidOperationException("原料配方成员不存在，请先核对原料资料。");
        return new() { 原料编号 = parent.物料编号, 原料名称 = parent.物料名称, 明细 = lines };
    }

    public async Task PutAsync(string code, PlasticRawRecipeDto dto, string user)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var parent = await IdentityAsync(c, tx, code);
        var identities = new List<RawIdentity>();
        foreach (var line in dto.明细)
            identities.Add(await IdentityAsync(c, tx, line.原料编号));
        if (identities.Select(x => x.ID).Distinct().Count() != identities.Count)
            throw new ArgumentException("配方中同一个真实原料只能出现一次，请合并比例。");
        await RawMaterialInventorySql.LockCodesAsync(c, tx, identities.Select(x => x.物料编号));
        await LockRecipesAsync(c, tx, write: true);
        await RawMaterialTransactionPermissions.RequireAsync(c, tx, user, "塑胶原料资料表", PermissionAction.保存);
        if ((await IdentityAsync(c, tx, code)).ID != parent.ID)
            throw new InvalidOperationException("原料档案正在修改，请重新打开配方后再保存。");
        for (var i = 0; i < identities.Count; i++)
            if ((await IdentityAsync(c, tx, dto.明细[i].原料编号)).ID != identities[i].ID)
                throw new InvalidOperationException("原料组分正在修改，请重新选择真实原料。");
        for (var i = 0; i < dto.明细.Count; i++)
        {
            var line = dto.明细[i];
            var frozen = await c.QuerySingleOrDefaultAsync<PlasticRawRecipeLine>(@"SELECT [库存单位],[每库存单位KG]
FROM [原料自动扣料期初] WHERE [原料编号]=@code", new { code = identities[i].物料编号 }, tx);
            if (frozen is not null && (frozen.库存单位 != line.库存单位 || frozen.每库存单位KG != line.每库存单位KG))
                throw new InvalidOperationException($"原料 {identities[i].物料编号} 已启用自动扣料，库存单位和换算不能改写历史账本。");
            await RawMaterialInventorySql.ActivateAsync(c, tx, identities[i].物料编号, line.库存单位, line.每库存单位KG);
        }
        await c.ExecuteAsync("DELETE FROM [塑胶原料配方明细] WHERE [配方原料ID]=@id", new { id = parent.ID }, tx);
        if (dto.明细.Count == 0)
            await c.ExecuteAsync("DELETE FROM [塑胶原料配方] WHERE [原料ID]=@id", new { id = parent.ID }, tx);
        else
        {
            await c.ExecuteAsync(@"UPDATE [塑胶原料配方] SET [操作员]=@user,[修改日期]=SYSDATETIME() WHERE [原料ID]=@id;
IF @@ROWCOUNT=0 INSERT INTO [塑胶原料配方]([原料ID],[操作员],[修改日期]) VALUES(@id,@user,SYSDATETIME());",
                new { id = parent.ID, user }, tx);
            for (var i = 0; i < dto.明细.Count; i++)
                await c.ExecuteAsync(@"INSERT INTO [塑胶原料配方明细]([配方原料ID],[原料ID],[比例],[库存单位],[每库存单位KG])
VALUES(@parent,@id,@ratio,@unit,@factor)", new
                {
                    parent = parent.ID, id = identities[i].ID, ratio = dto.明细[i].比例,
                    unit = dto.明细[i].库存单位, factor = dto.明细[i].每库存单位KG
                }, tx);
        }
        await audit.WriteAsync("塑胶原料资料表", "设置原料配方", user,
            $"原料编号={parent.物料编号};组分数={dto.明细.Count}", c, tx);
        tx.Commit();
    }
}
