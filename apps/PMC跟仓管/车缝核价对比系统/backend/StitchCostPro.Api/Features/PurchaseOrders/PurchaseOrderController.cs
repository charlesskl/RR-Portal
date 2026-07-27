using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using StitchCostPro.Api.Shared;

namespace StitchCostPro.Api.Features.PurchaseOrders;

[ApiController]
[Authorize]
[Route("api/purchase-orders")]
public class PurchaseOrderController(PurchaseOrderService svc, PurchaseOrderImportService importSvc) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<ApiResponse<List<OrderListRow>>>> List(
        [FromQuery] int? deptId, [FromQuery] string? keyword)
        => Ok(ApiResponse<List<OrderListRow>>.Ok(await svc.ListAsync(deptId, keyword)));

    [HttpGet("{id:int}")]
    [Authorize(Roles = "业务,外发,管理层,管理员")]
    public async Task<ActionResult<ApiResponse<OrderDetailDto>>> Get(int id)
    {
        var dto = await svc.GetAsync(id);
        return dto is null ? NotFound(ApiResponse<OrderDetailDto>.Fail("订单不存在")) : Ok(ApiResponse<OrderDetailDto>.Ok(dto));
    }

    [HttpPost]
    [Authorize(Roles = "业务,外发,管理员")]
    public async Task<ActionResult<ApiResponse<int>>> Create(OrderUpsert req)
    {
        var (orderId, error) = await svc.CreateAsync(req);
        return error is null ? Ok(ApiResponse<int>.Ok(orderId, "订单已建立，待核价")) : BadRequest(ApiResponse<int>.Fail(error));
    }

    /// <summary>取得不含任何价格的订单编辑数据。</summary>
    [HttpGet("{id:int}/edit")]
    [Authorize(Roles = "业务,外发,跟单,管理员")]
    public async Task<ActionResult<ApiResponse<OrderEditDto>>> GetEdit(int id)
    {
        var dto = await svc.GetEditAsync(id);
        return dto is null ? NotFound(ApiResponse<OrderEditDto>.Fail("订单不存在")) : Ok(ApiResponse<OrderEditDto>.Ok(dto));
    }

    /// <summary>编辑订单非价格信息；订单号和外发价永不从客户端接收。</summary>
    [HttpPut("{id:int}")]
    [Authorize(Roles = "业务,外发,跟单,管理员")]
    public async Task<ActionResult<ApiResponse<bool>>> Update(int id, OrderEditReq req)
    {
        var (ok, error) = await svc.UpdateAsync(id, req);
        return ok ? Ok(ApiResponse<bool>.Ok(true, "订单已更新")) : BadRequest(ApiResponse<bool>.Fail(error!));
    }

    [HttpDelete("{id:int}")]
    [Authorize(Roles = "业务,外发,管理员")]
    public async Task<ActionResult<ApiResponse<bool>>> Delete(int id)
    {
        var (ok, error) = await svc.DeleteAsync(id);
        return ok ? Ok(ApiResponse<bool>.Ok(true, "已删除")) : BadRequest(ApiResponse<bool>.Fail(error!));
    }

    [HttpPost("import/preview")]
    [Authorize(Roles = "业务,外发,管理员")]
    public async Task<ActionResult<ApiResponse<OrderImportPreviewResult>>> ImportPreview(OrderImportPreviewReq req)
        => Ok(ApiResponse<OrderImportPreviewResult>.Ok(await importSvc.PreviewAsync(req.Orders)));

    [HttpPost("import/commit")]
    [Authorize(Roles = "业务,外发,管理员")]
    public async Task<ActionResult<ApiResponse<OrderImportCommitResult>>> ImportCommit(OrderImportCommitReq req)
        => Ok(ApiResponse<OrderImportCommitResult>.Ok(await importSvc.CommitAsync(req.Orders), "订单批量导入完成"));
}
