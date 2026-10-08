using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Engines.Inventory;
using ErpApi.Features.MasterData;
using ErpApi.Infrastructure.Db;
using ErpApi.Integrations.Paiji;
using ErpApi.Integrations.SprayPlan;
using Microsoft.Data.SqlClient;
namespace ErpApi.Features.Plastics.PlasticPurchaseOrder;

// 塑胶采购订单。头 + 明细。审核 = 纯锁定(走通用过账引擎只翻 审核='1',不动库存)。
// 明细按生产单号从塑胶共用物料表 BOM 调入(同 PlasticMaterialDocService.BasisAsync 口径)。
public sealed class PlasticPurchaseOrderService(ISqlConnectionFactory factory, IDocumentNumberGenerator docNo,
    PaijiPushService paiji, SprayPlanPushService spray, PlasticInventoryService inventory)
{
    public const string DocType = "塑胶采购订单";
    public const string Prefix = "SP";   // 塑胶采购订单号 = SP + yyyyMMdd + 3位流水

    // 从塑胶共用物料表 BOM 按生产单号带出基准行；顺带返回 计划数量(默认订购数量=计划数量×用量)、
    // 生产制单.合同号(客户合同号即PO号,前端自动填入表头 编号) 与 已订数量(塑胶采购订单明细 按 物料+颜色 累计,防重复下单)。
    // 用量口径:已审核 BOM(款号物料明细表.使用数量,按 生产制单货号.货号 取) 优先,BOM 无该行/未审核时回落 塑胶共用物料表.用量——
    // BOM 设置页改用量后下单带料自动跟随,不用手工同步两份表。
    // 套数 BOM 未填时回落 塑胶物料资料.套数。
    // 可用库存=实时塑胶仓库存(库存引擎聚合)：库存够需求(计划数量×用量)时前端默认不勾选下单。
    // 原料关联:塑胶物料资料.用料名称 → 塑胶原料资料.物料名称;单件克重=原胶件单净重(空则整啤净重/出模数),
    // 原料库存=实时原料仓库存——啤机下单自动扣原料(原料用量KG=数量×单件克重/1000)的数据源。
    public async Task<IReadOnlyList<PlasticPurchaseOrderBasisRow>> BasisAsync(string 生产单号)
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
        var rows = await c.QueryAsync<PlasticPurchaseOrderBasisRow>(@"
SELECT g.[生产单号], pm.[款号], p.[物料编号], p.[物料名称], p.[工模编号] AS 模具编号,
       COALESCE(bb.[使用数量], p.[用量]) AS 用量, COALESCE(p.[套数], mm.[套数]) AS 套数, p.[颜色],
       -- 色粉号 BOM 未填时回落 塑胶物料资料(资料由表格导入,值带 .0 后缀,剥掉)
       COALESCE(NULLIF(p.[色粉号], N''),
                CASE WHEN mm.[色粉号] LIKE N'%.0' THEN LEFT(mm.[色粉号], LEN(mm.[色粉号])-2) ELSE mm.[色粉号] END) AS 色粉号,
       p.[用料名称],
       -- 加工内容 优先 塑胶物料资料，BOM 未填时回落 BOM(喷油下单按它过滤)
       COALESCE(NULLIF(mm.[加工内容], N''), NULLIF(p.[加工内容], N'')) AS 加工内容,
       pm.[计划数量], pm.[合同号],
       ISNULL(od.[已订数量],0) AS 已订数量,
       ISNULL(ob.[已订啤机],0) AS 已订啤机数量,
       ISNULL(op.[已订同工序],0) AS 已订同工序数量,
       st.[损耗率],
       rm.[物料编号] AS 原料编号, rm.[物料名称] AS 原料名称,
       COALESCE(mm.[原胶件单净重], mm.[整啤净重]/NULLIF(mm.[出模数],0)) AS 单件克重,
       mm.[出模数] AS 出模数
FROM [塑胶共用物料表] p
JOIN [生产制单货号] g ON g.[货号] = p.[塑胶货号]
LEFT JOIN [生产制单] pm ON pm.[生产单号] = g.[生产单号]
LEFT JOIN [塑胶物料资料] mm ON mm.[物料编号] = p.[物料编号]
LEFT JOIN [塑胶物料设置] st ON st.[物料编号] = p.[物料编号]
LEFT JOIN [塑胶原料资料] rm ON rm.[物料名称] = mm.[用料名称]
-- 已审核 BOM 的 使用数量 优先于共用物料表.用量(仅 BOM 台头已审核才认)
LEFT JOIN [款号物料总表] bh ON bh.[款号] = g.[货号] AND ISNULL(bh.[审核],'0') = '1'
LEFT JOIN [款号物料明细表] bb ON bb.[款号] = g.[货号] AND bb.[物料编号] = p.[物料编号] AND bh.[款号] IS NOT NULL
LEFT JOIN (
    SELECT d.[物料编号], ISNULL(d.[颜色],N'') AS 颜色键, SUM(d.[数量]) AS 已订数量
    FROM [塑胶采购订单明细] d
    JOIN [塑胶采购订单] o ON o.[单号]=d.[单号]
    WHERE d.[生产单号]=@生产单号
    GROUP BY d.[物料编号], ISNULL(d.[颜色],N'')
) od ON od.[物料编号]=p.[物料编号] AND od.[颜色键]=ISNULL(p.[颜色],N'')
-- 啤机阶段已订(单头未选加工内容的订单)
LEFT JOIN (
    SELECT d.[物料编号], ISNULL(d.[颜色],N'') AS 颜色键, SUM(d.[数量]) AS 已订啤机
    FROM [塑胶采购订单明细] d
    JOIN [塑胶采购订单] o ON o.[单号]=d.[单号]
    WHERE d.[生产单号]=@生产单号 AND NULLIF(LTRIM(RTRIM(ISNULL(o.[加工内容],N''))),N'') IS NULL
    GROUP BY d.[物料编号], ISNULL(d.[颜色],N'')
) ob ON ob.[物料编号]=p.[物料编号] AND ob.[颜色键]=ISNULL(p.[颜色],N'')
-- 同工序已订(单头加工内容=本行加工内容;本行无加工内容时同啤机段)
LEFT JOIN (
    SELECT d.[物料编号], ISNULL(d.[颜色],N'') AS 颜色键,
           NULLIF(LTRIM(RTRIM(ISNULL(o.[加工内容],N''))),N'') AS 工序键, SUM(d.[数量]) AS 已订同工序
    FROM [塑胶采购订单明细] d
    JOIN [塑胶采购订单] o ON o.[单号]=d.[单号]
    WHERE d.[生产单号]=@生产单号
    GROUP BY d.[物料编号], ISNULL(d.[颜色],N''), NULLIF(LTRIM(RTRIM(ISNULL(o.[加工内容],N''))),N'')
) op ON op.[物料编号]=p.[物料编号] AND op.[颜色键]=ISNULL(p.[颜色],N'')
  AND ((op.[工序键] IS NULL AND COALESCE(NULLIF(mm.[加工内容],N''), NULLIF(p.[加工内容],N'')) IS NULL)
       OR op.[工序键]=COALESCE(NULLIF(mm.[加工内容],N''), NULLIF(p.[加工内容],N'')))
WHERE g.[生产单号] = @生产单号
ORDER BY p.[ID]", new { 生产单号 });
        var list = rows.AsList();
        // 实时塑胶仓库存；逐物料查一次(行数通常<50,与来料仓采购订单同处理)
        var live = new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase);
        foreach (var code in list.Select(r => r.物料编号).Where(x => !string.IsNullOrEmpty(x)).Distinct())
            live[code!] = await inventory.StockOfAsync(code!, null);
        foreach (var r in list)
            if (!string.IsNullOrEmpty(r.物料编号) && live.TryGetValue(r.物料编号, out var qty)) r.可用库存 = qty;
        // 实时原料仓库存(原料扣减汇总用)
        var rawLive = new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase);
        foreach (var code in list.Select(r => r.原料编号).Where(x => !string.IsNullOrEmpty(x)).Distinct(StringComparer.OrdinalIgnoreCase))
            rawLive[code!] = await inventory.RawMaterialStockOfAsync(code!);
        foreach (var r in list)
            if (!string.IsNullOrEmpty(r.原料编号) && rawLive.TryGetValue(r.原料编号!, out var rqty)) r.原料库存 = rqty;
        return list;
    }

    // 加工内容下拉选项：塑胶物料资料 + 塑胶共用物料表 的 加工内容 去重非空值
    public async Task<IReadOnlyList<string>> ProcessingContentsAsync()
    {
        using var c = factory.Create();
        var rows = await c.QueryAsync<string>(@"
SELECT DISTINCT LTRIM(RTRIM([加工内容])) AS [加工内容] FROM [塑胶物料资料] WHERE NULLIF(LTRIM(RTRIM(ISNULL([加工内容],N''))),N'') IS NOT NULL
UNION
SELECT DISTINCT LTRIM(RTRIM([加工内容])) FROM [塑胶共用物料表] WHERE NULLIF(LTRIM(RTRIM(ISNULL([加工内容],N''))),N'') IS NOT NULL
ORDER BY [加工内容]");
        return rows.AsList();
    }

    // 喷油校验：供应商名称含「喷油」时单头 加工内容 必填，其他供应商可空
    private static void 校验加工内容(PlasticPurchaseOrderCreateDto dto)
    {
        if ((dto.供应商名称 ?? "").Contains("喷油") && string.IsNullOrWhiteSpace(dto.加工内容))
            throw new ArgumentException("喷油加工订单必须选择加工内容。");
    }

    // 啤机单判定(单头口径,与前端 display加工类型 一致):加工类型为空视为一次加工;
    // 只有未选加工内容的一次加工单才是纯啤机单——原料扣减(原料用量KG快照)只对啤机单生效,
    // 印喷/二次加工单加工的是已啤出的胶件,不再消耗原料
    private static bool 是啤机单(string? 加工类型, string? 加工内容)
        => string.IsNullOrWhiteSpace(加工内容)
           && (string.IsNullOrWhiteSpace(加工类型) || 加工类型.Trim() == "一次加工");

    // MA 关联查询:实单已关联MA单(生产制单货号.货号 → 款号物料总表.MA货号 非空)返回 "货号→MA货号",否则 null
    private static async Task<string?> MaLinkAsync(SqlConnection c, string 生产单号, SqlTransaction? tx = null)
        => await c.ExecuteScalarAsync<string?>(@"
SELECT TOP (1) g.[货号] + N'→' + LTRIM(RTRIM(h.[MA货号]))
FROM [生产制单货号] g
JOIN [款号物料总表] h ON h.[款号] = g.[货号]
WHERE g.[生产单号] = @生产单号
  AND NULLIF(LTRIM(RTRIM(ISNULL(h.[MA货号],N''))),N'') IS NOT NULL", new { 生产单号 }, tx);

    // 生产通知单下单门(create/update 共用):必须已审核;已关联MA单的实单塑胶不能再下单
    private static async Task 校验生产通知单可下单Async(SqlConnection c, IReadOnlyList<PlasticPurchaseOrderCreateLineDto> 明细)
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

    // 加工下单校验——只对「按库存选料」的加工单(库存加工=true)生效:
    // 二次加工:明细物料必须已完成一次加工(来源采购订单 加工类型='一次加工' 且选了加工内容)入仓
    // (已审核入仓明细.订单单号 指向该单,物料+颜色匹配);一次/二次:按物料汇总的订购数量不得超过实时塑胶库存。
    // 按生产单 BOM 带料的一次/二次加工单不校验——允许与上道同时下单,没有库存也能下(2026-10-08 用户要求)。
    private async Task 校验加工下单Async(PlasticPurchaseOrderCreateDto dto)
    {
        if (!dto.库存加工) return;
        var 二次 = string.Equals(dto.加工类型?.Trim(), "二次加工", StringComparison.Ordinal);
        using var c = factory.Create();
        if (二次)
        {
            foreach (var g in dto.明细
                         .Where(l => !string.IsNullOrWhiteSpace(l.物料编号))
                         .GroupBy(l => (物料编号: l.物料编号!.Trim(), 颜色: l.颜色 ?? "")))
            {
                var 已一次加工 = await c.ExecuteScalarAsync<int>(@"
SELECT COUNT(*) FROM [塑胶入仓明细单] r
JOIN [塑胶入仓单] h ON h.[单号]=r.[单号]
JOIN [塑胶采购订单] o ON o.[单号]=r.[订单单号]
WHERE ISNULL(h.[审核],'0')='1' AND ISNULL(o.[加工类型],N'一次加工')=N'一次加工'
  AND NULLIF(LTRIM(RTRIM(ISNULL(o.[加工内容],N''))),N'') IS NOT NULL
  AND r.[物料编号]=@物料编号 AND ISNULL(r.[颜色],'')=@颜色",
                    new { g.Key.物料编号, g.Key.颜色 }) > 0;
                if (!已一次加工)
                    throw new ArgumentException($"物料 {g.Key.物料编号} 未完成一次加工入仓，不能下二次加工单。");
            }
        }
        var 阶段名 = 二次 ? "二次加工" : "一次加工";
        foreach (var g in dto.明细.Where(l => !string.IsNullOrWhiteSpace(l.物料编号))
                     .GroupBy(l => l.物料编号!.Trim()))
        {
            var 库存 = await inventory.StockOfAsync(g.Key, null);
            var 订购 = g.Sum(l => l.数量);
            if (订购 > 库存)
                throw new ArgumentException($"物料 {g.Key} {阶段名}数量 {订购} 超过实时库存 {库存}。");
        }
    }

    // 可加工库存(阶段=二次加工(默认):已完成一次加工(有加工内容)入仓;阶段=一次加工:啤机单(无加工内容)入仓)
    // 已审核塑胶入仓明细.订单单号 指向相应采购订单(物料×颜色粒度),
    // 已加工工序=入仓明细加工内容快照 回落 采购订单单头加工内容;逐物料叠加实时库存,只返回 库存>0。
    public async Task<IReadOnlyList<SecondProcessStockRow>> SecondProcessStockAsync(string? keyword, string? 阶段 = null)
    {
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        // 一次加工阶段=取啤机单(加工类型='一次加工' 且未选加工内容)入仓的产出;其余=取真正一次加工(有加工内容)入仓的产出
        var 一次 = string.Equals(阶段?.Trim(), "一次加工", StringComparison.Ordinal);
        using var c = factory.Create();
        var rows = (await c.QueryAsync<SecondProcessStockRow>($@"
SELECT r.[物料编号], MAX(r.[物料名称]) AS 物料名称, ISNULL(r.[颜色],N'') AS 颜色,
       MAX(r.[单位]) AS 单位,
       MAX(COALESCE(NULLIF(r.[加工内容],N''), NULLIF(o.[加工内容],N''))) AS 已加工工序,
       MAX(COALESCE(NULLIF(mm.[加工内容],N''), NULLIF(p.[加工内容],N''))) AS 需求加工内容,
       MAX(r.[订单单号]) AS 来源采购单号, MAX(r.[生产单号]) AS 生产单号, MAX(r.[款号]) AS 款号
FROM [塑胶入仓明细单] r
JOIN [塑胶入仓单] h ON h.[单号]=r.[单号]
JOIN [塑胶采购订单] o ON o.[单号]=r.[订单单号]
LEFT JOIN [塑胶物料资料] mm ON mm.[物料编号]=r.[物料编号]
LEFT JOIN [生产制单货号] g ON g.[生产单号]=r.[生产单号]
LEFT JOIN [塑胶共用物料表] p ON p.[塑胶货号]=g.[货号] AND p.[物料编号]=r.[物料编号]
WHERE ISNULL(h.[审核],'0')='1' AND ISNULL(o.[加工类型],N'一次加工')=N'一次加工'
  AND NULLIF(LTRIM(RTRIM(ISNULL(o.[加工内容],N''))),N'') {(一次 ? "IS NULL" : "IS NOT NULL")}
  AND (@kw IS NULL OR r.[物料编号] LIKE @kw OR r.[物料名称] LIKE @kw)
GROUP BY r.[物料编号], ISNULL(r.[颜色],N'')
ORDER BY r.[物料编号]", new { kw })).AsList();
        var result = new List<SecondProcessStockRow>();
        foreach (var r in rows)
        {
            if (string.IsNullOrEmpty(r.物料编号)) continue;
            r.可用库存 = await inventory.StockOfAsync(r.物料编号, null);
            if (r.可用库存 > 0) result.Add(r);
        }
        return result;
    }

    // 原料快照解析:物料编号 → 塑胶物料资料.用料名称 → 塑胶原料资料;单件克重=原胶件单净重(空则整啤净重/出模数)。
    // 原料用量KG=数量(件)×单件克重/1000(4位);克重未知时只存编号/名称,KG 留空。
    // 只有啤机单(是啤机单)才解析/落原料快照——印喷/二次加工单不消耗原料
    private sealed class RawLink
    {
        public string 物料编号 { get; set; } = "";
        public string? 原料编号 { get; set; }
        public string? 原料名称 { get; set; }
        public decimal? 单件克重 { get; set; }
    }

    private static async Task<Dictionary<string, RawLink>> RawLinksAsync(
        SqlConnection c, SqlTransaction tx, IReadOnlyList<PlasticPurchaseOrderCreateLineDto> 明细)
    {
        var codes = 明细.Select(l => l.物料编号).Where(s => !string.IsNullOrWhiteSpace(s))
            .Select(s => s!.Trim()).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        if (codes.Length == 0) return new Dictionary<string, RawLink>(StringComparer.OrdinalIgnoreCase);
        var rows = await c.QueryAsync<RawLink>(@"
SELECT m.[物料编号], r.[物料编号] AS 原料编号, r.[物料名称] AS 原料名称,
       COALESCE(m.[原胶件单净重], m.[整啤净重]/NULLIF(m.[出模数],0)) AS 单件克重
FROM [塑胶物料资料] m
LEFT JOIN [塑胶原料资料] r ON r.[物料名称]=m.[用料名称]
WHERE m.[物料编号] IN @codes", new { codes }, tx);
        return rows.ToDictionary(x => x.物料编号, x => x, StringComparer.OrdinalIgnoreCase);
    }

    private static async Task InsertLinesAsync(
        SqlConnection c, SqlTransaction tx, string 单号, IReadOnlyList<PlasticPurchaseOrderCreateLineDto> 明细,
        bool 扣原料)
    {
        var links = 扣原料 ? await RawLinksAsync(c, tx, 明细) : new Dictionary<string, RawLink>(StringComparer.OrdinalIgnoreCase);
        foreach (var l in 明细)
        {
            links.TryGetValue(l.物料编号?.Trim() ?? "", out var link);
            var kg = link?.单件克重 is > 0 ? Math.Round(l.数量 * link.单件克重.Value / 1000m, 4) : (decimal?)null;
            await c.ExecuteAsync(@"
INSERT INTO [塑胶采购订单明细]([单号],[生产单号],[款号],[物料编号],[物料名称],[模具编号],[用量],[套数],[数量],[颜色],[色粉号],[用料名称],[加工内容],[备注],[原料编号],[原料名称],[原料用量KG])
VALUES(@单号,@生产单号,@款号,@物料编号,@物料名称,@模具编号,@用量,@套数,@数量,@颜色,@色粉号,@用料名称,@加工内容,@备注,@原料编号,@原料名称,@原料用量KG)",
                new
                {
                    单号, l.生产单号, l.款号, l.物料编号, l.物料名称, l.模具编号, l.用量, l.套数,
                    l.数量, l.颜色, l.色粉号, l.用料名称, l.加工内容, l.备注,
                    link?.原料编号, 原料名称 = link?.原料名称, 原料用量KG = kg
                }, tx);
        }
    }

    public async Task<string> CreateAsync(PlasticPurchaseOrderCreateDto dto, string user)
    {
        if (dto.明细.Count == 0) throw new ArgumentException("塑胶采购订单至少要有一行物料明细");
        校验加工内容(dto);
        await 校验加工下单Async(dto);
        var 数量合计 = dto.明细.Sum(l => l.数量);
        var now = DateTime.Now;

        using var c = factory.Create();
        await c.OpenAsync();
        // 分析门：明细引用的生产通知单(采购分析源单)必须全部已审核,且未关联MA单(关联后塑胶不能再下单)。
        // 按库存加工单跳过:生产单号只是来源追溯(可能是已删除的老单),消耗的是仓库现货,不重新占用 BOM 需求
        if (!dto.库存加工) await 校验生产通知单可下单Async(c, dto.明细);
        using var tx = c.BeginTransaction();
        var 单号 = await docNo.NextAsync(DocType, Prefix, now, c, tx);

        await c.ExecuteAsync(@"
INSERT INTO [塑胶采购订单]([单号],[日期],[交货日期],[供应商编号],[供应商名称],[客户名称],[交货地点],[编号],[数量],[操作员],[审核],[备注],[加工内容],[加工类型])
VALUES(@单号,@日期,@交货日期,@供应商编号,@供应商名称,@客户名称,@交货地点,@编号,@数量,@操作员,'0',@备注,@加工内容,@加工类型)",
            new { 单号, 日期 = now, dto.交货日期, dto.供应商编号, dto.供应商名称, dto.客户名称,
                  dto.交货地点, dto.编号, 数量 = 数量合计, 操作员 = user, dto.备注, dto.加工内容,
                  加工类型 = string.IsNullOrWhiteSpace(dto.加工类型) ? "一次加工" : dto.加工类型.Trim() }, tx);

        await InsertLinesAsync(c, tx, 单号, dto.明细, 是啤机单(dto.加工类型, dto.加工内容));

        tx.Commit();
        return 单号;
    }

    // 未审核可改：单头字段(日期/操作员不动) + 明细整组替换；已审核拒绝(先反审核)。
    public async Task<bool> UpdateAsync(string 单号, PlasticPurchaseOrderCreateDto dto, string user)
    {
        if (dto.明细.Count == 0) throw new ArgumentException("塑胶采购订单至少要有一行物料明细");
        校验加工内容(dto);
        await 校验加工下单Async(dto);
        using var c = factory.Create();
        await c.OpenAsync();
        // 同 create:明细引用的生产通知单必须已审核且未关联MA单(防止改单绕过 MA 门);按库存加工单同样跳过
        if (!dto.库存加工) await 校验生产通知单可下单Async(c, dto.明细);
        using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [塑胶采购订单] WITH (UPDLOCK,HOLDLOCK) WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null) return false;
        if (审核 == "1") throw new InvalidOperationException("已审核的塑胶采购订单不能修改，请先反审核。");

        await c.ExecuteAsync(@"
UPDATE [塑胶采购订单] SET [交货日期]=@交货日期,[供应商编号]=@供应商编号,[供应商名称]=@供应商名称,
    [客户名称]=@客户名称,[交货地点]=@交货地点,[编号]=@编号,[数量]=@数量,[备注]=@备注,[加工内容]=@加工内容,[加工类型]=@加工类型
WHERE [单号]=@单号",
            new { 单号, dto.交货日期, dto.供应商编号, dto.供应商名称, dto.客户名称,
                  dto.交货地点, dto.编号, 数量 = dto.明细.Sum(l => l.数量), dto.备注, dto.加工内容,
                  加工类型 = string.IsNullOrWhiteSpace(dto.加工类型) ? "一次加工" : dto.加工类型.Trim() }, tx);

        await c.ExecuteAsync("DELETE FROM [塑胶采购订单明细] WHERE [单号]=@单号", new { 单号 }, tx);
        await InsertLinesAsync(c, tx, 单号, dto.明细, 是啤机单(dto.加工类型, dto.加工内容));

        tx.Commit();
        return true;
    }

    public async Task<PagedResult<PlasticPurchaseOrderHeaderDto>> ListAsync(int page, int size, string? keyword)
    {
        if (page < 1) page = 1;
        if (size < 1) size = 20;
        if (size > 1000) size = 1000;
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [塑胶采购订单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [供应商名称] LIKE @kw OR [客户名称] LIKE @kw;
SELECT [ID],[单号],[日期],[交货日期],[供应商名称],[客户名称],[数量],[操作员],[审核],[审核人],[备注],[加工内容],[加工类型],[主管审核],[主管审核人],[经理审核],[经理审核人]
FROM [塑胶采购订单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [供应商名称] LIKE @kw OR [客户名称] LIKE @kw
ORDER BY [ID] DESC OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;", new { kw, page, size });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<PlasticPurchaseOrderHeaderDto>()).AsList();
        return new PagedResult<PlasticPurchaseOrderHeaderDto>(items, total);
    }

    public async Task<PlasticPurchaseOrderDetailDto?> GetAsync(string 单号)
    {
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT o.[ID],o.[单号],o.[日期],o.[交货日期],o.[供应商编号],o.[供应商名称],o.[客户名称],o.[交货地点],o.[编号],o.[数量],o.[操作员],o.[审核],o.[审核人],o.[备注],o.[加工内容],o.[加工类型],o.[主管审核],o.[主管审核人],o.[经理审核],o.[经理审核人],
       s.[联系人] AS [供应商联系人],s.[电话] AS [供应商电话],s.[传真] AS [供应商传真],s.[联系地址] AS [供应商联系地址]
FROM [塑胶采购订单] o
LEFT JOIN [供应商资料] s ON s.[供应商编号]=o.[供应商编号]
WHERE o.[单号]=@单号;
SELECT d.[ID],d.[生产单号],d.[款号],d.[物料编号],d.[物料名称],d.[模具编号],d.[用量],d.[套数],d.[数量],d.[颜色],d.[色粉号],d.[用料名称],d.[加工内容],d.[备注],
       d.[原料编号],d.[原料名称],d.[原料用量KG],
       m.[原胶件单净重] AS [单重],m.[整啤净重] AS [整啤净重],m.[出模数] AS [出模数],
       ISNULL(cm.[加工单价], m.[加工总单价]) AS [加工单价]
FROM [塑胶采购订单明细] d
LEFT JOIN [塑胶物料资料] m ON m.[物料编号]=d.[物料编号]
LEFT JOIN (SELECT [物料编号], MAX([加工单价]) AS [加工单价] FROM [塑胶共用物料表] GROUP BY [物料编号]) cm
       ON cm.[物料编号]=d.[物料编号]
WHERE d.[单号]=@单号 ORDER BY d.[ID];", new { 单号 });
        var header = await multi.ReadFirstOrDefaultAsync<PlasticPurchaseOrderHeaderDto>();
        if (header is null) return null;
        var lines = (await multi.ReadAsync<PlasticPurchaseOrderLineDto>()).AsList();

        // 每行补 已入仓/欠数(同进度表核销口径):打开已入仓的单据就能看到收货进度(复用同一连接 c)
        var prog = await c.QueryAsync<PlasticPurchaseOrderLineDto>(@"
SELECT d.[ID],
       ISNULL(rk.[入仓数量], 0) AS 入仓数量,
       d.[数量] - ISNULL(rk.[入仓数量], 0) AS 欠数
FROM [塑胶采购订单明细] d
LEFT JOIN (" + ReceiptAggSql + ReceiptJoinSql + @"
WHERE d.[单号] = @单号", new { 单号 });
        var byId = prog.ToDictionary(r => r.ID);
        foreach (var l in lines)
            if (byId.TryGetValue(l.ID, out var p)) { l.入仓数量 = p.入仓数量; l.欠数 = p.欠数; }
        // 每行补原料实时库存(原料扣减汇总面板用)
        var rawLive = new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase);
        foreach (var code in lines.Select(l => l.原料编号).Where(x => !string.IsNullOrEmpty(x)).Distinct(StringComparer.OrdinalIgnoreCase))
            rawLive[code!] = await inventory.RawMaterialStockOfAsync(code!);
        foreach (var l in lines)
            if (!string.IsNullOrEmpty(l.原料编号) && rawLive.TryGetValue(l.原料编号!, out var rqty)) l.原料库存 = rqty;
        return new PlasticPurchaseOrderDetailDto { 单头 = header, 明细 = lines };
    }

    public async Task<bool> DeleteAsync(string 单号)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [塑胶采购订单] WITH (UPDLOCK, HOLDLOCK) WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null) return false;
        if (审核 == "1") throw new InvalidOperationException("已审核的塑胶采购订单不能删除，请先反审核。");
        await c.ExecuteAsync("DELETE FROM [塑胶采购订单明细] WHERE [单号]=@单号", new { 单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [塑胶采购订单] WHERE [单号]=@单号", new { 单号 }, tx);
        tx.Commit();
        return true;
    }

    // ==================== 外部系统推送挂钩(排产 paiji + 喷油部 sprayplan) ====================
    // 审核成功后调用:排产推送(所有供应商,车间按映射)与喷油排期推送(供应商含「喷油」)并存,互不干扰。
    // 未配置凭证的分支整体跳过;推送失败/部分失败只返回警告,不阻断审核。
    public async Task<string?> ApprovePushAsync(string 单号)
    {
        var 警告 = new List<string>();
        警告.AddRange(await ApprovePaijiPushAsync(单号));
        警告.AddRange(await ApproveSprayPlanPushAsync(单号));
        return 警告.Count > 0 ? string.Join("；", 警告) : null;
    }

    // 排产推送(排产端=orders):把订单明细逐行推送到排产系统订单导入,车间按单头供应商映射。
    private async Task<List<string>> ApprovePaijiPushAsync(string 单号)
    {
        var 警告 = new List<string>();
        if (!paiji.已配置) return 警告;

        using var c = factory.Create();
        // 幂等重推:已有推送记录先删远端再清记录(只清排产端,喷油排期记录由 sprayplan 分支处理)
        var 旧记录 = (await c.QueryAsync<(string 排产端, long Id)>(@"
SELECT [排产端],[排产订单ID] AS Id FROM [排产推送记录]
WHERE [单据类型]=N'采购订单' AND [单据号]=@单号 AND [排产端]<>N'sprayplan-test'", new { 单号 })).AsList();
        if (旧记录.Count > 0)
        {
            var 删 = await paiji.DeleteAsync(旧记录);
            警告.AddRange(删.警告);
            // 只清远端删除成功的记录;失败的保留(远端单还在,本地记录失联会导致下次审核重复推单)
            var 成功Ids = 旧记录.Where(r => !删.失败.Contains(r)).Select(r => r.Id).ToList();
            if (成功Ids.Count > 0)
                await c.ExecuteAsync(
                    "DELETE FROM [排产推送记录] WHERE [单据类型]=N'采购订单' AND [单据号]=@单号 AND [排产端]<>N'sprayplan-test' AND [排产订单ID] IN @成功Ids", new { 单号, 成功Ids });
        }

        var d = await GetAsync(单号);
        if (d?.单头 is null) { 警告.Add("已审核，但推送排产系统失败：单据读取失败。"); return 警告; }
        // 喷油供应商的单只推喷油排期系统,不推排产(由 ApproveSprayPlanPushAsync 负责)
        if (SprayPlanMapper.要推送(d.单头.供应商名称)) return 警告;
        var 有效行 = d.明细.Where(l => l.数量 > 0).ToList();
        if (有效行.Count == 0) return 警告;

        // 啤重G换算所需的物料资料(整啤净重,回落原胶件单净重)
        var 物料表 = (await c.QueryAsync<PaijiMaterialInfo>(@"
SELECT [物料编号],[整啤净重],[原胶件单净重] FROM [塑胶物料资料] WHERE [物料编号] IN @codes",
            new { codes = 有效行.Select(l => l.物料编号).Distinct().ToArray() }))
            .ToDictionary(m => m.物料编号, m => m);

        var workshop = PaijiMapper.车间(d.单头.供应商名称);
        var rows = 有效行.Select(l => PaijiMapper.BuildRow(workshop, d.单头, l,
            l.物料编号 is not null && 物料表.TryGetValue(l.物料编号, out var m) ? m : null)).ToList();

        var (ids, 失败) = await paiji.PushAsync(rows);
        foreach (var id in ids)
            await c.ExecuteAsync(@"
INSERT INTO [排产推送记录]([单据类型],[单据号],[排产订单ID],[排产端],[车间]) VALUES(N'采购订单',@单号,@id,N'orders',@车间)",
                new { 单号, id, 车间 = workshop });

        if (失败.Count > 0)
            警告.Add(ids.Count == 0
                ? $"已审核，但推送排产系统失败：{string.Join("、", 失败)}"
                : $"部分行推送失败：{string.Join("、", 失败)}");
        return 警告;
    }

    // 喷油部排期推送(排产端=sprayplan-test,车间='喷油部'):供应商名称含「喷油」时按款号分组,一款号一张订单。
    private async Task<List<string>> ApproveSprayPlanPushAsync(string 单号)
    {
        var 警告 = new List<string>();
        using var c = factory.Create();
        // 幂等重推:已有喷油排期记录先删远端再清记录
        var 旧记录 = (await c.QueryAsync<long>(@"
SELECT [排产订单ID] FROM [排产推送记录]
WHERE [单据类型]=N'采购订单' AND [单据号]=@单号 AND [排产端]=N'sprayplan-test'", new { 单号 })).AsList();
        var 供应商 = await c.ExecuteScalarAsync<string?>(
            "SELECT [供应商名称] FROM [塑胶采购订单] WHERE [单号]=@单号", new { 单号 });
        if (!SprayPlanMapper.要推送(供应商))
            return 警告;   // 非喷油部供应商:不推;旧记录理论上也只可能是喷油部单留下,这里一并忽略
        if (旧记录.Count > 0)
        {
            if (spray.已配置)
            {
                var 删 = await spray.DeleteOrdersAsync(旧记录);
                警告.AddRange(删.警告);
                // 只清远端删除成功的记录;失败的保留(远端单还在,本地记录失联会导致下次审核重复推单)
                var 成功Ids = 旧记录.Where(id => !删.失败Ids.Contains(id)).ToList();
                if (成功Ids.Count > 0)
                    await c.ExecuteAsync(
                        "DELETE FROM [排产推送记录] WHERE [单据类型]=N'采购订单' AND [单据号]=@单号 AND [排产端]=N'sprayplan-test' AND [排产订单ID] IN @成功Ids", new { 单号, 成功Ids });
            }
            else
                await c.ExecuteAsync(
                    "DELETE FROM [排产推送记录] WHERE [单据类型]=N'采购订单' AND [单据号]=@单号 AND [排产端]=N'sprayplan-test'", new { 单号 });
        }
        if (!spray.已配置) return 警告;

        var d = await GetAsync(单号);
        if (d?.单头 is null) { 警告.Add("已审核，但推送喷油排期系统失败：单据读取失败。"); return 警告; }
        var 有效行 = d.明细.Where(l => l.数量 > 0).ToList();
        if (有效行.Count == 0) return 警告;

        var drafts = SprayPlanMapper.BuildDrafts(d.单头, 有效行);
        var (ids, 失败) = await spray.PushOrdersAsync(drafts);
        foreach (var id in ids)
            await c.ExecuteAsync(@"
INSERT INTO [排产推送记录]([单据类型],[单据号],[排产订单ID],[排产端],[车间]) VALUES(N'采购订单',@单号,@id,N'sprayplan-test',N'喷油部')",
                new { 单号, id });

        if (失败.Count > 0)
            警告.Add(ids.Count == 0
                ? $"已审核，但推送喷油排期系统失败：{string.Join("、", 失败)}"
                : $"喷油排期部分款号推送失败：{string.Join("、", 失败)}");
        return 警告;
    }

    // 反审核成功后调用:按推送记录删远端(排产端=orders 走排产,sprayplan-test 走喷油排期;容忍远端已删),再清记录;
    // 远端删失败的记录保留待下次反审核/重推重试(防重复推单),失败只返回警告。
    public async Task<string?> UnapprovePushAsync(string 单号)
    {
        using var c = factory.Create();
        var 记录 = (await c.QueryAsync<(string 排产端, long Id)>(@"
SELECT [排产端],[排产订单ID] AS Id FROM [排产推送记录] WHERE [单据类型]=N'采购订单' AND [单据号]=@单号", new { 单号 })).AsList();
        if (记录.Count == 0) return null;

        var 警告 = new List<string>();
        var 排产记录 = 记录.Where(r => r.排产端 != "sprayplan-test").ToList();
        var 喷油记录 = 记录.Where(r => r.排产端 == "sprayplan-test").Select(r => r.Id).ToList();
        if (排产记录.Count > 0)
        {
            if (!paiji.已配置) 警告.Add("排产系统未配置凭证，远端排产订单未删除（推送记录已保留）。");
            else
            {
                var 删 = await paiji.DeleteAsync(排产记录);
                警告.AddRange(删.警告);
                var 成功Ids = 排产记录.Where(r => !删.失败.Contains(r)).Select(r => r.Id).ToList();
                if (成功Ids.Count > 0)
                    await c.ExecuteAsync(
                        "DELETE FROM [排产推送记录] WHERE [单据类型]=N'采购订单' AND [单据号]=@单号 AND [排产端]<>N'sprayplan-test' AND [排产订单ID] IN @成功Ids", new { 单号, 成功Ids });
            }
        }
        if (喷油记录.Count > 0)
        {
            if (!spray.已配置) 警告.Add("喷油排期系统未配置凭证，远端订单未删除（推送记录已保留）。");
            else
            {
                var 删 = await spray.DeleteOrdersAsync(喷油记录);
                警告.AddRange(删.警告);
                var 成功Ids = 喷油记录.Where(id => !删.失败Ids.Contains(id)).ToList();
                if (成功Ids.Count > 0)
                    await c.ExecuteAsync(
                        "DELETE FROM [排产推送记录] WHERE [单据类型]=N'采购订单' AND [单据号]=@单号 AND [排产端]=N'sprayplan-test' AND [排产订单ID] IN @成功Ids", new { 单号, 成功Ids });
            }
        }
        return 警告.Count > 0 ? string.Join("；", 警告) : null;
    }


    // 塑胶进度表(采购进度):一行一采购订单明细 + 已审核入仓数量 + 欠数=订购−入仓。
    // 入仓核销口径见 ReceiptAggSql/ReceiptJoinSql:带 订单单号 按采购订单核销(排期下单主口径),否则回退按生产单核销。
// 塑胶采购订单明细行已审核入仓数量聚合子查询(两进度接口 + GetAsync 详情共用)。
// 核销口径两条路:
//  ① 入仓行带 订单单号(下推/选采购单入仓)→ 按 采购订单单号+物料+颜色 精确核销(排期下单主口径,与物料侧一致);
//  ② 入仓行无 订单单号(旧口径,生产单 BOM 调入开单)→ 回退按 生产单号+物料+颜色 核销。
private const string ReceiptAggSql = @"
    SELECT r.[生产单号], r.[订单单号], r.[物料编号], ISNULL(r.[颜色],'') AS 颜色键, SUM(r.[数量]) AS 入仓数量
    FROM [塑胶入仓明细单] r
    JOIN [塑胶入仓单] h ON h.[单号] = r.[单号]
    WHERE ISNULL(h.[审核],'0') = '1' AND ISNULL(r.[备品],'0') <> '1'
    GROUP BY r.[生产单号], r.[订单单号], r.[物料编号], ISNULL(r.[颜色],'')";

private const string ReceiptJoinSql = @"
) rk ON rk.[物料编号] = d.[物料编号] AND rk.[颜色键] = ISNULL(d.[颜色],'')
   AND ( rk.[订单单号] = d.[单号]
      OR (rk.[订单单号] IS NULL AND rk.[生产单号] IS NOT NULL AND rk.[生产单号] = d.[生产单号]) )";

    public async Task<IReadOnlyList<PlasticPurchaseProgressRow>> ProgressAsync(
        string? 供应商, DateTime? 起, DateTime? 止, string? keyword, bool onlyOwed)
    {
        var sup = string.IsNullOrWhiteSpace(供应商) ? null : $"%{供应商.Trim()}%";
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var 止Excl = 止?.Date.AddDays(1);
        using var c = factory.Create();
        var rows = await c.QueryAsync<PlasticPurchaseProgressRow>(@"
SELECT o.[日期] AS 订购日期, o.[交货日期], o.[单号] AS 采购单号, d.[生产单号], d.[款号],
       d.[物料编号], d.[物料名称], d.[模具编号], d.[颜色], m.[单位],
       d.[数量] AS 订购数量,
       ISNULL(rk.[入仓数量], 0) AS 入仓数量,
       d.[数量] - ISNULL(rk.[入仓数量], 0) AS 欠数,
       o.[供应商名称], o.[审核]
FROM [塑胶采购订单明细] d
JOIN [塑胶采购订单] o ON o.[单号] = d.[单号]
LEFT JOIN (SELECT [物料编号], MAX([单位]) AS 单位 FROM [塑胶物料资料] GROUP BY [物料编号]) m ON m.[物料编号] = d.[物料编号]
LEFT JOIN (" + ReceiptAggSql + ReceiptJoinSql + @"
WHERE (@sup IS NULL OR o.[供应商编号] LIKE @sup OR o.[供应商名称] LIKE @sup)
  AND (@起 IS NULL OR o.[日期] >= @起)
  AND (@止 IS NULL OR o.[日期] < @止)
  AND (@kw IS NULL OR d.[生产单号] LIKE @kw OR d.[款号] LIKE @kw OR d.[物料编号] LIKE @kw OR d.[物料名称] LIKE @kw)
  AND (@onlyOwed = 0 OR (d.[数量] - ISNULL(rk.[入仓数量], 0)) > 0)
ORDER BY o.[单号] DESC, d.[ID]", new { sup, 起, 止 = 止Excl, kw, onlyOwed = onlyOwed ? 1 : 0 });
        return rows.AsList();
    }

    // 塑胶进度明细表:进度表明细行 + 最近入仓单号/日期 + 完成情况(镜像 PlasticProcessPurchaseOrderService.PurchaseDetailAsync)。
    // 入仓核销口径同 ProgressAsync(见 ReceiptJoinSql,仅审核='1')。
    public async Task<IReadOnlyList<PlasticPurchaseProgressDetailRow>> ProgressDetailAsync(
        string? 供应商, DateTime? 起, DateTime? 止, string? keyword, string? 完成情况)
    {
        var sup = string.IsNullOrWhiteSpace(供应商) ? null : $"%{供应商.Trim()}%";
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var 止Excl = 止?.Date.AddDays(1);
        var done = 完成情况 switch { "已完成" => 1, "未完成" => 0, _ => -1 };
        using var c = factory.Create();
        var rows = await c.QueryAsync<PlasticPurchaseProgressDetailRow>(@"
SELECT o.[日期] AS 订购日期, o.[交货日期], o.[单号] AS 采购单号, d.[生产单号], d.[款号],
       d.[物料编号], d.[物料名称], d.[模具编号], d.[颜色], m.[单位],
       d.[数量] AS 订购数量,
       ISNULL(rk.[入仓数量], 0) AS 入仓数量,
       d.[数量] - ISNULL(rk.[入仓数量], 0) AS 欠数,
       rk.[入仓日期], rk.[入仓单号],
       CASE WHEN d.[数量] - ISNULL(rk.[入仓数量], 0) <= 0 THEN N'已完成' ELSE N'未完成' END AS 完成情况,
       o.[供应商名称], o.[审核]
FROM [塑胶采购订单明细] d
JOIN [塑胶采购订单] o ON o.[单号] = d.[单号]
LEFT JOIN (SELECT [物料编号], MAX([单位]) AS 单位 FROM [塑胶物料资料] GROUP BY [物料编号]) m ON m.[物料编号] = d.[物料编号]
LEFT JOIN (
    SELECT r.[生产单号], r.[订单单号], r.[物料编号], ISNULL(r.[颜色],'') AS 颜色键,
           SUM(r.[数量]) AS 入仓数量, MAX(r.[单号]) AS 入仓单号, MAX(h.[日期]) AS 入仓日期
    FROM [塑胶入仓明细单] r
    JOIN [塑胶入仓单] h ON h.[单号] = r.[单号]
    WHERE ISNULL(h.[审核],'0') = '1'
    GROUP BY r.[生产单号], r.[订单单号], r.[物料编号], ISNULL(r.[颜色],'')
" + ReceiptJoinSql + @"
WHERE (@sup IS NULL OR o.[供应商编号] LIKE @sup OR o.[供应商名称] LIKE @sup)
  AND (@起 IS NULL OR o.[日期] >= @起)
  AND (@止 IS NULL OR o.[日期] < @止)
  AND (@kw IS NULL OR d.[生产单号] LIKE @kw OR d.[款号] LIKE @kw OR d.[物料编号] LIKE @kw OR d.[物料名称] LIKE @kw)
  AND (@done = -1 OR (@done = 1 AND (d.[数量] - ISNULL(rk.[入仓数量],0)) <= 0) OR (@done = 0 AND (d.[数量] - ISNULL(rk.[入仓数量],0)) > 0))
ORDER BY o.[单号] DESC, d.[ID]", new { sup, 起, 止 = 止Excl, kw, done });
        return rows.AsList();
    }
}
