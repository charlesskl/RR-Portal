using Dapper;
using Microsoft.Data.SqlClient;
namespace ErpApi.Engines.Authorization;

public sealed class AuditLogger : IAuditLogger
{
    public Task WriteAsync(string tableName, string action, string user, string record,
        SqlConnection conn, SqlTransaction? tx = null)
        => conn.ExecuteAsync(@"
INSERT INTO [c操作记录]([日期时间],[表名],[行为],[操作员],[操作记录])
VALUES(SYSDATETIME(), @tableName, @action, @user, @record)",
            new { tableName, action, user, record }, tx);
}
