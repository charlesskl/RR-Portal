using ErpApi.Integrations.Paiji;
using Xunit;

// 排产入库单 → ERP塑胶入仓单 反向同步映射的纯函数测试(不碰 HTTP/DB)。
public class PaijiSyncMappingTests
{
    [Theory]
    [InlineData("AT", "292", "兴信A(测试版)")]
    [InlineData("A", "101", "兴信A车间")]
    [InlineData("B", "102", "兴信B车间")]
    [InlineData("C", "112", "东莞华登塑胶制品有限公司")]
    [InlineData("W", "291", "外发部")]
    [InlineData("X", "291", "外发部")]   // 未知车间 → 外发部
    public void 车间供应商映射(string workshop, string 编号, string 名称)
    {
        var (no, name) = PaijiMapper.车间供应商(workshop);
        Assert.Equal(编号, no);
        Assert.Equal(名称, name);
    }

    [Fact]
    public void 单价换算_每啤价除以出模数()
    {
        var r = new PaijiWarehouseInRow { Id = 4, MoldNo = "92125", UnitPrice = 1.2m, Cavity = 6m, DeliveryPcs = 111111 };
        var line = PaijiMapper.ToReceiptLine(r, null);
        Assert.Equal(0.2m, line.单价);
    }

    [Fact]
    public void 单价换算_出模数空用原值()
    {
        var r = new PaijiWarehouseInRow { Id = 4, UnitPrice = 1.2m, Cavity = null };
        Assert.Equal(1.2m, PaijiMapper.ToReceiptLine(r, null).单价);
        r.Cavity = 0;
        Assert.Equal(1.2m, PaijiMapper.ToReceiptLine(r, null).单价);
    }

    [Fact]
    public void 单价为空则留空()
        => Assert.Null(PaijiMapper.ToReceiptLine(new PaijiWarehouseInRow { Id = 1, UnitPrice = null, Cavity = 6 }, null).单价);

    [Fact]
    public void 整行映射_匹配命中用物料档案编号名称()
    {
        var r = new PaijiWarehouseInRow
        {
            Id = 4, OrderNo = "2643939", MoldNo = "92125", PartName = "RBCEZ2-03M-01", Color = "11111",
            DeliveryPcs = 111111, UnitPrice = null, Cavity = null,
        };
        var line = PaijiMapper.ToReceiptLine(r, new PaijiMapper.Paiji物料匹配("57001643", "右耳朵"));
        Assert.Equal("2643939", line.生产单号);
        Assert.Equal("92125", line.款号);
        Assert.Equal("92125", line.塑胶货号);
        Assert.Equal("57001643", line.物料编号);      // 匹配命中:物料档案编号
        Assert.Equal("右耳朵", line.物料名称);          // 匹配命中:物料档案名称
        Assert.Equal("RBCEZ2-03M-01", line.工模编号); // part_name(模号)落工模编号
        Assert.Equal("11111", line.颜色);
        Assert.Equal("个", line.单位);
        Assert.Equal(111111m, line.数量);
        Assert.Equal("排产#4", line.备注);
    }

    [Fact]
    public void 整行映射_未命中回落旧口径()
    {
        var r = new PaijiWarehouseInRow { Id = 4, MoldNo = "92125", PartName = "RBCEZ2-03M-01" };
        var line = PaijiMapper.ToReceiptLine(r, null);
        Assert.Equal("92125", line.物料编号);            // 物料编号=货号
        Assert.Equal("RBCEZ2-03M-01", line.物料名称);    // 物料名称=part_name
        Assert.Equal("RBCEZ2-03M-01", line.工模编号);
    }

    [Theory]
    [InlineData("ERP:SR20260904002", true)]                       // ERP 回推的入仓行 → 跳过(防回环)
    [InlineData("  ERP:SR20260904002 备注", true)]                // 前导空白容错
    [InlineData("ERP:SP20260909002 交期:2026-09-22", false)]      // 车间对 ERP 推送采购单的真实入库 → 要同步
    [InlineData(null, false)]                                     // 无备注 → 要同步
    [InlineData("手工单", false)]
    public void 防回环只跳ERP回推入仓行(string? notes, bool 跳过)
        => Assert.Equal(跳过, PaijiMapper.是ERP回推入仓行(notes));

    [Fact]
    public void 分组按送货单号_空则各自成组()
    {
        var rows = new[]
        {
            new PaijiWarehouseInRow { Id = 1, DeliveryCode = "111" },
            new PaijiWarehouseInRow { Id = 2, DeliveryCode = "111" },
            new PaijiWarehouseInRow { Id = 3, DeliveryCode = "222" },
            new PaijiWarehouseInRow { Id = 4, DeliveryCode = null },
            new PaijiWarehouseInRow { Id = 5, DeliveryCode = "  " },
        };
        var groups = PaijiMapper.入库分组(rows).ToList();
        Assert.Equal(4, groups.Count);  // 111×2 同组,222 一组,两个空各自成组
        Assert.Equal(2, groups.Single(g => g.Key == "111").Count());
        Assert.Single(groups.Single(g => g.Key == "222"));
        Assert.Contains(groups, g => g.Key == "#4");
        Assert.Contains(groups, g => g.Key == "#5");
    }
}
