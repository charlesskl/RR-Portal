using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Materials.MaterialIssue;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class MaterialIssueQueryDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    private MaterialIssueService Svc() => new(Factory(), new DocumentNumberGenerator());

    // 领料单 LLQ1(已审核)：物料 MLLQ 红100/蓝50；领料单 LLQ2(未审核)：红30
    private static void Seed(SqlConnection c)
    {
        Cleanup(c);
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[规格],[单位]) VALUES(N'MLLQ',N'领料查询料',N'规格X',N'米')");
        c.Execute("INSERT INTO [领料单]([单号],[日期],[领料部门],[领料人],[审核]) VALUES(N'LLQ1','2026-03-10',N'车缝部',N'张三','1')");
        c.Execute("INSERT INTO [领料单]([单号],[日期],[领料部门],[领料人],[审核]) VALUES(N'LLQ2','2026-03-20',N'车缝部',N'张三','0')");
        c.Execute(@"INSERT INTO [领料明细单]([单号],[日期],[生产单号],[款号],[领料部门],[领料人],[物料类别],[物料编号],[物料名称],[规格],[颜色],[单位],[数量],[类型],[备注])
                    VALUES(N'LLQ1','2026-03-10',N'SC1',N'K1',N'车缝部',N'张三',N'布料',N'MLLQ',N'领料查询料',N'规格X',N'红',N'米',100,N'生产物料',N'红备注'),
                          (N'LLQ1','2026-03-10',N'SC1',N'K1',N'车缝部',N'张三',N'布料',N'MLLQ',N'领料查询料',N'规格X',N'蓝',N'米',50,N'生产物料',N'')");
        c.Execute(@"INSERT INTO [领料明细单]([单号],[日期],[生产单号],[款号],[领料部门],[领料人],[物料类别],[物料编号],[物料名称],[规格],[颜色],[单位],[数量],[类型])
                    VALUES(N'LLQ2','2026-03-20',N'SC2',N'K1',N'车缝部',N'张三',N'布料',N'MLLQ',N'领料查询料',N'规格X',N'红',N'米',30,N'生产物料')");
    }

    private static void Cleanup(SqlConnection c)
    {
        c.Execute("DELETE FROM [领料明细单] WHERE [单号] IN (N'LLQ1',N'LLQ2')");
        c.Execute("DELETE FROM [领料单] WHERE [单号] IN (N'LLQ1',N'LLQ2')");
        c.Execute("DELETE FROM [物料资料] WHERE [物料编号]=N'MLLQ'");
    }

    [SkippableFact]
    public async Task Detail_returns_lines_with_dept_person_type()
    {
        using var c = fx.Open();
        Seed(c);
        try
        {
            var rows = await Svc().IssueQueryDetailAsync(null, null, "领料查询料", null, null);
            Assert.Equal(3, rows.Count);
            var 红1 = rows.First(r => r.单号 == "LLQ1" && r.颜色 == "红");
            Assert.Equal("生产物料", 红1.类型);
            Assert.Equal("车缝部", 红1.领料部门);
            Assert.Equal("张三", 红1.领料人);
            Assert.Equal("SC1", 红1.生产单号);
            Assert.Equal(100m, 红1.数量);
            Assert.Equal("红备注", 红1.备注);
            Assert.Equal("1", 红1.审核);
        }
        finally { Cleanup(c); }
    }

    [SkippableFact]
    public async Task Summary_groups_and_labels_领用数量()
    {
        using var c = fx.Open();
        Seed(c);
        try
        {
            var rows = await Svc().IssueQuerySummaryAsync(null, null, "领料查询料", null, null);
            Assert.Equal(2, rows.Count);
            Assert.Equal(130m, rows.Single(r => r.颜色 == "红").领用数量);  // 100+30(跨已/未审核)
            Assert.Equal(50m, rows.Single(r => r.颜色 == "蓝").领用数量);
        }
        finally { Cleanup(c); }
    }

    [SkippableFact]
    public async Task Filters_by_approval_keyword_date()
    {
        using var c = fx.Open();
        Seed(c);
        try
        {
            // 带种子关键词,避免把库里真实领料单算进来
            Assert.Equal(2, (await Svc().IssueQueryDetailAsync(null, null, "领料查询料", null, "已审核")).Count);
            Assert.Single(await Svc().IssueQueryDetailAsync(null, null, "领料查询料", null, "未审核"));
            // keyword 命中领料人 张三 → 3 行
            Assert.Equal(3, (await Svc().IssueQueryDetailAsync(null, null, "张三", null, null)).Count);
            // 日期 [03-10,03-15] 半开上界 03-16：只含 LLQ1 的 2 行
            Assert.Equal(2, (await Svc().IssueQueryDetailAsync(new DateTime(2026,3,10), new DateTime(2026,3,15), "领料查询料", null, null)).Count);
        }
        finally { Cleanup(c); }
    }
}
