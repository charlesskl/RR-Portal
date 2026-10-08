using Dapper;
using ErpApi.Engines.Bom;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Engines.Inventory;
using ErpApi.Features.MasterData;
using ErpApi.Features.Messages;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging;
namespace ErpApi.Features.Production;

public sealed class ProductionService(
    ISqlConnectionFactory factory,
    IDocumentNumberGenerator docNo,
    IMaterialInventoryService inventory,
    ILogger<ProductionService>? log = null,
    MessageService? messages = null)
{
    public const string DocType = "生产制单";
    public const string Prefix = "SC";   // 生产单号 = SC + yyyyMMdd + 3位流水

    // 创建（一单多货号）：生成单号 → 插单头 → 逐货号(插货号明细 + 色码数量 + 算3工序 + 算4BOM) → 汇总回写单头 → 订单回写
    public async Task<string> CreateAsync(ProductionNoticeCreateDto dto, string user)
    {
        if (dto.货号明细.Count == 0) throw new ArgumentException("生产通知单至少要有一个货号");
        foreach (var line in dto.货号明细)
        {
            if (string.IsNullOrWhiteSpace(line.BOM款号)) throw new ArgumentException("每个货号必须指定 BOM款号");
            if (line.数量明细.Count == 0) throw new ArgumentException($"货号 [{line.货号}] 至少要有一行颜色尺码数量");
        }

        var 计划数量 = dto.货号明细.Sum(line => line.数量明细.Sum(q => q.数量));
        // 接单数量可手动输入;留空回落为明细合计(计划数量)
        var 接单数量 = dto.接单数量 ?? 计划数量;
        // 代表款号/款式：取第一个货号行（兼容列表/下游仍读单头.款号）
        var 代表款号 = dto.货号明细[0].BOM款号;
        var 代表款式 = dto.货号明细[0].款号名称;
        var now = DateTime.Now;
        var 下单日期 = dto.下单日期 ?? now;

        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();

        // 硬闸:必须先建 BOM 才能下生产单(排期弹窗/通知单页的前端提示可被绕过,这里服务端兜底)。
        // BOM款号 在 款号物料明细表 一行都没有 = 未建 BOM,直接拒单——否则展开出空物料清单,
        // 采购/来料仓拿到的就是一张没有需求的生产单。
        foreach (var line in dto.货号明细)
        {
            var bom行数 = await c.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM [款号物料明细表] WHERE [款号]=@款号", new { 款号 = line.BOM款号!.Trim() }, tx);
            if (bom行数 == 0)
                throw new ArgumentException(
                    $"货号 [{line.货号}] 还没有建 BOM(BOM款号 {line.BOM款号} 无物料明细)，请先到「工程部 - BOM物料设置」建 BOM 再下生产单。");
        }

        // 生产单号可手动指定(如沿用客户单号);留空则自动生成。手动指定时查重。
        string 生产单号;
        if (!string.IsNullOrWhiteSpace(dto.生产单号))
        {
            生产单号 = dto.生产单号.Trim();
            var dup = await c.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM [生产制单] WHERE [生产单号]=@生产单号", new { 生产单号 }, tx);
            if (dup > 0) throw new ArgumentException($"生产单号 [{生产单号}] 已存在");
        }
        else 生产单号 = await docNo.NextAsync(DocType, Prefix, now, c, tx);

        // 1. 单头（含新字段；工序数/工序单价/物料金额 先置 0，逐货号展开后汇总回写）
        await c.ExecuteAsync(@"
INSERT INTO [生产制单]([生产单号],[款号],[款式],[合同号],[客户款号],[客户编号],[客户名称],
    [加工厂编号],[加工厂名称],[日期],[交货日期],[制单人],[跟单员],[操作员],
    [计划数量],[接单数量],[工序数],[工序单价],[物料金额],[出货单价],
    [订单类型],[标识],[装箱方式],[订单总箱数],[默认单价],
    [审核],[完成],[工序审核],[BOM审核],[下单日期],[备注])
VALUES(@生产单号,@款号,@款式,@合同号,@客户款号,@客户编号,@客户名称,
    @加工厂编号,@加工厂名称,@日期,@交货日期,@制单人,@跟单员,@制单人,
    @计划数量,@接单数量,0,0,0,NULL,
    @订单类型,@标识,@装箱方式,@订单总箱数,@默认单价,
    '0',N'否','0','0',@下单日期,@备注)",
            new
            {
                生产单号, 款号 = 代表款号, 款式 = 代表款式, dto.合同号, dto.客户款号, dto.客户编号, dto.客户名称,
                dto.加工厂编号, dto.加工厂名称, 日期 = now, dto.交货日期, 制单人 = user, dto.跟单员,
                计划数量, 接单数量, dto.订单类型, dto.标识, dto.装箱方式, dto.订单总箱数, dto.默认单价, 下单日期, dto.备注
            }, tx);

        decimal 工序数合计 = 0, 工序单价合计 = 0, 物料金额合计 = 0;
        var 序号 = 0;

        foreach (var line in dto.货号明细)
        {
            序号++;
            var 货号 = line.货号;
            var BOM款号 = line.BOM款号;
            var 款号名称 = line.款号名称;
            var 行数量 = line.数量明细.Sum(q => q.数量);

            // 2. 货号明细行
            await c.ExecuteAsync(@"
INSERT INTO [生产制单货号]([生产单号],[序号],[货号],[BOM款号],[款号名称],[数量],[比例],[分析])
VALUES(@生产单号,@序号,@货号,@BOM款号,@款号名称,@数量,@比例,@分析)",
                new { 生产单号, 序号, 货号, BOM款号, 款号名称, 数量 = 行数量, line.比例, 分析 = line.分析 }, tx);

            // 3. 色×码数量（带货号；款号=该货号 BOM款号、款式=款号名称）
            foreach (var q in line.数量明细)
                await c.ExecuteAsync(@"
INSERT INTO [生产制单数量]([生产单号],[货号],[款号],[款式],[客户款号],[合同号],[日期],
    [客户编号],[客户名称],[加工厂编号],[加工厂名称],[颜色],[尺码],[数量])
VALUES(@生产单号,@货号,@款号,@款式,@客户款号,@合同号,@日期,
    @客户编号,@客户名称,@加工厂编号,@加工厂名称,@颜色,@尺码,@数量)",
                    new
                    {
                        生产单号, 货号, 款号 = BOM款号, 款式 = 款号名称, dto.客户款号, dto.合同号, 日期 = now,
                        dto.客户编号, dto.客户名称, dto.加工厂编号, dto.加工厂名称, q.颜色, q.尺码, q.数量
                    }, tx);

            // 4. === 算法3 工费展开（带货号）===
            // 把款式工序工价复制为本单工序表（复制而非引用：下单后改款式工价不影响已下单据）。
            await c.ExecuteAsync(@"
INSERT INTO [生产制单工序表]([生产单号],[货号],[款号],[款式],[客户款号],[合同号],
    [工序号],[工序名称],[单价],[工序类型],[备注],[审核])
SELECT @生产单号,@货号,[款号],[款式],@客户款号,@合同号,
    [工序号],[工序名称],[单价],[工序类型],[备注],'0'
FROM [款号明细表] WHERE [款号]=@BOM款号",
                new { 生产单号, 货号, BOM款号, dto.客户款号, dto.合同号 }, tx);

            // 工序汇总（本货号工序数 + Σ单价 计入单头聚合）
            var 工序汇总 = await c.QueryFirstAsync<(int 工序数, decimal 工序单价)>(@"
SELECT COUNT(*) AS 工序数, ISNULL(SUM([单价]),0) AS 工序单价
FROM [款号明细表] WHERE [款号]=@BOM款号", new { BOM款号 }, tx);
            工序数合计 += 工序汇总.工序数;
            工序单价合计 += 工序汇总.工序单价;

            // 5. 算法4 BOM展开（带货号；总数量 = 使用数量 × 该货号数量）
            物料金额合计 += await ExpandBomAsync(c, tx, 生产单号, 货号, BOM款号, 款号名称,
                dto.客户款号, dto.合同号, 行数量, now);
        }

        // 6. 汇总回写单头
        await c.ExecuteAsync(@"
UPDATE [生产制单] SET [工序数]=@工序数,[工序单价]=@工序单价,[物料金额]=@物料金额
WHERE [生产单号]=@生产单号",
            new { 工序数 = 工序数合计, 工序单价 = 工序单价合计, 物料金额 = 物料金额合计, 生产单号 }, tx);

        // 7. 订单回写
        await LinkOrderAsync(c, tx, 生产单号, dto.订单单号);

        // 8. BOM 按 PO 号绑定：每个 BOM款号非空的货号行 + 单头合同号非空 → 绑定到 款号物料PO绑定(幂等,同事务)
        var 合同号 = dto.合同号?.Trim();
        if (!string.IsNullOrEmpty(合同号))
        {
            foreach (var bom款号 in dto.货号明细
                         .Select(l => l.BOM款号?.Trim())
                         .Where(x => !string.IsNullOrEmpty(x))
                         .Distinct(StringComparer.OrdinalIgnoreCase))
                await c.ExecuteAsync(@"
MERGE [款号物料PO绑定] WITH (HOLDLOCK) AS t
USING (SELECT @款号 AS [款号], @PO号 AS [PO号]) s
ON t.[款号]=s.[款号] AND t.[PO号]=s.[PO号]
WHEN NOT MATCHED THEN INSERT([款号],[PO号]) VALUES(s.[款号],s.[PO号]);",
                    new { 款号 = bom款号, PO号 = 合同号 }, tx);
        }

        tx.Commit();
        return 生产单号;
    }

    // 表头修改：仅未审核可改(已审核 409,请先反审核)。只更新单头字段;货号明细/工序/BOM 已按下单快照固化,不在此改。
    public async Task<bool> UpdateHeaderAsync(string 生产单号, ProductionNoticeCreateDto dto, string user)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [生产制单] WITH (UPDLOCK, HOLDLOCK) WHERE [生产单号]=@生产单号", new { 生产单号 }, tx);
        if (审核 is null) return false;
        if (审核 == "1") throw new InvalidOperationException("已审核的生产通知单不能修改，请先反审核。");

        await c.ExecuteAsync(@"
UPDATE [生产制单] SET
    [订单类型]=@订单类型,[标识]=@标识,[装箱方式]=@装箱方式,[订单总箱数]=@订单总箱数,
    [默认单价]=@默认单价,[客户编号]=@客户编号,[客户名称]=@客户名称,[客户款号]=@客户款号,[合同号]=@合同号,
    [加工厂编号]=@加工厂编号,[加工厂名称]=@加工厂名称,[交货日期]=@交货日期,[下单日期]=@下单日期,
    [跟单员]=@跟单员,[备注]=@备注,
    [接单数量]=CASE WHEN @接单数量 IS NULL THEN [接单数量] ELSE @接单数量 END
WHERE [生产单号]=@生产单号",
            new
            {
                生产单号, dto.订单类型, dto.标识, dto.装箱方式, dto.订单总箱数, dto.默认单价,
                dto.客户编号, dto.客户名称, dto.客户款号, dto.合同号,
                dto.加工厂编号, dto.加工厂名称, dto.交货日期, dto.下单日期,
                dto.跟单员, dto.备注, dto.接单数量
            }, tx);
        tx.Commit();
        return true;
    }

    // 分页列表（单头；关键字模糊匹配 生产单号/款号/款式/客户名称/合同号）
    // 领料应领明细:按生产单 BOM 展开快照取 应领=Σ总数量(需求侧,不扣库存)。
    // 档=来料 只留 物料资料 存在的行;档=塑胶 只留 物料资料 不存在的行(塑胶/未知档案)。
    // 档=半成品/成品 时返回该生产单在 半成品仓/成品仓 的现存净额(供给侧,装配部再领料用),见下方分支。
    // 按货号=true 仅对来料/塑胶档生效:分组键加 货号(批量领料按货号挑选用),半成品/成品档忽略该参数。
    public async Task<IReadOnlyList<IssueBasisRow>> IssueBasisAsync(string 生产单号, string? 档, bool 按货号 = false)
    {
        using var c = factory.Create();
        if (档 == "半成品") return await IssueBasisSemiAsync(c, 生产单号);
        if (档 == "成品") return await IssueBasisFinishedAsync(c, 生产单号);

        var mat = 档 == "来料" ? 1 : 0;
        var plastic = 档 == "塑胶" ? 1 : 0;
        // 默认保持原聚合(按物料);按货号=true 时按 货号+物料 分组,款号 仍=货号值(明细行款号列继续有值)
        var sql = 按货号 ? @"
SELECT b.[生产单号], b.[货号] AS 款号, b.[货号], b.[物料编号], MAX(b.[物料名称]) AS 物料名称,
       MAX(b.[规格]) AS 规格, MAX(b.[颜色]) AS 颜色, MAX(b.[单位]) AS 单位,
       SUM(ISNULL(b.[总数量],0)) AS 数量
FROM [生产BOM物料清单] b
WHERE b.[生产单号]=@生产单号
  AND (@mat=0 OR EXISTS(SELECT 1 FROM [物料资料] m WHERE m.[物料编号]=b.[物料编号]))
  AND (@plastic=0 OR NOT EXISTS(SELECT 1 FROM [物料资料] m WHERE m.[物料编号]=b.[物料编号]))
GROUP BY b.[生产单号], b.[货号], b.[物料编号]
ORDER BY b.[货号], b.[物料编号];" : @"
SELECT b.[生产单号], MAX(b.[货号]) AS 款号, MAX(b.[货号]) AS 货号, b.[物料编号], MAX(b.[物料名称]) AS 物料名称,
       MAX(b.[规格]) AS 规格, MAX(b.[颜色]) AS 颜色, MAX(b.[单位]) AS 单位,
       SUM(ISNULL(b.[总数量],0)) AS 数量
FROM [生产BOM物料清单] b
WHERE b.[生产单号]=@生产单号
  AND (@mat=0 OR EXISTS(SELECT 1 FROM [物料资料] m WHERE m.[物料编号]=b.[物料编号]))
  AND (@plastic=0 OR NOT EXISTS(SELECT 1 FROM [物料资料] m WHERE m.[物料编号]=b.[物料编号]))
GROUP BY b.[生产单号], b.[物料编号]
ORDER BY b.[物料编号];";
        var rows = await c.QueryAsync<IssueBasisRow>(sql, new { 生产单号, mat, plastic });
        return rows.AsList();
    }

    // 档=半成品：该生产单在半成品仓的现存净额 = 入仓(+) − 半成品领料(−) − 退仓(−) + 退库(+) − 报废(−)
    //   − 装配部领料单(仓库=半成品仓)已出口径(−)；审核标志在单头需 JOIN，按 物料编号 聚合只回正数行。
    private static async Task<IReadOnlyList<IssueBasisRow>> IssueBasisSemiAsync(SqlConnection c, string 生产单号)
    {
        var rows = await c.QueryAsync<IssueBasisRow>(@"
SELECT @生产单号 AS [生产单号], MAX(t.[货号]) AS [款号], t.[物料编号],
       MAX(t.[物料名称]) AS [物料名称], MAX(t.[规格]) AS [规格], MAX(t.[颜色]) AS [颜色], MAX(t.[单位]) AS [单位],
       SUM(t.[数量]) AS [数量]
FROM (
    SELECT d.[货号],d.[物料编号],d.[物料名称],d.[规格],d.[颜色],d.[单位], d.[数量] AS [数量]
        FROM [半成品入仓明细单] d JOIN [半成品入仓单] h ON h.[单号]=d.[单号]
        WHERE d.[生产单号]=@生产单号 AND d.[仓库]=N'半成品仓' AND ISNULL(h.[审核],'0')='1'
    UNION ALL
    SELECT d.[货号],d.[物料编号],d.[物料名称],d.[规格],d.[颜色],d.[单位], d.[数量]*-1
        FROM [半成品领料明细单] d JOIN [半成品领料单] h ON h.[单号]=d.[单号]
        WHERE d.[生产单号]=@生产单号 AND d.[仓库]=N'半成品仓' AND ISNULL(h.[审核],'0')='1'
    UNION ALL
    SELECT d.[货号],d.[物料编号],d.[物料名称],d.[规格],d.[颜色],d.[单位], d.[数量]*-1
        FROM [半成品退仓明细单] d JOIN [半成品退仓单] h ON h.[单号]=d.[单号]
        WHERE d.[生产单号]=@生产单号 AND d.[仓库]=N'半成品仓' AND ISNULL(h.[审核],'0')='1'
    UNION ALL
    SELECT d.[货号],d.[物料编号],d.[物料名称],d.[规格],d.[颜色],d.[单位], d.[数量]
        FROM [半成品退库明细单] d JOIN [半成品退库单] h ON h.[单号]=d.[单号]
        WHERE d.[生产单号]=@生产单号 AND d.[仓库]=N'半成品仓' AND ISNULL(h.[审核],'0')='1'
    UNION ALL
    SELECT d.[货号],d.[物料编号],d.[物料名称],d.[规格],d.[颜色],d.[单位], d.[数量]*-1
        FROM [半成品报废明细单] d JOIN [半成品报废单] h ON h.[单号]=d.[单号]
        WHERE d.[生产单号]=@生产单号 AND d.[仓库]=N'半成品仓' AND ISNULL(h.[审核],'0')='1'
    UNION ALL
    SELECT d.[款号],d.[物料编号],d.[物料名称],d.[规格],d.[颜色],d.[单位],
           (CASE WHEN d.[已出数量] IS NOT NULL THEN d.[已出数量] ELSE d.[数量] END) * -1
        FROM [领料明细单] d JOIN [领料单] h ON h.[单号]=d.[单号]
        WHERE d.[生产单号]=@生产单号 AND d.[仓库]=N'半成品仓'
          AND (ISNULL(d.[已出数量],0) > 0 OR ISNULL(h.[审核],'0')='1')
) t
GROUP BY t.[物料编号]
HAVING SUM(t.[数量]) > 0
ORDER BY t.[物料编号];", new { 生产单号 });
        return rows.AsList();
    }

    // 档=成品：该生产单的成品现存净额 = 入仓(+) + 退货(+) − 出仓(−) − 退仓(−)
    //   − 装配部领料单(仓库=成品仓)已出口径(−)；成品各明细单审核在明细行本身，领料单审核在单头需 JOIN。
    // 行映射：物料编号=款号、物料名称=款式、单位固定 个(供装配部返工领出)。
    private static async Task<IReadOnlyList<IssueBasisRow>> IssueBasisFinishedAsync(SqlConnection c, string 生产单号)
    {
        var rows = await c.QueryAsync<IssueBasisRow>(@"
SELECT @生产单号 AS [生产单号], t.[款号], t.[款号] AS [物料编号],
       MAX(t.[款式]) AS [物料名称], CAST(NULL AS nvarchar(20)) AS [规格],
       MAX(t.[颜色]) AS [颜色], N'个' AS [单位], SUM(t.[数量]) AS [数量]
FROM (
    SELECT d.[款号],d.[款式],d.[颜色], d.[数量] AS [数量] FROM [成品入仓明细单] d
        WHERE d.[生产单号]=@生产单号 AND ISNULL(d.[审核],'0')='1'
    UNION ALL
    SELECT d.[款号],d.[款式],d.[颜色], d.[数量] FROM [成品退货明细单] d
        WHERE d.[生产单号]=@生产单号 AND ISNULL(d.[审核],'0')='1'
    UNION ALL
    SELECT d.[款号],d.[款式],d.[颜色], d.[数量]*-1 FROM [成品出仓明细单] d
        WHERE d.[生产单号]=@生产单号 AND ISNULL(d.[审核],'0')='1'
    UNION ALL
    SELECT d.[款号],d.[款式],d.[颜色], d.[数量]*-1 FROM [成品退仓明细单] d
        WHERE d.[生产单号]=@生产单号 AND ISNULL(d.[审核],'0')='1'
    UNION ALL
    SELECT d.[款号],N'' AS [款式],d.[颜色],
           (CASE WHEN d.[已出数量] IS NOT NULL THEN d.[已出数量] ELSE d.[数量] END) * -1
        FROM [领料明细单] d JOIN [领料单] h ON h.[单号]=d.[单号]
        WHERE d.[生产单号]=@生产单号 AND d.[仓库]=N'成品仓'
          AND (ISNULL(d.[已出数量],0) > 0 OR ISNULL(h.[审核],'0')='1')
) t
GROUP BY t.[款号]
HAVING SUM(t.[数量]) > 0
ORDER BY t.[款号];", new { 生产单号 });
        return rows.AsList();
    }

    public async Task<PagedResult<ProductionHeaderDto>> ListAsync(int page, int size, string? keyword)
    {
        if (page < 1) page = 1;
        if (size < 1) size = 20;
        if (size > 1000) size = 1000;
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";

        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [生产制单]
WHERE @kw IS NULL OR [生产单号] LIKE @kw OR [款号] LIKE @kw OR [款式] LIKE @kw
   OR [客户名称] LIKE @kw OR [合同号] LIKE @kw;
SELECT h.[ID],h.[生产单号],h.[款号],h.[款式],h.[合同号],h.[客户编号],h.[客户名称],h.[加工厂编号],h.[加工厂名称],
       h.[日期],h.[交货日期],h.[制单人],h.[跟单员],h.[计划数量],h.[接单数量],h.[工序数],h.[工序单价],h.[物料金额],h.[出货单价],
       h.[审核],h.[审核人],h.[完成],h.[反审核申请],h.[反审核申请人],h.[备注],
       ISNULL(sr.[入半成品数量],0) AS [入半成品数量], ISNULL(fr.[入成品数量],0) AS [入成品数量],
       ISNULL(pa.[审核],'0') AS [采购分析审核], pa.[审核人] AS [采购分析审核人], pa.[审核时间] AS [采购分析审核时间]
FROM [生产制单] h
LEFT JOIN [采购分析审核] pa ON pa.[生产单号]=h.[生产单号]
LEFT JOIN (
    SELECT d.[生产单号], SUM(d.[数量]) AS [入半成品数量]
    FROM [半成品入仓明细单] d JOIN [半成品入仓单] s ON s.[单号]=d.[单号]
    WHERE ISNULL(s.[审核],'0')='1' AND d.[生产单号] IS NOT NULL AND d.[生产单号]<>''
    GROUP BY d.[生产单号]
) sr ON sr.[生产单号]=h.[生产单号]
LEFT JOIN (
    SELECT d.[生产单号], SUM(d.[数量]) AS [入成品数量]
    FROM [成品入仓明细单] d JOIN [成品入仓单] f ON f.[单号]=d.[单号]
    WHERE ISNULL(f.[审核],'0')='1' AND d.[生产单号] IS NOT NULL AND d.[生产单号]<>''
    GROUP BY d.[生产单号]
) fr ON fr.[生产单号]=h.[生产单号]
WHERE @kw IS NULL OR h.[生产单号] LIKE @kw OR h.[款号] LIKE @kw OR h.[款式] LIKE @kw
   OR h.[客户名称] LIKE @kw OR h.[合同号] LIKE @kw
ORDER BY h.[ID] DESC
OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;",
            new { kw, page, size });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<ProductionHeaderDto>()).AsList();
        return new PagedResult<ProductionHeaderDto>(items, total);
    }

    // 采购分析审核(采购物料分析独立审核层):前置=生产通知单已审核;true=本次新审,false=已是已审核
    public async Task<bool> PurchaseAnalysisAuditAsync(string 生产单号, string user)
    {
        using var c = factory.Create();
        var mo审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [生产制单] WHERE [生产单号]=@生产单号", new { 生产单号 });
        if (mo审核 is null) throw new ArgumentException($"生产通知单 {生产单号} 不存在。");
        if (mo审核 != "1") throw new ArgumentException($"生产通知单 {生产单号} 未审核，审核后采购分析才能审核。");
        var 已审 = await c.ExecuteScalarAsync<string?>(
            "SELECT [审核] FROM [采购分析审核] WHERE [生产单号]=@生产单号", new { 生产单号 });
        if (已审 == "1") return false;
        await c.ExecuteAsync(@"
DELETE FROM [采购分析审核] WHERE [生产单号]=@生产单号;
INSERT INTO [采购分析审核]([生产单号],[审核],[审核人],[审核时间]) VALUES(@生产单号,'1',@user,SYSDATETIME());",
            new { 生产单号, user });
        return true;
    }

    // 采购分析反审核(与采购订单同规则:可审可反):仅当前已审核可反,清审核人/时间;false=未审核/无记录
    public async Task<bool> PurchaseAnalysisUnauditAsync(string 生产单号)
    {
        using var c = factory.Create();
        return await c.ExecuteAsync(
            @"UPDATE [采购分析审核] SET [审核]='0',[审核人]=NULL,[审核时间]=NULL
              WHERE [生产单号]=@生产单号 AND [审核]='1'", new { 生产单号 }) > 0;
    }

    // 生产通知单反审核(直接/经理批准申请)连带重置采购分析审核:源单变了,分析必须重审
    public async Task ResetPurchaseAnalysisAuditAsync(string 生产单号)
    {
        using var c = factory.Create();
        await c.ExecuteAsync(
            @"UPDATE [采购分析审核] SET [审核]='0',[审核人]=NULL,[审核时间]=NULL
              WHERE [生产单号]=@生产单号 AND [审核]='1'", new { 生产单号 });
    }

    // 查询页顶部合计:与 ListAsync 相同的关键字过滤,不分页汇总全部匹配行
    public async Task<ProductionSummaryDto> SummaryAsync(string? keyword)
    {
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        return await c.QuerySingleAsync<ProductionSummaryDto>(@"
SELECT ISNULL(SUM(h.[计划数量]),0) AS [计划数量合计],
       ISNULL(SUM(ISNULL(sr.[入半成品数量],0)),0) AS [入半成品数量合计],
       ISNULL(SUM(ISNULL(fr.[入成品数量],0)),0) AS [入成品数量合计]
FROM [生产制单] h
LEFT JOIN (
    SELECT d.[生产单号], SUM(d.[数量]) AS [入半成品数量]
    FROM [半成品入仓明细单] d JOIN [半成品入仓单] s ON s.[单号]=d.[单号]
    WHERE ISNULL(s.[审核],'0')='1' AND d.[生产单号] IS NOT NULL AND d.[生产单号]<>''
    GROUP BY d.[生产单号]
) sr ON sr.[生产单号]=h.[生产单号]
LEFT JOIN (
    SELECT d.[生产单号], SUM(d.[数量]) AS [入成品数量]
    FROM [成品入仓明细单] d JOIN [成品入仓单] f ON f.[单号]=d.[单号]
    WHERE ISNULL(f.[审核],'0')='1' AND d.[生产单号] IS NOT NULL AND d.[生产单号]<>''
    GROUP BY d.[生产单号]
) fr ON fr.[生产单号]=h.[生产单号]
WHERE @kw IS NULL OR h.[生产单号] LIKE @kw OR h.[款号] LIKE @kw OR h.[款式] LIKE @kw
   OR h.[客户名称] LIKE @kw OR h.[合同号] LIKE @kw;", new { kw });
    }

    // 详情：单头 + 数量 + 工序 + BOM
    public async Task<ProductionDetailDto?> GetAsync(string 生产单号)
    {
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT h.[ID],h.[生产单号],h.[款号],h.[款式],h.[合同号],h.[客户编号],h.[客户名称],h.[客户款号],h.[加工厂编号],h.[加工厂名称],
       h.[日期],h.[交货日期],h.[下单日期],h.[制单人],h.[跟单员],h.[计划数量],h.[接单数量],h.[工序数],h.[工序单价],h.[物料金额],h.[出货单价],
       h.[订单类型],h.[标识],h.[装箱方式],h.[订单总箱数],h.[默认单价],h.[审核],h.[审核人],h.[完成],
       h.[反审核申请],h.[反审核申请人],h.[反审核申请原因],h.[备注],
       ISNULL(pa.[审核],'0') AS [采购分析审核], pa.[审核人] AS [采购分析审核人], pa.[审核时间] AS [采购分析审核时间]
FROM [生产制单] h
LEFT JOIN [采购分析审核] pa ON pa.[生产单号]=h.[生产单号]
WHERE h.[生产单号]=@生产单号;
SELECT [ID],[序号],[货号],[BOM款号],[款号名称],[数量],[比例],[分析]
FROM [生产制单货号] WHERE [生产单号]=@生产单号 ORDER BY [序号];
SELECT [ID],[货号],[颜色],[尺码],[数量] FROM [生产制单数量] WHERE [生产单号]=@生产单号 ORDER BY [ID];
SELECT [ID],[货号],[工序号],[工序名称],[单价],[工序类型] FROM [生产制单工序表] WHERE [生产单号]=@生产单号 ORDER BY [货号],[工序号];
SELECT [ID],[货号],[物料编号],[物料名称],[规格],[颜色],[单位],[总数量],[库存数量],[可用库存],[需订数量],
       [预算单价],[金额],[供应商编号],[供应商名称]
FROM [生产BOM物料清单] WHERE [生产单号]=@生产单号 ORDER BY [ID];
SELECT g.[货号], b.[物料编号], b.[物料名称], b.[规格], b.[颜色], b.[单位],
       b.[使用数量] AS [用量], b.[使用数量] * g.[数量] AS [总数量]
FROM [生产制单货号] g
JOIN [款号物料明细表] b ON b.[款号] = g.[BOM款号]
WHERE g.[生产单号] = @生产单号
  AND (b.[物料类别] = N'半成品' OR b.[物料编号] IN (SELECT [名称] FROM [半成品设置]))
ORDER BY g.[序号], b.[ID];",
            new { 生产单号 });
        var header = await multi.ReadFirstOrDefaultAsync<ProductionHeaderDto>();
        if (header is null) return null;
        return new ProductionDetailDto
        {
            单头 = header,
            货号明细 = (await multi.ReadAsync<ProductionGoodsRowDto>()).AsList(),
            数量 = (await multi.ReadAsync<ProductionQtyRowDto>()).AsList(),
            工序 = (await multi.ReadAsync<ProductionProcessDto>()).AsList(),
            物料 = (await multi.ReadAsync<ProductionBomDto>()).AsList(),
            半成品需求 = (await multi.ReadAsync<ProductionSemiNeedDto>()).AsList(),
        };
    }

    // 删除：仅未审核可删；下游业务单据引用时给中文 409 → 清订单回写引用 → 删子表 → 删单头
    public async Task<bool> DeleteAsync(string 生产单号)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [生产制单] WITH (UPDLOCK, HOLDLOCK) WHERE [生产单号]=@生产单号", new { 生产单号 }, tx);
        if (审核 is null) return false;
        if (审核 == "1") throw new InvalidOperationException("已审核的生产制单不能删除，请先反审核。");

        // 下游业务单据引用拦截(FK 547 兜底转 409 中文提示,不再裸 500):列出谁在引用,提示先处理下游
        var refs = new List<string>();
        foreach (var (table, label) in new (string, string)[]
        {
            ("采购订单", "采购订单"), ("采购明细单", "采购明细"),
            ("装箱单", "装箱单"), ("装箱单款号", "装箱单款号"), ("装箱单明细表", "装箱单明细"), ("装箱单尺码表", "装箱单尺码"),
            ("裁床工资", "裁床工资"), ("工票裁片", "工票裁片"),
        })
        {
            var n = await c.ExecuteScalarAsync<int>(
                $"SELECT COUNT(*) FROM [{table}] WHERE [生产单号]=@生产单号", new { 生产单号 }, tx);
            if (n > 0) refs.Add($"{label} {n} 行");
        }
        if (refs.Count > 0)
            throw new InvalidOperationException($"该生产单已被引用，不可删除：{string.Join("、", refs)}。请先删除/清理这些下游单据。");

        // 清除订单上的关联引用（FK 不允许删被引用的单头）
        await c.ExecuteAsync("UPDATE [成品客户订单总表] SET [生产单号]=NULL WHERE [生产单号]=@生产单号", new { 生产单号 }, tx);
        await c.ExecuteAsync("UPDATE [成品客户订单明细表] SET [生产单号]=NULL WHERE [生产单号]=@生产单号", new { 生产单号 }, tx);
        // 删子表（FK→单头）
        await c.ExecuteAsync("DELETE FROM [采购分析审核] WHERE [生产单号]=@生产单号", new { 生产单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [生产BOM物料清单] WHERE [生产单号]=@生产单号", new { 生产单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [生产制单工序表] WHERE [生产单号]=@生产单号", new { 生产单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [生产制单数量] WHERE [生产单号]=@生产单号", new { 生产单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [生产制单货号] WHERE [生产单号]=@生产单号", new { 生产单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [生产制单物料清单] WHERE [生产单号]=@生产单号", new { 生产单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [生产制单尺寸] WHERE [生产单号]=@生产单号", new { 生产单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [生产制单尺码表] WHERE [生产单号]=@生产单号", new { 生产单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [生产制单图片] WHERE [生产单号]=@生产单号", new { 生产单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [部门工序表] WHERE [生产单号]=@生产单号", new { 生产单号 }, tx);
        // 删单头
        await c.ExecuteAsync("DELETE FROM [生产制单] WHERE [生产单号]=@生产单号", new { 生产单号 }, tx);
        tx.Commit();
        return true;
    }

    // === 算法4 BOM 物料需求展开/缺料 ===
    // 需求(总数量) = 使用数量 × 计划数量，进一法取整(数量一律整数,只多不少:多几个无所谓,少订不行)。
    // 半成品口径(来料去重:同一物料只在半成品组成里算一次,不与明细重复下单;与装配领料 GetAssemblyIssueAsync 同口径):
    //   新模型(半成品设置)——BOM 行命中 半成品设置(编号或名称=定义.名称) 的,按组成(半成品设置明细)递归展开计入需求:
    //     组成行命中另一半成品定义的继续向下展开(用量逐层相乘、环保护、层级上限=SemiBomExpander.MaxDepth);
    //     数量=货号数量 × BOM行使用数量(缺省回落定义.用量) × 各层组成使用数量(缺省=1),同物料(编号+规格+颜色)合并;
    //     本 BOM 直接列出的物料若已被这些组成覆盖,则剔除(防「明细+半成品组成」双源重复下单);
    //     类别=半成品 但找不到定义的,剔除并记警告(防按普通物料错买)。
    //   旧模型(半成品共用物料设置,对照老 ERP)——编号 ∈ 产品货号 的行不产出物料行,用其自身 BOM
    //     (款号物料明细表)递归替换展开,用量逐层相乘(环保护+层级上限见 SemiBomExpander)。
    // 库存数量 = 采购入仓(+) + 退料(+) − 领料(−)，只认已审核单（P3 物料侧落地前自然为 0）
    // 需订数量(缺料) = max(0, 总数量 − 库存数量)
    // 预算单价 = 物料资料.单价；金额 = 总数量 × 预算单价；单头.物料金额 = Σ(金额)
    private async Task<decimal> ExpandBomAsync(SqlConnection c, SqlTransaction tx,
        string 生产单号, string 货号, string BOM款号, string? 款号名称,
        string? 客户款号, string? 合同号, decimal 货号数量, DateTime now)
    {
        // 供应商 LEFT JOIN 供应商资料 校验：FK 要求 生产BOM物料清单.供应商编号 必须存在于供应商资料
        var semiSet = new HashSet<string>(
            await c.QueryAsync<string>("SELECT [产品货号] FROM [半成品共用物料设置]", transaction: tx),
            StringComparer.OrdinalIgnoreCase);

        // 新模型半成品定义(定义查询键=款号物料总表.MA货号,缺省 BOM款号 本身;组成 NULL 使用数量按 1 计)
        var defsKey = (await c.QueryFirstOrDefaultAsync<string?>(
            "SELECT TOP (1) [MA货号] FROM [款号物料总表] WHERE [款号]=@BOM款号 ORDER BY [ID] DESC;",
            new { BOM款号 }, tx))?.Trim();
        if (string.IsNullOrEmpty(defsKey)) defsKey = BOM款号;
        var heads = (await c.QueryAsync<SemiDefHeadRow>(@"
SELECT [ID],[名称],[类型],ISNULL([用量],1) AS [用量] FROM [半成品设置] WHERE [货号]=@defsKey;",
            new { defsKey }, tx)).AsList();
        var headIds = heads.Select(h => h.ID).ToArray();
        var compRows = headIds.Length == 0 ? new List<SemiCompJoinRow>() : (await c.QueryAsync<SemiCompJoinRow>(@"
SELECT d.[头ID],d.[物料编号],d.[物料名称],d.[规格],d.[颜色],d.[单位],ISNULL(d.[使用数量],1) AS [使用数量],
       COALESCE(m.[单价], pm.[单价]) AS 预算单价, s.[供应商编号], s.[供应商名称]
FROM [半成品设置明细] d
LEFT JOIN [物料资料] m ON m.[物料编号] = d.[物料编号]
LEFT JOIN [塑胶物料资料] pm ON pm.[物料编号] = d.[物料编号] AND m.[物料编号] IS NULL
LEFT JOIN [供应商资料] s ON s.[供应商编号] = COALESCE(m.[供应商编号], pm.[供应商编号])
WHERE d.[头ID] IN @ids ORDER BY d.[ID];",
            new { ids = headIds }, tx)).AsList();
        var compsByHead = compRows.GroupBy(r => r.头ID).ToDictionary(g => g.Key, g => g.ToList());
        var defs = heads.Where(h => h.类型 == "半成品")
            .Select(h => new SemiDef(h.名称, h.用量, compsByHead.TryGetValue(h.ID, out var ls) ? ls : []))
            .ToList();

        // 逐款号缓存 BOM 行：多层级展开时同一半成品只查一次。
        // 同步查询：展开器为纯同步递归，且此处与外层写操作顺序使用同一连接/事务，无并发冲突。
        var bomCache = new Dictionary<string, List<BomSourceRow>>(StringComparer.OrdinalIgnoreCase);
        List<BomSourceRow> LinesOf(string 款号)
        {
            if (bomCache.TryGetValue(款号, out var cached)) return cached;
            var rows = c.Query<BomSourceRow>(@"
SELECT b.[物料编号], b.[物料名称], b.[物料类别], b.[规格], b.[颜色], b.[单位], b.[使用数量],
       COALESCE(m.[单价], pm.[单价]) AS 预算单价, s.[供应商编号], s.[供应商名称]
FROM [款号物料明细表] b
LEFT JOIN [物料资料] m ON m.[物料编号] = b.[物料编号]
LEFT JOIN [塑胶物料资料] pm ON pm.[物料编号] = b.[物料编号] AND m.[物料编号] IS NULL
LEFT JOIN [供应商资料] s ON s.[供应商编号] = COALESCE(m.[供应商编号], pm.[供应商编号])
WHERE b.[款号]=@款号", new { 款号 }, tx).AsList();
            bomCache[款号] = rows;
            return rows;
        }

        // 半成品定义匹配:BOM 行 编号 或 名称 命中定义.名称
        SemiDef? FindDef(BomSourceRow r)
        {
            var no = r.物料编号?.Trim() ?? "";
            var name = r.物料名称?.Trim() ?? "";
            return defs.FirstOrDefault(d =>
                (no.Length > 0 && string.Equals(d.名称, no, StringComparison.OrdinalIgnoreCase)) ||
                (name.Length > 0 && string.Equals(d.名称, name, StringComparison.OrdinalIgnoreCase)));
        }

        // 根 BOM 行分类:旧模型行(留给 SemiBomExpander)/新模型行(按组成展开)/直接物料(被组成覆盖的剔除)
        var 剔除警告 = new List<string>();
        var matched = new List<(BomSourceRow 行, SemiDef def)>();
        foreach (var r in LinesOf(BOM款号))
        {
            var code = r.物料编号?.Trim();
            if (string.IsNullOrEmpty(code) || semiSet.Contains(code)) continue;
            var def = FindDef(r);
            if (def is not null) { matched.Add((r, def)); continue; }
            if (string.Equals(r.物料类别?.Trim(), "半成品", StringComparison.Ordinal))
                剔除警告.Add($"半成品 [{code}] 未在半成品设置中找到组成，已剔除（按规则半成品不能直接下单）。");
        }
        // 半成品组成递归展开:组成行命中另一半成品定义(编号或名称=定义.名称)的继续向下展开,
        // 用量逐层相乘;环/超层级就地停止并记警告(口径同 SemiBomExpander)。
        // 半成品设置.用量 只在 BOM 行层兜底(行未填使用数量时);嵌套层倍率=组成行使用数量,不再乘定义.用量。
        var 递归警告 = new List<string>();
        var 叶子缓存 = new Dictionary<string, List<(SemiCompJoinRow 行, decimal 倍率)>>(StringComparer.OrdinalIgnoreCase);
        List<(SemiCompJoinRow 行, decimal 倍率)> LeavesOf(SemiDef def)
        {
            if (叶子缓存.TryGetValue(def.名称, out var cachedLeaves)) return cachedLeaves;
            var leaves = new List<(SemiCompJoinRow, decimal)>();
            叶子缓存[def.名称] = leaves;
            var path = new List<string> { def.名称 };
            Walk(def, 1m);
            return leaves;

            void Walk(SemiDef d, decimal 倍率)
            {
                foreach (var l in d.明细)
                {
                    var code = l.物料编号?.Trim();
                    if (string.IsNullOrEmpty(code)) continue;
                    var name = l.物料名称?.Trim() ?? "";
                    var nested = defs.FirstOrDefault(x =>
                        string.Equals(x.名称, code, StringComparison.OrdinalIgnoreCase) ||
                        (name.Length > 0 && string.Equals(x.名称, name, StringComparison.OrdinalIgnoreCase)));
                    if (nested is null) { leaves.Add((l, 倍率 * l.使用数量)); continue; }
                    if (path.Contains(nested.名称, StringComparer.OrdinalIgnoreCase))
                    {
                        递归警告.Add($"检测到半成品循环引用：{string.Join("→", path)}→{nested.名称}，已停止向下展开。");
                        continue;
                    }
                    if (path.Count >= SemiBomExpander.MaxDepth)
                    {
                        递归警告.Add($"半成品 [{nested.名称}] 超过最大层级 {SemiBomExpander.MaxDepth}（路径：{string.Join("→", path)}），已停止向下展开。");
                        continue;
                    }
                    path.Add(nested.名称);
                    Walk(nested, 倍率 * l.使用数量);
                    path.RemoveAt(path.Count - 1);
                }
            }
        }

        // 被组成覆盖的直接物料(明细与半成品组成双源,只在组成里算一次;覆盖集=递归叶级物料)
        var coveredSet = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var (_, def) in matched)
            foreach (var (l, _) in LeavesOf(def))
            {
                var code = l.物料编号?.Trim();
                if (!string.IsNullOrEmpty(code)) coveredSet.Add(code);
            }
        // 半成品组成展开(同物料 编号+规格+颜色 合并)
        var semiAgg = new Dictionary<string, ExpandedSemiMaterial<BomSourceRow>>(StringComparer.Ordinal);
        foreach (var (row, def) in matched)
        {
            var 半成品用量 = row.使用数量 ?? def.用量;
            foreach (var (l, 倍率) in LeavesOf(def))
            {
                var code = l.物料编号?.Trim();
                if (string.IsNullOrEmpty(code)) continue;
                var key = $"{code}|{l.规格?.Trim() ?? ""}|{l.颜色?.Trim() ?? ""}";
                var 累计 = 半成品用量 * 倍率;
                if (semiAgg.TryGetValue(key, out var hit))
                {
                    semiAgg[key] = hit with { 累计用量 = hit.累计用量 + 累计 };
                }
                else
                {
                    semiAgg[key] = new ExpandedSemiMaterial<BomSourceRow>(
                        new BomSourceRow
                        {
                            物料编号 = code, 物料名称 = l.物料名称, 规格 = l.规格, 颜色 = l.颜色, 单位 = l.单位,
                            使用数量 = l.使用数量, 预算单价 = l.预算单价,
                            供应商编号 = l.供应商编号, 供应商名称 = l.供应商名称,
                        },
                        累计, BOM款号);
                }
            }
        }

        // 展开器行源:新模型半成品行一律不进入(已按组成展开/无定义剔除);根层再剔除被组成覆盖的直接物料
        IReadOnlyList<BomSourceRow> Lines(string 款号)
        {
            var isRoot = string.Equals(款号, BOM款号, StringComparison.OrdinalIgnoreCase);
            return LinesOf(款号).Where(r =>
            {
                var code = r.物料编号?.Trim();
                if (string.IsNullOrEmpty(code)) return true;
                if (FindDef(r) is not null) return false;
                if (string.Equals(r.物料类别?.Trim(), "半成品", StringComparison.Ordinal)) return false;
                if (isRoot && coveredSet.Contains(code)) return false;
                return true;
            }).ToList();
        }

        var expansion = SemiBomExpander.Expand(
            BOM款号, Lines, b => b.物料编号, b => b.使用数量, semiSet.Contains);
        var all = expansion.物料.Concat(semiAgg.Values).ToList();
        foreach (var w in expansion.警告.Concat(剔除警告).Concat(递归警告).Distinct())
            log?.LogWarning("生产制单 {生产单号} BOM 展开：{警告}", 生产单号, w);

        decimal 物料金额合计 = 0;
        foreach (var e in all)
        {
            var b = e.行;
            // 数量整数化(进一法):需求/需订只多不少——多几个无所谓,少订不行;
            // 库存数量保持台账原值(展示用),需订=max(0,整数需求−库存) 再进一
            var 总数量 = Math.Ceiling(e.累计用量 * 货号数量);
            // 可用库存暂=当前库存(预留/在途扣减逻辑 P3 落地)；
            // N+1 查询此处可接受：制单是一次性写操作,款式物料通常<50行;批量场景再改 IN 批查。
            var 库存数量 = await inventory.StockOfAsync(b.物料编号 ?? "", (c, tx));
            var 需订数量 = Math.Ceiling(Math.Max(0m, 总数量 - 库存数量));
            var 金额 = 总数量 * (b.预算单价 ?? 0);
            物料金额合计 += 金额;

            await c.ExecuteAsync(@"
INSERT INTO [生产BOM物料清单]([日期],[制单日期],[生产单号],[货号],[款号],[款式],[客户款号],[合同号],
    [物料编号],[物料名称],[规格],[颜色],[单位],
    [总数量],[库存数量],[可用库存],[需订数量],[订货数量],[预算单价],[金额],
    [供应商编号],[供应商名称],[审核])
VALUES(@日期,@日期,@生产单号,@货号,@款号,@款式,@客户款号,@合同号,
    @物料编号,@物料名称,@规格,@颜色,@单位,
    @总数量,@库存数量,@库存数量,@需订数量,0,@预算单价,@金额,
    @供应商编号,@供应商名称,'0')",
                new
                {
                    日期 = now, 生产单号, 货号, 款号 = BOM款号, 款式 = 款号名称, 客户款号, 合同号,
                    b.物料编号, b.物料名称, b.规格, b.颜色, b.单位,
                    总数量, 库存数量, 需订数量, b.预算单价, 金额, b.供应商编号, b.供应商名称
                }, tx);
        }

        return 物料金额合计;
    }

    private sealed record SemiDefHeadRow(long ID, string 名称, string 类型, decimal 用量);
    private sealed record SemiCompJoinRow(
        long 头ID, string? 物料编号, string? 物料名称, string? 规格, string? 颜色, string? 单位,
        decimal 使用数量, decimal? 预算单价, string? 供应商编号, string? 供应商名称);
    private sealed record SemiDef(string 名称, decimal 用量, List<SemiCompJoinRow> 明细);

    // === 反审核申请-审批流 ===
    // 已审核单发现有错 → 操作员申请反审核(必填原因) → 消息通知全部经理 → 经理在消息中心
    // 同意=一步到位回到未审核(第一步,可改可再审)，并带出该单绑定BOM(生产制单货号.BOM款号)一并反审核；
    // 拒绝=退回申请。申请期间单据锁定不可改。

    // 经理账号：人事档案 职称='经理' 的 join 账号（口径同 PurchaseApprovalChainService/补料单）
    private async Task<IReadOnlyList<string>> ManagerAccountsAsync()
    {
        using var c = factory.Create();
        return (await c.QueryAsync<string>(@"
SELECT DISTINCT u.[用户] FROM [人事档案] p
JOIN [sysfileuser] u ON u.[用户] = p.[姓名] OR u.[用户] LIKE p.[姓名] + N'(%'
WHERE p.[职称] = N'经理'")).AsList();
    }

    // 是否经理（admin 可代办，口径同采购三级流转）
    public async Task<bool> IsManagerAsync(string user)
    {
        if (user.Equals("admin", StringComparison.OrdinalIgnoreCase)) return true;
        using var c = factory.Create();
        var n = await c.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM [人事档案] WHERE [姓名]=@user AND [职称]=N'经理'", new { user });
        return n > 0;
    }

    private Task NotifyAsync(IEnumerable<string> 接收人, string? 单号, string 类型, string 标题, string? 内容) =>
        messages is null ? Task.CompletedTask : messages.SendAsync(接收人, 类型, 单号, 标题, 内容);

    // 该生产单绑定的工程BOM款号（生产制单货号.BOM款号 去重；反审核批准时一并带出反审核）
    private static async Task<IReadOnlyList<string>> BoundBom款号Async(
        SqlConnection c, SqlTransaction? tx, string 生产单号) =>
        (await c.QueryAsync<string>(@"
SELECT DISTINCT [BOM款号] FROM [生产制单货号]
WHERE [生产单号]=@生产单号 AND NULLIF(LTRIM(RTRIM(ISNULL([BOM款号],N''))),N'') IS NOT NULL",
            new { 生产单号 }, tx)).AsList();

    // 申请反审核：仅已审核且无待批申请可提；方式=单个(仅生产单)/整步(含BOM,批准时带出绑定BOM)。
    // 成功后通知全部经理(+admin)，消息列出方式与绑定 BOM
    public async Task RequestUnapproveAsync(string 生产单号, string? 原因, bool 含BOM, string user)
    {
        原因 = 原因?.Trim();
        if (string.IsNullOrEmpty(原因)) throw new ArgumentException("请填写反审核原因。");
        using var c = factory.Create();
        var n = await c.ExecuteAsync(@"
UPDATE [生产制单] SET [反审核申请]='1',[反审核申请人]=@user,[反审核申请原因]=@原因,[反审核申请时间]=SYSDATETIME(),
       [反审核申请含BOM]=@含BOM
WHERE [生产单号]=@生产单号 AND ISNULL([审核],'0')='1' AND ISNULL([反审核申请],'0')<>'1'",
            new { 生产单号, user, 原因, 含BOM = 含BOM ? "1" : "0" });
        if (n == 0)
        {
            var 存在 = await c.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM [生产制单] WHERE [生产单号]=@生产单号", new { 生产单号 });
            if (存在 == 0) throw new KeyNotFoundException($"生产单 {生产单号} 不存在。");
            throw new InvalidOperationException("申请失败：仅已审核且无待批申请的生产单才能申请反审核。");
        }
        string bom说明;
        if (!含BOM) bom说明 = "方式：单个（仅反审核生产单，不动绑定BOM）。";
        else
        {
            var boms = await BoundBom款号Async(c, null, 生产单号);
            bom说明 = boms.Count > 0
                ? $"方式：整步（生产单+绑定BOM），绑定BOM：{string.Join("、", boms)}（批准后将一并反审核）。"
                : "方式：整步（生产单+绑定BOM），但该单无绑定BOM。";
        }
        var 接收人 = (await ManagerAccountsAsync()).Append("admin").Distinct().ToList();
        await NotifyAsync(接收人, 生产单号, "反审核审批", "生产单反审核申请",
            $"[{user}] 申请反审核生产单 {生产单号}。原因：{原因}。{bom说明}请经理在此消息中处理（同意/拒绝）。");
    }

    // 经理同意：一步到位反审核回未审核(第一步)；申请时选「整步(含BOM)」的带出绑定BOM一并反审核
    // (款号物料总表.审核→0)，「单个」的只反审核生产单。清申请标记；通知申请人
    public async Task<string> ApproveUnapproveRequestAsync(string 生产单号, string user)
    {
        if (!await IsManagerAsync(user))
            throw new InvalidOperationException($"[{user}] 不是经理，不能批准反审核。");
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var req = await c.QueryFirstOrDefaultAsync<UnapproveReqRow>(@"
UPDATE [生产制单] SET [审核]='0',[审核人]=NULL,[审核日期]=NULL,
       [反审核申请]='0',[反审核申请人]=NULL,[反审核申请原因]=NULL,[反审核申请时间]=NULL,[反审核申请含BOM]=NULL
OUTPUT DELETED.[反审核申请人] AS [申请人], DELETED.[反审核申请含BOM] AS [含BOM]
WHERE [生产单号]=@生产单号 AND ISNULL([审核],'0')='1' AND ISNULL([反审核申请],'0')='1'",
            new { 生产单号 }, tx);
        if (req?.申请人 is null)
        {
            tx.Rollback();
            var 存在 = await c.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM [生产制单] WHERE [生产单号]=@生产单号", new { 生产单号 });
            if (存在 == 0) throw new KeyNotFoundException($"生产单 {生产单号} 不存在。");
            throw new InvalidOperationException("批准失败：该申请已处理或单据已不是已审核状态。");
        }
        var 申请人 = req.申请人;
        // 整步(含BOM)：已审核的款号物料台头一并反审核(含清掉其待批申请标记)
        var 带出BOM = new List<string>();
        if (req.含BOM == "1")
        {
            foreach (var bom in await BoundBom款号Async(c, tx, 生产单号))
            {
                var m = await c.ExecuteAsync(@"
UPDATE [款号物料总表] SET [审核]='0',
       [反审核申请]='0',[反审核申请人]=NULL,[反审核申请原因]=NULL,[反审核申请时间]=NULL
WHERE [款号]=@bom AND ISNULL([审核],'0')='1'", new { bom }, tx);
                if (m > 0) 带出BOM.Add(bom);
            }
        }
        tx.Commit();
        if (!string.IsNullOrWhiteSpace(申请人))
        {
            var bom说明 = 带出BOM.Count > 0 ? $"绑定BOM {string.Join("、", 带出BOM)} 已一并反审核。" : "";
            await NotifyAsync([申请人], 生产单号, "反审核结果", "反审核已批准",
                $"你申请的生产单 {生产单号} 反审核已由 [{user}] 批准，单据已回到未审核状态，可修改后重新保存审核。{bom说明}");
        }
        return 申请人 ?? "";
    }

    private sealed class UnapproveReqRow
    {
        public string? 申请人 { get; set; }
        public string? 含BOM { get; set; }
    }

    // 经理拒绝：仅清申请标记(单据保持已审核)；通知申请人
    public async Task<string> RejectUnapproveRequestAsync(string 生产单号, string user)
    {
        if (!await IsManagerAsync(user))
            throw new InvalidOperationException($"[{user}] 不是经理，不能拒绝反审核申请。");
        using var c = factory.Create();
        var 申请人 = await c.ExecuteScalarAsync<string?>(@"
UPDATE [生产制单] SET [反审核申请]='0',[反审核申请人]=NULL,[反审核申请原因]=NULL,[反审核申请时间]=NULL,[反审核申请含BOM]=NULL
OUTPUT DELETED.[反审核申请人]
WHERE [生产单号]=@生产单号 AND ISNULL([反审核申请],'0')='1'", new { 生产单号 });
        if (申请人 is null)
        {
            var 存在 = await c.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM [生产制单] WHERE [生产单号]=@生产单号", new { 生产单号 });
            if (存在 == 0) throw new KeyNotFoundException($"生产单 {生产单号} 不存在。");
            throw new InvalidOperationException("拒绝失败：该申请已处理。");
        }
        if (!string.IsNullOrWhiteSpace(申请人))
            await NotifyAsync([申请人], 生产单号, "反审核结果", "反审核已拒绝",
                $"你申请的生产单 {生产单号} 反审核被 [{user}] 拒绝，单据保持已审核状态。");
        return 申请人 ?? "";
    }

    // 从订单生成：把 生产单号 回写到订单总表/明细表（FK: 订单表.生产单号 → 生产制单.生产单号，单头已插所以安全）
    private static async Task LinkOrderAsync(
        SqlConnection c, SqlTransaction tx, string 生产单号, string? 订单单号)
    {
        if (string.IsNullOrWhiteSpace(订单单号)) return;
        var n = await c.ExecuteAsync(
            "UPDATE [成品客户订单总表] SET [生产单号]=@生产单号 WHERE [单号]=@订单单号",
            new { 生产单号, 订单单号 }, tx);
        if (n == 0) throw new ArgumentException($"订单 [{订单单号}] 不存在，无法关联生产制单。");
        await c.ExecuteAsync(
            "UPDATE [成品客户订单明细表] SET [生产单号]=@生产单号 WHERE [单号]=@订单单号",
            new { 生产单号, 订单单号 }, tx);
    }
}
