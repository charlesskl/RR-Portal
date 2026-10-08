using Dapper;
using ErpApi.Engines.Authorization;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.MasterData;
using ErpApi.Features.Messages;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
namespace ErpApi.Features.Materials.MaterialIssue;

// 领料单（物料库存 − 去向）。两层：领料单 + 领料明细单。库存方向由 MaterialInventoryService 统一处理。
// 三级流转产生消息:开单→主管(职称='主管')，主管审→经理，经理审→仓管(职称='仓管',全厂)；
// messages/audit 可空(DI 注入;测试不传时不发消息/不写审计)。
public sealed class MaterialIssueService(ISqlConnectionFactory factory, IDocumentNumberGenerator docNo,
    MessageService? messages = null, IAuditLogger? audit = null)
{
    public const string DocType = "领料单";
    public const string Prefix = "LL";   // 领料单号 = LL + yyyyMMdd + 3位流水

    // 按 领料部门+职称 找接收账号(账号=姓名;重名账号带(编号)后缀用 LIKE 兼容)
    private async Task<IReadOnlyList<string>> RecipientsAsync(string? 领料部门, string 职称)
    {
        using var c = factory.Create();
        return (await c.QueryAsync<string>(@"
SELECT DISTINCT u.[用户] FROM [人事档案] p
JOIN [部门信息] d ON d.[编号] = p.[部门编号]
JOIN [sysfileuser] u ON u.[用户] = p.[姓名] OR u.[用户] LIKE p.[姓名] + N'(%'
WHERE d.[部门] = @领料部门 AND p.[职称] = @职称", new { 领料部门, 职称 })).AsList();
    }

    private Task NotifyAsync(IEnumerable<string> 接收人, string? 单号, string 标题, string? 内容) =>
        messages is null ? Task.CompletedTask : messages.SendAsync(接收人, "领料审批", 单号, 标题, 内容);

    private static string? Like(string? value) =>
        string.IsNullOrWhiteSpace(value) || value.Trim() == "全部" ? null : $"%{value.Trim()}%";

    private static string? Exact(string? value) =>
        string.IsNullOrWhiteSpace(value) || value.Trim() == "全部" ? null : value.Trim();

    public async Task<string> CreateAsync(MaterialIssueCreateDto dto, string user)
    {
        if (dto.明细.Count == 0) throw new ArgumentException("领料单至少要有一行物料明细");
        if (string.IsNullOrWhiteSpace(dto.仓库)) throw new ArgumentException("领料单必须指定仓库");
        if (string.IsNullOrWhiteSpace(dto.接受人)) throw new ArgumentException("领料单必须选择接受人（仓管或PMC）");
        var 数量合计 = dto.明细.Sum(l => l.数量);
        var 金额合计 = dto.明细.Sum(l => l.数量 * (l.单价 ?? 0));
        var now = DateTime.Now;
        var docDate = dto.日期 ?? now;

        using var c = factory.Create();
        await c.OpenAsync();
        // 接受人必须是 人事档案 中 职称=仓管 或 PMC 的人
        var 接受人 = dto.接受人!.Trim();
        var 存在 = await c.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM [人事档案] WHERE [姓名]=@接受人", new { 接受人 });
        if (存在 == 0) throw new ArgumentException($"接受人 [{接受人}] 不在人事档案中。");
        var 职称 = await c.ExecuteScalarAsync<string?>(
            "SELECT MAX([职称]) FROM [人事档案] WHERE [姓名]=@接受人", new { 接受人 });
        if (职称 is not ("仓管" or "PMC")) throw new ArgumentException($"接受人 [{接受人}] 的职位必须是仓管或PMC（当前：{职称 ?? "未填写"}）。");
        using var tx = c.BeginTransaction();

        var 单号 = await docNo.NextAsync(DocType, Prefix, docDate, c, tx);

        await c.ExecuteAsync(@"
INSERT INTO [领料单]([单号],[日期],[领料部门],[领料人],[仓库],[接受人],[数量],[金额],[操作员],[审核],[备注])
VALUES(@单号,@日期,@领料部门,@领料人,@仓库,@接受人,@数量,@金额,@操作员,'0',@备注)",
            new { 单号, 日期 = docDate, dto.领料部门, dto.领料人, dto.仓库, 接受人,
                  数量 = 数量合计, 金额 = 金额合计, 操作员 = user, dto.备注 }, tx);

        foreach (var l in dto.明细)
            await c.ExecuteAsync(@"
INSERT INTO [领料明细单]([单号],[日期],[仓库],[物料类别],[物料编号],[物料名称],[规格],[颜色],[单位],[数量],[单价],[金额],[备注],[生产单号],[款号])
VALUES(@单号,@日期,@仓库,@物料类别,@物料编号,@物料名称,@规格,@颜色,@单位,@数量,@单价,@金额,@备注,@生产单号,@款号)",
                new { 单号, 日期 = docDate, dto.仓库, l.物料类别, l.物料编号, l.物料名称, l.规格, l.颜色, l.单位,
                      l.数量, 单价 = l.单价 ?? 0, 金额 = l.数量 * (l.单价 ?? 0), l.备注, l.生产单号, l.款号 }, tx);

        tx.Commit();
        // 开单 → 消息给该部门主管(职称='主管')
        await NotifyAsync(await RecipientsAsync(dto.领料部门, "主管"), 单号,
            $"新的领料单待主管审核", $"领料单 {单号}（{dto.领料部门}，共 {数量合计} 件）已提交，请审核。");
        return 单号;
    }

    public async Task<PagedResult<MaterialIssueHeaderDto>> ListAsync(int page, int size, string? keyword)
    {
        if (page < 1) page = 1;
        if (size < 1) size = 20;
        if (size > 1000) size = 1000;
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [领料单]
WHERE @kw IS NULL OR [单号] LIKE @kw OR [领料部门] LIKE @kw OR [领料人] LIKE @kw OR [备注] LIKE @kw;
SELECT [ID],[单号],[日期],[领料部门],[领料人],[仓库],[数量],[金额],[操作员],[审核],[审核人],[备注],[主管审核],[主管审核人],[经理审核],[经理审核人],[接受人]
FROM [领料单]
WHERE @kw IS NULL OR [单号] LIKE @kw OR [领料部门] LIKE @kw OR [领料人] LIKE @kw OR [备注] LIKE @kw
ORDER BY [ID] DESC OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;",
            new { kw, page, size });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<MaterialIssueHeaderDto>()).AsList();
        return new PagedResult<MaterialIssueHeaderDto>(items, total);
    }

    public async Task<MaterialIssueDetailDto?> GetAsync(string 单号)
    {
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT [ID],[单号],[日期],[领料部门],[领料人],[仓库],[数量],[金额],[操作员],[审核],[审核人],[备注],[主管审核],[主管审核人],[经理审核],[经理审核人],[接受人]
FROM [领料单] WHERE [单号]=@单号;
SELECT [ID],[物料编号],[物料名称],[物料类别],[规格],[颜色],[单位],[数量],[单价],[金额],[备注],[生产单号],[款号],[已出数量]
FROM [领料明细单] WHERE [单号]=@单号 ORDER BY [ID];",
            new { 单号 });
        var header = await multi.ReadFirstOrDefaultAsync<MaterialIssueHeaderDto>();
        if (header is null) return null;
        var lines = (await multi.ReadAsync<MaterialDocLineDto>()).AsList();
        return new MaterialIssueDetailDto { 单头 = header, 明细 = lines };
    }

    public async Task<bool> DeleteAsync(string 单号)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [领料单] WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null) return false;
        if (审核 == "1") throw new InvalidOperationException("已审核的领料单不能删除，请先反审核。");
        var 已出行数 = await c.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM [领料明细单] WHERE [单号]=@单号 AND ISNULL([已出数量],0) > 0", new { 单号 }, tx);
        if (已出行数 > 0) throw new InvalidOperationException("该领料单已有出库记录，不能删除；请先反审核撤销出库。");
        await c.ExecuteAsync("DELETE FROM [领料明细单] WHERE [单号]=@单号", new { 单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [领料单] WHERE [单号]=@单号", new { 单号 }, tx);
        tx.Commit();
        return true;
    }

    // 校验用户是否为 该部门指定职称(主管/经理)的人；admin(系统管理员)可代办
    // 责任部门解析:单上 领料部门(名称)→部门信息.编号;为空/查不到退回 02 装配部
    private static async Task<(string 编号, string 名称)> ResponsibleDeptAsync(SqlConnection c, string? 领料部门)
    {
        string? code = null;
        if (!string.IsNullOrWhiteSpace(领料部门))
            code = await c.ExecuteScalarAsync<string?>(
                "SELECT [编号] FROM [部门信息] WHERE [部门]=@name", new { name = 领料部门.Trim() });
        code ??= "02";
        var deptName = await c.ExecuteScalarAsync<string?>(
            "SELECT [部门] FROM [部门信息] WHERE [编号]=@code", new { code }) ?? code;
        return (code, deptName);
    }

    // 校验用户是否具有指定职称;部门编号 非 null 时限定该部门(主管),null 时不限部门(经理)。admin(系统管理员)可代办
    private async Task<bool> HasRoleAsync(string user, string? 部门编号, string 职称)
    {
        if (user.Equals("admin", StringComparison.OrdinalIgnoreCase)) return true;
        using var c = factory.Create();
        var n = 部门编号 is null
            ? await c.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM [人事档案] WHERE [姓名] = @user AND [职称] = @职称", new { user, 职称 })
            : await c.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM [人事档案] WHERE [姓名] = @user AND [职称] = @职称 AND [部门编号] = @部门编号", new { user, 职称, 部门编号 });
        return n > 0;
    }

    // 三级流转：开单(未审核) → 主管审核(责任部门主管) → 经理审核(不限部门) → 来料仓出库。
    // 出库必须 经理审核='1'(即经理审核完才会"发到"来料仓);单据上显示 主管/经理 审核人。
    public async Task SupervisorApproveAsync(string 单号, string user)
    {
        using var c = factory.Create();
        var 部门 = await c.ExecuteScalarAsync<string?>("SELECT [领料部门] FROM [领料单] WHERE [单号]=@单号", new { 单号 });
        var (编号, 部门名) = await ResponsibleDeptAsync(c, 部门);
        if (!await HasRoleAsync(user, 编号, "主管"))
            throw new InvalidOperationException($"[{user}] 不是 {部门名} 的主管，不能主管审核。");
        var n = await c.ExecuteAsync(@"
UPDATE [领料单] SET [主管审核]='1',[主管审核人]=@user,[主管审核日期]=SYSDATETIME()
WHERE [单号]=@单号 AND ISNULL([主管审核],'0')<>'1' AND ISNULL([审核],'0')<>'1'", new { user, 单号 });
        if (n == 0) throw new InvalidOperationException("主管审核失败：单不存在、已主管审核或已完成出库。");
        // 主管审完 → 消息给该部门经理(职称='经理')
        await NotifyAsync(await RecipientsAsync(部门, "经理"), 单号,
            "领料单待经理审核", $"领料单 {单号} 已经主管 {user} 审核，请经理审核。");
    }

    public async Task ManagerApproveAsync(string 单号, string user)
    {
        using var c = factory.Create();
        var 主管 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([主管审核],'0') FROM [领料单] WHERE [单号]=@单号", new { 单号 });
        if (主管 is null) throw new KeyNotFoundException($"领料单 {单号} 不存在。");
        if (主管 != "1") throw new InvalidOperationException("请先经主管审核，再由经理审核。");
        // 经理不限部门:人事档案 职称='经理' 即可
        if (!await HasRoleAsync(user, null, "经理"))
            throw new InvalidOperationException($"[{user}] 不是经理，不能经理审核。");
        var n = await c.ExecuteAsync(@"
UPDATE [领料单] SET [经理审核]='1',[经理审核人]=@user,[经理审核日期]=SYSDATETIME()
WHERE [单号]=@单号 AND ISNULL([经理审核],'0')<>'1' AND ISNULL([审核],'0')<>'1'", new { user, 单号 });
        if (n == 0) throw new InvalidOperationException("经理审核失败：已经理审核或已完成出库。");
        // 经理审完 → 消息只发给开单选定的接受人(仓管/PMC),收到后安排出库
        var doc = await c.QuerySingleAsync<(string? 部门, string? 接受人)>(
            "SELECT [领料部门] AS 部门, [接受人] FROM [领料单] WHERE [单号]=@单号", new { 单号 });
        IReadOnlyList<string> 接受人账号 = string.IsNullOrWhiteSpace(doc.接受人)
            ? Array.Empty<string>()
            : (await c.QueryAsync<string>(
                "SELECT [用户] FROM [sysfileuser] WHERE [用户]=@name OR [用户] LIKE @name + N'(%'",
                new { name = doc.接受人 })).AsList();
        await NotifyAsync(接受人账号, 单号,
            "领料单待出库", $"领料单 {单号}（{doc.部门}）已主管、经理审核，请安排出库。");
    }

    // 分次出库：来料仓对装配部开的领料单按行出库。已出数量 累计(台账按它实时扣库存)；
    // 全部行出完自动置 审核='1'(完成)。防超领/防重入行。
    public async Task<MaterialIssueOutboundResult> OutboundAsync(
        string 单号, IReadOnlyList<MaterialIssueOutboundLineDto> 明细, string user)
    {
        if (明细.Count == 0) throw new ArgumentException("出库明细不能为空。");
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var header = await c.QuerySingleOrDefaultAsync<OutboundHeaderRow>(
            "SELECT ISNULL([审核],'0') AS 审核, ISNULL([经理审核],'0') AS 经理审核 FROM [领料单] WITH (UPDLOCK, HOLDLOCK) WHERE [单号]=@单号", new { 单号 }, tx);
        if (header is null) throw new KeyNotFoundException($"领料单 {单号} 不存在。");
        if (header.审核 == "1") throw new InvalidOperationException("该领料单已完成出库，不能再次出库。");
        if (header.经理审核 != "1") throw new InvalidOperationException("该领料单尚未经部门主管、经理审核，不能出库。");

        var lines = (await c.QueryAsync<OutboundLineRow>(@"
SELECT [ID],[物料编号],[物料名称],ISNULL([数量],0) AS 数量,ISNULL([已出数量],0) AS 已出
FROM [领料明细单] WITH (UPDLOCK, HOLDLOCK) WHERE [单号]=@单号", new { 单号 }, tx)).AsList();
        var byId = lines.ToDictionary(l => l.ID);

        var done = 0;
        foreach (var req in 明细)
        {
            if (!byId.TryGetValue(req.行ID, out var line))
                throw new ArgumentException($"明细行 {req.行ID} 不属于该领料单。");
            if (req.数量 <= 0)
                throw new ArgumentException($"[{line.物料编号}] 出库数量必须大于 0。");
            var 未领 = line.数量 - line.已出;
            if (req.数量 > 未领)
                throw new InvalidOperationException($"[{line.物料编号} {line.物料名称}] 未领 {未领}，出库 {req.数量} 超出申请数量。");
            await c.ExecuteAsync(
                "UPDATE [领料明细单] SET [已出数量]=ISNULL([已出数量],0)+@本次 WHERE [ID]=@行ID",
                new { 本次 = req.数量, req.行ID }, tx);
            done++;
        }

        var 剩余行 = await c.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM [领料明细单] WHERE [单号]=@单号 AND ISNULL([已出数量],0) < ISNULL([数量],0)",
            new { 单号 }, tx);
        var 完成 = 剩余行 == 0;
        if (完成)
            await c.ExecuteAsync(
                "UPDATE [领料单] SET [审核]='1',[审核人]=@user WHERE [单号]=@单号", new { user, 单号 }, tx);
        tx.Commit();
        return new MaterialIssueOutboundResult { 单号 = 单号, 出库行数 = done, 完成 = 完成 };
    }

    private sealed class OutboundHeaderRow
    {
        public string? 审核 { get; set; }
        public string? 经理审核 { get; set; }
    }

    private sealed class OutboundLineRow
    {
        public long ID { get; set; }
        public string? 物料编号 { get; set; }
        public string? 物料名称 { get; set; }
        public decimal 数量 { get; set; }
        public decimal 已出 { get; set; }
    }

    // 审核:一个事务里翻单头审核位 + 整单出库(已出数量=申请数量)。台账按 已出数量 扣库存,
    // 与分次出库共用同一口径,两步必须原子(不走 IPostingEngine)。并发靠单头 UPDLOCK/HOLDLOCK + 同事务回写。
    public async Task<bool> ApproveAsync(string 单号, string user)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [领料单] WITH (UPDLOCK, HOLDLOCK) WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null || 审核 == "1") return false;
        await c.ExecuteAsync(
            "UPDATE [领料单] SET [审核]='1',[审核人]=@user,[审核日期]=@now WHERE [单号]=@单号",
            new { 单号, user, now = DateTime.Now }, tx);
        await c.ExecuteAsync(
            "UPDATE [领料明细单] SET [已出数量]=ISNULL([数量],0) WHERE [单号]=@单号", new { 单号 }, tx);
        if (audit is not null) await audit.WriteAsync(DocType, "审核", user, $"单号={单号}", c, tx);
        tx.Commit();
        return true;
    }

    // 反审核:同一事务翻回单头审核位 + 撤销全部出库(已出数量清零,库存随之回滚)。
    public async Task<bool> UnapproveAsync(string 单号, string user)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [领料单] WITH (UPDLOCK, HOLDLOCK) WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null || 审核 != "1") return false;
        await c.ExecuteAsync(
            "UPDATE [领料单] SET [审核]='0',[审核人]=NULL,[审核日期]=NULL WHERE [单号]=@单号", new { 单号 }, tx);
        await c.ExecuteAsync(
            "UPDATE [领料明细单] SET [已出数量]=0 WHERE [单号]=@单号", new { 单号 }, tx);
        if (audit is not null) await audit.WriteAsync(DocType, "反审核", user, $"单号={单号}", c, tx);
        tx.Commit();
        return true;
    }

    // 审核情况过滤片段："已审核"→已审核；"未审核"→非已审核；其它/空→全部。
    private static string ApprovalFilter(string? 审核情况) => 审核情况 switch
    {
        "已审核" => " AND ISNULL(o.[审核],'0') = '1'",
        "未审核" => " AND ISNULL(o.[审核],'0') <> '1'",
        _ => "",
    };

    // 领料单查询·明细：每行一条领料明细(只读·无价格)。过滤 日期区间/关键词/物料类别/审核情况。
    public async Task<IReadOnlyList<MaterialIssueQueryDetailRow>> IssueQueryDetailAsync(
        DateTime? 起, DateTime? 止, string? keyword, string? 物料类别, string? 审核情况)
    {
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var cat = string.IsNullOrWhiteSpace(物料类别) ? null : 物料类别.Trim();
        var 止Excl = 止?.Date.AddDays(1);
        using var c = factory.Create();
        var rows = await c.QueryAsync<MaterialIssueQueryDetailRow>($@"
SELECT d.[类型], d.[日期], d.[单号], d.[生产单号], d.[款号], d.[领料部门], d.[领料人],
       d.[物料编号], d.[物料名称], d.[物料类别], d.[规格], d.[颜色], d.[单位],
       d.[数量], d.[备注], o.[审核]
FROM [领料明细单] d
JOIN [领料单] o ON o.[单号] = d.[单号]
WHERE (@起 IS NULL OR d.[日期] >= @起)
  AND (@止 IS NULL OR d.[日期] < @止)
  AND (@kw IS NULL OR d.[单号] LIKE @kw OR d.[生产单号] LIKE @kw OR d.[款号] LIKE @kw
       OR d.[领料部门] LIKE @kw OR d.[领料人] LIKE @kw
       OR d.[物料编号] LIKE @kw OR d.[物料名称] LIKE @kw OR d.[规格] LIKE @kw)
  AND (@cat IS NULL OR d.[物料类别] = @cat){ApprovalFilter(审核情况)}
ORDER BY d.[日期] DESC, d.[单号], d.[ID];",
            new { 起, 止 = 止Excl, kw, cat });
        return rows.AsList();
    }

    // 领料单查询·汇总：按 物料编号+规格+颜色 合并，SUM(数量)=领用数量。同过滤集。
    public async Task<IReadOnlyList<MaterialIssueSummaryRow>> IssueQuerySummaryAsync(
        DateTime? 起, DateTime? 止, string? keyword, string? 物料类别, string? 审核情况)
    {
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var cat = string.IsNullOrWhiteSpace(物料类别) ? null : 物料类别.Trim();
        var 止Excl = 止?.Date.AddDays(1);
        using var c = factory.Create();
        var rows = await c.QueryAsync<MaterialIssueSummaryRow>($@"
SELECT d.[物料编号], MAX(d.[物料名称]) AS 物料名称, MAX(d.[物料类别]) AS 物料类别,
       d.[规格], d.[颜色], MAX(d.[单位]) AS 单位, SUM(d.[数量]) AS 领用数量
FROM [领料明细单] d
JOIN [领料单] o ON o.[单号] = d.[单号]
WHERE (@起 IS NULL OR d.[日期] >= @起)
  AND (@止 IS NULL OR d.[日期] < @止)
  AND (@kw IS NULL OR d.[单号] LIKE @kw OR d.[生产单号] LIKE @kw OR d.[款号] LIKE @kw
       OR d.[领料部门] LIKE @kw OR d.[领料人] LIKE @kw
       OR d.[物料编号] LIKE @kw OR d.[物料名称] LIKE @kw OR d.[规格] LIKE @kw)
  AND (@cat IS NULL OR d.[物料类别] = @cat){ApprovalFilter(审核情况)}
GROUP BY d.[物料编号], d.[规格], d.[颜色]
ORDER BY d.[物料编号], d.[规格], d.[颜色];",
            new { 起, 止 = 止Excl, kw, cat });
        return rows.AsList();
    }

    public async Task<IReadOnlyList<AuxiliaryIssueDetailRow>> AuxiliaryIssueDetailAsync(
        string? 到货情况,
        DateTime? 起,
        DateTime? 止,
        string? keyword,
        string? 日期类型 = null,
        string? 领料备注 = null)
    {
        var dateColumn = 日期类型 switch
        {
            "开单日期" => "q.[开单日期]",
            "领料日期" => "q.[领料日期]",
            _ => null,
        };
        var dateWhere = dateColumn is not null && 起.HasValue && 止.HasValue
            ? $" AND {dateColumn} >= @start AND {dateColumn} < @end"
            : "";
        var status = Exact(到货情况) ?? "未到";

        using var c = factory.Create();
        var rows = await c.QueryAsync<AuxiliaryIssueDetailRow>($@"
WITH 需求 AS (
    SELECT
        h.[日期] AS 开单日期,
        mo.[生产单号] AS 装配生产单号,
        h.[款号] AS 产品货号,
        d.[物料编号] AS 辅料编号,
        MAX(d.[物料名称]) AS 辅料名称,
        MAX(d.[规格]) AS 规格,
        MAX(d.[单位]) AS 单位,
        SUM(COALESCE(mo.[接单数量], h.[使用数量], 0) * ISNULL(d.[使用数量], 0)) AS 需求数量,
        N'生产领料' AS 领料备注
    FROM [款号物料总表] h
    JOIN [款号物料明细表] d ON d.[款号] = h.[款号]
    OUTER APPLY (
        SELECT TOP 1 [生产单号], [接单数量]
        FROM [生产通知单MO单] mo
        WHERE mo.[产品货号] = h.[款号]
        ORDER BY mo.[接单日期] DESC, mo.[ID] DESC
    ) mo
    WHERE d.[物料类别] = N'辅料资料'
    GROUP BY h.[日期], mo.[生产单号], h.[款号], d.[物料编号]
),
领料明细 AS (
    SELECT
        NULLIF(d.[生产单号], N'') AS 装配生产单号,
        NULLIF(d.[款号], N'') AS 产品货号,
        d.[物料编号] AS 辅料编号,
        COALESCE(
            NULLIF(CONVERT(nvarchar(4000), d.[备注]), N''),
            NULLIF(CONVERT(nvarchar(4000), o.[备注]), N''),
            N'生产领料'
        ) AS 领料备注,
        COALESCE(d.[日期], o.[日期]) AS 领料日期,
        d.[单号] AS 领料单号,
        ISNULL(d.[数量], 0) AS 领料数量
    FROM [领料明细单] d
    JOIN [领料单] o ON o.[单号] = d.[单号]
    WHERE ISNULL(o.[审核], N'0') = N'1'
      AND d.[物料类别] = N'辅料资料'
      AND COALESCE(NULLIF(d.[仓库], N''), o.[仓库]) = N'辅料仓库'
),
汇总 AS (
    SELECT
        q.[开单日期],
        q.[装配生产单号],
        COALESCE(NULLIF(l.[领料备注], N''), q.[领料备注]) AS 领料备注,
        q.[辅料编号],
        q.[辅料名称],
        q.[规格],
        q.[单位],
        q.[需求数量],
        l.[领料日期],
        l.[领料单号],
        l.[领料数量],
        ISNULL(t.[合计已领数量], 0) AS 合计已领数量,
        q.[需求数量] - ISNULL(t.[合计已领数量], 0) AS 未领数量
    FROM 需求 q
    OUTER APPLY (
        SELECT SUM(l2.[领料数量]) AS 合计已领数量
        FROM 领料明细 l2
        WHERE l2.[辅料编号] = q.[辅料编号]
          AND (
              (l2.[装配生产单号] IS NOT NULL AND l2.[装配生产单号] = q.[装配生产单号])
              OR (l2.[产品货号] IS NOT NULL AND l2.[产品货号] = q.[产品货号])
          )
    ) t
    LEFT JOIN 领料明细 l ON l.[辅料编号] = q.[辅料编号]
          AND (
              (l.[装配生产单号] IS NOT NULL AND l.[装配生产单号] = q.[装配生产单号])
              OR (l.[产品货号] IS NOT NULL AND l.[产品货号] = q.[产品货号])
          )
)
SELECT
    q.[开单日期],
    q.[装配生产单号],
    q.[领料备注],
    q.[辅料编号],
    q.[辅料名称],
    q.[规格],
    q.[单位],
    q.[需求数量],
    q.[领料日期],
    q.[领料单号],
    q.[领料数量],
    q.[合计已领数量],
    q.[未领数量]
FROM 汇总 q
WHERE (@kw IS NULL
       OR q.[装配生产单号] LIKE @kw
       OR q.[领料备注] LIKE @kw
       OR q.[辅料编号] LIKE @kw
       OR q.[辅料名称] LIKE @kw
       OR q.[规格] LIKE @kw
       OR q.[领料单号] LIKE @kw)
  AND (@remark IS NULL OR q.[领料备注] = @remark)
  {dateWhere}
  AND (@onlyOwed = 0 OR q.[未领数量] > 0)
  AND (@onlyDone = 0 OR q.[未领数量] <= 0)
ORDER BY q.[开单日期] DESC, q.[装配生产单号], q.[辅料编号], q.[领料日期], q.[领料单号];", new
        {
            start = 起?.Date,
            end = 止?.Date.AddDays(1),
            kw = Like(keyword),
            remark = Exact(领料备注),
            onlyOwed = status == "未到" ? 1 : 0,
            onlyDone = status == "已到" ? 1 : 0,
        });
        return rows.AsList();
    }

    private static string AuxiliaryIssueDateWhere(DateTime? 起, DateTime? 止, string? 日期类型)
    {
        if (日期类型 == "不选择日期" || (!起.HasValue && !止.HasValue)) return "";
        return " AND (@start IS NULL OR q.[开单日期] >= @start) AND (@end IS NULL OR q.[开单日期] < @end)";
    }

    public async Task<IReadOnlyList<AuxiliaryStockIssueQuerySummaryRow>> AuxiliaryStockIssueQuerySummaryAsync(
        DateTime? 起,
        DateTime? 止,
        string? keyword,
        string? 物料类别,
        string? 日期类型,
        string? 领料备注)
    {
        var cat = Exact(物料类别);
        var dateWhere = AuxiliaryIssueDateWhere(起, 止, 日期类型);
        using var c = factory.Create();
        var rows = await c.QueryAsync<AuxiliaryStockIssueQuerySummaryRow>($@"
WITH q AS (
    SELECT
        COALESCE(
            NULLIF(CONVERT(nvarchar(4000), d.[备注]), N''),
            NULLIF(CONVERT(nvarchar(4000), o.[备注]), N''),
            N'生产领料'
        ) AS 领料备注,
        COALESCE(o.[日期], d.[日期]) AS 开单日期,
        COALESCE(NULLIF(d.[生产单号], N''), NULLIF(o.[生产单号], N'')) AS 装配生产单号,
        d.[物料编号] AS 辅料编号,
        d.[物料名称] AS 辅料名称,
        d.[规格],
        d.[单位],
        ISNULL(d.[数量], 0) AS 数量,
        d.[备注]
    FROM [领料明细单] d
    JOIN [领料单] o ON o.[单号] = d.[单号]
    WHERE COALESCE(NULLIF(d.[仓库], N''), o.[仓库]) = N'辅料仓库'
      AND d.[物料类别] = N'辅料资料'
      AND (@cat IS NULL OR d.[物料类别] = @cat)
)
SELECT
    q.[领料备注],
    q.[开单日期],
    q.[装配生产单号],
    q.[辅料编号],
    MAX(q.[辅料名称]) AS 辅料名称,
    q.[规格],
    MAX(q.[单位]) AS 单位,
    SUM(q.[数量]) AS 领料数量,
    MAX(q.[备注]) AS 备注
FROM q
WHERE (@kw IS NULL
       OR q.[领料备注] LIKE @kw
       OR q.[装配生产单号] LIKE @kw
       OR q.[辅料编号] LIKE @kw
       OR q.[辅料名称] LIKE @kw
       OR q.[规格] LIKE @kw
       OR q.[备注] LIKE @kw)
  AND (@remark IS NULL OR q.[领料备注] = @remark)
  {dateWhere}
GROUP BY q.[领料备注], q.[开单日期], q.[装配生产单号], q.[辅料编号], q.[规格]
ORDER BY q.[开单日期] DESC, q.[装配生产单号], q.[辅料编号], q.[规格];", new
        {
            start = 起?.Date,
            end = 止?.Date.AddDays(1),
            kw = Like(keyword),
            cat,
            remark = Exact(领料备注),
        });
        return rows.AsList();
    }

    public async Task<IReadOnlyList<AuxiliaryStockIssueQueryDetailRow>> AuxiliaryStockIssueQueryDetailAsync(
        DateTime? 起,
        DateTime? 止,
        string? keyword,
        string? 物料类别,
        string? 日期类型,
        string? 领料备注,
        string? 制单人,
        string? 审核情况)
    {
        var cat = Exact(物料类别);
        var dateWhere = AuxiliaryIssueDateWhere(起, 止, 日期类型);
        using var c = factory.Create();
        var rows = await c.QueryAsync<AuxiliaryStockIssueQueryDetailRow>($@"
WITH q AS (
    SELECT
        COALESCE(
            NULLIF(CONVERT(nvarchar(4000), d.[备注]), N''),
            NULLIF(CONVERT(nvarchar(4000), o.[备注]), N''),
            N'生产领料'
        ) AS 领料备注,
        COALESCE(o.[日期], d.[日期]) AS 开单日期,
        COALESCE(NULLIF(d.[生产单号], N''), NULLIF(o.[生产单号], N'')) AS 装配生产单号,
        d.[日期],
        CAST(NULL AS datetime) AS 审核日期,
        d.[单号],
        COALESCE(NULLIF(d.[领料部门], N''), NULLIF(o.[领料部门], N'')) AS 生产车间,
        COALESCE(NULLIF(d.[领料人], N''), NULLIF(o.[领料人], N'')) AS 领料人,
        d.[物料编号] AS 辅料编号,
        d.[物料名称] AS 辅料名称,
        d.[规格],
        d.[单位],
        ISNULL(d.[数量], 0) AS 数量,
        d.[备注],
        o.[操作员] AS 制单人,
        ISNULL(o.[审核], N'0') AS 审核
    FROM [领料明细单] d
    JOIN [领料单] o ON o.[单号] = d.[单号]
    WHERE COALESCE(NULLIF(d.[仓库], N''), o.[仓库]) = N'辅料仓库'
      AND d.[物料类别] = N'辅料资料'
      AND (@cat IS NULL OR d.[物料类别] = @cat)
)
SELECT
    q.[领料备注],
    q.[开单日期],
    q.[装配生产单号],
    q.[日期],
    q.[审核日期],
    q.[单号],
    q.[生产车间],
    q.[领料人],
    q.[辅料编号],
    q.[辅料名称],
    q.[规格],
    q.[单位],
    q.[数量],
    q.[备注],
    q.[制单人],
    q.[审核]
FROM q
WHERE (@kw IS NULL
       OR q.[领料备注] LIKE @kw
       OR q.[装配生产单号] LIKE @kw
       OR q.[单号] LIKE @kw
       OR q.[生产车间] LIKE @kw
       OR q.[领料人] LIKE @kw
       OR q.[辅料编号] LIKE @kw
       OR q.[辅料名称] LIKE @kw
       OR q.[规格] LIKE @kw
       OR q.[备注] LIKE @kw)
  AND (@remark IS NULL OR q.[领料备注] = @remark)
  AND (@maker IS NULL OR q.[制单人] LIKE @maker)
  AND (@audit IS NULL
       OR (@audit = N'已审核' AND q.[审核] = N'1')
       OR (@audit = N'未审核' AND q.[审核] <> N'1'))
  {dateWhere}
ORDER BY q.[开单日期] DESC, q.[装配生产单号], q.[单号], q.[辅料编号], q.[规格];", new
        {
            start = 起?.Date,
            end = 止?.Date.AddDays(1),
            kw = Like(keyword),
            cat,
            remark = Exact(领料备注),
            maker = Like(制单人),
            audit = Exact(审核情况),
        });
        return rows.AsList();
    }
}
