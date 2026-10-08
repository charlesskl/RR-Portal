using Dapper;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Plastics.LabelOrders;
using ErpApi.Features.Warehouse.Semi.Labels;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

[Collection("db")]
public sealed class PlasticLabelOrderServiceDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    private PlasticLabelOrderService Svc(IAuditLogger? audit = null)
        => new(Factory(), new DocumentNumberGenerator(), audit ?? new RecordingAuditLogger());

    private static PlasticLabelOrderSaveDto ValidDto() => new()
    {
        日期 = new DateTime(2026, 7, 14),
        备注一 = "initial",
        备注二 = "second",
        明细 =
        [
            new() { 物料编号 = "PLB-MAT-1", 物料名称 = "物料一", 规格 = "S1", 颜色 = "红", 单位 = "个", 数量 = 7, 标签数 = 3 },
            new() { 物料编号 = "PLB-MAT-2", 物料名称 = "物料二", 规格 = "S2", 颜色 = "蓝", 单位 = "箱", 数量 = 4, 标签数 = 4 }
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
SELECT CASE WHEN OBJECT_ID(N'[塑胶标签单]', N'U') IS NOT NULL
                  AND OBJECT_ID(N'[塑胶标签明细]', N'U') IS NOT NULL
                  AND OBJECT_ID(N'[单号流水表]', N'U') IS NOT NULL
             THEN 1 ELSE 0 END") == 1;
        if (!available)
        {
            c.Dispose();
            Skip.If(true, "ERP_TEST_DB 未应用塑胶标签单迁移(53号脚本)");
        }
        return c;
    }

    private static void SkipIfMaterialSchemaUnavailable(SqlConnection c)
    {
        var available = c.ExecuteScalar<int>(
            "SELECT CASE WHEN OBJECT_ID(N'[塑胶物料资料]', N'U') IS NOT NULL THEN 1 ELSE 0 END") == 1;
        Skip.IfNot(available, "ERP_TEST_DB 未应用塑胶物料资料迁移");
    }

    private static void CleanupCore(SqlConnection c)
    {
        c.Execute("DELETE FROM [塑胶标签单] WHERE [电脑单号] LIKE N'PLB%'");
        c.Execute("DELETE FROM [单号流水表] WHERE [单据类型]=N'塑胶标签单' AND [业务日期]='20260714'");
    }

    private static void CleanupMaterials(SqlConnection c)
    {
        c.Execute("DELETE FROM [塑胶物料资料] WHERE [物料编号] IN (N'PLB-MAT-1',N'PLB-MAT-2',N'PLB-MAT-3')");
    }

    private static void SeedMaterials(SqlConnection c)
    {
        c.Execute(@"
INSERT INTO [塑胶物料资料]([物料编号],[物料名称],[规格],[颜色],[单位],[单价]) VALUES
    (N'PLB-MAT-1',N'物料一',N'S1',N'红',N'个',12.5),
    (N'PLB-MAT-2',N'物料二',N'S2',N'蓝',N'箱',8.5),
    (N'PLB-MAT-3',N'物料三',N'S3',N'绿',N'卷',NULL);");
    }

    [Fact]
    public async Task Create_rejects_null_line_before_opening_database()
    {
        var dto = ValidDto();
        dto.明细 = [null!];
        var service = new PlasticLabelOrderService(
            new NeverOpenConnectionFactory(), new DocumentNumberGenerator(), new RecordingAuditLogger());

        var ex = await Assert.ThrowsAsync<ArgumentException>(() => service.CreateAsync(dto, "tester"));

        Assert.Contains("明细", ex.Message);
    }

    [Theory]
    [InlineData("备注一", 501)]
    [InlineData("备注二", 501)]
    [InlineData("物料编号", 81)]
    [InlineData("物料名称", 241)]
    [InlineData("规格", 241)]
    [InlineData("颜色", 81)]
    [InlineData("单位", 41)]
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
            case "物料编号": dto.明细[0]!.物料编号 = value; break;
            case "物料名称": dto.明细[0]!.物料名称 = value; break;
            case "规格": dto.明细[0]!.规格 = value; break;
            case "颜色": dto.明细[0]!.颜色 = value; break;
            case "单位": dto.明细[0]!.单位 = value; break;
            case "明细备注": dto.明细[0]!.备注 = value; break;
        }
        var service = new PlasticLabelOrderService(
            new NeverOpenConnectionFactory(), new DocumentNumberGenerator(), new RecordingAuditLogger());

        var ex = await Assert.ThrowsAsync<ArgumentException>(() => service.CreateAsync(dto, "tester"));

        Assert.Contains(field == "明细备注" ? "备注" : field, ex.Message);
    }

    [Theory]
    [InlineData("100000000000000")]
    [InlineData("0.00001")]
    [InlineData("-1")]
    public async Task Create_rejects_quantity_outside_decimal_18_4_before_opening_database(string rawValue)
    {
        var dto = ValidDto();
        dto.明细[0]!.数量 = decimal.Parse(rawValue, System.Globalization.CultureInfo.InvariantCulture);
        var service = new PlasticLabelOrderService(
            new NeverOpenConnectionFactory(), new DocumentNumberGenerator(), new RecordingAuditLogger());

        var ex = await Assert.ThrowsAsync<ArgumentException>(() => service.CreateAsync(dto, "tester"));

        Assert.Contains("数量", ex.Message);
    }

    [Fact]
    public async Task Create_rejects_operator_longer_than_database_column_before_opening_database()
    {
        var service = new PlasticLabelOrderService(
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
            Assert.StartsWith("PLB", saved.电脑单号);
            Assert.Equal(2, saved.明细.Count);
            Assert.Equal(3, saved.明细[0].标签数);

            var update = ValidDto();
            update.备注一 = "updated";
            update.明细[0]!.标签数 = 9;
            var updated = await Svc().UpdateAsync(saved.电脑单号, update, "tester");
            Assert.Equal("updated", updated.备注一);
            Assert.Equal(9, updated.明细[0].标签数);
            Assert.True(await Svc().DeleteAsync(saved.电脑单号, "tester"));
            Assert.False(await Svc().DeleteAsync("PLB-MISSING", "tester"));
        }
        finally { CleanupCore(c); }
    }

    [SkippableFact]
    public async Task Create_validates_lines()
    {
        using var c = OpenCoreSchemaOrSkip(fx);
        CleanupCore(c);
        try
        {
            var empty = ValidDto(); empty.明细 = [];
            await Assert.ThrowsAsync<ArgumentException>(() => Svc().CreateAsync(empty, "tester"));

            var duplicate = ValidDto(); duplicate.明细[1]!.物料编号 = duplicate.明细[0]!.物料编号;
            await Assert.ThrowsAsync<ArgumentException>(() => Svc().CreateAsync(duplicate, "tester"));

            var negative = ValidDto(); negative.明细[0]!.数量 = -1;
            await Assert.ThrowsAsync<ArgumentException>(() => Svc().CreateAsync(negative, "tester"));

            var badLabels = ValidDto(); badLabels.明细[0]!.标签数 = -1;
            await Assert.ThrowsAsync<ArgumentException>(() => Svc().CreateAsync(badLabels, "tester"));

            var missingCode = ValidDto(); missingCode.明细[0]!.物料编号 = " ";
            await Assert.ThrowsAsync<ArgumentException>(() => Svc().CreateAsync(missingCode, "tester"));
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
            var invalid = new PlasticLabelOrderSaveDto { 日期 = default, 明细 = [null] };
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
    public async Task Materials_support_exact_and_fuzzy_filters_pagination_and_price_redaction()
    {
        using var c = OpenCoreSchemaOrSkip(fx);
        SkipIfMaterialSchemaUnavailable(c);
        CleanupCore(c);
        CleanupMaterials(c);
        SeedMaterials(c);
        try
        {
            var exact = await Svc().MaterialsAsync(new() { Field = "物料编号", Keyword = "PLB-MAT-1", Exact = true, Page = 1, Size = 20 }, true);
            Assert.Single(exact.Items);
            Assert.Equal("物料一", exact.Items.Single().物料名称);
            Assert.Equal(12.5m, exact.Items.Single().单价);

            var fuzzy = await Svc().MaterialsAsync(new() { Field = "物料名称", Keyword = "物料", Page = 2, Size = 1 }, false);
            Assert.True(fuzzy.Total >= 3);
            Assert.Single(fuzzy.Items);
            Assert.Null(fuzzy.Items.Single().单价);
        }
        finally { CleanupMaterials(c); CleanupCore(c); }
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
            Assert.Equal(0, c.ExecuteScalar<int>("SELECT COUNT(*) FROM [塑胶标签单] WHERE [电脑单号] LIKE N'PLB%'"));

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

    [SkippableFact]
    public async Task LabelQuery_detail_and_summary_filter_and_aggregate()
    {
        using var c = OpenCoreSchemaOrSkip(fx);
        SkipIfMaterialSchemaUnavailable(c);
        CleanupCore(c);
        CleanupMaterials(c);
        c.Execute(@"
INSERT INTO [塑胶物料资料]([物料编号],[物料名称],[物料类别],[规格],[颜色],[单位]) VALUES
    (N'PLB-MAT-1',N'物料一',N'ABS',N'S1',N'红',N'个'),
    (N'PLB-MAT-2',N'物料二',N'PC',N'S2',N'蓝',N'箱');");
        try
        {
            var first = await Svc().CreateAsync(ValidDto(), "tester");
            var later = ValidDto();
            later.日期 = later.日期.AddDays(1);
            later.明细 =
            [
                new() { 物料编号 = "PLB-MAT-1", 物料名称 = "物料一", 规格 = "S1", 颜色 = "红", 单位 = "个", 数量 = 3, 标签数 = 2 }
            ];
            var second = await Svc().CreateAsync(later, "tester");
            Assert.True(await Svc().SetAuditAsync(second.电脑单号, true, "auditor"));

            // 明细：每行一条标签明细,含 电脑单号/标签数/单头审核,按日期倒序。
            var all = await Svc().LabelQueryDetailAsync(null, null, null, null, null);
            Assert.Equal(3, all.Count);
            Assert.Equal(second.电脑单号, all[0].电脑单号);
            Assert.Equal("1", all[0].审核);
            Assert.Equal(2, all[0].标签数);
            Assert.Equal("ABS", all[0].物料类别);
            Assert.Contains(all, r => r.电脑单号 == first.电脑单号 && r.审核 == "0");

            // 审核情况过滤。
            var audited = await Svc().LabelQueryDetailAsync(null, null, null, null, "已审核");
            Assert.Single(audited);
            Assert.Equal(second.电脑单号, audited[0].电脑单号);
            Assert.Equal(2, (await Svc().LabelQueryDetailAsync(null, null, null, null, "未审核")).Count);

            // 物料类别(取塑胶物料资料)过滤。
            var byCat = await Svc().LabelQueryDetailAsync(null, null, null, "PC", null);
            Assert.Single(byCat);
            Assert.Equal("PLB-MAT-2", byCat[0].物料编号);

            // keyword 命中电脑单号；日期区间含端点。
            Assert.Single(await Svc().LabelQueryDetailAsync(null, null, second.电脑单号, null, null));
            Assert.Single(await Svc().LabelQueryDetailAsync(
                new DateTime(2026, 7, 15), new DateTime(2026, 7, 15), null, null, null));

            // 汇总：按 物料编号+规格+颜色 合并 数量与标签数。
            var summary = await Svc().LabelQuerySummaryAsync(null, null, null, null, null);
            Assert.Equal(2, summary.Count);
            var m1 = summary.Single(r => r.物料编号 == "PLB-MAT-1");
            Assert.Equal(10m, m1.数量);
            Assert.Equal(5, m1.标签数);
            Assert.Equal("ABS", m1.物料类别);
            var summaryAudited = await Svc().LabelQuerySummaryAsync(null, null, null, null, "已审核");
            Assert.Single(summaryAudited);
            Assert.Equal(3m, summaryAudited[0].数量);
            Assert.Equal(2, summaryAudited[0].标签数);
        }
        finally { CleanupMaterials(c); CleanupCore(c); }
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
