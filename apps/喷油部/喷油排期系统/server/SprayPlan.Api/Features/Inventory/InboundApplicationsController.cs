using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SprayPlan.Api.Data;

namespace SprayPlan.Api.Features.Inventory;

[ApiController]
public class InboundApplicationsController(AppDbContext db) : ControllerBase
{
    string CurrentUser() => User.FindFirst("username")?.Value ?? "unknown";

    [HttpGet("api/inventory/inbound-applications")]
    [Authorize]
    public async Task<IActionResult> InternalList(
        [FromQuery] string? applicationNo, [FromQuery] string? orderNo,
        [FromQuery] string? productNo, [FromQuery] DateTime? after,
        [FromQuery] int page = 1, [FromQuery] int pageSize = 50)
        => Ok(await Query(applicationNo, orderNo, productNo, after, page, pageSize, newestFirst: true));

    // ERP 只读接口：ERP 可按时间增量拉取。部署时应由网关限制为 ERP 网络来源。
    // 增量口径是 updatedAt（编辑过的单会重新出现在增量里，即"修改后重新发送 ERP"）；
    // updatedAt 在建单时初始化为 createdAt（存量由迁移回填），语义与原 createdAt 口径一致。
    [HttpGet("api/erp/inbound-applications")]
    [AllowAnonymous]
    public async Task<IActionResult> ErpList(
        [FromQuery] DateTime? after, [FromQuery] int page = 1, [FromQuery] int pageSize = 100)
        => Ok(await Query(null, null, null, after, page, pageSize, newestFirst: false));

    [HttpGet("api/erp/inbound-applications/{applicationNo}")]
    [AllowAnonymous]
    public async Task<IActionResult> ErpDetail(string applicationNo)
    {
        var row = await db.InboundApplications.AsNoTracking()
            .SingleOrDefaultAsync(x => x.ApplicationNo == applicationNo);
        return row is null ? NotFound(new { error = "入库申请单不存在" }) : Ok(ToDto(row));
    }

    // 编辑入库申请单：生产日期/数量/子件位置/备注可改；申请单号、订单号、货号为对账身份字段不可改。
    // 保存后 updatedAt 刷新，ERP 下次增量拉取即拿到该单的最新版本（等同重新发送）。
    [HttpPatch("api/inventory/inbound-applications/{applicationNo}")]
    [Authorize]
    public async Task<IActionResult> Edit(string applicationNo, [FromBody] InboundApplicationEditRequest req)
    {
        var row = await db.InboundApplications
            .SingleOrDefaultAsync(x => x.ApplicationNo == applicationNo);
        if (row is null) return NotFound(new { error = "入库申请单不存在" });

        // 只有管理员或该单录入人可以改
        if (!User.IsInRole("admin") && row.CreatedBy != CurrentUser())
            return StatusCode(403, new { error = "只有管理员或该单录入人可以修改" });

        if (req.Quantity == 0)
            return BadRequest(new { error = "数量不能为 0" });
        if (req.PartName is not null && string.IsNullOrWhiteSpace(req.PartName))
            return BadRequest(new { error = "子件/位置不能为空" });

        if (req.ProductionDate is not null) row.ProductionDate = req.ProductionDate.Value;
        if (req.Quantity is not null) row.Quantity = req.Quantity.Value;
        if (req.PartName is not null) row.PartName = req.PartName.Trim();
        if (req.Remark is not null) row.Remark = string.IsNullOrWhiteSpace(req.Remark) ? null : req.Remark.Trim();
        row.UpdatedAt = DateTime.UtcNow;
        row.UpdatedBy = CurrentUser();
        await db.SaveChangesAsync();
        return Ok(ToDto(row));
    }

    async Task<InboundApplicationPage> Query(
        string? applicationNo, string? orderNo, string? productNo,
        DateTime? after, int page, int pageSize, bool newestFirst)
    {
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 200);
        var query = db.InboundApplications.AsNoTracking().AsQueryable();
        if (!string.IsNullOrWhiteSpace(applicationNo)) query = query.Where(x => x.ApplicationNo.Contains(applicationNo.Trim()));
        if (!string.IsNullOrWhiteSpace(orderNo)) query = query.Where(x => x.OrderNo.Contains(orderNo.Trim()));
        if (!string.IsNullOrWhiteSpace(productNo)) query = query.Where(x => x.ProductNo.Contains(productNo.Trim()));
        if (after is not null) query = query.Where(x => x.UpdatedAt > after.Value.ToUniversalTime());

        var total = await query.CountAsync();
        var ordered = newestFirst
            ? query.OrderByDescending(x => x.CreatedAt).ThenByDescending(x => x.Id)
            : query.OrderBy(x => x.UpdatedAt).ThenBy(x => x.Id);
        var rows = await ordered.Skip((page - 1) * pageSize).Take(pageSize).ToListAsync();
        return new InboundApplicationPage(rows.Select(ToDto).ToList(), total, page, pageSize);
    }

    static InboundApplicationDto ToDto(Entities.InboundApplication x) => new(
        x.ApplicationNo, x.SourcePlanId, x.ProductionDate, x.OrderNo, x.ProductNo,
        x.ItemName, x.PartName, x.Quantity, x.CreatedBy, x.CreatedAt,
        x.UpdatedAt, x.UpdatedBy, x.Remark);
}

public record InboundApplicationDto(
    string ApplicationNo, int SourcePlanId, DateTime ProductionDate,
    string OrderNo, string ProductNo, string ItemName, string PartName,
    int Quantity, string CreatedBy, DateTime CreatedAt,
    DateTime UpdatedAt, string? UpdatedBy, string? Remark);

public record InboundApplicationPage(List<InboundApplicationDto> Items, int Total, int Page, int PageSize);

public record InboundApplicationEditRequest(
    DateTime? ProductionDate, int? Quantity, string? PartName, string? Remark);
