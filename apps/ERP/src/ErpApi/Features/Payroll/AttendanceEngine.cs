namespace ErpApi.Features.Payroll;

public sealed record ShiftDef(
    TimeSpan? 上午上班, TimeSpan? 上午下班, TimeSpan? 下午上班, TimeSpan? 下午下班,
    double 迟到宽限, double 早退宽限);

public sealed record DailyResult(
    double 上午, double 下午, double 合计, double 加班,
    int 迟到分, int 早退分, int 迟到次数, int 早退次数);

// 算法10:刷卡配对班次→迟到/早退/加班/出勤工时。两段(上午+下午)+宽限。纯函数无DB。
// 配对简化:午休中点分上午/下午两组;每组最早=上班刷卡、最晚=下班刷卡。
public static class AttendanceEngine
{
    public static DailyResult Compute(IReadOnlyList<TimeSpan> 刷卡, ShiftDef 班次)
    {
        var punches = 刷卡.Where(t => t >= TimeSpan.Zero).OrderBy(t => t).ToList();
        if (punches.Count == 0 || 班次.上午上班 is null)
            return new DailyResult(0, 0, 0, 0, 0, 0, 0, 0);

        bool hasPm = 班次.下午上班 is not null && 班次.下午下班 is not null;
        var lunchMid = hasPm
            ? TimeSpan.FromTicks(((班次.上午下班 ?? 班次.上午上班.Value).Ticks + 班次.下午上班!.Value.Ticks) / 2)
            : TimeSpan.MaxValue;

        var am = punches.Where(t => t <= lunchMid).ToList();
        var pm = punches.Where(t => t > lunchMid).ToList();

        double 上午 = 0, 下午 = 0, 加班 = 0;
        int 迟到分 = 0, 早退分 = 0;

        if (am.Count > 0)
        {
            var amIn = am[0]; var amOut = am[^1];
            var sIn = 班次.上午上班.Value; var sOut = 班次.上午下班 ?? amOut;
            迟到分 = Clamp((int)Math.Round((amIn - sIn).TotalMinutes) - (int)班次.迟到宽限);
            上午 = WorkedHours(Max(amIn, sIn), Min(amOut, sOut));
            if (!hasPm)
            {
                早退分 = Clamp((int)Math.Round((sOut - amOut).TotalMinutes) - (int)班次.早退宽限);
                加班 = Math.Max(0, (amOut - sOut).TotalMinutes) / 60.0;
            }
        }
        if (hasPm && pm.Count > 0)
        {
            var pmIn = pm[0]; var pmOut = pm[^1];
            var sIn = 班次.下午上班!.Value; var sOut = 班次.下午下班!.Value;
            下午 = WorkedHours(Max(pmIn, sIn), Min(pmOut, sOut));
            早退分 = Clamp((int)Math.Round((sOut - pmOut).TotalMinutes) - (int)班次.早退宽限);
            加班 = Math.Max(0, (pmOut - sOut).TotalMinutes) / 60.0;
        }

        return new DailyResult(
            Round2(上午), Round2(下午), Round2(上午 + 下午), Round2(加班),
            迟到分, 早退分, 迟到分 > 0 ? 1 : 0, 早退分 > 0 ? 1 : 0);
    }

    private static int Clamp(int v) => v < 0 ? 0 : v;
    private static TimeSpan Max(TimeSpan a, TimeSpan b) => a > b ? a : b;
    private static TimeSpan Min(TimeSpan a, TimeSpan b) => a < b ? a : b;
    private static double WorkedHours(TimeSpan from, TimeSpan to) => to > from ? (to - from).TotalHours : 0;
    private static double Round2(double v) => Math.Round(v, 2);
}
