using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.MasterData;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Assembly;

// 装配加工采购单。头 + BOM物料快照明细 + 生产明细。
// 快照语义: 保存时把当时按款号BOM展开的辅料行原样落入 [装配加工采购单明细];
// 之后取单只读快照,不实时展开 BOM —— 修改半成品BOM只对之后新开的装配采购单生效。
// 审核 = 纯锁定(走通用过账引擎只翻 审核='1',不动库存)。
public sealed class AssemblyPurchaseOrderService(ISqlConnectionFactory factory, IDocumentNumberGenerator docNo)
{
    public const string DocType = "装配加工采购单";
    public const string Prefix = "ZP";   // 装配加工采购单号 = ZP + yyyyMMdd + 3位流水

    public async Task<PagedResult<AssemblyPurchaseOrderHeaderRow>> ListAsync(int page, int size, string? keyword)
    {
        if (page < 1) page = 1;
        if (size < 1) size = 50;
        if (size > 1000) size = 1000;
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [装配加工采购单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [供应商名称] LIKE @kw OR [客户名称] LIKE @kw;
SELECT [ID],[单号],[日期],[供应商编号],[供应商名称],[客户编号],[客户名称],[收货仓库],[电脑单号],[装配方式],
       [开始交货日期],[每天交货],[完成日期],[收货人],[单价],[数量],[金额],[操作员],[审核],[审核人],[审核日期],[备注],[主管审核],[主管审核人],[经理审核],[经理审核人]
FROM [装配加工采购单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [供应商名称] LIKE @kw OR [客户名称] LIKE @kw
ORDER BY [ID] DESC OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;", new { kw, page, size });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<AssemblyPurchaseOrderHeaderRow>()).AsList();
        return new PagedResult<AssemblyPurchaseOrderHeaderRow>(items, total);
    }

    public async Task<AssemblyPurchaseOrderDetailDto?> GetAsync(string 单号)
    {
        if (string.IsNullOrWhiteSpace(单号)) return null;
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT o.[ID],o.[单号],o.[日期],o.[供应商编号],o.[供应商名称],o.[客户编号],o.[客户名称],o.[收货仓库],o.[电脑单号],o.[装配方式],
       o.[开始交货日期],o.[每天交货],o.[完成日期],o.[收货人],o.[单价],o.[数量],o.[金额],o.[操作员],o.[审核],o.[审核人],o.[审核日期],o.[备注],o.[主管审核],o.[主管审核人],o.[经理审核],o.[经理审核人],
       s.[联系人] AS [供应商联系人],s.[电话] AS [供应商电话],s.[传真] AS [供应商传真]
FROM [装配加工采购单] o
LEFT JOIN [供应商资料] s ON s.[供应商编号]=o.[供应商编号]
WHERE o.[单号]=@单号;
SELECT [行号],[接单日期],[生产单号],[款号],[产品名称],[配件编号],[产品装配名称],[加工数量],[单价],[金额],
       [客户编号],[客户名称],[装配方式],[备注]
FROM [装配加工采购单生产明细] WHERE [单号]=@单号 ORDER BY [行号],[ID];
SELECT [行号],[生产单号],[款号],[物料编号],[物料名称],[单位],[用量],[需求数量],[单价],[金额],[备注]
FROM [装配加工采购单明细] WHERE [单号]=@单号 ORDER BY [行号],[ID];", new { 单号 });
        var h = await multi.ReadFirstOrDefaultAsync<AssemblyPurchaseOrderHeaderRow>();
        if (h is null) return null;
        var production = (await multi.ReadAsync<AssemblyPurchaseOrderProductionLineDto>()).AsList();
        var materials = (await multi.ReadAsync<AssemblyPurchaseOrderMaterialLineDto>()).AsList();

        // 页面三格结构: 单头 + 产品明细(按生产明细逐行还原,行级客户/装配方式/备注为空时回落单头) + 生产明细 + 辅料表(快照)
        var 头客户 = string.Join("，", new[] { h.客户编号, h.客户名称 }.Where(s => !string.IsNullOrWhiteSpace(s)));
        var head = new AssemblyPurchaseOrderHeaderDto
        {
            单号 = h.单号,
            供应商编号 = h.供应商编号,
            供应商名称 = h.供应商名称,
            出单日期 = h.日期,
            单价 = h.单价,
            金额 = h.金额,
            收货仓库 = h.收货仓库,
            电脑单号 = h.电脑单号 ?? h.单号,
            客户 = 头客户.Length > 0 ? 头客户 : null,
            备注 = h.备注,
            开始交货日期 = h.开始交货日期,
            每天交货 = h.每天交货,
            完成日期 = h.完成日期,
            收货人 = h.收货人,
            审核 = h.审核,
            主管审核 = h.主管审核,
            主管审核人 = h.主管审核人,
            经理审核 = h.经理审核,
            经理审核人 = h.经理审核人,
            操作员 = h.操作员,
            供应商联系人 = h.供应商联系人,
            供应商电话 = h.供应商电话,
            供应商传真 = h.供应商传真,
        };
        var products = production.Select(p =>
        {
            var 客户 = string.Join("，", new[]
            {
                string.IsNullOrWhiteSpace(p.客户编号) ? h.客户编号 : p.客户编号,
                string.IsNullOrWhiteSpace(p.客户名称) ? h.客户名称 : p.客户名称,
            }.Where(s => !string.IsNullOrWhiteSpace(s)));
            return new AssemblyPurchaseProductLineDto
            {
                客户 = 客户.Length > 0 ? 客户 : null,
                产品货号 = p.款号,
                产品装配名称 = p.产品装配名称 ?? p.产品名称,
                配件编号 = p.配件编号,
                装配方式 = string.IsNullOrWhiteSpace(p.装配方式) ? h.装配方式 : p.装配方式,
                加工数量 = p.加工数量,
                备注 = string.IsNullOrWhiteSpace(p.备注) ? h.备注 : p.备注,
            };
        }).ToList();
        var productionLines = production.Select(p => new AssemblyPurchaseProductionLineDto
        {
            接单日期 = DateTime.TryParse(p.接单日期, out var d) ? d : null,
            生产单号 = p.生产单号,
            产品货号 = p.款号,
            产品名称 = p.产品名称,
            配件编号 = p.配件编号,
            产品装配名称 = p.产品装配名称,
            加工数量 = p.加工数量,
            单价 = p.单价,
            金额 = p.金额,
        }).ToList();
        var accessories = materials.Select(m =>
        {
            var isGram = (m.单位 ?? "").Contains('g', StringComparison.OrdinalIgnoreCase) || (m.单位 ?? "").Contains('克');
            return new AssemblyPurchaseAccessoryLineDto
            {
                序号 = m.行号,
                辅料编号 = m.物料编号,
                辅料名称 = m.物料名称,
                加工总数量 = h.数量,
                单个产品需求量 = m.用量,
                需求数克 = isGram ? m.需求数量 : null,
                需求数个 = isGram ? null : m.需求数量,
            };
        }).ToList();

        return new AssemblyPurchaseOrderDetailDto { 单头 = head, 产品明细 = products, 生产明细 = productionLines, 辅料表 = accessories };
    }

    public async Task<string> CreateAsync(AssemblyPurchaseOrderSaveDto dto, string user)
    {
        Validate(dto);
        var now = DateTime.Now;
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 单号 = await docNo.NextAsync(DocType, Prefix, dto.出单日期 ?? now, c, tx);
        await InsertDocAsync(c, tx, 单号, dto, user, now);
        await RememberPricesAsync(c, tx, dto, user);
        tx.Commit();
        return 单号;
    }

    public async Task<bool> UpdateAsync(string 单号, AssemblyPurchaseOrderSaveDto dto, string user)
    {
        Validate(dto);
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var row = await c.QueryFirstOrDefaultAsync<(string? 审核, DateTime? 日期)>(
            "SELECT ISNULL([审核],'0') AS [审核], [日期] FROM [装配加工采购单] WITH (UPDLOCK, HOLDLOCK) WHERE [单号]=@单号", new { 单号 }, tx);
        if (row.日期 is null) return false;   // 单头必有日期,日期为空 = 单不存在
        if (row.审核 == "1") throw new InvalidOperationException("已审核的委托加工单不能修改，请先反审核。");

        await c.ExecuteAsync("DELETE FROM [装配加工采购单明细] WHERE [单号]=@单号", new { 单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [装配加工采购单生产明细] WHERE [单号]=@单号", new { 单号 }, tx);
        var (数量, 金额) = Totals(dto);
        await c.ExecuteAsync(@"
UPDATE [装配加工采购单]
   SET [日期]=@日期,[供应商编号]=@供应商编号,[供应商名称]=@供应商名称,[客户编号]=@客户编号,[客户名称]=@客户名称,
       [收货仓库]=@收货仓库,[电脑单号]=@电脑单号,[装配方式]=@装配方式,
       [开始交货日期]=@开始交货日期,[每天交货]=@每天交货,[完成日期]=@完成日期,[收货人]=@收货人,
       [单价]=@单价,[数量]=@数量,[金额]=@金额,[备注]=@备注
 WHERE [单号]=@单号",
            new { 单号, 日期 = dto.出单日期 ?? row.日期 ?? DateTime.Now, dto.供应商编号, dto.供应商名称, dto.客户编号, dto.客户名称,
                  dto.收货仓库, dto.电脑单号, dto.装配方式, dto.开始交货日期, dto.每天交货, dto.完成日期, dto.收货人,
                  dto.单价, 数量, 金额, dto.备注 }, tx);
        await InsertLinesAsync(c, tx, 单号, dto);
        await RememberPricesAsync(c, tx, dto, user);
        tx.Commit();
        return true;
    }

    // 单价记忆:生产明细里有单价的行按货号记录最近单价(同货号多行取最后一行),
    // 下次委托加工单选半成品/物料入行自动带出(db/132_processing_price_memory.sql)
    private static async Task RememberPricesAsync(System.Data.IDbConnection c, System.Data.IDbTransaction tx,
        AssemblyPurchaseOrderSaveDto dto, string user)
    {
        foreach (var g in dto.生产明细
            .Where(l => !string.IsNullOrWhiteSpace(l.款号) && l.单价 != null)
            .GroupBy(l => l.款号!.Trim()))
            await c.ExecuteAsync(@"
MERGE [加工单价记忆] AS t
USING (SELECT @货号 AS [货号]) s ON t.[货号]=s.[货号]
WHEN MATCHED THEN UPDATE SET [单价]=@单价,[更新时间]=SYSDATETIME(),[操作员]=@操作员
WHEN NOT MATCHED THEN INSERT ([货号],[单价],[操作员]) VALUES(@货号,@单价,@操作员);",
                new { 货号 = g.Key, 单价 = g.Last().单价, 操作员 = user }, tx);
    }

    public async Task<bool> DeleteAsync(string 单号)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [装配加工采购单] WITH (UPDLOCK, HOLDLOCK) WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null) return false;
        if (审核 == "1") throw new InvalidOperationException("已审核的委托加工单不能删除，请先反审核。");
        await c.ExecuteAsync("DELETE FROM [装配加工采购单明细] WHERE [单号]=@单号", new { 单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [装配加工采购单生产明细] WHERE [单号]=@单号", new { 单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [装配加工采购单] WHERE [单号]=@单号", new { 单号 }, tx);
        tx.Commit();
        return true;
    }

    private static void Validate(AssemblyPurchaseOrderSaveDto dto)
    {
        if (dto.生产明细.Count == 0 && dto.物料明细.Count == 0)
            throw new ArgumentException("委托加工单至少要有一行生产明细或物料明细");
    }

    private static (decimal 数量, decimal 金额) Totals(AssemblyPurchaseOrderSaveDto dto)
    {
        var 数量 = dto.生产明细.Sum(l => l.加工数量 ?? 0m);
        var 金额 = dto.生产明细.Sum(l => (l.加工数量 ?? 0m) * (l.单价 ?? 0m));
        return (数量, 金额);
    }

    private async Task InsertDocAsync(System.Data.IDbConnection c, System.Data.IDbTransaction tx,
        string 单号, AssemblyPurchaseOrderSaveDto dto, string user, DateTime now)
    {
        var (数量, 金额) = Totals(dto);
        await c.ExecuteAsync(@"
INSERT INTO [装配加工采购单]([单号],[日期],[供应商编号],[供应商名称],[客户编号],[客户名称],[收货仓库],[电脑单号],[装配方式],
    [开始交货日期],[每天交货],[完成日期],[收货人],[单价],[数量],[金额],[操作员],[审核],[备注])
VALUES(@单号,@日期,@供应商编号,@供应商名称,@客户编号,@客户名称,@收货仓库,@电脑单号,@装配方式,
    @开始交货日期,@每天交货,@完成日期,@收货人,@单价,@数量,@金额,@操作员,'0',@备注)",
            new { 单号, 日期 = dto.出单日期 ?? now, dto.供应商编号, dto.供应商名称, dto.客户编号, dto.客户名称,
                  dto.收货仓库, dto.电脑单号, dto.装配方式, dto.开始交货日期, dto.每天交货, dto.完成日期, dto.收货人,
                  dto.单价, 数量, 金额, 操作员 = user, dto.备注 }, tx);
        await InsertLinesAsync(c, tx, 单号, dto);
    }

    private static async Task InsertLinesAsync(System.Data.IDbConnection c, System.Data.IDbTransaction tx,
        string 单号, AssemblyPurchaseOrderSaveDto dto)
    {
        var 行号 = 0;
        foreach (var l in dto.生产明细)
            await c.ExecuteAsync(@"
INSERT INTO [装配加工采购单生产明细]([单号],[行号],[接单日期],[生产单号],[款号],[产品名称],[配件编号],[产品装配名称],[加工数量],[单价],[金额],[客户编号],[客户名称],[装配方式],[备注])
VALUES(@单号,@行号,@接单日期,@生产单号,@款号,@产品名称,@配件编号,@产品装配名称,@加工数量,@单价,@金额,@客户编号,@客户名称,@装配方式,@备注)",
                new { 单号, 行号 = ++行号, l.接单日期, l.生产单号, l.款号, l.产品名称, l.配件编号, l.产品装配名称,
                      l.加工数量, l.单价, 金额 = (l.加工数量 ?? 0m) * (l.单价 ?? 0m),
                      l.客户编号, l.客户名称, l.装配方式, l.备注 }, tx);

        var 首行 = dto.生产明细.FirstOrDefault();
        行号 = 0;
        foreach (var l in dto.物料明细)
        {
            var 需求 = l.需求数量 ?? 0m;
            await c.ExecuteAsync(@"
INSERT INTO [装配加工采购单明细]([单号],[行号],[生产单号],[款号],[物料编号],[物料名称],[单位],[用量],[需求数量],[单价],[金额],[备注])
VALUES(@单号,@行号,@生产单号,@款号,@物料编号,@物料名称,@单位,@用量,@需求数量,@单价,@金额,@备注)",
                new { 单号, 行号 = ++行号,
                      生产单号 = l.生产单号 ?? 首行?.生产单号, 款号 = l.款号 ?? 首行?.款号,
                      l.物料编号, l.物料名称, l.单位, l.用量, 需求数量 = 需求,
                      l.单价, 金额 = 需求 * (l.单价 ?? 0m), l.备注 }, tx);
        }
    }
}
