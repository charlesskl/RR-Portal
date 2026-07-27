using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using StitchCostPro.Api.Shared;

namespace StitchCostPro.Api.Features.Products;

[ApiController]
[Authorize(Roles = "业务,外发,管理层,管理员")]
[Route("api/product-quotes")]
public class ProductQuoteController(ProductQuoteService svc, ProductImportService importSvc) : ControllerBase
{
    /// <summary>旧核价导入 · 第1步：预览(dry-run)，只校验回报，不写库。</summary>
    [HttpPost("import/preview")]
    [Authorize(Roles = "业务,管理员")]
    public async Task<ActionResult<ApiResponse<ImportPreviewResult>>> ImportPreview(ImportPreviewReq req)
        => Ok(ApiResponse<ImportPreviewResult>.Ok(await importSvc.PreviewAsync(req.DeptId, req.Rows)));

    /// <summary>旧核价导入 · 第2步：确认落库(按撞车选择覆盖/保留)。</summary>
    [HttpPost("import/commit")]
    [Authorize(Roles = "业务,管理员")]
    public async Task<ActionResult<ApiResponse<ImportCommitResult>>> ImportCommit(ImportCommitReq req)
        => Ok(ApiResponse<ImportCommitResult>.Ok(await importSvc.CommitAsync(req), "导入完成"));


    /// <summary>按货号取每款的产品级价格。</summary>
    [HttpGet("by-series")]
    public async Task<ActionResult<ApiResponse<List<ProductPriceDto>>>> BySeries(
        [FromQuery] string code, [FromQuery] int? deptId)
        => Ok(ApiResponse<List<ProductPriceDto>>.Ok(await svc.GetBySeriesAsync(code, deptId)));

    /// <summary>取某款的产品级价格。</summary>
    [HttpGet("by-product")]
    public async Task<ActionResult<ApiResponse<ProductPriceDto?>>> ByProduct([FromQuery] int productId)
        => Ok(ApiResponse<ProductPriceDto?>.Ok(await svc.GetByProductAsync(productId)));

    /// <summary>保存一个款式的产品级价格。</summary>
    [HttpPut("{productId:int}")]
    [Authorize(Roles = "业务,管理员")]
    public async Task<ActionResult<ApiResponse<bool>>> Save(int productId, ProductPriceSaveReq req)
    {
        var (ok, error) = await svc.SaveAsync(productId, req);
        return ok ? Ok(ApiResponse<bool>.Ok(true, "已保存")) : BadRequest(ApiResponse<bool>.Fail(error!));
    }
}
