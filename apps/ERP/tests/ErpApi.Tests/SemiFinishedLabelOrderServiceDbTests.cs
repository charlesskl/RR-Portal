using Dapper;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Warehouse.Semi.Labels;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public sealed class SemiFinishedLabelOrderServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    private SemiFinishedLabelOrderService Svc(IAuditLogger? audit = null)
        => new(Factory(), new DocumentNumberGenerator(), audit ?? new RecordingAuditLogger());

    private static SemiFinishedLabelOrderSaveDto ValidDto() => new()
    {
        日期 = new DateTime(2026, 7, 14),
        备注一 = "initial",
        备注二 = "second",
        明细 =
        [
            new() { 配件编号 = "SBL-PART-1", 客户 = "客户一", 产品货号 = "SBL-STYLE-1", 产品名称 = "产品一", 产品装配名称 = "装配一", 数量 = 7, 每箱数量 = 3 },
            new() { 配件编号 = "SBL-PART-2", 客户 = "客户二", 产品货号 = "SBL-STYLE-2", 产品名称 = "产品二", 产品装配名称 = "装配二", 数量 = 4, 每箱数量 = 4 }
        ]
    };

    private static SqlConnection OpenCoreSchemaOrSkip(DbFixture fx)
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB，跳过数据库集成测试");
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
             THEN 1 ELSE 0 END") == 1;
        if (!available)
        {
            c.Dispose();
            Skip.If(true, "ERP_TEST_DB 未应用半成品标签单迁移");
        }
        return c;
    }

    private static void SkipIfProductSchemaUnavailable(SqlConnection c)
    {
        var available = c.ExecuteScalar<int>(@"
SELECT CASE WHEN OBJECT_ID(N'[半成品共用物料设置]', N'U') IS NOT NULL
                  AND OBJECT_ID(N'[装配物料报价]', N'U') IS NOT NULL
                  AND OBJECT_ID(N'[款号物料总表]', N'U') IS NOT NULL
                  AND OBJECT_ID(N'[款号物料明细表]', N'U') IS NOT NULL
                  AND OBJECT_ID(N'[款号总表]', N'U') IS NOT NULL
             THEN 1 ELSE 0 END") == 1;
        Skip.IfNot(available, "ERP_TEST_DB 未应用产品资料、共用物料设置及装配报价迁移");
    }

    private static void CleanupCore(SqlConnection c)
    {
        c.Execute("DELETE FROM [半成品标签单] WHERE [电脑单号] LIKE N'SBL%'");
        c.Execute("DELETE FROM [单号流水表] WHERE [单据类型]=N'半成品标签单' AND [业务日期]='20260714'");
    }

    private static void CleanupProducts(SqlConnection c)
    {
        c.Execute("DELETE FROM [装配物料报价] WHERE [产品货号] IN (N'SBL-STYLE-1',N'SBL-STYLE-2',N'SBL-STYLE-3')");
        c.Execute("DELETE FROM [半成品共用物料设置] WHERE [产品货号] IN (N'SBL-STYLE-1',N'SBL-STYLE-2',N'SBL-STYLE-3')");
        c.Execute("DELETE FROM [款号物料总表] WHERE [款号] IN (N'SBL-STYLE-1',N'SBL-STYLE-2',N'SBL-STYLE-3')");
        c.Execute("DELETE FROM [款号物料明细表] WHERE [款号] IN (N'SBL-STYLE-1',N'SBL-STYLE-2',N'SBL-STYLE-3')");
        c.Execute("DELETE FROM [款号总表] WHERE [款号] IN (N'SBL-STYLE-1',N'SBL-STYLE-2',N'SBL-STYLE-3')");
    }

    private static void SeedProducts(SqlConnection c)
    {
        c.Execute(@"
INSERT INTO [款号总表]([款号],[款式]) VALUES
    (N'SBL-STYLE-1',N'产品一'), (N'SBL-STYLE-2',N'产品二'), (N'SBL-STYLE-3',N'产品三');
INSERT INTO [款号物料总表]([日期],[客户名称],[产品编号],[款号],[款式],[大箱盒数],[备注]) VALUES
    ('2026-07-14',N'客户一',N'SBL-PART-1',N'SBL-STYLE-1',N'产品一',3,N'旧记录'),
    ('2026-07-15',N'客户一',N'SBL-PART-1',N'SBL-STYLE-1',N'产品一（最新）',4,N'最新记录'),
    ('2026-07-15',N'客户二',N'SBL-PART-2',N'SBL-STYLE-2',N'产品二',8,N'第二产品'),
    ('2026-07-15',N'客户三',N'SBL-PART-3',N'SBL-STYLE-3',N'产品三',NULL,N'无箱数');
INSERT INTO [半成品共用物料设置]([产品货号],[产品装配名称],[配件编号],[共用物料编号],[库存单价HK],[调整审核]) VALUES
    (N'SBL-STYLE-1',N'装配一',N'SBL-PART-1',N'COMMON-SBL-1',12.5,1),
    (N'SBL-STYLE-2',N'装配二',N'SBL-PART-2',N'COMMON-SBL-2',8.5,1);
INSERT INTO [装配物料报价]([产品货号],[合作方类型],[单价],[是否默认],[顺序]) VALUES
    (N'SBL-STYLE-1',N'加工厂',9.5,0,0),
    (N'SBL-STYLE-1',N'加工厂',25.5,1,10),
    (N'SBL-STYLE-2',N'加工厂',18.5,1,0);");
    }

    [Fact]
    public async Task Create_rejects_null_line_before_opening_database()
    {
        var dto = ValidDto();
        dto.明细 = [null!];
        var service = new SemiFinishedLabelOrderService(
            new NeverOpenConnectionFactory(), new DocumentNumberGenerator(), new RecordingAuditLogger());

        var ex = await Assert.ThrowsAsync<ArgumentException>(() => service.CreateAsync(dto, "tester"));

        Assert.Contains("明细", ex.Message);
    }

    [Theory]
    [InlineData("备注一", 501)]
    [InlineData("备注二", 501)]
    [InlineData("配件编号", 81)]
    [InlineData("客户", 161)]
    [InlineData("产品货号", 121)]
    [InlineData("产品名称", 241)]
    [InlineData("产品装配名称", 241)]
    [InlineData("明细备注", 501)]
    public async Task Create_rejects_text_longer_than_database_column_before_opening_database(
        string field, int length)
    {
        var dto = ValidDto();
        var value = new string('X', length);
        switch (field)
        {
            case "备注一": dto.备注一 = value; break;
            case "备注二": dto.备注二 = value; break;
            case "配件编号": dto.明细[0]!.配件编号 = value; break;
            case "客户": dto.明细[0]!.客户 = value; break;
            case "产品货号": dto.明细[0]!.产品货号 = value; break;
            case "产品名称": dto.明细[0]!.产品名称 = value; break;
            case "产品装配名称": dto.明细[0]!.产品装配名称 = value; break;
            case "明细备注": dto.明细[0]!.备注 = value; break;
        }
        var service = new SemiFinishedLabelOrderService(
            new NeverOpenConnectionFactory(), new DocumentNumberGenerator(), new RecordingAuditLogger());

        var ex = await Assert.ThrowsAsync<ArgumentException>(() => service.CreateAsync(dto, "tester"));

        Assert.Contains(field == "明细备注" ? "备注" : field, ex.Message);
    }

    [Theory]
    [InlineData("数量", "100000000000000")]
    [InlineData("数量", "0.00001")]
    [InlineData("每箱数量", "100000000000000")]
    [InlineData("每箱数量", "0.00001")]
    public async Task Create_rejects_decimal_outside_decimal_18_4_before_opening_database(
        string field, string rawValue)
    {
        var dto = ValidDto();
        var value = decimal.Parse(rawValue, System.Globalization.CultureInfo.InvariantCulture);
        if (field == "数量") dto.明细[0]!.数量 = value;
        else dto.明细[0]!.每箱数量 = value;
        var service = new SemiFinishedLabelOrderService(
            new NeverOpenConnectionFactory(), new DocumentNumberGenerator(), new RecordingAuditLogger());

        var ex = await Assert.ThrowsAsync<ArgumentException>(() => service.CreateAsync(dto, "tester"));

        Assert.Contains(field, ex.Message);
    }

    [Fact]
    public async Task Create_rejects_operator_longer_than_database_column_before_opening_database()
    {
        var service = new SemiFinishedLabelOrderService(
            new NeverOpenConnectionFactory(), new DocumentNumberGenerator(), new RecordingAuditLogger());

        var ex = await Assert.ThrowsAsync<ArgumentException>(() =>
            service.CreateAsync(ValidDto(), new string('U', 81)));

        Assert.Contains("操作员", ex.Message);
    }

    [SkippableFact]
    public async Task Save_load_update_and_delete_unapproved_order()
    {
        using var c = OpenCoreSchemaOrSkip(fx);
        CleanupCore(c);
        try
        {
            var saved = await Svc().CreateAsync(ValidDto(), "tester");
            Assert.StartsWith("SBL", saved.电脑单号);
            Assert.Equal(2, saved.明细.Count);
            Assert.Equal(3, saved.明细[0].预计标签数);
            Assert.Equal(3, saved.明细[0].实需标签数);

            var update = ValidDto();
            update.备注一 = "updated";
            update.明细[0]!.实需标签数 = 9;
            update.明细[0]!.实需标签数已手改 = true;
            var updated = await Svc().UpdateAsync(saved.电脑单号, update, "tester");
            Assert.Equal("updated", updated.备注一);
            Assert.Equal(9, updated.明细[0].实需标签数);
            Assert.True(await Svc().DeleteAsync(saved.电脑单号, "tester"));
            Assert.False(await Svc().DeleteAsync("SBL-MISSING", "tester"));
        }
        finally { CleanupCore(c); }
    }

    [SkippableFact]
    public async Task Create_validates_lines_and_normalizes_expected_label_counts()
    {
        using var c = OpenCoreSchemaOrSkip(fx);
        CleanupCore(c);
        try
        {
            var empty = ValidDto(); empty.明细 = [];
            await Assert.ThrowsAsync<ArgumentException>(() => Svc().CreateAsync(empty, "tester"));

            var duplicate = ValidDto(); duplicate.明细[1]!.配件编号 = duplicate.明细[0]!.配件编号;
            await Assert.ThrowsAsync<ArgumentException>(() => Svc().CreateAsync(duplicate, "tester"));

            var negative = ValidDto(); negative.明细[0]!.数量 = -1;
            await Assert.ThrowsAsync<ArgumentException>(() => Svc().CreateAsync(negative, "tester"));

            var badExpected = ValidDto(); badExpected.明细[0]!.预计标签数 = 99;
            await Assert.ThrowsAsync<ArgumentException>(() => Svc().CreateAsync(badExpected, "tester"));

            var badActual = ValidDto(); badActual.明细[0]!.实需标签数 = -1; badActual.明细[0]!.实需标签数已手改 = true;
            await Assert.ThrowsAsync<ArgumentException>(() => Svc().CreateAsync(badActual, "tester"));

            var noBox = ValidDto();
            noBox.明细 = [new() { 配件编号 = "SBL-PART-3", 产品货号 = "SBL-STYLE-3", 数量 = 8, 每箱数量 = 0, 预计标签数 = 0 }];
            var saved = await Svc().CreateAsync(noBox, "tester");
            Assert.Equal(0, saved.明细.Single().预计标签数);
            Assert.Equal(0, saved.明细.Single().实需标签数);
        }
        finally { CleanupCore(c); }
    }

    [SkippableFact]
    public async Task Audit_locks_order_until_reverse_audit_and_adjacent_uses_date_then_id()
    {
        using var c = OpenCoreSchemaOrSkip(fx);
        CleanupCore(c);
        try
        {
            var first = await Svc().CreateAsync(ValidDto(), "tester");
            var later = ValidDto(); later.日期 = later.日期.AddDays(1);
            var second = await Svc().CreateAsync(later, "tester");

            Assert.Equal(second.电脑单号, (await Svc().GetAdjacentAsync(first.电脑单号, AdjacentDirection.Next))!.电脑单号);
            Assert.Equal(first.电脑单号, (await Svc().GetAdjacentAsync(second.电脑单号, AdjacentDirection.Previous))!.电脑单号);
            Assert.Null(await Svc().GetAdjacentAsync(first.电脑单号, AdjacentDirection.Previous));

            Assert.True(await Svc().SetAuditAsync(first.电脑单号, true, "auditor"));
            var invalid = new SemiFinishedLabelOrderSaveDto { 日期 = default, 明细 = [null] };
            await Assert.ThrowsAsync<InvalidOperationException>(() => Svc().UpdateAsync(first.电脑单号, invalid, "tester"));
            await Assert.ThrowsAsync<InvalidOperationException>(() => Svc().UpdateAsync(first.电脑单号, ValidDto(), "tester"));
            await Assert.ThrowsAsync<InvalidOperationException>(() => Svc().DeleteAsync(first.电脑单号, "tester"));
            await Assert.ThrowsAsync<InvalidOperationException>(() => Svc().SetAuditAsync(first.电脑单号, true, "auditor"));
            Assert.True(await Svc().SetAuditAsync(first.电脑单号, false, "auditor"));
            Assert.True(await Svc().DeleteAsync(first.电脑单号, "tester"));
        }
        finally { CleanupCore(c); }
    }

    [SkippableFact]
    public async Task Concurrent_audit_requests_are_serialized_by_the_header_lock()
    {
        using var c = OpenCoreSchemaOrSkip(fx);
        CleanupCore(c);
        try
        {
            var saved = await Svc().CreateAsync(ValidDto(), "tester");
            var start = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);

            async Task<string> AuditOnceAsync(string user)
            {
                await start.Task;
                try
                {
                    return await Svc().SetAuditAsync(saved.电脑单号, true, user) ? "audited" : "missing";
                }
                catch (InvalidOperationException)
                {
                    return "conflict";
                }
            }

            var attempts = new[] { AuditOnceAsync("auditor-1"), AuditOnceAsync("auditor-2") };
            start.SetResult();
            var outcomes = await Task.WhenAll(attempts);

            Assert.Single(outcomes, value => value == "audited");
            Assert.Single(outcomes, value => value == "conflict");
            Assert.Equal("1", (await Svc().GetAsync(saved.电脑单号))!.审核);
        }
        finally { CleanupCore(c); }
    }

    [SkippableFact]
    public async Task Products_support_exact_and_fuzzy_filters_pagination_and_price_redaction()
    {
        using var c = OpenCoreSchemaOrSkip(fx);
        SkipIfProductSchemaUnavailable(c);
        CleanupCore(c);
        CleanupProducts(c);
        SeedProducts(c);
        try
        {
            var exact = await Svc().ProductsAsync(new() { Field = "产品货号", Keyword = "SBL-STYLE-1", Exact = true, Page = 1, Size = 20 }, true);
            Assert.Single(exact.Items);
            Assert.Equal("产品一（最新）", exact.Items.Single().产品名称);
            Assert.Equal(4m, exact.Items.Single().每箱数量);
            Assert.Equal(25.5m, exact.Items.Single().加工单价);
            Assert.Equal(12.5m, exact.Items.Single().库存单价);

            var fuzzy = await Svc().ProductsAsync(new() { Field = "客户", Keyword = "客户", Page = 2, Size = 1 }, false);
            Assert.Equal(3, fuzzy.Total);
            Assert.Single(fuzzy.Items);
            Assert.Null(fuzzy.Items.Single().库存单价);
            Assert.Null(fuzzy.Items.Single().加工单价);
        }
        finally { CleanupProducts(c); CleanupCore(c); }
    }

    [SkippableFact]
    public async Task Audit_failure_rolls_back_every_business_write()
    {
        using var c = OpenCoreSchemaOrSkip(fx);
        CleanupCore(c);
        try
        {
            await Assert.ThrowsAsync<InvalidOperationException>(() =>
                Svc(new ThrowingAuditLogger()).CreateAsync(ValidDto(), "tester"));
            Assert.Equal(0, c.ExecuteScalar<int>("SELECT COUNT(*) FROM [半成品标签单] WHERE [电脑单号] LIKE N'SBL%'"));

            var saved = await Svc().CreateAsync(ValidDto(), "tester");
            var changed = ValidDto();
            changed.备注一 = "must rollback";
            await Assert.ThrowsAsync<InvalidOperationException>(() =>
                Svc(new ThrowingAuditLogger()).UpdateAsync(saved.电脑单号, changed, "tester"));
            Assert.Equal("initial", (await Svc().GetAsync(saved.电脑单号))!.备注一);

            await Assert.ThrowsAsync<InvalidOperationException>(() =>
                Svc(new ThrowingAuditLogger()).DeleteAsync(saved.电脑单号, "tester"));
            Assert.NotNull(await Svc().GetAsync(saved.电脑单号));

            await Assert.ThrowsAsync<InvalidOperationException>(() =>
                Svc(new ThrowingAuditLogger()).SetAuditAsync(saved.电脑单号, true, "auditor"));
            Assert.Equal("0", (await Svc().GetAsync(saved.电脑单号))!.审核);

            Assert.True(await Svc().SetAuditAsync(saved.电脑单号, true, "auditor"));
            await Assert.ThrowsAsync<InvalidOperationException>(() =>
                Svc(new ThrowingAuditLogger()).SetAuditAsync(saved.电脑单号, false, "auditor"));
            Assert.Equal("1", (await Svc().GetAsync(saved.电脑单号))!.审核);
        }
        finally { CleanupCore(c); }
    }

    [SkippableFact]
    public async Task Audit_receives_the_business_connection_and_transaction()
    {
        using var c = OpenCoreSchemaOrSkip(fx);
        CleanupCore(c);
        try
        {
            var audit = new RecordingAuditLogger();

            await Svc(audit).CreateAsync(ValidDto(), "tester");

            Assert.NotNull(audit.Connection);
            Assert.NotNull(audit.Transaction);
            Assert.True(audit.TransactionUsedBusinessConnection);
        }
        finally { CleanupCore(c); }
    }

    private sealed class NeverOpenConnectionFactory : ISqlConnectionFactory
    {
        public string GetConnectionString() => throw new Xunit.Sdk.XunitException("参数校验不应读取数据库连接字符串。");
        public SqlConnection Create() => throw new Xunit.Sdk.XunitException("参数校验不应创建数据库连接。");
    }

    private sealed class RecordingAuditLogger : IAuditLogger
    {
        public SqlConnection? Connection { get; private set; }
        public SqlTransaction? Transaction { get; private set; }
        public bool TransactionUsedBusinessConnection { get; private set; }

        public Task WriteAsync(string tableName, string action, string user, string record,
            SqlConnection conn, SqlTransaction? tx = null)
        {
            Connection = conn;
            Transaction = tx;
            TransactionUsedBusinessConnection = ReferenceEquals(conn, tx?.Connection);
            return Task.CompletedTask;
        }
    }

    private sealed class ThrowingAuditLogger : IAuditLogger
    {
        public Task WriteAsync(string tableName, string action, string user, string record,
            SqlConnection conn, SqlTransaction? tx = null)
            => throw new InvalidOperationException("audit failed");
    }
}
