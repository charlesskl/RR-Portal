using Dapper;
using Microsoft.Data.SqlClient;

// P5c 半成品仓储测试种子：客户 P5cC01 / 款号 P5cK01 / 生产单 P5cSC01 / 物料 P5cM1(物料资料) / 仓库 P5c半成品仓。
public static class P5cTestData
{
    public const string 客户编号 = "P5cC01";
    public const string 款号 = "P5cK01";
    public const string 生产单号 = "P5cSC01";
    public const string 物料编号 = "P5cM1";
    public const string 仓库 = "P5c半成品仓";

    public static void Seed(SqlConnection c)
    {
        Cleanup(c);
        c.Execute("INSERT INTO [客户资料]([客户编号],[客户名称]) VALUES(N'P5cC01',N'P5c测试客户')");
        c.Execute("INSERT INTO [款号总表]([款号],[款式]) VALUES(N'P5cK01',N'P5c测试款式')");
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[规格],[单位]) VALUES(N'P5cM1',N'P5c半成品料',N'规格A',N'件')");
        c.Execute(@"INSERT INTO [生产制单]([生产单号],[款号],[款式],[客户编号],[客户名称],[计划数量],[审核],[合同号])
                    VALUES(N'P5cSC01',N'P5cK01',N'P5c测试款式',N'P5cC01',N'P5c测试客户',100,'1',N'HT-P5C')");
    }

    public static void Cleanup(SqlConnection c)
    {
        foreach (var d in new[] { "半成品盘点明细单", "半成品领料明细单", "半成品入仓明细单" })
            c.Execute($"DELETE FROM [{d}] WHERE [生产单号]=N'P5cSC01'");
        foreach (var h in new[] { "半成品盘点单", "半成品领料单", "半成品入仓单" })
            c.Execute($"DELETE FROM [{h}] WHERE [仓库]=N'P5c半成品仓'");
        c.Execute("DELETE FROM [生产制单] WHERE [生产单号]=N'P5cSC01'");
        c.Execute("DELETE FROM [物料资料] WHERE [物料编号]=N'P5cM1'");
        c.Execute("DELETE FROM [款号总表] WHERE [款号]=N'P5cK01'");
        c.Execute("DELETE FROM [客户资料] WHERE [客户编号]=N'P5cC01'");
    }
}
