using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using SprayPlan.Api.Data;
using SprayPlan.Api.Entities;
using SprayPlan.Api.Services;

namespace SprayPlan.Api.Features.Plans;

public record WorkbenchAddition(int ClientId, int OrderPartQtyId, int StepNo, string OptionToken, WorkbenchValues Values);
public record WorkbenchOption(int OrderId, int OrderPartQtyId, int? SourcePartId, string OrderNo, string ProductNo,
    string PartName, int StepNo, string Craft, long Demand, long Remaining, string Token,
    WorkbenchBalance? Balance = null, List<WorkbenchAllocationSource>? AllocationSources = null);

public static class WorkbenchOptions
{
    public static async Task<List<WorkbenchOption>> Load(AppDbContext db, int? orderId = null, List<int>? qtyIds = null)
    {
        var query = db.Orders.AsNoTracking().Where(o => o.ProductId != null && !o.PendingProduct &&
            (o.Status == "draft" || o.Status == "received" || o.Status == "scheduled" || o.Status == "in_production"));
        if (orderId.HasValue) query = query.Where(o => o.Id == orderId);
        if (qtyIds != null) query = query.Where(o => o.PartQtys.Any(q => qtyIds.Contains(q.Id)));
        var orders = await query.AsSplitQuery().Include(o => o.Product).Include(o => o.PartQtys)
            .Include(o => o.Plans.Where(p => p.DeletedAt == null)).OrderByDescending(o => o.Id).ToListAsync();
        var anchors = orders.SelectMany(o => o.PartQtys).Where(q => q.SourcePartId.HasValue).Select(q => q.SourcePartId!.Value).Distinct().ToList();
        var productIds = await db.ProductParts.Where(p => anchors.Contains(p.Id)).Select(p => p.ProductId).Distinct().ToListAsync();
        var parts = await db.ProductParts.AsNoTracking().Where(p => productIds.Contains(p.ProductId)).ToListAsync();
        var planIds = orders.SelectMany(o => o.Plans.Select(p => p.Id)).ToList();
        var inbound = (await db.InboundApplications.Where(a => planIds.Contains(a.SourcePlanId)).Select(a => a.SourcePlanId).ToListAsync()).ToHashSet();
        var result = new List<WorkbenchOption>();
        foreach (var order in orders)
        foreach (var qty in order.PartQtys.Where(q => qtyIds == null || qtyIds.Contains(q.Id)))
        {
            var anchor = parts.FirstOrDefault(p => p.Id == qty.SourcePartId);
            if (anchor == null) continue; // 待补产品或缺少部位工艺时，先完成基础资料。
            var group = PartProcessRules.SameLogicalPart(parts, anchor);
            var passes = PartProcessRules.ExpandPasses(group);
            var demand = order.PartQtys.Where(q => q.PartName == qty.PartName).Sum(q => (long)q.Qty);
            foreach (var pass in passes.Where(p => p.Craft is "手喷" or "自动喷" or "移印" or "UV"))
            {
                var total = order.Plans.Where(p => p.PartName == qty.PartName && p.StepNo == pass.StepNo)
                    .Sum(p => (long)(PlanDateRules.HasActuals(p) ? p.GoodQty ?? p.ReportedQty ?? p.PlannedQty : p.PlannedQty));
                var remaining = Math.Max(0, demand - total);
                var stage = order.Plans.Where(p => p.PartName == qty.PartName && p.StepNo == pass.StepNo).ToList();
                var produced = stage.Where(PlanDateRules.HasActuals).Sum(p => (long)(p.GoodQty ?? p.ReportedQty ?? p.PlannedQty));
                var planned = stage.Where(p => !PlanDateRules.HasActuals(p)).Sum(p => (long)p.PlannedQty);
                var balance = new WorkbenchBalance(order.Id, qty.PartName, pass.StepNo, demand, produced, planned, remaining,
                    stage.Count(p => PlanDateRules.HasActuals(p) && p.GoodQty == null));
                var sources = stage.Where(p => !PlanDateRules.HasActuals(p)).OrderBy(p => p.Id).Select(p => new WorkbenchAllocationSource(p.Id, order.Id,
                    p.PartName, p.StepNo, ScheduleCalc.Ymd(p.PlanDate), p.PlannedQty, !inbound.Contains(p.Id))).ToList();
                var token = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new {
                    orderId = order.Id, order.Status, order.UpdatedAt, qtyId = qty.Id, qty.PartName, qty.SourcePartId, demand, remaining,
                    pass.StepNo, pass.Craft, definitions = group.OrderBy(p => p.Id).Select(p => new { p.Id, p.Craft, p.CraftPasses, p.PartGroupId })
                }))));
                result.Add(new(order.Id, qty.Id, qty.SourcePartId, order.ExternalOrderNo, order.Product!.ProductNo,
                    qty.PartName, pass.StepNo, pass.Craft, demand, remaining, token, balance, sources));
            }
        }
        return result;
    }
}
