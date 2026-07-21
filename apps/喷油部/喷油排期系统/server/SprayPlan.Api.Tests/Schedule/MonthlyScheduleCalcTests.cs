using SprayPlan.Api.Services;
using Xunit;

namespace SprayPlan.Api.Tests.Schedule;

// 月排纯函数测试（逐天正向流水线版）。算法 P2 已由倒排改正排：从 today 起按工作日往后铺，
// 下游不超上游、拉别每天硬顶 DailyCapacityLimit、排不完顺延（可能晚于交货日→红）。
// today 统一取 2026-06-25（周四，工作日）。摊道/卡上游/产能竞争/红黄绿见 DailyPipelineCalcTests。
public class MonthlyScheduleCalcTests
{
    static MonthlyScheduleCalc.Calendar Cal(string[]? off = null, string[]? on = null)
        => new(new HashSet<string>(off ?? new string[0]), new HashSet<string>(on ?? new string[0]));

    static MonthlyScheduleCalc.LineInput[] Lines(int yinLimit = 0, int autoLimit = 0, int uvLimit = 0, int handLimit = 0)
        => new[] {
            new MonthlyScheduleCalc.LineInput(1, "C拉：移印", "移印", yinLimit),
            new MonthlyScheduleCalc.LineInput(2, "A拉：自动喷", "自动喷", autoLimit),
            new MonthlyScheduleCalc.LineInput(3, "UV拉：UV", "UV", uvLimit),
            new MonthlyScheduleCalc.LineInput(4, "B拉：手喷", "手喷", handLimit),
        };

    // 单部位单道（craftPasses=0 → 摊道兜底单道 stepNo=1）
    static MonthlyScheduleCalc.OrderInput Order(int id, string due, int demand, int cap = 100, int std = 1,
        bool isMA = false, string craft = "移印", bool tumbler = false)
        => new(id, due, isMA, new List<MonthlyScheduleCalc.PartInput> {
            new(SourcePartId: id * 10, ItemName: "子", PartName: "部", TotalDemand: demand,
                DailyCapacity: cap, StdMachineCount: std, Craft: craft, IsTumbler: tumbler,
                CraftPasses: 0, CraftSet: new List<string> { craft }) });

    [Fact]
    public void ForwardSchedule_FillsFromToday()
    {
        // 150 件、日产能 100：从 today=06-25 起 06-25(100)+06-26(50)，完工早于交货→不逾期
        var r = MonthlyScheduleCalc.Generate(
            new[] { Order(1, "2026-07-10", 150) }, Lines(), today: "2026-06-25", bufferDays: 2, cal: Cal());
        var rows = r.Rows.Where(x => x.OrderId == 1).OrderBy(x => x.PlanDate).ToList();
        Assert.Equal(2, rows.Count);
        Assert.Equal("2026-06-25", rows[0].PlanDate);
        Assert.Equal("2026-06-26", rows[1].PlanDate);
        Assert.Equal(100, rows[0].PlannedQty);
        Assert.Equal(50, rows[1].PlannedQty);
        Assert.Equal(1, rows[0].LineId);
        Assert.Empty(r.Overdue);
    }

    [Fact]
    public void SkipsWeekend()
    {
        // 300 件/日100：06-25,06-26,(27/28 周末跳过),06-29
        var r = MonthlyScheduleCalc.Generate(new[] { Order(1, "2026-07-13", 300) }, Lines(), "2026-06-25", 2, Cal());
        var dates = r.Rows.Select(x => x.PlanDate).OrderBy(d => d).ToList();
        Assert.Equal(new[] { "2026-06-25", "2026-06-26", "2026-06-29" }, dates);
    }

    [Fact]
    public void SkipsHoliday_AllowsWorkdayMakeup()
    {
        // 200 件/日100，06-26 设为节假日：06-25,(06-26 跳过),06-29
        var r = MonthlyScheduleCalc.Generate(new[] { Order(1, "2026-07-13", 200) }, Lines(),
            "2026-06-25", 2, Cal(off: new[] { "2026-06-26" }));
        var dates = r.Rows.Select(x => x.PlanDate).OrderBy(d => d).ToList();
        Assert.Equal(new[] { "2026-06-25", "2026-06-29" }, dates);
    }

    [Fact]
    public void NoDeliveryDate_Excluded()
    {
        var r = MonthlyScheduleCalc.Generate(new[] { Order(1, "", 100) }, Lines(), "2026-06-25", 2, Cal());
        Assert.Empty(r.Rows);
        Assert.Contains(1, r.NoDeliveryDate);
    }

    [Fact]
    public void MA_Excluded()
    {
        var r = MonthlyScheduleCalc.Generate(new[] { Order(1, "2026-07-10", 100, isMA: true) }, Lines(), "2026-06-25", 2, Cal());
        Assert.Empty(r.Rows);
        Assert.Contains(1, r.MaSkipped);
    }

    [Fact]
    public void MultiPart_SameLine_EachFillsForward()
    {
        // 两部位都走移印拉（限0不卡）：部位10 需200→2行，部位11 需100→1行
        var order = new MonthlyScheduleCalc.OrderInput(1, "2026-07-10", false, new List<MonthlyScheduleCalc.PartInput> {
            new(10, "子", "头", 200, 100, 1, "移印", false, 0, new List<string> { "移印" }),
            new(11, "子", "身", 100, 100, 1, "移印", false, 0, new List<string> { "移印" }),
        });
        var r = MonthlyScheduleCalc.Generate(new[] { order }, Lines(), "2026-06-25", 2, Cal());
        Assert.Equal(2, r.Rows.Count(x => x.SourcePartId == 10));
        Assert.Equal(1, r.Rows.Count(x => x.SourcePartId == 11));
    }

    [Fact]
    public void PerLine_DifferentCrafts_SeparatePools()
    {
        // 移印单与自动喷单各走各拉，同日 06-25 各自做完
        var r = MonthlyScheduleCalc.Generate(new[] {
            Order(1, "2026-07-10", 100, cap: 100, craft: "移印"),
            Order(2, "2026-07-10", 100, cap: 100, craft: "自动喷"),
        }, Lines(yinLimit: 100, autoLimit: 120000), "2026-06-25", 2, Cal());
        var a = r.Rows.Single(x => x.OrderId == 1);
        var b = r.Rows.Single(x => x.OrderId == 2);
        Assert.Equal("2026-06-25", a.PlanDate);
        Assert.Equal("2026-06-25", b.PlanDate);
        Assert.Equal(1, a.LineId);
        Assert.Equal(2, b.LineId);
        Assert.Empty(r.OverloadedDays);
    }

    [Fact]
    public void Tumbler_GoesToHandLine_UnlimitedBucket()
    {
        // 炒货机部位走手喷拉但无限桶（不占拉别上限）：普通手喷单受 handLimit=50 约束，炒货机 500 当天做完
        var r = MonthlyScheduleCalc.Generate(new[] {
            Order(1, "2026-07-10", 50,  cap: 50,  craft: "手喷", tumbler: false),
            Order(2, "2026-07-10", 500, cap: 500, craft: "手喷", tumbler: true),
        }, Lines(handLimit: 50), "2026-06-25", 2, Cal());
        var normal = r.Rows.Single(x => x.OrderId == 1);
        var tumbler = r.Rows.Single(x => x.OrderId == 2);
        Assert.Equal(4, normal.LineId);
        Assert.Equal(4, tumbler.LineId);
        Assert.Equal("2026-06-25", normal.PlanDate);
        Assert.Equal("2026-06-25", tumbler.PlanDate);
        Assert.Equal(500, tumbler.PlannedQty);
        Assert.Empty(r.OverloadedDays);
    }

    [Fact]
    public void NoMatchingLine_GoesToNoLine()
    {
        var r = MonthlyScheduleCalc.Generate(new[] { Order(1, "2026-07-10", 100, craft: "UV") },
            new[] { new MonthlyScheduleCalc.LineInput(1, "C拉：移印", "移印", 0) }, "2026-06-25", 2, Cal());
        Assert.Empty(r.Rows);
        Assert.Contains(1, r.NoLine);
    }

    [Fact]
    public void Overdue_WhenCannotFinishByDelivery()
    {
        // 500 件/日100，today=07-06、交货 07-08：5 个工作日做完(到07-10)，晚于交货→红/逾期
        var r = MonthlyScheduleCalc.Generate(new[] { Order(1, "2026-07-08", 500) }, Lines(), "2026-07-06", 2, Cal());
        Assert.Contains(1, r.Overdue);
        Assert.Equal(500, r.Rows.Where(x => x.OrderId == 1).Sum(x => x.PlannedQty));
        Assert.Equal("red", r.Forecasts.Single(f => f.OrderId == 1).Status);
    }
}
