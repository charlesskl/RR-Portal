using Dapper;
using ErpApi.Engines.Inventory;
using ErpApi.Features.MasterData;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Plastics.PlasticRawMaterialMaster;

// 塑胶原料资料左树 + 右表只读查询。增删改复用 PlasticRawMaterialController(/api/master/plastic-raw-materials)。
public sealed class PlasticRawMaterialMasterService(ISqlConnectionFactory factory)
{
    // 只启用明确配方组分的新台账；其他历史原料保留原主档库存口径。
    private const string AutomaticStockSql = @"
SELECT o.[原料编号] AS Code,o.[库存单位] AS Unit,o.[每库存单位KG] AS KgPerUnit,
       ISNULL(MAX(s.[库存数量]),0) AS Quantity
FROM [原料自动扣料期初] o
LEFT JOIN (" + RawMaterialInventorySql.StockRows + @") s ON s.[原料编号]=o.[原料编号]
GROUP BY o.[原料编号],o.[库存单位],o.[每库存单位KG]";

    public async Task<IReadOnlyList<PlasticRawMaterialCategoryNode>> CategoriesAsync()
    {
        using var c = factory.Create();
        var rows = await c.QueryAsync<PlasticRawMaterialCategoryNode>(@"
SELECT [物料类别] AS 类别, COUNT(*) AS 数量
FROM [塑胶原料资料]
WHERE [物料类别] IS NOT NULL AND LTRIM(RTRIM([物料类别])) <> ''
GROUP BY [物料类别]
ORDER BY [物料类别];");
        return rows.AsList();
    }

    public async Task<PagedResult<PlasticRawMaterialRow>> ListAsync(string? 类别, string? keyword, int page, int size, bool onlyStock = false)
    {
        if (page < 1) page = 1;
        if (size < 1) size = 20;
        if (size > 1000) size = 1000;
        var cat = string.IsNullOrWhiteSpace(类别) ? null : 类别.Trim();
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync($@"
SELECT COUNT(*) FROM [塑胶原料资料]
LEFT JOIN ({AutomaticStockSql}) automaticStock ON automaticStock.Code=[物料编号]
WHERE (@cat IS NULL OR [物料类别] = @cat)
  AND (@kw IS NULL OR [物料编号] LIKE @kw OR [物料名称] LIKE @kw OR [规格] LIKE @kw OR [颜色] LIKE @kw OR [供应商名称] LIKE @kw OR [商品名称] LIKE @kw)
  AND (@onlyStock = 0 OR COALESCE(automaticStock.Quantity,[库存],0)>0);
SELECT [ID],[物料类别],[物料编号],[物料名称],[规格],[颜色],COALESCE(automaticStock.Unit,[单位]) AS 单位,[仓位号],[商品名称],[单价],[销售价],[起订量],[安全库存],[常用原料],[每包重量],COALESCE(automaticStock.Quantity,[库存]) AS 库存,[最低库存],[最高库存],[供应商编号],[供应商名称],[备注]
FROM [塑胶原料资料]
LEFT JOIN ({AutomaticStockSql}) automaticStock ON automaticStock.Code=[物料编号]
WHERE (@cat IS NULL OR [物料类别] = @cat)
  AND (@kw IS NULL OR [物料编号] LIKE @kw OR [物料名称] LIKE @kw OR [规格] LIKE @kw OR [颜色] LIKE @kw OR [供应商名称] LIKE @kw OR [商品名称] LIKE @kw)
  AND (@onlyStock = 0 OR COALESCE(automaticStock.Quantity,[库存],0)>0)
ORDER BY [物料编号] OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;",
            new { cat, kw, page, size, onlyStock = onlyStock ? 1 : 0 });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<PlasticRawMaterialRow>()).AsList();
        return new PagedResult<PlasticRawMaterialRow>(items, total);
    }

    public async Task<IReadOnlyList<PlasticRawMaterialPurchaseRow>> PurchaseAnalysisAsync(
        string? 物料类别, string? keyword, bool onlyBuy, string? excludeOrder = null)
    {
        using var c = factory.Create();
        return await RawMaterialProcurementPolicy.ReadAnalysisAsync(c, null, 物料类别, keyword, onlyBuy, excludeOrder);
    }
}
