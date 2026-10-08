using System.Globalization;
using System.Text;
using Microsoft.Data.SqlClient;

// 数据快照导出:把当前库所有用户表(dbo)导出为幂等 SQL 脚本 db/snapshot/full_data_snapshot.sql。
// 幂等策略:禁用全部外键 → 逐表 DELETE → 按批 INSERT(含 IDENTITY_INSERT)→ 恢复外键,可重复执行。
// 用法: ERP_DB='连接串' dotnet run --project tools/DbExport -- <输出目录(默认 <仓库根>/db/snapshot)>
internal static class Program
{
    private const int BatchRows = 200;

    private sealed class Col
    {
        public string Name;
        public string TypeName;
        public bool IsIdentity;

        public Col(string name, string typeName, bool isIdentity)
        {
            Name = name;
            TypeName = typeName;
            IsIdentity = isIdentity;
        }
    }

    private static int Main(string[] args)
    {
        var cs = Environment.GetEnvironmentVariable("ERP_DB");
        if (string.IsNullOrWhiteSpace(cs))
        {
            Console.Error.WriteLine("错误: 未设置环境变量 ERP_DB(数据库连接串)。");
            return 1;
        }

        var outDir = args.Length > 0 && !string.IsNullOrWhiteSpace(args[0])
            ? Path.GetFullPath(args[0])
            : Path.Combine(FindRepoRoot(), "db", "snapshot");
        Directory.CreateDirectory(outDir);
        var outFile = Path.Combine(outDir, "full_data_snapshot.sql");

        using var conn = new SqlConnection(cs);
        conn.Open();

        var tables = new List<string>();
        using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = @"SELECT TABLE_NAME
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_TYPE = 'BASE TABLE' AND TABLE_SCHEMA = 'dbo'
ORDER BY TABLE_NAME";
            using var rd = cmd.ExecuteReader();
            while (rd.Read()) tables.Add(rd.GetString(0));
        }

        using (var w = new StreamWriter(outFile, false, new UTF8Encoding(false)))
        {
            w.WriteLine("-- ============================================================");
            w.WriteLine("-- 数据快照(全量, 幂等, 可重复执行)");
            w.WriteLine("-- 生成时间: " + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"));
            w.WriteLine("-- 用法: sqlcmd -d <目标库> -i 本文件");
            w.WriteLine("-- 注意: 目标库需已有表结构(先执行 db/ 下建表/迁移脚本, 再执行本快照恢复数据)。");
            w.WriteLine("-- ============================================================");
            w.WriteLine("SET NOCOUNT ON;");
            w.WriteLine("EXEC sp_MSforeachtable 'ALTER TABLE ? NOCHECK CONSTRAINT ALL';");
            w.WriteLine("GO");

            long totalRows = 0;
            var exportedTables = 0;
            foreach (var table in tables)
            {
                var full = $"[dbo].[{table}]";
                var cols = GetColumns(conn, table);
                if (cols.Count == 0) continue;
                exportedTables++;

                var hasIdentity = cols.Any(c => c.IsIdentity);
                var colList = string.Join(", ", cols.Select(c => $"[{c.Name}]"));

                w.WriteLine();
                w.WriteLine($"-- 表 {full}");
                w.WriteLine($"DELETE FROM {full};");
                if (hasIdentity) w.WriteLine($"SET IDENTITY_INSERT {full} ON;");

                long rowCount = 0;
                using (var readerCmd = new SqlCommand($"SELECT {colList} FROM {full}", conn))
                using (var rd = readerCmd.ExecuteReader())
                {
                    var batch = new List<string>();
                    while (rd.Read())
                    {
                        var vals = new string[cols.Count];
                        for (var i = 0; i < cols.Count; i++)
                            vals[i] = ToSqlLiteral(rd.GetValue(i));
                        batch.Add("(" + string.Join(", ", vals) + ")");
                        rowCount++;
                        if (batch.Count >= BatchRows)
                        {
                            FlushBatch(w, full, colList, batch);
                            batch.Clear();
                        }
                    }
                    FlushBatch(w, full, colList, batch);
                }

                if (hasIdentity) w.WriteLine($"SET IDENTITY_INSERT {full} OFF;");
                w.WriteLine("GO");

                totalRows += rowCount;
                Console.WriteLine($"{table}: {rowCount} 行");
            }

            w.WriteLine();
            w.WriteLine("EXEC sp_MSforeachtable 'ALTER TABLE ? WITH CHECK CHECK CONSTRAINT ALL';");
            w.WriteLine("GO");
            w.WriteLine("PRINT N'数据快照恢复完成';");

            Console.WriteLine($"完成: {exportedTables} 张表, 总行数 {totalRows}, 输出 {outFile}");
        }

        return 0;
    }

    private static List<Col> GetColumns(SqlConnection conn, string table)
    {
        var cols = new List<Col>();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = @"SELECT c.name, t.name AS type_name, c.is_identity
FROM sys.columns c
JOIN sys.types t ON c.user_type_id = t.user_type_id
WHERE c.object_id = OBJECT_ID(@full) AND c.is_computed = 0
ORDER BY c.column_id";
        cmd.Parameters.AddWithValue("@full", $"[dbo].[{table}]");
        using var rd = cmd.ExecuteReader();
        while (rd.Read())
            cols.Add(new Col(rd.GetString(0), rd.GetString(1), rd.GetBoolean(2)));
        return cols;
    }

    private static void FlushBatch(StreamWriter w, string full, string colList, List<string> batch)
    {
        if (batch.Count == 0) return;
        w.WriteLine($"INSERT INTO {full} ({colList}) VALUES");
        w.Write(string.Join(",\n", batch));
        w.WriteLine(";");
        w.WriteLine("GO");
    }

    private static string FindRepoRoot()
    {
        // 从当前目录向上找含 src/ErpApi 的目录作为仓库根
        var dir = new DirectoryInfo(Directory.GetCurrentDirectory());
        while (dir != null)
        {
            if (Directory.Exists(Path.Combine(dir.FullName, "src", "ErpApi")))
                return dir.FullName;
            dir = dir.Parent;
        }
        throw new InvalidOperationException("未找到仓库根目录(需包含 src/ErpApi)。");
    }

    private static string ToSqlLiteral(object v)
    {
        switch (v)
        {
            case null:
            case DBNull _:
                return "NULL";
            case string s:
                return "N'" + s.Replace("'", "''") + "'";
            case DateTime dt:
                return "'" + dt.ToString("yyyy-MM-dd HH:mm:ss.fff", CultureInfo.InvariantCulture) + "'";
            case bool b:
                return b ? "1" : "0";
            case byte[] bin:
                return "0x" + Convert.ToHexString(bin);
            case Guid g:
                return "'" + g + "'";
            case decimal dec:
                return dec.ToString(CultureInfo.InvariantCulture);
            case float f:
                return f.ToString("R", CultureInfo.InvariantCulture);
            case double d:
                return d.ToString("R", CultureInfo.InvariantCulture);
        }

        try
        {
            if (v is IConvertible c)
                return c.ToString(CultureInfo.InvariantCulture);
        }
        catch
        {
            // 无法转换时走兜底
        }
        return "N'" + (v.ToString() ?? string.Empty).Replace("'", "''") + "'";
    }
}
