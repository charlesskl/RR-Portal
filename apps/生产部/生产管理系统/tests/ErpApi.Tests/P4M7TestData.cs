using Dapper;
using Microsoft.Data.SqlClient;

// P4 M7 测试种子：复用 P4TestData(客户 P4C01/加工厂 P4F01/款号 P4K01/生产单 P4SC01) +
// 发外加工项目 P4车缝(单价2.5)。发外派工/回收单据由各测试用返回单号精确删，此处兜底按加工厂/生产单删。
public static class P4M7TestData
{
    public const string 加工项目 = "P4车缝";
    public const decimal 单价 = 2.5m;

    public static void Seed(SqlConnection c)
    {
        Cleanup(c);
        P4TestData.Seed(c);   // 客户/加工厂/款号/人事/生产制单/工序表
        c.Execute("INSERT INTO [发外加工项目]([加工项目],[单价],[备注]) VALUES(N'P4车缝',2.5,N'P4测试发外项目')");
    }

    // 反 FK 顺序清理
    public static void Cleanup(SqlConnection c)
    {
        c.Execute("DELETE FROM [发外回收明细单] WHERE [生产单号]=N'P4SC01'");
        c.Execute("DELETE FROM [发外回收单] WHERE [加工厂编号]=N'P4F01'");
        c.Execute("DELETE FROM [发外加工明细单] WHERE [生产单号]=N'P4SC01'");
        c.Execute("DELETE FROM [发外加工单] WHERE [加工厂编号]=N'P4F01'");
        c.Execute("DELETE FROM [发外加工项目] WHERE [加工项目]=N'P4车缝'");
        P4TestData.Cleanup(c);
    }
}
