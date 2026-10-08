using Dapper;
using ErpApi.Features.MasterData;
using ErpApi.Features.Materials.MaterialMaster;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Plastics.PlasticMaterialMaster;

// 塑胶物料资料左树 + 右表只读查询。增删改复用 PlasticMaterialController(/api/master/plastic-materials)。
public sealed class PlasticMaterialMasterService(ISqlConnectionFactory factory)
{
    // 左树:塑胶物料类别主数据(带父子) + 仅存在于物料行的类别,扁平返回(父级=父类别编号)由前端组树
    public async Task<IReadOnlyList<PlasticMaterialCategoryNode>> CategoriesAsync()
    {
        using var c = factory.Create();
        var counts = (await c.QueryAsync<PlasticMaterialCategoryNode>(@"
SELECT [物料类别] AS 类别, COUNT(*) AS 数量
FROM [塑胶物料资料]
WHERE [物料类别] IS NOT NULL AND LTRIM(RTRIM([物料类别])) <> ''
GROUP BY [物料类别]
ORDER BY [物料类别];"))
            .Where(x => x.类别 is not null)
            .ToDictionary(x => x.类别!.Trim(), x => x.数量, StringComparer.OrdinalIgnoreCase);
        var master = await c.QueryAsync<MaterialCategoryMasterRow>(@"
SELECT [编号],[名称],[类别] AS 父级 FROM [塑胶物料类别] ORDER BY [编号],[名称];");
        return MaterialCategoryTree.Build(master, counts)
            .Select(n => new PlasticMaterialCategoryNode { 编号 = n.编号, 类别 = n.类别, 数量 = n.数量, 父级 = n.父级 })
            .ToList();
    }

    // 右表:按分类(@类别 空=不过滤;含子级=true 时含该类所有后代类别) + 关键字 + 款号(模糊,如 92125 命中 92119/92125) 过滤分页
    public async Task<PagedResult<PlasticMaterialRow>> ListAsync(string? 类别, string? keyword, int page, int size, bool onlyStock = false, bool 含子级 = false, string? 款号 = null)
    {
        if (page < 1) page = 1;
        if (size < 1) size = 20;
        if (size > 1000) size = 1000;
        var cat = string.IsNullOrWhiteSpace(类别) ? null : 类别.Trim();
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var sty = string.IsNullOrWhiteSpace(款号) ? null : $"%{款号.Trim()}%";
        using var c = factory.Create();
        var cats = cat is null ? Array.Empty<string>() : new[] { cat };
        if (cat is not null && 含子级)
        {
            var master = await c.QueryAsync<MaterialCategoryMasterRow>(
                "SELECT [编号],[名称],[类别] AS 父级 FROM [塑胶物料类别];");
            cats = MaterialCategoryTree.SubtreeKeys(master, cat).ToArray();
        }
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [塑胶物料资料]
WHERE (@cat IS NULL OR [物料类别] IN @cats)
  AND (@kw IS NULL OR [物料编号] LIKE @kw OR [物料名称] LIKE @kw OR [规格] LIKE @kw OR [颜色] LIKE @kw OR [供应商名称] LIKE @kw)
  AND (@sty IS NULL OR [款号] LIKE @sty)
  AND (@onlyStock = 0 OR ISNULL([库存],0) > 0);
SELECT [ID],[物料类别],[物料编号],[客户],[款号],[工模编号],[物料名称],[颜色],[色粉号],[原料名称],[用料名称],[加工内容],[加工总单价],[二次加工],[二次加工价],[整啤净重],[原胶件单净重],[整啤模腔数],[套数],[出模数],[用量],[啤机机型],[模具日产量],[啤机价钱],[胶件啤工价],[原料单价],[胶件料价],[其他成本],[规格],[单位],[仓位号],[单价],[销售价],[库存],[最低库存],[最高库存],[供应商编号],[供应商名称],[备注]
FROM [塑胶物料资料]
WHERE (@cat IS NULL OR [物料类别] IN @cats)
  AND (@kw IS NULL OR [物料编号] LIKE @kw OR [物料名称] LIKE @kw OR [规格] LIKE @kw OR [颜色] LIKE @kw OR [供应商名称] LIKE @kw)
  AND (@sty IS NULL OR [款号] LIKE @sty)
  AND (@onlyStock = 0 OR ISNULL([库存],0) > 0)
ORDER BY [物料编号] OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;",
            new { cat, cats, kw, sty, page, size, onlyStock = onlyStock ? 1 : 0 });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<PlasticMaterialRow>()).AsList();
        return new PagedResult<PlasticMaterialRow>(items, total);
    }

    // Excel 导入:纯校验(必填/列宽/数字/批内去重) → 库内已存在跳过 → 单事务批量 INSERT。
    public async Task<MasterData.ImportResult> ImportAsync(IReadOnlyList<PlasticMaterialImportRow> rows)
    {
        var (valid, failures, batchDup) = PlasticMaterialImportValidator.Validate(rows);
        var result = new MasterData.ImportResult { 失败 = failures.Count, 失败明细 = failures, 跳过 = batchDup };
        if (valid.Count == 0) return result;
        using var c = factory.Create();
        await c.OpenAsync();
        // 库中已存在的编号跳过(排序规则一般为 CI,与校验的忽略大小写去重一致)
        var existing = (await c.QueryAsync<string?>(
            "SELECT [物料编号] FROM [塑胶物料资料] WHERE [物料编号] IN @codes;",
            new { codes = valid.Select(v => v.物料编号).ToArray() }))
            .Where(x => x is not null)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        var toInsert = valid.Where(v => !existing.Contains(v.物料编号)).ToList();
        result.跳过 += valid.Count - toInsert.Count;
        if (toInsert.Count > 0)
        {
            using var tx = c.BeginTransaction();
            await c.ExecuteAsync(@"
INSERT INTO [塑胶物料资料] ([物料编号],[工模编号],[客户],[款号],[物料名称],[颜色],[色粉号],[原料名称],[用料名称],[加工内容],[二次加工],[啤机机型],[单位],[单价],[二次加工价],[加工总单价],[整啤毛重],[整啤净重],[原胶件单净重],[整啤模腔数],[套数],[出模数],[用量],[水口比例],[模具日产量],[啤机价钱],[胶件啤工价],[原料单价],[胶件料价],[原胶料单价],[其他成本],[货币],[备注])
VALUES (@物料编号,@工模编号,@客户,@款号,@物料名称,@颜色,@色粉号,@原料名称,@用料名称,@加工内容,@二次加工,@啤机机型,@单位,@单价,@二次加工价,@加工总单价,@整啤毛重,@整啤净重,@原胶件单净重,@整啤模腔数,@套数,@出模数,@用量,@水口比例,@模具日产量,@啤机价钱,@胶件啤工价,@原料单价,@胶件料价,@原胶料单价,@其他成本,@货币,@备注);",
                toInsert, tx);
            tx.Commit();
            result.新增 = toInsert.Count;
        }
        return result;
    }
}
