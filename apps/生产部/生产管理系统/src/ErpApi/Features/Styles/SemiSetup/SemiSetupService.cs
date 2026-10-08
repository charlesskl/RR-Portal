using Dapper;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Styles.SemiSetup;

// BOM 物料设置「设置半成品」：一个货号可定义多个命名半成品，
// 各自记录由该货号 BOM 里哪些物料组合而成（半成品设置/半成品设置明细）。
// 头部「用量」= 做 1 个成品要几个该半成品；明细「使用数量」= 做 1 个半成品要多少该物料,两个层级互不干扰。
// 与 半成品共用物料设置/SemiBomExpander 那套递归展开模型无关。
// 包装类型已并入半成品(117_merge_pack_into_semi.sql),不再接受 包装。
public sealed class SemiSetupService(ISqlConnectionFactory factory)
{
    private static readonly HashSet<string> 允许类型 = new(StringComparer.Ordinal) { "半成品" };

    // 该货号全部设置（按 顺序/ID 排），明细一次查出按头分组。
    public async Task<List<SemiSetupView>> ListAsync(string 货号)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        var heads = (await c.QueryAsync<HeadRow>(@"
SELECT [ID],[货号],[名称],[类型],[顺序],ISNULL([用量],1) AS [用量],[操作员],[创建时间]
FROM [半成品设置] WHERE [货号]=@货号
ORDER BY [顺序], [ID];", new { 货号 })).AsList();
        if (heads.Count == 0) return [];

        var ids = heads.Select(h => h.ID).ToArray();
        var lines = (await c.QueryAsync<LineRow>(@"
SELECT [头ID],[物料编号],[物料名称],[规格],[颜色],[单位],[使用数量]
FROM [半成品设置明细] WHERE [头ID] IN @ids
ORDER BY [ID];", new { ids })).AsList();
        var byHead = lines.GroupBy(l => l.头ID).ToDictionary(g => g.Key, g => g.ToList());

        return heads.Select(h => new SemiSetupView(
            h.ID, h.货号, h.名称, h.类型, h.顺序, h.用量, h.操作员, h.创建时间,
            (byHead.TryGetValue(h.ID, out var ls) ? ls : [])
                .Select(l => new SemiSetupLineDto(l.物料编号, l.物料名称, l.规格, l.颜色, l.单位, l.使用数量))
                .ToList())).ToList();
    }

    // 新建一组设置：头部（顺序=该货号该类型 max+1）+ 明细，一个事务。
    public async Task<long> CreateAsync(SemiSetupSaveDto dto, string 用户)
    {
        var 货号 = dto.货号?.Trim() ?? "";
        var 名称 = dto.名称?.Trim() ?? "";
        var 类型 = dto.类型?.Trim() ?? "";
        if (货号.Length == 0) throw new InvalidOperationException("货号不能为空。");
        if (名称.Length == 0) throw new InvalidOperationException("请填写名称。");
        if (!允许类型.Contains(类型)) throw new InvalidOperationException("类型只能是 半成品。");
        var 用量 = dto.用量 ?? 1;
        if (用量 <= 0) throw new InvalidOperationException("用量必须大于 0。");
        var 明细 = (dto.明细 ?? [])
            .Where(l => !string.IsNullOrWhiteSpace(l.物料编号))
            .Select(l => l with { 物料编号 = l.物料编号.Trim() })
            .ToList();
        if (明细.Count == 0) throw new InvalidOperationException("请至少勾选 1 行物料。");

        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        try
        {
            var 顺序 = await c.ExecuteScalarAsync<int>(
                "SELECT ISNULL(MAX([顺序]),0)+1 FROM [半成品设置] WITH (UPDLOCK, HOLDLOCK) WHERE [货号]=@货号 AND [类型]=@类型;",
                new { 货号, 类型 }, tx);
            var id = await c.ExecuteScalarAsync<long>(@"
INSERT INTO [半成品设置]([货号],[名称],[类型],[顺序],[用量],[操作员])
OUTPUT INSERTED.[ID]
VALUES(@货号,@名称,@类型,@顺序,@用量,@操作员);",
                new { 货号, 名称, 类型, 顺序, 用量, 操作员 = 用户 }, tx);
            foreach (var l in 明细)
                await c.ExecuteAsync(@"
INSERT INTO [半成品设置明细]([头ID],[物料编号],[物料名称],[规格],[颜色],[单位],[使用数量])
VALUES(@头ID,@物料编号,@物料名称,@规格,@颜色,@单位,@使用数量);",
                    new { 头ID = id, l.物料编号, l.物料名称, l.规格, l.颜色, l.单位, l.使用数量 }, tx);
            tx.Commit();
            return id;
        }
        catch
        {
            tx.Rollback();
            throw;
        }
    }

    // 修改一组设置：名称/类型可改(货号/顺序/创建时间不动),明细整组替换,一个事务。id 不存在返回 false。
    public async Task<bool> UpdateAsync(long id, SemiSetupSaveDto dto, string 用户)
    {
        var 名称 = dto.名称?.Trim() ?? "";
        var 类型 = dto.类型?.Trim() ?? "";
        if (名称.Length == 0) throw new InvalidOperationException("请填写名称。");
        if (!允许类型.Contains(类型)) throw new InvalidOperationException("类型只能是 半成品。");
        var 用量 = dto.用量 ?? 1;
        if (用量 <= 0) throw new InvalidOperationException("用量必须大于 0。");
        var 明细 = (dto.明细 ?? [])
            .Where(l => !string.IsNullOrWhiteSpace(l.物料编号))
            .Select(l => l with { 物料编号 = l.物料编号.Trim() })
            .ToList();
        if (明细.Count == 0) throw new InvalidOperationException("请至少勾选 1 行物料。");

        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        try
        {
            var n = await c.ExecuteAsync(@"
UPDATE [半成品设置] SET [名称]=@名称,[类型]=@类型,[用量]=@用量,[操作员]=@操作员 WHERE [ID]=@id;",
                new { id, 名称, 类型, 用量, 操作员 = 用户 }, tx);
            if (n == 0) { tx.Rollback(); return false; }
            await c.ExecuteAsync("DELETE FROM [半成品设置明细] WHERE [头ID]=@id;", new { id }, tx);
            foreach (var l in 明细)
                await c.ExecuteAsync(@"
INSERT INTO [半成品设置明细]([头ID],[物料编号],[物料名称],[规格],[颜色],[单位],[使用数量])
VALUES(@头ID,@物料编号,@物料名称,@规格,@颜色,@单位,@使用数量);",
                    new { 头ID = id, l.物料编号, l.物料名称, l.规格, l.颜色, l.单位, l.使用数量 }, tx);
            tx.Commit();
            return true;
        }
        catch
        {
            tx.Rollback();
            throw;
        }
    }

    // 删除一组设置：明细 + 头部，一个事务。
    public async Task DeleteAsync(long id)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        try
        {
            await c.ExecuteAsync("DELETE FROM [半成品设置明细] WHERE [头ID]=@id;", new { id }, tx);
            await c.ExecuteAsync("DELETE FROM [半成品设置] WHERE [ID]=@id;", new { id }, tx);
            tx.Commit();
        }
        catch
        {
            tx.Rollback();
            throw;
        }
    }

    private sealed record HeadRow(long ID, string 货号, string 名称, string 类型, int 顺序, decimal 用量, string? 操作员, DateTime 创建时间);
    private sealed record LineRow(long 头ID, string 物料编号, string? 物料名称, string? 规格, string? 颜色, string? 单位, decimal? 使用数量);
}
