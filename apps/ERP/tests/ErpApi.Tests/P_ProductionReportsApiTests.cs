using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Dapper;
using ErpApi.Infrastructure.Security;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public class P_ProductionReportsApiTests(DbFixture fx)
{
    private static IConfiguration JwtCfg() => new ConfigurationBuilder().AddInMemoryCollection(
        new Dictionary<string, string?>
        { ["Erp:Jwt:Issuer"] = "ErpApi", ["Erp:Jwt:Audience"] = "ErpClient", ["Erp:Jwt:ExpireMinutes"] = "60" }).Build();

    private WebApplicationFactory<Program> Factory()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        Environment.SetEnvironmentVariable("ERP_DB", fx.ConnectionString);
        Environment.SetEnvironmentVariable("ERP_JWT_KEY", "test-key-please-change-0123456789abcdef");
        return new WebApplicationFactory<Program>();
    }
    private static string Token(string user) => new JwtTokenService(JwtCfg()).Issue(user);

    private void SeedPerms(string user, bool open)
    {
        using var c = new SqlConnection(fx.ConnectionString);
        c.Open();
        c.Execute("DELETE FROM [userbqrpower] WHERE [用户]=@user AND [菜单]=N'生产制单'", new { user });
        c.Execute(@"INSERT INTO [userbqrpower]([用户],[菜单],[打开],[保存],[删除],[金额],[审核],[反审核])
                    VALUES(@user,N'生产制单',@open,0,0,0,0,0)", new { user, open });
    }
    private void CleanupPerms(params string[] users)
    {
        using var c = new SqlConnection(fx.ConnectionString); c.Open();
        foreach (var u in users)
            c.Execute("DELETE FROM [userbqrpower] WHERE [用户]=@u AND [菜单]=N'生产制单'", new { u });
    }
    private HttpClient Client(WebApplicationFactory<Program> app, string user)
    {
        var client = app.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token(user));
        return client;
    }

    [SkippableFact]
    public async Task Reports_forbidden_without_open()
    {
        using var app = Factory();
        var client = Client(app, "prodrpt_no");
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/api/production-reports/bom-materials")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/api/production-reports/bom-styles")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/api/production-reports/order-summary")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/api/production-reports/tracking")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/api/production-reports/purchase-over")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/api/production-reports/issue-over")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/api/production-reports/purchase-analysis")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/api/production-reports/order-material-usage?生产单号=X")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/api/production-reports/purchase-issue-analysis")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/api/production-reports/order-worksheet")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/api/production-reports/finished-leftover")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/api/production-reports/contract-leftover")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/api/production-reports/process-shortage")).StatusCode);
    }

    [SkippableFact]
    public async Task Reports_ok_with_open()
    {
        using var app = Factory();
        SeedPerms("prodrpt_ok", open: true);
        try
        {
            var client = Client(app, "prodrpt_ok");
            Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/production-reports/bom-materials")).StatusCode);
            Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/production-reports/bom-styles")).StatusCode);
            Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/production-reports/order-summary")).StatusCode);
            Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/production-reports/tracking")).StatusCode);
            Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/production-reports/tracking?keyword=x&审核=1&完成=否")).StatusCode);
            Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/production-reports/purchase-over")).StatusCode);
            Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/production-reports/issue-over")).StatusCode);
            Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/production-reports/purchase-analysis")).StatusCode);
            Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/production-reports/purchase-analysis?keyword=x")).StatusCode);
            Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/production-reports/order-worksheet")).StatusCode);
            Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/production-reports/order-worksheet?keyword=x")).StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync("/api/production-reports/order-material-usage")).StatusCode);
            Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/production-reports/order-material-usage?生产单号=X")).StatusCode);
            Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/production-reports/purchase-issue-analysis")).StatusCode);
            Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/production-reports/purchase-issue-analysis?起=2026-01-01&止=2026-12-31&keyword=x")).StatusCode);
            Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/production-reports/finished-leftover")).StatusCode);
            Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/production-reports/finished-leftover?keyword=x")).StatusCode);
            Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/production-reports/contract-leftover")).StatusCode);
            Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/production-reports/contract-leftover?keyword=x")).StatusCode);
            Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/production-reports/process-shortage")).StatusCode);
            Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/production-reports/process-shortage?keyword=x")).StatusCode);
        }
        finally { CleanupPerms("prodrpt_ok"); }
    }

    // 数据形状：issue-over 行含 差异(已领−需求，负=欠领)；purchase-issue-analysis 行含 需求/采购/已领/差异
    [SkippableFact]
    public async Task IssueOver_and_PurchaseIssueAnalysis_shape()
    {
        using var app = Factory();
        SeedPerms("prodrpt_shape", open: true);
        try
        {
            var client = Client(app, "prodrpt_shape");

            var issueOver = await client.GetFromJsonAsync<List<Dictionary<string, System.Text.Json.JsonElement>>>(
                "/api/production-reports/issue-over?keyword=");
            Assert.NotNull(issueOver);
            if (issueOver!.Count > 0)
            {
                var r = issueOver[0];
                Assert.True(r.ContainsKey("生产单号"));
                Assert.True(r.ContainsKey("物料编号"));
                Assert.True(r.ContainsKey("需求数量"));
                Assert.True(r.ContainsKey("已领数量"));
                Assert.True(r.ContainsKey("差异"));
            }

            var usage = await client.GetFromJsonAsync<List<Dictionary<string, System.Text.Json.JsonElement>>>(
                "/api/production-reports/order-material-usage?生产单号=X");
            Assert.NotNull(usage);

            var pia = await client.GetFromJsonAsync<List<Dictionary<string, System.Text.Json.JsonElement>>>(
                "/api/production-reports/purchase-issue-analysis");
            Assert.NotNull(pia);
            if (pia!.Count > 0)
            {
                var r = pia[0];
                Assert.True(r.ContainsKey("生产单号"));
                Assert.True(r.ContainsKey("物料编号"));
                Assert.True(r.ContainsKey("需求数量"));
                Assert.True(r.ContainsKey("采购数量"));
                Assert.True(r.ContainsKey("已领数量"));
                Assert.True(r.ContainsKey("库存数量"));
                Assert.True(r.ContainsKey("差异"));
            }
        }
        finally { CleanupPerms("prodrpt_shape"); }
    }

    // 数据形状：finished-leftover 行含 款号/入仓数量/出仓数量/余数；contract-leftover 行含 合同号/物料编号/需求/采购/余料数量；
    // process-shortage 行含 生产单号/物料编号/需求/库存/已领/缺料数量（缺料=需求−库存−已领，仅缺料行）
    [SkippableFact]
    public async Task Leftover_and_ProcessShortage_shape()
    {
        using var app = Factory();
        SeedPerms("prodrpt_shape2", open: true);
        try
        {
            var client = Client(app, "prodrpt_shape2");

            var fl = await client.GetFromJsonAsync<List<Dictionary<string, System.Text.Json.JsonElement>>>(
                "/api/production-reports/finished-leftover");
            Assert.NotNull(fl);
            if (fl!.Count > 0)
            {
                var r = fl[0];
                Assert.True(r.ContainsKey("款号"));
                Assert.True(r.ContainsKey("客户"));
                Assert.True(r.ContainsKey("名称"));
                Assert.True(r.ContainsKey("入仓数量"));
                Assert.True(r.ContainsKey("出仓数量"));
                Assert.True(r.ContainsKey("余数"));
            }

            var cl = await client.GetFromJsonAsync<List<Dictionary<string, System.Text.Json.JsonElement>>>(
                "/api/production-reports/contract-leftover");
            Assert.NotNull(cl);
            if (cl!.Count > 0)
            {
                var r = cl[0];
                Assert.True(r.ContainsKey("合同号"));
                Assert.True(r.ContainsKey("物料编号"));
                Assert.True(r.ContainsKey("需求数量"));
                Assert.True(r.ContainsKey("采购数量"));
                Assert.True(r.ContainsKey("余料数量"));
            }

            var ps = await client.GetFromJsonAsync<List<Dictionary<string, System.Text.Json.JsonElement>>>(
                "/api/production-reports/process-shortage");
            Assert.NotNull(ps);
            if (ps!.Count > 0)
            {
                var r = ps[0];
                Assert.True(r.ContainsKey("生产单号"));
                Assert.True(r.ContainsKey("物料编号"));
                Assert.True(r.ContainsKey("需求数量"));
                Assert.True(r.ContainsKey("库存数量"));
                Assert.True(r.ContainsKey("已领数量"));
                Assert.True(r.ContainsKey("缺料数量"));
            }
        }
        finally { CleanupPerms("prodrpt_shape2"); }
    }
}
