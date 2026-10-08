using Dapper;
using ErpApi.Features.Admin;
using ErpApi.Infrastructure.Db;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class PermissionAdminServiceDbTests(DbFixture fx)
{
    private static ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    private static PermissionAdminService Svc() => new(Factory());

    [SkippableFact]
    public async Task UserPerms_save_skips_allfalse_get_covers_catalog_and_replace()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        var svc = Svc();
        using var c = fx.Open();
        void Clean() => c.Execute("DELETE FROM [userbqrpower] WHERE [用户]=N'PERM_T1'");
        Clean();
        try
        {
            // 保存:客户资料 打开+保存=true;另带两条全 false 行(应被跳过)
            await svc.SaveUserPermsAsync("PERM_T1",
            [
                new MenuPermRow { 组 = "基础资料", 菜单 = "客户资料", 打开 = true, 保存 = true },
                new MenuPermRow { 组 = "基础资料", 菜单 = "供应商资料" },
                new MenuPermRow { 组 = "工资管理", 菜单 = "工资表" },
            ], "admin");

            // GetUserPerms 覆盖全部 MenuCatalog 菜单
            var perms = await svc.GetUserPermsAsync("PERM_T1");
            Assert.Equal(MenuCatalog.All.Count, perms.Count);
            foreach (var m in MenuCatalog.All)
                Assert.Contains(perms, p => p.菜单 == m.菜单);

            // 客户资料:打开&保存 true,其它位 false
            var 客户 = perms.Single(p => p.菜单 == "客户资料");
            Assert.True(客户.打开);
            Assert.True(客户.保存);
            Assert.False(客户.删除); Assert.False(客户.打印); Assert.False(客户.单价);
            Assert.False(客户.金额); Assert.False(客户.审核); Assert.False(客户.反审核); Assert.False(客户.功能);

            // 工资表:无行 → 全 false
            var 工资表 = perms.Single(p => p.菜单 == "工资表");
            Assert.False(工资表.打开); Assert.False(工资表.保存); Assert.False(工资表.删除);
            Assert.False(工资表.打印); Assert.False(工资表.单价); Assert.False(工资表.金额);
            Assert.False(工资表.审核); Assert.False(工资表.反审核); Assert.False(工资表.功能);

            // 库内只写了一行(全 false 行被跳过)
            var count = c.ExecuteScalar<int>("SELECT COUNT(*) FROM [userbqrpower] WHERE [用户]=N'PERM_T1'");
            Assert.Equal(1, count);

            // 整组替换:仅保存 库存月结 打开=true → 客户资料 行消失
            await svc.SaveUserPermsAsync("PERM_T1",
            [
                new MenuPermRow { 组 = "月结管理", 菜单 = "库存月结", 打开 = true },
            ], "admin");

            var perms2 = await svc.GetUserPermsAsync("PERM_T1");
            var 客户2 = perms2.Single(p => p.菜单 == "客户资料");
            Assert.False(客户2.打开); Assert.False(客户2.保存);
            var 月结 = perms2.Single(p => p.菜单 == "库存月结");
            Assert.True(月结.打开);

            var count2 = c.ExecuteScalar<int>("SELECT COUNT(*) FROM [userbqrpower] WHERE [用户]=N'PERM_T1'");
            Assert.Equal(1, count2);
        }
        finally
        {
            Clean();
        }
    }

    // 非 MenuCatalog 菜单行(旧系统遗留键):GET 合并视图须带出,PUT 整组替换后不得丢行。
    // (「生产排期」2026-09-21 已入目录(D7 修复),本用例改用虚构遗留键验证合并逻辑本身)
    [SkippableFact]
    public async Task GetUserPerms_merges_noncatalog_rows_and_save_preserves_them()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        var svc = Svc();
        using var c = fx.Open();
        void Clean() => c.Execute("DELETE FROM [userbqrpower] WHERE [用户]=N'PERM_T2'");
        Clean();
        try
        {
            c.Execute(@"INSERT INTO [userbqrpower]([用户],[名称],[菜单],[打开],[保存],[功能])
                        VALUES(N'PERM_T2',N'PERM_T2',N'遗留菜单X',1,0,1)");

            var perms = await svc.GetUserPermsAsync("PERM_T2");
            Assert.True(perms.Count > MenuCatalog.All.Count);
            var extra = perms.Single(p => p.菜单 == "遗留菜单X");
            Assert.True(extra.打开);
            Assert.False(extra.保存);
            Assert.True(extra.功能);

            // 整组替换:GET 的合并视图原样回写后,非目录行仍在库内且位值不变
            await svc.SaveUserPermsAsync("PERM_T2", perms, "admin");
            var row = c.QuerySingle(@"SELECT [打开],[保存],[功能] FROM [userbqrpower]
                                      WHERE [用户]=N'PERM_T2' AND [菜单]=N'遗留菜单X'");
            Assert.True((bool)row.打开);
            Assert.False((bool)row.保存);
            Assert.True((bool)row.功能);
        }
        finally
        {
            Clean();
        }
    }
}
