using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SprayPlan.Api.Data;

namespace SprayPlan.Api.Features.Inventory;

[ApiController]
public class InboundApplicationsController(AppDbContext db) : ControllerBase
{
    [HttpGet("api/inventory/inbound-applications")]
    [Authorize]
    public async Task<IActionResult> InternalList(
        [FromQuery] string? applicationNo, [FromQuery] string? orderNo,
        [FromQuery] string? productNo, [FromQuery] DateTime? after,
        [FromQuery] int page = 1, [FromQuery] int pageSize = 50)
        => Ok(await Query(applicationNo, orderNo, productNo, after, page, pageSize, newestFirst: true));

    // ERP 只读接口：ERP 可按时间增量拉取。部署时应由网关限制为 ERP 网络来源。
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
        if (after is not null) query = query.Where(x => x.CreatedAt > after.Value.ToUniversalTime());

        var total = await query.CountAsync();
        var ordered = newestFirst
            ? query.OrderByDescending(x => x.CreatedAt).ThenByDescending(x => x.Id)
            : query.OrderBy(x => x.CreatedAt).ThenBy(x => x.Id);
        var rows = await ordered.Skip((page - 1) * pageSize).Take(pageSize).ToListAsync();
        return new InboundApplicationPage(rows.Select(ToDto).ToList(), total, page, pageSize);
    }

    static InboundApplicationDto ToDto(Entities.InboundApplication x) => new(
        x.ApplicationNo, x.SourcePlanId, x.ProductionDate, x.OrderNo, x.ProductNo,
        x.ItemName, x.PartName, x.Quantity, x.CreatedBy, x.CreatedAt, x.Remark);
}

public record InboundApplicationDto(
    string ApplicationNo, int SourcePlanId, DateTime ProductionDate,
    string OrderNo, string ProductNo, string ItemName, string PartName,
    int Quantity, string CreatedBy, DateTime CreatedAt, string? Remark);

public record InboundApplicationPage(List<InboundApplicationDto> Items, int Total, int Page, int PageSize);
