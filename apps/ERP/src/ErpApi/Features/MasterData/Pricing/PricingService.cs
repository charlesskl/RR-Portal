using Dapper;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.MasterData.Pricing;

public sealed class PricingService(ISqlConnectionFactory factory)
{
    // 算法8 取价：按 物料编号+报价类别，取 生效日期<=asOf 的最新一条单价；
    // 生效日期为 NULL 视为最早基线价(始终有效)。
    public async Task<decimal?> GetMaterialPriceAsync(string 物料编号, string 报价类别, DateTime asOf)
    {
        using var c = factory.Create();
        return await c.ExecuteScalarAsync<decimal?>(@"
SELECT TOP 1 [单价]
FROM [报价资料]
WHERE [物料编号]=@物料编号 AND [报价类别]=@报价类别
  AND ([生效日期] IS NULL OR [生效日期] <= @asOf)
ORDER BY CASE WHEN [生效日期] IS NULL THEN 0 ELSE 1 END DESC, [生效日期] DESC, [ID] DESC",
            new { 物料编号, 报价类别, asOf });
    }
}
