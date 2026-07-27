using Microsoft.EntityFrameworkCore;
using StitchCostPro.Api.Entities;
using StitchCostPro.Api.Shared;

namespace StitchCostPro.Api.Features.DeliveryNotes;

public record InspectionUpsert(int LineId, decimal? SendQty, decimal? InspectQty, decimal? DefectQty, decimal? ReturnQty, string? Remark);
public record DeliveryNoteUpsert(int OrderId, string NoteNo, DateOnly ReceivedDate, string? Remark, List<InspectionUpsert> Items);

// 抽检明细行：DefectRate=不良÷抽检、ActualReceived=送货−退货，由后端算
public record InspectionDto(int InspectionId, int LineId, string ProductLabel,
    decimal? SendQty, decimal? InspectQty, decimal? DefectQty, decimal? ReturnQty,
    decimal? DefectRate, decimal ActualReceived, string? Remark);

// 回货批次：DelayDays=回货日−交付日(正延期/负提前/null无交付日)、DefectRate=本批Σ不良÷Σ抽检
public record DeliveryNoteDto(int DeliveryNoteId, int OrderId, string NoteNo, DateOnly ReceivedDate,
    int? DelayDays, decimal? DefectRate, string? Remark, List<InspectionDto> Items);

/// <summary>历史回货批次查询。订单进度统一由品质录入中的“验货后入库数”驱动。</summary>
public class DeliveryNoteService(AppDbContext db, ICurrentUser current)
{
    // 不良率 = 不良数 ÷ 抽检数（抽检为 0 或空则无意义，返回 null）
    private static decimal? DefectRate(decimal? inspect, decimal? defect)
        => inspect is > 0 ? Math.Round((defect ?? 0) / inspect.Value, 4) : null;
    // 实际交货 = 送货 − 退货
    private static decimal ActualReceived(decimal? send, decimal? ret) => (send ?? 0) - (ret ?? 0);

    public async Task<List<DeliveryNoteDto>> ListByOrderAsync(int orderId)
    {
        var order = await db.PurchaseOrders.AsNoTracking().FirstOrDefaultAsync(o => o.OrderId == orderId);
        var notes = await db.DeliveryNotes.AsNoTracking().Where(n => n.OrderId == orderId)
            .OrderByDescending(n => n.DeliveryNoteId).ToListAsync();
        return await BuildDtosAsync(notes, order?.DeliveryDate);
    }

    public async Task<DeliveryNoteDto?> GetAsync(int id)
    {
        var note = await db.DeliveryNotes.AsNoTracking().FirstOrDefaultAsync(n => n.DeliveryNoteId == id);
        if (note is null) return null;
        var delivery = await db.PurchaseOrders.AsNoTracking().Where(o => o.OrderId == note.OrderId)
            .Select(o => o.DeliveryDate).FirstOrDefaultAsync();
        return (await BuildDtosAsync(new List<DeliveryNote> { note }, delivery)).FirstOrDefault();
    }

    public async Task<(int id, string? error)> CreateAsync(DeliveryNoteUpsert req)
    {
        var order = await db.PurchaseOrders.FindAsync(req.OrderId);
        if (order is null) return (0, "采购订单不存在");
        var noteNo = req.NoteNo?.Trim();
        if (string.IsNullOrWhiteSpace(noteNo)) return (0, "请填送货单号");

        // 抽检行的 line 必须属于这张订单
        var orderLineIds = await db.PurchaseOrderLines.Where(l => l.OrderId == req.OrderId)
            .Select(l => l.LineId).ToListAsync();
        var items = (req.Items ?? new()).Where(i => i.LineId > 0 && orderLineIds.Contains(i.LineId)).ToList();
        if (items.Count == 0) return (0, "至少填一行抽检明细");

        var note = new DeliveryNote
        {
            OrderId = req.OrderId,
            NoteNo = noteNo,
            ReceivedDate = req.ReceivedDate,
            Remark = req.Remark,
            CreatedBy = current.UserId,
            CreatedAt = DateTime.UtcNow,
        };
        db.DeliveryNotes.Add(note);
        await db.SaveChangesAsync();

        foreach (var i in items)
            db.DeliveryInspections.Add(new DeliveryInspection
            {
                DeliveryNoteId = note.DeliveryNoteId,
                LineId = i.LineId,
                SendQty = i.SendQty,
                InspectQty = i.InspectQty,
                DefectQty = i.DefectQty,
                ReturnQty = i.ReturnQty,
                Remark = i.Remark,
            });
        await db.SaveChangesAsync();

        // 旧回货批次保留查询；订单进度已统一由品质录入中的“验货后入库数”计算。
        return (note.DeliveryNoteId, null);
    }

    public async Task<(bool ok, string? error)> DeleteAsync(int id)
    {
        var note = await db.DeliveryNotes.FindAsync(id);
        if (note is null) return (false, "回货批次不存在");
        db.DeliveryInspections.RemoveRange(db.DeliveryInspections.Where(x => x.DeliveryNoteId == id));
        db.DeliveryNotes.Remove(note);
        await db.SaveChangesAsync();
        return (true, null);
    }

    // 把批次 + 抽检明细组装成 DTO（带产品/工艺名、不良率、实际交货、批次交期）
    private async Task<List<DeliveryNoteDto>> BuildDtosAsync(List<DeliveryNote> notes, DateOnly? deliveryDate)
    {
        if (notes.Count == 0) return new();
        var noteIds = notes.Select(n => n.DeliveryNoteId).ToList();
        var insp = await db.DeliveryInspections.AsNoTracking().Where(i => noteIds.Contains(i.DeliveryNoteId)).ToListAsync();

        var lineIds = insp.Select(i => i.LineId).Distinct().ToList();
        var lines = await db.PurchaseOrderLines.AsNoTracking().Where(l => lineIds.Contains(l.LineId))
            .Select(l => new { l.LineId, l.ProductId }).ToListAsync();
        var prodIds = lines.Select(l => l.ProductId).Distinct().ToList();
        var prods = await db.Products.AsNoTracking().Where(p => prodIds.Contains(p.ProductId))
            .Select(p => new { p.ProductId, p.SeriesCode, p.ProductCode, p.StyleNo, p.ProductName }).ToListAsync();

        string LineLabel(int lineId)
        {
            var l = lines.FirstOrDefault(x => x.LineId == lineId);
            if (l is null) return $"#{lineId}";
            var p = prods.FirstOrDefault(x => x.ProductId == l.ProductId);
            return p is null ? $"#{l.ProductId}" : $"{p.SeriesCode ?? p.ProductCode} {p.StyleNo ?? ""} {p.ProductName}".Trim();
        }
        return notes.Select(n =>
        {
            var its = insp.Where(i => i.DeliveryNoteId == n.DeliveryNoteId).ToList();
            var itemDtos = its.Select(i => new InspectionDto(i.InspectionId, i.LineId, LineLabel(i.LineId),
                i.SendQty, i.InspectQty, i.DefectQty, i.ReturnQty,
                DefectRate(i.InspectQty, i.DefectQty), ActualReceived(i.SendQty, i.ReturnQty), i.Remark)).ToList();

            var sumInspect = its.Sum(i => i.InspectQty ?? 0);
            var sumDefect = its.Sum(i => i.DefectQty ?? 0);
            decimal? batchRate = sumInspect > 0 ? Math.Round(sumDefect / sumInspect, 4) : null;
            int? delayDays = deliveryDate is DateOnly dd ? n.ReceivedDate.DayNumber - dd.DayNumber : null;

            return new DeliveryNoteDto(n.DeliveryNoteId, n.OrderId, n.NoteNo, n.ReceivedDate,
                delayDays, batchRate, n.Remark, itemDtos);
        }).ToList();
    }
}
