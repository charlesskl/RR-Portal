using Dapper;
using IndoShipping.Api.Auditing;
using IndoShipping.Api.Features.Purchasing;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Npgsql;

namespace IndoShipping.Api.Controllers;

public partial class PurchaseOrdersController
{
    public sealed class MergeBody
    {
        public int target_id { get; set; }
        public int[] ids { get; set; } = [];
    }

    // Buyer is encoded in the existing contract numbering convention. Never combine buyers.
    public static string PurchaseEntity(string? number)
    {
        var value = (number ?? "").Trim().ToUpperInvariant();
        if (value.StartsWith("IRRM")) return "HD_GLOBAL";
        if (value.StartsWith("IRRI")) return "HD_INDUSTRY";
        if (value.Length >= 4 && value[..4].All(char.IsAsciiDigit)) return "HSY";
        return "";
    }

    public static string MergeCurrency(string? currency) => (currency ?? "¥").Trim().ToUpperInvariant() switch
    {
        "" or "¥" or "￥" or "CNY" or "RMB" => "CNY",
        "US$" or "USD" => "USD",
        "HK$" or "HKD" => "HKD",
        "RP" or "IDR" => "IDR",
        _ => ""
    };

    [HttpPost("merge")]
    public async Task<IActionResult> Merge([FromBody] MergeBody body)
    {
        var ids = (body.ids ?? []).Distinct().Order().ToArray();
        if (ids.Length < 2 || ids.Length > 100 || ids.Any(id => id <= 0) || !ids.Contains(body.target_id))
            return BadRequest(new { error = "请选择 2–100 张采购单，并指定其中一张作为保留单号" });

        using var c = factory.Create();
        c.Open();
        using var tx = c.BeginTransaction();
        IActionResult Reject(string error)
        {
            tx.Rollback();
            return Conflict(new { error });
        }
        try
        {
            await c.ExecuteAsync("SET LOCAL lock_timeout = '5s'", transaction: tx);
            // Lock headers and items before checking state. FK item locks also serialize receipts/outbound.
            // Existing receipt paths can lock in reverse order; conflicts abort atomically and ask to retry.
            var orders = (await c.QueryAsync(
                "SELECT * FROM purchase_orders WHERE id=ANY(@ids) ORDER BY id FOR UPDATE", new { ids }, tx)).ToList();
            if (orders.Count != ids.Length) return Reject("部分采购单已不存在，请刷新后重选");
            var target = orders.Single(p => (int)p.id == body.target_id);
            var supplier = ((string?)target.supplier ?? "").Trim();
            var entity = PurchaseEntity((string?)target.po_no);
            if (supplier.Length == 0 || target.order_date == null || entity.Length == 0)
                return Reject("采购单必须有供应商、下单日期及可识别采购主体的单号");
            foreach (var p in orders)
            {
                if (p.merged_into_id != null || (string?)p.status != "draft")
                    return Reject($"采购单 {p.po_no} 不是可合并的草稿（已发出、入库、取消或已合并的单据不支持）");
                if (((string?)p.supplier ?? "").Trim() != supplier)
                    return Reject("只能合并同一供应商的采购单");
                if (p.order_date == null) return Reject($"采购单 {p.po_no} 缺少下单日期，请先补齐");
                if (PurchaseEntity((string?)p.po_no) != entity)
                    return Reject("不同采购主体或无法识别主体的采购单不能合并");
            }
            var items = (await c.QueryAsync(
                "SELECT * FROM po_items WHERE po_id=ANY(@ids) ORDER BY id FOR UPDATE", new { ids }, tx)).ToList();
            if (orders.Any(p => !items.Any(i => (int)i.po_id == (int)p.id)))
                return Reject("空白采购单不能参与合并");
            var currencies = items.Select(i => MergeCurrency((string?)i.currency)).Distinct().ToArray();
            if (currencies.Length != 1 || currencies[0].Length == 0)
                return Reject("采购明细币种必须一致，且不能含未知币种");
            // Enforce customer isolation on the server, including older orders
            // which predate the customer-aware purchase picker.
            var products = (await c.QueryAsync<PurchaseCustomerIsolation.Product>(
                "SELECT code AS Code,customer AS Customer FROM products", transaction: tx)).ToList();
            var snapshots = await c.QueryAsync<(string customer, string raw)>(
                "SELECT customer,raw_rows::text FROM schedules", transaction: tx);
            var schedules = new List<PurchaseCustomerIsolation.Schedule>();
            foreach (var snapshot in snapshots)
            {
                using var doc = JsonDocument.Parse(snapshot.raw ?? "[]");
                if (doc.RootElement.ValueKind != JsonValueKind.Array) continue;
                foreach (var row in doc.RootElement.EnumerateArray())
                {
                    if (row.ValueKind != JsonValueKind.Object) continue;
                    string Field(string key) => row.TryGetProperty(key, out var value) ? value.ToString().Trim() : "";
                    var code = Field("code");
                    var order = Field("orderNo");
                    if (code.Length > 0 && order.Length > 0)
                        schedules.Add(new(code, order, string.IsNullOrWhiteSpace(Field("customer")) ? snapshot.customer : Field("customer")));
                }
            }
            var customers = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var item in items)
            {
                try { customers.Add(PurchaseCustomerIsolation.Resolve((string?)item.product_code, (string?)item.tomy_po, products, schedules)); }
                catch (InvalidOperationException ex) { return Reject(ex.Message); }
            }
            if (customers.Count != 1)
                return Reject($"不同客户的采购单不能合并（{string.Join("、", customers)}），请按客户分别处理");
            var poNos = orders.Select(p => (string)p.po_no).ToArray();
            var occupied = await c.ExecuteScalarAsync<bool>("""
                SELECT EXISTS(SELECT 1 FROM po_receipts r JOIN po_items i ON i.id=r.po_item_id WHERE i.po_id=ANY(@ids))
                    OR EXISTS(SELECT 1 FROM outbound o LEFT JOIN po_items i ON i.id=o.po_item_id
                              WHERE i.po_id=ANY(@ids) OR o.po_no=ANY(@poNos))
                    OR EXISTS(SELECT 1 FROM shipment_items WHERE po_no=ANY(@poNos))
                """, new { ids, poNos }, tx);
            if (occupied) return Reject("所选采购单已有入库、出库或走货关联，不能合并，请先核对对应记录");

            // Keep exact quantities/prices/IDs and schedule links. Snapshot original delivery dates,
            // including NULL, once; repeated merges must not relabel earlier source lines.
            await c.ExecuteAsync("""
                UPDATE po_items i SET
                    source_order_date=CASE WHEN i.source_po_no IS NULL THEN p.order_date ELSE i.source_order_date END,
                    source_delivery_date=CASE WHEN i.source_po_no IS NULL THEN p.delivery_date ELSE i.source_delivery_date END,
                    source_po_no=COALESCE(i.source_po_no,p.po_no), po_id=@targetId
                FROM purchase_orders p WHERE i.po_id=p.id AND p.id=ANY(@ids)
                """, new { ids, targetId = body.target_id }, tx);
            var sources = orders.Where(p => (int)p.id != body.target_id).ToList();
            var sourceIds = sources.Select(p => (int)p.id).ToArray();
            var sourceNotes = string.Join("\n", sources.Select(p =>
                $"来源采购单：{p.po_no}；下单日期：{((DateTime)p.order_date).ToString("yyyy-MM-dd")}；交货日期：{(p.delivery_date == null ? "未填写" : ((DateTime)p.delivery_date).ToString("yyyy-MM-dd"))}；{p.notes}"));
            await c.ExecuteAsync("""
                UPDATE purchase_orders SET notes=concat_ws(E'\n',NULLIF(notes,''),@sourceNotes),
                    merge_revision=merge_revision+1 WHERE id=@targetId;
                UPDATE purchase_orders SET merged_into_id=@targetId
                    WHERE id=ANY(@sourceIds) OR merged_into_id=ANY(@sourceIds);
                """, new { targetId = body.target_id, sourceIds, sourceNotes }, tx);
            // Source headers remain archived (including their unique PO numbers and original notes).
            // Audit contains the before-image of every header and line, plus the destination and operator.
            await this.WriteAsync(c, tx, "purchase", "merge", "purchase_order", body.target_id,
                $"合并采购单 {string.Join("、", poNos)} → {target.po_no}",
                new { target_id = body.target_id, orders, items });
            tx.Commit();
            return Ok(new { ok = true, id = body.target_id, po_no = (string)target.po_no, item_count = items.Count });
        }
        catch (PostgresException ex) when (ex.SqlState is "40P01" or "55P03" or "40001")
        {
            tx.Rollback();
            return Conflict(new { error = "采购单正在被其他操作使用，未作任何合并，请刷新后重试" });
        }
        catch { tx.Rollback(); throw; }
    }
}
