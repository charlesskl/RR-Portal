using System.Data;
using System.Data.Common;
using System.Diagnostics.CodeAnalysis;
using System.Text.Json;
using IndoShipping.Api.Controllers;
using IndoShipping.Infrastructure.Persistence;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace IndoShipping.Api.Tests;

public class HealthControllerTests
{
    [Fact]
    public void Controller_exposes_only_one_public_constructor_for_dependency_injection()
    {
        Assert.Single(typeof(HealthController).GetConstructors());
    }

    [Fact]
    public async Task Get_returns_generic_503_when_database_check_fails()
    {
        const string detail = "Server=sql.internal;Database=IndoShipping;User ID=indoshipping_app;Password=super-secret;";
        var controller = new HealthController(new ThrowingConnectionFactory(detail), NullLogger<HealthController>.Instance);

        var result = await controller.Get();

        AssertSanitizedServiceUnavailable(result, detail);
    }

    [Fact]
    public async Task Db_returns_generic_503_when_database_check_fails()
    {
        const string detail = "Server=sql.internal;Database=IndoShipping;User ID=indoshipping_app;Password=super-secret;";
        var controller = new HealthController(new ThrowingConnectionFactory(detail), NullLogger<HealthController>.Instance);

        var result = await controller.Db();

        AssertSanitizedServiceUnavailable(result, detail);
    }

    private static void AssertSanitizedServiceUnavailable(IActionResult result, string detail)
    {
        var response = Assert.IsType<ObjectResult>(result);
        Assert.Equal(StatusCodes.Status503ServiceUnavailable, response.StatusCode);

        var responseBody = JsonSerializer.Serialize(response.Value);
        using var body = JsonDocument.Parse(responseBody);
        Assert.False(body.RootElement.GetProperty("ok").GetBoolean());
        Assert.Equal("Service unavailable", body.RootElement.GetProperty("error").GetString());
        Assert.DoesNotContain(detail, responseBody);
        Assert.DoesNotContain("sql.internal", responseBody);
        Assert.DoesNotContain("super-secret", responseBody);
    }

    private sealed class ThrowingConnectionFactory(string detail) : ISqlConnectionFactory
    {
        public IDbConnection Create() => new ThrowingConnection(detail);
    }

    private sealed class ThrowingConnection(string detail) : DbConnection
    {
        public override string DataSource => string.Empty;
        public override string ServerVersion => string.Empty;
        [AllowNull]
        public override string ConnectionString { get; set; } = string.Empty;
        public override string Database => string.Empty;
        public override ConnectionState State => ConnectionState.Closed;

        public override void ChangeDatabase(string databaseName) => throw new NotSupportedException();
        public override void Close() { }
        public override void Open() => throw new InvalidOperationException(detail);
        public override Task OpenAsync(CancellationToken cancellationToken) => Task.FromException(new InvalidOperationException(detail));
        protected override DbTransaction BeginDbTransaction(IsolationLevel isolationLevel) => throw new NotSupportedException();
        protected override DbCommand CreateDbCommand() => new SqlCommand();
    }
}
