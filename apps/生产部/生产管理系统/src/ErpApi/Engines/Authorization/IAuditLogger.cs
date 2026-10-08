using Microsoft.Data.SqlClient;
namespace ErpApi.Engines.Authorization;
public interface IAuditLogger
{
    Task WriteAsync(string tableName, string action, string user, string record,
        SqlConnection conn, SqlTransaction? tx = null);
}
