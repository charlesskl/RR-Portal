using Dapper;
using ErpApi.Infrastructure.Db;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace ErpApi.Features.MasterData.Pricing;

[ApiController]
[Authorize]
[Route("api/master/pricing")]
public sealed class PricingController(PricingService pricing, ISqlConnectionFactory factory) : ControllerBase
{
    // 取价：GET /api/master/pricing/material?物料编号=..&报价类别=..&asOf=2026-06-01


    // 应用调价：把一张调价单的明细写成 报价资料 的新生效价(生效日期=单据日期)
    [HttpPost("apply/{单号}")]
    public async Task<IActionResult> Apply(string 单号, string 报价类别)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var rows = await c.ExecuteAsync(@"
INSERT INTO [报价资料]([报价类别],[物料编号],[物料名称],[规格],[颜色],[单位],[单价],[生效日期])
SELECT @报价类别, d.[物料编号], d.[物料名称], d.[规格], d.[颜色], d.[单位], d.[修改单价], ISNULL(d.[日期], SYSDATETIME())
FROM [调价明细表] d
WHERE d.[单号]=@单号 AND d.[修改单价] IS NOT NULL", new { 单号, 报价类别 }, tx);
        tx.Commit();
        return Ok(new { 单号, 报价类别, 生成报价条数 = rows });
    }
}
