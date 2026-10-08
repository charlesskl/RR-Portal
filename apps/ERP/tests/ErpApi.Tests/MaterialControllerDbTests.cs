using System.Security.Claims;
using Dapper;
using ErpApi.Data;
using ErpApi.Data.Entities;
using ErpApi.Engines.Authorization;
using ErpApi.Features.MasterData;
using ErpApi.Infrastructure.Db;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Xunit;

// 回归:物料资料编辑表单空供应商编号提交空串,空串≠NULL 撞 FK_135_查找(→供应商资料)报 500。
// 修复后:校验钩子空串→null 正常落库;不存在的供应商编号给中文 400 而非 500。
[Collection("db")]
public class MaterialControllerDbTests(DbFixture fx)
{
    private MaterialController Make()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        var db = new ErpDbContext(new DbContextOptionsBuilder<ErpDbContext>()
            .UseSqlServer(fx.ConnectionString!).Options);
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        var c = new MaterialController(
            new MasterCrudService<物料资料>(db), new AllowAllPerm(), new NullAudit(),
            new SqlConnectionFactory(cfg));
        c.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity(
                    [new Claim(ClaimTypes.NameIdentifier, "tester")], "test")),
            },
        };
        return c;
    }

    private void Cleanup()
    {
        using var c = fx.Open();
        // 先删子(物料资料引用供应商资料)再删父
        c.Execute("DELETE FROM [物料资料] WHERE [物料编号] LIKE N'FK135%'");
        c.Execute("DELETE FROM [供应商资料] WHERE [供应商编号] LIKE N'FK135%'");
    }

    [SkippableFact]
    public async Task Update_供应商编号空串存NULL_不存在供应商给中文400()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        Cleanup();
        long id;
        using (var c = fx.Open())
        {
            c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称]) VALUES(N'FK135-M1',N'FK测试料')");
            id = c.ExecuteScalar<long>("SELECT [ID] FROM [物料资料] WHERE [物料编号]=N'FK135-M1'");
            c.Execute("INSERT INTO [供应商资料]([供应商编号],[供应商名称]) VALUES(N'FK135-S1',N'FK测试供应商')");
        }
        try
        {
            var ctl = Make();

            // 空串(表单空输入的实际提交值) → 保存成功且落库 NULL,不再撞 FK
            var r1 = await ctl.Update(id, new 物料资料 { 物料编号 = "FK135-M1", 物料名称 = "FK测试料", 供应商编号 = "" });
            Assert.IsType<NoContentResult>(r1);
            using (var c = fx.Open())
                Assert.Null(c.ExecuteScalar<string?>(
                    "SELECT [供应商编号] FROM [物料资料] WHERE [ID]=@id", new { id }));

            // 存在的供应商 → 正常保存
            var r2 = await ctl.Update(id, new 物料资料 { 物料编号 = "FK135-M1", 物料名称 = "FK测试料", 供应商编号 = "FK135-S1" });
            Assert.IsType<NoContentResult>(r2);
            using (var c = fx.Open())
                Assert.Equal("FK135-S1", c.ExecuteScalar<string?>(
                    "SELECT [供应商编号] FROM [物料资料] WHERE [ID]=@id", new { id }));

            // 不存在的供应商 → 中文 400,不到库层
            var r3 = await ctl.Update(id, new 物料资料 { 物料编号 = "FK135-M1", 物料名称 = "FK测试料", 供应商编号 = "FK135-NOPE" });
            var bad = Assert.IsType<BadRequestObjectResult>(r3);
            Assert.Contains("供应商编号不存在", bad.Value!.ToString()!);
        }
        finally { Cleanup(); }
    }

    private sealed class AllowAllPerm : IPermissionService
    {
        public Task<bool> HasAsync(string userName, string menu, PermissionAction action) =>
            Task.FromResult(true);

        public Task<IReadOnlyDictionary<string, PermissionFlags>> GetByUserAsync(string userName) =>
            Task.FromResult<IReadOnlyDictionary<string, PermissionFlags>>(
                new Dictionary<string, PermissionFlags>());
    }

    private sealed class NullAudit : IAuditLogger
    {
        public Task WriteAsync(string tableName, string action, string user, string record,
            SqlConnection conn, SqlTransaction? tx = null) => Task.CompletedTask;
    }
}
