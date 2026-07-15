using System.Data;
using Dapper;
using Microsoft.Data.Sqlite;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;

namespace IndoShipping.Migrator;

public class Program
{
    public static async Task<int> Main(string[] args)
    {
        var config = new ConfigurationBuilder()
            .AddJsonFile("appsettings.json", optional: true)
            .AddCommandLine(args)
            .Build();

        var sqliteFile = config["sqlite"] ?? @"d:\Projects\印尼明细\backend\data.db";
        var sqlServerConn = config["mssql"]
            ?? @"Server=(localdb)\MSSQLLocalDB;Database=IndoShipping;Trusted_Connection=True;TrustServerCertificate=True;";

        if (!File.Exists(sqliteFile))
        {
            Console.Error.WriteLine($"SQLite 文件不存在: {sqliteFile}");
            return 2;
        }

        Console.WriteLine($"源 SQLite: {sqliteFile}");
        Console.WriteLine($"目标 MSSQL: {sqlServerConn.Split(';')[0]}...");
        Console.WriteLine();

        await using var src = new SqliteConnection($"Data Source={sqliteFile};Mode=ReadOnly");
        await src.OpenAsync();
        await using var dst = new SqlConnection(sqlServerConn);
        await dst.OpenAsync();

        // 清空目标(保留 Users 表 — 不动账号);顺序: 子表先
        await Truncate(dst,
            "shipment_items", "shipments", "outbound", "po_items", "purchase_orders",
            "schedules", "dict_supplier", "dict_hs", "images",
            "materials", "products", "customers", "settings");

        var total = 0;
        total += await Migrate(src, dst, "customers",
            "SELECT name, COALESCE(created_at, datetime('now')) AS created_at FROM customers",
            "INSERT INTO dbo.customers (name, created_at) VALUES (@name, @created_at)");

        total += await Migrate(src, dst, "products",
            "SELECT code, name, hs_cn, hs_id, customer, moldings, COALESCE(created_at, datetime('now')) AS created_at, COALESCE(updated_at, datetime('now')) AS updated_at FROM products",
            "INSERT INTO dbo.products (code, name, hs_cn, hs_id, customer, moldings, created_at, updated_at) VALUES (@code, @name, @hs_cn, @hs_id, @customer, @moldings, @created_at, @updated_at)");

        total += await Migrate(src, dst, "materials",
            @"SELECT product_code, item_no, name_zh, name_en, spec, category, material_code, hs_cn, hs_id,
                     supplier, customs_company, COALESCE(unit_kg, 'KGM') AS unit_kg,
                     COALESCE(gross_per_pc,0) AS gross_per_pc, COALESCE(net_per_pc,0) AS net_per_pc,
                     COALESCE(length,0) AS length, COALESCE(width,0) AS width, COALESCE(height,0) AS height,
                     COALESCE(qty_per_carton,0) AS qty_per_carton, COALESCE(weight_per_carton,0) AS weight_per_carton,
                     image_id, COALESCE(active,1) AS active, COALESCE(sort_order,0) AS sort_order,
                     COALESCE(created_at, datetime('now')) AS created_at
              FROM materials",
            @"INSERT INTO dbo.materials
                (product_code, item_no, name_zh, name_en, spec, category, material_code, hs_cn, hs_id,
                 supplier, customs_company, unit_kg, gross_per_pc, net_per_pc, length, width, height,
                 qty_per_carton, weight_per_carton, image_id, active, sort_order, created_at)
              VALUES
                (@product_code, @item_no, @name_zh, @name_en, @spec, @category, @material_code, @hs_cn, @hs_id,
                 @supplier, @customs_company, @unit_kg, @gross_per_pc, @net_per_pc, @length, @width, @height,
                 @qty_per_carton, @weight_per_carton, @image_id, @active, @sort_order, @created_at)");

        total += await Migrate(src, dst, "images",
            "SELECT id, mime, data_url, COALESCE(created_at, datetime('now')) AS created_at FROM images",
            "INSERT INTO dbo.images (id, mime, data_url, created_at) VALUES (@id, @mime, @data_url, @created_at)");

        total += await Migrate(src, dst, "dict_hs",
            "SELECT keyword, hs_cn, hs_id, COALESCE(priority,100) AS priority FROM dict_hs",
            "INSERT INTO dbo.dict_hs (keyword, hs_cn, hs_id, priority) VALUES (@keyword, @hs_cn, @hs_id, @priority)");

        total += await Migrate(src, dst, "dict_supplier",
            "SELECT keyword, full_name, customs_company, COALESCE(priority,100) AS priority FROM dict_supplier",
            "INSERT INTO dbo.dict_supplier (keyword, full_name, customs_company, priority) VALUES (@keyword, @full_name, @customs_company, @priority)");

        total += await Migrate(src, dst, "schedules",
            "SELECT week_label, upload_date, raw_rows, diff_from_prev, COALESCE(created_at, datetime('now')) AS created_at FROM schedules",
            "INSERT INTO dbo.schedules (week_label, upload_date, raw_rows, diff_from_prev, created_at) VALUES (@week_label, @upload_date, @raw_rows, @diff_from_prev, @created_at)");

        // PO 父子表需要 id 映射: po_items.po_id 引用 purchase_orders.id, 目标 IDENTITY 不接受插入旧 id
        var poIdMap = await MigratePurchaseOrders(src, dst);
        total += poIdMap.Count;
        total += await MigratePoItems(src, dst, poIdMap);

        total += await Migrate(src, dst, "outbound",
            "SELECT po_no, material_id, qty, out_date, notes, COALESCE(created_at, datetime('now')) AS created_at FROM outbound",
            "INSERT INTO dbo.outbound (po_no, material_id, qty, out_date, notes, created_at) VALUES (@po_no, @material_id, @qty, @out_date, @notes, @created_at)");

        var shipIdMap = await MigrateShipments(src, dst);
        total += shipIdMap.Count;
        total += await MigrateShipmentItems(src, dst, shipIdMap);

        total += await Migrate(src, dst, "settings",
            "SELECT key, value, COALESCE(updated_at, datetime('now')) AS updated_at FROM settings",
            "INSERT INTO dbo.settings ([key], value, updated_at) VALUES (@key, @value, @updated_at)");

        Console.WriteLine();
        Console.WriteLine($"✅ 迁移完成,共 {total} 行");
        return 0;
    }

    private static async Task Truncate(SqlConnection dst, params string[] tables)
    {
        foreach (var t in tables)
        {
            await dst.ExecuteAsync($"DELETE FROM dbo.{t}");
            var hasIdentity = await dst.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM sys.identity_columns WHERE OBJECT_NAME(object_id) = @t",
                new { t });
            if (hasIdentity > 0)
                await dst.ExecuteAsync($"DBCC CHECKIDENT('dbo.{t}', RESEED, 0) WITH NO_INFOMSGS");
        }
        Console.WriteLine($"已清空 {tables.Length} 张目标表");
    }

    private static async Task<int> Migrate(SqliteConnection src, SqlConnection dst, string label, string srcSql, string dstSql)
    {
        var rows = (await src.QueryAsync(srcSql)).ToList();
        if (rows.Count == 0) { Console.WriteLine($"  {label,-20} {0,6} 行"); return 0; }

        using var tx = await dst.BeginTransactionAsync();
        foreach (var row in rows)
            await dst.ExecuteAsync(dstSql, (object)row, (IDbTransaction)tx);
        await tx.CommitAsync();

        Console.WriteLine($"  {label,-20} {rows.Count,6} 行");
        return rows.Count;
    }

    private static async Task<Dictionary<long, int>> MigratePurchaseOrders(SqliteConnection src, SqlConnection dst)
    {
        var rows = (await src.QueryAsync(
            "SELECT id, po_no, supplier, COALESCE(status,'draft') AS status, order_date, notes, COALESCE(created_at, datetime('now')) AS created_at FROM purchase_orders ORDER BY id")).ToList();
        var map = new Dictionary<long, int>();
        if (rows.Count == 0) { Console.WriteLine($"  purchase_orders         0 行"); return map; }

        using var tx = await dst.BeginTransactionAsync();
        foreach (dynamic row in rows)
        {
            var newId = await dst.ExecuteScalarAsync<int>(
                @"INSERT INTO dbo.purchase_orders (po_no, supplier, status, order_date, notes, created_at)
                  OUTPUT INSERTED.id
                  VALUES (@po_no, @supplier, @status, @order_date, @notes, @created_at)",
                (object)row, (IDbTransaction)tx);
            map[(long)row.id] = newId;
        }
        await tx.CommitAsync();
        Console.WriteLine($"  purchase_orders     {rows.Count,6} 行");
        return map;
    }

    private static async Task<int> MigratePoItems(SqliteConnection src, SqlConnection dst, Dictionary<long, int> poIdMap)
    {
        var rows = (await src.QueryAsync("SELECT po_id, product_code, material_id, qty, price, COALESCE(currency,'¥') AS currency, notes FROM po_items")).ToList();
        if (rows.Count == 0) { Console.WriteLine($"  po_items                0 行"); return 0; }

        using var tx = await dst.BeginTransactionAsync();
        var inserted = 0;
        foreach (dynamic row in rows)
        {
            if (row.po_id == null) continue;
            if (!poIdMap.TryGetValue((long)row.po_id, out int newPoId)) continue;
            await dst.ExecuteAsync(
                @"INSERT INTO dbo.po_items (po_id, product_code, material_id, qty, price, currency, notes)
                  VALUES (@po_id, @product_code, @material_id, @qty, @price, @currency, @notes)",
                new { po_id = newPoId, row.product_code, row.material_id, row.qty, row.price, row.currency, row.notes },
                (IDbTransaction)tx);
            inserted++;
        }
        await tx.CommitAsync();
        Console.WriteLine($"  po_items            {inserted,6} 行");
        return inserted;
    }

    private static async Task<Dictionary<long, int>> MigrateShipments(SqliteConnection src, SqlConnection dst)
    {
        var rows = (await src.QueryAsync(
            @"SELECT id, customer, container_no, COALESCE(container_count,1) AS container_count,
                     ship_date, bl_no, COALESCE(rate,0.93) AS rate, COALESCE(status,'draft') AS status,
                     COALESCE(created_at, datetime('now')) AS created_at
              FROM shipments ORDER BY id")).ToList();
        var map = new Dictionary<long, int>();
        if (rows.Count == 0) { Console.WriteLine($"  shipments               0 行"); return map; }

        using var tx = await dst.BeginTransactionAsync();
        foreach (dynamic row in rows)
        {
            var newId = await dst.ExecuteScalarAsync<int>(
                @"INSERT INTO dbo.shipments (customer, container_no, container_count, ship_date, bl_no, rate, status, created_at)
                  OUTPUT INSERTED.id
                  VALUES (@customer, @container_no, @container_count, @ship_date, @bl_no, @rate, @status, @created_at)",
                (object)row, (IDbTransaction)tx);
            map[(long)row.id] = newId;
        }
        await tx.CommitAsync();
        Console.WriteLine($"  shipments           {rows.Count,6} 行");
        return map;
    }

    private static async Task<int> MigrateShipmentItems(SqliteConnection src, SqlConnection dst, Dictionary<long, int> shipIdMap)
    {
        var rows = (await src.QueryAsync(
            @"SELECT shipment_id, material_id, seq, kg, qty, cartons, qty_per_carton, pallet,
                     price, COALESCE(currency,'¥') AS currency, po_no, po_date, supplier, customs_company,
                     bl_head, contract_no, contract_date, invoice_no, invoice_date, invoice_price,
                     product_use, formula_name
              FROM shipment_items")).ToList();
        if (rows.Count == 0) { Console.WriteLine($"  shipment_items          0 行"); return 0; }

        using var tx = await dst.BeginTransactionAsync();
        var inserted = 0;
        foreach (dynamic row in rows)
        {
            if (row.shipment_id == null) continue;
            if (!shipIdMap.TryGetValue((long)row.shipment_id, out int newShipId)) continue;
            await dst.ExecuteAsync(
                @"INSERT INTO dbo.shipment_items
                    (shipment_id, material_id, seq, kg, qty, cartons, qty_per_carton, pallet, price, currency,
                     po_no, po_date, supplier, customs_company, bl_head, contract_no, contract_date,
                     invoice_no, invoice_date, invoice_price, product_use, formula_name)
                  VALUES
                    (@shipment_id, @material_id, @seq, @kg, @qty, @cartons, @qty_per_carton, @pallet, @price, @currency,
                     @po_no, @po_date, @supplier, @customs_company, @bl_head, @contract_no, @contract_date,
                     @invoice_no, @invoice_date, @invoice_price, @product_use, @formula_name)",
                new
                {
                    shipment_id = newShipId,
                    row.material_id, row.seq, row.kg, row.qty, row.cartons, row.qty_per_carton, row.pallet, row.price, row.currency,
                    row.po_no, row.po_date, row.supplier, row.customs_company, row.bl_head, row.contract_no, row.contract_date,
                    row.invoice_no, row.invoice_date, row.invoice_price, row.product_use, row.formula_name
                },
                (IDbTransaction)tx);
            inserted++;
        }
        await tx.CommitAsync();
        Console.WriteLine($"  shipment_items      {inserted,6} 行");
        return inserted;
    }
}
