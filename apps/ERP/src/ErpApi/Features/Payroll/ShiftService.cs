using System.Globalization;
using Dapper;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Payroll;

// 班次模板(考勤_排班表)CRUD。时刻列存基准日 1900-01-01 + HH:mm;读出格式化 "HH:mm"。按 识别 唯一。排班ID 非自增→MAX+1。
public sealed class ShiftService(ISqlConnectionFactory factory)
{
    private static readonly DateTime Base = new(1900, 1, 1);
    private static DateTime? ParseHm(string? hm)
        => string.IsNullOrWhiteSpace(hm) || !TimeSpan.TryParse(hm, CultureInfo.InvariantCulture, out var t) ? null : Base + t;
    private static string? FmtHm(DateTime? d) => d?.ToString("HH:mm");

    private static ShiftRow Map(dynamic r) => new()
    {
        识别 = r.识别, 名称 = r.名称,
        上午上班 = FmtHm((DateTime?)r.上午上班), 上午下班 = FmtHm((DateTime?)r.上午下班),
        下午上班 = FmtHm((DateTime?)r.下午上班), 下午下班 = FmtHm((DateTime?)r.下午下班),
        总小时 = (decimal?)(double?)r.总小时, 迟到分钟 = (decimal?)(double?)r.迟到分钟, 早退分钟 = (decimal?)(double?)r.早退分钟
    };

    public async Task<IReadOnlyList<ShiftRow>> ListAsync(string? keyword)
    {
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        var rows = await c.QueryAsync(@"
SELECT [识别],[名称],[上午上班],[上午下班],[下午上班],[下午下班],[总小时],[迟到分钟],[早退分钟]
FROM [考勤_排班表] WHERE @kw IS NULL OR [识别] LIKE @kw OR [名称] LIKE @kw ORDER BY [识别];", new { kw });
        return rows.Select(r => (ShiftRow)Map(r)).ToList();
    }

    public async Task<ShiftRow?> GetAsync(string 识别)
    {
        using var c = factory.Create();
        var r = await c.QueryFirstOrDefaultAsync(@"
SELECT [识别],[名称],[上午上班],[上午下班],[下午上班],[下午下班],[总小时],[迟到分钟],[早退分钟]
FROM [考勤_排班表] WHERE [识别]=@识别;", new { 识别 });
        return r is null ? null : Map(r);
    }

    public async Task SaveAsync(ShiftDto dto, string user)
    {
        if (string.IsNullOrWhiteSpace(dto.识别)) throw new ArgumentException("识别必填");
        using var c = factory.Create();
        await c.OpenAsync();
        var exists = await c.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM [考勤_排班表] WHERE [识别]=@识别", new { dto.识别 });
        var p = new {
            dto.识别, dto.名称,
            上午上班 = ParseHm(dto.上午上班), 上午下班 = ParseHm(dto.上午下班),
            下午上班 = ParseHm(dto.下午上班), 下午下班 = ParseHm(dto.下午下班),
            总小时 = dto.总小时, 迟到分钟 = dto.迟到分钟, 早退分钟 = dto.早退分钟
        };
        if (exists > 0)
            await c.ExecuteAsync(@"UPDATE [考勤_排班表] SET [名称]=@名称,[上午上班]=@上午上班,[上午下班]=@上午下班,
[下午上班]=@下午上班,[下午下班]=@下午下班,[总小时]=@总小时,[迟到分钟]=@迟到分钟,[早退分钟]=@早退分钟 WHERE [识别]=@识别", p);
        else
        {
            var nextId = await c.ExecuteScalarAsync<long>("SELECT ISNULL(MAX([排班ID]),0)+1 FROM [考勤_排班表]");
            await c.ExecuteAsync(@"INSERT INTO [考勤_排班表]([排班ID],[识别],[名称],[上午上班],[上午下班],[下午上班],[下午下班],[总小时],[迟到分钟],[早退分钟])
VALUES(@nextId,@识别,@名称,@上午上班,@上午下班,@下午上班,@下午下班,@总小时,@迟到分钟,@早退分钟)",
                new { nextId, p.识别, p.名称, p.上午上班, p.上午下班, p.下午上班, p.下午下班, p.总小时, p.迟到分钟, p.早退分钟 });
        }
    }

    public async Task<bool> DeleteAsync(string 识别)
    { using var c = factory.Create(); return await c.ExecuteAsync("DELETE FROM [考勤_排班表] WHERE [识别]=@识别", new { 识别 }) > 0; }
}
