using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.Assembly;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Xunit;

// 委托加工单 行级单价记忆(db/132):保存(Create/Update)把有单价的生产明细行按货号 MERGE 进
// [加工单价记忆];无单价的行不记录;读取端点 ProcessingPriceMemoryController 走同表查询。
[Collection("db")]
public class ProcessingPriceMemoryDbTests(DbFixture fx)
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
        c.Execute("DELETE d FROM [装配加工采购单明细] d JOIN [装配加工采购单] h ON h.[单号]=d.[单号] WHERE h.[客户名称]=N'单价记忆测试客户'");
        c.Execute("DELETE d FROM [装配加工采购单生产明细] d JOIN [装配加工采购单] h ON h.[单号]=d.[单号] WHERE h.[客户名称]=N'单价记忆测试客户'");
        c.Execute("DELETE FROM [装配加工采购单] WHERE [客户名称]=N'单价记忆测试客户'");
        c.Execute("DELETE FROM [加工单价记忆] WHERE [货号] IN (N'PM-T1',N'PM-T2')");
    }

    private static AssemblyPurchaseOrderSaveDto MakeDto(decimal? price, string 款号 = "PM-T1") => new()
    {
        供应商编号 = "G01",
        供应商名称 = "记忆测试加工厂",
        客户编号 = "C01",
        客户名称 = "单价记忆测试客户",
        收货仓库 = "半成品仓",
        生产明细 =
        {
            new() { 接单日期 = "2026-10-08", 生产单号 = "PM-MO", 款号 = 款号, 产品名称 = "记忆测试件", 加工数量 = 100, 单价 = price }
        },
    };

    [SkippableFact]
    public async Task Create_then_Update_writes_and_overwrites_price_memory()
    {
        using var c = fx.Open(); Clean(c);
        try
        {
            var 单号 = await Svc().CreateAsync(MakeDto(1.5m), "tester");
            Assert.Equal(1.5m, c.ExecuteScalar<decimal?>("SELECT [单价] FROM [加工单价记忆] WHERE [货号]=N'PM-T1'"));

            await Svc().UpdateAsync(单号, MakeDto(2.25m), "tester");
            Assert.Equal(2.25m, c.ExecuteScalar<decimal?>("SELECT [单价] FROM [加工单价记忆] WHERE [货号]=N'PM-T1'"));
        }
        finally { Clean(c); }
    }

    [SkippableFact]
    public async Task Create_without_line_price_writes_no_memory()
    {
        using var c = fx.Open(); Clean(c);
        try
        {
            await Svc().CreateAsync(MakeDto(null), "tester");
            Assert.Equal(0, c.ExecuteScalar<int>("SELECT COUNT(*) FROM [加工单价记忆] WHERE [货号]=N'PM-T1'"));
        }
        finally { Clean(c); }
    }
}
