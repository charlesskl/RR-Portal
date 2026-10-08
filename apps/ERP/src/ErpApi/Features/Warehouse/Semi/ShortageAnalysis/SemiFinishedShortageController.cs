using System.Globalization;
using System.Security.Claims;
using System.Text;
using ErpApi.Engines.Authorization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace ErpApi.Features.Warehouse.Semi.ShortageAnalysis;

[ApiController]
[Authorize]
[Route("api/semi-finished-shortage-analysis")]
public sealed class SemiFinishedShortageController(
    ISemiFinishedShortageService service,
    IPermissionService permissions) : ControllerBase
{
    private const string Menu = "半成品欠料分析表";

    private string CurrentUser =>
        User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? "";

    [HttpGet]
    public async Task<IActionResult> List([FromQuery] SemiFinishedShortageQuery query)
    {
        if (!await permissions.HasAsync(CurrentUser, Menu, PermissionAction.打开)) return Forbid();

        return Ok(await service.ListAsync(query));
    }

    [HttpGet("export")]
    public async Task<IActionResult> Export([FromQuery] SemiFinishedShortageQuery query)
    {
        if (!await permissions.HasAsync(CurrentUser, Menu, PermissionAction.打印)) return Forbid();

        var rows = await service.ExportAsync(query);
        var csv = new StringBuilder("\uFEFF客户,产品货号,产品名称,配件编号,产品装配名称,单位,需求数量,库存数量,欠料数量\r\n");
        foreach (var row in rows)
        {
            // 与表头一致使用 \r\n（CSV 标准），不随平台变化
            csv.Append(string.Join(',',
            [
                Cell(row.Customer),
                Cell(row.ProductCode),
                Cell(row.ProductName),
                Cell(row.PartCode),
                Cell(row.AssemblyName),
                Cell(row.Unit),
                FormatQuantity(row.RequiredQuantity),
                FormatQuantity(row.InventoryQuantity),
                FormatQuantity(row.ShortageQuantity),
            ])).Append("\r\n");
        }

        return File(
            Encoding.UTF8.GetBytes(csv.ToString()),
            "text/csv; charset=utf-8",
            "半成品欠料分析表.csv");
    }

    private static string Cell(string? value)
    {
        value ??= "";
        if (value.Length > 0 && value[0] is '=' or '+' or '-' or '@') value = $"'{value}";
        return value.IndexOfAny([',', '"', '\r', '\n']) >= 0
            ? $"\"{value.Replace("\"", "\"\"")}\""
            : value;
    }

    private static string FormatQuantity(decimal value) =>
        value.ToString("0.####", CultureInfo.InvariantCulture);
}
