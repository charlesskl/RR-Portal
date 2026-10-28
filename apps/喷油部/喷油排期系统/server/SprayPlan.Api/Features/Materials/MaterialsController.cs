using Microsoft.Data.Sqlite;
using System.Globalization;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SprayPlan.Api.Data;
using SprayPlan.Api.Entities;
using SprayPlan.Api.Services;

namespace SprayPlan.Api.Features.Materials;

public record MaterialRequest(int OrderId, string? PartName, int ArrivedQty, string? ExpectedDate, string? ActualDate, string? Remark, int Version);

[ApiController, Route("api/materials"), Authorize]
public class MaterialsController(AppDbContext db) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> List([FromQuery] int? orderId)
    {
        var query = db.Orders.AsNoTracking().Include(order => order.PartQtys).Where(order => order.Status != "archived" && !order.PendingProduct);
        if (orderId.HasValue) query = query.Where(order => order.Id == orderId);
        var orders = await query.OrderByDescending(order => order.Id).ToListAsync();
        var ids = orders.Select(order => order.Id).ToList();
        var records = await db.OrderMaterials.AsNoTracking().Where(material => ids.Contains(material.OrderId)).ToListAsync();
        var plans = await db.ProductionPlans.AsNoTracking().Where(plan => ids.Contains(plan.OrderId) && plan.DeletedAt == null).ToListAsync();
        var rows = orders.SelectMany(order => order.PartQtys.GroupBy(part => part.PartName).Select(part => {
            var record = records.FirstOrDefault(item => item.OrderId == order.Id && item.PartName == part.Key);
            var demand = part.Sum(item => (long)item.Qty);
            var consumed = MaterialReflow.Consumed(plans, order.Id, part.Key);
            var waiting = record is null ? 0 : Math.Max(0, demand - MaterialReflow.Available(record, demand, MaterialReflow.Today));
            var forecast = plans.Where(plan => plan.OrderId == order.Id && plan.PartName == part.Key).Select(plan => (DateTime?)plan.PlanDate).Max();
            var status = record is null ? "未登记" : !record.AutoScheduleEnabled ? "自动重排已暂停" : record.ArrivedQty >= demand ? "齐料" : record.ExpectedDate <= MaterialReflow.Today ? (record.ArrivedQty > consumed ? "部分到料（逾期）" : "到料逾期") : record.ArrivedQty > consumed ? "部分到料" : "待料";
            return new { orderId = order.Id, order.ExternalOrderNo, partName = part.Key, demandQty = demand, consumedQty = consumed,
                arrivedQty = record?.ArrivedQty, expectedDate = record?.ExpectedDate?.ToString("yyyy-MM-dd"), actualDate = record?.ActualDate?.ToString("yyyy-MM-dd"),
                record?.Remark, version = record?.Version ?? 0, registered = record is not null, status, waitingQty = waiting,
                finishDate = forecast?.ToString("yyyy-MM-dd"), canEdit = order.Status != "completed" };
        }));
        return Ok(rows);
    }

    [HttpPut, Authorize(Roles = "clerk,manager,admin")]
    public async Task<IActionResult> Save([FromBody] MaterialRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.PartName) || req.ArrivedQty < 0 || req.Version < 0)
            return BadRequest(new { error = "请选择部位，累计到料数量必须是非负整数" });
        DateTime? Parse(string? value) => string.IsNullOrEmpty(value) ? null : DateTime.TryParseExact(value, "yyyy-MM-dd", CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var date) ? date : throw new FormatException("日期格式必须为 YYYY-MM-DD");
        DateTime? expected, actual;
        try { expected = Parse(req.ExpectedDate); actual = Parse(req.ActualDate); }
        catch (FormatException error) { return BadRequest(new { error = error.Message }); }
        if (actual > MaterialReflow.Today || (req.ArrivedQty == 0 && actual.HasValue))
            return BadRequest(new { error = "实际到料日不能晚于今天；没有到料时请清空实际到料日" });
        if (req.ArrivedQty > 0) actual ??= MaterialReflow.Today;
        await using var transaction = await db.Database.BeginTransactionAsync();
        var order = await db.Orders.Include(order => order.PartQtys).FirstOrDefaultAsync(order => order.Id == req.OrderId);
        if (order is null) return NotFound(new { error = "订单不存在或不属于当前厂区" });
        if (order.Status is "archived" or "completed" || order.PendingProduct) return BadRequest(new { error = "完工、作废或待补产品订单不能更改来料" });
        if (!order.PartQtys.Any(part => part.PartName == req.PartName)) return BadRequest(new { error = "该部位不属于当前订单" });
        var plans = await db.ProductionPlans.Where(plan => plan.OrderId == order.Id && plan.DeletedAt == null).ToListAsync();
        var consumed = MaterialReflow.Consumed(plans, order.Id, req.PartName);
        if (req.ArrivedQty < consumed) return BadRequest(new { error = $"累计到料数量不能小于该部位已投产数量 {consumed:N0}" });
        var record = await db.OrderMaterials.FirstOrDefaultAsync(material => material.OrderId == order.Id && material.PartName == req.PartName);
        if ((record?.Version ?? 0) != req.Version) return Conflict(new { error = "来料记录已被其他人或自动重排更新，请重新加载后再保存" });
        if (record is not null && record.ArrivedQty == req.ArrivedQty && record.ExpectedDate == expected && record.ActualDate == actual
            && record.Remark == req.Remark && record.AutoScheduleEnabled && record.LastReflowDate >= MaterialReflow.Today)
            return Ok(new { reflow = new MaterialReflowResult(0, 0, new()), message = "来料记录未变化，无需重复重排" });
        if (record is null) { record = new OrderMaterial { FactoryId = order.FactoryId, OrderId = order.Id, PartName = req.PartName }; db.OrderMaterials.Add(record); }
        var by = User.FindFirst("username")?.Value ?? "unknown";
        var history = JsonSerializer.Deserialize<List<JsonElement>>(record.History) ?? new();
        history.Add(JsonSerializer.SerializeToElement(new { action = "manual_material", oldQty = record.ArrivedQty, newQty = req.ArrivedQty,
            oldExpectedDate = record.ExpectedDate, newExpectedDate = expected, actualDate = actual, by, at = DateTime.UtcNow }));
        record.History = JsonSerializer.Serialize(history);
        record.ArrivedQty = req.ArrivedQty; record.ExpectedDate = expected; record.ActualDate = actual; record.Remark = req.Remark;
        record.Source = "manual"; record.AutoScheduleEnabled = true; record.UpdatedBy = by; record.UpdatedAt = DateTime.UtcNow;
        try {
            await db.SaveChangesAsync();
            var result = await MaterialReflow.Apply(db, order.FactoryId, new() { record.Id }, by);
            await db.SaveChangesAsync(); await transaction.CommitAsync();
            return Ok(new { reflow = result, message = "来料已保存，关联的未报工计划已自动重排；历史实绩和库存保持不变" });
        } catch (InvalidOperationException error) { return BadRequest(new { error = error.Message }); }
        catch (DbUpdateConcurrencyException) { return Conflict(new { error = "记录已变化，请重新加载后再保存" }); }
        catch (DbUpdateException error) when (error.InnerException is SqliteException { SqliteErrorCode: 19 }) { return Conflict(new { error = "记录已变化，请重新加载后再保存" }); }
        catch (JsonException) { return BadRequest(new { error = "原排期配置或历史记录格式异常，本次登记未保存" }); }
    }
}
