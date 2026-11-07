using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.MasterData;
using ErpApi.Infrastructure.Db;
using ErpApi.Engines.Inventory;
using ErpApi.Engines.Authorization;
namespace ErpApi.Features.Plastics.PlasticRawMaterialStockIssue;

// 原料出库单(原料仓库·生产领料出库)。保存申请不扣库，最终审核在统一原料台账核对并扣减。
public sealed partial class PlasticRawMaterialStockIssueService(ISqlConnectionFactory factory, IDocumentNumberGenerator docNo,
    IAuditLogger? audit = null, IPermissionService? permissions = null)
{
    private readonly IPermissionService effectivePermissions = permissions ?? new PermissionService(factory);
    public const string DocType = "原料出库单";
    public const string Prefix = "YCK";   // 原料出库单号 = YCK + yyyyMMdd + 3位流水

    public async Task<string> CreateAsync(PlasticRawMaterialStockIssueCreateDto dto, string user)
    {
        if (dto.明细.Count == 0) throw new ArgumentException("原料出库单至少要有一行明细");
        var 数量合计 = dto.明细.Sum(l => l.数量);
        var now = DateTime.Now;

        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        await PlasticRawMaterialIssueSourcePolicy.NormalizeNewSourcesAsync(c, tx, dto.明细);
        await RawMaterialInventorySql.LockCodesAsync(c,tx,dto.明细.Select(l=>l.原料编号).OfType<string>());
        foreach (var source in dto.明细.SelectMany(l=>new[]{l.来源啤机采购单号,l.啤机外发单号,l.啤机生产单号})
                     .OfType<string>().Where(v=>v.Length>0).Distinct(StringComparer.OrdinalIgnoreCase).Order(StringComparer.OrdinalIgnoreCase))
            await ErpApi.Features.Plastics.RawMaterialSourceLock.LockDocumentAsync(c,tx,source);
        await PlasticRawMaterialIssueApprovalService.LockActorPermissionsAsync(c, tx, user);
        if (!await effectivePermissions.HasAsync(c, tx, user, "原料出库表", PermissionAction.打开)
            || !await effectivePermissions.HasAsync(c, tx, user, "原料出库表", PermissionAction.保存))
            throw new InvalidOperationException("当前账号没有原料领料打开及保存权限。");
        var 单号 = await docNo.NextAsync(DocType, Prefix, now, c, tx);

        await c.ExecuteAsync(@"
INSERT INTO [原料出库单]([单号],[生产车间],[日期],[电脑单号],[领料备注],[制单人],[操作员],[数量],[审核],[备注])
VALUES(@单号,@生产车间,@日期,@电脑单号,@领料备注,@制单人,@操作员,@数量,'0',@备注)",
            new { 单号, dto.生产车间, 日期 = now, dto.电脑单号, dto.领料备注, dto.制单人, 操作员 = user, 数量 = 数量合计, dto.备注 }, tx);

        foreach (var l in dto.明细)
            await c.ExecuteAsync(@"
INSERT INTO [原料出库明细单]([单号],[来源啤机采购单号],[啤机生产单号],[生产单号],[开单日期],[啤机外发单号],[原料编号],[原料名称],[产地],[每包重量],[单位],[数量],[备注])
VALUES(@单号,@来源啤机采购单号,@啤机生产单号,@生产单号,@开单日期,@啤机外发单号,@原料编号,@原料名称,@产地,@每包重量,@单位,@数量,@备注)",
                new { 单号, l.来源啤机采购单号, l.啤机生产单号, l.生产单号, l.开单日期, l.啤机外发单号, l.原料编号, l.原料名称, l.产地, l.每包重量, l.单位, l.数量, l.备注 }, tx);

        await RawMaterialInventorySql.EnsureIssueIsNotAutomaticAsync(c,tx,单号, requireApproved: false);
        await (audit ?? new AuditLogger()).WriteAsync(DocType, "新增", user, $"单号={单号}", c, tx);
        tx.Commit();
        return 单号;
    }

    public async Task<PagedResult<PlasticRawMaterialIssueSourceHeader>> SourcesAsync(int page, int size, string? keyword)
    {
        using var c = factory.Create();
        var sources = await RawMaterialProcurementPolicy.ReadMoldingSourcesAsync(c, null, page, size, keyword, approvedOnly: true);
        return new(sources.Items.Select(x => new PlasticRawMaterialIssueSourceHeader
        {
            单号 = x.单号, 订购日期 = x.日期, 供应商名称 = x.供应商名称, 原料种数 = x.原料种数
        }).ToList(), sources.Total);
    }

    public async Task<PlasticRawMaterialIssueSourceDetail?> SourceAsync(string number)
    {
        using var c = factory.Create();
        return await PlasticRawMaterialIssueSourcePolicy.ReadAsync(c, null, number);
    }

    public async Task<PagedResult<PlasticRawMaterialStockIssueHeaderDto>> ListAsync(int page, int size, string? keyword)
    {
        if (page < 1) page = 1;
        if (size < 1) size = 20;
        if (size > 1000) size = 1000;
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [原料出库单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [生产车间] LIKE @kw OR [制单人] LIKE @kw;
SELECT [ID],[单号],[生产车间],[日期],[电脑单号],[领料备注],[制单人],[操作员],[数量],[审核],[审核人],[备注],[主管审核],[主管审核人],[经理审核],[经理审核人]
FROM [原料出库单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [生产车间] LIKE @kw OR [制单人] LIKE @kw
ORDER BY [ID] DESC OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;", new { kw, page, size });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<PlasticRawMaterialStockIssueHeaderDto>()).AsList();
        return new PagedResult<PlasticRawMaterialStockIssueHeaderDto>(items, total);
    }

    public async Task<PlasticRawMaterialStockIssueDetailDto?> GetAsync(string 单号)
    {
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT [ID],[单号],[生产车间],[日期],[电脑单号],[领料备注],[制单人],[操作员],[数量],[审核],[审核人],[备注],[主管审核],[主管审核人],[经理审核],[经理审核人]
FROM [原料出库单] WHERE [单号]=@单号;
SELECT [ID],[来源啤机采购单号],[啤机生产单号],[生产单号],[开单日期],[啤机外发单号],[原料编号],[原料名称],[产地],[每包重量],[单位],[数量],[备注]
FROM [原料出库明细单] WHERE [单号]=@单号 ORDER BY [ID];", new { 单号 });
        var header = await multi.ReadFirstOrDefaultAsync<PlasticRawMaterialStockIssueHeaderDto>();
        if (header is null) return null;
        var lines = (await multi.ReadAsync<PlasticRawMaterialStockIssueLineDto>()).AsList();
        return new PlasticRawMaterialStockIssueDetailDto { 单头 = header, 明细 = lines };
    }

    public async Task<bool> DeleteAsync(string 单号, string? user = null)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        await RawMaterialInventorySql.LockDocumentAsync(c, tx, DocType, 单号);
        await PlasticRawMaterialIssueApprovalService.LockActorPermissionsAsync(c, tx, user ?? "");
        if (string.IsNullOrWhiteSpace(user)
            || !await effectivePermissions.HasAsync(c, tx, user, "原料出库表", PermissionAction.打开)
            || !await effectivePermissions.HasAsync(c, tx, user, "原料出库表", PermissionAction.删除))
            throw new InvalidOperationException("当前账号没有原料领料打开及删除权限。");
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [原料出库单] WITH (UPDLOCK, HOLDLOCK) WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null) return false;
        if (审核 == "1") throw new InvalidOperationException("已审核的原料出库单不能删除，请先反审核。");
        await c.ExecuteAsync("DELETE FROM [原料出库明细单] WHERE [单号]=@单号", new { 单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [原料出库单] WHERE [单号]=@单号", new { 单号 }, tx);
        await (audit ?? new AuditLogger()).WriteAsync(DocType, "删除", user ?? "", $"单号={单号}", c, tx);
        tx.Commit();
        return true;
    }

    public async Task<IReadOnlyList<PlasticRawMaterialIssueProgressDetailRow>> ProgressDetailAsync(
        DateTime? 起, DateTime? 止, string? keyword, string? 到货情况, string? 日期类型, string? 领料备注)
    {
        var qi = 起?.Date;
        var qe = 止?.Date.AddDays(1);
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var remark = string.IsNullOrWhiteSpace(领料备注) || 领料备注 == "全部" ? null : 领料备注.Trim();
        var onlyReceived = 到货情况 == "已到" ? 1 : 0;
        var onlyNotReceived = 到货情况 == "未到" ? 1 : 0;
        var dateCol = 日期类型 switch
        {
            "开单日期" => "h.[开单日期]",
            "领料日期" => "lk.[领料日期]",
            _ => null
        };
        var dateWhere = dateCol is null ? "" : $"  AND (@qi IS NULL OR {dateCol} >= @qi)\n  AND (@qe IS NULL OR {dateCol} < @qe)\n";

        using var c = factory.Create();
        var automatic = await ReadAutomaticProgressAsync(c);
        var rows = await c.QueryAsync<PlasticRawMaterialIssueProgressDetailRow>($@"
WITH 领料 AS (
    SELECT ih.[领料备注],
           il.[啤机生产单号],
           il.[原料编号],
           il.[啤机外发单号],
           ih.[日期] AS 领料日期,
           il.[单号] AS 领料单号,
           ISNULL(il.[数量],0) AS 领料数量,
           SUM(ISNULL(il.[数量],0)) OVER (PARTITION BY ih.[领料备注], il.[啤机生产单号], il.[原料编号]) AS 合计已领数量
    FROM [原料出库明细单] il
    JOIN [原料出库单] ih ON ih.[单号] = il.[单号]
    WHERE ISNULL(ih.[审核],'0') = '1'
)
SELECT h.[开单日期],
       h.[啤机生产单号],
       h.[领料备注],
       d.[原料编号],
       d.[原料名称],
       d.[单位],
       ISNULL(d.[需求数量包],0) AS 需求数量,
       lk.[啤机外发单号],
       lk.[领料日期],
       lk.[领料单号],
       lk.[领料数量],
       ISNULL(lk.[合计已领数量],0) AS 合计已领数量,
       ISNULL(d.[需求数量包],0) - ISNULL(lk.[合计已领数量],0) AS 未领数量,
       h.[审核]
FROM [原料生产需求表] h
JOIN [原料生产需求明细单] d ON d.[单号] = h.[单号]
LEFT JOIN 领料 lk ON lk.[领料备注] = h.[领料备注]
    AND lk.[啤机生产单号] = h.[啤机生产单号]
    AND lk.[原料编号] = d.[原料编号]
WHERE (@remark IS NULL OR h.[领料备注] = @remark)
  AND NOT EXISTS(SELECT 1 FROM OPENJSON(@automaticSources) j WHERE j.[value]=LTRIM(RTRIM(h.[啤机生产单号])))
  AND (@kw IS NULL OR h.[啤机生产单号] LIKE @kw OR h.[单号] LIKE @kw OR d.[原料编号] LIKE @kw OR d.[原料名称] LIKE @kw OR lk.[领料单号] LIKE @kw OR lk.[啤机外发单号] LIKE @kw)
{dateWhere}  AND (@onlyReceived = 0 OR lk.[领料单号] IS NOT NULL)
  AND (@onlyNotReceived = 0 OR lk.[领料单号] IS NULL)
ORDER BY h.[开单日期] DESC, h.[啤机生产单号], d.[ID], lk.[领料日期], lk.[领料单号];",
            new { qi, qe, kw, remark, onlyReceived, onlyNotReceived, automaticSources = automatic.SourcesJson });
        var additions = automatic.Details.Where(x => (remark is null || x.领料备注 == remark)
            && (onlyReceived == 0 || x.领料单号 is not null) && (onlyNotReceived == 0 || x.领料单号 is null)
            && (dateCol is null || ReportDate(日期类型 == "领料日期" ? x.领料日期 : x.开单日期, 起, 止))
            && ReportSearch(keyword, x.来源啤机采购单号, x.原料编号, x.原料名称, x.领料单号));
        return rows.Concat(additions).OrderByDescending(x => x.开单日期).ThenBy(x => x.啤机生产单号).ThenBy(x => x.原料编号).ToList();
    }

    // 原料出库进度表:每行一条原料生产需求明细,已出库按 (领料备注,啤机生产单号,原料编号) 关联已审核原料出库汇总
    // (同 OutsourceShortageAsync 口径),欠数=需求−已出库,进度=已出库/需求×100(%)。到货情况:已到=欠数<=0,未到=欠数>0。
    public async Task<IReadOnlyList<PlasticRawMaterialIssueProgressRow>> IssueProgressAsync(
        DateTime? 起, DateTime? 止, string? keyword, string? 领料备注, string? 到货情况, bool onlyOwed)
    {
        var qi = 起?.Date;
        var qe = 止?.Date.AddDays(1);
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var remark = string.IsNullOrWhiteSpace(领料备注) || 领料备注 == "全部" ? null : 领料备注.Trim();
        var onlyDone = 到货情况 == "已到" ? 1 : 0;
        var onlyNotDone = (到货情况 == "未到" || onlyOwed) ? 1 : 0;
        using var c = factory.Create();
        var automatic = await ReadAutomaticProgressAsync(c);
        var rows = await c.QueryAsync<PlasticRawMaterialIssueProgressRow>(@"
WITH 领料 AS (
    SELECT ih.[领料备注],
           il.[啤机生产单号],
           il.[原料编号],
           SUM(ISNULL(il.[数量],0)) AS 已出库数量,
           MAX(ih.[日期]) AS 最后出库日期
    FROM [原料出库明细单] il
    JOIN [原料出库单] ih ON ih.[单号] = il.[单号]
    WHERE ISNULL(ih.[审核],'0') = '1'
    GROUP BY ih.[领料备注], il.[啤机生产单号], il.[原料编号]
)
SELECT h.[开单日期],
       h.[单号] AS 需求单号,
       h.[啤机生产单号],
       h.[领料备注],
       h.[生产车间],
       d.[原料编号],
       d.[原料名称],
       d.[单位],
       ISNULL(d.[需求数量包],0) AS 需求数量,
       ISNULL(lk.[已出库数量],0) AS 已出库数量,
       ISNULL(d.[需求数量包],0) - ISNULL(lk.[已出库数量],0) AS 欠数,
       CASE WHEN ISNULL(d.[需求数量包],0) = 0 THEN NULL
            ELSE CAST(ISNULL(lk.[已出库数量],0) * 100.0 / d.[需求数量包] AS decimal(18,2)) END AS 进度,
       lk.[最后出库日期],
       h.[审核]
FROM [原料生产需求表] h
JOIN [原料生产需求明细单] d ON d.[单号] = h.[单号]
LEFT JOIN 领料 lk ON lk.[领料备注] = h.[领料备注]
    AND lk.[啤机生产单号] = h.[啤机生产单号]
    AND lk.[原料编号] = d.[原料编号]
WHERE (@qi IS NULL OR h.[开单日期] >= @qi)
  AND NOT EXISTS(SELECT 1 FROM OPENJSON(@automaticSources) j WHERE j.[value]=LTRIM(RTRIM(h.[啤机生产单号])))
  AND (@qe IS NULL OR h.[开单日期] < @qe)
  AND (@remark IS NULL OR h.[领料备注] = @remark)
  AND (@kw IS NULL OR h.[单号] LIKE @kw OR h.[啤机生产单号] LIKE @kw OR h.[生产车间] LIKE @kw
       OR d.[原料编号] LIKE @kw OR d.[原料名称] LIKE @kw)
  AND (@onlyDone = 0 OR (ISNULL(d.[需求数量包],0) - ISNULL(lk.[已出库数量],0)) <= 0)
  AND (@onlyNotDone = 0 OR (ISNULL(d.[需求数量包],0) - ISNULL(lk.[已出库数量],0)) > 0)
ORDER BY h.[开单日期] DESC, h.[单号], d.[ID];",
            new { qi, qe, kw, remark, onlyDone, onlyNotDone, automaticSources = automatic.SourcesJson });
        var additions = automatic.Progress.Where(x => ReportDate(x.开单日期, 起, 止) && (remark is null || x.领料备注 == remark)
            && (onlyDone == 0 || x.欠数 <= 0) && (onlyNotDone == 0 || x.欠数 > 0)
            && ReportSearch(keyword, x.来源啤机采购单号, x.原料编号, x.原料名称));
        return rows.Concat(additions).OrderByDescending(x => x.开单日期).ThenBy(x => x.需求单号).ThenBy(x => x.原料编号).ToList();
    }

    public async Task<IReadOnlyList<PlasticRawMaterialOutsourceShortageRow>> OutsourceShortageAsync(
        string? 供应商类别, string? keyword, bool onlyOwed)
    {
        var cat = string.IsNullOrWhiteSpace(供应商类别) || 供应商类别 == "全部" ? null : 供应商类别.Trim();
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        var automatic = await ReadAutomaticProgressAsync(c);
        var rows = await c.QueryAsync<PlasticRawMaterialOutsourceShortageRow>(@"
WITH 需求 AS (
    SELECT h.[领料备注], h.[啤机生产单号], d.[原料编号],
           MAX(d.[原料名称]) AS 原料名称, MAX(d.[单位]) AS 单位,
           SUM(ISNULL(d.[需求数量包],0)) AS 需求数量
    FROM [原料生产需求表] h
    JOIN [原料生产需求明细单] d ON d.[单号] = h.[单号]
    WHERE ISNULL(h.[审核],'0') = '1'
      AND NOT EXISTS(SELECT 1 FROM OPENJSON(@automaticSources) j WHERE j.[value]=LTRIM(RTRIM(h.[啤机生产单号])))
    GROUP BY h.[领料备注], h.[啤机生产单号], d.[原料编号]
),
领料 AS (
    SELECT ih.[领料备注], il.[啤机生产单号], il.[原料编号],
           SUM(ISNULL(il.[数量],0)) AS 已领数量
    FROM [原料出库明细单] il
    JOIN [原料出库单] ih ON ih.[单号] = il.[单号]
    WHERE ISNULL(ih.[审核],'0') = '1'
    GROUP BY ih.[领料备注], il.[啤机生产单号], il.[原料编号]
),
欠数 AS (
    SELECT q.[原料编号],
           MAX(q.[原料名称]) AS 原料名称,
           MAX(q.[单位]) AS 单位,
           SUM(q.[需求数量] - ISNULL(l.[已领数量],0)) AS 发外欠数
    FROM 需求 q
    LEFT JOIN 领料 l ON l.[领料备注] = q.[领料备注]
        AND l.[啤机生产单号] = q.[啤机生产单号]
        AND l.[原料编号] = q.[原料编号]
    GROUP BY q.[原料编号]
)
SELECT m.[供应商编号],
       COALESCE(NULLIF(m.[供应商名称], N''), s.[供应商名称]) AS 供应商名称,
       s.[供应商类别],
       k.[原料编号],
       COALESCE(NULLIF(k.[原料名称], N''), m.[物料名称]) AS 原料名称,
       COALESCE(NULLIF(k.[单位], N''), m.[单位]) AS 单位,
       k.[发外欠数]
FROM 欠数 k
LEFT JOIN [塑胶原料资料] m ON m.[物料编号] = k.[原料编号]
LEFT JOIN [供应商资料] s ON s.[供应商编号] = m.[供应商编号]
WHERE (@cat IS NULL OR s.[供应商类别] = @cat)
  AND (@kw IS NULL OR k.[原料编号] LIKE @kw OR k.[原料名称] LIKE @kw
       OR m.[供应商编号] LIKE @kw OR m.[供应商名称] LIKE @kw OR s.[供应商名称] LIKE @kw)
  AND (@onlyOwed = 0 OR k.[发外欠数] > 0)
ORDER BY m.[供应商编号], k.[原料编号];", new { cat, kw, onlyOwed = onlyOwed ? 1 : 0, automaticSources = automatic.SourcesJson });
        var additions = automatic.Shortages.Where(x => (cat is null || x.供应商类别 == cat) && (!onlyOwed || x.发外欠数 > 0)
            && ReportSearch(keyword, x.原料编号, x.原料名称, x.供应商编号, x.供应商名称));
        return rows.Concat(additions).OrderBy(x => x.供应商编号).ThenBy(x => x.原料编号).ToList();
    }

    private static string StockIssueApprovalFilter(string? 审核情况) => 审核情况 switch
    {
        "已审核" => " AND ISNULL(h.[审核],'0')='1'",
        "未审核" => " AND ISNULL(h.[审核],'0')<>'1'",
        _ => "",
    };

    public async Task<IReadOnlyList<PlasticRawMaterialStockIssueQuerySummaryRow>> StockIssueQuerySummaryAsync(
        DateTime 起, DateTime 止, string? keyword, string? 审核情况, string? 物料类别, string? 领料备注, string? 制单人)
    {
        var qi = 起.Date;
        var qe = 止.Date.AddDays(1);
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var cat = string.IsNullOrWhiteSpace(物料类别) || 物料类别 == "所有类别" ? null : 物料类别.Trim();
        var remark = string.IsNullOrWhiteSpace(领料备注) || 领料备注 == "全部" ? null : 领料备注.Trim();
        var maker = string.IsNullOrWhiteSpace(制单人) ? null : $"%{制单人.Trim()}%";
        using var c = factory.Create();
        var rows = await c.QueryAsync<PlasticRawMaterialStockIssueQuerySummaryRow>($@"
SELECT h.[领料备注],
       d.[开单日期],
       d.[啤机生产单号],
       d.[啤机外发单号],
       d.[原料编号],
       MAX(d.[原料名称]) AS 原料名称,
       MAX(d.[产地]) AS 产地,
       MAX(d.[单位]) AS 单位,
       SUM(ISNULL(d.[数量],0)) AS 领料数量包,
       MAX(d.[备注]) AS 备注
FROM [原料出库明细单] d
JOIN [原料出库单] h ON h.[单号] = d.[单号]
LEFT JOIN [塑胶原料资料] m ON m.[物料编号] = d.[原料编号]
WHERE h.[日期] >= @qi AND h.[日期] < @qe
  AND (@cat IS NULL OR m.[物料类别] = @cat)
  AND (@remark IS NULL OR h.[领料备注] = @remark)
  AND (@maker IS NULL OR h.[制单人] LIKE @maker)
  AND (@kw IS NULL OR h.[单号] LIKE @kw OR h.[生产车间] LIKE @kw OR h.[领料备注] LIKE @kw
       OR h.[制单人] LIKE @kw OR d.[啤机生产单号] LIKE @kw OR d.[啤机外发单号] LIKE @kw
       OR d.[原料编号] LIKE @kw OR d.[原料名称] LIKE @kw)
{StockIssueApprovalFilter(审核情况)}
GROUP BY h.[领料备注], d.[开单日期], d.[啤机生产单号], d.[啤机外发单号], d.[原料编号]
ORDER BY h.[领料备注], d.[开单日期] DESC, d.[啤机生产单号], d.[原料编号];", new { qi, qe, kw, cat, remark, maker });
        return rows.AsList();
    }

    public async Task<IReadOnlyList<PlasticRawMaterialStockIssueQueryDetailRow>> StockIssueQueryDetailAsync(
        DateTime 起, DateTime 止, string? keyword, string? 审核情况, string? 物料类别, string? 领料备注, string? 制单人)
    {
        var qi = 起.Date;
        var qe = 止.Date.AddDays(1);
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var cat = string.IsNullOrWhiteSpace(物料类别) || 物料类别 == "所有类别" ? null : 物料类别.Trim();
        var remark = string.IsNullOrWhiteSpace(领料备注) || 领料备注 == "全部" ? null : 领料备注.Trim();
        var maker = string.IsNullOrWhiteSpace(制单人) ? null : $"%{制单人.Trim()}%";
        using var c = factory.Create();
        var rows = await c.QueryAsync<PlasticRawMaterialStockIssueQueryDetailRow>($@"
SELECT h.[领料备注],
       d.[开单日期],
       d.[啤机生产单号],
       d.[生产单号],
       h.[日期],
       h.[审核日期],
       d.[单号],
       h.[生产车间],
       d.[啤机外发单号],
       d.[原料编号],
       d.[原料名称],
       d.[产地],
       d.[单位],
       d.[数量] AS 数量包,
       d.[备注],
       h.[制单人],
       h.[审核]
FROM [原料出库明细单] d
JOIN [原料出库单] h ON h.[单号] = d.[单号]
LEFT JOIN [塑胶原料资料] m ON m.[物料编号] = d.[原料编号]
WHERE h.[日期] >= @qi AND h.[日期] < @qe
  AND (@cat IS NULL OR m.[物料类别] = @cat)
  AND (@remark IS NULL OR h.[领料备注] = @remark)
  AND (@maker IS NULL OR h.[制单人] LIKE @maker)
  AND (@kw IS NULL OR h.[单号] LIKE @kw OR h.[生产车间] LIKE @kw OR h.[领料备注] LIKE @kw
       OR h.[制单人] LIKE @kw OR d.[啤机生产单号] LIKE @kw OR d.[生产单号] LIKE @kw OR d.[啤机外发单号] LIKE @kw
       OR d.[原料编号] LIKE @kw OR d.[原料名称] LIKE @kw)
{StockIssueApprovalFilter(审核情况)}
ORDER BY h.[日期] DESC, d.[单号], d.[ID];", new { qi, qe, kw, cat, remark, maker });
        return rows.AsList();
    }
}
