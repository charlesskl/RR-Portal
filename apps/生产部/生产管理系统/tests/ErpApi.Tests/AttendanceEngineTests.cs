using System;
using System.Collections.Generic;
using System.Linq;
using ErpApi.Features.Payroll;
using Xunit;

public class AttendanceEngineTests
{
    private static readonly ShiftDef 常日班 = new(
        new TimeSpan(8,0,0), new TimeSpan(12,0,0), new TimeSpan(13,0,0), new TimeSpan(17,0,0), 5, 5);
    private static DailyResult Run(ShiftDef s, params string[] hhmm)
        => AttendanceEngine.Compute(hhmm.Select(TimeSpan.Parse).ToList(), s);

    [Fact] public void 全勤无迟到早退加班()
    { var r = Run(常日班, "08:00","12:00","13:00","17:00");
      Assert.Equal(0, r.迟到分); Assert.Equal(0, r.早退分); Assert.Equal(0, r.加班);
      Assert.Equal(4, r.上午); Assert.Equal(4, r.下午); Assert.Equal(8, r.合计); }

    [Fact] public void 迟到20分扣宽限5()
    { var r = Run(常日班, "08:20","12:00","13:00","17:00");
      Assert.Equal(15, r.迟到分); Assert.Equal(1, r.迟到次数); }

    [Fact] public void 宽限内不算迟到()
    { var r = Run(常日班, "08:04","12:00","13:00","17:00");
      Assert.Equal(0, r.迟到分); Assert.Equal(0, r.迟到次数); }

    [Fact] public void 早退()
    { var r = Run(常日班, "08:00","12:00","13:00","16:30");
      Assert.Equal(25, r.早退分); Assert.Equal(1, r.早退次数); }

    [Fact] public void 加班1小时()
    { var r = Run(常日班, "08:00","12:00","13:00","18:00");
      Assert.Equal(1.0, r.加班); Assert.Equal(0, r.早退分); }

    [Fact] public void 只上午班()
    { var s = new ShiftDef(new TimeSpan(8,0,0), new TimeSpan(12,0,0), null, null, 5, 5);
      var r = Run(s, "08:00","12:00");
      Assert.Equal(4, r.上午); Assert.Equal(0, r.下午); Assert.Equal(4, r.合计); Assert.Equal(0, r.加班); }

    [Fact] public void 空刷卡为零()
    { var r = AttendanceEngine.Compute(new List<TimeSpan>(), 常日班);
      Assert.Equal(0, r.合计); Assert.Equal(0, r.迟到分); }
}
