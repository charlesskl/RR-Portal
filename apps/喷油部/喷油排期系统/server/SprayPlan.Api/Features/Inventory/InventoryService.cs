using Microsoft.EntityFrameworkCore;
using SprayPlan.Api.Data;
using SprayPlan.Api.Services;

namespace SprayPlan.Api.Features.Inventory;

// 库存聚合查询：在 (款号·子件·部位) 键上，把实绩累计良品与流水叠加成"成品在库/散件可用"。
public class InventoryService(AppDbContext db)
{
    public async Task<List<InventoryRow>> Query(int? productId, string? itemName, string? partName)
    {
        // 1) 实绩累计良品：plan→order 取 productId；只算未软删、已录良品的行（带员工报数，算车间存数用）
        var goods = await db.ProductionPlans
            .Where(p => p.DeletedAt == null && p.GoodQty != null)
            .Join(db.Orders.Where(o => o.ProductId != null), p => p.OrderId, o => o.Id, (p, o) => new { ProductId = o.ProductId!.Value, p.ItemName, p.PartName, Good = p.GoodQty!.Value, Reported = p.ReportedQty })
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
            var cumGood = keyGoods.Sum(g => g.Good);
            // 车间存数 = Σ员工报数 − Σ入库数(良品)，按本键聚合（复用 RecordingCalc，避免公式分叉）
            var workshopStock = RecordingCalc.WorkshopStock(
                keyGoods.Select(g => g.Reported), keyGoods.Select(g => (int?)g.Good));

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
                InventoryCalc.FinishedInStock(cumGood, ownerDeltas),
                workshopStock,
                InventoryCalc.LooseAvailable(looseDeltas));
        });

        if (productId is not null) rows = rows.Where(r => r.ProductId == productId);
        if (!string.IsNullOrEmpty(itemName)) rows = rows.Where(r => r.ItemName == itemName);
        if (!string.IsNullOrEmpty(partName)) rows = rows.Where(r => r.PartName == partName);
        return rows.OrderBy(r => r.ProductNo).ThenBy(r => r.ItemName).ThenBy(r => r.PartName).ToList();
    }
}
