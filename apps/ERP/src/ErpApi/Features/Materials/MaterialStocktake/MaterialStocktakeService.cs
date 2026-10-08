using Dapper;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Engines.Inventory;
using ErpApi.Features.MasterData;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Materials.MaterialStocktake;

// 物料盘点（盈亏）。两层：盘点单 + 盘点明细单(单号串联)。审核位仅在单头。
// BasisAsync 从 MaterialInventoryService.ListAsync 取系统数量；写库时按同一口径逐行服务端复算(不信任前端传入值)；盈亏=盘点−系统；审核后盈亏入库存(库存引擎)。
// 审核=自建事务:翻审核位 + UPDATE 物料资料.库存=盘点数量(照塑胶原料盘点先例,供采购分析扣数)；反审核按明细系统数量还原。不走 IPostingEngine(需同事务写库存)。
// 数量列为 real，服务端传 decimal(SQL 隐式转)；读回 CAST decimal。
public sealed class MaterialStocktakeService(
    ISqlConnectionFactory factory, IDocumentNumberGenerator docNo, IMaterialInventoryService inventory, IAuditLogger audit)
{
    public const string DocType = "盘点单";
    public const string Prefix = "PD";

    public async Task<IReadOnlyList<MaterialStocktakeBasisRow>> BasisAsync(string 仓库)
    {
        var inv = await inventory.ListAsync(仓库, null);
        return inv.Select(r => new MaterialStocktakeBasisRow
        {
            物料编号 = r.物料编号, 物料名称 = r.物料名称, 规格 = r.规格, 单位 = r.单位, 系统数量 = r.库存数量
        }).ToList();
    }

    public async Task<string> CreateAsync(MaterialStocktakeCreateDto dto, string user)
    {
        if (dto.明细.Count == 0) throw new ArgumentException("盘点单至少要有一行明细");
        if (dto.明细.Any(l => l.盘点数量 < 0)) throw new ArgumentException("盘点数量不能为负");
        if (string.IsNullOrWhiteSpace(dto.仓库)) throw new ArgumentException("仓库必填");
        var now = DateTime.Now;
        var docDate = dto.日期 ?? now;

        // 系统数量服务端复算(口径同 BasisAsync:库存引擎按 物料编号×仓库 实时聚合),不信任前端传入值;无台账行=0
        var 系统数量表 = (await inventory.ListAsync(dto.仓库, null))
            .ToDictionary(r => r.物料编号 ?? "", r => r.库存数量, StringComparer.OrdinalIgnoreCase);

        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 单号 = await docNo.NextAsync(DocType, Prefix, docDate, c, tx);

        await c.ExecuteAsync(@"
INSERT INTO [盘点单]([单号],[日期],[仓库],[操作员],[审核],[备注])
VALUES(@单号,@日期,@仓库,@操作员,'0',@备注)",
            new { 单号, 日期 = docDate, dto.仓库, 操作员 = user, dto.备注 }, tx);

        foreach (var l in dto.明细)
        {
            var 系统数量 = 系统数量表.TryGetValue(l.物料编号 ?? "", out var q) ? q : 0m;
            await c.ExecuteAsync(@"
INSERT INTO [盘点明细单]([单号],[日期],[仓库],[物料编号],[物料名称],[规格],[单位],[系统数量],[盘点数量],[盈亏数量])
VALUES(@单号,@日期,@仓库,@物料编号,@物料名称,@规格,@单位,@系统数量,@盘点数量,@盈亏数量)",
                new
                {
                    单号, 日期 = docDate, dto.仓库, l.物料编号, l.物料名称, l.规格, l.单位,
                    系统数量, l.盘点数量, 盈亏数量 = l.盘点数量 - 系统数量
                }, tx);
        }

        tx.Commit();
        return 单号;
    }

    public async Task<PagedResult<MaterialStocktakeHeaderDto>> ListAsync(int page, int size, string? keyword)
    {
        if (page < 1) page = 1;
        if (size < 1) size = 20;
        if (size > 1000) size = 1000;
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [盘点单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [仓库] LIKE @kw OR [备注] LIKE @kw;
SELECT [ID],[单号],[仓库],[日期],[操作员],[审核],[审核人],[备注]
FROM [盘点单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [仓库] LIKE @kw OR [备注] LIKE @kw
ORDER BY [ID] DESC OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;", new { kw, page, size });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<MaterialStocktakeHeaderDto>()).AsList();
        return new PagedResult<MaterialStocktakeHeaderDto>(items, total);
    }

    public async Task<MaterialStocktakeDetailDto?> GetAsync(string 单号)
    {
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT [ID],[单号],[仓库],[日期],[操作员],[审核],[审核人],[备注] FROM [盘点单] WHERE [单号]=@单号;
SELECT [ID],[物料编号],[物料名称],[规格],[单位],
       CAST([系统数量] AS decimal(18,4)) AS 系统数量, CAST([盘点数量] AS decimal(18,4)) AS 盘点数量, CAST([盈亏数量] AS decimal(18,4)) AS 盈亏数量
FROM [盘点明细单] WHERE [单号]=@单号 ORDER BY [ID];",
            new { 单号 });
        var header = await multi.ReadFirstOrDefaultAsync<MaterialStocktakeHeaderDto>();
        if (header is null) return null;
        var lines = (await multi.ReadAsync<MaterialStocktakeLineRowDto>()).AsList();
        return new MaterialStocktakeDetailDto { 单头 = header, 明细 = lines };
    }

    public async Task<MaterialStocktakeDetailDto?> GetByDocumentAndWarehouseAsync(string 单号, string 仓库)
    {
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT [ID],[单号],[仓库],[日期],[操作员],[审核],[审核人],[备注]
FROM [盘点单]
WHERE [单号]=@单号 AND [仓库]=@仓库;
SELECT d.[ID],d.[物料编号],d.[物料名称],d.[规格],d.[单位],
       CAST(d.[系统数量] AS decimal(18,4)) AS 系统数量,
       CAST(d.[盘点数量] AS decimal(18,4)) AS 盘点数量,
       CAST(d.[盈亏数量] AS decimal(18,4)) AS 盈亏数量
FROM [盘点明细单] d
JOIN [盘点单] o ON o.[单号]=d.[单号] AND o.[仓库]=@仓库
WHERE d.[单号]=@单号 AND d.[仓库]=@仓库
ORDER BY d.[ID];",
            new { 单号, 仓库 });
        var header = await multi.ReadFirstOrDefaultAsync<MaterialStocktakeHeaderDto>();
        if (header is null) return null;
        var lines = (await multi.ReadAsync<MaterialStocktakeLineRowDto>()).AsList();
        return new MaterialStocktakeDetailDto { 单头 = header, 明细 = lines };
    }

    // 盘点单查询·明细：每行一条盘点明细(只读)。颜色/材料/单价来自物料资料 JOIN;金额=盈亏数×单价。
    // 过滤 日期区间/关键词/物料类别/审核情况。价格脱敏在 Controller 按"单价"权限处理。
    public async Task<IReadOnlyList<MaterialStocktakeQueryDetailRow>> StocktakeQueryDetailAsync(
        DateTime? 起, DateTime? 止, string? keyword, string? 物料类别, string? 审核情况, string? 仓库 = null)
    {
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var cat = string.IsNullOrWhiteSpace(物料类别) ? null : 物料类别.Trim();
        var warehouse = string.IsNullOrWhiteSpace(仓库) ? null : 仓库.Trim();
        var 止Excl = 止?.Date.AddDays(1);
        using var c = factory.Create();
        var rows = await c.QueryAsync<MaterialStocktakeQueryDetailRow>($@"
SELECT d.[日期], d.[单号], d.[物料编号], d.[物料名称], d.[规格],
       m.[物料类别], m.[颜色], d.[单位],
       CAST(d.[系统数量] AS decimal(18,4)) AS 系统数量,
       CAST(d.[盘点数量] AS decimal(18,4)) AS 盘点数量,
       CAST(d.[盈亏数量] AS decimal(18,4)) AS 盈亏数量,
       m.[单价], CAST(d.[盈亏数量] AS decimal(18,4)) * ISNULL(m.[单价], 0) AS 金额,
       o.[备注], o.[审核]
FROM [盘点明细单] d
JOIN [盘点单] o ON o.[单号] = d.[单号]
LEFT JOIN (SELECT [物料编号], MAX([物料类别]) AS 物料类别, MAX([颜色]) AS 颜色, MAX([单价]) AS 单价
           FROM [物料资料] GROUP BY [物料编号]) m ON m.[物料编号] = d.[物料编号]
WHERE (@起 IS NULL OR d.[日期] >= @起)
  AND (@止 IS NULL OR d.[日期] < @止)
  AND (@kw IS NULL OR d.[单号] LIKE @kw OR d.[物料编号] LIKE @kw OR d.[物料名称] LIKE @kw OR d.[规格] LIKE @kw)
  AND (@cat IS NULL OR m.[物料类别] = @cat){ApprovalFilter(审核情况)}
  AND (@warehouse IS NULL OR d.[仓库] = @warehouse)
ORDER BY d.[日期] DESC, d.[单号], d.[ID];",
            new { 起, 止 = 止Excl, kw, cat, warehouse });
        return rows.AsList();
    }

    // 盘点单查询·汇总：按 物料编号+规格+颜色 合并，系统/盘点/盈亏数=SUM，金额=SUM(盈亏数)×单价。
    public async Task<IReadOnlyList<MaterialStocktakeSummaryRow>> StocktakeQuerySummaryAsync(
        DateTime? 起, DateTime? 止, string? keyword, string? 物料类别, string? 审核情况, string? 仓库 = null)
    {
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var cat = string.IsNullOrWhiteSpace(物料类别) ? null : 物料类别.Trim();
        var warehouse = string.IsNullOrWhiteSpace(仓库) ? null : 仓库.Trim();
        var 止Excl = 止?.Date.AddDays(1);
        using var c = factory.Create();
        var rows = await c.QueryAsync<MaterialStocktakeSummaryRow>($@"
SELECT d.[物料编号], MAX(d.[物料名称]) AS 物料名称, d.[规格], m.[物料类别], m.[颜色], MAX(d.[单位]) AS 单位,
       SUM(CAST(d.[系统数量] AS decimal(18,4))) AS 系统数量,
       SUM(CAST(d.[盘点数量] AS decimal(18,4))) AS 盘点数量,
       SUM(CAST(d.[盈亏数量] AS decimal(18,4))) AS 盈亏数量,
       m.[单价], SUM(CAST(d.[盈亏数量] AS decimal(18,4))) * ISNULL(m.[单价], 0) AS 金额
FROM [盘点明细单] d
JOIN [盘点单] o ON o.[单号] = d.[单号]
LEFT JOIN (SELECT [物料编号], MAX([物料类别]) AS 物料类别, MAX([颜色]) AS 颜色, MAX([单价]) AS 单价
           FROM [物料资料] GROUP BY [物料编号]) m ON m.[物料编号] = d.[物料编号]
WHERE (@起 IS NULL OR d.[日期] >= @起)
  AND (@止 IS NULL OR d.[日期] < @止)
  AND (@kw IS NULL OR d.[单号] LIKE @kw OR d.[物料编号] LIKE @kw OR d.[物料名称] LIKE @kw OR d.[规格] LIKE @kw)
  AND (@cat IS NULL OR m.[物料类别] = @cat){ApprovalFilter(审核情况)}
  AND (@warehouse IS NULL OR d.[仓库] = @warehouse)
GROUP BY d.[物料编号], d.[规格], m.[物料类别], m.[颜色], m.[单价]
ORDER BY d.[物料编号], d.[规格];",
            new { 起, 止 = 止Excl, kw, cat, warehouse });
        return rows.AsList();
    }

    // 审核情况过滤片段："已审核"→已审核；"未审核"→非已审核；其它/空→全部。
    private static string ApprovalFilter(string? 审核情况) => 审核情况 switch
    {
        "已审核" => " AND ISNULL(o.[审核],'0') = '1'",
        "未审核" => " AND ISNULL(o.[审核],'0') <> '1'",
        _ => "",
    };

    // 审核:一个事务里翻审核位 + 把每行 盘点数量 写回 物料资料.库存(照塑胶原料盘点先例校准主档,供辅料/物料采购分析扣数)。
    // 明细物料编号在主档不存在时 JOIN 静默跳过(FK_163 正常已保证存在)。并发靠单头 UPDLOCK/HOLDLOCK + 同事务回写。
    public async Task<bool> ApproveAsync(string 单号, string user)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [盘点单] WITH (UPDLOCK, HOLDLOCK) WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null || 审核 == "1") return false;
        await c.ExecuteAsync(
            "UPDATE [盘点单] SET [审核]='1',[审核人]=@user,[审核日期]=@now WHERE [单号]=@单号",
            new { 单号, user, now = DateTime.Now }, tx);
        await c.ExecuteAsync(@"
UPDATE m SET m.[库存] = CAST(d.[盘点数量] AS decimal(18,4))
FROM [物料资料] m
JOIN [盘点明细单] d ON d.[物料编号] = m.[物料编号]
WHERE d.[单号] = @单号 AND d.[物料编号] IS NOT NULL", new { 单号 }, tx);
        await audit.WriteAsync("盘点单", "审核", user, $"单号={单号}", c, tx);
        tx.Commit();
        return true;
    }

    // 反审核:翻审核位=0,并按明细 系统数量(盘点入账前账面快照)还原 物料资料.库存;同样跳过主档不存在的物料编号。
    public async Task<bool> UnapproveAsync(string 单号, string user)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [盘点单] WITH (UPDLOCK, HOLDLOCK) WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null || 审核 != "1") return false;
        await c.ExecuteAsync(
            "UPDATE [盘点单] SET [审核]='0',[审核人]=NULL,[审核日期]=NULL WHERE [单号]=@单号", new { 单号 }, tx);
        await c.ExecuteAsync(@"
UPDATE m SET m.[库存] = CAST(d.[系统数量] AS decimal(18,4))
FROM [物料资料] m
JOIN [盘点明细单] d ON d.[物料编号] = m.[物料编号]
WHERE d.[单号] = @单号 AND d.[物料编号] IS NOT NULL", new { 单号 }, tx);
        await audit.WriteAsync("盘点单", "反审核", user, $"单号={单号}", c, tx);
        tx.Commit();
        return true;
    }

    public async Task<bool> DeleteAsync(string 单号)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [盘点单] WITH (UPDLOCK, HOLDLOCK) WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null) return false;
        if (审核 == "1") throw new InvalidOperationException("已审核的盘点单不能删除，请先反审核。");
        await c.ExecuteAsync("DELETE FROM [盘点明细单] WHERE [单号]=@单号", new { 单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [盘点单] WHERE [单号]=@单号", new { 单号 }, tx);
        tx.Commit();
        return true;
    }
}
