using Dapper;
using ErpApi.Features.MasterData;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Plastics.PlasticRawMaterialMaster;

// 塑胶原料资料左树 + 右表只读查询。增删改复用 PlasticRawMaterialController(/api/master/plastic-raw-materials)。
public sealed class PlasticRawMaterialMasterService(ISqlConnectionFactory factory)
{
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
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [塑胶原料资料]
WHERE (@cat IS NULL OR [物料类别] = @cat)
  AND (@kw IS NULL OR [物料编号] LIKE @kw OR [物料名称] LIKE @kw OR [规格] LIKE @kw OR [颜色] LIKE @kw OR [供应商名称] LIKE @kw OR [商品名称] LIKE @kw)
  AND (@onlyStock = 0 OR ISNULL([库存],0) > 0);
SELECT [ID],[物料类别],[物料编号],[物料名称],[规格],[颜色],[单位],[仓位号],[商品名称],[单价],[销售价],[起订量],[安全库存],[库存],[最低库存],[最高库存],[供应商编号],[供应商名称],[备注]
FROM [塑胶原料资料]
WHERE (@cat IS NULL OR [物料类别] = @cat)
  AND (@kw IS NULL OR [物料编号] LIKE @kw OR [物料名称] LIKE @kw OR [规格] LIKE @kw OR [颜色] LIKE @kw OR [供应商名称] LIKE @kw OR [商品名称] LIKE @kw)
  AND (@onlyStock = 0 OR ISNULL([库存],0) > 0)
ORDER BY [物料编号] OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;",
            new { cat, kw, page, size, onlyStock = onlyStock ? 1 : 0 });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<PlasticRawMaterialRow>()).AsList();
        return new PagedResult<PlasticRawMaterialRow>(items, total);
    }

    public async Task<IReadOnlyList<PlasticRawMaterialPurchaseRow>> PurchaseAnalysisAsync(
        string? 物料类别, string? keyword, bool onlyBuy)
    {
        var cat = string.IsNullOrWhiteSpace(物料类别) ? null : 物料类别.Trim();
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        var rows = await c.QueryAsync<PlasticRawMaterialPurchaseRow>(@"
SELECT m.[物料编号] AS 原料编号, MAX(m.[物料名称]) AS 原料名称, MAX(m.[规格]) AS 规格,
       MAX(m.[物料类别]) AS 物料类别, MAX(m.[单位]) AS 单位,
       MAX(ISNULL(m.[库存],0)) AS 当前库存, MAX(ISNULL(m.[安全库存],0)) AS 安全库存,
       MAX(ISNULL(dm.[生产需求],0)) AS 生产需求,
       MAX(ISNULL(po.[在途],0)) AS 在途数量,
       MAX(ISNULL(m.[安全库存],0)) + MAX(ISNULL(dm.[生产需求],0)) - MAX(ISNULL(m.[库存],0)) - MAX(ISNULL(po.[在途],0)) AS 可购数量
FROM [塑胶原料资料] m
LEFT JOIN (
    SELECT d.[原料编号], SUM(d.[需求数量KG]) AS 生产需求
    FROM [原料生产需求明细单] d
    JOIN [原料生产需求表] h ON h.[单号] = d.[单号]
    WHERE ISNULL(h.[审核],'0') = '1'
    GROUP BY d.[原料编号]
) dm ON dm.[原料编号] = m.[物料编号]
LEFT JOIN (
    SELECT d.[原料编号],
           SUM(CASE WHEN ISNULL(d.[订货数量],0) - ISNULL(r.[入仓数量],0) > 0
                    THEN ISNULL(d.[订货数量],0) - ISNULL(r.[入仓数量],0) ELSE 0 END) AS 在途
    FROM [原料采购订单明细] d
    JOIN [原料采购订单] o ON o.[单号] = d.[单号]
    LEFT JOIN (
        SELECT h.[订单单号], d2.[原料编号], SUM(ISNULL(d2.[数量],0)) AS 入仓数量
        FROM [原料入仓明细单] d2
        JOIN [原料入仓单] h ON h.[单号] = d2.[单号]
        WHERE ISNULL(h.[审核],'0') = '1'
        GROUP BY h.[订单单号], d2.[原料编号]
    ) r ON r.[订单单号] = o.[单号] AND r.[原料编号] = d.[原料编号]
    WHERE ISNULL(o.[审核],'0') = '1'
    GROUP BY d.[原料编号]
) po ON po.[原料编号] = m.[物料编号]
WHERE (@cat IS NULL OR m.[物料类别] = @cat)
  AND (@kw IS NULL OR m.[物料编号] LIKE @kw OR m.[物料名称] LIKE @kw)
GROUP BY m.[物料编号]
HAVING (@onlyBuy = 0 OR (MAX(ISNULL(m.[安全库存],0)) + MAX(ISNULL(dm.[生产需求],0)) - MAX(ISNULL(m.[库存],0)) - MAX(ISNULL(po.[在途],0))) > 0)
ORDER BY m.[物料编号]", new { cat, kw, onlyBuy = onlyBuy ? 1 : 0 });
        return rows.AsList();
    }
}
