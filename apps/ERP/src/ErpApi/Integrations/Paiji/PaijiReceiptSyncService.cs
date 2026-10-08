using Dapper;
using ErpApi.Features.Plastics.PlasticReceipt;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Integrations.Paiji;

// 排产入库行 → ERP塑胶入仓单 共享同步逻辑(轮询 PaijiSyncWorker 与 webhook PaijiWebhookController 共用)。
// 每趟:只留 status=checked-in 且非 ERP 回推入仓行(防回环见 PaijiMapper.是ERP回推入仓行) 且未同步过的行
//   → 按送货单号分组建未审核塑胶入仓单(操作员=排产同步) → 成功后写 [排产同步记录]。
// 单组失败记警告继续;返回建出的 ERP 单号列表。
public sealed class PaijiReceiptSyncService(
    PlasticReceiptService receipts, ISqlConnectionFactory factory, ILogger<PaijiReceiptSyncService> logger)
{
    public async Task<IReadOnlyList<string>> SyncRowsAsync(IReadOnlyList<PaijiWarehouseInRow> rows, string workshop)
    {
        var 建单 = new List<string>();
        var 有效 = rows
            .Where(r => r.Status == "checked-in" && !PaijiMapper.是ERP回推入仓行(r.Notes))
            .ToList();
        if (有效.Count == 0) return 建单;

        using var c = factory.Create();
        var 已同步 = (await c.QueryAsync<long>(
            "SELECT [排产入库ID] FROM [排产同步记录] WHERE [排产入库ID] IN @ids",
            new { ids = 有效.Select(r => r.Id).ToArray() })).ToHashSet();
        var 新行 = 有效.Where(r => !已同步.Contains(r.Id)).ToList();
        if (新行.Count == 0) return 建单;

        var (供应商编号, 供应商名称) = PaijiMapper.车间供应商(workshop);
        foreach (var g in PaijiMapper.入库分组(新行))
        {
            try
            {
                var group = g.ToList();
                var 明细 = new List<PlasticReceiptCreateLineDto>(group.Count);
                foreach (var r in group)
                    明细.Add(PaijiMapper.ToReceiptLine(r, await 解析物料Async(c, r)));
                var dto = new PlasticReceiptCreateDto
                {
                    供应商编号 = 供应商编号,
                    供应商名称 = 供应商名称,
                    仓库 = "塑胶仓",
                    入仓单号 = string.IsNullOrWhiteSpace(g.Key) || g.Key.StartsWith('#') ? null : g.Key,
                    // 订单单号 不传(排产只能给到生产单号,没有采购单号):留空让核销走
                    // 生产单号+物料+颜色 口径(PlasticPurchaseOrderService.ReceiptJoinSql 路径②),
                    // 误填生产单号会两条核销路径都匹配不上
                    备注 = $"排产系统同步({workshop})",
                    明细 = 明细,
                };
                var 单号 = await receipts.CreateAsync(dto, "排产同步");

                // 单头日期取排产送货日期(CreateAsync 固定用当天,这里改写)
                if (DateTime.TryParse(group[0].DeliveryDate, out var d))
                    await c.ExecuteAsync("UPDATE [塑胶入仓单] SET [日期]=@d WHERE [单号]=@单号",
                        new { d = d.Date, 单号 });
                foreach (var r in group)
                    await c.ExecuteAsync(
                        "INSERT INTO [排产同步记录]([排产入库ID],[ERP单号],[车间]) VALUES(@id,@单号,@车间)",
                        new { id = r.Id, 单号, 车间 = workshop });
                建单.Add(单号);
                logger.LogInformation("排产同步建单 {单号}:车间={车间} 送货单号={Code} 行数={N}", 单号, workshop, g.Key, group.Count);
            }
            catch (Exception ex) { logger.LogWarning(ex, "排产同步分组 {Key} 建单失败", g.Key); }
        }
        return 建单;
    }

    // 物料解析:排产行只有 生产单号(order_no)+模号(part_name)+颜色 可用。
    // ① 同生产单已审核采购订单明细:模具编号+颜色命中;多候选(同模具同颜色的左右件等)取剩余可收最大、
    //    并列取 ID 最小——剩余按 全部非备品入仓行(含未审核)扣减,分次送货在多候选间自然轮转;
    //    (此处不是核销口径,核销只算已审核,见 PlasticPurchaseOrderService.ReceiptJoinSql)
    // ② 回落 塑胶物料资料:工模编号+颜色,再放宽仅工模编号,取 ID 最小;
    // ③ 都未命中返回 null → PaijiMapper 回落旧口径(物料编号=货号,物料名称=part_name)。
    private static async Task<PaijiMapper.Paiji物料匹配?> 解析物料Async(
        System.Data.IDbConnection c, PaijiWarehouseInRow r)
    {
        if (!string.IsNullOrWhiteSpace(r.OrderNo) && !string.IsNullOrWhiteSpace(r.PartName))
        {
            var po = await c.QueryFirstOrDefaultAsync<PaijiMapper.Paiji物料匹配?>(@"
SELECT TOP 1 d.[物料编号], d.[物料名称]
FROM [塑胶采购订单明细] d
JOIN [塑胶采购订单] o ON o.[单号] = d.[单号] AND ISNULL(o.[审核],'0') = '1'
LEFT JOIN (
    SELECT x.[生产单号], x.[订单单号], x.[物料编号], ISNULL(x.[颜色],'') AS 颜色键, SUM(x.[数量]) AS 入仓数量
    FROM [塑胶入仓明细单] x
    WHERE ISNULL(x.[备品],'0') <> '1'
    GROUP BY x.[生产单号], x.[订单单号], x.[物料编号], ISNULL(x.[颜色],'')
) rk ON rk.[物料编号] = d.[物料编号] AND rk.[颜色键] = ISNULL(d.[颜色],'')
   AND ( rk.[订单单号] = d.[单号]
      OR (rk.[订单单号] IS NULL AND rk.[生产单号] IS NOT NULL AND rk.[生产单号] = d.[生产单号]) )
WHERE d.[生产单号] = @生产单号 AND d.[模具编号] = @模具编号 AND ISNULL(d.[颜色],'') = ISNULL(@颜色,'')
ORDER BY d.[数量] - ISNULL(rk.[入仓数量],0) DESC, d.[ID]",
                new { 生产单号 = r.OrderNo, 模具编号 = r.PartName, 颜色 = r.Color });
            if (po is not null) return po;
        }

        if (!string.IsNullOrWhiteSpace(r.PartName))
        {
            var m = await c.QueryFirstOrDefaultAsync<PaijiMapper.Paiji物料匹配?>(@"
SELECT TOP 1 [物料编号], [物料名称] FROM [塑胶物料资料]
WHERE [工模编号] = @模具编号 AND ISNULL([颜色],'') = ISNULL(@颜色,'')
ORDER BY [ID]", new { 模具编号 = r.PartName, 颜色 = r.Color });
            m ??= await c.QueryFirstOrDefaultAsync<PaijiMapper.Paiji物料匹配?>(@"
SELECT TOP 1 [物料编号], [物料名称] FROM [塑胶物料资料]
WHERE [工模编号] = @模具编号 ORDER BY [ID]", new { 模具编号 = r.PartName });
            if (m is not null) return m;
        }
        return null;
    }
}
