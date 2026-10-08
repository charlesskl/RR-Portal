using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Materials.MaterialReturn;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class MaterialReturnQueryDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    private MaterialReturnService Svc() => new(Factory(), new DocumentNumberGenerator());

    // 退料单 TLQ1(已审核·生产单号SC1)：物料 MTLQ 红100/蓝50；退料单 TLQ2(未审核·生产单号SC1)：红30
    private static void Seed(SqlConnection c)
    {
        Cleanup(c);
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[规格],[单位]) VALUES(N'MTLQ',N'退料查询料',N'规格X',N'米')");
        c.Execute("INSERT INTO [退料单]([单号],[日期],[生产单号],[退料部门],[退料人],[审核]) VALUES(N'TLQ1','2026-03-10',N'SC1',N'车缝部',N'李四','1')");
        c.Execute("INSERT INTO [退料单]([单号],[日期],[生产单号],[退料部门],[退料人],[审核]) VALUES(N'TLQ2','2026-03-20',N'SC1',N'车缝部',N'李四','0')");
        c.Execute(@"INSERT INTO [退料明细单]([单号],[日期],[生产单号],[款号],[退料部门],[退料人],[物料类别],[物料编号],[物料名称],[规格],[颜色],[单位],[数量],[备注])
                    VALUES(N'TLQ1','2026-03-10',N'SC1',N'K1',N'车缝部',N'李四',N'布料',N'MTLQ',N'退料查询料',N'规格X',N'红',N'米',100,N'红备注'),
                          (N'TLQ1','2026-03-10',N'SC1',N'K1',N'车缝部',N'李四',N'布料',N'MTLQ',N'退料查询料',N'规格X',N'蓝',N'米',50,N'')");
        c.Execute(@"INSERT INTO [退料明细单]([单号],[日期],[生产单号],[款号],[退料部门],[退料人],[物料类别],[物料编号],[物料名称],[规格],[颜色],[单位],[数量])
                    VALUES(N'TLQ2','2026-03-20',N'SC1',N'K1',N'车缝部',N'李四',N'布料',N'MTLQ',N'退料查询料',N'规格X',N'红',N'米',30)");
    }

    private static void Cleanup(SqlConnection c)
    {
        c.Execute("DELETE FROM [退料明细单] WHERE [单号] IN (N'TLQ1',N'TLQ2')");
        c.Execute("DELETE FROM [退料单] WHERE [单号] IN (N'TLQ1',N'TLQ2')");
        c.Execute("DELETE FROM [物料资料] WHERE [物料编号]=N'MTLQ'");
    }

    [SkippableFact]
    public async Task Detail_returns_lines_with_dept_person()
    {
        using var c = fx.Open();
        Seed(c);
        try
        {
            var rows = await Svc().ReturnQueryDetailAsync(null, null, "退料查询料", null, null);
            Assert.Equal(3, rows.Count);
            var 红1 = rows.First(r => r.单号 == "TLQ1" && r.颜色 == "红");
            Assert.Equal("SC1", 红1.生产单号);
            Assert.Equal("车缝部", 红1.退料部门);
            Assert.Equal("李四", 红1.退料人);
            Assert.Equal(100m, 红1.数量);
            Assert.Equal("红备注", 红1.备注);
            Assert.Equal("1", 红1.审核);
        }
        finally { Cleanup(c); }
    }

    [SkippableFact]
    public async Task Summary_groups_by_production_no_and_material()
    {
        using var c = fx.Open();
        Seed(c);
        try
        {
            var rows = await Svc().ReturnQuerySummaryAsync(null, null, "退料查询料", null, null);
            Assert.Equal(2, rows.Count);  // SC1+MTLQ红、SC1+MTLQ蓝
            var 红 = rows.Single(r => r.颜色 == "红");
            Assert.Equal("SC1", 红.生产单号);
            Assert.Equal("K1", 红.款号);
            Assert.Equal(130m, 红.退料数量);   // 100+30(跨已/未审核·同生产单号)
            Assert.Equal(50m, rows.Single(r => r.颜色 == "蓝").退料数量);
        }
        finally { Cleanup(c); }
    }

    [SkippableFact]
    public async Task Filters_by_approval_and_date()
    {
        using var c = fx.Open();
        Seed(c);
        try
        {
            Assert.Equal(2, (await Svc().ReturnQueryDetailAsync(null, null, null, null, "已审核")).Count);
            Assert.Single(await Svc().ReturnQueryDetailAsync(null, null, null, null, "未审核"));
            // 日期 [03-10,03-15] 半开上界 03-16：只含 TLQ1 的 2 行
            Assert.Equal(2, (await Svc().ReturnQueryDetailAsync(new DateTime(2026,3,10), new DateTime(2026,3,15), "退料查询料", null, null)).Count);
        }
        finally { Cleanup(c); }
    }
}
