using Dapper;
using System.Data;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.MasterData;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;

namespace ErpApi.Features.Warehouse.Semi.Labels;

public interface ISemiFinishedLabelOrderService
{
    Task<SemiFinishedLabelOrderDto> CreateAsync(SemiFinishedLabelOrderSaveDto dto, string user);
    Task<SemiFinishedLabelOrderDto> UpdateAsync(string documentNo, SemiFinishedLabelOrderSaveDto dto, string user);
    Task<SemiFinishedLabelOrderDto?> GetAsync(string documentNo);
    Task<PagedResult<SemiFinishedLabelOrderListRow>> ListAsync(int page, int size, string? keyword);
    Task<bool> DeleteAsync(string documentNo, string user);
    Task<bool> SetAuditAsync(string documentNo, bool audited, string user);
    Task<SemiFinishedLabelOrderDto?> GetAdjacentAsync(string documentNo, AdjacentDirection direction);
    Task<PagedResult<SemiFinishedLabelProductRow>> ProductsAsync(SemiFinishedLabelProductQuery query, bool canSeePrice);
}

public interface ISemiFinishedLabelProductSource
{
    Task<PagedResult<SemiFinishedLabelProductRow>> QueryAsync(SemiFinishedLabelProductQuery query);
}

public sealed class SemiFinishedLabelOrderService(
    ISqlConnectionFactory factory,
    IDocumentNumberGenerator docNo,
    IAuditLogger audit,
    ISemiFinishedLabelProductSource? productSource = null) : ISemiFinishedLabelOrderService
{
    public const string DocType = "半成品标签单";
    public const string Prefix = "SBL";
    private const decimal Decimal18_4Max = 99_999_999_999_999.9999m;

    internal static int CalculateExpected(decimal quantity, decimal? perBox)
        => perBox is > 0 ? checked((int)Math.Ceiling(quantity / perBox.Value)) : 0;

    public async Task<SemiFinishedLabelOrderDto> CreateAsync(SemiFinishedLabelOrderSaveDto dto, string user)
    {
        ValidateUser(user);
        var lines = ValidateAndNormalize(dto);
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        try
        {
            var documentNo = await docNo.NextAsync(DocType, Prefix, dto.日期, c, tx);
            var id = await c.ExecuteScalarAsync<long>(@"
INSERT INTO [半成品标签单]([电脑单号],[日期],[备注一],[备注二],[操作员],[审核])
VALUES(@documentNo,@日期,@备注一,@备注二,@操作员,'0');
SELECT CAST(SCOPE_IDENTITY() AS bigint);",
                new { documentNo, 日期 = dto.日期.Date, dto.备注一, dto.备注二, 操作员 = user }, tx);
            await InsertLinesAsync(c, tx, id, lines);
            await audit.WriteAsync(DocType, "新增", user, $"单号={documentNo}", c, tx);
            tx.Commit();
            return (await GetAsync(documentNo))!;
        }
        catch
        {
            try { tx.Rollback(); } catch { }
            throw;
        }
    }

    public async Task<SemiFinishedLabelOrderDto> UpdateAsync(string documentNo, SemiFinishedLabelOrderSaveDto dto, string user)
    {
        ValidateUser(user);
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        try
        {
            var header = await GetLockedHeaderAsync(c, tx, documentNo);
            if (header is null) throw new KeyNotFoundException($"半成品标签单 [{documentNo}] 不存在。");
            if (header.审核 == "1") throw new InvalidOperationException("已审核的半成品标签单不能保存，请先反审核。");
            var lines = ValidateAndNormalize(dto);

            await c.ExecuteAsync(@"
UPDATE [半成品标签单]
SET [日期]=@日期,[备注一]=@备注一,[备注二]=@备注二,[操作员]=@操作员,[更新时间]=SYSDATETIME()
WHERE [ID]=@id;", new { 日期 = dto.日期.Date, dto.备注一, dto.备注二, 操作员 = user, id = header.ID }, tx);
            await c.ExecuteAsync("DELETE FROM [半成品标签明细] WHERE [标签单ID]=@id", new { id = header.ID }, tx);
            await InsertLinesAsync(c, tx, header.ID, lines);
            await audit.WriteAsync(DocType, "保存", user, $"单号={documentNo}", c, tx);
            tx.Commit();
            return (await GetAsync(documentNo))!;
        }
        catch
        {
            try { tx.Rollback(); } catch { }
            throw;
        }
    }

    public async Task<SemiFinishedLabelOrderDto?> GetAsync(string documentNo)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction(IsolationLevel.RepeatableRead);
        SemiFinishedLabelOrderDto? header;
        using (var multi = await c.QueryMultipleAsync(@"
SELECT [ID],[电脑单号],[日期],[备注一],[备注二],[操作员],[审核],[审核人],[审核时间]
FROM [半成品标签单] WHERE [电脑单号]=@documentNo;
SELECT d.[ID],d.[配件编号],d.[客户],d.[产品货号],d.[产品名称],d.[产品装配名称],
       d.[数量],d.[每箱数量],d.[预计标签数],d.[实需标签数],d.[实需标签数已手改],d.[备注]
FROM [半成品标签明细] d
INNER JOIN [半成品标签单] h ON h.[ID]=d.[标签单ID]
WHERE h.[电脑单号]=@documentNo ORDER BY d.[行号];", new { documentNo }, tx))
        {
            header = await multi.ReadFirstOrDefaultAsync<SemiFinishedLabelOrderDto>();
            if (header is not null)
                header.明细 = (await multi.ReadAsync<SemiFinishedLabelOrderLineDto>()).AsList();
        }
        tx.Commit();
        return header;
    }

    public async Task<PagedResult<SemiFinishedLabelOrderListRow>> ListAsync(int page, int size, string? keyword)
    {
        page = Math.Max(page, 1);
        size = Math.Clamp(size, 1, 1000);
        var match = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        await c.OpenAsync();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [半成品标签单]
WHERE @match IS NULL OR [电脑单号] LIKE @match OR [操作员] LIKE @match
   OR [备注一] LIKE @match OR [备注二] LIKE @match;
SELECT [ID],[电脑单号],[日期],[操作员],[审核],[审核人],[审核时间],[备注一],[备注二]
FROM [半成品标签单]
WHERE @match IS NULL OR [电脑单号] LIKE @match OR [操作员] LIKE @match
   OR [备注一] LIKE @match OR [备注二] LIKE @match
ORDER BY [日期] DESC,[ID] DESC
OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;", new { page, size, match });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<SemiFinishedLabelOrderListRow>()).AsList();
        return new PagedResult<SemiFinishedLabelOrderListRow>(items, total);
    }

    public async Task<bool> DeleteAsync(string documentNo, string user)
    {
        ValidateUser(user);
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        try
        {
            var header = await GetLockedHeaderAsync(c, tx, documentNo);
            if (header is null) { tx.Commit(); return false; }
            if (header.审核 == "1") throw new InvalidOperationException("已审核的半成品标签单不能删除，请先反审核。");
            await c.ExecuteAsync("DELETE FROM [半成品标签单] WHERE [ID]=@id", new { id = header.ID }, tx);
            await audit.WriteAsync(DocType, "删除", user, $"单号={documentNo}", c, tx);
            tx.Commit();
            return true;
        }
        catch
        {
            try { tx.Rollback(); } catch { }
            throw;
        }
    }

    public async Task<bool> SetAuditAsync(string documentNo, bool audited, string user)
    {
        ValidateUser(user);
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        try
        {
            var header = await GetLockedHeaderAsync(c, tx, documentNo);
            if (header is null) { tx.Commit(); return false; }
            var expected = audited ? "0" : "1";
            if (header.审核 != expected)
                throw new InvalidOperationException(audited ? "单据不存在或已审核。" : "单据不存在或未审核。");
            await c.ExecuteAsync(@"
UPDATE [半成品标签单]
SET [审核]=@审核,[审核人]=CASE WHEN @审核='1' THEN @user ELSE NULL END,
    [审核时间]=CASE WHEN @审核='1' THEN SYSDATETIME() ELSE NULL END,[更新时间]=SYSDATETIME()
WHERE [ID]=@id;", new { 审核 = audited ? "1" : "0", user, id = header.ID }, tx);
            await audit.WriteAsync(DocType, audited ? "审核" : "反审核", user, $"单号={documentNo}", c, tx);
            tx.Commit();
            return true;
        }
        catch
        {
            try { tx.Rollback(); } catch { }
            throw;
        }
    }

    public async Task<SemiFinishedLabelOrderDto?> GetAdjacentAsync(string documentNo, AdjacentDirection direction)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        var current = await c.QuerySingleOrDefaultAsync<HeaderOrderRow>(
            "SELECT [ID],[日期] FROM [半成品标签单] WHERE [电脑单号]=@documentNo", new { documentNo });
        if (current is null) return null;
        var next = direction == AdjacentDirection.Next;
        var adjacentNo = await c.ExecuteScalarAsync<string?>(next ? @"
SELECT TOP (1) [电脑单号] FROM [半成品标签单]
WHERE [日期]>@日期 OR ([日期]=@日期 AND [ID]>@ID)
ORDER BY [日期],[ID];" : @"
SELECT TOP (1) [电脑单号] FROM [半成品标签单]
WHERE [日期]<@日期 OR ([日期]=@日期 AND [ID]<@ID)
ORDER BY [日期] DESC,[ID] DESC;", current);
        return adjacentNo is null ? null : await GetAsync(adjacentNo);
    }

    public async Task<PagedResult<SemiFinishedLabelProductRow>> ProductsAsync(
        SemiFinishedLabelProductQuery query, bool canSeePrice)
    {
        var result = productSource is null
            ? await QueryProductsAsync(query)
            : await productSource.QueryAsync(query);
        if (!canSeePrice)
            foreach (var item in result.Items)
            {
                item.加工单价 = null;
                item.库存单价 = null;
            }
        return result;
    }

    private async Task<PagedResult<SemiFinishedLabelProductRow>> QueryProductsAsync(
        SemiFinishedLabelProductQuery query)
    {
        var page = Math.Max(query.Page, 1);
        var size = Math.Clamp(query.Size, 1, 1000);
        var keyword = string.IsNullOrWhiteSpace(query.Keyword) ? null : query.Keyword.Trim();
        var match = keyword is null || query.Exact ? keyword : $"%{keyword}%";
        var field = query.Field switch
        {
            "产品名称" => "b.[产品名称]",
            "配件编号" => "b.[配件编号]",
            "客户" => "b.[客户]",
            "产品装配名称" => "b.[产品装配名称]",
            _ => "b.[产品货号]"
        };
        var comparer = query.Exact ? "=" : "LIKE";
        var cte = $@"
WITH LatestHeader AS (
    SELECT h.*, ROW_NUMBER() OVER (PARTITION BY h.[款号] ORDER BY h.[ID] DESC) AS rn
    FROM [款号物料总表] h
    WHERE NULLIF(LTRIM(RTRIM(h.[款号])), N'') IS NOT NULL
), DetailFallback AS (
    SELECT d.[款号], MAX(NULLIF(LTRIM(RTRIM(d.[客户名称])), N'')) AS [客户名称],
           MAX(NULLIF(LTRIM(RTRIM(d.[客户])), N'')) AS [客户],
           MAX(NULLIF(LTRIM(RTRIM(d.[款式])), N'')) AS [款式]
    FROM [款号物料明细表] d GROUP BY d.[款号]
), Base AS (
    SELECT COALESCE(NULLIF(LTRIM(RTRIM(s.[配件编号])), N''), h.[产品编号]) AS [配件编号],
           COALESCE(NULLIF(LTRIM(RTRIM(s.[产品装配名称])), N''), NULLIF(LTRIM(RTRIM(h.[款式])), N''), d.[款式]) AS [产品装配名称],
           COALESCE(NULLIF(LTRIM(RTRIM(h.[客户名称])), N''), NULLIF(LTRIM(RTRIM(h.[客户])), N''), d.[客户名称], d.[客户]) AS [客户],
           h.[款号] AS [产品货号], NULLIF(LTRIM(RTRIM(h.[款式])), N'') AS [产品名称],
           q.[单价] AS [加工单价], s.[库存单价HK] AS [库存单价], h.[大箱盒数] AS [每箱数量]
    FROM LatestHeader h
    LEFT JOIN [半成品共用物料设置] s ON s.[产品货号]=h.[款号]
    LEFT JOIN DetailFallback d ON d.[款号]=h.[款号]
    OUTER APPLY (
        SELECT TOP (1) quote.[单价]
        FROM [装配物料报价] quote
        WHERE quote.[产品货号]=h.[款号] AND quote.[单价] IS NOT NULL
        ORDER BY quote.[是否默认] DESC, quote.[顺序], quote.[ID]
    ) q
    WHERE h.rn=1
      -- 装配类别决定仓别：类别=成品 的款号只进成品入仓单；未设置装配扩展或未填类别的款号保持现状（两边都出现）
      AND (s.[产品货号] IS NULL OR NULLIF(LTRIM(RTRIM(s.[类别])), N'') IS NULL OR s.[类别]<>N'成品')
), Filtered AS (
    SELECT * FROM Base b
    WHERE NULLIF(LTRIM(RTRIM(b.[配件编号])), N'') IS NOT NULL
      AND (@keyword IS NULL OR {field} {comparer} @match)
)";
        var sql = $@"
{cte}
SELECT COUNT(*) FROM Filtered;
{cte}
SELECT [配件编号],[产品装配名称],[客户],[产品货号],[产品名称],[加工单价],[库存单价],[每箱数量]
FROM Filtered ORDER BY [产品货号],[配件编号]
OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;";
        using var c = factory.Create();
        await c.OpenAsync();
        using var multi = await c.QueryMultipleAsync(sql, new { keyword, match, page, size });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<SemiFinishedLabelProductRow>()).AsList();
        return new PagedResult<SemiFinishedLabelProductRow>(items, total);
    }

    private static List<SemiFinishedLabelOrderLineDto> ValidateAndNormalize(SemiFinishedLabelOrderSaveDto dto)
    {
        if (dto.日期 == default) throw new ArgumentException("日期必填。");
        ValidateLength(dto.备注一, 500, "备注一");
        ValidateLength(dto.备注二, 500, "备注二");
        if (dto.明细.Count == 0) throw new ArgumentException("半成品标签单至少要有一行明细。");
        var parts = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var normalized = new List<SemiFinishedLabelOrderLineDto>(dto.明细.Count);
        foreach (var line in dto.明细)
        {
            if (line is null) throw new ArgumentException("明细行不能为空。");
            var part = line.配件编号?.Trim() ?? "";
            var style = line.产品货号?.Trim() ?? "";
            if (part.Length == 0) throw new ArgumentException("配件编号必填。");
            if (style.Length == 0) throw new ArgumentException("产品货号必填。");
            ValidateLength(part, 80, "配件编号");
            ValidateLength(line.客户, 160, "客户");
            ValidateLength(style, 120, "产品货号");
            ValidateLength(line.产品名称, 240, "产品名称");
            ValidateLength(line.产品装配名称, 240, "产品装配名称");
            ValidateLength(line.备注, 500, "备注");
            if (!parts.Add(part)) throw new ArgumentException($"配件编号 [{part}] 在同一单据中重复。");
            ValidateDecimal18_4(line.数量, "数量");
            if (line.每箱数量 is { } perBox) ValidateDecimal18_4(perBox, "每箱数量");
            if (line.实需标签数 < 0) throw new ArgumentException("实需标签数不能为负数。");

            int expected;
            try { expected = CalculateExpected(line.数量, line.每箱数量); }
            catch (OverflowException) { throw new ArgumentException("预计标签数超出允许范围。"); }
            if (line.预计标签数 != 0 && line.预计标签数 != expected)
                throw new ArgumentException("预计标签数与数量和每箱数量不一致。");
            if (line.每箱数量 is <= 0 && line.预计标签数 != 0)
                throw new ArgumentException("每箱数量未填写时预计标签数必须为 0。");

            normalized.Add(new SemiFinishedLabelOrderLineDto
            {
                ID = line.ID,
                配件编号 = part,
                客户 = line.客户?.Trim(),
                产品货号 = style,
                产品名称 = line.产品名称?.Trim(),
                产品装配名称 = line.产品装配名称?.Trim(),
                数量 = line.数量,
                每箱数量 = line.每箱数量,
                预计标签数 = expected,
                实需标签数 = line.实需标签数已手改 ? line.实需标签数 : expected,
                实需标签数已手改 = line.实需标签数已手改,
                备注 = line.备注?.Trim()
            });
        }
        return normalized;
    }

    private static void ValidateUser(string user)
    {
        if (string.IsNullOrWhiteSpace(user)) throw new ArgumentException("操作员必填。", nameof(user));
        ValidateLength(user, 80, "操作员");
    }

    private static void ValidateLength(string? value, int maxLength, string field)
    {
        if (value?.Length > maxLength)
            throw new ArgumentException($"{field}不能超过 {maxLength} 个字符。");
    }

    private static void ValidateDecimal18_4(decimal value, string field)
    {
        if (value < 0)
            throw new ArgumentException($"{field}不能为负数。");
        if (value > Decimal18_4Max || value != decimal.Round(value, 4))
            throw new ArgumentException($"{field}必须在 decimal(18,4) 范围内且最多四位小数。");
    }

    private static async Task InsertLinesAsync(SqlConnection c, SqlTransaction tx, long headerId,
        IReadOnlyList<SemiFinishedLabelOrderLineDto> lines)
    {
        for (var index = 0; index < lines.Count; index++)
        {
            var line = lines[index];
            await c.ExecuteAsync(@"
INSERT INTO [半成品标签明细]
([标签单ID],[行号],[配件编号],[客户],[产品货号],[产品名称],[产品装配名称],
 [数量],[每箱数量],[预计标签数],[实需标签数],[实需标签数已手改],[备注])
VALUES
(@headerId,@lineNo,@配件编号,@客户,@产品货号,@产品名称,@产品装配名称,
 @数量,@每箱数量,@预计标签数,@实需标签数,@实需标签数已手改,@备注);",
                new
                {
                    headerId,
                    lineNo = index + 1,
                    line.配件编号,
                    line.客户,
                    line.产品货号,
                    line.产品名称,
                    line.产品装配名称,
                    line.数量,
                    line.每箱数量,
                    line.预计标签数,
                    line.实需标签数,
                    line.实需标签数已手改,
                    line.备注
                }, tx);
        }
    }

    private static Task<LockedHeaderRow?> GetLockedHeaderAsync(SqlConnection c, SqlTransaction tx, string documentNo)
        => c.QuerySingleOrDefaultAsync<LockedHeaderRow>(
            "SELECT [ID],[审核] FROM [半成品标签单] WITH (UPDLOCK,HOLDLOCK) WHERE [电脑单号]=@documentNo",
            new { documentNo }, tx);

    private sealed class LockedHeaderRow
    {
        public long ID { get; set; }
        public string 审核 { get; set; } = "0";
    }

    private sealed class HeaderOrderRow
    {
        public long ID { get; set; }
        public DateTime 日期 { get; set; }
    }
}
