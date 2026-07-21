namespace SprayPlan.Api.Services;

// 急单功能纯计算（不碰 DB / HTTP，方便单测）。详见 spec 2026-06-16-urgent-order-design §4、§6。
public static class UrgentCalc
{
    /// <summary>
    /// 能缓几天 = max(0, 交货日 − 当前预计完成日 的天数)。
    /// 负数（已超期）按 0：超期单不适合停。只看日历天（口径简单，验收可再细化）。
    /// </summary>
    public static int Slack(DateTime deliveryDate, DateTime currentFinish)
        => Math.Max(0, (deliveryDate.Date - currentFinish.Date).Days);

    /// <summary>
    /// 某拉某天是否超载 = 上限>0 且 已排+拟占 > 上限。上限=0（不卡）→ 永不超载。
    /// </summary>
    public static bool IsOverloaded(int already, int incoming, int dailyLimit)
        => dailyLimit > 0 && already + incoming > dailyLimit;

    /// <summary>
    /// 整单顺延：把某日期往后挪 days 个「可排日」（跳节假日/周末，已并入 holidays）。
    /// days=0 原样返回。用于被停单整单平移 + 算新完成日。
    /// </summary>
    public static DateTime Postpone(DateTime date, int days, ISet<DateTime> holidays)
    {
        var d = date.Date;
        int moved = 0;
        while (moved < days)
        {
            d = d.AddDays(1);
            if (!holidays.Contains(d)) moved++;
        }
        return d;
    }
}
