using System.Data;
using Microsoft.Data.SqlClient;
using Npgsql;

namespace StitchCostPro.Api.Shared;

/// <summary>
/// Dapper 连接工厂。规格第 8 章：标准 CRUD 用 EF Core，
/// 库存/对账/对比主界面等大查询用 Dapper 手写 SQL。
/// </summary>
public interface IDbConnectionFactory
{
    IDbConnection Create();
}

public class DapperConnectionFactory(IConfiguration config) : IDbConnectionFactory
{
    private readonly string _connectionString =
        config.GetConnectionString("Default")
        ?? throw new InvalidOperationException("缺少连接串 ConnectionStrings:Default");
    private readonly string _provider = config["Database:Provider"] ?? "SqlServer";

    public IDbConnection Create() =>
        _provider.Equals("PostgreSQL", StringComparison.OrdinalIgnoreCase)
            ? new NpgsqlConnection(_connectionString)
            : new SqlConnection(_connectionString);
}
