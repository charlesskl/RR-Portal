using SprayPlan.Api.Services;
using Xunit;

namespace SprayPlan.Api.Tests.Schedule;

public class UrgentCalcTests
{
    // ===== Slack：能缓几天 =====
    [Fact]
    public void Slack_交货日晚于完成日_返回天数差()
    {
        Assert.Equal(8, UrgentCalc.Slack(new DateTime(2026, 6, 30), new DateTime(2026, 6, 22)));
    }

    [Fact]
    public void Slack_完成日等于交货日_返回0()
    {
        Assert.Equal(0, UrgentCalc.Slack(new DateTime(2026, 6, 22), new DateTime(2026, 6, 22)));
    }

    [Fact]
    public void Slack_已超期_返回0不返回负数()
    {
        Assert.Equal(0, UrgentCalc.Slack(new DateTime(2026, 6, 20), new DateTime(2026, 6, 22)));
    }

    // ===== IsOverloaded：产能超载判断 =====
    [Fact]
    public void IsOverloaded_已排加拟占超上限_为真()
    {
        Assert.True(UrgentCalc.IsOverloaded(already: 100000, incoming: 30000, dailyLimit: 120000));
    }

    [Fact]
    public void IsOverloaded_正好等于上限_不算超()
    {
        Assert.False(UrgentCalc.IsOverloaded(already: 90000, incoming: 30000, dailyLimit: 120000));
    }

    [Fact]
    public void IsOverloaded_上限为0不卡_永不超载()
    {
        Assert.False(UrgentCalc.IsOverloaded(already: 999999, incoming: 999999, dailyLimit: 0));
    }

    // ===== Postpone：整单顺延跳节假日 =====
    [Fact]
    public void Postpone_无节假日_直接加天数()
    {
        var r = UrgentCalc.Postpone(new DateTime(2026, 6, 22), 3, new HashSet<DateTime>());
        Assert.Equal(new DateTime(2026, 6, 25), r);
    }

    [Fact]
    public void Postpone_遇节假日跳过_顺延落在可排日()
    {
        // 6/23、6/24 休息 → 从 6/22 顺延 2 个可排日 = 6/26（跳过 23、24）
        var holidays = new HashSet<DateTime> { new DateTime(2026, 6, 23), new DateTime(2026, 6, 24) };
        var r = UrgentCalc.Postpone(new DateTime(2026, 6, 22), 2, holidays);
        Assert.Equal(new DateTime(2026, 6, 26), r);
    }

    [Fact]
    public void Postpone_零天_原样返回()
    {
        var r = UrgentCalc.Postpone(new DateTime(2026, 6, 22), 0, new HashSet<DateTime>());
        Assert.Equal(new DateTime(2026, 6, 22), r);
    }
}
