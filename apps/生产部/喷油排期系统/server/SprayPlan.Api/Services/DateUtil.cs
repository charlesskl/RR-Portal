using System.Globalization;

namespace SprayPlan.Api.Services;

// 日期解析统一工具。
// 把日期字符串(YYYY-MM-DD 或 ISO)按 UTC 解析，匹配 JS new Date(str) 对 date-only 的 UTC 行为，
// 保证 .NET 写入与前端 Prisma 存的 UTC 零点毫秒一致（前后端共用 dev.db 的前提），
// 也保证甘特"预计出单日"按天加减不串日。
public static class DateUtil
{
    public static DateTime ParseUtc(string s)
        => DateTime.Parse(s, CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal);
}
