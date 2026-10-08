using Dapper;
using ErpApi.Features.Scheduling;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

// 排期导入/查询/批次的 DB 集成测试(需 ERP_TEST_DB 指向已建库;未设置自动跳过)
[Collection("db")]
public class SchedulingServiceDbTests(DbFixture fx)
{
    private const string Cust = "测试客户SCH";

    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    private SchedulingService Svc() => new(Factory());

    private static ScheduleImportRequest Req(params ScheduleImportRow[] rows)
        => new() { 排期客户 = Cust, 文件名 = "测试排期.xlsx", Rows = rows.ToList() };

    private static ScheduleImportRow Row(string po, string 货号, string 状态 = "在排", string 走货期 = "2026-03-01")
        => new() { 行号 = 2, 状态 = 状态, 来源工作表 = "总排期", PO号 = po, 货号 = 货号, 数量 = 100m, 走货期 = 走货期 };

    private static void Cleanup(SqlConnection c)
    {
        c.Execute(@"DELETE FROM [生产排期状态变更] WHERE [排期ID] IN
            (SELECT [ID] FROM [生产排期] WHERE [排期客户]=@Cust)", new { Cust });
        c.Execute("DELETE FROM [生产排期] WHERE [排期客户]=@Cust", new { Cust });
        c.Execute("DELETE FROM [生产排期批次] WHERE [排期客户]=@Cust", new { Cust });
    }

    [SkippableFact]
    public async Task Import_inserts_and_reimport_updates_by_natural_key()
    {
        using var c = fx.Open();
        Cleanup(c);
        try
        {
            var first = await Svc().ImportAsync(Req(Row("SCH-PO-1", "SCH-H-1")), "ut");
            Assert.Equal(1, first.新增);
            Assert.Equal(0, first.更新);

            // 重复导入同一行(状态改为已走货) → 不重复新增,按自然键更新
            var second = await Svc().ImportAsync(Req(Row("SCH-PO-1", "SCH-H-1", "已走货", "2026-04-02")), "ut");
            Assert.Equal(0, second.新增);
            Assert.Equal(1, second.更新);

            var list = await Svc().ListAsync(1, 20, "SCH-PO-1", Cust, null, null, null);
            var row = Assert.Single(list.Items);
            Assert.Equal("已走货", row.状态);
            Assert.Equal("2026-04-02", row.走货期?.ToString("yyyy-MM-dd"));
        }
        finally { Cleanup(c); }
    }

    [SkippableFact]
    public async Task List_keyword_does_not_match_原始数据()
    {
        using var c = fx.Open();
        Cleanup(c);
        try
        {
            await Svc().ImportAsync(Req(
                Row("SCH-PO-K1", "SCH-KW-92125"),
                Row("SCH-PO-K2", "SCH-KW-OTHER")), "ut");
            // 他货号行的 Excel 原文备注里含本货号(如 Amazon UK(.../92125D/...)):搜货号不应带出该行
            c.Execute(@"UPDATE [生产排期] SET [原始数据]=N'{""备注"":""UK(SCH-KW-92125D)""}'
                WHERE [排期客户]=@Cust AND [货号]=N'SCH-KW-OTHER'", new { Cust });

            var list = await Svc().ListAsync(1, 20, "SCH-KW-92125", Cust, null, null, null);
            var row = Assert.Single(list.Items);
            Assert.Equal("SCH-KW-92125", row.货号);
        }
        finally { Cleanup(c); }
    }

    [SkippableFact]
    public async Task List_filters_and_delete_batch_cascades()
    {
        using var c = fx.Open();
        Cleanup(c);
        try
        {
            var res = await Svc().ImportAsync(Req(Row("SCH-PO-2", "SCH-H-2"), Row("SCH-PO-3", "SCH-H-3", "已取消")), "ut");
            Assert.Equal(2, res.新增);

            var cancelled = await Svc().ListAsync(1, 20, null, Cust, "已取消", null, null);
            Assert.Single(cancelled.Items);

            var ranged = await Svc().ListAsync(1, 20, null, Cust, null,
                new DateTime(2026, 2, 1), new DateTime(2026, 3, 31));
            Assert.Equal(2, ranged.Total);

            Assert.True(await Svc().DeleteBatchAsync(res.批次ID));
            var left = await Svc().ListAsync(1, 20, null, Cust, null, null, null);
            Assert.Equal(0, left.Total);
        }
        finally { Cleanup(c); }
    }

    [SkippableFact]
    public async Task Manual_create_update_delete_roundtrip()
    {
        using var c = fx.Open();
        Cleanup(c);
        try
        {
            var svc = Svc();
            var id = await svc.CreateAsync(new ScheduleRowSaveRequest
            {
                排期客户 = Cust, 状态 = "在排", PO号 = "SCH-M-1", 货号 = "SCH-MH-1",
                数量 = 50m, 走货期 = new DateTime(2026, 5, 1), 备注 = "手工"
            }, "ut");
            Assert.True(id > 0);

            var list = await svc.ListAsync(1, 20, "SCH-M-1", Cust, null, null, null);
            var row = Assert.Single(list.Items);
            Assert.Equal("手工", row.备注);
            Assert.Null(row.批次ID); // 手工行不属于任何导入批次

            Assert.True(await svc.UpdateAsync(id, new ScheduleRowSaveRequest
            {
                排期客户 = Cust, 状态 = "已走货", PO号 = "SCH-M-1", 货号 = "SCH-MH-1",
                数量 = 60m, 备注 = "改"
            }, "ut", true) is { 状态待审核: false });
            row = (await svc.ListAsync(1, 20, "SCH-M-1", Cust, null, null, null)).Items[0];
            Assert.Equal("已走货", row.状态);
            Assert.Equal(60m, row.数量);

            Assert.True(await svc.DeleteAsync(id));
            Assert.Equal(0, (await svc.ListAsync(1, 20, "SCH-M-1", Cust, null, null, null)).Total);
            Assert.False(await svc.DeleteAsync(id));       // 再删 → 不存在
            // 已删行再保存 → null(不存在)
            Assert.Null(await svc.UpdateAsync(id, new ScheduleRowSaveRequest { 排期客户 = Cust, 状态 = "在排" }, "ut", true));
        }
        finally { Cleanup(c); }
    }

    [SkippableFact]
    public async Task Status_change_by_non_manager_pends_until_manager_approves()
    {
        using var c = fx.Open();
        Cleanup(c);
        try
        {
            var svc = Svc();
            var id = await svc.CreateAsync(new ScheduleRowSaveRequest
            {
                排期客户 = Cust, 状态 = "在排", PO号 = "SCH-A-1", 货号 = "SCH-AH-1", 备注 = "原"
            }, "ut");

            // 非经理改状态:状态不落地,其他字段生效,返回 状态待审核
            var pendingBase = await svc.PendingStatusChangeCountAsync(); // 全库口径,库里已有真实数据,断言相对增量
            var res = await svc.UpdateAsync(id, new ScheduleRowSaveRequest
            {
                排期客户 = Cust, 状态 = "已走货", PO号 = "SCH-A-1", 货号 = "SCH-AH-1", 备注 = "改"
            }, "ut", false);
            Assert.Equal(new ScheduleUpdateResult(true), res);
            var row = Assert.Single((await svc.ListAsync(1, 20, "SCH-A-1", Cust, null, null, null)).Items);
            Assert.Equal("在排", row.状态);          // 状态未生效
            Assert.Equal("改", row.备注);            // 其他字段已生效
            Assert.Equal("已走货", row.待审新状态);  // 列表带待审标记
            Assert.Equal(pendingBase + 1, await svc.PendingStatusChangeCountAsync());

            // 已有待审变更时再改状态 → 409 语义(InvalidOperationException)
            await Assert.ThrowsAsync<InvalidOperationException>(() => svc.UpdateAsync(id,
                new ScheduleRowSaveRequest { 排期客户 = Cust, 状态 = "已取消" }, "ut", false));

            // 经理审核通过 → 状态落地,申请结单,待审标记消失
            var chId = (await svc.StatusChangesAsync("待审核")).Single(c2 => c2.排期ID == id).ID;
            await svc.ApproveStatusChangeAsync(chId, "mgr", null);
            row = Assert.Single((await svc.ListAsync(1, 20, "SCH-A-1", Cust, null, null, null)).Items);
            Assert.Equal("已走货", row.状态);
            Assert.Null(row.待审新状态);
            var done = (await svc.StatusChangesAsync("已通过")).Single(c2 => c2.排期ID == id);
            Assert.Equal("mgr", done.审核人);

            // 重复审核 → 抛错
            await Assert.ThrowsAsync<InvalidOperationException>(() => svc.ApproveStatusChangeAsync(chId, "mgr", null));
        }
        finally { Cleanup(c); }
    }

    [SkippableFact]
    public async Task Status_change_reject_keeps_old_status_and_delete_voids_pending()
    {
        using var c = fx.Open();
        Cleanup(c);
        try
        {
            var svc = Svc();
            // 驳回:状态保持原值,申请标 已驳回
            var id1 = await svc.CreateAsync(new ScheduleRowSaveRequest
            { 排期客户 = Cust, 状态 = "在排", PO号 = "SCH-R-1", 货号 = "SCH-RH-1" }, "ut");
            await svc.UpdateAsync(id1, new ScheduleRowSaveRequest
            { 排期客户 = Cust, 状态 = "已取消", PO号 = "SCH-R-1", 货号 = "SCH-RH-1" }, "ut", false);
            var chId1 = (await svc.StatusChangesAsync("待审核")).Single(x => x.排期ID == id1).ID;
            await svc.RejectStatusChangeAsync(chId1, "mgr", "不允许取消");
            var row1 = Assert.Single((await svc.ListAsync(1, 20, "SCH-R-1", Cust, null, null, null)).Items);
            Assert.Equal("在排", row1.状态);
            var rej = (await svc.StatusChangesAsync("已驳回")).Single(x => x.排期ID == id1);
            Assert.Equal("不允许取消", rej.审核备注);

            // 删除带待审申请的行 → 申请自动标 已驳回(排期行已删除)
            // 计数是全库口径,库里已有真实驳回/待审数据,断言相对增量(此处只新增 id2 一笔,id1 驳回已在基线里)
            var pendingBase = await svc.PendingStatusChangeCountAsync();
            var rejectedBase = (await svc.StatusChangesAsync("已驳回")).Count;
            var id2 = await svc.CreateAsync(new ScheduleRowSaveRequest
            { 排期客户 = Cust, 状态 = "在排", PO号 = "SCH-R-2", 货号 = "SCH-RH-2" }, "ut");
            await svc.UpdateAsync(id2, new ScheduleRowSaveRequest
            { 排期客户 = Cust, 状态 = "已走货", PO号 = "SCH-R-2", 货号 = "SCH-RH-2" }, "ut", false);
            Assert.True(await svc.DeleteAsync(id2));
            Assert.Equal(pendingBase, await svc.PendingStatusChangeCountAsync());
            Assert.Equal(rejectedBase + 1, (await svc.StatusChangesAsync("已驳回")).Count);
        }
        finally { Cleanup(c); }
    }

    [SkippableFact]
    public async Task Manual_save_validation_rejects_bad_input()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB，跳过数据库集成测试");
        var svc = Svc();
        // 排期客户必填
        await Assert.ThrowsAsync<ArgumentException>(
            () => svc.CreateAsync(new ScheduleRowSaveRequest { 状态 = "在排" }, "ut"));
        // 状态必填且限 在排/已走货/已取消
        await Assert.ThrowsAsync<ArgumentException>(
            () => svc.CreateAsync(new ScheduleRowSaveRequest { 排期客户 = Cust }, "ut"));
        await Assert.ThrowsAsync<ArgumentException>(
            () => svc.CreateAsync(new ScheduleRowSaveRequest { 排期客户 = Cust, 状态 = "待定" }, "ut"));
        // 长度上限(排期客户 nvarchar(60))
        await Assert.ThrowsAsync<ArgumentException>(
            () => svc.CreateAsync(new ScheduleRowSaveRequest { 排期客户 = new string('客', 61), 状态 = "在排" }, "ut"));
        // 数量不能为负
        await Assert.ThrowsAsync<ArgumentException>(
            () => svc.CreateAsync(new ScheduleRowSaveRequest { 排期客户 = Cust, 状态 = "在排", 数量 = -1m }, "ut"));
    }

    [SkippableFact]
    public async Task MaterialIssue_shipped_remark_marks_schedule_via_production_order()
    {
        const string mo = "SC-SCH-UT-1";
        const string ll = "LL-SCH-UT-1";
        using var c = fx.Open();
        void CleanAll()
        {
            Cleanup(c);
            c.Execute("DELETE FROM [领料明细单] WHERE [单号]=@ll", new { ll });
            c.Execute("DELETE FROM [领料单] WHERE [单号]=@ll", new { ll });
            c.Execute("DELETE FROM [生产制单货号] WHERE [生产单号]=@mo", new { mo });
            c.Execute("DELETE FROM [生产制单] WHERE [生产单号]=@mo", new { mo });
            c.Execute("DELETE FROM [物料资料] WHERE [物料编号]='SCH-H-9'");
        }
        CleanAll();
        try
        {
            // 领料明细单.物料编号 有外键指向 物料资料，先种父行
            c.Execute("IF NOT EXISTS (SELECT 1 FROM [物料资料] WHERE [物料编号]='SCH-H-9') INSERT INTO [物料资料]([物料编号],[物料名称],[规格],[单位]) VALUES('SCH-H-9','排期联动料','规','PCS')");
            // 同一货号挂在两个 PO 的在排行上：溯源只应翻生产单对应的那个 PO
            var res = await Svc().ImportAsync(Req(Row("SCH-PO-A", "SCH-H-9"), Row("SCH-PO-B", "SCH-H-9")), "ut");
            Assert.Equal(2, res.新增);
            c.Execute("INSERT INTO [生产制单]([生产单号],[合同号],[客户款号]) VALUES(@mo,'SCH-PO-A','SCH-H-9')", new { mo });
            c.Execute("INSERT INTO [生产制单货号]([生产单号],[序号],[货号]) VALUES(@mo,1,'SCH-H-9')", new { mo });
            c.Execute("INSERT INTO [领料单]([单号],[日期],[领料部门],[仓库],[审核],[备注]) VALUES(@ll,GETDATE(),'装配部','半成品仓','0','走货')", new { ll });
            c.Execute("INSERT INTO [领料明细单]([单号],[生产单号],[物料编号],[数量]) VALUES(@ll,@mo,'SCH-H-9',10)", new { ll, mo });

            Assert.Equal(1, await Svc().MarkShippedForMaterialIssueAsync(ll, "ut"));
            var states = (await c.QueryAsync<(string PO号, string 状态)>(
                "SELECT [PO号],[状态] FROM [生产排期] WHERE [排期客户]=@Cust ORDER BY [PO号]", new { Cust })).AsList();
            Assert.Equal(2, states.Count);
            Assert.Equal("已走货", states[0].状态); // SCH-PO-A
            Assert.Equal("在排", states[1].状态);   // SCH-PO-B 不受影响

            // 备注不含"走货" → 不动排期
            c.Execute("UPDATE [领料单] SET [备注]='正常领料' WHERE [单号]=@ll", new { ll });
            Assert.Equal(0, await Svc().MarkShippedForMaterialIssueAsync(ll, "ut"));

            // 无生产单号的行 → 按货号兜底翻全部在排行
            c.Execute("UPDATE [领料单] SET [备注]='走货' WHERE [单号]=@ll", new { ll });
            c.Execute("UPDATE [领料明细单] SET [生产单号]=NULL WHERE [单号]=@ll", new { ll });
            Assert.Equal(1, await Svc().MarkShippedForMaterialIssueAsync(ll, "ut"));
            var left = await c.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM [生产排期] WHERE [排期客户]=@Cust AND [状态]='在排'", new { Cust });
            Assert.Equal(0, left);
        }
        finally { CleanAll(); }
    }

    [SkippableFact]
    public async Task List_marks_ma_type_and_links_order_rows_to_ma()
    {
        using var c = fx.Open();
        void CleanBom()
        {
            c.Execute("DELETE FROM [款号物料PO绑定] WHERE [款号]=N'SCHH-MA'");
            c.Execute("DELETE FROM [款号物料总表] WHERE [款号]=N'SCHH-MA'");
            Cleanup(c);
        }
        CleanBom();
        try
        {
            // MA 单(货号 -MA 结尾) + 同客户实单
            var res = await Svc().ImportAsync(Req(
                Row("SCH-PO-MA", "SCHH-MA"),
                Row("SCH-PO-S1", "SCHH-S001")), "ut");
            Assert.Equal(2, res.新增);

            // 单类型=MA单 过滤:只剩 MA 行;MA 行自身不带关联字段
            var ma = Assert.Single((await Svc().ListAsync(1, 20, null, Cust, null, null, null, null, "MA单")).Items);
            Assert.Equal("SCHH-MA", ma.货号);
            Assert.Equal("MA单", ma.单类型);
            Assert.Null(ma.关联MA货号);

            // 单类型=实单 过滤:实行带 关联MA货号/关联MA状态(同排期客户下命中 MA 行)
            var o = Assert.Single((await Svc().ListAsync(1, 20, null, Cust, null, null, null, null, "实单")).Items);
            Assert.Equal("SCHH-S001", o.货号);
            Assert.Equal("实单", o.单类型);
            Assert.Equal("SCHH-MA", o.关联MA货号);
            Assert.Equal("在排", o.关联MA状态);

            // MA 走货后,实单关联状态跟着变
            await Svc().ImportAsync(Req(Row("SCH-PO-MA", "SCHH-MA", "已走货", "2026-04-02")), "ut");
            var o2 = Assert.Single((await Svc().ListAsync(1, 20, "SCH-PO-S1", Cust, null, null, null)).Items);
            Assert.Equal("已走货", o2.关联MA状态);

            // 排期中没有对应 MA 行的实单:关联MA货号仍按规则给出,关联MA状态=null
            await Svc().ImportAsync(Req(Row("SCH-PO-X", "SCHX-S009")), "ut");
            var x = Assert.Single((await Svc().ListAsync(1, 20, "SCH-PO-X", Cust, null, null, null)).Items);
            Assert.Equal("SCHX-MA", x.关联MA货号);
            Assert.Null(x.关联MA状态);

            // 国家后缀货号同属系列:92125A/92125-SLD 开头取前导数字串 → 都关联 92125-MA
            await Svc().ImportAsync(Req(
                Row("SCH-PO-Z9", "92125-MA"),
                Row("SCH-PO-A1", "92125A-S001"),
                Row("SCH-PO-A2", "92125-SLD-S001")), "ut");
            var a1 = Assert.Single((await Svc().ListAsync(1, 20, "SCH-PO-A1", Cust, null, null, null)).Items);
            Assert.Equal("92125-MA", a1.关联MA货号);
            Assert.Equal("在排", a1.关联MA状态);
            var a2 = Assert.Single((await Svc().ListAsync(1, 20, "SCH-PO-A2", Cust, null, null, null)).Items);
            Assert.Equal("92125-MA", a2.关联MA货号);
            Assert.Equal("在排", a2.关联MA状态);
            // 纯数字无横杠货号也按前导数字串出关联
            await Svc().ImportAsync(Req(Row("SCH-PO-N", "92125")), "ut");
            var n = Assert.Single((await Svc().ListAsync(1, 20, "SCH-PO-N", Cust, null, null, null)).Items);
            Assert.Equal("92125-MA", n.关联MA货号);

            // === BOM 关联:BOM 业务键=货号(一个 BOM 可供多单用),绑定按 PO ===
            // SCHH-MA 建 BOM 并绑本 PO;SCHH-S001 不建 BOM
            c.Execute("INSERT INTO [款号物料总表]([款号]) VALUES(N'SCHH-MA')");
            c.Execute("INSERT INTO [款号物料PO绑定]([款号],[PO号]) VALUES(N'SCHH-MA',N'SCH-PO-MA')");
            var maB = Assert.Single((await Svc().ListAsync(1, 20, "SCH-PO-MA", Cust, null, null, null)).Items);
            Assert.Equal("SCHH-MA", maB.BOM款号);
            Assert.Equal(1, maB.绑定PO数);
            Assert.True(maB.已绑本PO);
            // 实单无 BOM:BOM款号=null
            Assert.Null(o2.BOM款号);
            Assert.False(o2.已绑本PO);
            // 同货号另一个 PO 的 MA 排期行:共享同一 BOM(绑定PO数=1),但未绑本 PO
            await Svc().ImportAsync(Req(Row("SCH-PO-MA2", "SCHH-MA")), "ut");
            var ma2 = Assert.Single((await Svc().ListAsync(1, 20, "SCH-PO-MA2", Cust, null, null, null)).Items);
            Assert.Equal("SCHH-MA", ma2.BOM款号);
            Assert.Equal(1, ma2.绑定PO数);
            Assert.False(ma2.已绑本PO);
            // 再绑一个 PO → 绑定PO数=2,两行各自按本 PO 判定(关键字 LIKE 会同时命中两个 PO,按 PO号 区分)
            c.Execute("INSERT INTO [款号物料PO绑定]([款号],[PO号]) VALUES(N'SCHH-MA',N'SCH-PO-MA2')");
            var two = (await Svc().ListAsync(1, 20, "SCH-PO-MA", Cust, null, null, null)).Items;
            maB = Assert.Single(two, r => r.PO号 == "SCH-PO-MA");
            Assert.Equal(2, maB.绑定PO数);
            Assert.True(maB.已绑本PO);
            ma2 = Assert.Single(two, r => r.PO号 == "SCH-PO-MA2");
            Assert.True(ma2.已绑本PO);
        }
        finally { CleanBom(); }
    }
}
