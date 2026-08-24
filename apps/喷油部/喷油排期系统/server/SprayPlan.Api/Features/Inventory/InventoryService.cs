using Microsoft.EntityFrameworkCore;
using SprayPlan.Api.Data;
using SprayPlan.Api.Services;

namespace SprayPlan.Api.Features.Inventory;

// 库存聚合查询：按订单排期步骤计算工序半成品、最后工序车间存数和成品库存。
public class InventoryService(AppDbContext db)
{
    public async Task<List<InventoryRow>> Query(int? productId, string? itemName, string? partName)
    {
        // 1) 实绩：同订单、同部位、同 StepNo 的多日实绩先累计；StepNo 表示当前排期中的工序顺序。
        var goods = await db.ProductionPlans
            .Where(p => p.DeletedAt == null && p.GoodQty != null)
            .Join(db.Orders.Where(o => o.ProductId != null), p => p.OrderId, o => o.Id, (p, o) => new { ProductId = o.ProductId!.Value, p.OrderId, p.ItemName, p.PartName, p.StepNo, Good = p.GoodQty!.Value, Inbound = p.InboundQty ?? 0 })
            .ToListAsync();

        // 2) 流水：owner 非空=成品出账，owner=NULL=散件
        var moves = await db.InventoryMoves
            .Select(m => new { m.ProductId, m.ItemName, m.PartName, m.Delta, IsLoose = m.OwnerOrderId == null })
            .ToListAsync();

        // 3) 在键上聚合
        var keys = goods.Select(g => (g.ProductId, g.ItemName, g.PartName))
            .Concat(moves.Select(m => (m.ProductId, m.ItemName, m.PartName)))
            .Distinct();

        var products = await db.Products.ToDictionaryAsync(p => p.Id, p => p);

        var rows = keys.Select(k =>
        {
            var keyGoods = goods.Where(g => g.ProductId == k.ProductId && g.ItemName == k.ItemName && g.PartName == k.PartName).ToList();
            var orderStocks = keyGoods.GroupBy(g => g.OrderId).Select(order =>
            {
                var steps = order.GroupBy(g => g.StepNo)
                    .OrderBy(step => step.Key)
                    .Select(step => new { Good = step.Sum(g => g.Good), Inbound = step.Sum(g => g.Inbound) })
                    .ToList();
                var finalStep = steps.LastOrDefault();
                return new
                {
                    FinishedInbound = finalStep?.Inbound ?? 0,
                    Workshop = finalStep is null ? 0 : InventoryCalc.WorkshopStock(finalStep.Good, finalStep.Inbound),
                    ProcessLoose = InventoryCalc.ProcessLoose(steps.Select(step => step.Good))
                };
            }).ToList();
            var finishedInbound = orderStocks.Sum(x => x.FinishedInbound);
            var workshopStock = orderStocks.Sum(x => x.Workshop);
            var processLoose = orderStocks.Sum(x => x.ProcessLoose);

            // 成品出账流水（owner 非空）的 delta 序列 → 复用 InventoryCalc 公式，避免公式分叉
            var ownerDeltas = moves
                .Where(m => !m.IsLoose && m.ProductId == k.ProductId && m.ItemName == k.ItemName && m.PartName == k.PartName)
                .Select(m => m.Delta);

            // 散件流水（owner=NULL）的 delta 序列 → 复用 InventoryCalc 公式
            var looseDeltas = moves
                .Where(m => m.IsLoose && m.ProductId == k.ProductId && m.ItemName == k.ItemName && m.PartName == k.PartName)
                .Select(m => m.Delta);

            var prod = products.TryGetValue(k.ProductId, out var pr) ? pr : null;
            return new InventoryRow(
                k.ProductId, prod?.ProductNo ?? "?",
                k.ItemName, k.PartName,
                InventoryCalc.FinishedInStock(finishedInbound, ownerDeltas),
                workshopStock,
                processLoose + InventoryCalc.LooseAvailable(looseDeltas));
        });

        if (productId is not null) rows = rows.Where(r => r.ProductId == productId);
        if (!string.IsNullOrEmpty(itemName)) rows = rows.Where(r => r.ItemName == itemName);
        if (!string.IsNullOrEmpty(partName)) rows = rows.Where(r => r.PartName == partName);
        return rows.OrderBy(r => r.ProductNo).ThenBy(r => r.ItemName).ThenBy(r => r.PartName).ToList();
    }
}
