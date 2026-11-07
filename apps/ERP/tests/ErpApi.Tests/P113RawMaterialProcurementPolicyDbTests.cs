using Dapper;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.Posting;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Plastics;
using ErpApi.Features.Plastics.PlasticRawMaterialDemand;
using ErpApi.Features.Plastics.PlasticRawMaterialPurchaseOrder;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Xunit;

[Collection("db")]
public sealed class P113RawMaterialProcurementPolicyDbTests(DbFixture fx)
{
    [Fact]
    public async Task Saved_molding_snapshot_is_visible_before_approval_but_only_approved_demand_can_drive_purchase()
    {
        using var c = fx.Open(); using var s = new Fixture(c, fx.ConnectionString!);
        s.Source(28, approved: false);
        var preview = await RawMaterialProcurementPolicy.ReadMoldingSourceAsync(c, null, s.Sp);
        Assert.True(preview!.单头.快照有效); Assert.False(preview.单头.可采购);
        Assert.Equal(28m, Assert.Single(preview.明细).需求数量KG);
        Assert.Equal(0, (await s.Analysis()).需求数量KG);
        c.Execute("UPDATE [塑胶采购订单] SET [审核]=N'1' WHERE [单号]=@Sp; UPDATE [塑胶原料资料] SET [每包重量]=99 WHERE [物料编号]=@Raw", s);
        var approved = await RawMaterialProcurementPolicy.ReadMoldingSourceAsync(c, null, s.Sp, true);
        Assert.Equal(28m, Assert.Single(approved!.明细).需求数量KG);
        Assert.Equal(25m, Assert.Single(approved.明细).每库存单位KG);
        Assert.Equal(28m, (await s.Analysis()).需求数量KG);
    }

    [Fact]
    public async Task Twenty_eight_kg_gap_with_twenty_five_kg_bags_allows_three_bags_but_not_four_or_another_order()
    {
        using var c = fx.Open(); using var s = new Fixture(c, fx.ConnectionString!); s.Source(28);
        var initial = await s.Analysis();
        Assert.Equal(28m, initial.缺口数量KG); Assert.Equal(2m, initial.可购数量); Assert.Equal(3m, initial.可购上限);
        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => s.Service.CreateAsync(s.Body(4), s.User));
        Assert.Contains("最多采购 3包", error.Message); Assert.Equal(0, s.Purchases());
        var number = await s.Service.CreateAsync(s.Body(3), s.User);
        Assert.Equal(1, s.Purchases());
        Assert.Equal(1, (await s.Service.GetAsync(number))!.单头!.采购政策版本);
        var saved = Assert.Single((await s.Service.GetAsync(number))!.明细);
        Assert.Equal(25m, saved.每库存单位KG);
        Assert.Equal(75m, (await s.Analysis()).在途数量KG);
        Assert.Contains("已覆盖需求", (await Assert.ThrowsAsync<InvalidOperationException>(() => s.Service.CreateAsync(s.Body(1), s.User))).Message);
        Assert.Equal(1, s.Purchases());
    }

    [Fact]
    public async Task Duplicate_material_lines_are_checked_as_one_budget_and_failure_leaves_no_document()
    {
        using var c = fx.Open(); using var s = new Fixture(c, fx.ConnectionString!); s.Source(28);
        var body = s.Body(2); body.明细.Add(s.Body(2).明细[0]);
        await Assert.ThrowsAsync<InvalidOperationException>(() => s.Service.CreateAsync(body, s.User));
        Assert.Equal(0, s.Purchases());
        Assert.Equal(0, c.ExecuteScalar<int>("SELECT COUNT(*) FROM [原料采购订单明细] WHERE [原料编号]=@Raw", s));
    }

    [Fact]
    public async Task Concurrent_saved_orders_share_the_same_two_bag_allowance()
    {
        using var c = fx.Open(); using var s = new Fixture(c, fx.ConnectionString!); s.Source(28);
        async Task<bool> Buy()
        {
            try { await s.Service.CreateAsync(s.Body(3), s.User); return true; }
            catch (InvalidOperationException e) when (e.Message.Contains("已覆盖需求")) { return false; }
        }
        var result = await Task.WhenAll(Buy(), Buy());
        Assert.Single(result.Where(x => x)); Assert.Equal(1, s.Purchases());
        Assert.Equal(75m, (await s.Analysis()).在途数量KG);
    }

    [Fact]
    public async Task Explicit_common_material_can_replenish_without_molding_demand_and_without_assumed_bag_weight()
    {
        using var c = fx.Open(); using var s = new Fixture(c, fx.ConnectionString!, unit: "KG", bag: null, common: true);
        await s.Service.CreateAsync(s.Body(500), s.User);
        await s.Service.CreateAsync(s.Body(200), s.User);
        Assert.Equal(700m, (await s.Analysis()).在途数量KG); Assert.Null((await s.Analysis()).可购上限);
    }

    [Fact]
    public async Task Null_common_flag_is_not_common_and_missing_bag_weight_blocks_extra_bag_calculation()
    {
        using var c = fx.Open(); using var s = new Fixture(c, fx.ConnectionString!, unit: "KG", bag: null); s.Source(28);
        Assert.Null((await s.Analysis()).常用原料);
        Assert.Contains("每包重量", (await Assert.ThrowsAsync<InvalidOperationException>(() => s.Service.CreateAsync(s.Body(28), s.User))).Message);
        c.Execute("UPDATE [塑胶原料资料] SET [每包重量]=25 WHERE [物料编号]=@Raw", s);
        await s.Service.CreateAsync(s.Body(78), s.User);
        Assert.Equal(78m, (await s.Analysis()).在途数量KG);
    }

    [Fact]
    public async Task Receipts_are_deducted_once_per_order_material_and_closed_issued_demand_does_not_return()
    {
        using var c = fx.Open(); using var s = new Fixture(c, fx.ConnectionString!); s.Source(28);
        var body = s.Body(1); body.明细.Add(s.Body(2).明细[0]);
        var order = await s.Service.CreateAsync(body, s.User);
        s.Receipt(order, 1);
        Assert.Equal(50m, (await s.Analysis()).在途数量KG);
        Assert.Equal(25m, (await s.Analysis()).当前库存KG);
        s.Receipt(order, 2, "R2");
        s.Issue(1.12m);
        var after = await s.Analysis();
        Assert.Equal(28m, after.已领数量KG); Assert.Equal(0, after.待领数量KG);
        Assert.Equal(47m, after.当前库存KG); Assert.Equal(0, after.在途数量KG); Assert.Equal(0, after.可购数量);
        await Assert.ThrowsAsync<InvalidOperationException>(() => s.Service.CreateAsync(s.Body(1), s.User));
    }

    [Fact]
    public async Task Editing_excludes_its_own_hold_but_final_approval_rechecks_current_stock_and_demand()
    {
        using var c = fx.Open(); using var s = new Fixture(c, fx.ConnectionString!); s.Source(28);
        var order = await s.Service.CreateAsync(s.Body(2), s.User);
        Assert.True(await s.Service.UpdateAsync(order, s.Body(3), s.User));
        Assert.Equal(3, Assert.Single((await s.Service.GetAsync(order))!.明细).订货数量);
        c.Execute("UPDATE [塑胶采购订单] SET [审核]=N'0' WHERE [单号]=@Sp", s);
        using var tx = c.BeginTransaction();
        await RawMaterialProcurementPolicy.LockPurchaseAsync(c, tx, order);
        var e = await Assert.ThrowsAsync<InvalidOperationException>(() => RawMaterialProcurementPolicy.ValidateForApprovalAsync(c, tx, order));
        Assert.Contains("已覆盖需求", e.Message); tx.Rollback();
        Assert.Equal("0", (await s.Service.GetAsync(order))!.单头!.审核);
    }

    [Fact]
    public async Task Legacy_manual_demand_stays_queryable_but_does_not_add_to_automatic_demand_or_allow_new_manual_creation()
    {
        using var c = fx.Open(); using var s = new Fixture(c, fx.ConnectionString!); s.Source(28);
        var legacy = s.Prefix + "YLX";
        c.Execute("""
INSERT INTO [原料生产需求表]([单号],[啤机生产单号],[审核],[数量KG]) VALUES(@legacy,@Sp,N'1',1000);
INSERT INTO [原料生产需求明细单]([单号],[原料编号],[需求数量KG]) VALUES(@legacy,@Raw,1000)
""", new { legacy, s.Sp, s.Raw });
        var service = new PlasticRawMaterialDemandService(s.Factory, s.Numbers);
        Assert.Equal(1000m, Assert.Single((await service.GetAsync(legacy))!.明细).需求数量KG);
        Assert.Equal(28m, (await s.Analysis()).需求数量KG);
        Assert.Contains("自动生成", (await Assert.ThrowsAsync<InvalidOperationException>(() => service.CreateAsync(new() { 明细 = [new() { 原料编号 = s.Raw, 需求数量KG = 500 }] }, s.User))).Message);
        Assert.Equal(1, c.ExecuteScalar<int>("SELECT COUNT(*) FROM [原料生产需求表] WHERE [单号] LIKE @Like", s));
    }

    [Fact]
    public async Task Historical_null_policy_purchase_is_not_reinterpreted_during_approval()
    {
        using var c = fx.Open(); using var s = new Fixture(c, fx.ConnectionString!);
        var order = s.LegacyOrder(1000);
        using var tx = c.BeginTransaction();
        await RawMaterialProcurementPolicy.LockPurchaseAsync(c, tx, order);
        await RawMaterialProcurementPolicy.ValidateForApprovalAsync(c, tx, order);
        Assert.Null(await c.ExecuteScalarAsync<int?>("SELECT [采购政策版本] FROM [原料采购订单] WHERE [单号]=@order", new { order }, tx));
        tx.Rollback();
    }

    [Fact]
    public async Task Pending_receipt_prevents_deleting_the_purchase_and_reopening_its_budget()
    {
        using var c = fx.Open(); using var s = new Fixture(c, fx.ConnectionString!); s.Source(28);
        var order = await s.Service.CreateAsync(s.Body(3), s.User);
        s.Receipt(order, 1);
        c.Execute("UPDATE [原料入仓单] SET [审核]=N'0' WHERE [单号]=@receipt", new { receipt = s.Prefix + "R1" });
        Assert.Contains("入仓申请", (await Assert.ThrowsAsync<InvalidOperationException>(() => s.Service.DeleteAsync(order, s.User))).Message);
        Assert.Equal(1, s.Purchases()); Assert.Equal(75m, (await s.Analysis()).在途数量KG);
    }

    [Fact]
    public async Task Historical_bag_order_without_frozen_conversion_blocks_new_purchase_instead_of_using_current_master_weight()
    {
        using var c = fx.Open(); using var s = new Fixture(c, fx.ConnectionString!); s.Source(100); s.LegacyOrder(1);
        Assert.Contains("已保存采购缺少明确单位", (await s.Analysis()).采购限制原因);
        c.Execute("""
INSERT INTO [原料自动扣料期初]([原料编号],[期初数量],[库存单位],[每库存单位KG],[启用日期]) VALUES(@Raw,0,N'包',25,SYSDATETIME());
UPDATE [塑胶原料资料] SET [每包重量]=99 WHERE [物料编号]=@Raw
""", s);
        var analysis = await s.Analysis();
        Assert.Equal(25m, analysis.在途数量KG); Assert.Equal(75m, analysis.缺口数量KG); Assert.Equal(25m, analysis.每包重量);
    }

    [Fact]
    public async Task Filtering_keeps_the_same_complete_raw_material_budget()
    {
        using var c = fx.Open(); using var s = new Fixture(c, fx.ConnectionString!); s.Source(28);
        var all = await RawMaterialProcurementPolicy.ReadAnalysisAsync(c, null);
        var filtered = await RawMaterialProcurementPolicy.ReadAnalysisAsync(c, null, keyword: s.Raw, onlyBuy: true);
        var expected = Assert.Single(all.Where(x => x.原料编号 == s.Raw)); var actual = Assert.Single(filtered);
        Assert.Equal(expected.缺口数量KG, actual.缺口数量KG); Assert.Equal(expected.可购上限KG, actual.可购上限KG);
    }

    [Fact]
    public async Task Kilogram_recommendation_rounds_up_to_purchase_precision_after_eight_decimal_issue()
    {
        using var c = fx.Open(); using var s = new Fixture(c, fx.ConnectionString!, unit: "KG"); s.Source(28);
        c.Execute("INSERT INTO [原料自动扣料期初]([原料编号],[期初数量],[库存单位],[每库存单位KG],[启用日期]) VALUES(@Raw,0.00000001,N'KG',1,SYSDATETIME())", s);
        s.Issue(0.00000001m);
        var row = await s.Analysis();
        Assert.Equal(27.99999999m, row.待领数量KG);
        Assert.Equal(28m, row.可购数量); Assert.Equal(77.9999m, row.可购上限);
        await s.Service.CreateAsync(s.Body(row.可购数量!.Value), s.User);
        Assert.Equal(1, s.Purchases());
    }

    [Theory]
    [InlineData("create")]
    [InlineData("update")]
    [InlineData("delete")]
    public async Task Permission_revoked_after_precheck_is_rechecked_in_the_write_transaction(string action)
    {
        using var c = fx.Open(); using var s = new Fixture(c, fx.ConnectionString!, unit: "KG", common: true);
        var number = action == "create" ? null : await s.Service.CreateAsync(s.Body(1), s.User);
        var permission = action == "delete" ? PermissionAction.删除 : PermissionAction.保存;
        Assert.True(await new PermissionService(s.Factory).HasAsync(s.User, PlasticRawMaterialPurchaseOrderService.DocType, permission));
        c.Execute("UPDATE [userbqrpower] SET [保存]=0,[删除]=0 WHERE [用户]=@User", s);
        var auditCount = c.ExecuteScalar<int>("SELECT COUNT(*) FROM [c操作记录] WHERE [操作员]=@User", s);
        await Assert.ThrowsAsync<UnauthorizedAccessException>(async () =>
        {
            if (action == "create") await s.Service.CreateAsync(s.Body(2), s.User);
            else if (action == "update") await s.Service.UpdateAsync(number!, s.Body(2), s.User, canPrice: true);
            else await s.Service.DeleteAsync(number!, s.User);
        });
        Assert.Equal(number is null ? 0 : 1, s.Purchases());
        if (number is not null) Assert.Equal(1m, Assert.Single((await s.Service.GetAsync(number))!.明细).订货数量);
        Assert.Equal(auditCount, c.ExecuteScalar<int>("SELECT COUNT(*) FROM [c操作记录] WHERE [操作员]=@User", s));
    }

    [Fact]
    public async Task Revoked_price_permission_preserves_saved_price_even_when_caller_passes_stale_true()
    {
        using var c = fx.Open(); using var s = new Fixture(c, fx.ConnectionString!, unit: "KG", common: true);
        var original = s.Body(2); original.明细[0].单价 = 7;
        var number = await s.Service.CreateAsync(original, s.User);
        Assert.True(await new PermissionService(s.Factory).HasAsync(s.User, PlasticRawMaterialPurchaseOrderService.DocType, PermissionAction.单价));
        c.Execute("UPDATE [userbqrpower] SET [单价]=0 WHERE [用户]=@User", s);
        var changed = s.Body(3); changed.明细[0].单价 = 999;
        Assert.True(await s.Service.UpdateAsync(number, changed, s.User, canPrice: true));
        var saved = (await s.Service.GetAsync(number))!;
        Assert.Equal(7m, Assert.Single(saved.明细).单价); Assert.Equal(21m, saved.单头!.金额);
    }

    [Fact]
    public async Task New_purchase_with_a_price_requires_current_transaction_price_permission()
    {
        using var c = fx.Open(); using var s = new Fixture(c, fx.ConnectionString!, unit: "KG", common: true);
        c.Execute("UPDATE [userbqrpower] SET [单价]=0 WHERE [用户]=@User", s);
        var body = s.Body(2); body.明细[0].单价 = 999;
        Assert.Contains("单价权限", (await Assert.ThrowsAsync<UnauthorizedAccessException>(() => s.Service.CreateAsync(body, s.User))).Message);
        Assert.Equal(0, s.Purchases());
        await s.Service.CreateAsync(s.Body(2), s.User);
        Assert.Equal(1, s.Purchases());
    }

    [Fact]
    public async Task Permission_rows_stay_locked_until_the_business_transaction_commits()
    {
        using var c = fx.Open(); using var s = new Fixture(c, fx.ConnectionString!, unit: "KG", common: true);
        var audit = new PausedAudit(); var service = new PlasticRawMaterialPurchaseOrderService(s.Factory, s.Numbers, audit);
        var saving = service.CreateAsync(s.Body(2), s.User);
        try
        {
            await audit.Entered.Task.WaitAsync(TimeSpan.FromSeconds(10));
            using var revoke = s.Factory.Create(); await revoke.OpenAsync();
            var error = await Assert.ThrowsAsync<SqlException>(() => revoke.ExecuteAsync(
                "SET LOCK_TIMEOUT 500; UPDATE [userbqrpower] SET [保存]=0 WHERE [用户]=@User", s));
            Assert.Equal(1222, error.Number);
        }
        finally
        {
            audit.Continue.TrySetResult();
            await saving.WaitAsync(TimeSpan.FromSeconds(10));
        }
        Assert.Equal(1, s.Purchases());
        c.Execute("UPDATE [userbqrpower] SET [保存]=0 WHERE [用户]=@User", s);
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => service.CreateAsync(s.Body(2), s.User));
        Assert.Equal(1, s.Purchases());
    }

    private sealed class PausedAudit : IAuditLogger
    {
        public TaskCompletionSource Entered { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource Continue { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public async Task WriteAsync(string table, string action, string user, string detail, SqlConnection c, SqlTransaction? tx = null)
        {
            Entered.TrySetResult(); await Continue.Task.WaitAsync(TimeSpan.FromSeconds(15));
            await new AuditLogger().WriteAsync(table, action, user, detail, c, tx);
        }
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Final_approval_and_unapproval_recheck_revoked_manual_permissions(bool undo)
    {
        using var c = fx.Open(); using var s = new Fixture(c, fx.ConnectionString!, unit: "KG", common: true);
        var number = await s.Service.CreateAsync(s.Body(2), s.User);
        c.Execute("UPDATE [原料采购订单] SET [主管审核]=N'1',[经理审核]=N'1' WHERE [单号]=@number", new { number });
        var posting = new PostingEngine(s.Factory, new AuditLogger());
        if (undo) Assert.True(await posting.ApproveAsync(PlasticRawMaterialPurchaseOrderService.DocType, number, s.User));
        var action = undo ? PermissionAction.反审核 : PermissionAction.审核;
        Assert.True(await new PermissionService(s.Factory).HasAsync(s.User, PlasticRawMaterialPurchaseOrderService.DocType, action));
        c.Execute("UPDATE [userbqrpower] SET [审核]=0,[反审核]=0 WHERE [用户]=@User", s);
        var before = c.ExecuteScalar<string>("SELECT * FROM [原料采购订单] WHERE [单号]=@number FOR JSON PATH,INCLUDE_NULL_VALUES", new { number });
        var audits = c.ExecuteScalar<int>("SELECT COUNT(*) FROM [c操作记录] WHERE [操作员]=@User", s);
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() => undo
            ? posting.UnapproveAsync(PlasticRawMaterialPurchaseOrderService.DocType, number, s.User)
            : posting.ApproveAsync(PlasticRawMaterialPurchaseOrderService.DocType, number, s.User));
        Assert.Equal(before, c.ExecuteScalar<string>("SELECT * FROM [原料采购订单] WHERE [单号]=@number FOR JSON PATH,INCLUDE_NULL_VALUES", new { number }));
        Assert.Equal(audits, c.ExecuteScalar<int>("SELECT COUNT(*) FROM [c操作记录] WHERE [操作员]=@User", s));
        c.Execute("UPDATE [userbqrpower] SET [审核]=1,[反审核]=1 WHERE [用户]=@User", s);
        Assert.True(undo ? await posting.UnapproveAsync(PlasticRawMaterialPurchaseOrderService.DocType, number, s.User)
            : await posting.ApproveAsync(PlasticRawMaterialPurchaseOrderService.DocType, number, s.User));
        Assert.Equal(undo ? "0" : "1", (await s.Service.GetAsync(number))!.单头!.审核);
    }

    private sealed class ConnectionFactory(string connectionString) : ISqlConnectionFactory
    {
        public SqlConnection Create() => new(connectionString);
        public string GetConnectionString() => connectionString;
    }

    private sealed class Numbers(string prefix) : IDocumentNumberGenerator
    {
        private int serial;
        public Task<string> NextAsync(string type, string ignored, DateTime date, SqlConnection c, SqlTransaction tx)
            => Task.FromResult(prefix + Interlocked.Increment(ref serial));
    }

    private sealed class Fixture : IDisposable
    {
        private readonly SqlConnection c;
        private readonly string unit;
        private readonly decimal factor;
        public string Prefix { get; } = "P113R" + Guid.NewGuid().ToString("N")[..10];
        public string Like => Prefix + "%";
        public string User => Prefix[..10];
        public string Raw => Prefix + "RAW";
        public string Sp => Prefix + "SP";
        public ISqlConnectionFactory Factory { get; }
        public IDocumentNumberGenerator Numbers { get; }
        public PlasticRawMaterialPurchaseOrderService Service { get; }
        public Fixture(SqlConnection c, string connectionString, string unit = "包", decimal? bag = 25m, bool? common = null)
        {
            this.c = c; this.unit = unit; factor = unit == "KG" ? 1 : bag ?? 25;
            Factory = new ConnectionFactory(connectionString); Numbers = new Numbers(Prefix + "PO");
            Service = new(Factory, Numbers);
            c.Execute("INSERT INTO [塑胶原料资料]([物料编号],[物料名称],[单位],[每包重量],[库存],[常用原料]) VALUES(@Raw,@Raw,@unit,@bag,0,@common)", new { Raw, unit, bag, common });
            c.Execute("""
INSERT INTO [sysfileuser]([用户],[密码],[登录状态],[登录失败次数]) VALUES(@User,N'test-only-not-login',N'',0);
INSERT INTO [userbqrpower]([用户],[名称],[菜单],[打开],[保存],[删除],[单价],[金额],[审核],[反审核]) VALUES(@User,@User,N'原料采购订单',1,1,1,1,1,1,1)
""", this);
        }
        public void Source(decimal kg, bool approved = true)
        {
            c.Execute("""
INSERT INTO [塑胶采购订单]([单号],[日期],[审核],[加工类型],[原料扣减版本],[原料扣减方式]) VALUES(@Sp,GETDATE(),@approval,N'一次加工',1,N'领料出库');
INSERT INTO [塑胶采购订单明细]([单号],[物料编号],[数量],[原料用量KG],[原料扣减组分数]) VALUES(@Sp,@Raw,1,@kg,1);
DECLARE @line bigint=SCOPE_IDENTITY();
INSERT INTO [塑胶采购原料用量]([采购单号],[采购明细ID],[原料ID],[原料编号],[原料名称],[比例],[总比例],[用量KG],[库存数量],[库存单位],[每库存单位KG])
SELECT @Sp,@line,[ID],@Raw,@Raw,1,1,@kg,@kg/@factor,@unit,@factor FROM [塑胶原料资料] WHERE [物料编号]=@Raw;
""", new { Sp, Raw, kg, approval = approved ? "1" : "0", unit, factor });
        }
        public PlasticRawMaterialPurchaseOrderCreateDto Body(decimal quantity) => new()
        {
            供应商名称 = Prefix, 备注 = Prefix,
            明细 = [new() { 原料编号 = Raw, 原料名称 = Raw, 单位 = unit, 订货数量 = quantity }]
        };
        public async Task<ErpApi.Features.Plastics.PlasticRawMaterialMaster.PlasticRawMaterialPurchaseRow> Analysis()
            => Assert.Single(await RawMaterialProcurementPolicy.ReadAnalysisAsync(c, null, keyword: Raw));
        public int Purchases() => c.ExecuteScalar<int>("SELECT COUNT(*) FROM [原料采购订单] WHERE [单号] LIKE @Like", this);
        public void Receipt(string order, decimal quantity, string suffix = "R1")
            => c.Execute("""
INSERT INTO [原料入仓单]([单号],[订单单号],[日期],[审核]) VALUES(@number,@order,GETDATE(),N'1');
INSERT INTO [原料入仓明细单]([单号],[原料编号],[单位],[每包重量],[数量]) VALUES(@number,@Raw,@unit,@factor,@quantity)
""", new { number = Prefix + suffix, order, Raw, unit, factor, quantity });
        public void Issue(decimal quantity)
            => c.Execute("""
INSERT INTO [原料出库单]([单号],[日期],[审核]) VALUES(@number,GETDATE(),N'1');
INSERT INTO [原料出库明细单]([单号],[原料编号],[单位],[每包重量],[数量],[来源啤机采购单号],[啤机生产单号],[啤机外发单号])
VALUES(@number,@Raw,@unit,@factor,@quantity,@Sp,@Sp,@Sp)
""", new { number = Prefix + "ISS", Raw, unit, factor, quantity, Sp });
        public string LegacyOrder(decimal quantity)
        {
            var number = Prefix + "OLD";
            c.Execute("""
INSERT INTO [原料采购订单]([单号],[订购日期],[审核]) VALUES(@number,GETDATE(),N'0');
INSERT INTO [原料采购订单明细]([单号],[原料编号],[单位],[订货数量]) VALUES(@number,@Raw,@unit,@quantity)
""", new { number, Raw, unit, quantity });
            return number;
        }
        public void Dispose()
        {
            foreach (var table in new[] { "原料出库明细单", "原料出库单", "原料入仓明细单", "原料入仓单", "原料采购订单明细", "原料采购订单", "原料生产需求明细单", "原料生产需求表" })
                c.Execute($"DELETE FROM [{table}] WHERE [单号] LIKE @Like", this);
            c.Execute("""
DELETE FROM [塑胶采购原料用量] WHERE [采购单号]=@Sp;
DELETE FROM [塑胶采购订单明细] WHERE [单号]=@Sp;
DELETE FROM [塑胶采购订单] WHERE [单号]=@Sp;
DELETE FROM [原料自动扣料期初] WHERE [原料编号]=@Raw;
DELETE FROM [塑胶原料资料] WHERE [物料编号]=@Raw;
DELETE FROM [c操作记录] WHERE [操作员]=@User;
DELETE FROM [userbqrpower] WHERE [用户]=@User;
DELETE FROM [sysfileuser] WHERE [用户]=@User;
""", this);
            Assert.Equal(0, c.ExecuteScalar<int>("SELECT (SELECT COUNT(*) FROM [塑胶采购订单] WHERE [单号]=@Sp)+(SELECT COUNT(*) FROM [原料采购订单] WHERE [单号] LIKE @Like)+(SELECT COUNT(*) FROM [塑胶原料资料] WHERE [物料编号]=@Raw)", this));
        }
    }
}
