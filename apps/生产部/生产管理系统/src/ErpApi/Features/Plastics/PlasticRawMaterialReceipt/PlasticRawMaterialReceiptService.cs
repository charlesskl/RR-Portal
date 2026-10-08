using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.MasterData;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Plastics.PlasticRawMaterialReceipt;

// 原料入仓单(原料仓库·实物入库)。v1 审核 = 纯锁定(走通用过账引擎只翻 审核='1',不动库存;库存台账延后)。
public sealed class PlasticRawMaterialReceiptService(ISqlConnectionFactory factory, IDocumentNumberGenerator docNo)
{
    public const string DocType = "原料入仓单";
    public const string Prefix = "YRC";   // 原料入仓单号 = YRC + yyyyMMdd + 3位流水

    public async Task<string> CreateAsync(PlasticRawMaterialReceiptCreateDto dto, string user)
    {
        if (dto.明细.Count == 0) throw new ArgumentException("原料入仓单至少要有一行明细");
        var 数量合计 = dto.明细.Sum(l => l.数量);
        var 金额合计 = dto.明细.Sum(l => l.数量 * (l.单价 ?? 0m));
        var now = DateTime.Now;

        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        // 保存即拦：入仓数量不得超过原料采购订单订货数量(备品行除外)
        await ValidateOrderQtyAsync(c, tx, dto.订单单号, dto.明细.Select(l => (l.原料编号, l.数量, l.备品)));

        var 单号 = await docNo.NextAsync(DocType, Prefix, now, c, tx);

        await c.ExecuteAsync(@"
INSERT INTO [原料入仓单]([单号],[供应商编号],[供应商名称],[日期],[电脑单号],[订单单号],[单价类型],[数量],[金额],[操作员],[审核],[备注])
VALUES(@单号,@供应商编号,@供应商名称,@日期,@电脑单号,@订单单号,@单价类型,@数量,@金额,@操作员,'0',@备注)",
            new { 单号, dto.供应商编号, dto.供应商名称, 日期 = now, dto.电脑单号, dto.订单单号, dto.单价类型,
                  数量 = 数量合计, 金额 = 金额合计, 操作员 = user, dto.备注 }, tx);

        foreach (var l in dto.明细)
            await c.ExecuteAsync(@"
INSERT INTO [原料入仓明细单]([单号],[原料编号],[原料名称],[产地],[每包重量],[单价类型],[单位],[数量],[单价],[金额],[备注],[备品])
VALUES(@单号,@原料编号,@原料名称,@产地,@每包重量,@单价类型,@单位,@数量,@单价,@金额,@备注,@备品)",
                new { 单号, l.原料编号, l.原料名称, l.产地, l.每包重量, l.单价类型, l.单位, l.数量, l.单价,
                      金额 = l.数量 * (l.单价 ?? 0m), l.备注, 备品 = l.备品 == "1" ? "1" : "0" }, tx);

        tx.Commit();
        return 单号;
    }

    public async Task<PagedResult<PlasticRawMaterialReceiptHeaderDto>> ListAsync(int page, int size, string? keyword)
    {
        if (page < 1) page = 1;
        if (size < 1) size = 20;
        if (size > 1000) size = 1000;
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [原料入仓单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [供应商名称] LIKE @kw;
SELECT [ID],[单号],[供应商编号],[供应商名称],[日期],[电脑单号],[订单单号],[单价类型],[数量],[金额],[操作员],[审核],[审核人],[备注]
FROM [原料入仓单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [供应商名称] LIKE @kw
ORDER BY [ID] DESC OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;", new { kw, page, size });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<PlasticRawMaterialReceiptHeaderDto>()).AsList();
        return new PagedResult<PlasticRawMaterialReceiptHeaderDto>(items, total);
    }

    public async Task<PlasticRawMaterialReceiptDetailDto?> GetAsync(string 单号)
    {
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT [ID],[单号],[供应商编号],[供应商名称],[日期],[电脑单号],[订单单号],[单价类型],[数量],[金额],[操作员],[审核],[审核人],[备注]
FROM [原料入仓单] WHERE [单号]=@单号;
SELECT [ID],[原料编号],[原料名称],[产地],[每包重量],[单价类型],[单位],[数量],[单价],[金额],[备注],[备品]
FROM [原料入仓明细单] WHERE [单号]=@单号 ORDER BY [ID];", new { 单号 });
        var header = await multi.ReadFirstOrDefaultAsync<PlasticRawMaterialReceiptHeaderDto>();
        if (header is null) return null;
        var lines = (await multi.ReadAsync<PlasticRawMaterialReceiptLineDto>()).AsList();
        return new PlasticRawMaterialReceiptDetailDto { 单头 = header, 明细 = lines };
    }

    public async Task<bool> DeleteAsync(string 单号)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [原料入仓单] WITH (UPDLOCK, HOLDLOCK) WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null) return false;
        if (审核 == "1") throw new InvalidOperationException("已审核的原料入仓单不能删除，请先反审核。");
        await c.ExecuteAsync("DELETE FROM [原料入仓明细单] WHERE [单号]=@单号", new { 单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [原料入仓单] WHERE [单号]=@单号", new { 单号 }, tx);
        tx.Commit();
        return true;
    }

    // ===== 订单可入仓数量校验(保存 CreateAsync + 审核 Controller approve 两道都拦) =====
    // 原料入仓明细单 无 订单单号 列,订单号取单头;口径同 PlasticRawMaterialPurchaseOrderService.ProgressAsync:
    // 已审核入仓累计按 单头订单单号+原料编号 聚合,只看入仓明细不减退仓。
    // 只校验 订单单号 非空且该单号确实存在于 [原料采购订单] 的单;其余放行。
    // 备品='1' 的行(供应商多送的备品)跳过超量拦截,也不计入「已入仓」累计(不顶欠数、不把进度顶超)。
    private static async Task ValidateOrderQtyAsync(
        System.Data.IDbConnection c, System.Data.IDbTransaction? tx, string? 订单单号,
        IEnumerable<(string? 原料编号, decimal 数量, string? 备品)> lines)
    {
        if (string.IsNullOrWhiteSpace(订单单号)) return;
        订单单号 = 订单单号.Trim();
        var 订单存在 = await c.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM [原料采购订单] WHERE [单号]=@订单单号", new { 订单单号 }, tx) > 0;
        if (!订单存在) return;
        // 本单内同一原料多行先汇总再判定;备品行不参与
        var groups = lines
            .Where(l => !string.IsNullOrWhiteSpace(l.原料编号) && l.备品 != "1")
            .GroupBy(l => l.原料编号!.Trim())
            .Select(g => (原料编号: g.Key, 本次: g.Sum(x => x.数量)));
        foreach (var g in groups)
        {
            var 订购 = await c.ExecuteScalarAsync<decimal?>(@"
SELECT SUM([订货数量]) FROM [原料采购订单明细] WHERE [单号]=@订单单号 AND [原料编号]=@原料编号",
                new { 订单单号, g.原料编号 }, tx) ?? 0;
            var 已入仓 = await c.ExecuteScalarAsync<decimal?>(@"
SELECT SUM(d.[数量]) FROM [原料入仓明细单] d
JOIN [原料入仓单] h ON h.[单号]=d.[单号]
WHERE ISNULL(h.[审核],'0')='1' AND ISNULL(d.[备品],'0')<>'1' AND h.[订单单号]=@订单单号 AND d.[原料编号]=@原料编号",
                new { 订单单号, g.原料编号 }, tx) ?? 0;
            if (已入仓 + g.本次 > 订购)
                throw new InvalidOperationException(
                    $"原料 {g.原料编号} 超出订单 {订单单号} 可入仓数量：订购 {Fmt(订购)}，已入仓 {Fmt(已入仓)}，本次 {Fmt(g.本次)}，超 {Fmt(已入仓 + g.本次 - 订购)}。");
        }
    }

    // 审核前校验(approve 端点调用):此刻本单 审核='0',不计入已入仓累计,无需排除本单。
    public async Task ValidateOrderQtyAsync(string 单号)
    {
        using var c = factory.Create();
        var 订单单号 = await c.ExecuteScalarAsync<string?>(
            "SELECT [订单单号] FROM [原料入仓单] WHERE [单号]=@单号", new { 单号 });
        var lines = await c.QueryAsync<(string? 原料编号, decimal 数量, string? 备品)>(
            "SELECT [原料编号],ISNULL([数量],0) AS [数量],ISNULL([备品],'0') AS [备品] FROM [原料入仓明细单] WHERE [单号]=@单号", new { 单号 });
        await ValidateOrderQtyAsync(c, null, 订单单号, lines);
    }

    private static string Fmt(decimal v) => v.ToString("0.####");

    private static string ApprovalFilter(string? 审核情况) => 审核情况 switch
    {
        "已审核" => " AND ISNULL(h.[审核],'0')='1'",
        "未审核" => " AND ISNULL(h.[审核],'0')<>'1'",
        _ => "",
    };

    public async Task<IReadOnlyList<PlasticRawMaterialReceiptQueryDetailRow>> ReceiptQueryDetailAsync(
        DateTime 起, DateTime 止, string? keyword, string? 审核情况, string? 物料类别)
    {
        var qi = 起.Date;
        var qe = 止.Date.AddDays(1);
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var cat = string.IsNullOrWhiteSpace(物料类别) || 物料类别 == "所有类别" ? null : 物料类别.Trim();
        using var c = factory.Create();
        var rows = await c.QueryAsync<PlasticRawMaterialReceiptQueryDetailRow>($@"
SELECT h.[日期],
       d.[单号],
       h.[电脑单号] AS 入库单号,
       h.[订单单号],
       h.[供应商编号],
       h.[供应商名称],
       d.[原料编号],
       d.[原料名称],
       d.[产地],
       d.[单价类型],
       d.[单位],
       d.[数量],
       d.[单价],
       d.[金额],
       d.[备注],
       h.[审核]
FROM [原料入仓明细单] d
JOIN [原料入仓单] h ON h.[单号] = d.[单号]
LEFT JOIN [塑胶原料资料] m ON m.[物料编号] = d.[原料编号]
WHERE h.[日期] >= @qi AND h.[日期] < @qe
  AND (@cat IS NULL OR m.[物料类别] = @cat)
  AND (@kw IS NULL OR d.[原料编号] LIKE @kw OR d.[原料名称] LIKE @kw OR h.[单号] LIKE @kw
       OR h.[电脑单号] LIKE @kw OR h.[订单单号] LIKE @kw OR h.[供应商编号] LIKE @kw OR h.[供应商名称] LIKE @kw)
{ApprovalFilter(审核情况)}
ORDER BY h.[日期] DESC, d.[单号], d.[ID];", new { qi, qe, kw, cat });
        return rows.AsList();
    }

    public async Task<IReadOnlyList<PlasticRawMaterialReceiptQuerySummaryRow>> ReceiptQuerySummaryAsync(
        DateTime 起, DateTime 止, string? keyword, string? 审核情况, string? 物料类别)
    {
        var qi = 起.Date;
        var qe = 止.Date.AddDays(1);
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var cat = string.IsNullOrWhiteSpace(物料类别) || 物料类别 == "所有类别" ? null : 物料类别.Trim();
        using var c = factory.Create();
        var rows = await c.QueryAsync<PlasticRawMaterialReceiptQuerySummaryRow>($@"
SELECT d.[原料编号],
       MAX(d.[原料名称]) AS 原料名称,
       MAX(d.[产地]) AS 产地,
       MAX(d.[单位]) AS 单位,
       SUM(ISNULL(d.[数量],0)) AS 入仓数量,
       SUM(ISNULL(d.[金额],0)) AS 金额
FROM [原料入仓明细单] d
JOIN [原料入仓单] h ON h.[单号] = d.[单号]
LEFT JOIN [塑胶原料资料] m ON m.[物料编号] = d.[原料编号]
WHERE h.[日期] >= @qi AND h.[日期] < @qe
  AND (@cat IS NULL OR m.[物料类别] = @cat)
  AND (@kw IS NULL OR d.[原料编号] LIKE @kw OR d.[原料名称] LIKE @kw OR h.[单号] LIKE @kw
       OR h.[电脑单号] LIKE @kw OR h.[订单单号] LIKE @kw OR h.[供应商编号] LIKE @kw OR h.[供应商名称] LIKE @kw)
{ApprovalFilter(审核情况)}
GROUP BY d.[原料编号]
ORDER BY d.[原料编号];", new { qi, qe, kw, cat });
        return rows.AsList();
    }
}
