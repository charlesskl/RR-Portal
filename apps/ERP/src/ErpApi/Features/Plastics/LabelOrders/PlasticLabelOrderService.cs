using Dapper;
using System.Data;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.MasterData;
using ErpApi.Features.Warehouse.Semi.Labels;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;

namespace ErpApi.Features.Plastics.LabelOrders;

public interface IPlasticLabelOrderService
{
    Task<PlasticLabelOrderDto> CreateAsync(PlasticLabelOrderSaveDto dto, string user);
    Task<PlasticLabelOrderDto> UpdateAsync(string documentNo, PlasticLabelOrderSaveDto dto, string user);
    Task<PlasticLabelOrderDto?> GetAsync(string documentNo);
    Task<PagedResult<PlasticLabelOrderListRow>> ListAsync(int page, int size, string? keyword);
    Task<bool> DeleteAsync(string documentNo, string user);
    Task<bool> SetAuditAsync(string documentNo, bool audited, string user);
    Task<PlasticLabelOrderDto?> GetAdjacentAsync(string documentNo, AdjacentDirection direction);
    Task<PagedResult<PlasticLabelMaterialRow>> MaterialsAsync(PlasticLabelMaterialQuery query, bool canSeePrice);
    Task<IReadOnlyList<PlasticLabelQueryDetailRow>> LabelQueryDetailAsync(
        DateTime? 起, DateTime? 止, string? keyword, string? 物料类别, string? 审核情况);
    Task<IReadOnlyList<PlasticLabelQuerySummaryRow>> LabelQuerySummaryAsync(
        DateTime? 起, DateTime? 止, string? keyword, string? 物料类别, string? 审核情况);
}

public sealed class PlasticLabelOrderService(
    ISqlConnectionFactory factory,
    IDocumentNumberGenerator docNo,
    IAuditLogger audit) : IPlasticLabelOrderService
{
    public const string DocType = "塑胶标签单";
    public const string Prefix = "PLB";
    private const decimal Decimal18_4Max = 99_999_999_999_999.9999m;

    public async Task<PlasticLabelOrderDto> CreateAsync(PlasticLabelOrderSaveDto dto, string user)
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
INSERT INTO [塑胶标签单]([电脑单号],[日期],[备注一],[备注二],[操作员],[审核])
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

    public async Task<PlasticLabelOrderDto> UpdateAsync(string documentNo, PlasticLabelOrderSaveDto dto, string user)
    {
        ValidateUser(user);
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        try
        {
            var header = await GetLockedHeaderAsync(c, tx, documentNo);
            if (header is null) throw new KeyNotFoundException($"塑胶标签单 [{documentNo}] 不存在。");
            if (header.审核 == "1") throw new InvalidOperationException("已审核的塑胶标签单不能保存，请先反审核。");
            var lines = ValidateAndNormalize(dto);

            await c.ExecuteAsync(@"
UPDATE [塑胶标签单]
SET [日期]=@日期,[备注一]=@备注一,[备注二]=@备注二,[操作员]=@操作员,[更新时间]=SYSDATETIME()
WHERE [ID]=@id;", new { 日期 = dto.日期.Date, dto.备注一, dto.备注二, 操作员 = user, id = header.ID }, tx);
            await c.ExecuteAsync("DELETE FROM [塑胶标签明细] WHERE [标签单ID]=@id", new { id = header.ID }, tx);
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

    public async Task<PlasticLabelOrderDto?> GetAsync(string documentNo)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction(IsolationLevel.RepeatableRead);
        PlasticLabelOrderDto? header;
        using (var multi = await c.QueryMultipleAsync(@"
SELECT [ID],[电脑单号],[日期],[备注一],[备注二],[操作员],[审核],[审核人],[审核时间]
FROM [塑胶标签单] WHERE [电脑单号]=@documentNo;
SELECT d.[ID],d.[物料编号],d.[物料名称],d.[规格],d.[颜色],d.[单位],
       d.[数量],d.[标签数],d.[备注]
FROM [塑胶标签明细] d
INNER JOIN [塑胶标签单] h ON h.[ID]=d.[标签单ID]
WHERE h.[电脑单号]=@documentNo ORDER BY d.[行号];", new { documentNo }, tx))
        {
            header = await multi.ReadFirstOrDefaultAsync<PlasticLabelOrderDto>();
            if (header is not null)
                header.明细 = (await multi.ReadAsync<PlasticLabelOrderLineDto>()).AsList();
        }
        tx.Commit();
        return header;
    }

    public async Task<PagedResult<PlasticLabelOrderListRow>> ListAsync(int page, int size, string? keyword)
    {
        page = Math.Max(page, 1);
        size = Math.Clamp(size, 1, 1000);
        var match = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        await c.OpenAsync();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [塑胶标签单]
WHERE @match IS NULL OR [电脑单号] LIKE @match OR [操作员] LIKE @match
   OR [备注一] LIKE @match OR [备注二] LIKE @match;
SELECT [ID],[电脑单号],[日期],[操作员],[审核],[审核人],[审核时间],[备注一],[备注二]
FROM [塑胶标签单]
WHERE @match IS NULL OR [电脑单号] LIKE @match OR [操作员] LIKE @match
   OR [备注一] LIKE @match OR [备注二] LIKE @match
ORDER BY [日期] DESC,[ID] DESC
OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;", new { page, size, match });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<PlasticLabelOrderListRow>()).AsList();
        return new PagedResult<PlasticLabelOrderListRow>(items, total);
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
            if (header.审核 == "1") throw new InvalidOperationException("已审核的塑胶标签单不能删除，请先反审核。");
            await c.ExecuteAsync("DELETE FROM [塑胶标签单] WHERE [ID]=@id", new { id = header.ID }, tx);
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
UPDATE [塑胶标签单]
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

    public async Task<PlasticLabelOrderDto?> GetAdjacentAsync(string documentNo, AdjacentDirection direction)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        var current = await c.QuerySingleOrDefaultAsync<HeaderOrderRow>(
            "SELECT [ID],[日期] FROM [塑胶标签单] WHERE [电脑单号]=@documentNo", new { documentNo });
        if (current is null) return null;
        var next = direction == AdjacentDirection.Next;
        var adjacentNo = await c.ExecuteScalarAsync<string?>(next ? @"
SELECT TOP (1) [电脑单号] FROM [塑胶标签单]
WHERE [日期]>@日期 OR ([日期]=@日期 AND [ID]>@ID)
ORDER BY [日期],[ID];" : @"
SELECT TOP (1) [电脑单号] FROM [塑胶标签单]
WHERE [日期]<@日期 OR ([日期]=@日期 AND [ID]<@ID)
ORDER BY [日期] DESC,[ID] DESC;", current);
        return adjacentNo is null ? null : await GetAsync(adjacentNo);
    }

    public async Task<PagedResult<PlasticLabelMaterialRow>> MaterialsAsync(
        PlasticLabelMaterialQuery query, bool canSeePrice)
    {
        var page = Math.Max(query.Page, 1);
        var size = Math.Clamp(query.Size, 1, 1000);
        var keyword = string.IsNullOrWhiteSpace(query.Keyword) ? null : query.Keyword.Trim();
        var match = keyword is null || query.Exact ? keyword : $"%{keyword}%";
        var field = query.Field switch
        {
            "物料名称" => "b.[物料名称]",
            "规格" => "b.[规格]",
            "颜色" => "b.[颜色]",
            _ => "b.[物料编号]"
        };
        var comparer = query.Exact ? "=" : "LIKE";
        var sql = $@"
WITH Base AS (
    SELECT NULLIF(LTRIM(RTRIM(m.[物料编号])), N'') AS [物料编号],
           NULLIF(LTRIM(RTRIM(m.[物料名称])), N'') AS [物料名称],
           NULLIF(LTRIM(RTRIM(m.[规格])), N'') AS [规格],
           NULLIF(LTRIM(RTRIM(m.[颜色])), N'') AS [颜色],
           NULLIF(LTRIM(RTRIM(m.[单位])), N'') AS [单位],
           m.[单价] AS [单价]
    FROM [塑胶物料资料] m
), Filtered AS (
    SELECT * FROM Base b
    WHERE b.[物料编号] IS NOT NULL
      AND (@keyword IS NULL OR {field} {comparer} @match)
)
SELECT COUNT(*) FROM Filtered;
WITH Base AS (
    SELECT NULLIF(LTRIM(RTRIM(m.[物料编号])), N'') AS [物料编号],
           NULLIF(LTRIM(RTRIM(m.[物料名称])), N'') AS [物料名称],
           NULLIF(LTRIM(RTRIM(m.[规格])), N'') AS [规格],
           NULLIF(LTRIM(RTRIM(m.[颜色])), N'') AS [颜色],
           NULLIF(LTRIM(RTRIM(m.[单位])), N'') AS [单位],
           m.[单价] AS [单价]
    FROM [塑胶物料资料] m
), Filtered AS (
    SELECT * FROM Base b
    WHERE b.[物料编号] IS NOT NULL
      AND (@keyword IS NULL OR {field} {comparer} @match)
)
SELECT [物料编号],[物料名称],[规格],[颜色],[单位],[单价]
FROM Filtered ORDER BY [物料编号]
OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;";
        using var c = factory.Create();
        await c.OpenAsync();
        using var multi = await c.QueryMultipleAsync(sql, new { keyword, match, page, size });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<PlasticLabelMaterialRow>()).AsList();
        if (!canSeePrice)
            foreach (var item in items) item.单价 = null;
        return new PagedResult<PlasticLabelMaterialRow>(items, total);
    }

    // 审核情况过滤片段："已审核"→已审核；"未审核"→非已审核；其它/空→全部。
    private static string ApprovalFilter(string? 审核情况) => 审核情况 switch
    {
        "已审核" => " AND ISNULL(h.[审核],'0') = '1'",
        "未审核" => " AND ISNULL(h.[审核],'0') <> '1'",
        _ => "",
    };

    // 塑胶标签查询·明细：每行一条标签明细(只读)。过滤 日期区间/关键词/物料类别(取塑胶物料资料)/审核情况。
    public async Task<IReadOnlyList<PlasticLabelQueryDetailRow>> LabelQueryDetailAsync(
        DateTime? 起, DateTime? 止, string? keyword, string? 物料类别, string? 审核情况)
    {
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var cat = string.IsNullOrWhiteSpace(物料类别) ? null : 物料类别.Trim();
        var 止Excl = 止?.Date.AddDays(1);
        using var c = factory.Create();
        var rows = await c.QueryAsync<PlasticLabelQueryDetailRow>($@"
SELECT h.[日期], h.[电脑单号], d.[物料编号], d.[物料名称], m.[物料类别],
       d.[规格], d.[颜色], d.[单位], d.[数量], d.[标签数], d.[备注], h.[审核]
FROM [塑胶标签明细] d
JOIN [塑胶标签单] h ON h.[ID] = d.[标签单ID]
LEFT JOIN (SELECT [物料编号], MAX([物料类别]) AS 物料类别
           FROM [塑胶物料资料] GROUP BY [物料编号]) m ON m.[物料编号] = d.[物料编号]
WHERE (@起 IS NULL OR h.[日期] >= @起)
  AND (@止 IS NULL OR h.[日期] < @止)
  AND (@kw IS NULL OR h.[电脑单号] LIKE @kw OR d.[物料编号] LIKE @kw OR d.[物料名称] LIKE @kw OR d.[规格] LIKE @kw)
  AND (@cat IS NULL OR m.[物料类别] = @cat){ApprovalFilter(审核情况)}
ORDER BY h.[日期] DESC, h.[电脑单号], d.[行号];",
            new { 起, 止 = 止Excl, kw, cat });
        return rows.AsList();
    }

    // 塑胶标签查询·汇总：按 物料编号+规格+颜色 合并,SUM(数量)/SUM(标签数)。同过滤集。
    public async Task<IReadOnlyList<PlasticLabelQuerySummaryRow>> LabelQuerySummaryAsync(
        DateTime? 起, DateTime? 止, string? keyword, string? 物料类别, string? 审核情况)
    {
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var cat = string.IsNullOrWhiteSpace(物料类别) ? null : 物料类别.Trim();
        var 止Excl = 止?.Date.AddDays(1);
        using var c = factory.Create();
        var rows = await c.QueryAsync<PlasticLabelQuerySummaryRow>($@"
SELECT d.[物料编号], MAX(d.[物料名称]) AS 物料名称, MAX(m.[物料类别]) AS 物料类别,
       d.[规格], d.[颜色], MAX(d.[单位]) AS 单位,
       SUM(d.[数量]) AS 数量, SUM(d.[标签数]) AS 标签数
FROM [塑胶标签明细] d
JOIN [塑胶标签单] h ON h.[ID] = d.[标签单ID]
LEFT JOIN (SELECT [物料编号], MAX([物料类别]) AS 物料类别
           FROM [塑胶物料资料] GROUP BY [物料编号]) m ON m.[物料编号] = d.[物料编号]
WHERE (@起 IS NULL OR h.[日期] >= @起)
  AND (@止 IS NULL OR h.[日期] < @止)
  AND (@kw IS NULL OR h.[电脑单号] LIKE @kw OR d.[物料编号] LIKE @kw OR d.[物料名称] LIKE @kw OR d.[规格] LIKE @kw)
  AND (@cat IS NULL OR m.[物料类别] = @cat){ApprovalFilter(审核情况)}
GROUP BY d.[物料编号], d.[规格], d.[颜色]
ORDER BY d.[物料编号], d.[规格], d.[颜色];",
            new { 起, 止 = 止Excl, kw, cat });
        return rows.AsList();
    }

    private static List<PlasticLabelOrderLineDto> ValidateAndNormalize(PlasticLabelOrderSaveDto dto)
    {
        if (dto.日期 == default) throw new ArgumentException("日期必填。");
        ValidateLength(dto.备注一, 500, "备注一");
        ValidateLength(dto.备注二, 500, "备注二");
        if (dto.明细.Count == 0) throw new ArgumentException("塑胶标签单至少要有一行明细。");
        var codes = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var normalized = new List<PlasticLabelOrderLineDto>(dto.明细.Count);
        foreach (var line in dto.明细)
        {
            if (line is null) throw new ArgumentException("明细行不能为空。");
            var code = line.物料编号?.Trim() ?? "";
            if (code.Length == 0) throw new ArgumentException("物料编号必填。");
            ValidateLength(code, 80, "物料编号");
            ValidateLength(line.物料名称, 240, "物料名称");
            ValidateLength(line.规格, 240, "规格");
            ValidateLength(line.颜色, 80, "颜色");
            ValidateLength(line.单位, 40, "单位");
            ValidateLength(line.备注, 500, "备注");
            if (!codes.Add(code)) throw new ArgumentException($"物料编号 [{code}] 在同一单据中重复。");
            ValidateDecimal18_4(line.数量, "数量");
            if (line.标签数 < 0) throw new ArgumentException("标签数不能为负数。");

            normalized.Add(new PlasticLabelOrderLineDto
            {
                ID = line.ID,
                物料编号 = code,
                物料名称 = line.物料名称?.Trim(),
                规格 = line.规格?.Trim(),
                颜色 = line.颜色?.Trim(),
                单位 = line.单位?.Trim(),
                数量 = line.数量,
                标签数 = line.标签数,
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
        IReadOnlyList<PlasticLabelOrderLineDto> lines)
    {
        for (var index = 0; index < lines.Count; index++)
        {
            var line = lines[index];
            await c.ExecuteAsync(@"
INSERT INTO [塑胶标签明细]
([标签单ID],[行号],[物料编号],[物料名称],[规格],[颜色],[单位],[数量],[标签数],[备注])
VALUES
(@headerId,@lineNo,@物料编号,@物料名称,@规格,@颜色,@单位,@数量,@标签数,@备注);",
                new
                {
                    headerId,
                    lineNo = index + 1,
                    line.物料编号,
                    line.物料名称,
                    line.规格,
                    line.颜色,
                    line.单位,
                    line.数量,
                    line.标签数,
                    line.备注
                }, tx);
        }
    }

    private static Task<LockedHeaderRow?> GetLockedHeaderAsync(SqlConnection c, SqlTransaction tx, string documentNo)
        => c.QuerySingleOrDefaultAsync<LockedHeaderRow>(
            "SELECT [ID],[审核] FROM [塑胶标签单] WITH (UPDLOCK,HOLDLOCK) WHERE [电脑单号]=@documentNo",
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
