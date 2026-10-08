using Dapper;
using ErpApi.Features.Styles.SemiSetup;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class SemiSetupServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    private SemiSetupService Svc() => new(Factory());

    // 唯一货号后缀，避免污染/冲突
    private static string 货号(string tag) => $"SSUT-{tag}";
    private static readonly string[] 货号s = [货号("A"), 货号("B"), 货号("C")];

    private static void Cleanup(SqlConnection c)
    {
        c.Execute(@"DELETE FROM [半成品设置明细] WHERE [头ID] IN (SELECT [ID] FROM [半成品设置] WHERE [货号] IN @货号s);", new { 货号s });
        c.Execute("DELETE FROM [半成品设置] WHERE [货号] IN @货号s;", new { 货号s });
    }

    private static SemiSetupSaveDto 半成品载荷(string 货号, string 名称, decimal? 用量 = null) => new(货号, 名称, "半成品", 用量,
    [
        new("M-001", "面料A", "100D", "红", "米", 2.5m),
        new("M-002", "辅料B", null, null, "PCS", 4m),
    ]);

    [SkippableFact]
    public async Task Create_list_delete_roundtrip()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        Cleanup(c);
        try
        {
            var svc = Svc();
            var id = await svc.CreateAsync(半成品载荷(货号("A"), "上半身"), "tester");

            var list = await svc.ListAsync(货号("A"));
            var v = Assert.Single(list);
            Assert.Equal(id, v.ID);
            Assert.Equal(货号("A"), v.货号);
            Assert.Equal("上半身", v.名称);
            Assert.Equal("半成品", v.类型);
            Assert.Equal(1, v.顺序);
            Assert.Equal(1m, v.用量); // 未传用量默认 1
            Assert.Equal("tester", v.操作员);
            Assert.Equal(2, v.明细.Count);
            Assert.Equal("M-001", v.明细[0].物料编号);
            Assert.Equal("面料A", v.明细[0].物料名称);
            Assert.Equal(2.5m, v.明细[0].使用数量);
            Assert.Equal("M-002", v.明细[1].物料编号);

            // 同货号第二个半成品：顺序 +1
            await svc.CreateAsync(半成品载荷(货号("A"), "下半身"), "tester");
            var list2 = await svc.ListAsync(货号("A"));
            Assert.Equal(2, list2.Count);
            Assert.Equal([1, 2], list2.Select(x => x.顺序).ToArray());

            // 删除：明细 + 头部都清掉
            await svc.DeleteAsync(id);
            var list3 = await svc.ListAsync(货号("A"));
            var rest = Assert.Single(list3);
            Assert.Equal("下半身", rest.名称);
        }
        finally { Cleanup(c); }
    }

    [SkippableFact]
    public async Task Create_rejects_packaging_type()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        Cleanup(c);
        try
        {
            var svc = Svc();
            // 包装类型已并入半成品(迁移 117),后端不再接受 包装
            var ex = await Assert.ThrowsAsync<InvalidOperationException>(
                () => svc.CreateAsync(new SemiSetupSaveDto(货号("B"), "彩盒包装", "包装", null,
                    [new SemiSetupLineDto("M-009", "彩盒", null, null, "个", 1m)]), "tester"));
            Assert.Contains("半成品", ex.Message);

            var ex2 = await Assert.ThrowsAsync<InvalidOperationException>(
                () => svc.UpdateAsync(1, new SemiSetupSaveDto(货号("B"), "彩盒包装", "包装", null,
                    [new SemiSetupLineDto("M-009", "彩盒", null, null, "个", 1m)]), "tester"));
            Assert.Contains("半成品", ex2.Message);

            Assert.Empty(await svc.ListAsync(货号("B")));
        }
        finally { Cleanup(c); }
    }

    [SkippableFact]
    public async Task Create_rejects_blank_name_and_empty_lines()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        Cleanup(c);
        try
        {
            var svc = Svc();
            var ex1 = await Assert.ThrowsAsync<InvalidOperationException>(
                () => svc.CreateAsync(new SemiSetupSaveDto(货号("C"), "  ", "半成品", null,
                    [new SemiSetupLineDto("M-001", null, null, null, null, null)]), "tester"));
            Assert.Contains("名称", ex1.Message);

            var ex2 = await Assert.ThrowsAsync<InvalidOperationException>(
                () => svc.CreateAsync(new SemiSetupSaveDto(货号("C"), "上半身", "半成品", null, []), "tester"));
            Assert.Contains("物料", ex2.Message);

            // 全部明细物料编号为空也视为空明细
            var ex3 = await Assert.ThrowsAsync<InvalidOperationException>(
                () => svc.CreateAsync(new SemiSetupSaveDto(货号("C"), "上半身", "半成品", null,
                    [new SemiSetupLineDto(" ", null, null, null, null, null)]), "tester"));
            Assert.Contains("物料", ex3.Message);

            Assert.Empty(await svc.ListAsync(货号("C")));
        }
        finally { Cleanup(c); }
    }

    [SkippableFact]
    public async Task Usage_create_update_roundtrip_and_validation()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        Cleanup(c);
        try
        {
            var svc = Svc();
            // 创建带用量 2.5 → 读取原样返回
            var id = await svc.CreateAsync(半成品载荷(货号("A"), "大蛋", 2.5m), "tester");
            var v = Assert.Single(await svc.ListAsync(货号("A")));
            Assert.Equal(2.5m, v.用量);

            // 修改用量 0.5(明细整组替换不受影响)
            var ok = await svc.UpdateAsync(id, 半成品载荷(货号("A"), "大蛋", 0.5m), "tester");
            Assert.True(ok);
            v = Assert.Single(await svc.ListAsync(货号("A")));
            Assert.Equal(0.5m, v.用量);
            Assert.Equal(2, v.明细.Count);

            // 用量 ≤ 0 拒绝(create/update 同口径)
            await Assert.ThrowsAsync<InvalidOperationException>(
                () => svc.CreateAsync(半成品载荷(货号("A"), "零蛋", 0m), "tester"));
            await Assert.ThrowsAsync<InvalidOperationException>(
                () => svc.UpdateAsync(id, 半成品载荷(货号("A"), "大蛋", -1m), "tester"));
        }
        finally { Cleanup(c); }
    }
}
