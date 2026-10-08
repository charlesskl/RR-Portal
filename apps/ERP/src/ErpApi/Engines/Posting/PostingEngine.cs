using Dapper;
using ErpApi.Engines.Authorization;
using ErpApi.Infrastructure.Db;
namespace ErpApi.Engines.Posting;

public sealed class PostingEngine(ISqlConnectionFactory factory, IAuditLogger audit) : IPostingEngine
{
    public Task<bool> ApproveAsync(string table, string docNo, string user)
        => SetAuditAsync(table, docNo, user, from: "0", to: "1", behavior: "审核");

    public Task<bool> UnapproveAsync(string table, string docNo, string user)
        => SetAuditAsync(table, docNo, user, from: "1", to: "0", behavior: "反审核");

    private async Task<bool> SetAuditAsync(string table, string docNo, string user,
        string from, string to, string behavior)
    {
        if (!PostableDocuments.IsAllowed(table))
            throw new InvalidOperationException($"表 [{table}] 不在可过账白名单内。");
        var docNoCol = PostableDocuments.DocNoColumn(table);

        using var c = factory.Create();
        await c.OpenAsync();
        using var tx = c.BeginTransaction();

        // 表名/列名来自白名单，安全可拼接；单号/状态参数化。仅当当前状态=from 才翻转（幂等、防重复）
        var sql = $@"
UPDATE [{table}]
   SET [审核]=@to,
       [审核人]=CASE WHEN @to='1' THEN @user ELSE NULL END,
       [审核日期]=CASE WHEN @to='1' THEN SYSDATETIME() ELSE NULL END
 WHERE [{docNoCol}]=@docNo AND ISNULL([审核],'0')=@from;";
        var affected = await c.ExecuteAsync(sql, new { to, from, user, docNo }, tx);
        if (affected == 0) { tx.Rollback(); return false; }

        await audit.WriteAsync(table, behavior, user, $"单号={docNo}", c, tx);
        tx.Commit();
        return true;
    }
}
