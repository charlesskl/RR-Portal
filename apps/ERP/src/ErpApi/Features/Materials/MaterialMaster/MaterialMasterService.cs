using Dapper;
using ErpApi.Data.Entities;
using ErpApi.Features.MasterData;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Materials.MaterialMaster;

// 物料资料左树 + 右表的只读查询。增删改复用 MaterialController(/api/master/materials)。
public sealed class MaterialMasterService(ISqlConnectionFactory factory)
{
    // 左树：物料类别主数据(带父子) + 仅存在于物料行的类别，扁平返回(父级=父类别编号)由前端组树
    public async Task<IReadOnlyList<MaterialCategoryNode>> CategoriesAsync()
    {
        using var c = factory.Create();
        var counts = (await c.QueryAsync<MaterialCategoryNode>(@"
SELECT [物料类别] AS 类别, COUNT(*) AS 数量
FROM [物料资料]
WHERE [物料类别] IS NOT NULL AND LTRIM(RTRIM([物料类别])) <> ''
GROUP BY [物料类别]
ORDER BY [物料类别];"))
            .Where(x => x.类别 is not null)
            .ToDictionary(x => x.类别!.Trim(), x => x.数量, StringComparer.OrdinalIgnoreCase);
        var master = await c.QueryAsync<MaterialCategoryMasterRow>(@"
SELECT [编号],[名称],[类别] AS 父级 FROM [物料类别] ORDER BY [编号],[名称];");
        return MaterialCategoryTree.Build(master, counts);
    }

    // 右表：按分类(@类别 空=不过滤；含子级=true 时含该类所有后代类别) + 关键字 过滤的分页
    public async Task<PagedResult<MaterialRow>> ListAsync(string? 类别, string? keyword, int page, int size, bool onlyStock = false, bool 含子级 = false)
    {
        if (page < 1) page = 1;
        if (size < 1) size = 20;
        if (size > 1000) size = 1000;
        var cat = string.IsNullOrWhiteSpace(类别) ? null : 类别.Trim();
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        var cats = cat is null ? Array.Empty<string>() : new[] { cat };
        if (cat is not null && 含子级)
        {
            var master = await c.QueryAsync<MaterialCategoryMasterRow>(
                "SELECT [编号],[名称],[类别] AS 父级 FROM [物料类别];");
            cats = MaterialCategoryTree.SubtreeKeys(master, cat).ToArray();
        }
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [物料资料]
WHERE (@cat IS NULL OR [物料类别] IN @cats)
  AND (@kw IS NULL OR [物料编号] LIKE @kw OR [物料名称] LIKE @kw OR [规格] LIKE @kw OR [颜色] LIKE @kw OR [供应商名称] LIKE @kw OR [仓库位置] LIKE @kw)
  AND (@onlyStock = 0 OR ISNULL([库存],0) > 0);
SELECT [ID],[物料类别],[物料编号],[物料名称],[规格],[颜色],[单位],[单价],[销售价],[库存],[最低库存],[最高库存],[供应商编号],[供应商名称],[备注],[仓库位置],[码换算]
FROM [物料资料]
WHERE (@cat IS NULL OR [物料类别] IN @cats)
  AND (@kw IS NULL OR [物料编号] LIKE @kw OR [物料名称] LIKE @kw OR [规格] LIKE @kw OR [颜色] LIKE @kw OR [供应商名称] LIKE @kw OR [仓库位置] LIKE @kw)
  AND (@onlyStock = 0 OR ISNULL([库存],0) > 0)
ORDER BY [物料编号] OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;",
            new { cat, cats, kw, page, size, onlyStock = onlyStock ? 1 : 0 });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<MaterialRow>()).AsList();
        return new PagedResult<MaterialRow>(items, total);
    }

    // 下一个物料编号：类别前缀(主数据编号→类别名→M) + 现有同前缀最大序号+1。
    // 仅作新增预填；并发下的唯一性由 CreateWithGeneratedCodeAsync 的 applock 兜底。
    public async Task<string> NextCodeAsync(string? 类别)
    {
        var cat = string.IsNullOrWhiteSpace(类别) ? null : 类别.Trim();
        using var c = factory.Create();
        string? code = null;
        if (cat is not null)
            code = await c.ExecuteScalarAsync<string?>(@"
SELECT TOP 1 [编号] FROM [物料类别]
WHERE [名称]=@cat OR [编号]=@cat
ORDER BY CASE WHEN [名称]=@cat THEN 0 ELSE 1 END, [ID];", new { cat });
        var prefix = MaterialCodeGenerator.NormalizePrefix(cat, code);
        // LEFT+LEN 前缀匹配(避开 LIKE 通配符转义)；排序规则一般为 CI,与生成器忽略大小写一致
        var codes = await c.QueryAsync<string?>(@"
SELECT [物料编号] FROM [物料资料]
WHERE [物料编号] IS NOT NULL AND LEFT([物料编号], LEN(@p)) = @p;", new { p = prefix });
        return MaterialCodeGenerator.Next(prefix, codes);
    }

    // 新增物料(物料编号为空时自动生成)。生成的并发安全：
    // sp_getapplock 会话级排他锁串行化"取号+插入",参考 DocumentNumber 的行锁思路(物料编号无日期段,不适合走单号引擎)。
    public async Task<物料资料> CreateWithGeneratedCodeAsync(物料资料 entity, MasterCrudService<物料资料> crud)
    {
        if (!string.IsNullOrWhiteSpace(entity.物料编号))
            return await crud.CreateAsync(entity);
        using var c = factory.Create();
        await c.OpenAsync();
        await c.ExecuteAsync("EXEC sp_getapplock @Resource=N'material-master-next-code', @LockMode=N'Exclusive', @LockOwner=N'Session';");
        try
        {
            entity.物料编号 = await NextCodeAsync(entity.物料类别);
            return await crud.CreateAsync(entity);
        }
        finally
        {
            await c.ExecuteAsync("EXEC sp_releaseapplock @Resource=N'material-master-next-code', @LockOwner=N'Session';");
        }
    }

    // 订货数量口径: 缺口(需领-库存-在途) × (1+采购物料设置.采购损耗率/100), 损耗率在 C# 侧应用便于单测。
    public async Task<IReadOnlyList<AuxiliaryPurchaseAnalysisRow>> AuxiliaryPurchaseAnalysisAsync(
        string? 物料类别,
        string? keyword,
        bool onlyBuy)
    {
        var cat = string.IsNullOrWhiteSpace(物料类别) ? null : 物料类别.Trim();
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        var rows = await c.QueryAsync<AuxiliaryPurchaseAnalysisRow>(@"
WITH 在途 AS (
    SELECT d.[物料编号],
           SUM(CASE WHEN ISNULL(d.[数量],0) - ISNULL(rk.[入仓数量],0) > 0
                    THEN ISNULL(d.[数量],0) - ISNULL(rk.[入仓数量],0)
                    ELSE 0 END) AS 在途数量,
           MAX(o.[供应商名称]) AS 供应商名称
    FROM [采购明细单] d
    JOIN [采购订单] o ON o.[单号] = d.[单号]
    LEFT JOIN (
        SELECT r.[订单单号], r.[物料编号], ISNULL(r.[颜色], N'') AS 颜色键, SUM(ISNULL(r.[数量],0)) AS 入仓数量
        FROM [采购入仓明细单] r
        JOIN [采购入仓单] h ON h.[单号] = r.[单号]
        WHERE ISNULL(h.[审核], '0') = '1'
        GROUP BY r.[订单单号], r.[物料编号], ISNULL(r.[颜色], N'')
    ) rk ON rk.[订单单号] = d.[单号]
        AND rk.[物料编号] = d.[物料编号]
        AND rk.[颜色键] = ISNULL(d.[颜色], N'')
    WHERE ISNULL(o.[审核], '0') = '1'
    GROUP BY d.[物料编号]
),
需领 AS (
    SELECT d.[物料编号],
           SUM(COALESCE(mo.[接单数量], h.[使用数量], 0) * ISNULL(d.[使用数量], 0)) AS 需领数量
    FROM [款号物料总表] h
    JOIN [款号物料明细表] d ON d.[款号] = h.[款号]
    OUTER APPLY (
        SELECT TOP 1 [接单数量]
        FROM [生产通知单MO单] mo
        WHERE mo.[产品货号] = h.[款号]
        ORDER BY mo.[接单日期] DESC, mo.[ID] DESC
    ) mo
    WHERE ISNULL(h.[审核], '0') = '1'
    GROUP BY d.[物料编号]
),
src AS (
    SELECT m.[物料编号] AS 辅料编号,
           MAX(m.[物料名称]) AS 辅料名称,
           MAX(m.[规格]) AS 规格,
           MAX(m.[单位]) AS 单位,
           MAX(ISNULL(m.[库存], 0)) AS 库存数量,
           MAX(ISNULL(t.[在途数量], 0)) AS 在途数量,
           MAX(ISNULL(n.[需领数量], 0)) AS 需领数量,
           MAX(ISNULL(m.[库存], 0)) + MAX(ISNULL(t.[在途数量], 0)) - MAX(ISNULL(n.[需领数量], 0)) AS 可用库存,
           CASE WHEN MAX(ISNULL(n.[需领数量], 0)) - MAX(ISNULL(m.[库存], 0)) - MAX(ISNULL(t.[在途数量], 0)) > 0
                THEN MAX(ISNULL(n.[需领数量], 0)) - MAX(ISNULL(m.[库存], 0)) - MAX(ISNULL(t.[在途数量], 0))
                ELSE 0 END AS 订货数量,
           MAX(ps.[采购损耗率]) AS 采购损耗率,
           COALESCE(NULLIF(MAX(m.[供应商名称]), N''), MAX(t.[供应商名称])) AS 供应商
    FROM (
        -- 混合档案:来料 + 塑胶件(db/68 放开 BOM FK 后,BOM/分析口径一致取两档案;GROUP BY 合并同编号)
        SELECT [物料编号],[物料名称],[规格],[单位],[库存],[供应商名称],[物料类别] FROM [物料资料]
        UNION ALL
        SELECT [物料编号],[物料名称],[规格],[单位],ISNULL([库存],0),[供应商名称],[物料类别] FROM [塑胶物料资料]
    ) m
    LEFT JOIN 在途 t ON t.[物料编号] = m.[物料编号]
    LEFT JOIN 需领 n ON n.[物料编号] = m.[物料编号]
    LEFT JOIN [采购物料设置] ps ON ps.[物料编号] = LTRIM(RTRIM(m.[物料编号]))
    WHERE (@cat IS NULL OR m.[物料类别] = @cat)
      AND (@kw IS NULL OR m.[物料编号] LIKE @kw OR m.[物料名称] LIKE @kw OR m.[规格] LIKE @kw OR m.[供应商名称] LIKE @kw)
    GROUP BY m.[物料编号]
)
SELECT [辅料编号], [辅料名称], [规格], [单位], [库存数量], [在途数量], [需领数量], [可用库存], [订货数量], [采购损耗率], [供应商]
FROM src
WHERE (@onlyBuy = 0 OR [订货数量] > 0)
ORDER BY [辅料编号];", new { cat, kw, onlyBuy = onlyBuy ? 1 : 0 });
        var list = rows.AsList();
        foreach (var r in list)
            r.订货数量 = PurchaseSettings.PurchaseMaterialSettingsService.ApplyLossRate(r.订货数量 ?? 0m, r.采购损耗率);
        return list;
    }

    // Excel 导入:纯校验(必填/列宽/数字/批内去重) → 库内已存在跳过 → 单事务批量 INSERT。
    // 用 Dapper 原生 SQL 而非 EF 实体:实体未映射 [货号]/[最低库存] 列。
    public async Task<MasterData.ImportResult> ImportAsync(IReadOnlyList<MaterialImportRow> rows)
    {
        var (valid, failures, batchDup) = MaterialImportValidator.Validate(rows);
        var result = new MasterData.ImportResult { 失败 = failures.Count, 失败明细 = failures, 跳过 = batchDup };
        if (valid.Count == 0) return result;
        using var c = factory.Create();
        await c.OpenAsync();
        // 库中已存在的编号跳过(排序规则一般为 CI,与校验的忽略大小写去重一致)
        var existing = (await c.QueryAsync<string?>(
            "SELECT [物料编号] FROM [物料资料] WHERE [物料编号] IN @codes;",
            new { codes = valid.Select(v => v.物料编号).ToArray() }))
            .Where(x => x is not null)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        var toInsert = valid.Where(v => !existing.Contains(v.物料编号)).ToList();
        result.跳过 += valid.Count - toInsert.Count;
        if (toInsert.Count > 0)
        {
            using var tx = c.BeginTransaction();
            await c.ExecuteAsync(@"
INSERT INTO [物料资料] ([物料编号],[货号],[物料名称],[规格],[颜色],[单位],[单价],[仓库位置],[备注],[最低库存],[货币])
VALUES (@物料编号,@货号,@物料名称,@规格,@颜色,@单位,@单价,@仓库位置,@备注,@最低库存,@货币);",
                toInsert, tx);
            tx.Commit();
            result.新增 = toInsert.Count;
        }
        return result;
    }
}
