using Dapper;
using Xunit;

// 生产通知单 第①片：改表(单头加列 + 生产制单货号表 + 子表/P4 加货号列) + 数据回填 的校验测试。
[Collection("db")]
public class ProductionNoticeSchemaDbTests(DbFixture fx)
{
    [SkippableFact]
    public void Schema_has_new_columns_and_table()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();

        // 单头 5 新列
        foreach (var col in new[] { "订单类型", "标识", "装箱方式", "订单总箱数", "默认单价" })
            Assert.True(c.ExecuteScalar<int?>(
                $"SELECT COL_LENGTH(N'生产制单', N'{col}')") is not null,
                $"生产制单.{col} 应存在");

        // 子表 + P4 货号列
        foreach (var tbl in new[] { "生产制单数量", "生产制单工序表", "生产BOM物料清单", "裁床总表", "计件表" })
            Assert.True(c.ExecuteScalar<int?>(
                $"SELECT COL_LENGTH(N'{tbl}', N'货号')") is not null,
                $"{tbl}.货号 应存在");

        // 新表
        Assert.True(c.ExecuteScalar<int?>(
            "SELECT OBJECT_ID(N'生产制单货号', N'U')") is not null, "生产制单货号 表应存在");
    }

    [SkippableFact]
    public void Backfill_fills_货号_from_款号_and_creates_货号_row()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        using var c = fx.Open();
        // 款号有 FK → 款号总表，借 P2 种子提供合法 款号 P2TK01
        P2TestData.Seed(c);
        try
        {
            // 旧式单(子表 货号 NULL)
            c.Execute("INSERT INTO [生产制单]([生产单号],[款号],[款式],[计划数量],[审核]) VALUES(N'PN_S1',N'P2TK01',N'P2测试款式',100,'0')");
            c.Execute("INSERT INTO [生产制单数量]([生产单号],[款号],[颜色],[尺码],[数量],[货号]) VALUES(N'PN_S1',N'P2TK01',N'黑',N'M',100,NULL)");

            // 重跑本片回填语句(仅相关两条)
            c.Execute("UPDATE [生产制单数量] SET [货号]=[款号] WHERE [货号] IS NULL AND [款号] IS NOT NULL");
            c.Execute(@"INSERT INTO [生产制单货号]([生产单号],[序号],[货号],[BOM款号],[款号名称],[数量],[比例],[分析])
                        SELECT p.[生产单号],1,p.[款号],p.[款号],p.[款式],p.[计划数量],1,0
                        FROM [生产制单] p
                        WHERE p.[款号] IS NOT NULL
                          AND NOT EXISTS(SELECT 1 FROM [生产制单货号] g WHERE g.[生产单号]=p.[生产单号])");

            Assert.Equal("P2TK01", c.ExecuteScalar<string>(
                "SELECT [货号] FROM [生产制单数量] WHERE [生产单号]=N'PN_S1'"));

            Assert.Equal("P2TK01", c.ExecuteScalar<string>(
                "SELECT [货号] FROM [生产制单货号] WHERE [生产单号]=N'PN_S1'"));
            Assert.Equal(1, c.ExecuteScalar<int>(
                "SELECT COUNT(*) FROM [生产制单货号] WHERE [生产单号]=N'PN_S1'"));
        }
        finally
        {
            c.Execute("DELETE FROM [生产制单货号] WHERE [生产单号]=N'PN_S1'");
            c.Execute("DELETE FROM [生产制单数量] WHERE [生产单号]=N'PN_S1'");
            c.Execute("DELETE FROM [生产制单] WHERE [生产单号]=N'PN_S1'");
            P2TestData.Cleanup(c);
        }
    }
}
