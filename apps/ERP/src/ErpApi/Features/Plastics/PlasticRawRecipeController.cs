using System.Security.Claims;
using ErpApi.Engines.Authorization;
using ErpApi.Infrastructure.Db;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace ErpApi.Features.Plastics;

[ApiController]
[Authorize]
[Route("api/plastic-raw-recipes")]
public sealed class PlasticRawRecipeController(ISqlConnectionFactory factory, IAuditLogger audit, IPermissionService perms) : ControllerBase
{
    private const string Menu = "塑胶原料资料表";
    private string CurrentUser => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";

    [HttpGet("{code}")]
    public async Task<IActionResult> Get(string code)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();
        if (string.IsNullOrWhiteSpace(code) || code.Trim().Length > 40) return BadRequest(new { 消息 = "请提供有效原料编号。" });
        try { return Ok(await new PlasticRawRecipeService(factory, audit).GetAsync(code.Trim())); }
        catch (KeyNotFoundException ex) { return NotFound(new { 消息 = ex.Message }); }
        catch (InvalidOperationException ex) { return Conflict(new { 消息 = ex.Message }); }
    }

    [HttpPut("{code}")]
    public async Task<IActionResult> Put(string code, [FromBody] PlasticRawRecipeDto dto)
    {
        if (!await perms.HasAsync(CurrentUser, Menu, PermissionAction.保存)) return Forbid();
        if (string.IsNullOrWhiteSpace(code) || code.Trim().Length > 40 ||
            !string.Equals(code.Trim(), dto.原料编号?.Trim(), StringComparison.OrdinalIgnoreCase))
            return BadRequest(new { 消息 = "配方原料编号必须与当前原料一致。" });
        if (dto.明细 is null || dto.明细.Count > 200)
            return BadRequest(new { 消息 = "配方最多允许 200 个组分。" });
        foreach (var line in dto.明细)
        {
            if (line is null || string.IsNullOrWhiteSpace(line.原料编号) || line.原料编号.Trim().Length > 40 ||
                line.比例 <= 0 || line.比例 > 1000000000m || decimal.Round(line.比例, 4) != line.比例 ||
                line.每库存单位KG <= 0 || line.每库存单位KG > 1000000000m || decimal.Round(line.每库存单位KG, 8) != line.每库存单位KG)
                return BadRequest(new { 消息 = "组分必须选择真实原料；比例大于零且最多 4 位小数，库存换算大于零且最多 8 位小数。" });
            line.原料编号 = line.原料编号.Trim();
            line.库存单位 = line.库存单位?.Trim().ToUpperInvariant() ?? "";
            if ((line.库存单位 != "KG" && line.库存单位 != "包") || (line.库存单位 == "KG" && line.每库存单位KG != 1))
                return BadRequest(new { 消息 = "库存单位请选择 KG 或包；KG 换算必须为 1，包须明确填写每包 KG。" });
        }
        try { await new PlasticRawRecipeService(factory, audit).PutAsync(code.Trim(), dto, CurrentUser); }
        catch (KeyNotFoundException ex) { return NotFound(new { 消息 = ex.Message }); }
        catch (UnauthorizedAccessException) { return Forbid(); }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
        catch (InvalidOperationException ex) { return Conflict(new { 消息 = ex.Message }); }
        return NoContent();
    }
}
