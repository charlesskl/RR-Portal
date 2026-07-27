using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using StitchCostPro.Api.Shared;

namespace StitchCostPro.Api.Features.Products;

[ApiController]
[Authorize]
[Route("api/products")]
public class ProductController(ProductService svc) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<ApiResponse<PagedResult<ProductDto>>>> List(
        [FromQuery] string? keyword, [FromQuery] int? deptId,
        [FromQuery] int page = 1, [FromQuery] int pageSize = 20)
        => Ok(ApiResponse<PagedResult<ProductDto>>.Ok(await svc.ListAsync(keyword, deptId, page, pageSize)));

    /// <summary>产品库列表：一个货号(系列)一行 + 款数。</summary>
    [HttpGet("series-summary")]
    public async Task<ActionResult<ApiResponse<PagedResult<ProductSeriesRow>>>> SeriesSummary(
        [FromQuery] string? keyword, [FromQuery] int? deptId,
        [FromQuery] bool archived = false,
        [FromQuery] int page = 1, [FromQuery] int pageSize = 20)
        => Ok(ApiResponse<PagedResult<ProductSeriesRow>>.Ok(await svc.SeriesSummaryAsync(keyword, deptId, archived, page, pageSize)));

    [HttpPost("series/{code}/archive")]
    public async Task<ActionResult<ApiResponse<int>>> ArchiveSeries(string code)
    {
        var (count, error) = await svc.SetSeriesActiveAsync(code, false);
        return error is null ? Ok(ApiResponse<int>.Ok(count, "货号已作废")) : BadRequest(ApiResponse<int>.Fail(error));
    }

    [HttpPost("series/{code}/restore")]
    public async Task<ActionResult<ApiResponse<int>>> RestoreSeries(string code)
    {
        var (count, error) = await svc.SetSeriesActiveAsync(code, true);
        return error is null ? Ok(ApiResponse<int>.Ok(count, "货号已恢复")) : BadRequest(ApiResponse<int>.Fail(error));
    }

    [HttpDelete("series/{code}")]
    [Authorize(Roles = "业务,管理员")]
    public async Task<ActionResult<ApiResponse<ProductSeriesDeleteResult>>> DeleteSeries(string code)
    {
        var (result, error) = await svc.DeleteSeriesAsync(code);
        return error is null
            ? Ok(ApiResponse<ProductSeriesDeleteResult>.Ok(result!, "货号已永久删除"))
            : BadRequest(ApiResponse<ProductSeriesDeleteResult>.Fail(error));
    }

    [HttpGet("{id:int}")]
    public async Task<ActionResult<ApiResponse<ProductDto>>> Get(int id)
    {
        var dto = await svc.GetAsync(id);
        return dto is null ? NotFound(ApiResponse<ProductDto>.Fail("货号不存在")) : Ok(ApiResponse<ProductDto>.Ok(dto));
    }

    [HttpPost]
    public async Task<ActionResult<ApiResponse<ProductDto>>> Create(ProductUpsert req)
    {
        var (dto, error) = await svc.CreateAsync(req);
        return error is null ? Ok(ApiResponse<ProductDto>.Ok(dto!, "创建成功")) : BadRequest(ApiResponse<ProductDto>.Fail(error));
    }

    /// <summary>新建货号：一个货号一次建多个款。</summary>
    [HttpPost("series")]
    public async Task<ActionResult<ApiResponse<int>>> CreateSeries(SeriesCreate req)
    {
        var (count, error) = await svc.CreateSeriesAsync(req);
        return error is null ? Ok(ApiResponse<int>.Ok(count, $"已新建 {count} 个款")) : BadRequest(ApiResponse<int>.Fail(error));
    }

    [HttpPut("{id:int}")]
    public async Task<ActionResult<ApiResponse<ProductDto>>> Update(int id, ProductUpsert req)
    {
        var (dto, error) = await svc.UpdateAsync(id, req);
        return error is null ? Ok(ApiResponse<ProductDto>.Ok(dto!, "更新成功")) : BadRequest(ApiResponse<ProductDto>.Fail(error));
    }
}
