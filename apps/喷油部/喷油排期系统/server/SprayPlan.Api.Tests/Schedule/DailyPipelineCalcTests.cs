using System.Collections.Generic;
using System.Linq;
using SprayPlan.Api.Services;
using Xunit;

namespace SprayPlan.Api.Tests.Schedule;

// 工序链 P2：逐天流水线纯函数单测（摊道 + 正排模拟 + 飘红）
public class DailyPipelineCalcTests
{
    [Fact]
    public void CraftPriority_OrdersAutoHandPrintUv()
    {
        var crafts = new[] { "UV", "移印", "手喷", "自动喷" };
        var sorted = crafts.OrderBy(MonthlyScheduleCalc.CraftPriority).ToArray();
        Assert.Equal(new[] { "自动喷", "手喷", "移印", "UV" }, sorted);
    }

    [Fact]
    public void ExpandPasses_SingleCraft_RepeatsToPassCount()
    {
        var passes = MonthlyScheduleCalc.ExpandPasses(new List<string> { "自动喷" }, 4);
        Assert.Equal(new[] { 1, 2, 3, 4 }, passes.Select(p => p.StepNo).ToArray());
        Assert.All(passes, p => Assert.Equal("自动喷", p.Craft));
    }

    [Fact]
    public void ExpandPasses_MultiCraft_CyclesByPriority()
    {
        var passes = MonthlyScheduleCalc.ExpandPasses(new List<string> { "UV", "自动喷", "移印" }, 4);
        Assert.Equal(new[] { "自动喷", "移印", "UV", "自动喷" }, passes.Select(p => p.Craft).ToArray());
    }

    [Fact]
    public void ExpandPasses_TwoCraft_NoExtraThird()
    {
        var passes = MonthlyScheduleCalc.ExpandPasses(new List<string> { "移印", "手喷" }, 2);
        Assert.Equal(new[] { "手喷", "移印" }, passes.Select(p => p.Craft).ToArray());
    }

    [Fact]
    public void ExpandPasses_ZeroPasses_FallsBackToSingle()
    {
        var passes = MonthlyScheduleCalc.ExpandPasses(new List<string> { "移印" }, 0);
        Assert.Single(passes);
        Assert.Equal(1, passes[0].StepNo);
        Assert.Equal("移印", passes[0].Craft);
    }

    // 辅助：无节假日日历
    static MonthlyScheduleCalc.Calendar Cal() =>
        new(new HashSet<string>(), new HashSet<string>());

    // 单部位 2 道（道1自动喷 / 道2移印各日产能 400），1000 件：
    // 验证 道2 任一天累计 ≤ 道1 同天累计（卡上游），且道2 第1天就能做（当天流转）。
    [Fact]
    public void Generate_TwoPass_DownstreamNeverExceedsUpstream_SameDayFlow()
    {
        var part = new MonthlyScheduleCalc.PartInput(
            SourcePartId: 1, ItemName: "兔子", PartName: "头", TotalDemand: 1000,
            DailyCapacity: 400, StdMachineCount: 1, Craft: "自动喷", IsTumbler: false,
            CraftPasses: 2, CraftSet: new List<string> { "自动喷", "移印" });
        var order = new MonthlyScheduleCalc.OrderInput(10, "2026-07-31", false,
            new List<MonthlyScheduleCalc.PartInput> { part });
        var lines = new List<MonthlyScheduleCalc.LineInput> {
            new(1, "自动喷拉", "自动喷", 0), new(2, "移印拉", "移印", 0),
        };

        var r = MonthlyScheduleCalc.Generate(new[] { order }, lines, "2026-07-01", 2, Cal());

        // 按日聚合每道累计
        var step1 = r.Rows.Where(x => x.StepNo == 1).OrderBy(x => x.PlanDate).ToList();
        var step2 = r.Rows.Where(x => x.StepNo == 2).OrderBy(x => x.PlanDate).ToList();
        Assert.Equal(1000, step1.Sum(x => x.PlannedQty));   // 道1 做满
        Assert.Equal(1000, step2.Sum(x => x.PlannedQty));   // 道2 做满
        // 卡上游：逐日累计，道2 累计 ≤ 道1 累计
        var days = r.Rows.Select(x => x.PlanDate).Distinct().OrderBy(x => x).ToList();
        int up = 0, down = 0;
        foreach (var d in days)
        {
            up += step1.Where(x => x.PlanDate == d).Sum(x => x.PlannedQty);
            down += step2.Where(x => x.PlanDate == d).Sum(x => x.PlannedQty);
            Assert.True(down <= up, $"道2累计{down} 超过 道1累计{up} 于 {d}");
        }
        // 当天流转：第一天道2 就有产出（>0）
        var firstDay = days.First();
        Assert.True(step2.Where(x => x.PlanDate == firstDay).Sum(x => x.PlannedQty) > 0);
    }

    // 两订单抢同一条移印拉（上限 500/天），各 1 道 500 件，交货日一早一晚：
    // 交货早的订单第一天占满，晚的当天 0、顺延次日。
    [Fact]
    public void Generate_CapacityContention_EarlierDueWinsFirstDay()
    {
        MonthlyScheduleCalc.PartInput P(int id) => new(id, "件", "主", 500, 500, 1, "移印", false, 1,
            new List<string> { "移印" });
        var early = new MonthlyScheduleCalc.OrderInput(1, "2026-07-10", false, new() { P(1) });
        var late = new MonthlyScheduleCalc.OrderInput(2, "2026-07-20", false, new() { P(2) });
        var lines = new List<MonthlyScheduleCalc.LineInput> { new(1, "移印拉", "移印", 500) };

        var r = MonthlyScheduleCalc.Generate(new[] { late, early }, lines, "2026-07-01", 2, Cal());

        var firstDay = r.Rows.Select(x => x.PlanDate).Min();
        var earlyFirst = r.Rows.Where(x => x.OrderId == 1 && x.PlanDate == firstDay).Sum(x => x.PlannedQty);
        var lateFirst = r.Rows.Where(x => x.OrderId == 2 && x.PlanDate == firstDay).Sum(x => x.PlannedQty);
        Assert.Equal(500, earlyFirst);   // 交货早的占满第一天
        Assert.Equal(0, lateFirst);      // 交货晚的第一天排不上
    }

    // 飘红：完工远早于交货 → green；产能不够拖到交货日之后 → red。
    [Fact]
    public void Generate_Forecast_RedYellowGreen()
    {
        // green：1 道 100 件、日产能 1000、交货 2026-07-31，1 天做完，早 ≥2 工作日
        var g = new MonthlyScheduleCalc.OrderInput(1, "2026-07-31", false,
            new() { new(1, "G", "主", 100, 1000, 1, "移印", false, 1, new List<string> { "移印" }) });
        // red：1 道 100000 件、日产能 1000、拉无限、交货 2026-07-02，做不完 → 迟
        var red = new MonthlyScheduleCalc.OrderInput(2, "2026-07-02", false,
            new() { new(2, "R", "主", 100000, 1000, 1, "移印", false, 1, new List<string> { "移印" }) });
        var lines = new List<MonthlyScheduleCalc.LineInput> { new(1, "移印拉", "移印", 0) };

        var r = MonthlyScheduleCalc.Generate(new[] { g, red }, lines, "2026-07-01", 2, Cal());
        var fg = r.Forecasts.First(f => f.OrderId == 1);
        var fr = r.Forecasts.First(f => f.OrderId == 2);
        Assert.Equal("green", fg.Status);
        Assert.Equal("red", fr.Status);
        Assert.True(fr.LateWorkdays > 0);
    }
}
