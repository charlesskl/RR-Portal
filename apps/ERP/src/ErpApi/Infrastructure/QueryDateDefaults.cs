namespace ErpApi.Infrastructure;

// 查询/报表端点 起/止 日期兜底:非可空 DateTime 参数缺省时绑定成 DateTime.MinValue,
// 直接传 SQL datetime 参数会 SqlDateTime 溢出 → 500。统一缺省 起=1900-01-01、止=2099-12-31,
// 让缺参返回全量/空表而不是 500。
public static class QueryDateDefaults
{
    public static readonly DateTime 默认起 = new(1900, 1, 1);
    public static readonly DateTime 默认止 = new(2099, 12, 31);

    public static (DateTime 起, DateTime 止) Normalize(DateTime 起, DateTime 止)
        => (起 == default ? 默认起 : 起, 止 == default ? 默认止 : 止);
}
