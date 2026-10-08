using Dapper;
using ErpApi.Engines.Inventory;
using ErpApi.Features.Plastics.PlasticProcessPurchaseOrder;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Plastics.PlasticProcessDemand;

// 塑胶仓加工件(印喷/电镀等二次加工)发外需求计算 + 生成塑胶加工采购单。
// 口径(用户确认): 需发数量 = 需求量(生产单接单数 × BOM 用量) − 白件现有库存 − 已发外未回数量。
public sealed class PlasticProcessDemandService(
    ISqlConnectionFactory factory, PlasticInventoryService inventory,
    PlasticProcessPurchaseOrderService orders)
{
    // 需求行源:生产制单货号 × 款号物料明细表(仅 BOM 台头已审核),加工内容取自 塑胶共用物料表。
    private sealed class SourceRow
    {
        public string? 生产单号 { get; set; }
        public string? 款号 { get; set; }
        public string? 工模编号 { get; set; }
        public string? 物料编号 { get; set; }
        public string? 物料名称 { get; set; }
        public string? 颜色 { get; set; }
        public string? 单位 { get; set; }
        public decimal 用量 { get; set; }
        public decimal 计划数量 { get; set; }
        public string? 加工内容 { get; set; }
        public string? 二次加工内容 { get; set; }
        public decimal? 出模数 { get; set; }   // 塑胶物料资料(啤数=⌈需发/出模数⌉ 用)
    }

    public async Task<IReadOnlyList<PlasticProcessDemandRow>> DemandAsync(string 生产单号)
    {
        using var c = factory.Create();
        var sources = (await c.QueryAsync<SourceRow>(@"
SELECT g.[生产单号], b.[款号], b.[工模编号], b.[物料编号], b.[物料名称], b.[颜色], b.[单位],
       ISNULL(b.[使用数量],0) AS 用量, ISNULL(pm.[计划数量],0) AS 计划数量,
       cm.[加工内容], cm.[二次加工内容], mm.[出模数]
FROM [生产制单货号] g
JOIN [生产制单] pm ON pm.[生产单号] = g.[生产单号]
JOIN [款号物料总表] h ON h.[款号] = g.[货号] AND ISNULL(h.[审核],'0') = '1'
JOIN [款号物料明细表] b ON b.[款号] = g.[货号]
LEFT JOIN (
    SELECT [物料编号], MAX([加工内容]) AS 加工内容, MAX([二次加工内容]) AS 二次加工内容
    FROM [塑胶共用物料表] GROUP BY [物料编号]
) cm ON cm.[物料编号] = b.[物料编号]
LEFT JOIN [塑胶物料资料] mm ON mm.[物料编号] = b.[物料编号]
WHERE g.[生产单号] = @生产单号
ORDER BY b.[ID];", new { 生产单号 })).AsList();

        // 只保留需二次加工的件(加工内容 或 二次加工内容 非空)
        var needing = sources
            .Where(s => !string.IsNullOrWhiteSpace(s.加工内容) || !string.IsNullOrWhiteSpace(s.二次加工内容))
            .ToList();
        if (needing.Count == 0) return [];

        // 已发未回:已审核加工采购单订购 − 已审核塑胶入仓(口径同 物料发外欠数表:订购−已回;
        // 欠数表按 审核情况 可选过滤,这里固定只算已审核单——未审核不算"已发")
        var owed = (await c.QueryAsync<(string? 物料编号, string 颜色键, decimal 已发未回)>(@"
SELECT d.[物料编号], ISNULL(d.[颜色],'') AS 颜色键,
       SUM(d.[数量]) - MAX(ISNULL(rk.[入仓数量],0)) AS 已发未回
FROM [塑胶加工采购单明细] d
JOIN [塑胶加工采购单] o ON o.[单号] = d.[单号] AND ISNULL(o.[审核],'0') = '1'
LEFT JOIN (
    SELECT r.[生产单号], r.[物料编号], ISNULL(r.[颜色],'') AS 颜色键, SUM(r.[数量]) AS 入仓数量
    FROM [塑胶入仓明细单] r
    JOIN [塑胶入仓单] h ON h.[单号] = r.[单号]
    WHERE ISNULL(h.[审核],'0') = '1'
    GROUP BY r.[生产单号], r.[物料编号], ISNULL(r.[颜色],'')
) rk ON rk.[生产单号] = d.[生产单号] AND rk.[物料编号] = d.[物料编号] AND rk.[颜色键] = ISNULL(d.[颜色],'')
WHERE d.[生产单号] = @生产单号
GROUP BY d.[物料编号], ISNULL(d.[颜色],'')", new { 生产单号 }))
            .ToDictionary(x => (x.物料编号 ?? "", x.颜色键), x => x.已发未回);

        var rows = new List<PlasticProcessDemandRow>();
        foreach (var s in needing)
        {
            var 需求量 = s.计划数量 * s.用量;
            // 白件库存:塑胶台账聚合(复用 PlasticInventoryService 台账口径)
            var 白件库存 = await inventory.StockOfAsync(s.物料编号 ?? "", null);
            var 已发未回 = owed.TryGetValue((s.物料编号 ?? "", s.颜色 ?? ""), out var o) ? o : 0;
            var 需发 = Math.Max(需求量 - 白件库存 - 已发未回, 0);

            // 二次加工的件按既有规则展开两行(第一次/第二次,带 加工字母)
            var 后缀 = SecondProcessCategory.推导后缀(s.加工内容, s.二次加工内容);
            if (后缀 is not null)
            {
                foreach (var (次序, 内容) in new[] { ("第一次", s.加工内容!), ("第二次", s.二次加工内容!) })
                    rows.Add(Build(s, 内容, 次序, SecondProcessCategory.加工字母(后缀, 内容),
                        需求量, 白件库存, 已发未回, 需发));
            }
            else
            {
                var 内容 = !string.IsNullOrWhiteSpace(s.加工内容) ? s.加工内容 : s.二次加工内容;
                rows.Add(Build(s, 内容, null, null, 需求量, 白件库存, 已发未回, 需发));
            }
        }
        return rows;
    }

    private static PlasticProcessDemandRow Build(SourceRow s, string? 加工内容, string? 次序, string? 字母,
        decimal 需求量, decimal 白件库存, decimal 已发未回, decimal 需发) => new()
        {
            生产单号 = s.生产单号, 款号 = s.款号, 工模编号 = s.工模编号, 物料编号 = s.物料编号,
            物料名称 = s.物料名称, 颜色 = s.颜色, 单位 = s.单位, 加工内容 = 加工内容,
            加工次序 = 次序, 加工字母 = 字母, 需求量 = 需求量, 白件库存 = 白件库存,
            已发未回 = 已发未回, 需发数量 = 需发, 出模数 = s.出模数,
        };

    // 按 加工厂编号+加工内容 分组生成 塑胶加工采购单(未审核)。
    // 幂等:同 生产单号+物料编号+加工内容 已有加工采购明细的行跳过(防重复开单)。
    public async Task<PlasticProcessDemandCreateResult> CreateOrdersAsync(
        PlasticProcessDemandCreateRequest req, string user)
    {
        var result = new PlasticProcessDemandCreateResult();
        if (req.行.Count == 0) return result;
        using var c = factory.Create();
        var existing = (await c.QueryAsync<string>(
            "SELECT [物料编号]+'|'+ISNULL([加工内容],'') FROM [塑胶加工采购单明细] WHERE [生产单号]=@生产单号",
            new { req.生产单号 })).ToHashSet(StringComparer.OrdinalIgnoreCase);

        var todo = req.行.Where(l => !existing.Contains($"{l.物料编号}|{l.加工内容 ?? ""}")).ToList();
        result.跳过 = req.行.Count - todo.Count;

        foreach (var g in todo.GroupBy(l => (l.加工厂编号 ?? "", l.加工内容 ?? "")))
        {
            var dto = new PlasticProcessPurchaseOrderCreateDto
            {
                加工厂编号 = g.Key.Item1.Length > 0 ? g.Key.Item1 : null,
                加工厂名称 = g.First().加工厂名称,
                备注 = $"发外需求生成(生产单号 {req.生产单号})",
                明细 = g.Select(l => new PlasticProcessPurchaseOrderCreateLineDto
                {
                    生产单号 = req.生产单号, 款号 = l.款号, 物料编号 = l.物料编号,
                    物料名称 = l.物料名称, 颜色 = l.颜色, 模具编号 = l.工模编号, 用料名称 = l.用料名称,
                    加工内容 = l.加工内容, 加工次序 = l.加工次序, 加工字母 = l.加工字母,
                    数量 = l.数量, 单价 = l.单价,
                }).ToList(),
            };
            result.单号列表.Add(await orders.CreateAsync(dto, user));
        }
        return result;
    }
}
