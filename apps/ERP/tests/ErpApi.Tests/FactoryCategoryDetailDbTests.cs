using Dapper;
using ErpApi.Features.Assembly;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class FactoryCategoryDetailDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private FactoryCategoryDetailService Svc() => new(Factory());

    private static void Clean(SqlConnection c)
    {
        c.Execute("DELETE FROM [塑胶加工采购单] WHERE [单号] LIKE N'FCD-%'");
        c.Execute("DELETE FROM [装配加工采购单] WHERE [单号] LIKE N'FCD-%'");
        c.Execute("DELETE FROM [加工厂资料] WHERE [加工厂编号] LIKE N'FCD-%'");
    }

    [SkippableFact]
    public async Task List_unions_plastic_and_assembly_and_resolves_category()
    {
        using var c = fx.Open(); Clean(c);
        try
        {
            c.Execute("INSERT INTO [加工厂资料]([加工厂类别],[加工厂编号],[加工厂名称]) VALUES (N'车缝',N'FCD-F01',N'FCD车缝厂')");
            c.Execute(@"INSERT INTO [塑胶加工采购单]([单号],[日期],[加工厂编号],[加工厂名称],[客户名称],[数量],[金额],[审核])
VALUES(N'FCD-P01','2026-07-01',N'FCD-F01',N'FCD车缝厂',N'FCD客户',10,500,'1')");
            c.Execute(@"INSERT INTO [装配加工采购单]([单号],[日期],[供应商编号],[供应商名称],[客户名称],[数量],[金额],[审核])
VALUES(N'FCD-A01','2026-07-02',N'FCD-F01',N'FCD车缝厂',N'FCD客户',5,250,'0')");
            c.Execute(@"INSERT INTO [塑胶加工采购单]([单号],[日期],[加工厂编号],[加工厂名称],[数量],[金额],[审核])
VALUES(N'FCD-P02','2026-07-03',N'FCD-F99',N'FCD无主档厂',3,90,'1')");

            var rows = await Svc().ListAsync(new DateTime(2026, 7, 1), new DateTime(2026, 7, 31), null, "FCD-", null);

            var plastic = Assert.Single(rows.Where(r => r.单号 == "FCD-P01"));
            Assert.Equal("车缝", plastic.加工厂类别);
            Assert.Equal("塑胶加工采购单", plastic.单据类型);
            Assert.Equal(10m, plastic.数量);
            Assert.Equal(500m, plastic.金额);

            var assembly = Assert.Single(rows.Where(r => r.单号 == "FCD-A01"));
            Assert.Equal("委托加工单", assembly.单据类型);
            Assert.Equal("车缝", assembly.加工厂类别);

            // 无加工厂主档 → 未分类
            var unknown = Assert.Single(rows.Where(r => r.单号 == "FCD-P02"));
            Assert.Equal("未分类", unknown.加工厂类别);

            // 类别过滤
            rows = await Svc().ListAsync(new DateTime(2026, 7, 1), new DateTime(2026, 7, 31), "车缝", "FCD-", null);
            Assert.Equal(2, rows.Count);
            Assert.DoesNotContain(rows, r => r.单号 == "FCD-P02");

            rows = await Svc().ListAsync(new DateTime(2026, 7, 1), new DateTime(2026, 7, 31), "未分类", "FCD-", null);
            Assert.Single(rows);
            Assert.Equal("FCD-P02", rows[0].单号);

            // 排序:类别 → 加工厂编号 → 日期(类别先后由数据库中文排序规则决定,不假设 codepoint 顺序)
            rows = await Svc().ListAsync(new DateTime(2026, 7, 1), new DateTime(2026, 7, 31), null, "FCD-", null);
            Assert.Equal(new[] { "FCD-A01", "FCD-P01", "FCD-P02" }, rows.Select(r => r.单号).OrderBy(x => x).ToArray());
            // 同一类别必须连续(类别分组)
            var cats = rows.Select(r => r.加工厂类别).ToList();
            Assert.Equal(cats.Count, cats.Distinct().Sum(cat => cats.LastIndexOf(cat) - cats.IndexOf(cat) + 1));
            // 类别内的行按 加工厂编号 → 日期 升序
            foreach (var g in rows.GroupBy(r => r.加工厂类别))
            {
                var keys = g.Select(r => (r.加工厂编号, r.日期)).ToList();
                Assert.Equal(keys.OrderBy(k => k.加工厂编号, StringComparer.Ordinal).ThenBy(k => k.日期), keys);
            }
        }
        finally { Clean(c); }
    }
}
