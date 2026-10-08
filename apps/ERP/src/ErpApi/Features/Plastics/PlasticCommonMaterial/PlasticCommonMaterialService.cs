using Dapper;
using ErpApi.Features.MasterData;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Plastics.PlasticCommonMaterial;

// 塑胶共用物料表过滤列表只读。增删改复用 PlasticCommonMaterialController(/api/master/plastic-common-materials)。
public sealed class PlasticCommonMaterialService(ISqlConnectionFactory factory)
{
    public async Task<PagedResult<PlasticCommonMaterialRow>> ListAsync(
        string? 客户, string? 塑胶货号, string? 工模编号, string? keyword, string? 审核情况, int page, int size)
    {
        if (page < 1) page = 1;
        if (size < 1) size = 20;
        if (size > 1000) size = 1000;
        var cust = string.IsNullOrWhiteSpace(客户) ? null : 客户.Trim();
        var goods = string.IsNullOrWhiteSpace(塑胶货号) ? null : 塑胶货号.Trim();
        var mold = string.IsNullOrWhiteSpace(工模编号) ? null : 工模编号.Trim();
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync($@"
SELECT COUNT(*) FROM [塑胶共用物料表]
WHERE (@cust IS NULL OR [客户] = @cust)
  AND (@goods IS NULL OR [塑胶货号] = @goods)
  AND (@mold IS NULL OR [工模编号] = @mold)
  AND (@kw IS NULL OR [物料编号] LIKE @kw OR [物料名称] LIKE @kw OR [用料名称] LIKE @kw OR [共用原料编号] LIKE @kw){ApprovalFilter(审核情况)};
SELECT [ID],[客户],[塑胶货号],[工模编号],[物料名称],[颜色],[色粉号],[用料名称],[加工内容],[加工单价],
       [整啤净重],[原胶件单净重],[整啤模腔数],[套数],[用量],[物料编号],[共用原料编号],[调整审核],[备注内容],[工模表备注],
       [出模数],[水口比例],[整啤毛重],[模具日产量],[啤机机型],[啤机价钱],[胶件啤工价],[胶料单价],[原胶料单价],
       [加工总单价],[其它成本],[二次加工内容]
FROM [塑胶共用物料表]
WHERE (@cust IS NULL OR [客户] = @cust)
  AND (@goods IS NULL OR [塑胶货号] = @goods)
  AND (@mold IS NULL OR [工模编号] = @mold)
  AND (@kw IS NULL OR [物料编号] LIKE @kw OR [物料名称] LIKE @kw OR [用料名称] LIKE @kw OR [共用原料编号] LIKE @kw){ApprovalFilter(审核情况)}
ORDER BY [塑胶货号],[工模编号],[ID] OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;",
            new { cust, goods, mold, kw, page, size });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<PlasticCommonMaterialRow>()).AsList();
        return new PagedResult<PlasticCommonMaterialRow>(items, total);
    }

    // 审核情况过滤片段(对 调整审核):已审核='1'；未审核≠'1'；其它/空=全部。
    private static string ApprovalFilter(string? 审核情况) => 审核情况 switch
    {
        "已审核" => " AND ISNULL([调整审核],'0') = '1'",
        "未审核" => " AND ISNULL([调整审核],'0') <> '1'",
        _ => "",
    };
}
