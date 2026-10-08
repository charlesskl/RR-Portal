namespace ErpApi.Engines.DocumentNumber;
public interface IDocumentNumberGenerator
{
    // 在给定事务/连接内原子分配单号；行锁保证并发不撞号
    Task<string> NextAsync(string docType, string prefix, DateTime bizDate,
        Microsoft.Data.SqlClient.SqlConnection conn, Microsoft.Data.SqlClient.SqlTransaction tx);
}
