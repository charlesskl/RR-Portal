using Dapper;
using ErpApi.Engines.DocumentNumber;
using ErpApi.Features.MasterData;
using ErpApi.Features.Messages;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
namespace ErpApi.Features.Plastics.PlasticIssue;

// 塑胶领料单(库存−)。两层:塑胶领料单 + 塑胶领料明细单。审核后由 PlasticInventoryService 实时聚合(−)。
// 三级流转产生消息:开单→主管(职称='主管')，主管审→经理，经理审→收件人(空则全体仓管)；
// messages 可空(DI 注入;测试不传时不发消息)。对齐 MaterialIssueService 领料单 LL 的实现。
public sealed class PlasticIssueService(ISqlConnectionFactory factory, IDocumentNumberGenerator docNo,
    MessageService? messages = null)
{
    public const string DocType = "塑胶领料单";
    public const string Prefix = "SLL";

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

    public async Task<string> CreateAsync(PlasticIssueCreateDto dto, string user)
    {
        if (dto.明细.Count == 0) throw new ArgumentException("塑胶领料单至少要有一行物料明细");
        if (string.IsNullOrWhiteSpace(dto.仓库)) throw new ArgumentException("塑胶领料单必须指定仓库");
        var 数量合计 = dto.明细.Sum(l => l.数量);
        var 金额合计 = dto.明细.Sum(l => l.数量 * (l.单价 ?? 0));
        var now = DateTime.Now;
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 单号 = await docNo.NextAsync(DocType, Prefix, now, c, tx);
        await c.ExecuteAsync(@"
INSERT INTO [塑胶领料单]([单号],[日期],[领料部门],[领料人],[仓库],[数量],[金额],[操作员],[审核],[备注],[胶箱数],[纸箱数],[钙塑箱数],[卡板数],[收件人],[电脑单号],[领料备注])
VALUES(@单号,@日期,@领料部门,@领料人,@仓库,@数量,@金额,@操作员,'0',@备注,@胶箱数,@纸箱数,@钙塑箱数,@卡板数,@收件人,@电脑单号,@领料备注)",
            new { 单号, 日期 = now, dto.领料部门, dto.领料人, dto.仓库, 数量 = 数量合计, 金额 = 金额合计, 操作员 = user, dto.备注,
                  dto.胶箱数, dto.纸箱数, dto.钙塑箱数, dto.卡板数, dto.收件人, dto.电脑单号, dto.领料备注 }, tx);
        foreach (var l in dto.明细)
            await c.ExecuteAsync(@"
INSERT INTO [塑胶领料明细单]([单号],[日期],[仓库],[装配采购],[生产单号],[款号],[物料编号],[模具编号],[物料名称],[规格],[颜色],[色粉号],[用料名称],[仓位号],[单位],[数量],[单价],[金额],[备注])
VALUES(@单号,@日期,@仓库,@装配采购,@生产单号,@款号,@物料编号,@模具编号,@物料名称,@规格,@颜色,@色粉号,@用料名称,@仓位号,@单位,@数量,@单价,@金额,@备注)",
                new { 单号, 日期 = now, dto.仓库, l.装配采购, l.生产单号, l.款号, l.物料编号, l.模具编号, l.物料名称, l.规格, l.颜色, l.色粉号, l.用料名称, l.仓位号, l.单位,
                      l.数量, 单价 = l.单价 ?? 0, 金额 = l.数量 * (l.单价 ?? 0), l.备注 }, tx);
        tx.Commit();
        // 开单 → 消息给该部门主管(职称='主管')
        await NotifyAsync(await RecipientsAsync(dto.领料部门, "主管"), 单号,
            "新的塑胶领料单待主管审核", $"塑胶领料单 {单号}（{dto.领料部门}，共 {数量合计} 件）已提交，请审核。");
        return 单号;
    }

    public async Task<PagedResult<PlasticIssueHeaderDto>> ListAsync(int page, int size, string? keyword)
    {
        if (page < 1) page = 1;
        if (size < 1) size = 20;
        if (size > 1000) size = 1000;
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT COUNT(*) FROM [塑胶领料单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [领料人] LIKE @kw OR [备注] LIKE @kw;
SELECT [ID],[单号],[日期],[领料部门],[领料人],[仓库],[数量],[金额],[操作员],[审核],[审核人],[备注],[主管审核],[主管审核人],[经理审核],[经理审核人]
FROM [塑胶领料单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [领料人] LIKE @kw OR [备注] LIKE @kw
ORDER BY [ID] DESC OFFSET (@page-1)*@size ROWS FETCH NEXT @size ROWS ONLY;", new { kw, page, size });
        var total = await multi.ReadFirstAsync<int>();
        var items = (await multi.ReadAsync<PlasticIssueHeaderDto>()).AsList();
        return new PagedResult<PlasticIssueHeaderDto>(items, total);
    }

    public async Task<PlasticIssueDetailDto?> GetAsync(string 单号)
    {
        using var c = factory.Create();
        using var multi = await c.QueryMultipleAsync(@"
SELECT [ID],[单号],[日期],[领料部门],[领料人],[仓库],[数量],[金额],[操作员],[审核],[审核人],[备注],[胶箱数],[纸箱数],[钙塑箱数],[卡板数],[收件人],[电脑单号],[领料备注],[主管审核],[主管审核人],[经理审核],[经理审核人]
FROM [塑胶领料单] WHERE [单号]=@单号;
SELECT [ID],[装配采购],[生产单号],[款号],[物料编号],[模具编号],[物料名称],[规格],[颜色],[色粉号],[用料名称],[仓位号],[单位],[数量],[单价],[金额],[备注]
FROM [塑胶领料明细单] WHERE [单号]=@单号 ORDER BY [ID];", new { 单号 });
        var header = await multi.ReadFirstOrDefaultAsync<PlasticIssueHeaderDto>();
        if (header is null) return null;
        var lines = (await multi.ReadAsync<PlasticIssueLineDto>()).AsList();
        return new PlasticIssueDetailDto { 单头 = header, 明细 = lines };
    }

    private static string ApprovalFilter(string? 审核情况) => 审核情况 switch
    {
        "已审核" => " AND ISNULL(h.[审核],'0')='1'",
        "未审核" => " AND ISNULL(h.[审核],'0')<>'1'",
        _ => "",
    };

    public async Task<IReadOnlyList<PlasticIssueQueryDetailRow>> IssueQueryDetailAsync(
        DateTime 起, DateTime 止, string? keyword, string? 审核情况, string? 物料类别)
    {
        var qi = 起.Date; var qe = 止.Date.AddDays(1);
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var cat = string.IsNullOrWhiteSpace(物料类别) ? null : 物料类别.Trim();
        using var c = factory.Create();
        var rows = await c.QueryAsync<PlasticIssueQueryDetailRow>($@"
SELECT h.[日期], d.[单号], d.[生产单号], d.[款号], h.[领料部门], h.[领料人], d.[装配采购],
       d.[物料编号], d.[物料名称], d.[颜色], cm.[塑胶货号] AS 塑胶货号, cm.[共用原料编号] AS 共用物料, cm.[塑胶货号] AS 共用货号,
       d.[单位], d.[数量], d.[单价], d.[金额], d.[备注], h.[审核]
FROM [塑胶领料明细单] d
JOIN [塑胶领料单] h ON h.[单号] = d.[单号]
LEFT JOIN (SELECT [物料编号], MAX([塑胶货号]) AS 塑胶货号, MAX([共用原料编号]) AS 共用原料编号
           FROM [塑胶共用物料表] GROUP BY [物料编号]) cm ON cm.[物料编号] = d.[物料编号]
LEFT JOIN (SELECT [物料编号], MAX([物料类别]) AS 物料类别 FROM [塑胶物料资料] GROUP BY [物料编号]) m ON m.[物料编号] = d.[物料编号]
WHERE h.[日期] >= @qi AND h.[日期] < @qe
  AND (@kw IS NULL OR d.[物料编号] LIKE @kw OR d.[物料名称] LIKE @kw OR d.[生产单号] LIKE @kw OR d.[款号] LIKE @kw)
  AND (@cat IS NULL OR m.[物料类别] = @cat){ApprovalFilter(审核情况)}
ORDER BY h.[日期] DESC, d.[单号], d.[ID]", new { qi, qe, kw, cat });
        return rows.AsList();
    }

    public async Task<IReadOnlyList<PlasticIssueQuerySummaryRow>> IssueQuerySummaryAsync(
        DateTime 起, DateTime 止, string? keyword, string? 审核情况, string? 物料类别)
    {
        var qi = 起.Date; var qe = 止.Date.AddDays(1);
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        var cat = string.IsNullOrWhiteSpace(物料类别) ? null : 物料类别.Trim();
        using var c = factory.Create();
        var rows = await c.QueryAsync<PlasticIssueQuerySummaryRow>($@"
SELECT d.[生产单号], d.[款号], d.[物料编号], d.[颜色],
       MAX(d.[物料名称]) AS 物料名称, MAX(cm.[塑胶货号]) AS 塑胶货号, MAX(cm.[塑胶货号]) AS 共用货号,
       MAX(cm.[共用原料编号]) AS 共用物料, MAX(m.[物料类别]) AS 物料类别, MAX(d.[单位]) AS 单位,
       SUM(d.[数量]) AS 数量, MAX(d.[单价]) AS 单价, SUM(ISNULL(d.[金额],0)) AS 金额
FROM [塑胶领料明细单] d
JOIN [塑胶领料单] h ON h.[单号] = d.[单号]
LEFT JOIN (SELECT [物料编号], MAX([塑胶货号]) AS 塑胶货号, MAX([共用原料编号]) AS 共用原料编号
           FROM [塑胶共用物料表] GROUP BY [物料编号]) cm ON cm.[物料编号] = d.[物料编号]
LEFT JOIN (SELECT [物料编号], MAX([物料类别]) AS 物料类别 FROM [塑胶物料资料] GROUP BY [物料编号]) m ON m.[物料编号] = d.[物料编号]
WHERE h.[日期] >= @qi AND h.[日期] < @qe
  AND (@kw IS NULL OR d.[物料编号] LIKE @kw OR d.[物料名称] LIKE @kw OR d.[生产单号] LIKE @kw OR d.[款号] LIKE @kw)
  AND (@cat IS NULL OR m.[物料类别] = @cat){ApprovalFilter(审核情况)}
GROUP BY d.[生产单号], d.[款号], d.[物料编号], d.[颜色]
ORDER BY d.[生产单号], d.[物料编号]", new { qi, qe, kw, cat });
        return rows.AsList();
    }

    // 三级流转：领料部门开单(未审核) → 主管审核 → 经理审核 → 塑胶仓出库(审核='1')。
    // 出库必须 经理审核='1'(即经理审核完才"发到"塑胶仓);单据上显示 主管/经理 审核人。
    public async Task SupervisorApproveAsync(string 单号, string user)
    {
        using var c = factory.Create();
        var 部门 = await c.ExecuteScalarAsync<string?>("SELECT [领料部门] FROM [塑胶领料单] WHERE [单号]=@单号", new { 单号 });
        if (部门 is null) throw new KeyNotFoundException($"塑胶领料单 {单号} 不存在。");
        var (编号, 部门名) = await ResponsibleDeptAsync(c, 部门);
        if (!await HasRoleAsync(user, 编号, "主管"))
            throw new InvalidOperationException($"[{user}] 不是 {部门名} 的主管，不能主管审核。");
        var n = await c.ExecuteAsync(@"
UPDATE [塑胶领料单] SET [主管审核]='1',[主管审核人]=@user,[主管审核日期]=SYSDATETIME()
WHERE [单号]=@单号 AND ISNULL([主管审核],'0')<>'1' AND ISNULL([审核],'0')<>'1'", new { user, 单号 });
        if (n == 0) throw new InvalidOperationException("主管审核失败：单不存在、已主管审核或已完成出库。");
        // 主管审完 → 消息给该部门经理(职称='经理')
        await NotifyAsync(await RecipientsAsync(部门, "经理"), 单号,
            "塑胶领料单待经理审核", $"塑胶领料单 {单号} 已经主管 {user} 审核，请经理审核。");
    }

    public async Task ManagerApproveAsync(string 单号, string user)
    {
        using var c = factory.Create();
        var 主管 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([主管审核],'0') FROM [塑胶领料单] WHERE [单号]=@单号", new { 单号 });
        if (主管 is null) throw new KeyNotFoundException($"塑胶领料单 {单号} 不存在。");
        if (主管 != "1") throw new InvalidOperationException("请先经主管审核，再由经理审核。");
        // 经理不限部门:人事档案 职称='经理' 即可
        if (!await HasRoleAsync(user, null, "经理"))
            throw new InvalidOperationException($"[{user}] 不是经理，不能经理审核。");
        var n = await c.ExecuteAsync(@"
UPDATE [塑胶领料单] SET [经理审核]='1',[经理审核人]=@user,[经理审核日期]=SYSDATETIME()
WHERE [单号]=@单号 AND ISNULL([经理审核],'0')<>'1' AND ISNULL([审核],'0')<>'1'", new { user, 单号 });
        if (n == 0) throw new InvalidOperationException("经理审核失败：已经理审核或已完成出库。");
        // 经理审完 → 消息发给单据「收件人」对应账号(姓名匹配,重名带(编号)后缀用 LIKE 兼容);
        // 收件人为空则发全体 职称=仓管 的人。收到后塑胶仓安排出库。
        var doc = await c.QuerySingleAsync<(string? 部门, string? 收件人)>(
            "SELECT [领料部门] AS 部门, [收件人] FROM [塑胶领料单] WHERE [单号]=@单号", new { 单号 });
        IReadOnlyList<string> 收件人账号 = string.IsNullOrWhiteSpace(doc.收件人)
            ? (await c.QueryAsync<string>(@"
SELECT DISTINCT u.[用户] FROM [人事档案] p
JOIN [sysfileuser] u ON u.[用户] = p.[姓名] OR u.[用户] LIKE p.[姓名] + N'(%'
WHERE p.[职称] = N'仓管'")).AsList()
            : (await c.QueryAsync<string>(
                "SELECT [用户] FROM [sysfileuser] WHERE [用户]=@name OR [用户] LIKE @name + N'(%'",
                new { name = doc.收件人 })).AsList();
        await NotifyAsync(收件人账号, 单号,
            "塑胶领料单待出库", $"塑胶领料单 {单号}（{doc.部门}）已主管、经理审核，请塑胶仓安排出库。");
    }

    // 出库门：审核(=塑胶仓出库)前必须 经理审核='1'。单不存在也返回 false(posting 会再兜「单不存在」)。
    public async Task<bool> IsManagerApprovedAsync(string 单号)
    {
        using var c = factory.Create();
        var v = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([经理审核],'0') FROM [塑胶领料单] WHERE [单号]=@单号", new { 单号 });
        return v == "1";
    }

    public async Task<bool> DeleteAsync(string 单号)
    {
        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();
        var 审核 = await c.ExecuteScalarAsync<string?>(
            "SELECT ISNULL([审核],'0') FROM [塑胶领料单] WITH (UPDLOCK, HOLDLOCK) WHERE [单号]=@单号", new { 单号 }, tx);
        if (审核 is null) return false;
        if (审核 == "1") throw new InvalidOperationException("已审核的塑胶领料单不能删除，请先反审核。");
        await c.ExecuteAsync("DELETE FROM [塑胶领料明细单] WHERE [单号]=@单号", new { 单号 }, tx);
        await c.ExecuteAsync("DELETE FROM [塑胶领料单] WHERE [单号]=@单号", new { 单号 }, tx);
        tx.Commit();
        return true;
    }
}
