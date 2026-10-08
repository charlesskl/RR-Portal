using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.MasterData;
using ErpApi.Infrastructure.Db;
using ErpApi.Integrations.Paiji;
namespace ErpApi.Features.Plastics.PlasticReceipt;

// 塑胶入仓单。两层:塑胶入仓单 + 塑胶入仓明细单。审核后由 PlasticInventoryService 实时聚合入库存。
public sealed class PlasticReceiptService(ISqlConnectionFactory factory, IDocumentNumberGenerator docNo,
    PaijiPushService paiji)
{
    public const string DocType = "塑胶入仓单";
    public const string Prefix = "SR";   // 塑胶入仓单号 = SR + yyyyMMdd + 3位流水

    public async Task<string> CreateAsync(PlasticReceiptCreateDto dto, string user)
    {
        if (dto.明细.Count == 0) throw new ArgumentException("塑胶入仓单至少要有一行物料明细");
        if (string.IsNullOrWhiteSpace(dto.仓库)) throw new ArgumentException("塑胶入仓单必须指定仓库");
        var 数量合计 = dto.明细.Sum(l => l.数量);
        var 金额合计 = dto.明细.Sum(l => l.数量 * (l.单价 ?? 0));
        var now = DateTime.Now;

        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        // 保存即拦：入仓数量不得超过塑胶采购订单订购数量(明细 订单单号 空则回落单头,与建单口径一致;备品行除外)
        await ValidateOrderQtyAsync(c, tx, dto.明细.Select(l => (l.订单单号 ?? dto.订单单号, l.物料编号, l.颜色, l.数量, l.备品)));

        var 单号 = string.IsNullOrWhiteSpace(dto.单号)
            ? await docNo.NextAsync(DocType, Prefix, now, c, tx)
            : dto.单号.Trim();
        // 送货单号全表唯一：同一张送货单不能重复入仓
        if (!string.IsNullOrWhiteSpace(dto.单号))
        {
            var dup = await c.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM [塑胶入仓单] WHERE [单号]=@单号", new { 单号 }, tx);
            if (dup > 0) throw new InvalidOperationException($"入仓单号「{单号}」已存在，同一张送货单不能重复入仓。");
        }

        await c.ExecuteAsync(@"
INSERT INTO [塑胶入仓单]([单号],[日期],[供应商编号],[供应商名称],[仓库],[数量],[金额],[操作员],[审核],[备注],[出库单号],[入仓单号],[电脑单号],[订单单号])
VALUES(@单号,@日期,@供应商编号,@供应商名称,@仓库,@数量,@金额,@操作员,'0',@备注,@出库单号,@入仓单号,@电脑单号,@订单单号)",
            new { 单号, 日期 = now, dto.供应商编号, dto.供应商名称, dto.仓库,
                  数量 = 数量合计, 金额 = 金额合计, 操作员 = user, dto.备注,
                  dto.出库单号, dto.入仓单号, dto.电脑单号, dto.订单单号 }, tx);

        // 已加工工序快照：明细 订单单号 指向塑胶采购订单时,取订单明细加工内容 回落 单头加工内容(逐键查一次缓存)
        var 加工缓存 = new Dictionary<string, string?>();
        async Task<string?> 订单加工内容Async(string? 订单单号, string? 物料编号, string? 颜色)
        {
            if (string.IsNullOrWhiteSpace(订单单号)) return null;
            var key = $"{订单单号.Trim()}|{物料编号 ?? ""}|{颜色 ?? ""}";
            if (加工缓存.TryGetValue(key, out var v)) return v;
            v = await c.ExecuteScalarAsync<string?>(@"
SELECT COALESCE(NULLIF(d.[加工内容],N''), NULLIF(o.[加工内容],N''))
FROM [塑胶采购订单] o
LEFT JOIN [塑胶采购订单明细] d ON d.[单号]=o.[单号] AND d.[物料编号]=@物料编号 AND ISNULL(d.[颜色],'')=ISNULL(@颜色,'')
WHERE o.[单号]=@订单单号",
                new { 订单单号 = 订单单号.Trim(), 物料编号, 颜色 }, tx);
            加工缓存[key] = v;
            return v;
        }

        foreach (var l in dto.明细)
            await c.ExecuteAsync(@"
INSERT INTO [塑胶入仓明细单]([单号],[日期],[仓库],[生产单号],[款号],[工模编号],[物料编号],[物料名称],[规格],[颜色],[塑胶货号],[订单单号],[仓位号],[单位],[数量],[单价],[金额],[备注],[加工内容],[备品])
VALUES(@单号,@日期,@仓库,@生产单号,@款号,@工模编号,@物料编号,@物料名称,@规格,@颜色,@塑胶货号,@订单单号,@仓位号,@单位,@数量,@单价,@金额,@备注,@加工内容,@备品)",
                new { 单号, 日期 = now, dto.仓库, l.生产单号, l.款号, l.工模编号, l.物料编号, l.物料名称, l.规格, l.颜色, l.塑胶货号,
                      订单单号 = l.订单单号 ?? dto.订单单号, l.仓位号, l.单位,
                      l.数量, 单价 = l.单价 ?? 0, 金额 = l.数量 * (l.单价 ?? 0), l.备注,
                      加工内容 = await 订单加工内容Async(l.订单单号 ?? dto.订单单号, l.物料编号, l.颜色),
                      备品 = l.备品 == "1" ? "1" : "0" }, tx);

        tx.Commit();
        return 单号;
    }

    // onlyUnapproved=true 只列未审核单(批量审核弹窗用):服务端过滤+分页,审核完后面页的未审核单自动前移
    public async Task<PagedResult<PlasticReceiptHeaderDto>> ListAsync(int page, int size, string? keyword, bool onlyUnapproved = false)
    {
        if (page < 1) page = 1;
        if (size < 1) size = 20;
        if (size > 1000) size = 1000;
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [塑胶入仓单] WHERE (@kw IS NULL OR [单号] LIKE @kw OR [供应商名称] LIKE @kw OR [备注] LIKE @kw)
  AND (@onlyUnapproved = 0 OR ISNULL([审核],'0')<>'1');
SELECT [ID],[单号],[日期],[供应商编号],[供应商名称],[仓库],[数量],[金额],[操作员],[审核],[审核人],[备注]
FROM [塑胶入仓单] WHERE (@kw IS NULL OR [单号] LIKE @kw OR [供应商名称] LIKE @kw OR [备注] LIKE @kw)
  AND (@onlyUnapproved = 0 OR ISNULL([审核],'0')<>'1')
ORDER BY [ID] DESC OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;", new { kw, page, size, onlyUnapproved = onlyUnapproved ? 1 : 0 });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<PlasticReceiptHeaderDto>()).AsList();
        return new PagedResult<PlasticReceiptHeaderDto>(items, total);
    }

    public async Task<PlasticReceiptDetailDto?> GetAsync(string 单号)
    {
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT [ID],[单号],[日期],[供应商编号],[供应商名称],[仓库],[数量],[金额],[操作员],[审核],[审核人],[备注],[出库单号],[入仓单号],[电脑单号],[订单单号]
FROM [塑胶入仓单] WHERE [单号]=@单号;
SELECT [ID],[生产单号],[款号],[工模编号],[物料编号],[物料名称],[规格],[颜色],[塑胶货号],[订单单号],[仓位号],[单位],[数量],[单价],[金额],[备注],[加工内容],[备品]
FROM [塑胶入仓明细单] WHERE [单号]=@单号 ORDER BY [ID];", new { 单号 });
        var header = await multi.ReadFirstOrDefaultAsync<PlasticReceiptHeaderDto>();
        if (header is null) return null;
        var lines = (await multi.ReadAsync<PlasticReceiptLineDto>()).AsList();
        return new PlasticReceiptDetailDto { 单头 = header, 明细 = lines };
    }

    private static string ApprovalFilter(string? 审核情况) => 审核情况 switch
    {
        "已审核" => " AND ISNULL(h.[审核],'0')='1'",
        "未审核" => " AND ISNULL(h.[审核],'0')<>'1'",
        _ => "",
    };

    public async Task<IReadOnlyList<PlasticReceiptQueryDetailRow>> ReceiptQueryDetailAsync(
        DateTime 起, DateTime 止, string? keyword, string? 审核情况, string? 物料类别)
    {
        var qi = 起.Date; var qe = 止.Date.AddDays(1);
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var cat = string.IsNullOrWhiteSpace(物料类别) ? null : 物料类别.Trim();
        using var c = factory.Create();
        var rows = await c.QueryAsync<PlasticReceiptQueryDetailRow>($@"
SELECT h.[日期], d.[单号], d.[订单单号], d.[生产单号], d.[款号], d.[工模编号], d.[物料编号], d.[物料名称], d.[颜色],
       d.[塑胶货号] AS 塑胶货号, cm.[塑胶货号] AS 共用货号, h.[供应商名称] AS 供应商,
       d.[单位], d.[数量], d.[单价], d.[金额], d.[备注], h.[审核]
FROM [塑胶入仓明细单] d
JOIN [塑胶入仓单] h ON h.[单号] = d.[单号]
LEFT JOIN (SELECT [物料编号], MAX([塑胶货号]) AS 塑胶货号, MAX([共用原料编号]) AS 共用原料编号
           FROM [塑胶共用物料表] GROUP BY [物料编号]) cm ON cm.[物料编号] = d.[物料编号]
LEFT JOIN (SELECT [物料编号], MAX([物料类别]) AS 物料类别 FROM [塑胶物料资料] GROUP BY [物料编号]) m ON m.[物料编号] = d.[物料编号]
WHERE h.[日期] >= @qi AND h.[日期] < @qe
  AND (@kw IS NULL OR d.[物料编号] LIKE @kw OR d.[物料名称] LIKE @kw OR d.[生产单号] LIKE @kw OR d.[款号] LIKE @kw OR d.[订单单号] LIKE @kw)
  AND (@cat IS NULL OR m.[物料类别] = @cat){ApprovalFilter(审核情况)}
ORDER BY h.[日期] DESC, d.[单号], d.[ID]", new { qi, qe, kw, cat });
        return rows.AsList();
    }

    public async Task<IReadOnlyList<PlasticReceiptQuerySummaryRow>> ReceiptQuerySummaryAsync(
        DateTime 起, DateTime 止, string? keyword, string? 审核情况, string? 物料类别)
    {
        var qi = 起.Date; var qe = 止.Date.AddDays(1);
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var cat = string.IsNullOrWhiteSpace(物料类别) ? null : 物料类别.Trim();
        using var c = factory.Create();
        var rows = await c.QueryAsync<PlasticReceiptQuerySummaryRow>($@"
SELECT d.[物料编号], MAX(d.[物料名称]) AS 物料名称, d.[颜色],
       MAX(d.[塑胶货号]) AS 塑胶货号, MAX(cm.[塑胶货号]) AS 共用货号,
       MAX(cm.[共用原料编号]) AS 共用物料, MAX(m.[物料类别]) AS 物料类别, MAX(d.[单位]) AS 单位,
       SUM(d.[数量]) AS 数量, SUM(ISNULL(d.[金额],0)) AS 金额
FROM [塑胶入仓明细单] d
JOIN [塑胶入仓单] h ON h.[单号] = d.[单号]
LEFT JOIN (SELECT [物料编号], MAX([塑胶货号]) AS 塑胶货号, MAX([共用原料编号]) AS 共用原料编号
           FROM [塑胶共用物料表] GROUP BY [物料编号]) cm ON cm.[物料编号] = d.[物料编号]
LEFT JOIN (SELECT [物料编号], MAX([物料类别]) AS 物料类别 FROM [塑胶物料资料] GROUP BY [物料编号]) m ON m.[物料编号] = d.[物料编号]
WHERE h.[日期] >= @qi AND h.[日期] < @qe
  AND (@kw IS NULL OR d.[物料编号] LIKE @kw OR d.[物料名称] LIKE @kw OR d.[生产单号] LIKE @kw OR d.[款号] LIKE @kw OR d.[订单单号] LIKE @kw)
  AND (@cat IS NULL OR m.[物料类别] = @cat){ApprovalFilter(审核情况)}
GROUP BY d.[物料编号], d.[颜色]
ORDER BY d.[物料编号]", new { qi, qe, kw, cat });
        return rows.AsList();
    }

    public async Task<bool> DeleteAsync(string 单号)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [塑胶入仓单] WITH (UPDLOCK, HOLDLOCK) WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null) return false;
        if (审核 == "1") throw new InvalidOperationException("已审核的塑胶入仓单不能删除，请先反审核。");
        await c.ExecuteAsync("DELETE FROM [塑胶入仓明细单] WHERE [单号]=@单号", new { 单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [塑胶入仓单] WHERE [单号]=@单号", new { 单号 }, tx);
        tx.Commit();
        return true;
    }

    // ===== 订单可入仓数量校验(保存 CreateAsync + 审核 Controller approve 两道都拦) =====
    // 口径同 PlasticPurchaseOrderService.ProgressAsync(ReceiptAggSql 带订单单号分支):已审核入仓累计按
    // 订单单号+物料编号+ISNULL(颜色,'') 聚合,只看入仓明细不减退仓。
    // 本单兼作「加工入仓单」,订单单号 可能指向加工单:只校验该单号确实存在于 [塑胶采购订单] 的行,其余放行。
    // 备品='1' 的行(供应商多送的备品)跳过超量拦截,也不计入「已入仓」累计(不顶欠数、不把进度顶超)。
    // internal:喷油排期改单自动更新(SprayPlanReceiptSyncService)在提交前按同口径复用校验。
    internal static async Task ValidateOrderQtyAsync(
        System.Data.IDbConnection c, System.Data.IDbTransaction? tx,
        IEnumerable<(string? 订单单号, string? 物料编号, string? 颜色, decimal 数量, string? 备品)> lines)
    {
        // 本单内同一键多行先按键汇总再判定;备品行不参与
        var groups = lines
            .Where(l => !string.IsNullOrWhiteSpace(l.订单单号) && !string.IsNullOrWhiteSpace(l.物料编号) && l.备品 != "1")
            .GroupBy(l => (订单单号: l.订单单号!.Trim(), 物料编号: l.物料编号!.Trim(), 颜色: l.颜色 ?? ""))
            .Select(g => (g.Key.订单单号, g.Key.物料编号, g.Key.颜色, 本次: g.Sum(x => x.数量)));
        foreach (var g in groups)
        {
            var 订单存在 = await c.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM [塑胶采购订单] WHERE [单号]=@订单单号", new { g.订单单号 }, tx) > 0;
            if (!订单存在) continue;
            var 订购 = await c.ExecuteScalarAsync<decimal?>(@"
SELECT SUM([数量]) FROM [塑胶采购订单明细]
WHERE [单号]=@订单单号 AND [物料编号]=@物料编号 AND ISNULL([颜色],'')=@颜色",
                new { g.订单单号, g.物料编号, g.颜色 }, tx) ?? 0;
            var 已入仓 = await c.ExecuteScalarAsync<decimal?>(@"
SELECT SUM(r.[数量]) FROM [塑胶入仓明细单] r
JOIN [塑胶入仓单] h ON h.[单号]=r.[单号]
WHERE ISNULL(h.[审核],'0')='1' AND ISNULL(r.[备品],'0')<>'1' AND r.[订单单号]=@订单单号 AND r.[物料编号]=@物料编号 AND ISNULL(r.[颜色],'')=@颜色",
                new { g.订单单号, g.物料编号, g.颜色 }, tx) ?? 0;
            if (已入仓 + g.本次 > 订购)
                throw new InvalidOperationException(
                    $"物料 {g.物料编号} 超出订单 {g.订单单号} 可入仓数量：订购 {Fmt(订购)}，已入仓 {Fmt(已入仓)}，本次 {Fmt(g.本次)}，超 {Fmt(已入仓 + g.本次 - 订购)}。");
        }
    }

    // 审核前校验(approve 端点调用):此刻本单 审核='0',不计入已入仓累计,无需排除本单。
    // 明细 订单单号 空则回落单头(与建单口径一致)。
    public async Task ValidateOrderQtyAsync(string 单号)
    {
        using var c = factory.Create();
        var lines = await c.QueryAsync<(string? 订单单号, string? 物料编号, string? 颜色, decimal 数量, string? 备品)>(@"
SELECT COALESCE(d.[订单单号], h.[订单单号]) AS [订单单号], d.[物料编号], d.[颜色], ISNULL(d.[数量],0) AS [数量], ISNULL(d.[备品],'0') AS [备品]
FROM [塑胶入仓明细单] d JOIN [塑胶入仓单] h ON h.[单号]=d.[单号]
WHERE d.[单号]=@单号", new { 单号 });
        await ValidateOrderQtyAsync(c, null, lines);
    }

    private static string Fmt(decimal v) => v.ToString("0.####");

    // ==================== AI注塑啤机排产系统 推送挂钩 ====================
    // 审核成功后调用:把入仓明细逐行推送到排产系统入库单(排产端=warehouse-orders,车间按单头供应商映射)。
    // 未配置排产凭证时整体跳过(返回 null);推送失败/部分失败只返回警告,不阻断审核。
    public async Task<string?> ApprovePushAsync(string 单号)
    {
        if (!paiji.已配置) return null;
        var 警告 = new List<string>();

        using var c = factory.Create();
        // 防回环:该单是排产系统反向同步生成的(有同步记录),审核时不再回推排产,避免生成重复记录
        var 是同步单 = await c.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM [排产同步记录] WHERE [ERP单号]=@单号", new { 单号 }) > 0;
        if (是同步单) return null;

        // 幂等重推:已有推送记录先删远端再清记录
        var 旧记录 = (await c.QueryAsync<(string 排产端, long Id)>(@"
SELECT [排产端],[排产订单ID] AS Id FROM [排产推送记录] WHERE [单据类型]=N'入仓单' AND [单据号]=@单号", new { 单号 })).AsList();
        if (旧记录.Count > 0)
        {
            var 删 = await paiji.DeleteAsync(旧记录);
            警告.AddRange(删.警告);
            // 只清远端删除成功的记录;失败的保留(远端单还在,本地记录失联会导致下次审核重复推单)
            var 成功Ids = 旧记录.Where(r => !删.失败.Contains(r)).Select(r => r.Id).ToList();
            if (成功Ids.Count > 0)
                await c.ExecuteAsync("DELETE FROM [排产推送记录] WHERE [单据类型]=N'入仓单' AND [单据号]=@单号 AND [排产订单ID] IN @成功Ids", new { 单号, 成功Ids });
        }

        var d = await GetAsync(单号);
        if (d?.单头 is null) return "已审核，但推送排产系统失败：单据读取失败。";
        var 有效行 = d.明细.Where(l => l.数量 > 0).ToList();
        if (有效行.Count == 0) return 警告.Count > 0 ? string.Join("；", 警告) : null;

        // 明细行无色粉号/套数/用料名称/出模数/啤重,按 物料编号 查塑胶物料资料补齐
        var 物料表 = (await c.QueryAsync<PaijiMaterialInfo>(@"
SELECT [物料编号],[整啤净重],[原胶件单净重],[套数],[出模数],[色粉号],[用料名称]
FROM [塑胶物料资料] WHERE [物料编号] IN @codes",
            new { codes = 有效行.Select(l => l.物料编号).Distinct().ToArray() }))
            .ToDictionary(m => m.物料编号, m => m);

        var workshop = PaijiMapper.车间(d.单头.供应商名称);
        var rows = 有效行.Select(l => PaijiWarehouseMapper.BuildRow(workshop, d.单头, l,
            l.物料编号 is not null && 物料表.TryGetValue(l.物料编号, out var m) ? m : null)).ToList();

        var (ids, 失败) = await paiji.PushWarehouseAsync(rows);
        foreach (var id in ids)
            await c.ExecuteAsync(@"
INSERT INTO [排产推送记录]([单据类型],[单据号],[排产订单ID],[排产端],[车间]) VALUES(N'入仓单',@单号,@id,N'warehouse-orders',@车间)",
                new { 单号, id, 车间 = workshop });

        if (失败.Count > 0)
            警告.Add(ids.Count == 0
                ? $"已审核，但推送排产系统失败：{string.Join("、", 失败)}"
                : $"部分行推送失败：{string.Join("、", 失败)}");
        return 警告.Count > 0 ? string.Join("；", 警告) : null;
    }

    // 反审核成功后调用:按推送记录删远端排产入库单(容忍远端已删),再清记录;
    // 远端删失败的记录保留待下次反审核重试(防重复推单),失败只返回警告。
    public async Task<string?> UnapprovePushAsync(string 单号)
    {
        using var c = factory.Create();
        var 记录 = (await c.QueryAsync<(string 排产端, long Id)>(@"
SELECT [排产端],[排产订单ID] AS Id FROM [排产推送记录] WHERE [单据类型]=N'入仓单' AND [单据号]=@单号", new { 单号 })).AsList();
        if (记录.Count == 0) return null;
        if (!paiji.已配置) return "排产系统未配置凭证，远端排产入库单未删除（推送记录已保留）。";

        var 删 = await paiji.DeleteAsync(记录);
        var 成功Ids = 记录.Where(r => !删.失败.Contains(r)).Select(r => r.Id).ToList();
        if (成功Ids.Count > 0)
            await c.ExecuteAsync("DELETE FROM [排产推送记录] WHERE [单据类型]=N'入仓单' AND [单据号]=@单号 AND [排产订单ID] IN @成功Ids", new { 单号, 成功Ids });
        return 删.警告.Count > 0 ? string.Join("；", 删.警告) : null;
    }

    // ==================== 目标仓入仓单 自动生成挂钩 ====================
    // 审核成功后调用:仓库=半成品仓→生成半成品入仓单(未审核);仓库=成品仓→生成成品入仓单(未审核);
    // 塑胶仓或其他→不生成(塑胶仓是本单据原生库存域)。按 来源单号 判重,重复审核不重复生成。
    // 返回生成结果描述(如 "半成品入仓单 BCP20260909-001"),未生成返回 null。
    public async Task<string?> GenerateWarehouseReceiptAsync(string 单号, string user)
    {
        var d = await GetAsync(单号);
        if (d?.单头 is null) return null;
        var h = d.单头;
        var 仓 = h.仓库?.Trim();
        var 目标表 = 仓 switch
        {
            "半成品仓" => "半成品入仓单",
            "成品仓" => "成品入仓单",
            _ => null,
        };
        if (目标表 is null) return null;

        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        // 兜底判重:两张目标表都按 来源单号 查,已生成过就直接返回现有单号
        var 已有 = await FindGeneratedAsync(c, tx, 单号);
        if (已有 is not null) { tx.Commit(); return $"{已有.Value.Table} {已有.Value.No}"; }

        var now = DateTime.Now;
        var 有效行 = d.明细.Where(l => l.数量 > 0).ToList();
        var 数量 = 有效行.Sum(l => l.数量);
        var 金额 = 有效行.Sum(l => l.数量 * (l.单价 ?? 0));
        // 目标表 供应商编号 有 FK 到 供应商资料,空白归一为 null(同 SemiReceiptService 模式)
        var supplierCode = string.IsNullOrWhiteSpace(h.供应商编号) ? null : h.供应商编号.Trim();
        // 半成品明细.物料编号 FK 到 物料资料,而成品明细.款号 FK 到 款号总表;
        // 塑胶入仓物料/款号常不在这两张主数据里,不在则置 null(编码仍留在 货号/物料名称 中),避免 FK 冲突
        var 物料有效 = (await c.QueryAsync<string>(
            "SELECT [物料编号] FROM [物料资料] WHERE [物料编号] IN @codes",
            new { codes = 有效行.Select(l => l.物料编号).Where(x => !string.IsNullOrWhiteSpace(x)).Distinct().ToArray() }, tx)).ToHashSet();
        var 款号有效 = (await c.QueryAsync<string>(
            "SELECT [款号] FROM [款号总表] WHERE [款号] IN @codes",
            new { codes = 有效行.Select(l => l.款号).Where(x => !string.IsNullOrWhiteSpace(x)).Distinct().ToArray() }, tx)).ToHashSet();
        string? 物料编号Of(PlasticReceiptLineDto l) => l.物料编号 is not null && 物料有效.Contains(l.物料编号) ? l.物料编号 : null;
        string? 款号Of(PlasticReceiptLineDto l) => l.款号 is not null && 款号有效.Contains(l.款号) ? l.款号 : null;
        var 备注 = string.IsNullOrWhiteSpace(h.备注)
            ? $"由加工入仓单 {单号} 自动生成"
            : $"{h.备注}；由加工入仓单 {单号} 自动生成";

        string 生成单号;
        if (目标表 == "半成品入仓单")
        {
            生成单号 = await docNo.NextAsync("半成品入仓单", "BCP", now, (Microsoft.Data.SqlClient.SqlConnection)c, (Microsoft.Data.SqlClient.SqlTransaction)tx);
            await c.ExecuteAsync(@"
INSERT INTO [半成品入仓单]([单号],[订单单号],[日期],[供应商编号],[供应商名称],[仓库],[数量],[金额],[操作员],[审核],[备注],[来源单号])
VALUES(@生成单号,@订单单号,@日期,@供应商编号,@供应商名称,@仓库,@数量,@金额,@操作员,'0',@备注,@来源单号)",
                new { 生成单号, h.订单单号, 日期 = now, 供应商编号 = supplierCode, h.供应商名称, 仓库 = 仓, 数量, 金额, 操作员 = user, 备注, 来源单号 = 单号 }, tx);
            foreach (var l in 有效行)
                await c.ExecuteAsync(@"
INSERT INTO [半成品入仓明细单]([单号],[订单单号],[生产单号],[款号],[日期],[供应商编号],[供应商名称],[仓库],[货号],[物料编号],[物料名称],[规格],[颜色],[单位],[数量],[单价],[金额],[备注])
VALUES(@生成单号,@订单单号,@生产单号,@款号,@日期,@供应商编号,@供应商名称,@仓库,@货号,@物料编号,@物料名称,@规格,@颜色,@单位,@数量,@单价,@金额,@备注)",
                    new
                    {
                        生成单号, 订单单号 = l.订单单号 ?? h.订单单号, 生产单号 = l.生产单号, 款号 = 款号Of(l), 日期 = now,
                        供应商编号 = supplierCode, h.供应商名称, 仓库 = 仓, 货号 = l.塑胶货号,
                        物料编号 = 物料编号Of(l), l.物料名称, l.规格, l.颜色, l.单位, l.数量, 单价 = l.单价 ?? 0,
                        金额 = l.数量 * (l.单价 ?? 0), l.备注
                    }, tx);
        }
        else
        {
            生成单号 = await docNo.NextAsync("成品入仓单", "CR", now, (Microsoft.Data.SqlClient.SqlConnection)c, (Microsoft.Data.SqlClient.SqlTransaction)tx);
            await c.ExecuteAsync(@"
INSERT INTO [成品入仓单]([单号],[订单单号],[日期],[供应商编号],[供应商名称],[仓库],[数量],[金额],[操作员],[审核],[备注],[来源单号])
VALUES(@生成单号,@订单单号,@日期,@供应商编号,@供应商名称,@仓库,@数量,@金额,@操作员,'0',@备注,@来源单号)",
                new { 生成单号, h.订单单号, 日期 = now, 供应商编号 = supplierCode, h.供应商名称, 仓库 = 仓, 数量, 金额, 操作员 = user, 备注, 来源单号 = 单号 }, tx);
            foreach (var l in 有效行)
                await c.ExecuteAsync(@"
INSERT INTO [成品入仓明细单]([单号],[订单单号],[生产单号],[款号],[日期],[供应商编号],[供应商名称],[仓库],[货号],[名称],[数量],[单价],[金额],[审核],[备注])
VALUES(@生成单号,@订单单号,@生产单号,@款号,@日期,@供应商编号,@供应商名称,@仓库,@货号,@名称,@数量,@单价,@金额,'0',@备注)",
                    new
                    {
                        生成单号, 订单单号 = l.订单单号 ?? h.订单单号, 生产单号 = l.生产单号, 款号 = 款号Of(l), 日期 = now,
                        供应商编号 = supplierCode, h.供应商名称, 仓库 = 仓, 货号 = l.塑胶货号, 名称 = l.物料名称,
                        l.数量, 单价 = l.单价 ?? 0, 金额 = l.数量 * (l.单价 ?? 0), l.备注
                    }, tx);
        }
        tx.Commit();
        return $"{目标表} {生成单号}";
    }

    private static async Task<(string Table, string No)?> FindGeneratedAsync(
        System.Data.IDbConnection c, System.Data.IDbTransaction? tx, string 来源单号)
    {
        var no = await c.ExecuteScalarAsync<string?>(
            "SELECT TOP 1 [单号] FROM [半成品入仓单] WHERE [来源单号]=@来源单号", new { 来源单号 }, tx);
        if (no is not null) return ("半成品入仓单", no);
        no = await c.ExecuteScalarAsync<string?>(
            "SELECT TOP 1 [单号] FROM [成品入仓单] WHERE [来源单号]=@来源单号", new { 来源单号 }, tx);
        if (no is not null) return ("成品入仓单", no);
        return null;
    }

    // 反审核源单之前调用:生成单未审核→一并删除;已被仓库侧审核→抛错阻断反审核。
    public async Task RemoveGeneratedReceiptIfUnapprovedAsync(string 单号)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 已有 = await FindGeneratedAsync(c, tx, 单号);
        if (已有 is null) { tx.Commit(); return; }
        var (table, no) = 已有.Value;
        var 审核 = await c.ExecuteScalarAsync<string?>(
            $"SELECT ISNULL([审核],'0') FROM [{table}] WITH (UPDLOCK, HOLDLOCK) WHERE [单号]=@no", new { no }, tx);
        if (审核 == "1")
            throw new InvalidOperationException($"已生成{table} {no} 且对方已审核，请先反审核该单。");
        var 明细表 = table == "半成品入仓单" ? "半成品入仓明细单" : "成品入仓明细单";
        await c.ExecuteAsync($"DELETE FROM [{明细表}] WHERE [单号]=@no", new { no }, tx);
        await c.ExecuteAsync($"DELETE FROM [{table}] WHERE [单号]=@no", new { no }, tx);
        tx.Commit();
    }
}
