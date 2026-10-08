using Dapper;
using Microsoft.Data.SqlClient;
namespace ErpApi.Engines.DocumentNumber;

public sealed class DocumentNumberGenerator : IDocumentNumberGenerator
{
    public static string Format(string prefix, DateTime bizDate, int seq)
        => $"{prefix}{bizDate:yyyyMMdd}{seq.ToString().PadLeft(3, '0')}";

    public async Task<string> NextAsync(string docType, string prefix, DateTime bizDate,
        SqlConnection conn, SqlTransaction tx)
    {
        var day = bizDate.ToString("yyyyMMdd");
        // UPDLOCK+HOLDLOCK：同一(类型,日期)行串行化，避免并发撞号
        var seq = await conn.ExecuteScalarAsync<int>(@"
SET NOCOUNT ON;
UPDATE [单号流水表] WITH (UPDLOCK, HOLDLOCK)
   SET [当日流水] = [当日流水] + 1
 WHERE [单据类型]=@docType AND [业务日期]=@day;
IF @@ROWCOUNT = 0
   INSERT INTO [单号流水表]([单据类型],[业务日期],[当日流水]) VALUES(@docType,@day,1);
SELECT [当日流水] FROM [单号流水表] WHERE [单据类型]=@docType AND [业务日期]=@day;",
            new { docType, day }, tx);
        return Format(prefix, bizDate, seq);
    }
}
