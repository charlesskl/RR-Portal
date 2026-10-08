using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
namespace ErpApi.Integrations.Paiji;

// 排产系统「入库」webhook 接收端:车间点入库后排产主动 POST 过来,ERP 立即建未审核塑胶入仓单。
// 与轮询 PaijiSyncWorker 共用 PaijiReceiptSyncService,只是把「拉」改成「收」。
// 服务器对服务器调用,不走用户 JWT:请求头 X-Webhook-Token 须等于配置 Paiji:WebhookToken(环境变量 Paiji__WebhookToken);
// 未配置令牌 = webhook 未启用,端点 503。
[ApiController]
[AllowAnonymous]
[Route("api/integrations/paiji")]
public sealed class PaijiWebhookController(
    IOptions<PaijiOptions> options, PaijiReceiptSyncService sync, ILogger<PaijiWebhookController> logger) : ControllerBase
{
    public sealed class BatchDto
    {
        [JsonPropertyName("workshop")] public string? Workshop { get; set; }
        [JsonPropertyName("rows")] public List<PaijiWarehouseInRow>? Rows { get; set; }
    }

    [HttpPost("warehouse-checkin")]
    public async Task<IActionResult> WarehouseCheckin([FromBody] JsonElement body)
    {
        var token = options.Value.WebhookToken;
        if (string.IsNullOrWhiteSpace(token))
            return StatusCode(503, new { 错误 = "webhook 未启用(未配置 Paiji:WebhookToken)" });
        if (!Request.Headers.TryGetValue("X-Webhook-Token", out var h) || h.ToString() != token)
            return Unauthorized(new { 错误 = "X-Webhook-Token 无效" });

        // body 两种形态:单条行对象,或 { workshop, rows:[...] }
        string? workshop;
        List<PaijiWarehouseInRow> rows;
        try
        {
            if (body.ValueKind == JsonValueKind.Object && body.TryGetProperty("rows", out var rowsEl))
            {
                var batch = JsonSerializer.Deserialize<BatchDto>(body.GetRawText());
                workshop = batch?.Workshop;
                rows = batch?.Rows ?? [];
                if (rows.Count == 0) return BadRequest(new { 错误 = "rows 不能为空" });
            }
            else
            {
                var row = JsonSerializer.Deserialize<PaijiWarehouseInRow>(body.GetRawText());
                if (row is null) return BadRequest(new { 错误 = "body 不是有效的入库行" });
                workshop = row.Workshop;
                rows = [row];
            }
        }
        catch (JsonException ex)
        {
            return BadRequest(new { 错误 = $"body JSON 解析失败:{ex.Message}" });
        }
        workshop = string.IsNullOrWhiteSpace(workshop) ? rows[0].Workshop : workshop;
        if (string.IsNullOrWhiteSpace(workshop))
            return BadRequest(new { 错误 = "缺少车间(workshop)" });

        var 待入库 = rows.Where(r => r.Status == "checked-in").ToList();
        if (待入库.Count == 0)
            return Ok(new { 建单 = Array.Empty<string>(), 跳过 = "无 status=checked-in 的行,已跳过" });

        var 建单 = await sync.SyncRowsAsync(rows, workshop);
        logger.LogInformation("排产入库 webhook:车间={车间} 行数={N} 建单={单号}", workshop, rows.Count, 建单);
        return Ok(new { 建单 });
    }
}
