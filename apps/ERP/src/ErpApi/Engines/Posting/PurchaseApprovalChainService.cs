using Dapper;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
namespace ErpApi.Engines.Posting;

// 三级流转(共享):开单 → 主管审核 → 经理审核 → 审核(下发,posting 审核='1')。
// 适用 10 张表:5 张采购订单 + 5 张领料/出库单(领料单/塑胶领料单/白件领料单/半成品领料单/原料出库单)。
// 规则:
//   · 表名走白名单,杜绝拼接注入;
//   · 主管必须是「责任部门」的主管:人事档案 职称='主管' 且 部门编号=责任部门编号;
//     责任部门按表固定(采购/白件/原料出库)或取单上部门列(名称→部门信息.编号,查不到退回 02 装配部);
//   · 经理不限部门:人事档案 职称='经理' 即可;admin(系统管理员)两级都可代办;
//   · 不发消息通知(领料单/塑胶领料单的消息在各自 Service 里发)。
public sealed class PurchaseApprovalChainService(ISqlConnectionFactory factory)
{
    // 责任部门规则:FixedDept=固定部门编号;DeptColumn=单上部门名称列(二选一)
    private sealed record TableRule(string? FixedDept, string? DeptColumn);

    private const string 默认部门 = "02";   // 装配部(单上部门为空/查不到时的退回部门)

    private static readonly IReadOnlyDictionary<string, TableRule> Rules = new Dictionary<string, TableRule>(StringComparer.Ordinal)
    {
        // 领料/出库单
        ["领料单"] = new(null, "领料部门"),
        ["塑胶领料单"] = new(null, "领料部门"),
        ["半成品领料单"] = new(null, "部门"),
        ["白件领料单"] = new("20", null),       // 喷油部
        ["原料出库单"] = new("06", null),       // 啤机部
        // 采购订单
        ["采购订单"] = new("05", null),         // 仓务部(来料仓)
        ["塑胶采购订单"] = new("05", null),     // 仓务部
        ["原料采购订单"] = new("05", null),     // 仓务部
        ["装配加工采购单"] = new("02", null),   // 装配部
        ["塑胶加工采购单"] = new("09", null),   // PMC
    };

    private static KeyValuePair<string, TableRule> Checked(string table) =>
        Rules.TryGetValue(table, out var rule)
            ? new(table, rule)
            : throw new InvalidOperationException($"表 [{table}] 不在三级流转白名单内。");

    // 解析责任部门:(编号, 名称)。单上部门列为空或 部门信息 查不到时退回 02 装配部
    private static async Task<(string 编号, string 名称)> ResponsibleDeptAsync(
        SqlConnection c, string table, TableRule rule, string 单号)
    {
        var code = rule.FixedDept;
        if (code is null)
        {
            var name = await c.ExecuteScalarAsync<string?>(
                $"SELECT [{rule.DeptColumn}] FROM [{table}] WHERE [单号]=@单号", new { 单号 });
            if (!string.IsNullOrWhiteSpace(name))
                code = await c.ExecuteScalarAsync<string?>(
                    "SELECT [编号] FROM [部门信息] WHERE [部门]=@name", new { name = name.Trim() });
            code ??= 默认部门;
        }
        var deptName = await c.ExecuteScalarAsync<string?>(
            "SELECT [部门] FROM [部门信息] WHERE [编号]=@code", new { code }) ?? code;
        return (code, deptName);
    }

    // 校验用户是否为责任部门的主管;admin 可代办。返回 (是否主管, 责任部门名称)
    private async Task<(bool Ok, string 部门)> IsSupervisorAsync(
        SqlConnection c, string table, TableRule rule, string 单号, string user)
    {
        var (code, deptName) = await ResponsibleDeptAsync(c, table, rule, 单号);
        if (user.Equals("admin", StringComparison.OrdinalIgnoreCase)) return (true, deptName);
        var n = await c.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM [人事档案] WHERE [姓名]=@user AND [职称]=N'主管' AND [部门编号]=@code",
            new { user, code });
        return (n > 0, deptName);
    }

    // 校验用户是否具有经理职称(不限部门);admin 可代办
    private async Task<bool> IsManagerAsync(string user)
    {
        if (user.Equals("admin", StringComparison.OrdinalIgnoreCase)) return true;
        using var c = factory.Create();
        var n = await c.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM [人事档案] WHERE [姓名]=@user AND [职称]=N'经理'", new { user });
        return n > 0;
    }

    // 对外经理判定(排期状态变更审核等不走单据链的场景复用同一口径:职称='经理' 或 admin)
    public Task<bool> IsManagerUserAsync(string user) => IsManagerAsync(user);

    public async Task SupervisorApproveAsync(string table, string 单号, string user)
    {
        var (tbl, rule) = Checked(table);
        using var c = factory.Create();
        var (ok, deptName) = await IsSupervisorAsync(c, tbl, rule, 单号, user);
        if (!ok)
            throw new InvalidOperationException($"[{user}] 不是 {deptName} 的主管，不能主管审核。");
        var n = await c.ExecuteAsync($@"
UPDATE [{tbl}] SET [主管审核]='1',[主管审核人]=@user,[主管审核日期]=SYSDATETIME()
WHERE [单号]=@单号 AND ISNULL([主管审核],'0')<>'1' AND ISNULL([审核],'0')<>'1'", new { user, 单号 });
        if (n == 0)
        {
            var exists = await c.ExecuteScalarAsync<int>($"SELECT COUNT(*) FROM [{tbl}] WHERE [单号]=@单号", new { 单号 });
            if (exists == 0) throw new KeyNotFoundException($"{tbl} {单号} 不存在。");
            throw new InvalidOperationException("主管审核失败：已主管审核或已审核。");
        }
    }

    public async Task ManagerApproveAsync(string table, string 单号, string user)
    {
        var (tbl, _) = Checked(table);
        using var c = factory.Create();
        var 主管 = await c.ExecuteScalarAsync<string?>(
            $"SELECT ISNULL([主管审核],'0') FROM [{tbl}] WHERE [单号]=@单号", new { 单号 });
        if (主管 is null) throw new KeyNotFoundException($"{tbl} {单号} 不存在。");
        if (主管 != "1") throw new InvalidOperationException("请先经主管审核，再由经理审核。");
        if (!await IsManagerAsync(user))
            throw new InvalidOperationException($"[{user}] 不是经理，不能经理审核。");
        var n = await c.ExecuteAsync($@"
UPDATE [{tbl}] SET [经理审核]='1',[经理审核人]=@user,[经理审核日期]=SYSDATETIME()
WHERE [单号]=@单号 AND ISNULL([经理审核],'0')<>'1' AND ISNULL([审核],'0')<>'1'", new { user, 单号 });
        if (n == 0) throw new InvalidOperationException("经理审核失败：已经理审核或已审核。");
    }

    // 审核(下发)门：审核前必须 经理审核='1'。单不存在也返回 false(posting 会再兜「单不存在」)。
    public async Task<bool> IsManagerApprovedAsync(string table, string 单号)
    {
        var (tbl, _) = Checked(table);
        using var c = factory.Create();
        var v = await c.ExecuteScalarAsync<string?>(
            $"SELECT ISNULL([经理审核],'0') FROM [{tbl}] WHERE [单号]=@单号", new { 单号 });
        return v == "1";
    }
}
