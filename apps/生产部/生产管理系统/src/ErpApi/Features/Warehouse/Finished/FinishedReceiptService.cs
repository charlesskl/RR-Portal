using Dapper;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.MasterData;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Warehouse.Finished;

// 成品入仓（玩具模型·自由选产品版）。两层：成品入仓单 + 成品入仓明细单(单号 主从)。
// 明细带 审核 列（成品库存按明细审核过滤，审核/反审核由本服务 ApproveAsync/UnapproveAsync 一个事务同步）。
// audit 可空(DI 注入;测试不传时不写审计)。
public sealed class FinishedReceiptService(ISqlConnectionFactory factory, IDocumentNumberGenerator docNo, IAuditLogger? audit = null)
{
    public const string DocType = "成品入仓单";
    public const string Prefix = "CR";

    public async Task<string> CreateAsync(FinishedReceiptCreateDto dto, string user)
    {
        using var c = factory.Create(); await c.OpenAsync(); using var tx = c.BeginTransaction();
        var now = dto.日期?.Date ?? DateTime.Today;
        var 单号 = await docNo.NextAsync(DocType, Prefix, now, c, tx);
        await SaveCoreAsync(c, tx, 单号, dto, user, now, false);
        tx.Commit();
        return 单号;
    }

    public async Task<bool> UpdateAsync(string 单号, FinishedReceiptCreateDto dto, string user)
    {
        using var c = factory.Create(); await c.OpenAsync(); using var tx = c.BeginTransaction();
        var audit = await c.ExecuteScalarAsync<string?>("SELECT ISNULL([审核],'0') FROM [成品入仓单] WITH (UPDLOCK,HOLDLOCK) WHERE [单号]=@单号", new { 单号 }, tx);
        if (audit is null) return false;
        if (audit == "1") throw new InvalidOperationException("已审核的成品入仓单不能修改，请先反审核。");
        var date = await c.ExecuteScalarAsync<DateTime?>("SELECT [日期] FROM [成品入仓单] WHERE [单号]=@单号", new { 单号 }, tx) ?? DateTime.Today;
        await c.ExecuteAsync("DELETE FROM [成品入仓明细单] WHERE [单号]=@单号", new { 单号 }, tx);
        await SaveCoreAsync(c, tx, 单号, dto, user, dto.日期?.Date ?? date, true);
        tx.Commit();
        return true;
    }

    private static async Task SaveCoreAsync(System.Data.IDbConnection c, System.Data.IDbTransaction tx, string 单号, FinishedReceiptCreateDto dto, string user, DateTime date, bool update)
    {
        if (dto.明细.Count == 0) throw new ArgumentException("成品入仓至少要有一行明细。");
        if (dto.明细.Any(x => string.IsNullOrWhiteSpace(x.配件编号))) throw new ArgumentException("配件编号必填。");
        if (dto.明细.Any(x => x.数量 <= 0)) throw new ArgumentException("入仓数量必须大于 0。");
        // 规则:半成品未审核不能入成品——明细带生产单号时,要求该生产单已有已审核的半成品入仓
        foreach (var mo in dto.明细.Select(x => x.生产单号?.Trim()).Where(m => !string.IsNullOrEmpty(m)).Distinct())
        {
            var audited = await c.ExecuteScalarAsync<int>(@"SELECT COUNT(*) FROM [半成品入仓明细单] d
JOIN [半成品入仓单] h ON h.[单号]=d.[单号]
WHERE ISNULL(h.[审核],'0')='1' AND d.[生产单号]=@mo", new { mo }, tx);
            if (audited == 0) throw new ArgumentException($"生产单号 {mo} 没有已审核的半成品入仓，半成品未审核不能入成品。");
        }
        // 计划数量封顶:同一生产单+货号的已审核入仓累计+本次不得超 生产制单.计划数量(可分多次累积入仓)
        foreach (var g in dto.明细
            .Where(x => !string.IsNullOrWhiteSpace(x.生产单号) && !string.IsNullOrWhiteSpace(x.产品货号))
            .GroupBy(x => (生产单号: x.生产单号!.Trim(), 货号: x.产品货号!.Trim())))
        {
            var plan = await c.ExecuteScalarAsync<decimal?>(
                "SELECT [计划数量] FROM [生产制单] WHERE [生产单号]=@mo", new { mo = g.Key.生产单号 }, tx);
            if (plan is null) continue;
            var done = await c.ExecuteScalarAsync<decimal>(@"SELECT ISNULL(SUM(d.[数量]),0) FROM [成品入仓明细单] d
JOIN [成品入仓单] h ON h.[单号]=d.[单号]
WHERE ISNULL(h.[审核],'0')='1' AND d.[生产单号]=@mo AND d.[货号]=@gno AND d.[单号]<>@ex",
                new { mo = g.Key.生产单号, gno = g.Key.货号, ex = 单号 }, tx);
            var cur = g.Sum(x => x.数量);
            if (done + cur > plan)
                throw new ArgumentException($"生产单号 {g.Key.生产单号} 货号 {g.Key.货号} 累计入成品不能超过计划数量：计划 {plan}，已入 {done}，本次 {cur}。");
        }
        var supplierCode = string.IsNullOrWhiteSpace(dto.供应商编号) ? null : dto.供应商编号.Trim();
        var warehouse = string.IsNullOrWhiteSpace(dto.仓库) ? "成品仓" : dto.仓库.Trim();
        var 数量 = dto.明细.Sum(l => l.数量);
        var 金额 = dto.明细.Sum(l => l.数量 * (l.单价 ?? 0m));

        var p = new { 单号, dto.订单单号, dto.入库单号, 日期 = date, 供应商编号 = supplierCode, dto.供应商名称, 仓库 = warehouse, 数量, 金额, 操作员 = user, dto.备注 };
        if (update)
            await c.ExecuteAsync(@"UPDATE [成品入仓单] SET [订单单号]=@订单单号,[入库单号]=@入库单号,[日期]=@日期,[供应商编号]=@供应商编号,[供应商名称]=@供应商名称,[仓库]=@仓库,[数量]=@数量,[金额]=@金额,[操作员]=@操作员,[备注]=@备注 WHERE [单号]=@单号", p, tx);
        else
            await c.ExecuteAsync(@"INSERT INTO [成品入仓单]([单号],[订单单号],[入库单号],[日期],[供应商编号],[供应商名称],[仓库],[数量],[金额],[操作员],[审核],[备注])
VALUES(@单号,@订单单号,@入库单号,@日期,@供应商编号,@供应商名称,@仓库,@数量,@金额,@操作员,'0',@备注)", p, tx);

        foreach (var l in dto.明细)
            await c.ExecuteAsync(@"INSERT INTO [成品入仓明细单]
([单号],[订单单号],[日期],[供应商编号],[供应商名称],[仓库],[生产单号],[款号],[配件编号],[客户],[货号],[名称],[产品装配名称],[箱数],[数量],[单价],[金额],[审核],[备注])
VALUES(@单号,@订单单号,@日期,@供应商编号,@供应商名称,@仓库,@生产单号,@款号,@配件编号,@客户,@货号,@名称,@产品装配名称,@箱数,@数量,@单价,@金额,'0',@备注)",
                new
                {
                    单号, 订单单号 = l.订单单号 ?? dto.订单单号, 日期 = date, 供应商编号 = supplierCode, dto.供应商名称, 仓库 = warehouse,
                    l.生产单号, 款号 = l.产品货号, 配件编号 = l.配件编号!.Trim(), l.客户, 货号 = l.产品货号, 名称 = l.产品名称,
                    l.产品装配名称, l.箱数, l.数量, 单价 = l.单价 ?? 0m, 金额 = l.数量 * (l.单价 ?? 0m), l.备注
                }, tx);
    }

    // 审核前校验(控制器在 svc.ApproveAsync 之前调用):从库里取明细走同一套规则
    // (半成品未审核不能入成品 + 累计入成品不超计划数量)
    public async Task ValidatePlanCapAsync(string 单号)
    {
        using var c = factory.Create();
        var lines = (await c.QueryAsync<FinishedReceiptLineDto>(
            "SELECT [生产单号],[货号] AS [产品货号],[数量] FROM [成品入仓明细单] WHERE [单号]=@单号", new { 单号 })).AsList();
        foreach (var mo in lines.Select(x => x.生产单号?.Trim()).Where(m => !string.IsNullOrEmpty(m)).Distinct())
        {
            var audited = await c.ExecuteScalarAsync<int>(@"SELECT COUNT(*) FROM [半成品入仓明细单] d
JOIN [半成品入仓单] h ON h.[单号]=d.[单号]
WHERE ISNULL(h.[审核],'0')='1' AND d.[生产单号]=@mo", new { mo });
            if (audited == 0) throw new ArgumentException($"生产单号 {mo} 没有已审核的半成品入仓，半成品未审核不能入成品。");
        }
        foreach (var g in lines
            .Where(x => !string.IsNullOrWhiteSpace(x.生产单号) && !string.IsNullOrWhiteSpace(x.产品货号))
            .GroupBy(x => (生产单号: x.生产单号!.Trim(), 货号: x.产品货号!.Trim())))
        {
            var plan = await c.ExecuteScalarAsync<decimal?>(
                "SELECT [计划数量] FROM [生产制单] WHERE [生产单号]=@mo", new { mo = g.Key.生产单号 });
            if (plan is null) continue;
            var done = await c.ExecuteScalarAsync<decimal>(@"SELECT ISNULL(SUM(d.[数量]),0) FROM [成品入仓明细单] d
JOIN [成品入仓单] h ON h.[单号]=d.[单号]
WHERE ISNULL(h.[审核],'0')='1' AND d.[生产单号]=@mo AND d.[货号]=@gno AND d.[单号]<>@ex",
                new { mo = g.Key.生产单号, gno = g.Key.货号, ex = 单号 });
            var cur = g.Sum(x => x.数量);
            if (done + cur > plan)
                throw new ArgumentException($"生产单号 {g.Key.生产单号} 货号 {g.Key.货号} 累计入成品不能超过计划数量：计划 {plan}，已入 {done}，本次 {cur}。");
        }
    }

    public async Task<PagedResult<FinishedReceiptHeaderDto>> ListAsync(int page, int size, string? keyword)
    {
        if (page < 1) page = 1;
        if (size < 1) size = 20;
        if (size > 1000) size = 1000;
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [成品入仓单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [订单单号] LIKE @kw OR [供应商名称] LIKE @kw OR [仓库] LIKE @kw;
SELECT [ID],[单号],[订单单号],[入库单号],[供应商编号],[供应商名称],[仓库],[日期],[数量],[金额],[操作员],[审核],[备注]
FROM [成品入仓单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [订单单号] LIKE @kw OR [供应商名称] LIKE @kw OR [仓库] LIKE @kw
ORDER BY [ID] DESC OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;", new { kw, page, size });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<FinishedReceiptHeaderDto>()).AsList();
        return new PagedResult<FinishedReceiptHeaderDto>(items, total);
    }

    public async Task<FinishedReceiptDetailDto?> GetAsync(string 单号)
    {
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT [ID],[单号],[订单单号],[入库单号],[供应商编号],[供应商名称],[仓库],[日期],[数量],[金额],[操作员],[审核],[备注] FROM [成品入仓单] WHERE [单号]=@单号;
SELECT [ID],[订单单号],[配件编号],[客户],COALESCE([货号],[款号]) AS [产品货号],[名称] AS [产品名称],[产品装配名称],[生产单号],[箱数],[数量],[单价],[金额],[备注]
FROM [成品入仓明细单] WHERE [单号]=@单号 ORDER BY [ID];", new { 单号 });
        var header = await multi.ReadFirstOrDefaultAsync<FinishedReceiptHeaderDto>();
        if (header is null) return null;
        var lines = (await multi.ReadAsync<FinishedReceiptLineRowDto>()).AsList();
        return new FinishedReceiptDetailDto { 单头 = header, 明细 = lines };
    }

    public async Task<FinishedReceiptDetailDto?> GetAdjacentAsync(string 单号, bool next)
    {
        using var c = factory.Create();
        var adjacent = await c.ExecuteScalarAsync<string?>(next
            ? "SELECT TOP (1) [单号] FROM [成品入仓单] WHERE [ID] > (SELECT [ID] FROM [成品入仓单] WHERE [单号]=@单号) ORDER BY [ID]"
            : "SELECT TOP (1) [单号] FROM [成品入仓单] WHERE [ID] < (SELECT [ID] FROM [成品入仓单] WHERE [单号]=@单号) ORDER BY [ID] DESC", new { 单号 });
        return adjacent is null ? null : await GetAsync(adjacent);
    }

    // 审核:一个事务里翻单头审核位 + 同步明细审核位(成品库存按明细.审核过滤,两步必须原子;不走 IPostingEngine)。
    // 并发靠单头 UPDLOCK/HOLDLOCK + 同事务回写。
    public async Task<bool> ApproveAsync(string 单号, string user)
    {
        using var c = factory.Create(); await c.OpenAsync(); using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [成品入仓单] WITH (UPDLOCK, HOLDLOCK) WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null || 审核 == "1") return false;
        await c.ExecuteAsync(
            "UPDATE [成品入仓单] SET [审核]='1',[审核人]=@user,[审核日期]=@now WHERE [单号]=@单号",
            new { 单号, user, now = DateTime.Now }, tx);
        await c.ExecuteAsync("UPDATE [成品入仓明细单] SET [审核]='1' WHERE [单号]=@单号", new { 单号 }, tx);
        if (audit is not null) await audit.WriteAsync(DocType, "审核", user, $"单号={单号}", c, tx);
        tx.Commit();
        return true;
    }

    // 反审核:同一事务翻回单头审核位 + 明细审核位清零。
    public async Task<bool> UnapproveAsync(string 单号, string user)
    {
        using var c = factory.Create(); await c.OpenAsync(); using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [成品入仓单] WITH (UPDLOCK, HOLDLOCK) WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null || 审核 != "1") return false;
        await c.ExecuteAsync(
            "UPDATE [成品入仓单] SET [审核]='0',[审核人]=NULL,[审核日期]=NULL WHERE [单号]=@单号", new { 单号 }, tx);
        await c.ExecuteAsync("UPDATE [成品入仓明细单] SET [审核]='0' WHERE [单号]=@单号", new { 单号 }, tx);
        if (audit is not null) await audit.WriteAsync(DocType, "反审核", user, $"单号={单号}", c, tx);
        tx.Commit();
        return true;
    }

    public async Task<bool> DeleteAsync(string 单号)
    {
        using var c = factory.Create(); await c.OpenAsync(); using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>("SELECT ISNULL([审核],'0') FROM [成品入仓单] WITH (UPDLOCK, HOLDLOCK) WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null) return false;
        if (审核 == "1") throw new InvalidOperationException("已审核的成品入仓单不能删除，请先反审核。");
        await c.ExecuteAsync("DELETE FROM [成品入仓明细单] WHERE [单号]=@单号", new { 单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [成品入仓单] WHERE [单号]=@单号", new { 单号 }, tx);
        tx.Commit();
        return true;
    }

    public async Task<PagedResult<FinishedReceiptProductRow>> ProductsAsync(FinishedReceiptProductQuery query)
    {
        var page = Math.Max(query.Page, 1);
        var size = Math.Clamp(query.Size, 1, 1000);
        var keyword = string.IsNullOrWhiteSpace(query.Keyword) ? null : query.Keyword.Trim();
        var match = keyword is null || query.Exact ? keyword : $"%{keyword}%";
        var comparer = query.Exact ? "=" : "LIKE";
        var field = query.Field switch
        {
            "产品名称" => "b.[产品名称]",
            "配件编号" => "b.[配件编号]",
            "客户" => "b.[客户]",
            "产品装配名称" => "b.[产品装配名称]",
            _ => "b.[产品货号]"
        };
        var cte = $@"
WITH LatestHeader AS (
    SELECT h.*, ROW_NUMBER() OVER (PARTITION BY h.[产品编号] ORDER BY h.[ID] DESC) AS rn
    FROM [款号物料总表] h WHERE NULLIF(LTRIM(RTRIM(h.[产品编号])), N'') IS NOT NULL
), Base AS (
    SELECT h.[产品编号] AS [配件编号],
           COALESCE(NULLIF(LTRIM(RTRIM(h.[客户名称])), N''), NULLIF(LTRIM(RTRIM(h.[客户])), N'')) AS [客户],
           h.[款号] AS [产品货号], NULLIF(LTRIM(RTRIM(h.[款式])), N'') AS [产品名称], NULLIF(LTRIM(RTRIM(h.[款式])), N'') AS [产品装配名称],
           CAST(NULL AS decimal(18,4)) AS [加工单价], CAST(NULL AS decimal(18,4)) AS [库存单价]
    FROM LatestHeader h
    LEFT JOIN [半成品共用物料设置] s ON s.[产品货号]=h.[款号]
    -- 装配类别决定仓别：只列 类别=成品；未设置装配扩展或未填类别的款号保持现状（两边都出现）
    WHERE h.rn=1 AND (s.[产品货号] IS NULL OR NULLIF(LTRIM(RTRIM(s.[类别])), N'') IS NULL OR s.[类别]=N'成品')
), Filtered AS (
    SELECT b.* FROM Base b
    WHERE NULLIF(LTRIM(RTRIM(b.[配件编号])), N'') IS NOT NULL AND (@keyword IS NULL OR {field} {comparer} @match)
)";
        var sql = $@"{cte}
SELECT COUNT(*) FROM Filtered;
{cte}
SELECT [配件编号],[客户],[产品货号],[产品名称],[产品装配名称],[加工单价],[库存单价]
FROM Filtered ORDER BY [产品货号],[配件编号]
OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;";
        using var c = factory.Create(); await c.OpenAsync();
        using var multi = await c.QueryMultipleAsync(sql, new { keyword, match, page, size });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<FinishedReceiptProductRow>()).AsList();
        return new(items, total);
    }
}
