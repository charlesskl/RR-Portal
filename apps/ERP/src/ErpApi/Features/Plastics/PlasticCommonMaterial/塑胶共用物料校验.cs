using Dapper;
using ErpApi.Infrastructure.Db;

namespace ErpApi.Features.Plastics.PlasticCommonMaterial;

// 旧说明书核心规则:套数 = 出模数 ÷ 用量(用量通常固定为 1;允许 1.5/0.5 等小数套数)。
// 三值任一为空不校验(向后兼容);按库存储精度 4 位小数比较。
public static class 塑胶共用物料校验
{
    public const string 套数错误消息 = "套数必须等于 出模数 ÷ 用量";
    public const string 工模编号不存在消息 = "工模编号不存在于工模表";

    public static string? 校验套数(decimal? 套数, decimal? 出模数, decimal? 用量)
    {
        if (套数 is null || 出模数 is null || 用量 is null) return null;
        if (用量.Value == 0) return 套数错误消息;
        var expected = Math.Round(出模数.Value / 用量.Value, 4, MidpointRounding.AwayFromZero);
        var actual = Math.Round(套数.Value, 4, MidpointRounding.AwayFromZero);
        return expected == actual ? null : 套数错误消息;
    }

    // 纯逻辑:工模编号留空(手输留空兼容)不校验;非空白才查工模表存在性
    public static bool 需校验工模编号(string? 工模编号) => !string.IsNullOrWhiteSpace(工模编号);

    // 数据互通:工模编号非空时必须存在于工模表(工模编号录入时统一大写,故比较前规范化)
    public static async Task<string?> 校验工模编号存在(ISqlConnectionFactory factory, string? 工模编号)
    {
        if (!需校验工模编号(工模编号)) return null;
        var code = 工模编号!.Trim().ToUpperInvariant();
        using var c = factory.Create();
        var n = await c.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM [工模表] WHERE [工模编号]=@code", new { code });
        return n > 0 ? null : 工模编号不存在消息;
    }
}
