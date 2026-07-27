using Microsoft.EntityFrameworkCore;
using StitchCostPro.Api.Entities;
using StitchCostPro.Api.Shared;

namespace StitchCostPro.Api.Features.QualityInspections;

public record DefectUpsert(string DefectType, decimal? Qty);
public record QualityUpsert(
    int OrderId, int LineId, DateOnly ReceivedDate, DateOnly? CheckDate,
    string? MaNo, string? DeliveryNo, decimal? ReceivedQty, decimal? QcQty, decimal? StockInQty,
    string? AbGroup, string? Inspector, string? Rectification, string? Remark,
    List<DefectUpsert> Defects);

public record DefectDto(int DefectId, string DefectType, decimal? Qty, decimal? Rate);  // Rate=数量÷质检

// 一行 = 一次回货的一个款。InspectMode/InspectRatio/AvgDefectRate/MainDefect 均算出
public record QualityRow(
    int InspectionId, int OrderId, string OrderNo, int SupplierId, string SupplierName,
    int? LineId, int ProductId, string SeriesCode, string ProductName, DateOnly ReceivedDate, DateOnly? CheckDate,
    string? MaNo, string? DeliveryNo, decimal? ReceivedQty, decimal? QcQty, decimal? StockInQty,
    string InspectMode, decimal? InspectRatio, string? AbGroup, string? Inspector,
    decimal? AvgDefectRate, string? MainDefect, string? Rectification, string? Remark,
    List<DefectDto> Defects);

// 选订单后供"货号→款式"二级下拉
public record OrderLineOptionDto(int LineId, int ProductId, string SeriesCode, string? StyleNo, string ProductName,
    decimal? Qty);

// 加工厂品质汇总：一行一加工厂；本期/上期次品率、趋势(百分点)、QC评分
public record QualitySummaryRow(
    int SupplierId, string SupplierName, string DeptName, int RecordCount,
    decimal TotalQty, decimal TotalDefect, decimal? DefectRatio,
    decimal? CurRate, decimal? PrevRate, decimal? TrendPp, string Grade);

/// <summary>品质验货：录入即关联订单/款/加工厂；抽检全检、检验比例、占比、平均次品率、主要质量短板全算不存。</summary>
public class QualityInspectionService(AppDbContext db, ICurrentUser current)
{
    // 质检 < 收货 → 抽检；质检 = 收货 → 全检（任一为空按"抽检"显示）
    private static string InspectMode(decimal? receivedQty, decimal? qcQty)
        => (qcQty is not null && receivedQty is not null && qcQty >= receivedQty) ? "全检" : "抽检";
    // 检验比例 = 质检 ÷ 收货
    private static decimal? Ratio(decimal? qcQty, decimal? receivedQty)
        => receivedQty is > 0 ? Math.Round((qcQty ?? 0) / receivedQty.Value, 4) : null;
    // 单项不良占比 = 数量 ÷ 质检
    private static decimal? DefRate(decimal? qty, decimal? qcQty)
        => qcQty is > 0 ? Math.Round((qty ?? 0) / qcQty.Value, 4) : null;

    public async Task<List<QualityRow>> ListAsync(int? supplierId, string? keyword)
    {
        var rows = await BuildRowsAsync(q =>
        {
            if (supplierId is not null) q = q.Where(x => x.SupplierId == supplierId);
            return q.OrderByDescending(x => x.InspectionId);
        });
        if (!string.IsNullOrWhiteSpace(keyword))
        {
            var k = keyword.Trim();
            rows = rows.Where(r => r.SupplierName.Contains(k) || r.SeriesCode.Contains(k) || r.ProductName.Contains(k)).ToList();
        }
        return rows;
    }

    public async Task<QualityRow?> GetAsync(int id)
        => (await BuildRowsAsync(q => q.Where(x => x.InspectionId == id))).FirstOrDefault();

    /// <summary>选了订单后，列出该订单涉及的款（供 货号→款式 下拉）。</summary>
    public async Task<List<OrderLineOptionDto>> GetOrderLinesAsync(int orderId)
    {
        return await (from l in db.PurchaseOrderLines.AsNoTracking()
            join p in db.Products.AsNoTracking() on l.ProductId equals p.ProductId
            where l.OrderId == orderId
            orderby l.LineId
            select new OrderLineOptionDto(l.LineId, l.ProductId, p.SeriesCode ?? p.ProductCode, p.StyleNo,
                p.ProductName, l.Qty)).ToListAsync();
    }

    public async Task<(int id, string? error)> CreateAsync(QualityUpsert req)
    {
        var order = await db.PurchaseOrders.FindAsync(req.OrderId);
        if (order is null) return (0, "采购订单不存在");
        if (order.Status == "待核价") return (0, "订单尚未完成外发核价，不能验货入库");
        var line = await db.PurchaseOrderLines.AsNoTracking().FirstOrDefaultAsync(l => l.LineId == req.LineId && l.OrderId == req.OrderId);
        if (line is null) return (0, "所选款式不属于该订单");
        var validation = await ValidateAsync(req, line, null);
        if (validation is not null) return (0, validation);

        var qi = new QualityInspection
        {
            OrderId = req.OrderId,
            LineId = line.LineId,
            ProductId = line.ProductId,
            SupplierId = order.SupplierId,                 // 加工厂从订单带出快照
            ReceivedDate = req.ReceivedDate,
            CheckDate = req.CheckDate,
            MaNo = req.MaNo,
            DeliveryNo = req.DeliveryNo,
            ReceivedQty = req.ReceivedQty,
            QcQty = req.QcQty,
            StockInQty = req.StockInQty,
            AbGroup = req.AbGroup,
            Inspector = req.Inspector,
            Rectification = req.Rectification,
            Remark = req.Remark,
            CreatedBy = current.UserId,
            CreatedAt = DateTime.UtcNow,
        };
        db.QualityInspections.Add(qi);
        await db.SaveChangesAsync();
        await SaveDefectsAsync(qi.InspectionId, req.Defects);
        await RecalcOrderAsync(qi.OrderId);                    // 订单进度/状态/延期改由品质收货数量驱动
        return (qi.InspectionId, null);
    }

    public async Task<(bool ok, string? error)> UpdateAsync(int id, QualityUpsert req)
    {
        var qi = await db.QualityInspections.FindAsync(id);
        if (qi is null) return (false, "记录不存在");
        var oldOrderId = qi.OrderId;
        var order = await db.PurchaseOrders.FindAsync(req.OrderId);
        if (order is null) return (false, "采购订单不存在");
        if (order.Status == "待核价") return (false, "订单尚未完成外发核价，不能验货入库");
        var line = await db.PurchaseOrderLines.AsNoTracking().FirstOrDefaultAsync(l => l.LineId == req.LineId && l.OrderId == req.OrderId);
        if (line is null) return (false, "所选款式不属于该订单");
        var validation = await ValidateAsync(req, line, id);
        if (validation is not null) return (false, validation);

        qi.OrderId = req.OrderId;
        qi.LineId = line.LineId;
        qi.ProductId = line.ProductId;
        qi.SupplierId = order.SupplierId;
        qi.ReceivedDate = req.ReceivedDate;
        qi.CheckDate = req.CheckDate;
        qi.MaNo = req.MaNo;
        qi.DeliveryNo = req.DeliveryNo;
        qi.ReceivedQty = req.ReceivedQty;
        qi.QcQty = req.QcQty;
        qi.StockInQty = req.StockInQty;
        qi.AbGroup = req.AbGroup;
        qi.Inspector = req.Inspector;
        qi.Rectification = req.Rectification;
        qi.Remark = req.Remark;
        qi.UpdatedBy = current.UserId;
        qi.UpdatedAt = DateTime.UtcNow;

        // 不良类型替换式：删旧重插
        db.QualityDefects.RemoveRange(db.QualityDefects.Where(d => d.InspectionId == id));
        await db.SaveChangesAsync();
        await SaveDefectsAsync(id, req.Defects);
        await RecalcOrderAsync(req.OrderId);
        if (oldOrderId != req.OrderId) await RecalcOrderAsync(oldOrderId);   // 改了订单则两单都重算
        return (true, null);
    }

    public async Task<(bool ok, string? error)> DeleteAsync(int id)
    {
        var qi = await db.QualityInspections.FindAsync(id);
        if (qi is null) return (false, "记录不存在");
        var oldOrderId = qi.OrderId;
        db.QualityDefects.RemoveRange(db.QualityDefects.Where(d => d.InspectionId == id));
        db.QualityInspections.Remove(qi);
        await db.SaveChangesAsync();
        await RecalcOrderAsync(oldOrderId);
        return (true, null);
    }

    private async Task SaveDefectsAsync(int inspectionId, List<DefectUpsert>? defects)
    {
        foreach (var d in (defects ?? new()).Where(d => !string.IsNullOrWhiteSpace(d.DefectType)))
            db.QualityDefects.Add(new QualityDefect { InspectionId = inspectionId, DefectType = d.DefectType.Trim(), Qty = d.Qty });
        await db.SaveChangesAsync();
    }

    private async Task<string?> ValidateAsync(QualityUpsert req, PurchaseOrderLine line, int? excludingId)
    {
        if (req.ReceivedQty is < 0 || req.QcQty is < 0 || req.StockInQty is < 0) return "数量不能小于 0";
        if (req.ReceivedQty is not null && req.QcQty > req.ReceivedQty) return "质检数量不能大于收货数量";
        if (req.ReceivedQty is not null && req.StockInQty > req.ReceivedQty) return "验货后入库数不能大于收货数量";
        if ((req.Defects ?? []).Any(d => d.Qty is < 0 || (req.QcQty is not null && d.Qty > req.QcQty)))
            return "不良数量不能小于 0，也不能大于质检数量";
        var prior = await db.QualityInspections.AsNoTracking()
            .Where(x => x.LineId == line.LineId && (excludingId == null || x.InspectionId != excludingId.Value))
            .SumAsync(x => x.StockInQty ?? 0);
        if (line.Qty is not null && prior + (req.StockInQty ?? 0) > line.Qty.Value)
            return $"该款式累计入库数不能超过下单数 {line.Qty.Value:0.##}";
        return null;
    }

    /// <summary>订单进度/状态/延期：只由验货后入库数量驱动（总入库量 ÷ 订单总数量）。</summary>
    private async Task RecalcOrderAsync(int orderId)
    {
        var order = await db.PurchaseOrders.FindAsync(orderId);
        if (order is null) return;
        var totalQty = await db.PurchaseOrderLines.Where(l => l.OrderId == orderId).SumAsync(l => l.Qty ?? 0);
        var received = await db.QualityInspections.Where(x => x.OrderId == orderId).SumAsync(x => x.StockInQty ?? 0);
        var pct = totalQty <= 0 ? 0m : Math.Round(received / totalQty * 100, 0, MidpointRounding.AwayFromZero);
        var progress = (int)Math.Min(100m, Math.Max(0m, pct));
        order.ProductionProgress = progress;
        if (order.Status != "待核价")
            order.Status = progress <= 0 ? "已下单" : progress >= 100 ? "已交货" : "生产中";
        var delay = 0;
        if (progress >= 100 && order.DeliveryDate is DateOnly dd)
        {
            var lastReceived = await db.QualityInspections.Where(x => x.OrderId == orderId).MaxAsync(x => (DateOnly?)x.ReceivedDate);
            if (lastReceived is DateOnly lr) delay = Math.Max(0, lr.DayNumber - dd.DayNumber);
        }
        order.DelayDays = delay;
        order.UpdatedBy = current.UserId;
        order.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
    }

    // 把明细 + 子表 + 关联(订单/款/加工厂)组装成 DTO，并算出抽检全检/比例/平均次品率/主要短板
    private async Task<List<QualityRow>> BuildRowsAsync(Func<IQueryable<QualityInspection>, IQueryable<QualityInspection>> shape)
    {
        var items = await shape(db.QualityInspections.AsNoTracking()).ToListAsync();
        if (items.Count == 0) return new();

        var ids = items.Select(x => x.InspectionId).ToList();
        var defects = await db.QualityDefects.AsNoTracking().Where(d => ids.Contains(d.InspectionId)).ToListAsync();
        var orderIds = items.Select(x => x.OrderId).Distinct().ToList();
        var supIds = items.Select(x => x.SupplierId).Distinct().ToList();
        var prodIds = items.Select(x => x.ProductId).Distinct().ToList();
        var lineIds = items.Where(x => x.LineId is not null).Select(x => x.LineId!.Value).Distinct().ToList();
        var orders = await db.PurchaseOrders.AsNoTracking().Where(o => orderIds.Contains(o.OrderId))
            .ToDictionaryAsync(o => o.OrderId, o => o.OrderNo);
        var sups = await db.Suppliers.AsNoTracking().Where(s => supIds.Contains(s.SupplierId))
            .ToDictionaryAsync(s => s.SupplierId, s => s.SupplierName);
        var prods = (await db.Products.AsNoTracking().Where(p => prodIds.Contains(p.ProductId))
            .Select(p => new { p.ProductId, p.SeriesCode, p.ProductCode, p.ProductName }).ToListAsync())
            .ToDictionary(p => p.ProductId);

        return items.Select(x =>
        {
            var ds = defects.Where(d => d.InspectionId == x.InspectionId).ToList();
            var defectDtos = ds.Select(d => new DefectDto(d.DefectId, d.DefectType, d.Qty, DefRate(d.Qty, x.QcQty))).ToList();

            // 平均次品率 = 有数量的不良类型占比之和 ÷ 不良类型数
            var bad = ds.Where(d => (d.Qty ?? 0) > 0).ToList();
            decimal? avg = (bad.Count > 0 && x.QcQty is > 0)
                ? Math.Round(bad.Sum(d => (d.Qty ?? 0) / x.QcQty!.Value) / bad.Count, 4)
                : null;
            // 主要质量短板 = 数量最大的不良类型
            var main = bad.OrderByDescending(d => d.Qty ?? 0).FirstOrDefault()?.DefectType;

            var prod = prods.GetValueOrDefault(x.ProductId);
            return new QualityRow(
                x.InspectionId, x.OrderId, orders.GetValueOrDefault(x.OrderId, ""), x.SupplierId,
                sups.GetValueOrDefault(x.SupplierId, ""), x.LineId, x.ProductId,
                prod is null ? "" : (prod.SeriesCode ?? prod.ProductCode), prod?.ProductName ?? "",
                x.ReceivedDate, x.CheckDate, x.MaNo, x.DeliveryNo, x.ReceivedQty, x.QcQty, x.StockInQty,
                InspectMode(x.ReceivedQty, x.QcQty), Ratio(x.QcQty, x.ReceivedQty), x.AbGroup, x.Inspector,
                avg, main, x.Rectification, x.Remark, defectDtos);
        }).ToList();
    }

    /// <summary>加工厂品质汇总：本期[from,to] 按加工厂滚动 + 上期(紧邻前一等长区间)对比。</summary>
    public async Task<List<QualitySummaryRow>> SummaryAsync(int? deptId, DateOnly from, DateOnly to)
    {
        var span = to.DayNumber - from.DayNumber;            // 区间天数
        var prevTo = from.AddDays(-1);
        var prevFrom = prevTo.AddDays(-span);

        var cur = await AggregateAsync(deptId, from, to);
        var prevMap = (await AggregateAsync(deptId, prevFrom, prevTo)).ToDictionary(x => x.SupplierId, x => x.CurRate);

        return cur.Select(c =>
        {
            decimal? prevRate = prevMap.TryGetValue(c.SupplierId, out var pr) ? pr : null;
            // 趋势 = 本期 − 上期，单位百分点（×100）
            decimal? trend = (c.CurRate is not null && prevRate is not null)
                ? Math.Round((c.CurRate.Value - prevRate.Value) * 100, 1) : null;
            // QC评分按本期次品率
            var grade = c.CurRate is null ? "—"
                : c.CurRate < 0.10m ? "优秀"
                : c.CurRate < 0.30m ? "良好"
                : c.CurRate < 0.50m ? "差" : "极差";
            return new QualitySummaryRow(c.SupplierId, c.SupplierName, c.DeptName, c.RecordCount,
                c.TotalQty, c.TotalDefect, c.DefectRatio, c.CurRate, prevRate, trend, grade);
        }).OrderByDescending(r => r.CurRate ?? -1).ToList();
    }

    // 某区间内按加工厂聚合：记录条数/总数量/总不良数/不良占比/本期次品率
    private async Task<List<QualitySummaryRow>> AggregateAsync(int? deptId, DateOnly from, DateOnly to)
    {
        var items = await db.QualityInspections.AsNoTracking()
            .Where(x => x.ReceivedDate >= from && x.ReceivedDate <= to).ToListAsync();
        if (deptId is not null)
        {
            var inDept = await db.Suppliers.AsNoTracking().Where(s => s.DeptId == deptId).Select(s => s.SupplierId).ToListAsync();
            items = items.Where(x => inDept.Contains(x.SupplierId)).ToList();
        }
        if (items.Count == 0) return new();

        var ids = items.Select(x => x.InspectionId).ToList();
        var defects = await db.QualityDefects.AsNoTracking().Where(d => ids.Contains(d.InspectionId)).ToListAsync();
        var supIds = items.Select(x => x.SupplierId).Distinct().ToList();
        var sups = await db.Suppliers.AsNoTracking().Where(s => supIds.Contains(s.SupplierId)).ToListAsync();
        var depts = await db.Depts.AsNoTracking().ToDictionaryAsync(d => d.DeptId, d => d.DeptName);

        // 单条明细次品率 = 各不良类型占比的算术平均；有质检但无不良 = 0；无质检 = null(不计入)
        decimal? RowRate(QualityInspection x)
        {
            if (x.QcQty is not > 0) return null;
            var ds = defects.Where(d => d.InspectionId == x.InspectionId && (d.Qty ?? 0) > 0).ToList();
            return ds.Count == 0 ? 0m : Math.Round(ds.Sum(d => (d.Qty ?? 0) / x.QcQty!.Value) / ds.Count, 4);
        }
        decimal RowDefect(QualityInspection x) => defects.Where(d => d.InspectionId == x.InspectionId).Sum(d => d.Qty ?? 0);

        return items.GroupBy(x => x.SupplierId).Select(g =>
        {
            var sup = sups.FirstOrDefault(s => s.SupplierId == g.Key);
            var totalQty = g.Sum(x => x.ReceivedQty ?? 0);
            var totalDefect = g.Sum(RowDefect);
            decimal? defectRatio = totalQty > 0 ? Math.Round(totalDefect / totalQty, 4) : null;
            var rates = g.Select(RowRate).Where(r => r is not null).Select(r => r!.Value).ToList();
            decimal? rate = rates.Count > 0 ? Math.Round(rates.Average(), 4) : null;
            return new QualitySummaryRow(g.Key, sup?.SupplierName ?? "", sup is null ? "" : depts.GetValueOrDefault(sup.DeptId, ""),
                g.Count(), totalQty, totalDefect, defectRatio, rate, null, null, "");
        }).ToList();
    }
}
