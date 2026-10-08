using Dapper;
using Microsoft.Data.SqlClient;

// P3 测试共用种子：物料 P3M01(面料,单价10)/P3M02(纽扣,单价0.5)、供应商 P3S01。
// 三张物料单据明细的 物料编号 非 FK，但用真实物料更贴近生产；明细 款号/生产单号 是可空查找 FK，测试一律不填(NULL)。
public static class P3TestData
{
    public const string 物料1 = "P3M01";
    public const string 物料2 = "P3M02";
    public const string 供应商编号 = "P3S01";
    public const string 仓库 = "物料仓";

    public static void Seed(SqlConnection c)
    {
        Cleanup(c);
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[规格],[单位],[单价]) VALUES(N'P3M01',N'P3面料',N'规格A',N'米',10)");
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[规格],[单位],[单价]) VALUES(N'P3M02',N'P3纽扣',N'规格B',N'粒',0.5)");
        c.Execute("INSERT INTO [供应商资料]([供应商编号],[供应商名称]) VALUES(N'P3S01',N'P3测试供应商')");
    }

    // 兜底删明细(按测试物料)+删主数据；单据单头由各测试用返回的单号精确删除(单号引擎动态生成,不按前缀删单头以免误删)。
    public static void Cleanup(SqlConnection c)
    {
        c.Execute("DELETE FROM [采购入仓明细单] WHERE [物料编号] IN (N'P3M01',N'P3M02')");
        c.Execute("DELETE FROM [采购退仓明细单] WHERE [物料编号] IN (N'P3M01',N'P3M02')");
        c.Execute("DELETE FROM [领料明细单] WHERE [物料编号] IN (N'P3M01',N'P3M02')");
        c.Execute("DELETE FROM [退料明细单] WHERE [物料编号] IN (N'P3M01',N'P3M02')");
        c.Execute("DELETE FROM [供应商资料] WHERE [供应商编号]=N'P3S01'");
        c.Execute("DELETE FROM [物料资料] WHERE [物料编号] IN (N'P3M01',N'P3M02')");
    }
}
