using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.MasterData;
using ErpApi.Features.Messages;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Features.Production.Replenishment;

// 补料单（补料区）：装配生产中物料损坏补料。两层：补料单 + 补料明细单。
// 流程=装配开单(必选 PMC 负责人)→审核（不扣库存！补料只是采购申请，物料还没入库）；
// 扣库存发生在后续：采购入库 → 开领料单出库（照领料单既有口径，补料单自身不进库存台账）。
// 开单发消息知会所选部门(部门信息→人事档案→账号) + 仓管 + 所选 PMC（messages 可空，DI 注入；测试不传时不发）；
// 审核通过后发消息知会该 PMC 安排采购，采购订单页可「从补料单带入」，保存成功标 已采购='1' 防重复带入。
public sealed class ReplenishmentService(ISqlConnectionFactory factory, IDocumentNumberGenerator docNo,
    MessageService? messages = null)
{
    public const string DocType = "补料单";
    public const string Prefix = "BUL";   // 补料单号 = BUL + yyyyMMdd + 3位流水（"BL" 已被半成品领料单占用）

    // 仓管接收人：职称='仓管' 的全部账号（账号=姓名，重名带(编号)后缀 LIKE 兼容）
    private async Task<IReadOnlyList<string>> KeeperAccountsAsync()
    {
        using var c = factory.Create();
        return (await c.QueryAsync<string>(@"
SELECT DISTINCT u.[用户] FROM [人事档案] p
JOIN [sysfileuser] u ON u.[用户] = p.[姓名] OR u.[用户] LIKE p.[姓名] + N'(%'
WHERE p.[职称] = N'仓管'")).AsList();
    }

    // 指定 PMC 的账号：人事档案 姓名=@姓名 且 职称='PMC' 的 join 账号；查不到退化用姓名本身当接收人
    private async Task<IReadOnlyList<string>> PmcAccountsAsync(string 姓名)
    {
        using var c = factory.Create();
        var list = (await c.QueryAsync<string>(@"
SELECT DISTINCT u.[用户] FROM [人事档案] p
JOIN [sysfileuser] u ON u.[用户] = p.[姓名] OR u.[用户] LIKE p.[姓名] + N'(%'
WHERE p.[职称] = N'PMC' AND p.[姓名] = @姓名", new { 姓名 })).AsList();
        return list.Count > 0 ? list : [姓名];
    }

    // 指定部门的全部账号：部门信息.部门=@部门 → 部门编号 → 人事档案.部门编号 → join 账号；部门不存在/无人员时返回空
    private async Task<IReadOnlyList<string>> DeptAccountsAsync(string 部门)
    {
        using var c = factory.Create();
        return (await c.QueryAsync<string>(@"
SELECT DISTINCT u.[用户] FROM [部门信息] d
JOIN [人事档案] p ON p.[部门编号] = d.[编号]
JOIN [sysfileuser] u ON u.[用户] = p.[姓名] OR u.[用户] LIKE p.[姓名] + N'(%'
WHERE d.[部门] = @部门", new { 部门 })).AsList();
    }

    // 全部 PMC 账号：旧单据未填 PMC 时的退回口径
    private async Task<IReadOnlyList<string>> AllPmcAccountsAsync()
    {
        using var c = factory.Create();
        return (await c.QueryAsync<string>(@"
SELECT DISTINCT u.[用户] FROM [人事档案] p
JOIN [sysfileuser] u ON u.[用户] = p.[姓名] OR u.[用户] LIKE p.[姓名] + N'(%'
WHERE p.[职称] = N'PMC'")).AsList();
    }

    private Task NotifyAsync(IEnumerable<string> 接收人, string? 单号, string 标题, string? 内容) =>
        messages is null ? Task.CompletedTask : messages.SendAsync(接收人, "补料审批", 单号, 标题, 内容);

    public async Task<string> CreateAsync(ReplenishmentCreateDto dto, string user)
    {
        var 仓库 = dto.仓库?.Trim() ?? "";
        if (仓库 is not ("来料仓" or "塑胶仓")) throw new ArgumentException("补料单仓库必须是 来料仓 或 塑胶仓。");
        var pmc = dto.PMC?.Trim() ?? "";
        if (pmc.Length == 0) throw new ArgumentException("请选择负责该补料单的 PMC。");
        var 部门 = dto.部门?.Trim() ?? "";
        if (部门.Length == 0) throw new ArgumentException("请选择补料部门。");
        var 有效行 = dto.明细.Where(l => !string.IsNullOrWhiteSpace(l.物料编号)).ToList();
        if (有效行.Count == 0) throw new ArgumentException("补料单至少要有一行物料明细。");
        foreach (var l in 有效行)
            if (l.数量 <= 0) throw new ArgumentException($"[{l.物料编号!.Trim()}] 补料数量必须大于 0。");
        var 数量合计 = 有效行.Sum(l => l.数量);
        var now = DateTime.Now;
        var docDate = (dto.日期 ?? now).Date;

        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();

        var 单号 = await docNo.NextAsync(DocType, Prefix, docDate, c, tx);

        await c.ExecuteAsync(@"
INSERT INTO [补料单]([单号],[日期],[部门],[生产单号],[款号],[仓库],[数量],[操作员],[审核],[PMC],[备注])
VALUES(@单号,@日期,@部门,@生产单号,@款号,@仓库,@数量,@操作员,'0',@PMC,@备注)",
            new { 单号, 日期 = docDate, 部门, dto.生产单号, dto.款号, 仓库,
                  数量 = 数量合计, 操作员 = user, PMC = pmc, dto.备注 }, tx);

        foreach (var l in 有效行)
            await c.ExecuteAsync(@"
INSERT INTO [补料明细单]([单号],[物料编号],[物料名称],[规格],[颜色],[单位],[数量],[仓库],[备注])
VALUES(@单号,@物料编号,@物料名称,@规格,@颜色,@单位,@数量,@仓库,@备注)",
                new { 单号, 物料编号 = l.物料编号!.Trim(), l.物料名称, l.规格, l.颜色, l.单位,
                      l.数量, 仓库, l.备注 }, tx);

        tx.Commit();
        // 开单 → 知会所选部门(该部门的账号都会收到) + 仓管(备货知会) + 所选 PMC(待审)
        var 接收人 = (await DeptAccountsAsync(部门))
            .Concat(await KeeperAccountsAsync())
            .Concat(await PmcAccountsAsync(pmc)).Distinct().ToList();
        await NotifyAsync(接收人, 单号, "补料单待 PMC 审核",
            $"补料单 {单号}（{部门}，{仓库}，共 {数量合计} 件）已提交，请 PMC 审核。");
        return 单号;
    }

    public async Task<PagedResult<ReplenishmentHeaderDto>> ListAsync(int page, int size, string? keyword, string? 审核情况,
        string? 仓库 = null, bool 待采购 = false)
    {
        if (page < 1) page = 1;
        if (size < 1) size = 20;
        if (size > 1000) size = 1000;
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        // 审核情况过滤片段："已审核"→已审核；"未审核"→非已审核；其它/空→全部
        var audit = 审核情况 switch
        {
            "已审核" => " AND ISNULL([审核],'0') = '1'",
            "未审核" => " AND ISNULL([审核],'0') <> '1'",
            _ => "",
        };
        // 待采购=采购带入弹窗口径：已审核且未标已采购
        if (待采购) audit += " AND ISNULL([审核],'0') = '1' AND ISNULL([已采购],'0') <> '1'";
        var wh = string.IsNullOrWhiteSpace(仓库) ? null : 仓库.Trim();
        var where = "WHERE (@kw IS NULL OR [单号] LIKE @kw OR [部门] LIKE @kw OR [生产单号] LIKE @kw OR [款号] LIKE @kw OR [备注] LIKE @kw)" +
            " AND (@wh IS NULL OR [仓库] = @wh)" + audit;
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync($@"
SELECT COUNT(*) FROM [补料单] {where};
SELECT [ID],[单号],[日期],[部门],[生产单号],[款号],[仓库],[数量],[PMC],[操作员],[审核],[审核人],[审核时间],[已采购],[采购时间],[备注]
FROM [补料单] {where}
ORDER BY [ID] DESC OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;",
            new { kw, wh, page, size });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<ReplenishmentHeaderDto>()).AsList();
        return new PagedResult<ReplenishmentHeaderDto>(items, total);
    }

    public async Task<ReplenishmentDetailDto?> GetAsync(string 单号)
    {
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT [ID],[单号],[日期],[部门],[生产单号],[款号],[仓库],[数量],[PMC],[操作员],[审核],[审核人],[审核时间],[已采购],[采购时间],[备注]
FROM [补料单] WHERE [单号]=@单号;
SELECT [ID],[物料编号],[物料名称],[规格],[颜色],[单位],[数量],[备注]
FROM [补料明细单] WHERE [单号]=@单号 ORDER BY [ID];",
            new { 单号 });
        var header = await multi.ReadFirstOrDefaultAsync<ReplenishmentHeaderDto>();
        if (header is null) return null;
        var lines = (await multi.ReadAsync<ReplenishmentLineDto>()).AsList();
        return new ReplenishmentDetailDto { 单头 = header, 明细 = lines };
    }

    // 审核=确认补料需求成立：仅置 审核='1'，不扣库存（补料走采购入库→领料单才扣）。仅未审核可审。审核后知会该单 PMC 安排采购。
    public async Task AuditAsync(string 单号, string user)
    {
        using var c = factory.Create();
        var n = await c.ExecuteAsync(@"
UPDATE [补料单] SET [审核]='1',[审核人]=@user,[审核时间]=SYSDATETIME()
WHERE [单号]=@单号 AND ISNULL([审核],'0')<>'1'", new { user, 单号 });
        if (n > 0)
        {
            // 审核成功 → 知会该单 PMC 安排采购 + 该单部门(补料已通过)；旧数据 PMC 为空则退回发给全部 PMC 账号
            var pmc = await c.ExecuteScalarAsync<string?>(
                "SELECT NULLIF(LTRIM(RTRIM(ISNULL([PMC],N''))),N'') FROM [补料单] WHERE [单号]=@单号", new { 单号 });
            var 部门 = await c.ExecuteScalarAsync<string?>(
                "SELECT NULLIF(LTRIM(RTRIM(ISNULL([部门],N''))),N'') FROM [补料单] WHERE [单号]=@单号", new { 单号 });
            var 接收人 = (pmc is null ? await AllPmcAccountsAsync() : await PmcAccountsAsync(pmc))
                .Concat(部门 is null ? [] : await DeptAccountsAsync(部门)).Distinct().ToList();
            await NotifyAsync(接收人, 单号, "补料单已审核，请安排采购",
                $"补料单 {单号} 已审核，请安排采购：请到采购订单页用「从补料单带入」下单。");
            return;
        }
        var 存在 = await c.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM [补料单] WHERE [单号]=@单号", new { 单号 });
        if (存在 == 0) throw new KeyNotFoundException($"补料单 {单号} 不存在。");
        throw new InvalidOperationException("该补料单已审核，不能重复审核。");
    }

    // 反审核：清回 '0'（不涉及库存）。仅已审核可反审。
    public async Task ReverseAuditAsync(string 单号, string user)
    {
        using var c = factory.Create();
        var n = await c.ExecuteAsync(@"
UPDATE [补料单] SET [审核]='0',[审核人]=NULL,[审核时间]=NULL
WHERE [单号]=@单号 AND ISNULL([审核],'0')='1'", new { user, 单号 });
        if (n > 0) return;
        var 存在 = await c.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM [补料单] WHERE [单号]=@单号", new { 单号 });
        if (存在 == 0) throw new KeyNotFoundException($"补料单 {单号} 不存在。");
        throw new InvalidOperationException("该补料单未审核，不能反审核。");
    }

    // 标记已采购（采购订单保存成功后调用）：仅已审核可标；已标的重复调用不报错（幂等）。
    public async Task MarkPurchasedAsync(string 单号)
    {
        using var c = factory.Create();
        var n = await c.ExecuteAsync(@"
UPDATE [补料单] SET [已采购]='1',[采购时间]=SYSDATETIME()
WHERE [单号]=@单号 AND ISNULL([审核],'0')='1' AND ISNULL([已采购],'0')<>'1'", new { 单号 });
        if (n > 0) return;
        var 状态 = await c.QueryFirstOrDefaultAsync<string?>(@"
SELECT CASE WHEN ISNULL([审核],'0')<>'1' THEN 'N' WHEN ISNULL([已采购],'0')='1' THEN 'P' ELSE 'X' END
FROM [补料单] WHERE [单号]=@单号", new { 单号 });
        if (状态 is null) throw new KeyNotFoundException($"补料单 {单号} 不存在。");
        if (状态 == "P") return;   // 幂等：已标不报错
        throw new InvalidOperationException("该补料单未审核，不能标记已采购。");
    }

    public async Task<bool> DeleteAsync(string 单号)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [补料单] WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null) return false;
        if (审核 == "1") throw new InvalidOperationException("已审核的补料单不能删除，请先反审核。");
        await c.ExecuteAsync("DELETE FROM [补料明细单] WHERE [单号]=@单号", new { 单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [补料单] WHERE [单号]=@单号", new { 单号 }, tx);
        tx.Commit();
        return true;
    }
}
