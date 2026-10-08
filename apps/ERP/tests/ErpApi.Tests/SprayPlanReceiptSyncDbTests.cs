using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Plastics.PlasticReceipt;
using ErpApi.Infrastructure.Db;
using ErpApi.Integrations.Paiji;
using ErpApi.Integrations.SprayPlan;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Xunit;

// 喷油排期入库申请单 → ERP塑胶入仓单 同步服务(SprayPlanReceiptSyncService)的 DB 集成测试。
// 测试数据标记:申请单号/订单单号/采购单号用 SPUT- 前缀,便于清理且不撞真实数据。
[Collection("db")]
public class SprayPlanReceiptSyncDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    private SprayPlanReceiptSyncService Svc() => new(
        new PlasticReceiptService(Factory(), new DocumentNumberGenerator(),
            new PaijiPushService(new HttpClient(), Options.Create(new PaijiOptions()),
                NullLogger<PaijiPushService>.Instance)),
        Factory(), NullLogger<SprayPlanReceiptSyncService>.Instance);

    private const string Tag = "SPUT-";
    private const string 申请单号1 = "SPUT-RK-001";
    private const string 申请单号2 = "SPUT-RK-002";
    private const string 申请单号3 = "SPUT-RK-003";
    private const string 申请单号4 = "SPUT-RK-004";
    private const string 申请单号5 = "SPUT-RK-005";
    private const string 申请单号6 = "SPUT-RK-006";
    private const string 申请单号7 = "SPUT-RK-007";

    private static void Cleanup(SqlConnection c)
    {
        c.Execute("DELETE FROM [喷油同步记录] WHERE [申请单号] LIKE @tag + N'%';", new { tag = Tag });
        c.Execute(@"DELETE FROM [塑胶入仓明细单] WHERE [单号] IN (SELECT [单号] FROM [塑胶入仓单] WHERE [备注] LIKE N'%' + @tag + N'%');", new { tag = Tag });
        c.Execute("DELETE FROM [塑胶入仓单] WHERE [备注] LIKE N'%' + @tag + N'%';", new { tag = Tag });
        c.Execute("DELETE FROM [塑胶采购订单明细] WHERE [单号] LIKE @tag + N'%';", new { tag = Tag });
        c.Execute("DELETE FROM [塑胶采购订单] WHERE [单号] LIKE @tag + N'%';", new { tag = Tag });
    }

    private static SprayPlanInboundRow 行(string 申请单号, decimal 数量, string? orderNo = "SPUT-ORD-1",
        string productNo = "SPUT-K1", string? itemName = "SPUT品名", string partName = "测试眼扣") => new()
    {
        ApplicationNo = 申请单号,
        ProductionDate = "2026-09-10",
        OrderNo = orderNo,
        ProductNo = productNo,
        ItemName = itemName,
        PartName = partName,
        Quantity = 数量,
        CreatedBy = "admin",
    };

    // DB 服务器当前时间(GETDATE,SQL 容器为 UTC)转 ISO UTC 字符串,模拟对方报文的 updatedAt。
    // 先 WAITFOR 50ms:GETDATE 精度仅 1/300s,否则可能与上一趟写入的 [同步时间] 同 tick 而被 "<= 同步时间跳过" 口径挡掉。
    private static async Task<string> DbNowIso(SqlConnection c)
    {
        var t = await c.ExecuteScalarAsync<DateTime>("WAITFOR DELAY '00:00:00.05'; SELECT GETDATE();");
        return new DateTimeOffset(DateTime.SpecifyKind(t, DateTimeKind.Utc)).ToString("o");
    }

    [SkippableFact]
    public async Task SyncRows_两张申请单建两张未审核单且幂等()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        Cleanup(c);
        try
        {
            var svc = Svc();
            var 建单 = await svc.SyncRowsAsync([行(申请单号1, 100), 行(申请单号2, 50, orderNo: "SPUT-ORD-2")]);
            Assert.Equal(2, 建单.Count);

            var 单头 = (await c.QueryAsync<(string 审核, string 操作员, DateTime 日期, string? 订单单号, string 备注)>(
                "SELECT [审核],[操作员],[日期],[订单单号],[备注] FROM [塑胶入仓单] WHERE [单号] IN @单号s",
                new { 单号s = 建单 })).ToList();
            Assert.All(单头, h =>
            {
                Assert.Equal("0", h.审核);                         // 未审核
                Assert.Equal("喷油同步", h.操作员);
                Assert.Equal(new DateTime(2026, 9, 10), h.日期);    // 单头日期改写为生产日期
                Assert.Contains("喷油排期同步(SPUT-RK-", h.备注);
            });
            Assert.Equal(["SPUT-ORD-1", "SPUT-ORD-2"], 单头.Select(h => h.订单单号).OrderBy(x => x).ToArray());

            var 明细 = (await c.QueryAsync<(string? 款号, string? 塑胶货号, string? 物料编号, string? 物料名称, string? 单位, decimal 数量, string? 备注)>(
                @"SELECT d.[款号],d.[塑胶货号],d.[物料编号],d.[物料名称],d.[单位],d.[数量],d.[备注]
                  FROM [塑胶入仓明细单] d WHERE d.[单号] IN @单号s", new { 单号s = 建单 })).ToList();
            Assert.Equal(2, 明细.Count);
            Assert.All(明细, l =>
            {
                Assert.Equal("SPUT-K1", l.款号);
                Assert.Equal("SPUT-K1", l.塑胶货号);
                Assert.Equal("SPUT-K1", l.物料编号);            // 解析不到 → productNo 原值
                Assert.Equal("SPUT品名/测试眼扣", l.物料名称);
                Assert.Equal("个", l.单位);
                Assert.Contains("喷油排期#SPUT-RK-", l.备注);
            });
            Assert.Equal([100m, 50m], 明细.Select(l => l.数量).OrderByDescending(x => x).ToArray());

            var 同步记录 = await c.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM [喷油同步记录] WHERE [ERP单号] IN @单号s", new { 单号s = 建单 });
            Assert.Equal(2, 同步记录);

            // 幂等:同样的申请单号再同步一次,不再建单
            var 再同步 = await svc.SyncRowsAsync([行(申请单号1, 100), 行(申请单号2, 50, orderNo: "SPUT-ORD-2")]);
            Assert.Empty(再同步);
            Assert.Equal(2, await c.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM [塑胶入仓单] WHERE [备注] LIKE N'%' + @tag + N'%'", new { tag = Tag }));
        }
        finally { Cleanup(c); }
    }

    [SkippableFact]
    public async Task SyncRows_负数与零数量行被跳过()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        Cleanup(c);
        try
        {
            var svc = Svc();
            var 建单 = await svc.SyncRowsAsync([行(申请单号3, -20), 行(申请单号4, 0)]);
            Assert.Empty(建单);
            Assert.Equal(0, await c.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM [塑胶入仓单] WHERE [备注] LIKE N'%' + @tag + N'%'", new { tag = Tag }));
            Assert.Equal(0, await c.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM [喷油同步记录] WHERE [申请单号] LIKE @tag + N'%'", new { tag = Tag }));
        }
        finally { Cleanup(c); }
    }

    [SkippableFact]
    public async Task SyncRows_按订单号前缀解析供应商并带出物料编号()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        Cleanup(c);
        try
        {
            // 塑胶采购订单 SPUT-PO001(供应商 SPUT-S01),明细 款号 K9 / 物料编号 SPUT-M9 / 物料名称 眼扣
            await c.ExecuteAsync(@"
INSERT INTO [塑胶采购订单]([单号],[日期],[供应商编号],[供应商名称],[审核]) VALUES(N'SPUT-PO001',GETDATE(),N'SPUT-S01',N'SPUT测试供应商','0');
INSERT INTO [塑胶采购订单明细]([单号],[款号],[物料编号],[物料名称],[数量],[颜色]) VALUES(N'SPUT-PO001',N'K9',N'SPUT-M9',N'眼扣',1000,N'黑');");
            // orderNo 带款号后缀(多款号推送形态 SPxxx-款号),精确不中 → 试最后一个 '-' 前的前缀 SPUT-PO001 命中
            var svc = Svc();
            var 建单 = await svc.SyncRowsAsync([行(申请单号3, 10, orderNo: "SPUT-PO001-K9",
                productNo: "K9", itemName: null, partName: "眼扣")]);
            var 单号 = Assert.Single(建单);

            var 单头 = await c.QuerySingleAsync<(string? 供应商编号, string? 供应商名称, string? 订单单号)>(
                "SELECT [供应商编号],[供应商名称],[订单单号] FROM [塑胶入仓单] WHERE [单号]=@单号", new { 单号 });
            Assert.Equal("SPUT-S01", 单头.供应商编号);
            Assert.Equal("SPUT测试供应商", 单头.供应商名称);
            // 订单单号落解析出的采购单号(去掉款号后缀):欠数核销/超收校验按它对上采购订单
            Assert.Equal("SPUT-PO001", 单头.订单单号);

            var 明细 = await c.QuerySingleAsync<(string? 物料编号, string? 物料名称, string? 颜色, string? 订单单号)>(
                "SELECT [物料编号],[物料名称],[颜色],[订单单号] FROM [塑胶入仓明细单] WHERE [单号]=@单号", new { 单号 });
            Assert.Equal("SPUT-M9", 明细.物料编号);   // 采购订单明细匹配带出
            Assert.Equal("眼扣", 明细.物料名称);
            Assert.Equal("黑", 明细.颜色);
            Assert.Equal("SPUT-PO001", 明细.订单单号);

            // 超收校验现在真正生效(以前落带后缀单号,校验被跳过):数量 2000 > 订购 1000 → 建单被拒
            var 拒 = await svc.SyncRowsAsync([行(申请单号4, 2000, orderNo: "SPUT-PO001-K9",
                productNo: "K9", itemName: null, partName: "眼扣")]);
            Assert.Empty(拒);
            Assert.Equal(0, await c.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM [喷油同步记录] WHERE [申请单号]=@no", new { no = 申请单号4 }));

            // 核销口径:入仓单审核后,采购订单欠数按 订单单号+物料+颜色 对上(订购1000-入仓10=欠990)
            await c.ExecuteAsync("UPDATE [塑胶入仓单] SET [审核]='1' WHERE [单号]=@单号", new { 单号 });
            var 欠数 = await c.ExecuteScalarAsync<decimal>(@"
SELECT d.[数量] - ISNULL(rk.[入仓数量],0)
FROM [塑胶采购订单明细] d
LEFT JOIN (SELECT r.[订单单号], r.[物料编号], ISNULL(r.[颜色],'') AS 颜色键, SUM(r.[数量]) AS 入仓数量
           FROM [塑胶入仓明细单] r JOIN [塑胶入仓单] h ON h.[单号]=r.[单号]
           WHERE ISNULL(h.[审核],'0')='1' AND ISNULL(r.[备品],'0')<>'1'
           GROUP BY r.[订单单号], r.[物料编号], ISNULL(r.[颜色],'')) rk
  ON rk.[订单单号]=d.[单号] AND rk.[物料编号]=d.[物料编号] AND rk.[颜色键]=ISNULL(d.[颜色],'')
WHERE d.[单号]=N'SPUT-PO001' AND d.[物料编号]=N'SPUT-M9'", new { });
            Assert.Equal(990m, 欠数);
        }
        finally { Cleanup(c); }
    }

    [SkippableFact]
    public async Task SyncRows_已同步申请单改单后未审核则自动更新且第二趟不重复()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        Cleanup(c);
        try
        {
            var svc = Svc();
            var 建单 = await svc.SyncRowsAsync([行(申请单号5, 100)]);
            var 单号 = Assert.Single(建单);
            var 同步前 = await c.ExecuteScalarAsync<DateTime>(
                "SELECT [同步时间] FROM [喷油同步记录] WHERE [申请单号]=@no", new { no = 申请单号5 });

            // 对方改单:数量 100→200,品名改;updatedAt 比同步时间新
            // (updatedAt 取 DB 服务器时钟:测试机与 SQL 容器有亚秒级时钟差,本机 UtcNow 可能落在 同步时间 之前)
            var 改单 = 行(申请单号5, 200, itemName: "SPUT品名改");
            改单.UpdatedAt = await DbNowIso(c);
            var 再 = await svc.SyncRowsAsync([改单]);
            Assert.Empty(再);    // 不新建单

            var h = await c.QuerySingleAsync<(decimal 数量, string 操作员, string? 备注)>(
                "SELECT [数量],[操作员],[备注] FROM [塑胶入仓单] WHERE [单号]=@单号", new { 单号 });
            Assert.Equal(200m, h.数量);
            Assert.Equal("喷油同步", h.操作员);                       // 操作员不被抹掉
            Assert.Contains($"喷油排期同步({申请单号5})", h.备注);     // 来源标记保留

            var d = await c.QuerySingleAsync<(decimal 数量, string? 物料名称)>(
                "SELECT [数量],[物料名称] FROM [塑胶入仓明细单] WHERE [单号]=@单号", new { 单号 });
            Assert.Equal(200m, d.数量);
            Assert.Equal("SPUT品名改/测试眼扣", d.物料名称);

            var 同步后 = await c.ExecuteScalarAsync<DateTime>(
                "SELECT [同步时间] FROM [喷油同步记录] WHERE [申请单号]=@no", new { no = 申请单号5 });
            Assert.True(同步后 > 同步前, "同步时间应刷新");

            // 第二趟同 updatedAt:不再重复更新(同步时间不再变)
            var 再2 = await svc.SyncRowsAsync([改单]);
            Assert.Empty(再2);
            var 同步后2 = await c.ExecuteScalarAsync<DateTime>(
                "SELECT [同步时间] FROM [喷油同步记录] WHERE [申请单号]=@no", new { no = 申请单号5 });
            Assert.Equal(同步后, 同步后2);
        }
        finally { Cleanup(c); }
    }

    [SkippableFact]
    public async Task SyncRows_已审核入仓单不自动更新()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        Cleanup(c);
        try
        {
            var svc = Svc();
            var 建单 = await svc.SyncRowsAsync([行(申请单号6, 100)]);
            var 单号 = Assert.Single(建单);
            await c.ExecuteAsync("UPDATE [塑胶入仓单] SET [审核]='1' WHERE [单号]=@单号", new { 单号 });

            var 改单 = 行(申请单号6, 200);
            改单.UpdatedAt = await DbNowIso(c);
            await svc.SyncRowsAsync([改单]);

            var 数量 = await c.ExecuteScalarAsync<decimal>(
                "SELECT [数量] FROM [塑胶入仓单] WHERE [单号]=@单号", new { 单号 });
            Assert.Equal(100m, 数量);
            var 明细数量 = await c.ExecuteScalarAsync<decimal>(
                "SELECT [数量] FROM [塑胶入仓明细单] WHERE [单号]=@单号", new { 单号 });
            Assert.Equal(100m, 明细数量);
        }
        finally { Cleanup(c); }
    }

    [SkippableFact]
    public async Task SyncRows_updatedAt未变或缺失则不更新()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        Cleanup(c);
        try
        {
            var svc = Svc();
            var 建单 = await svc.SyncRowsAsync([行(申请单号7, 100)]);
            var 单号 = Assert.Single(建单);
            var 同步时间 = await c.ExecuteScalarAsync<DateTime>(
                "SELECT [同步时间] FROM [喷油同步记录] WHERE [申请单号]=@no", new { no = 申请单号7 });

            // updatedAt 早于同步时间 → 不更新
            var 旧 = 行(申请单号7, 200);
            旧.UpdatedAt = new DateTimeOffset(
                DateTime.SpecifyKind(同步时间.AddMinutes(-1), DateTimeKind.Utc)).ToString("o");
            await svc.SyncRowsAsync([旧]);
            // 无 updatedAt(解析不出) → 不更新
            await svc.SyncRowsAsync([行(申请单号7, 300)]);

            var 数量 = await c.ExecuteScalarAsync<decimal>(
                "SELECT [数量] FROM [塑胶入仓单] WHERE [单号]=@单号", new { 单号 });
            Assert.Equal(100m, 数量);
        }
        finally { Cleanup(c); }
    }
}
