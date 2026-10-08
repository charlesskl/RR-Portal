using Dapper;
using Microsoft.Data.SqlClient;

// P5 成品仓储测试种子：客户 P5C01 / 款号 P5K01 / 生产单 P5SC01(款P5K01) / 仓库 P5成品仓。
// 成品入仓/出仓/盘点单据由各测试用返回单号精确删，此处兜底按 仓库/生产单号 删。
public static class P5TestData
{
    public const string 客户编号 = "P5C01";
    public const string 款号 = "P5K01";
    public const string 生产单号 = "P5SC01";
    public const string 仓库 = "P5成品仓";
    public const string 仓库2 = "P5半成品仓";

    public static void Seed(SqlConnection c)
    {
        Cleanup(c);
        c.Execute("INSERT INTO [客户资料]([客户编号],[客户名称]) VALUES(N'P5C01',N'P5测试客户')");
        c.Execute("INSERT INTO [款号总表]([款号],[款式]) VALUES(N'P5K01',N'P5测试款式')");
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[规格],[单位]) VALUES(N'P5M1',N'P5半成品料',N'规格A',N'件')");
        c.Execute(@"INSERT INTO [生产制单]([生产单号],[款号],[款式],[客户编号],[客户名称],[计划数量],[审核])
                    VALUES(N'P5SC01',N'P5K01',N'P5测试款式',N'P5C01',N'P5测试客户',100,'1')");
        // 业务规则:半成品未审核不能入成品——成品入仓相关测试需要一张已审核的半成品入仓单
        c.Execute("INSERT INTO [半成品入仓单]([单号],[仓库],[数量],[审核]) VALUES(N'P5SR01',N'P5半成品仓',100,'1')");
        c.Execute("INSERT INTO [半成品入仓明细单]([单号],[生产单号],[物料编号],[数量]) VALUES(N'P5SR01',N'P5SC01',N'P5M1',100)");
    }

    public static void Cleanup(SqlConnection c)
    {
        c.Execute("DELETE FROM [半成品入仓明细单] WHERE [单号]=N'P5SR01'");
        c.Execute("DELETE FROM [半成品入仓单] WHERE [单号]=N'P5SR01'");
        c.Execute("DELETE FROM [物料资料] WHERE [物料编号]=N'P5M1'");
        foreach (var d in new[] { "成品盘点明细单", "成品出仓明细单", "成品入仓明细单",
                                  "成品调拨明细单", "成品退货明细单", "成品退仓明细单" })
            c.Execute($"DELETE FROM [{d}] WHERE [生产单号]=N'P5SC01'");
        foreach (var h in new[] { "成品盘点单", "成品出仓单", "成品入仓单", "成品退货单", "成品退仓单" })
            c.Execute($"DELETE FROM [{h}] WHERE [仓库] IN (N'P5成品仓', N'P5半成品仓')");
        c.Execute("DELETE FROM [生产制单] WHERE [生产单号]=N'P5SC01'");
        c.Execute("DELETE FROM [款号总表] WHERE [款号]=N'P5K01'");
        c.Execute("DELETE FROM [客户资料] WHERE [客户编号]=N'P5C01'");
    }
}
