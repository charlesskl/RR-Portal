using Dapper;
using ErpApi.Features.Plastics.PlasticReceipt;
using ErpApi.Infrastructure.Db;
using System.Globalization;
namespace ErpApi.Integrations.SprayPlan;

// 喷油排期入库申请单 → ERP塑胶入仓单 反向同步(SprayPlanSyncWorker 30s 轮询调用)。
// 每趟:quantity<=0 跳过(负数=调减单,ERP 入仓单不支持负数量,记警告) → [喷油同步记录] 按申请单号去重
//   → 未同步的申请单建一张未审核塑胶入仓单(操作员=喷油同步,单头日期改写为 productionDate) → 成功后写 [喷油同步记录]。
// 已同步的申请单(对方改单):updatedAt 解析不出或 <= [喷油同步记录].[同步时间] 跳过;updatedAt 更新时 —
//   入仓单已审核 → 不动记警告;未审核 → 按建单同映射更新单头+明细(操作员/备注/审核不动)并刷新同步时间,避免每趟重复更新;
//   改后数量超订单可入仓量(同 ValidateOrderQtyAsync 口径)→ 不更新记警告。
// 单张失败记警告继续;返回建出的 ERP 单号列表。
// 供应商/物料解析:orderNo 精确命中塑胶采购订单(含 '-' 时试最后一个 '-' 前的前缀,见 SprayPlanSyncMapper.采购单号候选),
//   取其供应商并在明细按 款号+物料名称 匹配带物料信息;解析不到回落 293/喷油部、productNo 原值。
// 入仓单 订单单号 落解析出的采购单号(多款号推送 externalOrderNo=SPxxx-款号 → 去掉款号后缀):
//   欠数核销(ReceiptJoinSql 按 订单单号=采购单号)、超收校验与已加工工序快照才能对上;解析不到才保留对方单号原值。
public sealed class SprayPlanReceiptSyncService(
    PlasticReceiptService receipts, ISqlConnectionFactory factory, ILogger<SprayPlanReceiptSyncService> logger)
{
    public async Task<IReadOnlyList<string>> SyncRowsAsync(IReadOnlyList<SprayPlanInboundRow> rows)
    {
        var 建单 = new List<string>();
        var 有效 = new List<SprayPlanInboundRow>();
        foreach (var r in rows)
        {
            if (SprayPlanSyncMapper.要同步(r.Quantity)) 有效.Add(r);
            else if (r.Quantity < 0)
                logger.LogWarning("喷油同步跳过调减单 {申请单号}:数量={数量}(ERP入仓单不支持负数量)", r.ApplicationNo, r.Quantity);
        }
        if (有效.Count == 0) return 建单;

        using var c = factory.Create();
        var 已同步 = (await c.QueryAsync<同步记录>(
            "SELECT [申请单号],[ERP单号],[同步时间] FROM [喷油同步记录] WHERE [申请单号] IN @ids",
            new { ids = 有效.Select(r => r.ApplicationNo).ToArray() }))
            .ToDictionary(x => x.申请单号);

        foreach (var r in 有效.Where(r => !已同步.ContainsKey(r.ApplicationNo)))
        {
            try
            {
                var (供应商编号, 供应商名称, 物料, 采购单号) = await 解析供应商物料(c, r);
                var dto = new PlasticReceiptCreateDto
                {
                    供应商编号 = 供应商编号,
                    供应商名称 = 供应商名称,
                    仓库 = "塑胶仓",
                    订单单号 = 采购单号 ?? r.OrderNo,
                    备注 = $"喷油排期同步({r.ApplicationNo})",
                    明细 =
                    [
                        new PlasticReceiptCreateLineDto
                        {
                            款号 = r.ProductNo,
                            塑胶货号 = r.ProductNo,
                            物料编号 = 物料?.物料编号 ?? r.ProductNo,
                            物料名称 = SprayPlanSyncMapper.物料名称(r.ItemName, r.PartName),
                            规格 = 物料?.规格,
                            颜色 = 物料?.颜色,
                            单位 = string.IsNullOrWhiteSpace(物料?.单位) ? "个" : 物料.单位,
                            数量 = r.Quantity,
                            备注 = $"喷油排期#{r.ApplicationNo}",
                        },
                    ],
                };
                var 单号 = await receipts.CreateAsync(dto, "喷油同步");

                // 单头日期取申请单生产日期(CreateAsync 固定用当天,这里改写;照 PaijiReceiptSyncService)
                if (DateTime.TryParse(r.ProductionDate, out var d))
                    await c.ExecuteAsync("UPDATE [塑胶入仓单] SET [日期]=@d WHERE [单号]=@单号",
                        new { d = d.Date, 单号 });
                await c.ExecuteAsync(
                    "INSERT INTO [喷油同步记录]([申请单号],[ERP单号]) VALUES(@申请单号,@单号)",
                    new { 申请单号 = r.ApplicationNo, 单号 });
                建单.Add(单号);
                logger.LogInformation("喷油同步建单 {单号}:申请单号={申请单号} 订单={订单} 款号={款号} 数量={数量}",
                    单号, r.ApplicationNo, r.OrderNo, r.ProductNo, r.Quantity);
            }
            catch (Exception ex) { logger.LogWarning(ex, "喷油同步申请单 {申请单号} 建单失败", r.ApplicationNo); }
        }

        // 改单自动更新:已同步过的申请单,对方 updatedAt 变新才处理
        foreach (var r in 有效.Where(r => 已同步.ContainsKey(r.ApplicationNo)))
        {
            try { await 尝试自动更新(c, r, 已同步[r.ApplicationNo]); }
            catch (Exception ex) { logger.LogWarning(ex, "喷油同步申请单 {申请单号} 自动更新失败", r.ApplicationNo); }
        }
        return 建单;
    }

    private sealed class 同步记录
    {
        public string 申请单号 { get; set; } = "";
        public string ERP单号 { get; set; } = "";
        public DateTime 同步时间 { get; set; }
    }

    // 对方改单(updatedAt > 同步时间)→ 更新对应 ERP 入仓单:
    //   已审核不动记警告;未审核按建单同映射改单头+明细(操作员/备注/审核/明细加工内容与单价不动),并刷新同步时间。
    // 时间口径:[同步时间] 用 GETDATE()(与建表 DEFAULT 一致),当前 SQL Server 容器为 UTC,
    //   故 updatedAt(ISO,带时区)统一转 UTC 比较;若 DB 服务器改跑非 UTC 时区,此处要同步调整。
    private async Task 尝试自动更新(
        System.Data.IDbConnection c, SprayPlanInboundRow r, 同步记录 rec)
    {
        if (!DateTimeOffset.TryParse(r.UpdatedAt, CultureInfo.InvariantCulture, DateTimeStyles.None, out var u)
            || u.UtcDateTime <= rec.同步时间)
            return;

        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [塑胶入仓单] WHERE [单号]=@单号", new { 单号 = rec.ERP单号 });
        if (审核 is null)
        {
            logger.LogWarning("喷油同步申请单 {申请单号} 对应入仓单 {单号} 已不存在,不自动更新", r.ApplicationNo, rec.ERP单号);
            return;
        }
        if (审核 == "1")
        {
            logger.LogWarning("喷油同步申请单 {申请单号} 对应入仓单 {单号} 已审核,不自动更新", r.ApplicationNo, rec.ERP单号);
            return;
        }
        var 旧数量 = await c.ExecuteScalarAsync<decimal>(
            "SELECT ISNULL([数量],0) FROM [塑胶入仓单] WHERE [单号]=@单号", new { 单号 = rec.ERP单号 });

        var (供应商编号, 供应商名称, 物料, 采购单号) = await 解析供应商物料(c, r);
        var 订单单号 = 采购单号 ?? r.OrderNo;
        DateTime? 日期 = DateTime.TryParse(r.ProductionDate, out var d) ? d.Date : null;
        var 物料名称 = SprayPlanSyncMapper.物料名称(r.ItemName, r.PartName);
        var 单位 = string.IsNullOrWhiteSpace(物料?.单位) ? "个" : 物料.单位;

        if (c.State != System.Data.ConnectionState.Open) c.Open();
        using var tx = c.BeginTransaction();
        await c.ExecuteAsync(@"
UPDATE [塑胶入仓单] SET [供应商编号]=@供应商编号,[供应商名称]=@供应商名称,[订单单号]=@订单单号,
       [日期]=COALESCE(@日期,[日期]) WHERE [单号]=@单号",
            new { 供应商编号, 供应商名称, 订单单号, 日期, 单号 = rec.ERP单号 }, tx);
        // 同步建单固定一行明细:单行直接改(保住 加工内容/单价/备注/ID);行数异常(被人工增删)则按建单映射重建一行
        var 行数 = await c.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM [塑胶入仓明细单] WHERE [单号]=@单号", new { 单号 = rec.ERP单号 }, tx);
        if (行数 == 1)
        {
            await c.ExecuteAsync(@"
UPDATE [塑胶入仓明细单] SET [日期]=COALESCE(@日期,[日期]),[款号]=@款号,[塑胶货号]=@款号,
       [物料编号]=@物料编号,[物料名称]=@物料名称,[规格]=@规格,[颜色]=@颜色,[单位]=@单位,
       [订单单号]=@订单单号,[数量]=@数量,[金额]=@数量*ISNULL([单价],0)
WHERE [单号]=@单号",
                new
                {
                    日期, 款号 = r.ProductNo, 物料编号 = 物料?.物料编号 ?? r.ProductNo, 物料名称,
                    规格 = 物料?.规格, 颜色 = 物料?.颜色, 单位, 订单单号, 数量 = r.Quantity, 单号 = rec.ERP单号,
                }, tx);
        }
        else
        {
            await c.ExecuteAsync("DELETE FROM [塑胶入仓明细单] WHERE [单号]=@单号", new { 单号 = rec.ERP单号 }, tx);
            await c.ExecuteAsync(@"
INSERT INTO [塑胶入仓明细单]([单号],[日期],[仓库],[款号],[物料编号],[物料名称],[规格],[颜色],[塑胶货号],[订单单号],[单位],[数量],[单价],[金额],[备注])
SELECT @单号,COALESCE(@日期,h.[日期]),h.[仓库],@款号,@物料编号,@物料名称,@规格,@颜色,@款号,@订单单号,@单位,@数量,0,0,@备注
FROM [塑胶入仓单] h WHERE h.[单号]=@单号",
                new
                {
                    单号 = rec.ERP单号, 日期, 款号 = r.ProductNo, 物料编号 = 物料?.物料编号 ?? r.ProductNo, 物料名称,
                    规格 = 物料?.规格, 颜色 = 物料?.颜色, 单位, 订单单号, 数量 = r.Quantity,
                    备注 = $"喷油排期#{r.ApplicationNo}",
                }, tx);
        }
        // 单头数量/金额按明细重算
        await c.ExecuteAsync(@"
UPDATE [塑胶入仓单] SET [数量]=(SELECT ISNULL(SUM([数量]),0) FROM [塑胶入仓明细单] WHERE [单号]=@单号),
       [金额]=(SELECT ISNULL(SUM([数量]*ISNULL([单价],0)),0) FROM [塑胶入仓明细单] WHERE [单号]=@单号)
WHERE [单号]=@单号", new { 单号 = rec.ERP单号 }, tx);
        // 超收校验(同 ValidateOrderQtyAsync 口径,本单未审核不计入已入仓):对方改单把数量改超订购时
        // 不更新(回滚)并记警告,防止本地数据被改脏
        try
        {
            await PlasticReceiptService.ValidateOrderQtyAsync(c, tx,
                [(订单单号, 物料?.物料编号 ?? r.ProductNo, 物料?.颜色, r.Quantity, (string?)null)]);
        }
        catch (InvalidOperationException ex)
        {
            tx.Rollback();
            logger.LogWarning("喷油同步申请单 {申请单号} 自动更新入仓单 {单号} 被拒(超收):{消息}",
                r.ApplicationNo, rec.ERP单号, ex.Message);
            return;
        }
        // 同步时间与建表 DEFAULT 同口径(GETDATE;当前 SQL 容器为 UTC),刷新避免每趟重复更新
        await c.ExecuteAsync("UPDATE [喷油同步记录] SET [同步时间]=GETDATE() WHERE [申请单号]=@申请单号",
            new { 申请单号 = r.ApplicationNo }, tx);
        tx.Commit();
        logger.LogInformation("喷油同步自动更新入仓单 {单号}:申请单号={申请单号} 数量 {旧数量}→{新数量}",
            rec.ERP单号, r.ApplicationNo, 旧数量, r.Quantity);
    }

    // 采购订单明细行匹配带出的物料信息(规格/单位取自 塑胶物料资料,颜色明细行优先)。
    private sealed class 物料匹配
    {
        public string? 物料编号 { get; set; }
        public string? 规格 { get; set; }
        public string? 单位 { get; set; }
        public string? 颜色 { get; set; }
    }

    // 返回:供应商(解析不到回落 293/喷油部) + 物料匹配 + 命中的塑胶采购订单号(含前缀候选;没命中=null,
    // 调用方落 订单单号 时用 ?? r.OrderNo 兜底)
    private async Task<(string 供应商编号, string 供应商名称, 物料匹配? 物料, string? 采购单号)> 解析供应商物料(
        System.Data.IDbConnection c, SprayPlanInboundRow r)
    {
        string? 采购单号 = null, 供应商编号 = null, 供应商名称 = null;
        foreach (var cand in SprayPlanSyncMapper.采购单号候选(r.OrderNo))
        {
            var h = await c.QueryFirstOrDefaultAsync<(string? 供应商编号, string? 供应商名称)>(
                "SELECT [供应商编号],[供应商名称] FROM [塑胶采购订单] WHERE [单号]=@no", new { no = cand });
            if (h != default) { 采购单号 = cand; 供应商编号 = h.供应商编号; 供应商名称 = h.供应商名称; break; }
        }

        物料匹配? 物料 = null;
        if (采购单号 is not null && !string.IsNullOrWhiteSpace(r.ProductNo))
        {
            var names = new[] { r.PartName, SprayPlanSyncMapper.物料名称(r.ItemName, r.PartName) }
                .Where(n => !string.IsNullOrWhiteSpace(n)).Select(n => n!.Trim()).Distinct().ToArray();
            if (names.Length > 0)
                物料 = await c.QueryFirstOrDefaultAsync<物料匹配>(@"
SELECT TOP 1 d.[物料编号] AS 物料编号, m.[规格] AS 规格, m.[单位] AS 单位,
       COALESCE(NULLIF(d.[颜色],''), m.[颜色]) AS 颜色
FROM [塑胶采购订单明细] d
LEFT JOIN [塑胶物料资料] m ON m.[物料编号]=d.[物料编号]
WHERE d.[单号]=@采购单号 AND d.[款号]=@款号 AND d.[物料名称] IN @names",
                    new { 采购单号, 款号 = r.ProductNo.Trim(), names });
        }

        return (string.IsNullOrWhiteSpace(供应商编号) ? "293" : 供应商编号,
                string.IsNullOrWhiteSpace(供应商名称) ? "喷油部" : 供应商名称,
                物料, 采购单号);
    }
}
