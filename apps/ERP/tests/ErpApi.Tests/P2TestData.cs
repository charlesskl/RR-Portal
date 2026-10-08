using Dapper;
using Microsoft.Data.SqlClient;

// P2 测试共用种子：客户 P2TC01 / 物料 P2TM01,P2TM02 / 加工厂 P2TF01 /
// 款号 P2TK01(两道工序 1.5+2.5、两种物料 单件用量2和0.5、颜色2、尺码3)
public static class P2TestData
{
    public const string 客户编号 = "P2TC01";
    public const string 加工厂编号 = "P2TF01";
    public const string 款号 = "P2TK01";
    public const string 物料1 = "P2TM01";
    public const string 物料2 = "P2TM02";

    public static void Seed(SqlConnection c)
    {
        Cleanup(c);
        c.Execute("INSERT INTO [客户资料]([客户编号],[客户名称]) VALUES(N'P2TC01',N'P2测试客户')");
        c.Execute("INSERT INTO [加工厂资料]([加工厂编号],[加工厂名称]) VALUES(N'P2TF01',N'P2测试加工厂')");
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[单位],[单价]) VALUES(N'P2TM01',N'P2面料',N'米',10)");
        c.Execute("INSERT INTO [物料资料]([物料编号],[物料名称],[单位],[单价]) VALUES(N'P2TM02',N'P2纽扣',N'粒',0.2)");
        c.Execute("INSERT INTO [款号总表]([款号],[款式],[单价]) VALUES(N'P2TK01',N'P2测试款式',100)");
        c.Execute(@"INSERT INTO [款号明细表]([款号],[款式],[工序号],[工序名称],[单价],[工序类型])
                    VALUES(N'P2TK01',N'P2测试款式',N'01',N'裁床',1.5,N'裁床'),
                          (N'P2TK01',N'P2测试款式',N'02',N'车缝',2.5,N'车缝')");
        c.Execute(@"INSERT INTO [款号物料明细表]([款号],[款式],[物料编号],[物料名称],[单位],[使用数量])
                    VALUES(N'P2TK01',N'P2测试款式',N'P2TM01',N'P2面料',N'米',2),
                          (N'P2TK01',N'P2测试款式',N'P2TM02',N'P2纽扣',N'粒',0.5)");
        c.Execute(@"INSERT INTO [款号颜色表]([款号],[款式],[颜色编号],[颜色名称],[ID])
                    VALUES(N'P2TK01',N'P2测试款式',N'C1',N'黑色',1),(N'P2TK01',N'P2测试款式',N'C2',N'白色',2)");
        c.Execute(@"INSERT INTO [款号尺码表]([款号],[款式],[尺码],[ID])
                    VALUES(N'P2TK01',N'P2测试款式',N'S',1),(N'P2TK01',N'P2测试款式',N'M',2),(N'P2TK01',N'P2测试款式',N'L',3)");
    }

    // FK 顺序：先删单据子表→单头→款式子表→款式→物料/加工厂/客户
    public static void Cleanup(SqlConnection c)
    {
        c.Execute("DELETE FROM [生产BOM物料清单] WHERE [款号]=N'P2TK01'");
        c.Execute("DELETE FROM [生产制单工序表] WHERE [款号]=N'P2TK01'");
        c.Execute("DELETE FROM [生产制单数量] WHERE [款号]=N'P2TK01'");
        c.Execute("DELETE FROM [成品客户订单明细表] WHERE [款号]=N'P2TK01'");
        c.Execute("DELETE FROM [成品客户订单总表] WHERE [款号]=N'P2TK01'");
        c.Execute("DELETE FROM [成品客户订货单] WHERE [客户编号]=N'P2TC01'");
        c.Execute("DELETE FROM [生产制单] WHERE [款号]=N'P2TK01'");
        // 采购/退料/领料单明细引用物料编号（FK），须先删子表再删物料资料
        c.Execute("DELETE FROM [采购入仓明细单] WHERE [物料编号] IN (N'P2TM01',N'P2TM02')");
        c.Execute("DELETE FROM [退料明细单] WHERE [物料编号] IN (N'P2TM01',N'P2TM02')");
        c.Execute("DELETE FROM [领料明细单] WHERE [物料编号] IN (N'P2TM01',N'P2TM02')");
        c.Execute("DELETE FROM [款号物料明细表] WHERE [款号]=N'P2TK01'");
        c.Execute("DELETE FROM [款号明细表] WHERE [款号]=N'P2TK01'");
        c.Execute("DELETE FROM [款号颜色表] WHERE [款号]=N'P2TK01'");
        c.Execute("DELETE FROM [款号尺码表] WHERE [款号]=N'P2TK01'");
        c.Execute("DELETE FROM [款号总表] WHERE [款号]=N'P2TK01'");
        c.Execute("DELETE FROM [物料资料] WHERE [物料编号] IN (N'P2TM01',N'P2TM02')");
        c.Execute("DELETE FROM [加工厂资料] WHERE [加工厂编号]=N'P2TF01'");
        c.Execute("DELETE FROM [客户资料] WHERE [客户编号]=N'P2TC01'");
    }
}
