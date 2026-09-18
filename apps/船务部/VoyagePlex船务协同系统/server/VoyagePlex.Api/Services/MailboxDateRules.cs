using System.Globalization;

namespace VoyagePlex.Api.Services;

public static class MailboxDateRules
{
    // 船务每日邮件按中国标准时间划分；固定 UTC+8，不使用员工电脑时区。
    private static readonly TimeSpan ChinaTimeOffset = TimeSpan.FromHours(8);

    public static string ReceivedDate(string receivedAt)
    {
        if (!DateTimeOffset.TryParse(receivedAt, CultureInfo.InvariantCulture,
            DateTimeStyles.None, out var received))
            throw new FormatException("缺少有效的邮箱收件时间");
        return received.ToOffset(ChinaTimeOffset).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
    }
}
