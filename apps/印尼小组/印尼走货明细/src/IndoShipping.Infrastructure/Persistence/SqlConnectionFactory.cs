using System.Data;
using Npgsql;

namespace IndoShipping.Infrastructure.Persistence;

public interface ISqlConnectionFactory
{
    IDbConnection Create();
}

public class SqlConnectionFactory(string connectionString) : ISqlConnectionFactory
{
    public IDbConnection Create() => new NpgsqlConnection(connectionString);
}
