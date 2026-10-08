using Microsoft.Data.SqlClient;

if (args.Length < 2)
{
    Console.Error.WriteLine("用法: DbDeploy <目标连接串> [<lenient:>脚本.sql ...]");
    Console.Error.WriteLine("  默认严格模式(整文件一批，出错即止)；前缀 lenient: 则逐语句执行、失败跳过并记录。");
    return 1;
}
var targetCs = args[0];
var scriptSpecs = args[1..];

var dbName = new SqlConnectionStringBuilder(targetCs).InitialCatalog;
if (string.IsNullOrWhiteSpace(dbName))
{
    Console.Error.WriteLine("连接串缺少 Database/Initial Catalog");
    return 1;
}

// 1) 连 master，库不存在则建
var masterCs = new SqlConnectionStringBuilder(targetCs) { InitialCatalog = "master" }.ConnectionString;
using (var master = new SqlConnection(masterCs))
{
    master.Open();
    using var cmd = new SqlCommand(
        "DECLARE @sql nvarchar(300) = N'CREATE DATABASE ' + QUOTENAME(@n) + N' COLLATE Chinese_PRC_CI_AS'; IF DB_ID(@n) IS NULL EXEC(@sql);", master);
    cmd.Parameters.AddWithValue("@n", dbName);
    cmd.ExecuteNonQuery();
    Console.WriteLine($"数据库 [{dbName}] 就绪");
}

// 2) 连目标库执行各脚本
int leninentSkipped = 0;
using (var conn = new SqlConnection(targetCs))
{
    conn.Open();
    foreach (var spec in scriptSpecs)
    {
        var lenient = spec.StartsWith("lenient:", StringComparison.OrdinalIgnoreCase);
        var path = lenient ? spec["lenient:".Length..] : spec;
        var text = File.ReadAllText(path);
        Console.WriteLine($"执行 {Path.GetFileName(path)} ({(lenient ? "lenient" : "strict")}) ...");

        if (lenient)
        {
            // 逐语句执行：每条独立 try/catch，失败跳过并记录(用于"推断"外键，主数据未必匹配)
            int ok = 0, fail = 0;
            foreach (var stmt in text.Split(';'))
            {
                if (string.IsNullOrWhiteSpace(stmt)) continue;
                try
                {
                    using var cmd = new SqlCommand(stmt, conn) { CommandTimeout = 300 };
                    cmd.ExecuteNonQuery();
                    ok++;
                }
                catch (SqlException ex)
                {
                    fail++;
                    Console.WriteLine($"  跳过: {ex.Message.Replace("\r", " ").Replace("\n", " ")}");
                }
            }
            leninentSkipped += fail;
            Console.WriteLine($"  {Path.GetFileName(path)}: 成功 {ok}, 跳过 {fail}");
        }
        else
        {
            foreach (var batch in SplitBatches(text))
            {
                if (string.IsNullOrWhiteSpace(batch)) continue;
                using var cmd = new SqlCommand(batch, conn) { CommandTimeout = 300 };
                cmd.ExecuteNonQuery();
            }
        }
    }

    using var count = new SqlCommand("SELECT COUNT(*) FROM sys.tables", conn);
    Console.WriteLine($"表数: {count.ExecuteScalar()}");
}
Console.WriteLine($"完成 (宽松脚本累计跳过 {leninentSkipped} 条)");
return 0;

static IEnumerable<string> SplitBatches(string sql)
{
    // 单独成行的 GO 作为批分隔符(忽略大小写)；无 GO 则整文件一批
    var sb = new System.Text.StringBuilder();
    foreach (var line in sql.Replace("\r\n", "\n").Split('\n'))
    {
        if (line.Trim().Equals("GO", StringComparison.OrdinalIgnoreCase))
        {
            yield return sb.ToString();
            sb.Clear();
        }
        else sb.AppendLine(line);
    }
    yield return sb.ToString();
}
