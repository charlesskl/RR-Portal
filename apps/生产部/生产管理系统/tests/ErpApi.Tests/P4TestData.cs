using Dapper;
using Microsoft.Data.SqlClient;

// P4 M6 测试种子：客户 P4C01 / 加工厂 P4F01 / 款号 P4K01 / 人事 P4E01(车缝工张三) /
// 生产制单 P4SC01(款号P4K01,计划数量100) + 生产制单工序表(01裁床1.5 / 02车缝2.5,计件单价来源)。
public static class P4TestData
{
    public const string 客户编号 = "P4C01";
    public const string 加工厂编号 = "P4F01";
    public const string 款号 = "P4K01";
    public const string 生产单号 = "P4SC01";
    public const string 员工号 = "P4E01";
    public const string 货号 = "P4H01";      // 主货号(单价 车缝=2.5)
    public const string 货号B = "P4H02";     // 同生产单第二货号，车缝工序单价不同(3.5) → 验证单价取值消歧义

    public static void Seed(SqlConnection c)
    {
        Cleanup(c);
        c.Execute("INSERT INTO [客户资料]([客户编号],[客户名称]) VALUES(N'P4C01',N'P4测试客户')");
        c.Execute("INSERT INTO [加工厂资料]([加工厂编号],[加工厂名称]) VALUES(N'P4F01',N'P4测试加工厂')");
        c.Execute("INSERT INTO [款号总表]([款号],[款式]) VALUES(N'P4K01',N'P4测试款式')");
        c.Execute(@"INSERT INTO [人事档案]([编号],[姓名],[工序类型]) VALUES(N'P4E01',N'张三',N'车缝')");
        c.Execute(@"INSERT INTO [生产制单]([生产单号],[款号],[款式],[客户编号],[客户名称],[加工厂编号],[加工厂名称],[计划数量],[审核])
                    VALUES(N'P4SC01',N'P4K01',N'P4测试款式',N'P4C01',N'P4测试客户',N'P4F01',N'P4测试加工厂',100,'1')");
        // 一单多货号：同一工序号(02车缝)在不同货号下单价不同(货号P4H01=2.5 / 货号P4H02=3.5)，
        // 用于验证计件单价按 生产单号+货号+工序号 取值消歧义。
        c.Execute(@"INSERT INTO [生产制单工序表]([生产单号],[款号],[货号],[款式],[工序号],[工序名称],[单价],[工序类型])
                    VALUES(N'P4SC01',N'P4K01',N'P4H01',N'P4测试款式',N'01',N'裁床',1.5,N'裁床'),
                          (N'P4SC01',N'P4K01',N'P4H01',N'P4测试款式',N'02',N'车缝',2.5,N'车缝'),
                          (N'P4SC01',N'P4K01',N'P4H02',N'P4测试款式',N'02',N'车缝',3.5,N'车缝')");
    }

    // 反 FK 顺序清理；裁床/计件由各测试用返回单号精确删，此处兜底按生产单号删。
    public static void Cleanup(SqlConnection c)
    {
        c.Execute("DELETE FROM [计件表] WHERE [生产单号]=N'P4SC01'");
        c.Execute("DELETE FROM [裁床明细表] WHERE [生产单号]=N'P4SC01'");
        c.Execute("DELETE FROM [裁床总表] WHERE [生产单号]=N'P4SC01'");
        c.Execute("DELETE FROM [生产制单工序表] WHERE [生产单号]=N'P4SC01'");
        c.Execute("DELETE FROM [生产制单] WHERE [生产单号]=N'P4SC01'");
        c.Execute("DELETE FROM [人事档案] WHERE [编号]=N'P4E01'");
        c.Execute("DELETE FROM [款号总表] WHERE [款号]=N'P4K01'");
        c.Execute("DELETE FROM [加工厂资料] WHERE [加工厂编号]=N'P4F01'");
        c.Execute("DELETE FROM [客户资料] WHERE [客户编号]=N'P4C01'");
    }
}
