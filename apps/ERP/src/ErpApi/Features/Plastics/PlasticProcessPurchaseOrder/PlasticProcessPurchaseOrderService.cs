using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.MasterData;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
namespace ErpApi.Features.Plastics.PlasticProcessPurchaseOrder;

// 塑胶加工采购单(发外加工)。头(加工厂) + 明细(加工内容/单价/金额·带价)。
// 审核 = 纯锁定(走通用过账引擎只翻 审核='1',不动库存)。
// 明细按生产单号从塑胶共用物料表 BOM 调入(带出 加工内容/加工单价)。
// 下单门同塑胶采购单:生产通知单必须已审核,且实单未关联MA单(关联后塑胶不能再下单)。
public sealed class PlasticProcessPurchaseOrderService(ISqlConnectionFactory factory, IDocumentNumberGenerator docNo)
{
    public const string DocType = "塑胶加工采购单";
    public const string Prefix = "SJ";   // 塑胶加工采购单号 = SJ + yyyyMMdd + 3位流水

    // MA 关联查询:实单已关联MA单(生产制单货号.货号 → 款号物料总表.MA货号 非空)返回 "货号→MA货号",否则 null
    private static async Task<string?> MaLinkAsync(SqlConnection c, string 生产单号, SqlTransaction? tx = null)
        => await c.ExecuteScalarAsync<string?>(@"
SELECT TOP (1) g.[货号] + N'→' + LTRIM(RTRIM(h.[MA货号]))
FROM [生产制单货号] g
JOIN [款号物料总表] h ON h.[款号] = g.[货号]
WHERE g.[生产单号] = @生产单号
  AND NULLIF(LTRIM(RTRIM(ISNULL(h.[MA货号],N''))),N'') IS NOT NULL", new { 生产单号 }, tx);

    // 生产通知单下单门(与塑胶采购单同口径):必须已审核;已关联MA单的实单塑胶不能再下单
    private static async Task 校验生产通知单可下单Async(SqlConnection c, IReadOnlyList<PlasticProcessPurchaseOrderCreateLineDto> 明细)
    {
        foreach (var mo in 明细.Select(l => l.生产单号)
                     .Where(s => !string.IsNullOrWhiteSpace(s)).Select(s => s!.Trim()).Distinct())
        {
            var 审核 = await c.ExecuteScalarAsync<string?>(
                "SELECT ISNULL([审核],'0') FROM [生产制单] WHERE [生产单号]=@mo", new { mo });
            if (审核 is null) throw new ArgumentException($"生产通知单 {mo} 不存在。");
            if (审核 != "1") throw new ArgumentException($"生产通知单 {mo} 未审核，审核后才能采购下单。");
            var ma = await MaLinkAsync(c, mo);
            if (ma is not null)
                throw new ArgumentException($"生产通知单 {mo} 已关联MA单（{ma}），塑胶不能再对该实单下单；未关联MA单的实单才能下单。");
        }
    }

    public async Task<IReadOnlyList<PlasticProcessPurchaseOrderBasisRow>> BasisAsync(string 生产单号)
    {
        using var c = factory.Create();
        // 分析门：生产通知单(采购分析源单)必须已审核才能带料下单
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [生产制单] WHERE [生产单号]=@生产单号", new { 生产单号 });
        if (审核 is null) throw new KeyNotFoundException($"生产通知单 {生产单号} 不存在。");
        if (审核 != "1") throw new InvalidOperationException($"生产通知单 {生产单号} 未审核，审核后才能采购下单。");
        // MA 门:实单已关联MA单(生产制单货号.货号 → 款号物料总表.MA货号 非空)的,塑胶不能再下单
        var ma = await MaLinkAsync(c, 生产单号);
        if (ma is not null)
            throw new InvalidOperationException($"生产通知单 {生产单号} 已关联MA单（{ma}），塑胶不能再对该实单下单；未关联MA单的实单才能下单。");
        var rows = await c.QueryAsync<PlasticProcessPurchaseOrderBasisRow>(@"
SELECT g.[生产单号], pm.[款号], p.[工模编号] AS 模具编号, p.[物料编号], p.[物料名称],
       p.[用料名称], p.[颜色], p.[加工内容], p.[二次加工内容], p.[加工单价] AS 单价
FROM [塑胶共用物料表] p
JOIN [生产制单货号] g ON g.[货号] = p.[塑胶货号]
LEFT JOIN [生产制单] pm ON pm.[生产单号] = g.[生产单号]
WHERE g.[生产单号] = @生产单号
ORDER BY p.[ID]", new { 生产单号 });
        var list = rows.AsList();
        foreach (var r in list)
            r.二次加工类别 = SecondProcessCategory.推导后缀(r.加工内容, r.二次加工内容);
        return list;
    }

    public async Task<string> CreateAsync(PlasticProcessPurchaseOrderCreateDto dto, string user)
    {
        if (dto.明细.Count == 0) throw new ArgumentException("塑胶加工采购单至少要有一行加工明细");
        var 数量合计 = dto.明细.Sum(l => l.数量);
        var 金额合计 = dto.明细.Sum(l => l.数量 * (l.单价 ?? 0m));
        var now = DateTime.Now;

        using var c = factory.Create();
        await c.OpenAsync();
        // 下单门:明细引用的生产通知单必须全部已审核,且未关联MA单(与塑胶采购单同口径)
        await 校验生产通知单可下单Async(c, dto.明细);
        using var tx = c.BeginTransaction();

        // 兜底校验:加工内容必须与加工厂类别一致(前端已过滤,这里防绕过);厂无类别=不限制
        var 厂类别 = string.IsNullOrWhiteSpace(dto.加工厂编号) ? null
            : await c.QueryFirstOrDefaultAsync<string?>(
                "SELECT [加工厂类别] FROM [加工厂资料] WHERE [加工厂编号]=@no", new { no = dto.加工厂编号 }, tx);
        if (!string.IsNullOrWhiteSpace(厂类别))
            for (var i = 0; i < dto.明细.Count; i++)
            {
                var l = dto.明细[i];
                if (!FactoryProcessMatch.Matches(厂类别, l.加工内容))
                    throw new InvalidOperationException(
                        $"第{i + 1}行加工内容[{l.加工内容}]与加工厂[{dto.加工厂名称}]的类别[{厂类别}]不一致,不能下单");
            }

        var 单号 = await docNo.NextAsync(DocType, Prefix, now, c, tx);

        await c.ExecuteAsync(@"
INSERT INTO [塑胶加工采购单]([单号],[日期],[交货日期],[加工厂编号],[加工厂名称],[客户名称],[收货仓库],[收货人],[数量],[金额],[操作员],[审核],[备注])
VALUES(@单号,@日期,@交货日期,@加工厂编号,@加工厂名称,@客户名称,@收货仓库,@收货人,@数量,@金额,@操作员,'0',@备注)",
            new { 单号, 日期 = now, dto.交货日期, dto.加工厂编号, dto.加工厂名称, dto.客户名称,
                  dto.收货仓库, dto.收货人, 数量 = 数量合计, 金额 = 金额合计, 操作员 = user, dto.备注 }, tx);

        foreach (var l in dto.明细)
            await c.ExecuteAsync(@"
INSERT INTO [塑胶加工采购单明细]([单号],[生产单号],[款号],[模具编号],[物料编号],[物料名称],[用料名称],[颜色],[加工内容],[加工次序],[加工字母],[数量],[单价],[金额],[备注])
VALUES(@单号,@生产单号,@款号,@模具编号,@物料编号,@物料名称,@用料名称,@颜色,@加工内容,@加工次序,@加工字母,@数量,@单价,@金额,@备注)",
                new { 单号, l.生产单号, l.款号, l.模具编号, l.物料编号, l.物料名称, l.用料名称, l.颜色,
                      l.加工内容, l.加工次序, l.加工字母, l.数量, l.单价, 金额 = l.数量 * (l.单价 ?? 0m), l.备注 }, tx);

        tx.Commit();
        return 单号;
    }

    public async Task<PagedResult<PlasticProcessPurchaseOrderHeaderDto>> ListAsync(int page, int size, string? keyword)
    {
        if (page < 1) page = 1;
        if (size < 1) size = 20;
        if (size > 1000) size = 1000;
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [塑胶加工采购单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [加工厂名称] LIKE @kw OR [客户名称] LIKE @kw;
SELECT [ID],[单号],[日期],[交货日期],[加工厂名称],[客户名称],[数量],[金额],[操作员],[审核],[审核人],[备注],[主管审核],[主管审核人],[经理审核],[经理审核人]
FROM [塑胶加工采购单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [加工厂名称] LIKE @kw OR [客户名称] LIKE @kw
ORDER BY [ID] DESC OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;", new { kw, page, size });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<PlasticProcessPurchaseOrderHeaderDto>()).AsList();
        return new PagedResult<PlasticProcessPurchaseOrderHeaderDto>(items, total);
    }

    public async Task<PlasticProcessPurchaseOrderDetailDto?> GetAsync(string 单号)
    {
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT [ID],[单号],[日期],[交货日期],[加工厂编号],[加工厂名称],[客户名称],[收货仓库],[收货人],[数量],[金额],[操作员],[审核],[审核人],[备注],[主管审核],[主管审核人],[经理审核],[经理审核人]
FROM [塑胶加工采购单] WHERE [单号]=@单号;
SELECT [ID],[生产单号],[款号],[模具编号],[物料编号],[物料名称],[用料名称],[颜色],[加工内容],[加工次序],[加工字母],[数量],[单价],[金额],[备注]
FROM [塑胶加工采购单明细] WHERE [单号]=@单号 ORDER BY [ID];", new { 单号 });
        var header = await multi.ReadFirstOrDefaultAsync<PlasticProcessPurchaseOrderHeaderDto>();
        if (header is null) return null;
        var lines = (await multi.ReadAsync<PlasticProcessPurchaseOrderLineDto>()).AsList();
        return new PlasticProcessPurchaseOrderDetailDto { 单头 = header, 明细 = lines };
    }

    private static string ApprovalFilter(string? 审核情况) => 审核情况 switch
    {
        "已审核" => " AND ISNULL(h.[审核],'0')='1'",
        "未审核" => " AND ISNULL(h.[审核],'0')<>'1'",
        _ => "",
    };

    public async Task<IReadOnlyList<PlasticProcessPurchaseQueryDetailRow>> QueryDetailAsync(
        DateTime 起, DateTime 止, string? keyword, string? 审核情况, string? 物料类别)
    {
        var qi = 起.Date; var qe = 止.Date.AddDays(1);
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var cat = string.IsNullOrWhiteSpace(物料类别) ? null : 物料类别.Trim();
        using var c = factory.Create();
        var rows = await c.QueryAsync<PlasticProcessPurchaseQueryDetailRow>($@"
SELECT h.[日期] AS 单据日期, d.[单号], h.[加工厂名称], d.[生产单号], d.[款号], d.[模具编号], d.[物料编号], d.[物料名称],
       d.[用料名称], d.[颜色], d.[加工内容], m.[单位], d.[数量], d.[单价], d.[金额], d.[备注], h.[审核]
FROM [塑胶加工采购单明细] d
JOIN [塑胶加工采购单] h ON h.[单号] = d.[单号]
LEFT JOIN (SELECT [物料编号], MAX([单位]) AS 单位, MAX([物料类别]) AS 物料类别 FROM [塑胶物料资料] GROUP BY [物料编号]) m ON m.[物料编号] = d.[物料编号]
WHERE h.[日期] >= @qi AND h.[日期] < @qe
  AND (@kw IS NULL OR d.[单号] LIKE @kw OR h.[加工厂名称] LIKE @kw OR d.[生产单号] LIKE @kw OR d.[款号] LIKE @kw OR d.[物料编号] LIKE @kw OR d.[物料名称] LIKE @kw)
  AND (@cat IS NULL OR m.[物料类别] = @cat){ApprovalFilter(审核情况)}
ORDER BY h.[日期] DESC, d.[单号], d.[ID]", new { qi, qe, kw, cat });
        return rows.AsList();
    }

    public async Task<IReadOnlyList<PlasticProcessPurchaseQuerySummaryRow>> QuerySummaryAsync(
        DateTime 起, DateTime 止, string? keyword, string? 审核情况, string? 物料类别)
    {
        var qi = 起.Date; var qe = 止.Date.AddDays(1);
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var cat = string.IsNullOrWhiteSpace(物料类别) ? null : 物料类别.Trim();
        using var c = factory.Create();
        var rows = await c.QueryAsync<PlasticProcessPurchaseQuerySummaryRow>($@"
SELECT d.[模具编号], d.[物料编号], MAX(d.[物料名称]) AS 物料名称, d.[颜色],
       MAX(cm.[共用原料编号]) AS 共用物料, d.[加工内容], MAX(m.[物料类别]) AS 物料类别, MAX(m.[单位]) AS 单位,
       SUM(d.[数量]) AS 订购数量, SUM(ISNULL(d.[金额],0)) AS 总金额
FROM [塑胶加工采购单明细] d
JOIN [塑胶加工采购单] h ON h.[单号] = d.[单号]
LEFT JOIN (SELECT [物料编号], MAX([共用原料编号]) AS 共用原料编号 FROM [塑胶共用物料表] GROUP BY [物料编号]) cm ON cm.[物料编号] = d.[物料编号]
LEFT JOIN (SELECT [物料编号], MAX([单位]) AS 单位, MAX([物料类别]) AS 物料类别 FROM [塑胶物料资料] GROUP BY [物料编号]) m ON m.[物料编号] = d.[物料编号]
WHERE h.[日期] >= @qi AND h.[日期] < @qe
  AND (@kw IS NULL OR d.[单号] LIKE @kw OR h.[加工厂名称] LIKE @kw OR d.[生产单号] LIKE @kw OR d.[款号] LIKE @kw OR d.[物料编号] LIKE @kw OR d.[物料名称] LIKE @kw)
  AND (@cat IS NULL OR m.[物料类别] = @cat){ApprovalFilter(审核情况)}
GROUP BY d.[模具编号], d.[物料编号], d.[颜色], d.[加工内容]
ORDER BY d.[物料编号]", new { qi, qe, kw, cat });
        return rows.AsList();
    }

    public async Task<IReadOnlyList<PlasticProcessPurchaseProgressRow>> ProgressAsync(
        string? 加工厂, DateTime? 起, DateTime? 止, string? keyword, bool onlyOwed)
    {
        var f = string.IsNullOrWhiteSpace(加工厂) ? null : $"%{加工厂.Trim()}%";
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var 止Excl = 止?.Date.AddDays(1);
        using var c = factory.Create();
        var rows = await c.QueryAsync<PlasticProcessPurchaseProgressRow>(@"
SELECT o.[日期] AS 订购日期, o.[交货日期], o.[单号] AS 加工采购单号, d.[生产单号], d.[款号],
       d.[模具编号], d.[物料编号], d.[物料名称], d.[用料名称], d.[颜色], d.[加工内容], m.[单位],
       d.[数量] AS 订购数量, d.[单价], d.[金额] AS 订购金额,
       ISNULL(rk.[入仓数量], 0) AS 入仓数量, ISNULL(rk.[入仓金额], 0) AS 入仓金额,
       d.[数量] - ISNULL(rk.[入仓数量], 0) AS 剩余数量,
       ISNULL(d.[金额], 0) - ISNULL(rk.[入仓金额], 0) AS 剩余金额,
       o.[加工厂名称], o.[审核]
FROM [塑胶加工采购单明细] d
JOIN [塑胶加工采购单] o ON o.[单号] = d.[单号]
LEFT JOIN (SELECT [物料编号], MAX([单位]) AS 单位 FROM [塑胶物料资料] GROUP BY [物料编号]) m ON m.[物料编号] = d.[物料编号]
LEFT JOIN (
    SELECT r.[生产单号], r.[物料编号], ISNULL(r.[颜色],'') AS 颜色键,
           SUM(r.[数量]) AS 入仓数量, SUM(ISNULL(r.[金额],0)) AS 入仓金额
    FROM [塑胶入仓明细单] r
    JOIN [塑胶入仓单] h ON h.[单号] = r.[单号]
    WHERE ISNULL(h.[审核],'0') = '1'
    GROUP BY r.[生产单号], r.[物料编号], ISNULL(r.[颜色],'')
) rk ON rk.[生产单号] = d.[生产单号] AND rk.[物料编号] = d.[物料编号] AND rk.[颜色键] = ISNULL(d.[颜色],'')
WHERE (@f IS NULL OR o.[加工厂编号] LIKE @f OR o.[加工厂名称] LIKE @f)
  AND (@起 IS NULL OR o.[日期] >= @起)
  AND (@止 IS NULL OR o.[日期] < @止)
  AND (@kw IS NULL OR d.[生产单号] LIKE @kw OR d.[款号] LIKE @kw OR d.[物料编号] LIKE @kw OR d.[物料名称] LIKE @kw)
  AND (@onlyOwed = 0 OR (d.[数量] - ISNULL(rk.[入仓数量], 0)) > 0)
ORDER BY o.[单号] DESC, d.[ID]", new { f, 起, 止 = 止Excl, kw, onlyOwed = onlyOwed ? 1 : 0 });
        return rows.AsList();
    }

    public async Task<IReadOnlyList<PlasticProcessPurchaseDetailRow>> PurchaseDetailAsync(
        string? 加工厂, DateTime? 起, DateTime? 止, string? keyword, string? 完成情况)
    {
        var f = string.IsNullOrWhiteSpace(加工厂) ? null : $"%{加工厂.Trim()}%";
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var 止Excl = 止?.Date.AddDays(1);
        var done = 完成情况 switch { "已完成" => 1, "未完成" => 0, _ => -1 };
        using var c = factory.Create();
        var rows = await c.QueryAsync<PlasticProcessPurchaseDetailRow>(@"
SELECT o.[日期] AS 订购日期, o.[交货日期], o.[单号] AS 订购单号, d.[生产单号], d.[款号],
       d.[模具编号], d.[物料编号], d.[物料名称], d.[用料名称], d.[颜色], d.[加工内容], m.[单位],
       d.[数量] AS 订购数量, d.[单价], d.[金额] AS 订购金额,
       rk.[入仓日期], rk.[入仓单号], ISNULL(rk.[入仓数量], 0) AS 入仓数量, ISNULL(rk.[入仓金额], 0) AS 入仓金额,
       d.[数量] - ISNULL(rk.[入仓数量], 0) AS 未完成数量,
       ISNULL(d.[金额], 0) - ISNULL(rk.[入仓金额], 0) AS 未完成金额,
       CASE WHEN d.[数量] - ISNULL(rk.[入仓数量], 0) <= 0 THEN N'已完成' ELSE N'未完成' END AS 完成情况,
       o.[加工厂名称]
FROM [塑胶加工采购单明细] d
JOIN [塑胶加工采购单] o ON o.[单号] = d.[单号]
LEFT JOIN (SELECT [物料编号], MAX([单位]) AS 单位 FROM [塑胶物料资料] GROUP BY [物料编号]) m ON m.[物料编号] = d.[物料编号]
LEFT JOIN (
    SELECT r.[生产单号], r.[物料编号], ISNULL(r.[颜色],'') AS 颜色键,
           SUM(r.[数量]) AS 入仓数量, SUM(ISNULL(r.[金额],0)) AS 入仓金额,
           MAX(r.[单号]) AS 入仓单号, MAX(h.[日期]) AS 入仓日期
    FROM [塑胶入仓明细单] r
    JOIN [塑胶入仓单] h ON h.[单号] = r.[单号]
    WHERE ISNULL(h.[审核],'0') = '1'
    GROUP BY r.[生产单号], r.[物料编号], ISNULL(r.[颜色],'')
) rk ON rk.[生产单号] = d.[生产单号] AND rk.[物料编号] = d.[物料编号] AND rk.[颜色键] = ISNULL(d.[颜色],'')
WHERE (@f IS NULL OR o.[加工厂编号] LIKE @f OR o.[加工厂名称] LIKE @f)
  AND (@起 IS NULL OR o.[日期] >= @起)
  AND (@止 IS NULL OR o.[日期] < @止)
  AND (@kw IS NULL OR d.[生产单号] LIKE @kw OR d.[款号] LIKE @kw OR d.[物料编号] LIKE @kw OR d.[物料名称] LIKE @kw)
  AND (@done = -1 OR (@done = 1 AND (d.[数量] - ISNULL(rk.[入仓数量],0)) <= 0) OR (@done = 0 AND (d.[数量] - ISNULL(rk.[入仓数量],0)) > 0))
ORDER BY o.[单号] DESC, d.[ID]", new { f, 起, 止 = 止Excl, kw, done });
        return rows.AsList();
    }

    public async Task<IReadOnlyList<PlasticProcessIssueProgressRow>> IssueProgressAsync(
        string? 加工厂, DateTime? 起, DateTime? 止, string? keyword, string? 完成情况)
    {
        var f = string.IsNullOrWhiteSpace(加工厂) ? null : $"%{加工厂.Trim()}%";
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var 止Excl = 止?.Date.AddDays(1);
        var done = 完成情况 switch { "已完成" => 1, "未完成" => 0, _ => -1 };
        using var c = factory.Create();
        var rows = await c.QueryAsync<PlasticProcessIssueProgressRow>(@"
SELECT o.[日期] AS 订购日期, o.[交货日期], o.[单号] AS 订购单号, d.[生产单号], d.[款号],
       d.[模具编号], d.[物料编号], d.[物料名称], d.[用料名称], d.[颜色], d.[加工内容], m.[单位],
       d.[数量] AS 订购数量, d.[单价], d.[金额] AS 订购金额,
       rk.[领料日期], rk.[领料单号], ISNULL(rk.[领料数量], 0) AS 领料数量,
       d.[数量] - ISNULL(rk.[领料数量], 0) AS 未完成数量,
       (d.[数量] - ISNULL(rk.[领料数量], 0)) * ISNULL(d.[单价], 0) AS 未完成金额,
       CASE WHEN d.[数量] - ISNULL(rk.[领料数量], 0) <= 0 THEN N'已完成' ELSE N'未完成' END AS 完成情况,
       o.[加工厂名称]
FROM [塑胶加工采购单明细] d
JOIN [塑胶加工采购单] o ON o.[单号] = d.[单号]
LEFT JOIN (SELECT [物料编号], MAX([单位]) AS 单位 FROM [塑胶物料资料] GROUP BY [物料编号]) m ON m.[物料编号] = d.[物料编号]
LEFT JOIN (
    SELECT r.[生产单号], r.[物料编号], ISNULL(r.[颜色],'') AS 颜色键,
           SUM(r.[数量]) AS 领料数量, MAX(r.[单号]) AS 领料单号, MAX(h.[日期]) AS 领料日期
    FROM [白件领料明细单] r
    JOIN [白件领料单] h ON h.[单号] = r.[单号]
    WHERE ISNULL(h.[审核],'0') = '1'
    GROUP BY r.[生产单号], r.[物料编号], ISNULL(r.[颜色],'')
) rk ON rk.[生产单号] = d.[生产单号] AND rk.[物料编号] = d.[物料编号] AND rk.[颜色键] = ISNULL(d.[颜色],'')
WHERE (@f IS NULL OR o.[加工厂编号] LIKE @f OR o.[加工厂名称] LIKE @f)
  AND (@起 IS NULL OR o.[日期] >= @起)
  AND (@止 IS NULL OR o.[日期] < @止)
  AND (@kw IS NULL OR d.[生产单号] LIKE @kw OR d.[款号] LIKE @kw OR d.[物料编号] LIKE @kw OR d.[物料名称] LIKE @kw)
  AND (@done = -1 OR (@done = 1 AND (d.[数量] - ISNULL(rk.[领料数量],0)) <= 0) OR (@done = 0 AND (d.[数量] - ISNULL(rk.[领料数量],0)) > 0))
ORDER BY o.[单号] DESC, d.[ID]", new { f, 起, 止 = 止Excl, kw, done });
        return rows.AsList();
    }

    public async Task<IReadOnlyList<PlasticProcessShortageRow>> ShortageAsync(
        string? 物料类别, string? 审核情况, string? keyword, bool onlyOwed)
    {
        var cat = string.IsNullOrWhiteSpace(物料类别) ? null : 物料类别.Trim();
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var appr = 审核情况 switch
        {
            "已审核" => " AND ISNULL(o.[审核],'0')='1'",
            "未审核" => " AND ISNULL(o.[审核],'0')<>'1'",
            _ => "",
        };
        using var c = factory.Create();
        var rows = await c.QueryAsync<PlasticProcessShortageRow>($@"
SELECT d.[物料编号], MAX(cm.[共用原料编号]) AS 共用物料编号, MAX(d.[物料名称]) AS 物料名称,
       d.[模具编号], MAX(cn.[物料名称]) AS 共用物料, MAX(m.[物料类别]) AS 物料类别, MAX(m.[单位]) AS 单位,
       SUM(d.[数量] - ISNULL(rk.[入仓数量],0)) AS 欠数,
       MAX(d.[单价]) AS 单价,
       SUM((d.[数量] - ISNULL(rk.[入仓数量],0)) * ISNULL(d.[单价],0)) AS 金额
FROM [塑胶加工采购单明细] d
JOIN [塑胶加工采购单] o ON o.[单号] = d.[单号]
LEFT JOIN (SELECT [物料编号], MAX([单位]) AS 单位, MAX([物料类别]) AS 物料类别, MAX([物料名称]) AS 物料名称 FROM [塑胶物料资料] GROUP BY [物料编号]) m ON m.[物料编号] = d.[物料编号]
LEFT JOIN (SELECT [物料编号], MAX([共用原料编号]) AS 共用原料编号 FROM [塑胶共用物料表] GROUP BY [物料编号]) cm ON cm.[物料编号] = d.[物料编号]
LEFT JOIN (SELECT [物料编号], MAX([物料名称]) AS 物料名称 FROM [塑胶物料资料] GROUP BY [物料编号]) cn ON cn.[物料编号] = cm.[共用原料编号]
LEFT JOIN (
    SELECT r.[生产单号], r.[物料编号], ISNULL(r.[颜色],'') AS 颜色键, SUM(r.[数量]) AS 入仓数量
    FROM [塑胶入仓明细单] r
    JOIN [塑胶入仓单] h ON h.[单号] = r.[单号]
    WHERE ISNULL(h.[审核],'0') = '1'
    GROUP BY r.[生产单号], r.[物料编号], ISNULL(r.[颜色],'')
) rk ON rk.[生产单号] = d.[生产单号] AND rk.[物料编号] = d.[物料编号] AND rk.[颜色键] = ISNULL(d.[颜色],'')
WHERE (@cat IS NULL OR m.[物料类别] = @cat)
  AND (@kw IS NULL OR d.[物料编号] LIKE @kw OR d.[物料名称] LIKE @kw){appr}
GROUP BY d.[物料编号], d.[模具编号]
HAVING (@onlyOwed = 0 OR SUM(d.[数量] - ISNULL(rk.[入仓数量],0)) > 0)
ORDER BY d.[物料编号]", new { cat, kw, onlyOwed = onlyOwed ? 1 : 0 });
        return rows.AsList();
    }

    public async Task<bool> DeleteAsync(string 单号)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [塑胶加工采购单] WITH (UPDLOCK, HOLDLOCK) WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null) return false;
        if (审核 == "1") throw new InvalidOperationException("已审核的塑胶加工采购单不能删除，请先反审核。");
        await c.ExecuteAsync("DELETE FROM [塑胶加工采购单明细] WHERE [单号]=@单号", new { 单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [塑胶加工采购单] WHERE [单号]=@单号", new { 单号 }, tx);
        tx.Commit();
        return true;
    }
}
