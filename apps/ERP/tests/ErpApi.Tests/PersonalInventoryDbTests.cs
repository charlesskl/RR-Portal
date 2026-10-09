using Dapper;
using ErpApi.Engines.Authorization;
using ErpApi.Features.Materials;
using ErpApi.Infrastructure.Db;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

// 个人库存金额表(PersonalInventoryController):批次倒推 FIFO 归属验证。
// 场景:PI-M1 两批入仓(100@1.5 + 50@2.5,同一订单/下单人张三),领料 120 → 剩 30 全归新批次;
// PI-M2 只有盘点盘盈 10、无入仓批次 → 归「期初结余」,单价取物料主档。
[Collection("db")]
public class PersonalInventoryDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }

    private sealed class AllowAllPerms : IPermissionService
    {
        public Task<IReadOnlyDictionary<string, PermissionFlags>> GetByUserAsync(string userName)
            => Task.FromResult<IReadOnlyDictionary<string, PermissionFlags>>(new Dictionary<string, PermissionFlags>());
        public Task<bool> HasAsync(string userName, string menu, PermissionAction action) => Task.FromResult(true);
    }

    private PersonalInventoryController Ctrl() => new(Factory(), new AllowAllPerms());

    private static void Seed(SqlConnection c)
    {
        Clean(c);
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[规格],[单位],[单价]) VALUES(N'PI-M1',N'PI面料一',N'规格A',N'米',10)");
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[规格],[单位],[单价]) VALUES(N'PI-M2',N'PI面料二',N'规格B',N'米',5)");
        c.Execute("INSERT INTO [采购订单]([单号],[操作员]) VALUES(N'POT-PI1',N'张三')");
        c.Execute("INSERT INTO [采购入仓单]([单号],[仓库],[审核],[操作员],[日期]) VALUES(N'PIRK1',N'来料仓','1',N'admin','2026-01-01')");
        c.Execute(@"INSERT INTO [采购入仓明细单]([单号],[订单单号],[仓库],[物料编号],[物料名称],[规格],[单位],[数量],[单价],[日期])
                    VALUES(N'PIRK1',N'POT-PI1',N'来料仓',N'PI-M1',N'PI面料一',N'规格A',N'米',100,1.5,'2026-01-01')");
        c.Execute("INSERT INTO [采购入仓单]([单号],[仓库],[审核],[操作员],[日期]) VALUES(N'PIRK2',N'来料仓','1',N'admin','2026-02-01')");
        c.Execute(@"INSERT INTO [采购入仓明细单]([单号],[订单单号],[仓库],[物料编号],[物料名称],[规格],[单位],[数量],[单价],[日期])
                    VALUES(N'PIRK2',N'POT-PI1',N'来料仓',N'PI-M1',N'PI面料一',N'规格A',N'米',50,2.5,'2026-02-01')");
        c.Execute("INSERT INTO [领料单]([单号],[仓库],[审核]) VALUES(N'PILL1',N'来料仓','1')");
        c.Execute(@"INSERT INTO [领料明细单]([单号],[仓库],[物料编号],[物料名称],[规格],[单位],[数量])
                    VALUES(N'PILL1',N'来料仓',N'PI-M1',N'PI面料一',N'规格A',N'米',120)");
        c.Execute("INSERT INTO [盘点单]([单号],[仓库],[审核]) VALUES(N'PIPD1',N'来料仓','1')");
        c.Execute(@"INSERT INTO [盘点明细单]([单号],[仓库],[物料编号],[物料名称],[盈亏数量])
                    VALUES(N'PIPD1',N'来料仓',N'PI-M2',N'PI面料二',10)");
    }

    private static void Clean(SqlConnection c)
    {
        c.Execute("DELETE FROM [采购入仓明细单] WHERE [物料编号] IN (N'PI-M1',N'PI-M2')");
        c.Execute("DELETE FROM [采购入仓单] WHERE [单号] IN (N'PIRK1',N'PIRK2')");
        c.Execute("DELETE FROM [领料明细单] WHERE [物料编号] IN (N'PI-M1',N'PI-M2')");
        c.Execute("DELETE FROM [领料单] WHERE [单号]=N'PILL1'");
        c.Execute("DELETE FROM [盘点明细单] WHERE [物料编号] IN (N'PI-M1',N'PI-M2')");
        c.Execute("DELETE FROM [盘点单] WHERE [单号]=N'PIPD1'");
        c.Execute("DELETE FROM [采购订单] WHERE [单号]=N'POT-PI1'");
        c.Execute("DELETE FROM [物料资料] WHERE [物料编号] IN (N'PI-M1',N'PI-M2')");
    }

    private static async Task<List<PersonalInventoryBatchRow>> Call(PersonalInventoryController ctrl, string? 范围 = null)
    {
        var ok = Assert.IsType<OkObjectResult>(await ctrl.List(范围));
        return Assert.IsAssignableFrom<List<PersonalInventoryBatchRow>>(ok.Value);
    }

    [SkippableFact]
    public async Task Fifo_newest_batch_first_and_person_from_order()
    {
        using var c = fx.Open(); Seed(c);
        try
        {
            var rows = await Call(Ctrl());
            var m1 = rows.Where(r => r.物料编号 == "PI-M1").ToList();
            // 库存 30 全部归到最新批次 PIRK2(批次 50),旧批次 PIRK1 已耗完不出现
            var row = Assert.Single(m1);
            Assert.Equal("来料", row.范围);
            Assert.Equal("PIRK2", row.入仓单号);
            Assert.Equal("POT-PI1", row.订单单号);
            Assert.Equal("张三", row.下单人);
            Assert.Equal(30m, row.剩余数量);
            Assert.Equal(2.5m, row.单价);
            Assert.Equal(75m, row.金额);
        }
        finally { Clean(c); }
    }

    [SkippableFact]
    public async Task Stock_without_batches_goes_to_opening_balance()
    {
        using var c = fx.Open(); Seed(c);
        try
        {
            var rows = await Call(Ctrl());
            var m2 = rows.Where(r => r.物料编号 == "PI-M2").ToList();
            var row = Assert.Single(m2);
            Assert.Equal("期初结余", row.下单人);
            Assert.Null(row.入仓单号);
            Assert.Equal(10m, row.剩余数量);
            Assert.Equal(5m, row.单价); // 无批次单价,回落物料主档单价
            Assert.Equal(50m, row.金额);
        }
        finally { Clean(c); }
    }

    [SkippableFact]
    public async Task Scope_filter_excludes_other_warehouse()
    {
        using var c = fx.Open(); Seed(c);
        try
        {
            var rows = await Call(Ctrl(), "塑胶");
            Assert.DoesNotContain(rows, r => r.物料编号 != null && r.物料编号.StartsWith("PI-"));
        }
        finally { Clean(c); }
    }

    // 半成品:入仓批次挂委托加工单(ZP)则下单人=订单操作员;半成品领料出库后剩余按 FIFO 倒推
    private static void SeedSemi(SqlConnection c)
    {
        CleanSemi(c);
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[规格],[单位]) VALUES(N'SM-M1',N'SM底座',N'规格S',N'个')");
        c.Execute("INSERT INTO [装配加工采购单]([单号],[操作员]) VALUES(N'ZP-TEST1',N'李四')");
        c.Execute("INSERT INTO [半成品入仓单]([单号],[仓库],[审核],[操作员],[日期]) VALUES(N'SMRK1',N'半成品仓','1',N'admin','2026-03-01')");
        c.Execute(@"INSERT INTO [半成品入仓明细单]([单号],[订单单号],[仓库],[物料编号],[物料名称],[名称],[规格],[颜色],[单位],[数量],[单价],[日期])
                    VALUES(N'SMRK1',N'ZP-TEST1',N'半成品仓',N'SM-M1',N'SM底座',N'SM底座',N'规格S',N'红',N'个',80,0.5,'2026-03-01')");
        c.Execute("INSERT INTO [半成品领料单]([单号],[仓库],[审核]) VALUES(N'SMLL1',N'半成品仓','1')");
        c.Execute(@"INSERT INTO [半成品领料明细单]([单号],[仓库],[物料编号],[物料名称],[规格],[颜色],[单位],[数量])
                    VALUES(N'SMLL1',N'半成品仓',N'SM-M1',N'SM底座',N'规格S',N'红',N'个',30)");
    }

    private static void CleanSemi(SqlConnection c)
    {
        c.Execute("DELETE FROM [半成品入仓明细单] WHERE [物料编号]=N'SM-M1'");
        c.Execute("DELETE FROM [半成品入仓单] WHERE [单号]=N'SMRK1'");
        c.Execute("DELETE FROM [半成品领料明细单] WHERE [物料编号]=N'SM-M1'");
        c.Execute("DELETE FROM [半成品领料单] WHERE [单号]=N'SMLL1'");
        c.Execute("DELETE FROM [装配加工采购单] WHERE [单号]=N'ZP-TEST1'");
        c.Execute("DELETE FROM [物料资料] WHERE [物料编号]=N'SM-M1'");
    }

    [SkippableFact]
    public async Task Semi_fifo_and_person_from_assembly_order()
    {
        using var c = fx.Open(); SeedSemi(c);
        try
        {
            var rows = await Call(Ctrl(), "半成品");
            var row = Assert.Single(rows.Where(r => r.物料编号 == "SM-M1").ToList());
            Assert.Equal("半成品", row.范围);
            Assert.Equal("李四", row.下单人); // 订单操作员优先于入仓单操作员
            Assert.Equal(50m, row.剩余数量);  // 80 - 领料 30
            Assert.Equal(0.5m, row.单价);
            Assert.Equal(25m, row.金额);
        }
        finally { CleanSemi(c); }
    }
}
