using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using SprayPlan.Api.Data;

namespace SprayPlan.Api.Features.Products;

public record ProductFactoryMoveRequest(List<int>? Ids, string TargetFactoryId, bool Preview = true, string? PreviewToken = null);
public record ProductFactoryMoveItem(int Id, string ProductNo, bool CanMove, List<string> Reasons);

[ApiController]
[Route("api/products/factory-move")]
[Authorize(Roles = "admin")]
public class ProductFactoryMovesController(AppDbContext db, ILogger<ProductFactoryMovesController> logger) : ControllerBase
{
    [HttpPost]
    public async Task<IActionResult> Move(ProductFactoryMoveRequest request)
    {
        if (request.Ids is not { Count: > 0 and <= 500 } || request.Ids.Any(id => id <= 0) || request.Ids.Distinct().Count() != request.Ids.Count)
            return BadRequest(new { error = "请勾选 1 至 500 个不同产品" });
        var source = db.CurrentFactoryId;
        var target = request.TargetFactoryId;
        if (target is not ("XINGXIN" or "HUADENG") || target == source)
            return BadRequest(new { error = "目标厂区必须与当前厂区不同" });
        try
        {
            await using var transaction = await db.Database.BeginTransactionAsync();
            var products = await db.Products.AsNoTracking().Include(p => p.Parts).Where(p => request.Ids.Contains(p.Id)).OrderBy(p => p.Id).ToListAsync();
            if (products.Count != request.Ids.Count) return Conflict(new { error = "部分产品已不在当前厂区，请刷新列表重新选择。本批未修改" });
            var numbers = products.Select(p => p.ProductNo).ToList();
            var collisions = await db.Products.IgnoreQueryFilters().Where(p => p.FactoryId == target && numbers.Contains(p.ProductNo)).Select(p => p.ProductNo).ToListAsync();
            var partIds = products.SelectMany(p => p.Parts.Select(part => part.Id)).ToList();
            var orders = await db.Orders.IgnoreQueryFilters().Where(o => o.ProductId != null && request.Ids.Contains(o.ProductId.Value)).Select(o => o.ProductId!.Value).ToListAsync();
            var quantities = await db.OrderPartQtys.IgnoreQueryFilters().Where(q => q.SourcePartId != null && partIds.Contains(q.SourcePartId.Value)).Select(q => q.SourcePartId!.Value).ToListAsync();
            var plans = await db.ProductionPlans.IgnoreQueryFilters().Where(p => p.SourcePartId != null && partIds.Contains(p.SourcePartId.Value)).Select(p => p.SourcePartId!.Value).ToListAsync();
            var stock = await db.InventoryMoves.IgnoreQueryFilters().Where(m => request.Ids.Contains(m.ProductId)).Select(m => m.ProductId).ToListAsync();
            var inbound = await db.InboundApplications.IgnoreQueryFilters().Where(a => a.FactoryId == source && numbers.Contains(a.ProductNo)).Select(a => a.ProductNo).ToListAsync();
            var items = products.Select(p => {
                var ids = p.Parts.Select(part => part.Id).ToHashSet();
                var reasons = new List<string>();
                if (collisions.Contains(p.ProductNo)) reasons.Add("目标厂区已有同货号（含回收站），请先核对，不能覆盖");
                var orderCount = orders.Count(id => id == p.Id); var qtyCount = quantities.Count(ids.Contains);
                var planCount = plans.Count(ids.Contains); var stockCount = stock.Count(id => id == p.Id);
                if (orderCount > 0) reasons.Add($"已关联 {orderCount} 张订单");
                if (qtyCount > 0) reasons.Add($"已有 {qtyCount} 条订单部位引用");
                if (planCount > 0) reasons.Add($"已有 {planCount} 条排期部位引用（含历史记录）");
                if (stockCount > 0) reasons.Add($"已有 {stockCount} 条库存流水");
                var inboundCount = inbound.Count(no => no == p.ProductNo);
                if (inboundCount > 0) reasons.Add($"已有 {inboundCount} 条入库申请");
                return new ProductFactoryMoveItem(p.Id, p.ProductNo, reasons.Count == 0, reasons);
            }).ToList();
            var token = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new {
                source, target, products = products.Select(p => new { p.Id, p.ProductNo, p.Status, p.IterationNo, p.Remark, p.EffectiveDate, p.CreatedBy, p.CreatedAt, p.UpdatedAt, p.LastUpdatedBy,
                    parts = p.Parts.OrderBy(part => part.Id).Select(part => new { part.Id, part.PartName, part.PartOrder, part.PartGroupId, part.UnitCost, part.LaborPrice, part.PaintCost, part.QuotedPrice, part.Craft, part.CraftDetail, part.DailyCapacity, part.ProductionMode, part.StdMachineCount, part.IsTumbler, part.CraftPasses, part.Remark }) }), items
            }))));
            var canSave = items.All(i => i.CanMove);
            if (request.Preview) return Ok(new { sourceFactoryId = source, targetFactoryId = target, items, canSave, previewToken = token });
            if (!canSave) return Conflict(new { error = "部分产品存在冲突或历史引用，本批未修改，请取消勾选这些产品后重新检查", items });
            if (request.PreviewToken != token) return Conflict(new { error = "核价表或厂区归属已变化，请重新检查后再确认。本批未修改" });
            var now = DateTime.UtcNow;
            var username = User.FindFirst("username")?.Value ?? "unknown";
            // 唯一允许跨厂修改产品归属的入口：管理员、当前厂区范围、预览版本及历史引用均已验证。
            var count = await db.Products.Where(p => request.Ids.Contains(p.Id) && p.FactoryId == source)
                .ExecuteUpdateAsync(set => set.SetProperty(p => p.FactoryId, target).SetProperty(p => p.LastUpdatedBy, username).SetProperty(p => p.UpdatedAt, now));
            if (count != request.Ids.Count) return Conflict(new { error = "产品归属已变化，本批未修改，请重新检查" });
            await transaction.CommitAsync();
            logger.LogInformation("Product factory move by {User}: {Source} -> {Target}; IDs {Ids}", username, source, target, string.Join(",", request.Ids));
            return Ok(new { moved = count, sourceFactoryId = source, targetFactoryId = target });
        }
        catch (SqliteException e) when (e.SqliteErrorCode is 5 or 6 or 19)
        { return Conflict(new { error = "数据正在更新或目标货号已存在，本批未修改，请重新检查" }); }
    }
}
