using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Assembly;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

// 装配加工采购单: 多行产品 + 行级客户/装配方式/备注(db/105)。
[Collection("db")]
public class AssemblyPurchaseOrderLineCustomerDbTests(DbFixture fx)
{
    private ISqlConnectionFactory Factory()
    {
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["Erp:ConnectionStringEnvVar"] = "ERP_TEST_DB" }).Build();
        return new SqlConnectionFactory(cfg);
    }
    private AssemblyPurchaseOrderService Svc() => new(Factory(), new DocumentNumberGenerator());

    private static void Clean(SqlConnection c)
    {
        c.Execute("DELETE d FROM [装配加工采购单明细] d JOIN [装配加工采购单] h ON h.[单号]=d.[单号] WHERE h.[客户名称]=N'ZP行级客户测试'");
        c.Execute("DELETE d FROM [装配加工采购单生产明细] d JOIN [装配加工采购单] h ON h.[单号]=d.[单号] WHERE h.[客户名称]=N'ZP行级客户测试'");
        c.Execute("DELETE FROM [装配加工采购单] WHERE [客户名称]=N'ZP行级客户测试'");
    }

    private static AssemblyPurchaseOrderSaveDto MakeDto() => new()
    {
        供应商编号 = "G01",
        供应商名称 = "ZP测试加工厂",
        客户编号 = "C01",
        客户名称 = "ZP行级客户测试",
        收货仓库 = "半成品仓",
        装配方式 = "头装配",
        备注 = "头备注",
        单价 = 1.5m,
        生产明细 =
        {
            new() { 接单日期 = "2026-09-15", 生产单号 = "MO-1", 款号 = "K-A", 产品名称 = "产品A", 配件编号 = "PJ-A",
                    产品装配名称 = "装配A", 加工数量 = 100, 单价 = 1.5m,
                    客户编号 = "C-L1", 客户名称 = "行客户一", 装配方式 = "行装配一", 备注 = "行备注一" },
            new() { 接单日期 = "2026-09-15", 生产单号 = "MO-2", 款号 = "K-B", 产品名称 = "产品B", 配件编号 = "PJ-B",
                    产品装配名称 = "装配B", 加工数量 = 50, 单价 = 2m,
                    客户编号 = "C-L2", 客户名称 = "行客户二", 装配方式 = "行装配二", 备注 = "行备注二" },
        },
    };

    [SkippableFact]
    public async Task Multi_line_products_restore_per_row_with_line_customer()
    {
        using var c = fx.Open(); Clean(c);
        try
        {
            var 单号 = await Svc().CreateAsync(MakeDto(), "tester");

            // 行级四列真实落库
            var rows = (await c.QueryAsync<(string? 客户编号, string? 客户名称, string? 装配方式, string? 备注)>(
                "SELECT [客户编号],[客户名称],[装配方式],[备注] FROM [装配加工采购单生产明细] WHERE [单号]=@单号 ORDER BY [行号]",
                new { 单号 })).AsList();
            Assert.Equal(2, rows.Count);
            Assert.Equal("C-L1", rows[0].客户编号);
            Assert.Equal("行客户一", rows[0].客户名称);
            Assert.Equal("行装配一", rows[0].装配方式);
            Assert.Equal("行备注一", rows[0].备注);
            Assert.Equal("C-L2", rows[1].客户编号);

            // GET: 产品明细按生产明细逐行还原
            var d = await Svc().GetAsync(单号);
            Assert.NotNull(d);
            Assert.Equal(2, d!.产品明细.Count);

            var p1 = d.产品明细[0];
            Assert.Equal("C-L1，行客户一", p1.客户);
            Assert.Equal("K-A", p1.产品货号);
            Assert.Equal("装配A", p1.产品装配名称);
            Assert.Equal("PJ-A", p1.配件编号);
            Assert.Equal("行装配一", p1.装配方式);
            Assert.Equal(100m, p1.加工数量);
            Assert.Equal("行备注一", p1.备注);

            var p2 = d.产品明细[1];
            Assert.Equal("C-L2，行客户二", p2.客户);
            Assert.Equal("K-B", p2.产品货号);
            Assert.Equal("行装配二", p2.装配方式);
            Assert.Equal(50m, p2.加工数量);
            Assert.Equal("行备注二", p2.备注);
        }
        finally { Clean(c); }
    }

    [SkippableFact]
    public async Task Empty_line_customer_falls_back_to_header()
    {
        using var c = fx.Open(); Clean(c);
        try
        {
            var dto = MakeDto();
            // 第二行不带行级客户/装配方式/备注 = 旧数据形态
            dto.生产明细[1].客户编号 = null;
            dto.生产明细[1].客户名称 = null;
            dto.生产明细[1].装配方式 = null;
            dto.生产明细[1].备注 = null;
            var 单号 = await Svc().CreateAsync(dto, "tester");

            var d = await Svc().GetAsync(单号);
            Assert.NotNull(d);
            Assert.Equal(2, d!.产品明细.Count);
            var p2 = d.产品明细[1];
            Assert.Equal("C01，ZP行级客户测试", p2.客户);   // 回落单头客户
            Assert.Equal("头装配", p2.装配方式);              // 回落单头装配方式
            Assert.Equal("头备注", p2.备注);                  // 回落单头备注
            Assert.Equal("K-B", p2.产品货号);
        }
        finally { Clean(c); }
    }

    [SkippableFact]
    public async Task Update_changes_line_customer_columns()
    {
        using var c = fx.Open(); Clean(c);
        try
        {
            var 单号 = await Svc().CreateAsync(MakeDto(), "tester");

            var dto = MakeDto();
            dto.生产明细[0].客户编号 = "C-L9";
            dto.生产明细[0].客户名称 = "行客户改";
            dto.生产明细[0].装配方式 = "行装配改";
            dto.生产明细[0].备注 = "行备注改";
            Assert.True(await Svc().UpdateAsync(单号, dto, "tester"));

            var d = await Svc().GetAsync(单号);
            Assert.NotNull(d);
            var p1 = d!.产品明细[0];
            Assert.Equal("C-L9，行客户改", p1.客户);
            Assert.Equal("行装配改", p1.装配方式);
            Assert.Equal("行备注改", p1.备注);
            // 第二行保持
            Assert.Equal("C-L2，行客户二", d.产品明细[1].客户);
        }
        finally { Clean(c); }
    }
}
