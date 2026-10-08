using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.MasterData;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Plastics.PlasticMaterialDoc;

// 塑胶物料单。两层:塑胶物料单(头) + 塑胶物料明细单(明细)。
// basis 来源:塑胶共用物料表 JOIN 生产制单货号 ON 货号=塑胶货号;仓位号 LEFT JOIN 塑胶物料资料。
// 审核/反审核由通用过账引擎处理(仅翻头表审核位)。
public sealed class PlasticMaterialDocService(ISqlConnectionFactory factory, IDocumentNumberGenerator docNo)
{
    public const string DocType = "塑胶物料单";
    public const string Prefix = "SL";   // 单号 = SL + yyyyMMdd + 3位流水

    // 塑胶采购分析:列生产单(按 生产制单.日期 区间 + 关键词 + 下单情况)。
    // 下单情况="已下单"/"未下单":以 塑胶采购订单明细 是否引用该生产单为准(未删即算保存过;前端分 已保存/未保存 两组)。
    public async Task<PagedResult<PlasticOrderRow>> OrdersAsync(DateTime? 起, DateTime? 止, string? keyword, int page, int size, string? 下单情况 = null)
    {
        if (page < 1) page = 1;
        if (size < 1) size = 20;
        if (size > 1000) size = 1000;
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var 止Excl = 止?.Date.AddDays(1);
        var 已订 = 下单情况 == "已下单" ? true : 下单情况 == "未下单" ? false : (bool?)null;
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [生产制单] pm
WHERE (@起 IS NULL OR [日期] >= @起) AND (@止 IS NULL OR [日期] < @止)
  AND (@kw IS NULL OR [生产单号] LIKE @kw OR [款号] LIKE @kw OR [款式] LIKE @kw OR [客户名称] LIKE @kw OR [合同号] LIKE @kw)
  AND (@已订 IS NULL OR (@已订 = 1 AND EXISTS (SELECT 1 FROM [塑胶采购订单明细] d WHERE d.[生产单号]=pm.[生产单号]))
       OR (@已订 = 0 AND NOT EXISTS (SELECT 1 FROM [塑胶采购订单明细] d WHERE d.[生产单号]=pm.[生产单号])));
SELECT pm.[ID],pm.[生产单号],pm.[款号],pm.[款式],pm.[合同号],pm.[客户名称],pm.[计划数量],pm.[日期],pm.[交货日期],pm.[审核],
       CASE WHEN EXISTS (SELECT 1 FROM [塑胶采购订单明细] d WHERE d.[生产单号]=pm.[生产单号])
            THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS [已下单],
       (SELECT STRING_AGG(x.[单号], N',') FROM (SELECT DISTINCT d2.[单号] FROM [塑胶采购订单明细] d2
          WHERE d2.[生产单号]=pm.[生产单号]) x) AS [采购单号]
FROM [生产制单] pm
WHERE (@起 IS NULL OR [日期] >= @起) AND (@止 IS NULL OR [日期] < @止)
  AND (@kw IS NULL OR [生产单号] LIKE @kw OR [款号] LIKE @kw OR [款式] LIKE @kw OR [客户名称] LIKE @kw OR [合同号] LIKE @kw)
  AND (@已订 IS NULL OR (@已订 = 1 AND EXISTS (SELECT 1 FROM [塑胶采购订单明细] d WHERE d.[生产单号]=pm.[生产单号]))
       OR (@已订 = 0 AND NOT EXISTS (SELECT 1 FROM [塑胶采购订单明细] d WHERE d.[生产单号]=pm.[生产单号])))
ORDER BY pm.[ID] DESC OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;",
            new { 起, 止 = 止Excl, kw, page, size, 已订 });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<PlasticOrderRow>()).AsList();
        return new PagedResult<PlasticOrderRow>(items, total);
    }

    // 按生产单货号从塑胶共用物料表带出塑胶用料(仓位号 LEFT JOIN 塑胶物料资料)。
    public async Task<IReadOnlyList<PlasticMaterialBasisRow>> BasisAsync(string 生产单号)
    {
        using var c = factory.Create();
        var rows = await c.QueryAsync<PlasticMaterialBasisRow>(@"
SELECT g.[货号], p.[工模编号], p.[物料编号], p.[物料名称], p.[颜色],
       m.[仓位号], p.[用料名称], p.[加工内容], p.[加工单价], p.[用量]
FROM [塑胶共用物料表] p
JOIN [生产制单货号] g ON g.[货号] = p.[塑胶货号]
LEFT JOIN (SELECT [物料编号], MAX([仓位号]) AS 仓位号 FROM [塑胶物料资料] GROUP BY [物料编号]) m
       ON m.[物料编号] = p.[物料编号]
WHERE g.[生产单号] = @生产单号
ORDER BY p.[ID]", new { 生产单号 });
        return rows.AsList();
    }

    // 保存成单:生成 SL 单号,插头(数量/金额合计)+ 逐行插明细(金额=订购数量×加工单价)。
    public async Task<string> CreateAsync(PlasticMaterialDocCreateDto dto, string user)
    {
        if (dto.明细.Count == 0) throw new ArgumentException("塑胶物料单至少要有一行明细");
        var 数量合计 = dto.明细.Sum(l => l.订购数量);
        var 金额合计 = dto.明细.Sum(l => l.订购数量 * (l.加工单价 ?? 0));
        var now = DateTime.Now;

        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 单号 = await docNo.NextAsync(DocType, Prefix, now, c, tx);

        await c.ExecuteAsync(@"
INSERT INTO [塑胶物料单]([单号],[日期],[生产单号],[货号],[客户],[数量],[金额],[操作员],[审核],[备注])
VALUES(@单号,@日期,@生产单号,@货号,@客户,@数量,@金额,@操作员,'0',@备注)",
            new { 单号, 日期 = now, dto.生产单号, dto.货号, dto.客户,
                  数量 = 数量合计, 金额 = 金额合计, 操作员 = user, dto.备注 }, tx);

        foreach (var l in dto.明细)
            await c.ExecuteAsync(@"
INSERT INTO [塑胶物料明细单]([单号],[生产单号],[货号],[工模编号],[物料编号],[物料名称],[颜色],[仓位号],[用料名称],[加工内容],[加工单价],[用量],[订购数量],[金额])
VALUES(@单号,@生产单号,@货号,@工模编号,@物料编号,@物料名称,@颜色,@仓位号,@用料名称,@加工内容,@加工单价,@用量,@订购数量,@金额)",
                new { 单号, dto.生产单号, dto.货号, l.工模编号, l.物料编号, l.物料名称, l.颜色, l.仓位号,
                      l.用料名称, l.加工内容, l.加工单价, l.用量, l.订购数量, 金额 = l.订购数量 * (l.加工单价 ?? 0) }, tx);

        tx.Commit();
        return 单号;
    }

    public async Task<PlasticMaterialDocDetailDto?> GetAsync(string 单号)
    {
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT [ID],[单号],[日期],[生产单号],[货号],[客户],[数量],[金额],[操作员],[审核],[审核人],[备注]
FROM [塑胶物料单] WHERE [单号]=@单号;
SELECT [ID],[工模编号],[物料编号],[物料名称],[颜色],[仓位号],[用料名称],[加工内容],[加工单价],[用量],[订购数量],[金额],[备注]
FROM [塑胶物料明细单] WHERE [单号]=@单号 ORDER BY [ID];", new { 单号 });
        var header = await multi.ReadFirstOrDefaultAsync<PlasticMaterialDocHeaderDto>();
        if (header is null) return null;
        var lines = (await multi.ReadAsync<PlasticMaterialDocLineDto>()).AsList();
        return new PlasticMaterialDocDetailDto { 单头 = header, 明细 = lines };
    }

    // 塑胶类型客户统计:按 客户 × 加工内容(=塑胶类型) 汇总 订购数量/金额(仅审核='1' + 单据日期区间)。
    public async Task<IReadOnlyList<PlasticCustomerTypeStatRow>> CustomerTypeStatsAsync(DateTime 起, DateTime 止, string? 客户)
    {
        var qi = 起.Date;
        var qe = 止.Date.AddDays(1);
        var ck = string.IsNullOrWhiteSpace(客户) ? null : $"%{客户.Trim()}%";
        using var c = factory.Create();
        var rows = await c.QueryAsync<PlasticCustomerTypeStatRow>(@"
SELECT h.[客户] AS 客户, ISNULL(NULLIF(LTRIM(RTRIM(d.[加工内容])), N''), N'未分类') AS 类型,
       SUM(ISNULL(d.[订购数量],0)) AS 数量, SUM(ISNULL(d.[金额],0)) AS 金额
FROM [塑胶物料明细单] d JOIN [塑胶物料单] h ON h.[单号]=d.[单号]
WHERE ISNULL(h.[审核],'0')='1' AND h.[日期] >= @qi AND h.[日期] < @qe
  AND (@ck IS NULL OR h.[客户] LIKE @ck)
GROUP BY h.[客户], ISNULL(NULLIF(LTRIM(RTRIM(d.[加工内容])), N''), N'未分类')
HAVING SUM(ISNULL(d.[订购数量],0)) <> 0 OR SUM(ISNULL(d.[金额],0)) <> 0
ORDER BY h.[客户], 类型", new { qi, qe, ck });
        return rows.AsList();
    }

    // 塑胶分析明细查询:塑胶物料明细 JOIN 单头(日期) + LEFT JOIN 生产制单(款号/完成) + LEFT JOIN 塑胶物料资料(材料/单位)。
    public async Task<IReadOnlyList<PlasticAnalysisDetailRow>> AnalysisDetailAsync(DateTime 起, DateTime 止, string? keyword, string? 完成)
    {
        var qi = 起.Date; var qe = 止.Date.AddDays(1);
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var done = string.IsNullOrWhiteSpace(完成) ? null : 完成.Trim();
        using var c = factory.Create();
        var rows = await c.QueryAsync<PlasticAnalysisDetailRow>(@"
SELECT h.[日期], d.[生产单号], p.[款号], d.[货号], d.[物料编号], d.[物料名称], d.[颜色],
       m.[物料类别] AS 材料, m.[单位], d.[加工内容], d.[订购数量] AS 数量,
       d.[加工单价], d.[金额], ISNULL(p.[完成], N'否') AS 完成
FROM [塑胶物料明细单] d
JOIN [塑胶物料单] h ON h.[单号] = d.[单号]
LEFT JOIN [生产制单] p ON p.[生产单号] = d.[生产单号]
LEFT JOIN (SELECT [物料编号], MAX([物料类别]) AS 物料类别, MAX([单位]) AS 单位
           FROM [塑胶物料资料] GROUP BY [物料编号]) m ON m.[物料编号] = d.[物料编号]
WHERE h.[日期] >= @qi AND h.[日期] < @qe
  AND (@kw IS NULL OR d.[生产单号] LIKE @kw OR p.[款号] LIKE @kw OR d.[货号] LIKE @kw OR d.[物料编号] LIKE @kw OR d.[物料名称] LIKE @kw)
  AND (@done IS NULL OR ISNULL(p.[完成], N'否') = @done)
ORDER BY h.[日期] DESC, d.[单号], d.[ID]", new { qi, qe, kw, done });
        return rows.AsList();
    }

    private static string ApprovalFilter(string? 审核情况) => 审核情况 switch
    {
        "已审核" => " AND ISNULL(h.[审核],'0')='1'",
        "未审核" => " AND ISNULL(h.[审核],'0')<>'1'",
        _ => "",
    };

    public async Task<IReadOnlyList<PlasticOrderQueryDetailRow>> OrderQueryDetailAsync(
        DateTime 起, DateTime 止, string? keyword, string? 审核情况, string? 物料类别)
    {
        var qi = 起.Date; var qe = 止.Date.AddDays(1);
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var cat = string.IsNullOrWhiteSpace(物料类别) ? null : 物料类别.Trim();
        using var c = factory.Create();
        var rows = await c.QueryAsync<PlasticOrderQueryDetailRow>($@"
SELECT h.[日期], d.[单号], d.[工模编号], d.[生产单号], p.[款号], d.[货号], d.[物料编号], d.[物料名称], d.[颜色],
       m.[物料类别] AS 材料, m.[规格], m.[单位], d.[订购数量] AS 数量, d.[加工单价], d.[金额], h.[审核]
FROM [塑胶物料明细单] d
JOIN [塑胶物料单] h ON h.[单号] = d.[单号]
LEFT JOIN [生产制单] p ON p.[生产单号] = d.[生产单号]
LEFT JOIN (SELECT [物料编号], MAX([物料类别]) AS 物料类别, MAX([规格]) AS 规格, MAX([单位]) AS 单位
           FROM [塑胶物料资料] GROUP BY [物料编号]) m ON m.[物料编号] = d.[物料编号]
WHERE h.[日期] >= @qi AND h.[日期] < @qe
  AND (@kw IS NULL OR d.[物料编号] LIKE @kw OR d.[物料名称] LIKE @kw OR m.[规格] LIKE @kw OR d.[货号] LIKE @kw OR p.[款号] LIKE @kw OR d.[生产单号] LIKE @kw)
  AND (@cat IS NULL OR m.[物料类别] = @cat){ApprovalFilter(审核情况)}
ORDER BY h.[日期] DESC, d.[单号], d.[ID]", new { qi, qe, kw, cat });
        return rows.AsList();
    }

    public async Task<IReadOnlyList<PlasticOrderQuerySummaryRow>> OrderQuerySummaryAsync(
        DateTime 起, DateTime 止, string? keyword, string? 审核情况, string? 物料类别)
    {
        var qi = 起.Date; var qe = 止.Date.AddDays(1);
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var cat = string.IsNullOrWhiteSpace(物料类别) ? null : 物料类别.Trim();
        using var c = factory.Create();
        var rows = await c.QueryAsync<PlasticOrderQuerySummaryRow>($@"
SELECT d.[物料编号], MAX(d.[物料名称]) AS 物料名称, MAX(m.[物料类别]) AS 物料类别, m.[规格], d.[颜色], MAX(m.[单位]) AS 单位,
       SUM(ISNULL(d.[订购数量],0)) AS 数量, SUM(ISNULL(d.[金额],0)) AS 金额
FROM [塑胶物料明细单] d
JOIN [塑胶物料单] h ON h.[单号] = d.[单号]
LEFT JOIN (SELECT [物料编号], MAX([物料类别]) AS 物料类别, MAX([规格]) AS 规格, MAX([单位]) AS 单位
           FROM [塑胶物料资料] GROUP BY [物料编号]) m ON m.[物料编号] = d.[物料编号]
WHERE h.[日期] >= @qi AND h.[日期] < @qe
  AND (@kw IS NULL OR d.[物料编号] LIKE @kw OR d.[物料名称] LIKE @kw OR m.[规格] LIKE @kw OR d.[货号] LIKE @kw)
  AND (@cat IS NULL OR m.[物料类别] = @cat){ApprovalFilter(审核情况)}
GROUP BY d.[物料编号], m.[规格], d.[颜色]
ORDER BY d.[物料编号]", new { qi, qe, kw, cat });
        return rows.AsList();
    }

    public async Task<IReadOnlyList<PlasticLabelQueryDetailRow>> LabelQueryDetailAsync(
        DateTime 起, DateTime 止, string? keyword, string? 审核情况, string? 物料类别)
    {
        var qi = 起.Date; var qe = 止.Date.AddDays(1);
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var cat = string.IsNullOrWhiteSpace(物料类别) ? null : 物料类别.Trim();
        using var c = factory.Create();
        var rows = await c.QueryAsync<PlasticLabelQueryDetailRow>($@"
SELECT h.[日期], d.[单号], p.[款号], d.[工模编号], d.[物料编号], d.[物料名称], d.[货号] AS 塑胶货号, d.[颜色],
       m.[单位], d.[订购数量] AS 数量, d.[备注], h.[审核]
FROM [塑胶物料明细单] d
JOIN [塑胶物料单] h ON h.[单号] = d.[单号]
LEFT JOIN [生产制单] p ON p.[生产单号] = d.[生产单号]
LEFT JOIN (SELECT [物料编号], MAX([物料类别]) AS 物料类别, MAX([单位]) AS 单位
           FROM [塑胶物料资料] GROUP BY [物料编号]) m ON m.[物料编号] = d.[物料编号]
WHERE h.[日期] >= @qi AND h.[日期] < @qe
  AND (@kw IS NULL OR d.[物料编号] LIKE @kw OR d.[物料名称] LIKE @kw OR p.[款号] LIKE @kw OR d.[货号] LIKE @kw OR d.[工模编号] LIKE @kw OR d.[生产单号] LIKE @kw)
  AND (@cat IS NULL OR m.[物料类别] = @cat){ApprovalFilter(审核情况)}
ORDER BY h.[日期] DESC, d.[单号], d.[ID]", new { qi, qe, kw, cat });
        return rows.AsList();
    }

    public async Task<IReadOnlyList<PlasticLabelQuerySummaryRow>> LabelQuerySummaryAsync(
        DateTime 起, DateTime 止, string? keyword, string? 审核情况, string? 物料类别)
    {
        var qi = 起.Date; var qe = 止.Date.AddDays(1);
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var cat = string.IsNullOrWhiteSpace(物料类别) ? null : 物料类别.Trim();
        using var c = factory.Create();
        var rows = await c.QueryAsync<PlasticLabelQuerySummaryRow>($@"
SELECT p.[款号], d.[工模编号], d.[物料编号], MAX(d.[物料名称]) AS 物料名称, d.[颜色], d.[货号] AS 塑胶货号,
       MAX(m.[单位]) AS 单位, SUM(ISNULL(d.[订购数量],0)) AS 数量
FROM [塑胶物料明细单] d
JOIN [塑胶物料单] h ON h.[单号] = d.[单号]
LEFT JOIN [生产制单] p ON p.[生产单号] = d.[生产单号]
LEFT JOIN (SELECT [物料编号], MAX([物料类别]) AS 物料类别, MAX([单位]) AS 单位
           FROM [塑胶物料资料] GROUP BY [物料编号]) m ON m.[物料编号] = d.[物料编号]
WHERE h.[日期] >= @qi AND h.[日期] < @qe
  AND (@kw IS NULL OR d.[物料编号] LIKE @kw OR d.[物料名称] LIKE @kw OR p.[款号] LIKE @kw OR d.[货号] LIKE @kw OR d.[工模编号] LIKE @kw)
  AND (@cat IS NULL OR m.[物料类别] = @cat){ApprovalFilter(审核情况)}
GROUP BY p.[款号], d.[工模编号], d.[物料编号], d.[颜色], d.[货号]
ORDER BY p.[款号], d.[工模编号], d.[物料编号]", new { qi, qe, kw, cat });
        return rows.AsList();
    }

    public async Task<IReadOnlyList<PlasticProcessOrderMakeRow>> ProcessOrderMakeListAsync(DateTime 起, DateTime 止, string? keyword)
    {
        var qi = 起.Date; var qe = 止.Date.AddDays(1);
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        var rows = await c.QueryAsync<PlasticProcessOrderMakeRow>(@"
SELECT pm.[日期] AS 单据日期, g.[生产单号], pm.[款号], g.[货号] AS 塑胶货号, p.[工模编号], p.[物料编号], p.[物料名称], p.[颜色],
       p.[色粉号], p.[加工内容], p.[二次加工内容], p.[用料名称], m.[单位], p.[用量], pm.[计划数量],
       p.[用量]*ISNULL(pm.[计划数量],0) AS 订购数量, p.[加工单价],
       p.[用量]*ISNULL(pm.[计划数量],0)*ISNULL(p.[加工单价],0) AS 金额
FROM [生产制单货号] g
JOIN [塑胶共用物料表] p ON p.[塑胶货号] = g.[货号]
JOIN [生产制单] pm ON pm.[生产单号] = g.[生产单号]
LEFT JOIN (SELECT [物料编号], MAX([单位]) AS 单位 FROM [塑胶物料资料] GROUP BY [物料编号]) m ON m.[物料编号] = p.[物料编号]
WHERE pm.[日期] >= @qi AND pm.[日期] < @qe
  AND p.[调整审核] = '1'
  AND (@kw IS NULL OR g.[生产单号] LIKE @kw OR pm.[款号] LIKE @kw OR p.[物料编号] LIKE @kw OR p.[物料名称] LIKE @kw OR g.[货号] LIKE @kw)
ORDER BY g.[生产单号], p.[物料编号]", new { qi, qe, kw });
        // 二次加工(旧说明书):带两个字母后缀编号的物料在加工订单制作里出现两次加工类别的数据,
        // 第一次加工(编号+A/B母)与第二次加工(编号+D/F/H)各一行,便于按加工次序分给不同供应商下单。
        var list = new List<PlasticProcessOrderMakeRow>();
        foreach (var r in rows)
        {
            var 类别 = SecondProcessCategory.推导后缀(r.加工内容, r.二次加工内容);
            if (类别 is null) { list.Add(r); continue; }
            r.二次加工类别 = 类别;
            r.加工次序 = "第一次";
            r.加工字母 = SecondProcessCategory.加工字母(类别, r.加工内容);
            list.Add(r);
            list.Add(new PlasticProcessOrderMakeRow
            {
                单据日期 = r.单据日期, 生产单号 = r.生产单号, 款号 = r.款号, 塑胶货号 = r.塑胶货号,
                工模编号 = r.工模编号, 物料编号 = r.物料编号, 物料名称 = r.物料名称, 颜色 = r.颜色,
                色粉号 = r.色粉号, 加工内容 = r.二次加工内容, 二次加工内容 = r.二次加工内容,
                二次加工类别 = 类别, 加工次序 = "第二次", 加工字母 = SecondProcessCategory.加工字母(类别, r.二次加工内容),
                用料名称 = r.用料名称, 单位 = r.单位, 用量 = r.用量, 计划数量 = r.计划数量,
                订购数量 = r.订购数量, 加工单价 = r.加工单价, 金额 = r.金额,
            });
        }
        return list;
    }

    // 已下喷油订单(喷油部收件视图)：已审核塑胶采购订单中 供应商名称含「喷油」的单,按明细行展开,按单头日期过滤。
    // 塑胶仓在塑胶采购订单里下给 喷油部/兴信喷油车间 的单,审核后这里即可见。
    // 加工内容/塑胶货号 按物料编号从 BOM(塑胶共用物料表)或塑胶物料资料补;喷油接收状态随单头带出。
    public async Task<IReadOnlyList<SprayOrderReceivedRow>> SprayOrderReceivedAsync(DateTime 起, DateTime 止, string? keyword)
    {
        var qi = 起.Date; var qe = 止.Date.AddDays(1);
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        var rows = await c.QueryAsync<SprayOrderReceivedRow>(@"
SELECT o.[单号] AS 采购单号, o.[日期] AS 单据日期, o.[交货日期], o.[供应商名称],
       d.[生产单号], d.[款号], d.[物料编号], d.[物料名称], d.[模具编号], d.[颜色], d.[色粉号], d.[用料名称], d.[数量], d.[备注],
       bom.[塑胶货号], COALESCE(NULLIF(mm.[加工内容], N''), NULLIF(bom.[加工内容], N'')) AS 加工内容,
       ISNULL(o.[喷油接收],'0') AS 喷油接收, o.[喷油接收人], o.[喷油接收时间]
FROM [塑胶采购订单] o
JOIN [塑胶采购订单明细] d ON d.[单号] = o.[单号]
LEFT JOIN (SELECT [物料编号], MAX([塑胶货号]) AS 塑胶货号, MAX([加工内容]) AS 加工内容
           FROM [塑胶共用物料表] GROUP BY [物料编号]) bom ON bom.[物料编号] = d.[物料编号]
LEFT JOIN [塑胶物料资料] mm ON mm.[物料编号] = d.[物料编号]
WHERE o.[日期] >= @qi AND o.[日期] < @qe
  AND ISNULL(o.[审核],'0') = '1'
  AND o.[供应商名称] LIKE N'%喷油%'
  AND (@kw IS NULL OR o.[单号] LIKE @kw OR o.[供应商名称] LIKE @kw OR d.[生产单号] LIKE @kw
       OR d.[款号] LIKE @kw OR d.[物料编号] LIKE @kw OR d.[物料名称] LIKE @kw)
ORDER BY o.[单号], d.[ID];", new { qi, qe, kw });
        return rows.AsList();
    }

    // 喷油部接收订单：仅 已审核 且 供应商含「喷油」 的塑胶采购订单可接收;重复接收拒绝。
    public async Task ReceiveSprayOrderAsync(string 单号, string user)
    {
        using var c = factory.Create();
        var n = await c.ExecuteAsync(@"
UPDATE [塑胶采购订单] SET [喷油接收]='1', [喷油接收人]=@user, [喷油接收时间]=SYSDATETIME()
WHERE [单号]=@单号 AND ISNULL([审核],'0')='1' AND [供应商名称] LIKE N'%喷油%' AND ISNULL([喷油接收],'0')<>'1'",
            new { 单号, user });
        if (n == 0) throw new InvalidOperationException("接收失败：单不存在、未审核、不是喷油订单或已接收。");
    }

    // 删除:仅未审核可删;FK 顺序 明细→头。
    public async Task<bool> DeleteAsync(string 单号)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [塑胶物料单] WITH (UPDLOCK, HOLDLOCK) WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null) return false;
        if (审核 == "1") throw new InvalidOperationException("已审核的塑胶物料单不能删除，请先反审核。");
        await c.ExecuteAsync("DELETE FROM [塑胶物料明细单] WHERE [单号]=@单号", new { 单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [塑胶物料单] WHERE [单号]=@单号", new { 单号 }, tx);
        tx.Commit();
        return true;
    }
}
