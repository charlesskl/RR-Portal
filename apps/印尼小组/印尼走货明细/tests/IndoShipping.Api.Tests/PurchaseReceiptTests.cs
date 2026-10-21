using Dapper;
using IndoShipping.Api.Controllers;
using IndoShipping.Infrastructure.Persistence;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Npgsql;
using Xunit;

namespace IndoShipping.Api.Tests;

public sealed class PurchaseReceiptTests
{
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Completed_order_accepts_spares_and_deletion_preserves_completion(bool bulk)
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        await f.Db.ExecuteAsync("INSERT INTO po_receipts(po_item_id,qty,spare_qty) VALUES (1,100,0)");
        var result = bulk
            ? await f.Controller.CreateBulkReceipt(1, new() { items = [new() { po_item_id = 1, qty = 0, spare_qty = 5 }] })
            : await f.Controller.CreateReceipt(1, new() { qty = 0, spare_qty = 5 });
        Assert.IsType<OkObjectResult>(result);
        Assert.Equal(100m, await f.Db.ExecuteScalarAsync<decimal>("SELECT SUM(qty) FROM po_receipts WHERE po_item_id=1"));
        Assert.Equal(5m, await f.Db.ExecuteScalarAsync<decimal>("SELECT SUM(spare_qty) FROM po_receipts WHERE po_item_id=1"));
        Assert.Equal("received", await f.Status());
        Assert.Equal(1, await f.Db.ExecuteScalarAsync<int>("SELECT count(*) FROM audit_logs"));
        var receiptId = await f.Db.ExecuteScalarAsync<int>("SELECT id FROM po_receipts WHERE spare_qty=5");
        // 备品已被领用时仍不允许删除导致库存不足。
        await f.Db.ExecuteAsync("INSERT INTO outbound(po_item_id,qty) VALUES (1,103)");
        Assert.IsType<ConflictObjectResult>(await f.Controller.DeleteReceipt(receiptId));
        await f.Db.ExecuteAsync("DELETE FROM outbound");
        Assert.IsType<OkObjectResult>(await f.Controller.DeleteReceipt(receiptId));
        Assert.Equal("received", await f.Status());
        Assert.Equal(0m, await f.Db.ExecuteScalarAsync<decimal>("SELECT SUM(spare_qty) FROM po_receipts"));
        var normalId = await f.Db.ExecuteScalarAsync<int>("SELECT id FROM po_receipts");
        Assert.IsType<OkObjectResult>(await f.Controller.DeleteReceipt(normalId));
        Assert.Equal("sent", await f.Status());
    }

    [Fact]
    public async Task Bulk_accepts_mixed_completed_and_open_lines_and_spares_do_not_reduce_shortage()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        await f.Db.ExecuteAsync("""
            UPDATE purchase_orders SET status='sent' WHERE id=1;
            INSERT INTO po_items(id,po_id,qty,purchase_qty) VALUES (3,1,20,20);
            INSERT INTO po_receipts(po_item_id,qty,spare_qty) VALUES (1,100,0);
            """);
        Assert.IsType<OkObjectResult>(await f.Controller.CreateBulkReceipt(1, new() { items = [
            new() { po_item_id=1, qty=0, spare_qty=5 },
            new() { po_item_id=3, qty=10, spare_qty=50 },
        ] }));
        Assert.Equal("sent", await f.Status());
        Assert.Equal(10m, await f.Db.ExecuteScalarAsync<decimal>("SELECT SUM(qty) FROM po_receipts WHERE po_item_id=3"));
        Assert.IsType<OkObjectResult>(await f.Controller.CreateReceipt(3, new() { qty=10, spare_qty=0 }));
        Assert.Equal("received", await f.Status());
    }

    [Theory]
    [InlineData(-1, 5)]
    [InlineData(0, -1)]
    [InlineData(0, 0)]
    [InlineData(1, 5)]
    public async Task Invalid_and_over_receipts_are_rejected_by_both_endpoints(int qty, int spare)
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        await f.Db.ExecuteAsync("INSERT INTO po_receipts(po_item_id,qty,spare_qty) VALUES (1,100,0)");
        Assert.IsType<BadRequestObjectResult>(await f.Controller.CreateReceipt(1, new() { qty=qty, spare_qty=spare }));
        Assert.IsType<BadRequestObjectResult>(await f.Controller.CreateBulkReceipt(1, new() { items = [
            new() { po_item_id=1, qty=qty, spare_qty=spare },
        ] }));
        Assert.Equal(1, await f.Db.ExecuteScalarAsync<int>("SELECT count(*) FROM po_receipts"));
        Assert.Equal(0, await f.Db.ExecuteScalarAsync<int>("SELECT count(*) FROM audit_logs"));
    }

    [Fact]
    public async Task Bulk_spares_cannot_reference_another_order_and_failure_is_atomic()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        Assert.IsType<BadRequestObjectResult>(await f.Controller.CreateBulkReceipt(1, new() { items = [
            new() { po_item_id=1, spare_qty=5 }, new() { po_item_id=2, spare_qty=5 },
        ] }));
        Assert.Equal(0, await f.Db.ExecuteScalarAsync<int>("SELECT count(*) FROM po_receipts"));
        Assert.IsType<BadRequestObjectResult>(await f.Controller.CreateBulkReceipt(1, new() { items = [
            new() { po_item_id=1, spare_qty=5 }, new() { po_item_id=1, qty=-1, spare_qty=5 },
        ] }));
        Assert.Equal(0, await f.Db.ExecuteScalarAsync<int>("SELECT count(*) FROM po_receipts"));
    }

    private sealed class Fixture : IAsyncDisposable
    {
        public required NpgsqlConnection Db { get; init; }
        public required string Schema { get; init; }
        public required string ConnectionString { get; init; }
        public PurchaseOrdersController Controller => new(new SqlConnectionFactory(ConnectionString))
        { ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() } };
        public Task<string?> Status() => Db.ExecuteScalarAsync<string>("SELECT status FROM purchase_orders WHERE id=1");

        public static async Task<Fixture?> Create()
        {
            var connection = Environment.GetEnvironmentVariable("SUPPLIER_SYNC_TEST_CONNECTION");
            if (string.IsNullOrWhiteSpace(connection)) return null;
            var schema = "purchase_receipt_test_" + Guid.NewGuid().ToString("N");
            var cs = new NpgsqlConnectionStringBuilder(connection) { SearchPath = schema }.ConnectionString;
            var db = new NpgsqlConnection(cs);
            await db.OpenAsync();
            await db.ExecuteAsync($"CREATE SCHEMA {schema}");
            await db.ExecuteAsync("""
                CREATE TABLE purchase_orders(id int PRIMARY KEY,po_no text,status text);
                CREATE TABLE po_items(id int PRIMARY KEY,po_id int REFERENCES purchase_orders(id),qty numeric,purchase_qty numeric);
                CREATE TABLE po_receipts(id serial PRIMARY KEY,po_item_id int REFERENCES po_items(id),
                    receipt_date date,qty numeric,spare_qty numeric DEFAULT 0,batch_no text,notes text);
                CREATE TABLE outbound(po_item_id int REFERENCES po_items(id),qty numeric);
                CREATE TABLE audit_logs(user_id int,username text,module text,action text,entity_type text,entity_id text,
                    summary text,details jsonb,ip_address text);
                INSERT INTO purchase_orders VALUES (1,'IRRIHS0396','received'),(2,'OTHER','sent');
                INSERT INTO po_items VALUES (1,1,100,100),(2,2,10,10);
                """);
            return new() { Db=db, Schema=schema, ConnectionString=cs };
        }
        public async ValueTask DisposeAsync()
        {
            try { await Db.ExecuteAsync($"DROP SCHEMA {Schema} CASCADE"); }
            finally { await Db.DisposeAsync(); }
        }
    }
}
