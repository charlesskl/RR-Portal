using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using Dapper;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.MasterData;
using ErpApi.Features.Warehouse.Semi.Labels;
using ErpApi.Infrastructure.Db;
using ErpApi.Infrastructure.Security;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public sealed class SemiFinishedLabelOrderControllerTests(DbFixture fx)
{
    private static SemiFinishedLabelOrderController Controller(
        TestPermissionService permissions, ISemiFinishedLabelOrderService? service = null)
    {
        var controller = new SemiFinishedLabelOrderController(service ?? new TestLabelOrderService(), permissions);
        controller.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity(
                    [new Claim(ClaimTypes.NameIdentifier, "controller-tester")], "test"))
            }
        };
        return controller;
    }

    private static SemiFinishedLabelOrderSaveDto ValidDto() => new()
    {
        日期 = new DateTime(2026, 7, 14),
        明细 = [new() { 配件编号 = "SBL-CTRL-PART", 产品货号 = "SBL-CTRL-STYLE", 数量 = 3, 每箱数量 = 2 }]
    };

    private static IConfiguration JwtCfg() => new ConfigurationBuilder().AddInMemoryCollection(
        new Dictionary<string, string?>
        {
            ["Erp:Jwt:Issuer"] = "ErpApi",
            ["Erp:Jwt:Audience"] = "ErpClient",
            ["Erp:Jwt:ExpireMinutes"] = "60"
        }).Build();

    private static string Token(string user) => new JwtTokenService(JwtCfg()).Issue(user);

    private WebApplicationFactory<Program> Factory()
    {
        Environment.SetEnvironmentVariable("ERP_DB", fx.ConnectionString);
        Environment.SetEnvironmentVariable("ERP_JWT_KEY", "test-key-please-change-0123456789abcdef");
        return new WebApplicationFactory<Program>();
    }

    private static HttpClient Client(WebApplicationFactory<Program> app, string user)
    {
        var client = app.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token(user));
        return client;
    }

    private static SqlConnection OpenApiSchemaOrSkip(DbFixture fx)
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB，跳过控制器集成测试");
        var c = new SqlConnection(fx.ConnectionString);
        try { c.Open(); }
        catch (SqlException ex)
        {
            c.Dispose();
            Skip.If(true, $"ERP_TEST_DB 无法连接: {ex.Message}");
        }
        var available = c.ExecuteScalar<int>(@"
SELECT CASE WHEN OBJECT_ID(N'[半成品标签单]', N'U') IS NOT NULL
                  AND OBJECT_ID(N'[半成品标签明细]', N'U') IS NOT NULL
                  AND OBJECT_ID(N'[单号流水表]', N'U') IS NOT NULL
                  AND OBJECT_ID(N'[userbqrpower]', N'U') IS NOT NULL
                  AND OBJECT_ID(N'[c操作记录]', N'U') IS NOT NULL
             THEN 1 ELSE 0 END") == 1;
        if (!available)
        {
            c.Dispose();
            Skip.If(true, "ERP_TEST_DB 缺少标签单 API 生产路径所需核心表");
        }
        return c;
    }

    private static void CleanupApi(SqlConnection c, string user)
    {
        c.Execute("DELETE FROM [半成品标签单] WHERE [电脑单号] LIKE N'SBL%'");
        c.Execute("DELETE FROM [单号流水表] WHERE [单据类型]=N'半成品标签单' AND [业务日期]='20260714'");
        c.Execute("DELETE FROM [userbqrpower] WHERE [用户]=@user AND [菜单]=N'半成品标签单'", new { user });
        c.Execute("DELETE FROM [c操作记录] WHERE [表名]=N'半成品标签单' AND [操作员]=@user", new { user });
    }

    private static void SeedFullPermissions(SqlConnection c, string user)
    {
        c.Execute("DELETE FROM [userbqrpower] WHERE [用户]=@user AND [菜单]=N'半成品标签单'", new { user });
        c.Execute(@"INSERT INTO [userbqrpower]
([用户],[菜单],[打开],[保存],[删除],[打印],[单价],[金额],[审核],[反审核],[功能])
VALUES(@user,N'半成品标签单',1,1,1,0,1,0,1,1,0)", new { user });
    }

    [Fact]
    public async Task Open_permission_is_required_before_service_access()
    {
        var service = new TestLabelOrderService();

        var result = await Controller(new(), service).List();

        Assert.IsType<ForbidResult>(result);
        Assert.False(service.ListCalled);
    }

    [Fact]
    public async Task Invalid_save_payload_maps_to_bad_request()
    {
        var service = new TestLabelOrderService { CreateException = new ArgumentException("明细行不能为空。") };

        var result = await Controller(TestPermissionService.Allow(PermissionAction.保存), service)
            .Create(new SemiFinishedLabelOrderSaveDto { 日期 = DateTime.Today, 明细 = [null] });

        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Fact]
    public async Task Audited_order_conflict_maps_to_409_even_with_invalid_payload()
    {
        var service = new TestLabelOrderService
        {
            UpdateException = new InvalidOperationException("已审核的半成品标签单不能保存，请先反审核。")
        };

        var result = await Controller(TestPermissionService.Allow(PermissionAction.保存), service)
            .Update("SBL20260714001", new SemiFinishedLabelOrderSaveDto { 明细 = [null] });

        Assert.IsType<ConflictObjectResult>(result);
    }

    [Fact]
    public async Task Delete_passes_current_user_to_transactional_service()
    {
        var service = new TestLabelOrderService { DeleteResult = true };

        var result = await Controller(TestPermissionService.Allow(PermissionAction.删除), service)
            .Delete("SBL20260714001");

        Assert.IsType<NoContentResult>(result);
        Assert.Equal("controller-tester", service.LastDeleteUser);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task Products_uses_price_permission_to_control_redaction(bool canSeePrice)
    {
        var productSource = new FixedProductSource();
        var service = new SemiFinishedLabelOrderService(
            new NeverOpenConnectionFactory(),
            new DocumentNumberGenerator(),
            new NoOpAuditLogger(),
            productSource);
        var permissions = canSeePrice
            ? TestPermissionService.Allow(PermissionAction.打开, PermissionAction.单价)
            : TestPermissionService.Allow(PermissionAction.打开);

        var result = Assert.IsType<OkObjectResult>(await Controller(permissions, service)
            .Products(new SemiFinishedLabelProductQuery { Field = "产品货号", Keyword = "SBL-STYLE-1", Exact = true }));
        var page = Assert.IsType<PagedResult<SemiFinishedLabelProductRow>>(result.Value);
        var item = Assert.Single(page.Items);

        Assert.True(productSource.Called);
        Assert.Equal(canSeePrice ? 25.5m : null, item.加工单价);
        Assert.Equal(canSeePrice ? 12.5m : null, item.库存单价);
    }

    [SkippableFact]
    public async Task Production_http_contract_covers_bad_request_create_not_found_and_conflict()
    {
        const string user = "sbl-api-contract";
        using var c = OpenApiSchemaOrSkip(fx);
        CleanupApi(c, user);
        SeedFullPermissions(c, user);
        using var app = Factory();
        var client = Client(app, user);
        try
        {
            var empty = await client.PostAsJsonAsync("/api/semi-finished-label-orders",
                new SemiFinishedLabelOrderSaveDto { 日期 = new DateTime(2026, 7, 14), 明细 = [] });
            Assert.Equal(HttpStatusCode.BadRequest, empty.StatusCode);

            var create = await client.PostAsJsonAsync("/api/semi-finished-label-orders", ValidDto());
            Assert.Equal(HttpStatusCode.Created, create.StatusCode);
            var body = await create.Content.ReadFromJsonAsync<JsonElement>();
            var documentNo = body.GetProperty("电脑单号").GetString()!;
            Assert.Equal($"/api/semi-finished-label-orders/{documentNo}", create.Headers.Location?.AbsolutePath);

            Assert.Equal(HttpStatusCode.NotFound,
                (await client.GetAsync("/api/semi-finished-label-orders/SBL-MISSING")).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound,
                (await client.PutAsJsonAsync("/api/semi-finished-label-orders/SBL-MISSING", ValidDto())).StatusCode);

            Assert.Equal(HttpStatusCode.NoContent,
                (await client.PostAsync($"/api/semi-finished-label-orders/{documentNo}/audit", null)).StatusCode);
            Assert.Equal(HttpStatusCode.Conflict,
                (await client.PostAsync($"/api/semi-finished-label-orders/{documentNo}/audit", null)).StatusCode);
            Assert.Equal(HttpStatusCode.Conflict,
                (await client.PutAsJsonAsync($"/api/semi-finished-label-orders/{documentNo}", ValidDto())).StatusCode);
        }
        finally { CleanupApi(c, user); }
    }

    [SkippableFact]
    public async Task Production_http_contract_rejects_fractional_integer_label_count_with_400()
    {
        const string user = "sbl-api-integer";
        using var c = OpenApiSchemaOrSkip(fx);
        CleanupApi(c, user);
        SeedFullPermissions(c, user);
        using var app = Factory();
        var client = Client(app, user);
        try
        {
            var json = """
                {"日期":"2026-07-14","明细":[{"配件编号":"SBL-CTRL-PART","产品货号":"SBL-CTRL-STYLE","数量":3,"每箱数量":2,"实需标签数":1.5,"实需标签数已手改":true}]}
                """;

            var response = await client.PostAsync("/api/semi-finished-label-orders",
                new StringContent(json, Encoding.UTF8, "application/json"));

            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        }
        finally { CleanupApi(c, user); }
    }

    private sealed class TestPermissionService : IPermissionService
    {
        private readonly HashSet<PermissionAction> allowed = [];

        public static TestPermissionService Allow(params PermissionAction[] actions)
        {
            var service = new TestPermissionService();
            service.allowed.UnionWith(actions);
            return service;
        }

        public Task<bool> HasAsync(string userName, string menu, PermissionAction action)
            => Task.FromResult(allowed.Contains(action));

        public Task<IReadOnlyDictionary<string, PermissionFlags>> GetByUserAsync(string userName)
            => Task.FromResult<IReadOnlyDictionary<string, PermissionFlags>>(new Dictionary<string, PermissionFlags>());
    }

    private sealed class TestLabelOrderService : ISemiFinishedLabelOrderService
    {
        public bool ListCalled { get; private set; }
        public Exception? CreateException { get; init; }
        public Exception? UpdateException { get; init; }
        public bool DeleteResult { get; init; }
        public string? LastDeleteUser { get; private set; }

        public Task<SemiFinishedLabelOrderDto> CreateAsync(SemiFinishedLabelOrderSaveDto dto, string user)
            => CreateException is null
                ? Task.FromResult(new SemiFinishedLabelOrderDto { 电脑单号 = "SBL20260714001" })
                : Task.FromException<SemiFinishedLabelOrderDto>(CreateException);

        public Task<SemiFinishedLabelOrderDto> UpdateAsync(string documentNo, SemiFinishedLabelOrderSaveDto dto, string user)
            => UpdateException is null
                ? Task.FromResult(new SemiFinishedLabelOrderDto { 电脑单号 = documentNo })
                : Task.FromException<SemiFinishedLabelOrderDto>(UpdateException);

        public Task<SemiFinishedLabelOrderDto?> GetAsync(string documentNo) => Task.FromResult<SemiFinishedLabelOrderDto?>(null);

        public Task<PagedResult<SemiFinishedLabelOrderListRow>> ListAsync(int page, int size, string? keyword)
        {
            ListCalled = true;
            return Task.FromResult(new PagedResult<SemiFinishedLabelOrderListRow>([], 0));
        }

        public Task<bool> DeleteAsync(string documentNo, string user)
        {
            LastDeleteUser = user;
            return Task.FromResult(DeleteResult);
        }
        public Task<bool> SetAuditAsync(string documentNo, bool audited, string user) => Task.FromResult(false);
        public Task<SemiFinishedLabelOrderDto?> GetAdjacentAsync(string documentNo, AdjacentDirection direction)
            => Task.FromResult<SemiFinishedLabelOrderDto?>(null);

        public Task<PagedResult<SemiFinishedLabelProductRow>> ProductsAsync(
            SemiFinishedLabelProductQuery query, bool canSeePrice)
            => throw new Xunit.Sdk.XunitException("Products 权限测试必须调用真实 SemiFinishedLabelOrderService。");
    }

    private sealed class FixedProductSource : ISemiFinishedLabelProductSource
    {
        public bool Called { get; private set; }

        public Task<PagedResult<SemiFinishedLabelProductRow>> QueryAsync(SemiFinishedLabelProductQuery query)
        {
            Called = true;
            var item = new SemiFinishedLabelProductRow
            {
                产品货号 = "SBL-STYLE-1",
                配件编号 = "SBL-PART-1",
                加工单价 = 25.5m,
                库存单价 = 12.5m
            };
            return Task.FromResult(new PagedResult<SemiFinishedLabelProductRow>([item], 1));
        }
    }

    private sealed class NeverOpenConnectionFactory : ISqlConnectionFactory
    {
        public string GetConnectionString() => throw new Xunit.Sdk.XunitException("Products 测试不应打开数据库连接。");
        public SqlConnection Create() => throw new Xunit.Sdk.XunitException("Products 测试不应打开数据库连接。");
    }

    private sealed class NoOpAuditLogger : IAuditLogger
    {
        public Task WriteAsync(string tableName, string action, string user, string record,
            SqlConnection conn, SqlTransaction? tx = null) => Task.CompletedTask;
    }
}
