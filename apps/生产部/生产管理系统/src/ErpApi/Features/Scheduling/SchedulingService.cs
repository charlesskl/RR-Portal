using Dapper;
using ErpApi.Features.MasterData;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
namespace ErpApi.Features.Scheduling;

// 客户排期：各客户 Excel 排期表的导入/查询/批次管理。
// 重复导入按自然键(排期客户+PO号+客PO+SKU+货号+数量)更新状态与日期，保证重跑幂等、支持"在排→已走货"流转。
public sealed class SchedulingService(ISqlConnectionFactory factory)
{
    public const int MaxImportRows = 50000;   // 单文件行数上限(ZURU 总排期约 2 万行)

    // 分页列表：关键字模糊匹配 PO号/客PO/货号/品名/客户名称/SKU(仅页面可见列;
    // 不匹配 原始数据——Excel 原文备注里常含其他货号,如 Amazon UK(…/92125D/…),搜 92125 会带出别货号行);
    // 另可按 排期客户/状态/走货期区间/批次/单类型(MA单/实单) 过滤。
    // MA 规则:货号 -MA 结尾=MA单(对全部物料下单做半成品),否则实单(用半成品做成品);
    // 实单关联同排期客户下 前缀-MA 的 MA 单(带出 MA 货号与状态)。
    public async Task<PagedResult<ScheduleRowDto>> ListAsync(
        int page, int size, string? keyword, string? 排期客户, string? 状态,
        DateTime? 走货期从, DateTime? 走货期至, long? 批次ID = null, string? 单类型 = null)
    {
        if (page < 1) page = 1;
        if (size < 1) size = 20;
        if (size > 1000) size = 1000;
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var cust = string.IsNullOrWhiteSpace(排期客户) ? null : 排期客户.Trim();
        var st = string.IsNullOrWhiteSpace(状态) ? null : 状态.Trim();
        var typ = string.IsNullOrWhiteSpace(单类型) ? null : 单类型.Trim();

        const string from = @"
FROM [生产排期] s
CROSS APPLY (SELECT CASE WHEN UPPER(LTRIM(RTRIM(ISNULL(s.[货号],N'')))) LIKE N'%-MA' THEN N'MA单' ELSE N'实单' END AS [单类型],
                    CASE WHEN UPPER(LTRIM(RTRIM(ISNULL(s.[货号],N'')))) NOT LIKE N'%-MA' THEN
                         CASE WHEN s.[货号] LIKE N'[0-9]%'
                              THEN LEFT(s.[货号], PATINDEX(N'%[^0-9]%', s.[货号] + N' ') - 1) + N'-MA'
                              WHEN CHARINDEX(N'-', s.[货号]) > 1
                              THEN LEFT(s.[货号], CHARINDEX(N'-', s.[货号]) - 1) + N'-MA' END
                    END AS [关联MA货号]) t
OUTER APPLY (SELECT TOP (1) ma.[状态] FROM [生产排期] ma
             WHERE ma.[货号] = t.[关联MA货号] AND ma.[排期客户] = s.[排期客户]
             ORDER BY ma.[ID] DESC) m([关联MA状态])
OUTER APPLY (SELECT TOP (1) b.[款号] FROM [款号物料总表] b WHERE b.[款号] = s.[货号]) bom([BOM款号])
OUTER APPLY (SELECT COUNT(*) AS [绑定PO数] FROM [款号物料PO绑定] pb WHERE pb.[款号] = bom.[BOM款号]) pc
OUTER APPLY (SELECT CAST(CASE WHEN EXISTS(SELECT 1 FROM [款号物料PO绑定] p2
                                         WHERE p2.[款号] = bom.[BOM款号] AND p2.[PO号] = s.[PO号])
                              THEN 1 ELSE 0 END AS bit) AS [已绑本PO]) po";
        const string where = @"
WHERE (@kw IS NULL OR s.[PO号] LIKE @kw OR s.[客PO] LIKE @kw OR s.[货号] LIKE @kw OR s.[品名] LIKE @kw OR s.[客户名称] LIKE @kw OR s.[SKU] LIKE @kw)
  AND (@cust IS NULL OR s.[排期客户]=@cust)
  AND (@st IS NULL OR s.[状态]=@st)
  AND (@from IS NULL OR s.[走货期]>=@from)
  AND (@to IS NULL OR s.[走货期]<DATEADD(day,1,@to))
  AND (@bid IS NULL OR s.[批次ID]=@bid)
  AND (@typ IS NULL OR t.[单类型]=@typ)";

        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync($@"
SELECT COUNT(*) {from} {where};
SELECT s.[ID],s.[批次ID],s.[排期客户],s.[状态],s.[接单日期],s.[客户名称],s.[国家],s.[PO号],s.[客PO],s.[SKU],s.[货号],s.[品名],
       s.[数量],s.[内箱],s.[外箱],s.[总箱数],s.[走货期],s.[验货期],s.[第三方验货],s.[车间],s.[来源工作表],s.[备注],s.[原始数据],s.[创建日期],s.[操作员],
       (SELECT TOP 1 [新状态] FROM [生产排期状态变更] sc WHERE sc.[排期ID]=s.[ID] AND sc.[审核状态]=N'待审核') AS [待审新状态],
       t.[单类型], t.[关联MA货号], m.[关联MA状态],
       bom.[BOM款号], ISNULL(pc.[绑定PO数],0) AS [绑定PO数], ISNULL(po.[已绑本PO],0) AS [已绑本PO]
{from} {where}
ORDER BY s.[走货期] DESC, s.[ID] DESC
OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;",
            new { kw, cust, st, from = 走货期从, to = 走货期至, bid = 批次ID, typ, page, size });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<ScheduleRowDto>()).AsList();
        return new PagedResult<ScheduleRowDto>(items, total);
    }

    // 排期表(文件)分类视图:一个批次一张卡,带行数/货号数/状态分布;
    // keyword 命中 文件名/货号/品名 → 反查"哪些货号在哪些排期表"
    public async Task<IReadOnlyList<ScheduleFileDto>> FilesAsync(string? 排期客户, string? keyword)
    {
        var cust = string.IsNullOrWhiteSpace(排期客户) ? null : 排期客户.Trim();
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        var items = await c.QueryAsync<ScheduleFileDto>(@"
SELECT b.[ID],b.[排期客户],b.[文件名],b.[导入日期],b.[操作员],
       COUNT(s.[ID]) AS [行数],
       COUNT(DISTINCT s.[货号]) AS [货号数],
       SUM(CASE WHEN s.[状态]=N'在排' THEN 1 ELSE 0 END) AS [在排],
       SUM(CASE WHEN s.[状态]=N'已走货' THEN 1 ELSE 0 END) AS [已走货],
       SUM(CASE WHEN s.[状态]=N'已取消' THEN 1 ELSE 0 END) AS [已取消]
FROM [生产排期批次] b
JOIN [生产排期] s ON s.[批次ID]=b.[ID]
WHERE (@cust IS NULL OR b.[排期客户]=@cust)
  AND (@kw IS NULL OR b.[文件名] LIKE @kw
       OR EXISTS (SELECT 1 FROM [生产排期] x WHERE x.[批次ID]=b.[ID]
                  AND (x.[货号] LIKE @kw OR x.[品名] LIKE @kw OR x.[PO号] LIKE @kw)))
GROUP BY b.[ID],b.[排期客户],b.[文件名],b.[导入日期],b.[操作员]
ORDER BY b.[排期客户],b.[ID] DESC;",
            new { cust, kw });
        return items.AsList();
    }

    // 批次列表（带行数）
    public async Task<IReadOnlyList<ScheduleBatchDto>> BatchesAsync()
    {
        using var c = factory.Create();
        var items = await c.QueryAsync<ScheduleBatchDto>(@"
SELECT b.[ID],b.[排期客户],b.[文件名],b.[导入日期],b.[操作员],b.[新增],b.[更新],b.[备注],
       (SELECT COUNT(*) FROM [生产排期] s WHERE s.[批次ID]=b.[ID]) AS [行数]
FROM [生产排期批次] b
ORDER BY b.[ID] DESC;");
        return items.AsList();
    }

    // 汇总：排期客户 × 状态 的行数/数量（页面顶部统计卡）
    public async Task<IReadOnlyList<ScheduleSummaryDto>> SummaryAsync()
    {
        using var c = factory.Create();
        var items = await c.QueryAsync<ScheduleSummaryDto>(@"
SELECT [排期客户],[状态],COUNT(*) AS [行数],SUM([数量]) AS [数量]
FROM [生产排期]
GROUP BY [排期客户],[状态]
ORDER BY [排期客户],[状态];");
        return items.AsList();
    }

    // 全部排期客户名（下拉过滤用）
    public async Task<IReadOnlyList<string>> CustomersAsync()
    {
        using var c = factory.Create();
        var items = await c.QueryAsync<string>(
            "SELECT DISTINCT [排期客户] FROM [生产排期] ORDER BY [排期客户];");
        return items.AsList();
    }

    // 销售出货审核联动：把指定货号下仍为"在排"的排期行置为"已走货"。
    // 只按货号匹配(货号为各客户产品专属,成品出货明细的物料编号即货号);客户排期 Excel 重导仍是权威源,可回正。
    // 反审核不自动回退状态。
    public async Task<int> MarkShippedBy货号Async(string 货号, string user)
    {
        if (string.IsNullOrWhiteSpace(货号)) return 0;
        using var c = factory.Create();
        return await c.ExecuteAsync(@"
UPDATE [生产排期] SET [状态]=N'已走货', [操作员]=@user
WHERE [状态]=N'在排' AND [货号]=@货号", new { 货号 = 货号.Trim(), user });
    }

    // 领料出库联动排期：领料单备注含"走货"时按明细溯源——
    // 有 生产单号 的行：生产制单.合同号=排期.PO号 + 生产制单货号.货号=排期.货号，只翻该 PO+货号 的在排行；
    // 无 生产单号 的行：按 物料编号(即货号) 兜底，翻该货号全部在排行(同销售出货口径)。
    // Excel 重导仍是权威源可回正；反审核不回退。
    public async Task<int> MarkShippedForMaterialIssueAsync(string 单号, string user)
    {
        using var c = factory.Create();
        var 备注 = await c.ExecuteScalarAsync<string?>(
            "SELECT [备注] FROM [领料单] WHERE [单号]=@单号", new { 单号 });
        if (备注 is null || !备注.Contains("走货")) return 0;
        var lines = (await c.QueryAsync<MaterialIssueTraceRow>(
            "SELECT [生产单号],[物料编号],[款号] FROM [领料明细单] WHERE [单号]=@单号", new { 单号 })).AsList();
        var mos = lines.Select(l => (l.生产单号 ?? "").Trim()).Where(s => s.Length > 0).Distinct().ToArray();
        var n = mos.Length > 0 ? await MarkShippedBy生产单号Async(mos, user) : 0;
        foreach (var 货号 in lines.Where(l => string.IsNullOrWhiteSpace(l.生产单号))
            .Select(l => (l.物料编号 ?? l.款号 ?? "").Trim()).Where(s => s.Length > 0).Distinct())
            n += await MarkShippedBy货号Async(货号, user);
        return n;
    }

    // 按生产单号溯源回写：生产制单(合同号→排期.PO号) × 生产制单货号(货号→排期.货号)
    public async Task<int> MarkShippedBy生产单号Async(IReadOnlyList<string> 生产单号s, string user)
    {
        var mos = 生产单号s.Where(s => !string.IsNullOrWhiteSpace(s)).Select(s => s.Trim()).Distinct().ToArray();
        if (mos.Length == 0) return 0;
        using var c = factory.Create();
        return await c.ExecuteAsync(@"
UPDATE p SET [状态]=N'已走货', [操作员]=@user
FROM [生产排期] p
WHERE p.[状态]=N'在排' AND EXISTS (
    SELECT 1 FROM [生产制单] h JOIN [生产制单货号] g ON g.[生产单号]=h.[生产单号]
    WHERE h.[生产单号] IN @mos AND p.[PO号]=LTRIM(RTRIM(h.[合同号])) AND p.[货号]=g.[货号])",
            new { mos, user });
    }

    private sealed class MaterialIssueTraceRow
    {
        public string? 生产单号 { get; set; }
        public string? 物料编号 { get; set; }
        public string? 款号 { get; set; }
    }

    // 导入：同一事务内 建批次 → 逐行按自然键 更新或插入 → 回填批次计数
    public async Task<ScheduleImportResult> ImportAsync(ScheduleImportRequest req, string user)
    {
        var 排期客户 = MasterImportHelper.Clean(req.排期客户)
            ?? throw new ArgumentException("排期客户必填");
        if (req.Rows.Count == 0) throw new ArgumentException("没有可导入的排期行");
        if (req.Rows.Count > MaxImportRows) throw new ArgumentException($"单次最多导入 {MaxImportRows} 行");

        var (valid, failures) = ScheduleImportValidator.Validate(req.Rows);
        var result = new ScheduleImportResult { 失败 = failures.Count, 失败明细 = failures };
        var now = DateTime.Now;

        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();

        var 批次ID = await c.ExecuteScalarAsync<long>(@"
INSERT INTO [生产排期批次]([排期客户],[文件名],[导入日期],[操作员],[备注])
OUTPUT INSERTED.[ID]
VALUES(@排期客户,@文件名,@导入日期,@操作员,@备注)",
            new
            {
                排期客户,
                文件名 = MasterImportHelper.Clean(req.文件名),
                导入日期 = now,
                操作员 = user,
                备注 = $"导入{req.Rows.Count}行:有效{valid.Count},失败{failures.Count}"
            }, tx);
        result.批次ID = 批次ID;

        // 预载该客户全部既有行的自然键 → 内存判重(整表一次查询,避免逐行 SELECT)
        var existingKeys = new Dictionary<string, long>();
        foreach (var e in await c.QueryAsync<ScheduleKeyRow>(
            "SELECT [ID],[PO号],[客PO],[SKU],[货号],[数量] FROM [生产排期] WHERE [排期客户]=@排期客户",
            new { 排期客户 }, tx))
            existingKeys.TryAdd(KeyOf(e.PO号, e.客PO, e.SKU, e.货号, e.数量), e.ID);

        foreach (var r in valid)
        {
            try
            {
            // 自然键匹配：同一客户同一 PO 行重复导入 → 更新而非重复新增
            if (existingKeys.TryGetValue(KeyOf(r.PO号, r.客PO, r.SKU, r.货号, r.数量), out var existingId))
            {
                await c.ExecuteAsync(@"
UPDATE [生产排期] SET
    [批次ID]=@批次ID,[状态]=@状态,[接单日期]=@接单日期,[客户名称]=@客户名称,[国家]=@国家,
    [品名]=@品名,[内箱]=@内箱,[外箱]=@外箱,[总箱数]=@总箱数,[走货期]=@走货期,[验货期]=@验货期,
    [第三方验货]=@第三方验货,[车间]=@车间,[来源工作表]=@来源工作表,[Excel行号]=@行号,
    [备注]=@备注,[原始数据]=@原始数据,[操作员]=@操作员
WHERE [ID]=@ID",
                    new
                    {
                        批次ID, ID = existingId, r.状态, r.接单日期, r.客户名称, r.国家,
                        r.品名, r.内箱, r.外箱, r.总箱数, r.走货期, r.验货期,
                        r.第三方验货, r.车间, r.来源工作表, r.行号, r.备注, r.原始数据, 操作员 = user
                    }, tx);
                result.更新++;
            }
            else
            {
                var newId = await c.ExecuteScalarAsync<long>(@"
INSERT INTO [生产排期]([批次ID],[排期客户],[状态],[接单日期],[客户名称],[国家],[PO号],[客PO],[SKU],[货号],[品名],
    [数量],[内箱],[外箱],[总箱数],[走货期],[验货期],[第三方验货],[车间],[来源工作表],[Excel行号],[备注],[原始数据],[创建日期],[操作员])
OUTPUT INSERTED.[ID]
VALUES(@批次ID,@排期客户,@状态,@接单日期,@客户名称,@国家,@PO号,@客PO,@SKU,@货号,@品名,
    @数量,@内箱,@外箱,@总箱数,@走货期,@验货期,@第三方验货,@车间,@来源工作表,@行号,@备注,@原始数据,@创建日期,@操作员)",
                    new
                    {
                        批次ID, 排期客户, r.状态, r.接单日期, r.客户名称, r.国家, r.PO号, r.客PO, r.SKU, r.货号, r.品名,
                        r.数量, r.内箱, r.外箱, r.总箱数, r.走货期, r.验货期, r.第三方验货, r.车间, r.来源工作表,
                        r.行号, r.备注, r.原始数据, 创建日期 = now, 操作员 = user
                    }, tx);
                existingKeys[KeyOf(r.PO号, r.客PO, r.SKU, r.货号, r.数量)] = newId;   // 同文件重复行 → 走更新
                result.新增++;
            }
            }
            // 单行 SQL 异常(截断/溢出等)不拖垮整批:记入失败明细继续(与物料导入的失败行语义一致)
            catch (SqlException ex)
            {
                failures.Add(new ImportFailure
                {
                    行号 = r.行号,
                    物料编号 = r.货号 ?? r.PO号,
                    原因 = ex.Message.Split('\n')[0][..Math.Min(120, ex.Message.Split('\n')[0].Length)]
                });
                result.失败 = failures.Count;
                result.失败明细 = failures;
            }
        }

        await c.ExecuteAsync(
            "UPDATE [生产排期批次] SET [新增]=@新增,[更新]=@更新 WHERE [ID]=@批次ID",
            new { result.新增, result.更新, 批次ID }, tx);

        tx.Commit();
        return result;
    }

    // 手工新增:单行入库,批次ID=NULL(不属于任何导入批次);校验失败抛 ArgumentException
    public async Task<long> CreateAsync(ScheduleRowSaveRequest req, string user)
    {
        var r = Validate(req);
        using var c = factory.Create();
        return await c.ExecuteScalarAsync<long>(@"
INSERT INTO [生产排期]([批次ID],[排期客户],[状态],[接单日期],[客户名称],[国家],[PO号],[客PO],[SKU],[货号],[品名],
    [数量],[内箱],[外箱],[总箱数],[走货期],[验货期],[第三方验货],[车间],[备注],[创建日期],[操作员])
OUTPUT INSERTED.[ID]
VALUES(NULL,@排期客户,@状态,@接单日期,@客户名称,@国家,@PO号,@客PO,@SKU,@货号,@品名,
    @数量,@内箱,@外箱,@总箱数,@走货期,@验货期,@第三方验货,@车间,@备注,@创建日期,@操作员)",
            new
            {
                r.排期客户, r.状态, r.接单日期, r.客户名称, r.国家, r.PO号, r.客PO, r.SKU, r.货号, r.品名,
                r.数量, r.内箱, r.外箱, r.总箱数, r.走货期, r.验货期, r.第三方验货, r.车间, r.备注,
                创建日期 = DateTime.Now, 操作员 = user
            });
    }

    // 手工编辑:按 ID 更新业务字段(批次ID 不动:手工行保持 NULL,导入行仍归原批次);不存在返回 null。
    // 状态变了且 allowStatusChange=false(非经理) → 状态不落地,挂「待经理审核」申请(其余字段照常生效);
    // 该行已有待审变更再改状态 → 抛 InvalidOperationException(409)。
    public async Task<ScheduleUpdateResult?> UpdateAsync(
        long id, ScheduleRowSaveRequest req, string user, bool allowStatusChange)
    {
        var r = Validate(req);
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var current = await c.ExecuteScalarAsync<string?>(
            "SELECT [状态] FROM [生产排期] WHERE [ID]=@id", new { id }, tx);
        if (current is null) return null;

        var pendStatus = r.状态 != current && !allowStatusChange;
        if (pendStatus)
        {
            var pending = await c.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM [生产排期状态变更] WHERE [排期ID]=@id AND [审核状态]=N'待审核'",
                new { id }, tx);
            if (pending > 0) throw new InvalidOperationException("该行已有待经理审核的状态变更,请等审核后再改");
        }

        var set状态 = pendStatus ? "" : "[状态]=@状态,";
        await c.ExecuteAsync($@"
UPDATE [生产排期] SET
    [排期客户]=@排期客户,{set状态}[接单日期]=@接单日期,[客户名称]=@客户名称,[国家]=@国家,
    [PO号]=@PO号,[客PO]=@客PO,[SKU]=@SKU,[货号]=@货号,[品名]=@品名,
    [数量]=@数量,[内箱]=@内箱,[外箱]=@外箱,[总箱数]=@总箱数,[走货期]=@走货期,[验货期]=@验货期,
    [第三方验货]=@第三方验货,[车间]=@车间,[备注]=@备注,[操作员]=@操作员
WHERE [ID]=@id",
            new
            {
                id, r.排期客户, r.状态, r.接单日期, r.客户名称, r.国家, r.PO号, r.客PO, r.SKU, r.货号, r.品名,
                r.数量, r.内箱, r.外箱, r.总箱数, r.走货期, r.验货期, r.第三方验货, r.车间, r.备注, 操作员 = user
            }, tx);

        if (pendStatus)
            await c.ExecuteAsync(@"
INSERT INTO [生产排期状态变更]([排期ID],[原状态],[新状态],[审核状态],[申请人],[申请日期])
VALUES(@id,@原状态,@新状态,N'待审核',@user,SYSDATETIME())",
                new { id, 原状态 = current, 新状态 = r.状态, user }, tx);

        tx.Commit();
        return new ScheduleUpdateResult(pendStatus);
    }

    // 状态变更申请列表(排期行展示字段 join;审核状态空=全部,按申请倒序,最多 200 条)
    public async Task<IReadOnlyList<ScheduleStatusChangeDto>> StatusChangesAsync(string? 审核状态)
    {
        var st = string.IsNullOrWhiteSpace(审核状态) ? null : 审核状态.Trim();
        using var c = factory.Create();
        var items = await c.QueryAsync<ScheduleStatusChangeDto>(@"
SELECT TOP 200 sc.[ID],sc.[排期ID],sc.[原状态],sc.[新状态],sc.[审核状态],sc.[申请人],sc.[申请日期],
       sc.[审核人],sc.[审核日期],sc.[审核备注],
       p.[排期客户],p.[PO号],p.[货号],p.[品名]
FROM [生产排期状态变更] sc
LEFT JOIN [生产排期] p ON p.[ID]=sc.[排期ID]
WHERE (@st IS NULL OR sc.[审核状态]=@st)
ORDER BY sc.[ID] DESC;",
            new { st });
        return items.AsList();
    }

    public async Task<int> PendingStatusChangeCountAsync()
    {
        using var c = factory.Create();
        return await c.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM [生产排期状态变更] WHERE [审核状态]=N'待审核'");
    }

    // 经理审核通过:状态落到排期行 + 申请单结单(同事务);申请不存在/已审/行已删 分别抛错
    public async Task ApproveStatusChangeAsync(long id, string user, string? 备注)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var ch = await c.QuerySingleOrDefaultAsync<ScheduleStatusChangeDto>(
            "SELECT [ID],[排期ID],[新状态],[审核状态] FROM [生产排期状态变更] WHERE [ID]=@id",
            new { id }, tx)
            ?? throw new KeyNotFoundException("状态变更申请不存在");
        if (ch.审核状态 != "待审核") throw new InvalidOperationException("该申请已审核,请刷新列表");
        var n = await c.ExecuteAsync(
            "UPDATE [生产排期] SET [状态]=@新状态,[操作员]=@user WHERE [ID]=@排期ID",
            new { ch.新状态, user, ch.排期ID }, tx);
        if (n == 0) throw new KeyNotFoundException("排期行已被删除,无法通过审核");
        await c.ExecuteAsync(@"
UPDATE [生产排期状态变更] SET [审核状态]=N'已通过',[审核人]=@user,[审核日期]=SYSDATETIME(),[审核备注]=@备注
WHERE [ID]=@id", new { id, user, 备注 = MasterImportHelper.Clean(备注) }, tx);
        tx.Commit();
    }

    public async Task RejectStatusChangeAsync(long id, string user, string? 备注)
    {
        using var c = factory.Create();
        var n = await c.ExecuteAsync(@"
UPDATE [生产排期状态变更] SET [审核状态]=N'已驳回',[审核人]=@user,[审核日期]=SYSDATETIME(),[审核备注]=@备注
WHERE [ID]=@id AND [审核状态]=N'待审核'",
            new { id, user, 备注 = MasterImportHelper.Clean(备注) });
        if (n == 0)
        {
            using var c2 = factory.Create();
            var exists = await c2.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM [生产排期状态变更] WHERE [ID]=@id", new { id });
            if (exists == 0) throw new KeyNotFoundException("状态变更申请不存在");
            throw new InvalidOperationException("该申请已审核,请刷新列表");
        }
    }

    // 删除单行(生产排期无 FK 引用,db/69 不加 FK 由应用层保证);不存在返回 false
    // 连带把该行的状态变更申请标驳回(已删除),防止审核时才发现行没了
    public async Task<bool> DeleteAsync(long id)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var n = await c.ExecuteAsync("DELETE FROM [生产排期] WHERE [ID]=@id", new { id }, tx);
        if (n > 0)
            await c.ExecuteAsync(@"
UPDATE [生产排期状态变更] SET [审核状态]=N'已驳回',[审核备注]=N'排期行已删除'
WHERE [排期ID]=@id AND [审核状态]=N'待审核'", new { id }, tx);
        tx.Commit();
        return n > 0;
    }

    // 手工保存校验:排期客户必填;状态限 在排/已走货/已取消;列宽与 db/69 一致;数量类非负
    private static ScheduleRowSaveRequest Validate(ScheduleRowSaveRequest req)
    {
        var r = new ScheduleRowSaveRequest
        {
            排期客户 = MasterImportHelper.Clean(req.排期客户),
            状态 = MasterImportHelper.Clean(req.状态),
            接单日期 = req.接单日期,
            客户名称 = MasterImportHelper.Clean(req.客户名称),
            国家 = MasterImportHelper.Clean(req.国家),
            PO号 = MasterImportHelper.Clean(req.PO号),
            客PO = MasterImportHelper.Clean(req.客PO),
            SKU = MasterImportHelper.Clean(req.SKU),
            货号 = MasterImportHelper.Clean(req.货号),
            品名 = MasterImportHelper.Clean(req.品名),
            数量 = req.数量,
            内箱 = req.内箱,
            外箱 = req.外箱,
            总箱数 = req.总箱数,
            走货期 = req.走货期,
            验货期 = req.验货期,
            第三方验货 = MasterImportHelper.Clean(req.第三方验货),
            车间 = MasterImportHelper.Clean(req.车间),
            备注 = MasterImportHelper.Clean(req.备注),
        };
        if (r.排期客户 is null) throw new ArgumentException("排期客户必填");
        if (r.状态 is null) throw new ArgumentException("状态必填");
        if (r.状态 is not ("在排" or "已走货" or "已取消")) throw new ArgumentException("状态只能是在排/已走货/已取消");
        var lenErr = MasterImportHelper.LengthError(r.排期客户, "排期客户", 60)
            ?? MasterImportHelper.LengthError(r.客户名称, "客户名称", 60)
            ?? MasterImportHelper.LengthError(r.国家, "国家", 40)
            ?? MasterImportHelper.LengthError(r.PO号, "PO号", 60)
            ?? MasterImportHelper.LengthError(r.客PO, "客PO", 60)
            ?? MasterImportHelper.LengthError(r.SKU, "SKU", 60)
            ?? MasterImportHelper.LengthError(r.货号, "货号", 60)
            ?? MasterImportHelper.LengthError(r.品名, "品名", 100)
            ?? MasterImportHelper.LengthError(r.第三方验货, "第三方验货", 10)
            ?? MasterImportHelper.LengthError(r.车间, "车间", 20)
            ?? MasterImportHelper.LengthError(r.备注, "备注", 400);
        if (lenErr is not null) throw new ArgumentException(lenErr);
        if (r.数量 < 0) throw new ArgumentException("数量不能为负");
        if (r.总箱数 < 0) throw new ArgumentException("总箱数不能为负");
        if (r.内箱 < 0) throw new ArgumentException("内箱不能为负");
        if (r.外箱 < 0) throw new ArgumentException("外箱不能为负");
        return r;
    }

    // 删除批次：先明细后批次
    public async Task<bool> DeleteBatchAsync(long 批次ID)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var exists = await c.ExecuteScalarAsync<long?>(
            "SELECT [ID] FROM [生产排期批次] WHERE [ID]=@批次ID", new { 批次ID }, tx);
        if (exists is null) return false;
        await c.ExecuteAsync("DELETE FROM [生产排期] WHERE [批次ID]=@批次ID", new { 批次ID }, tx);
        await c.ExecuteAsync("DELETE FROM [生产排期批次] WHERE [ID]=@批次ID", new { 批次ID }, tx);
        tx.Commit();
        return true;
    }

    // 自然键(NULL 归一为空串/-1;数量按定点字符串比较,与 decimal(18,2) 列精度一致)
    internal static string KeyOf(string? po号, string? 客po, string? sku, string? 货号, decimal? 数量)
        => string.Join('\u001f',
            (po号 ?? "").Trim(), (客po ?? "").Trim(), (sku ?? "").Trim(), (货号 ?? "").Trim(),
            数量?.ToString("0.00") ?? "-1");

    // 预载判重的最小行
    private sealed class ScheduleKeyRow
    {
        public long ID { get; set; }
        public string? PO号 { get; set; }
        public string? 客PO { get; set; }
        public string? SKU { get; set; }
        public string? 货号 { get; set; }
        public decimal? 数量 { get; set; }
    }
}
