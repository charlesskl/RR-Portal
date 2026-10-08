using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
namespace ErpApi.Infrastructure.Db;

public sealed class SqlConnectionFactory(IConfiguration config) : ISqlConnectionFactory
{
    public string GetConnectionString()
    {
        var envName = config["Erp:ConnectionStringEnvVar"] ?? "ERP_DB";
        var cs = Environment.GetEnvironmentVariable(envName);
        if (string.IsNullOrWhiteSpace(cs))
            throw new InvalidOperationException($"连接串未配置：请设置环境变量 {envName}（禁止硬编码凭据）。");
        return cs;
    }

    public SqlConnection Create() => new(GetConnectionString());
}
