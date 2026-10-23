using System.Data;
using System.Text.Json;
using System.Text.RegularExpressions;
using Dapper;

namespace IndoShipping.Api.Features.Purchasing;

public static class PurchaseCustomerValidation
{
    public sealed record Line(string? Code, string? OrderNos, int? MaterialId);

    // Include complete compound SKUs and the existing catalogue-backed TOMY suffix
    // convention. The candidates only select existing evidence; they imply no customer.
    static string[] CandidateKeys(IEnumerable<string?> codes)
    {
        var keys = new HashSet<string>();
        foreach (var code in codes)
        {
            var text = (code ?? "").Trim();
            keys.Add(text.ToLowerInvariant());
            foreach (var value in Regex.Split(text, @"\s+/\s+"))
            {
                keys.Add(value.Trim().ToLowerInvariant());
                if (!value.Contains('/'))
                    keys.Add(Regex.Replace(value.Trim(), "[A-Za-z]+$", "").ToLowerInvariant());
            }
        }
        return keys.Where(k => k.Length > 0).ToArray();
    }

    public static async Task<List<PurchaseCustomerIsolation.Product>> ProductsAsync(
        IDbConnection db, IDbTransaction tx, IEnumerable<string?> codes)
    {
        var keys = CandidateKeys(codes);
        // Customer edits/renames/deletes must not race the check. Never wait while
        // holding purchase item locks: a product rename also updates po_items.
        return (await db.QueryAsync<PurchaseCustomerIsolation.Product>("""
            SELECT code AS Code,customer AS Customer FROM products
            WHERE lower(trim(code))=ANY(@keys) ORDER BY code FOR SHARE NOWAIT
            """, new { keys }, tx)).ToList();
    }

    public static async Task<string?> ValidateAsync(IDbConnection db, IDbTransaction tx, IEnumerable<Line> source)
    {
        var lines = source.ToList();
        var materialIds = lines.Where(l => l.MaterialId.HasValue).Select(l => l.MaterialId!.Value).Distinct().ToArray();
        var tools = materialIds.Length == 0 ? [] : (await db.QueryAsync<int>("""
            SELECT material_id FROM tool_materials WHERE material_id=ANY(@materialIds)
            ORDER BY material_id FOR SHARE NOWAIT
            """, new { materialIds }, tx)).ToHashSet();
        // Only actual standalone tool records qualify, never the submitted category/name.
        lines = lines.Where(l => !l.MaterialId.HasValue || !tools.Contains(l.MaterialId.Value)).ToList();
        if (lines.Count == 0) return null;
        var products = await ProductsAsync(db, tx, lines.Select(l => l.Code));
        var keys = CandidateKeys(lines.Select(l => l.Code));
        var orders = lines.SelectMany(l => (l.OrderNos ?? "").Split([';', '；']))
            .Select(s => s.Trim().ToLowerInvariant()).Where(s => s.Length > 0).Distinct().ToArray();
        var snapshots = await db.QueryAsync<(string customer, string? raw)>("""
            SELECT customer,raw_rows::text FROM schedules
            WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(
                CASE WHEN jsonb_typeof(raw_rows)='array' THEN raw_rows ELSE '[]'::jsonb END) r
                WHERE lower(trim(r->>'code'))=ANY(@keys) AND lower(trim(r->>'orderNo'))=ANY(@orders))
            ORDER BY customer FOR SHARE NOWAIT
            """, new { keys, orders }, tx);
        var schedules = new List<PurchaseCustomerIsolation.Schedule>();
        foreach (var snapshot in snapshots)
        {
            using var doc = JsonDocument.Parse(snapshot.raw ?? "[]");
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
        var customers = lines.Select(l => PurchaseCustomerIsolation.Resolve(l.Code, l.OrderNos, products, schedules))
            .Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        if (customers.Count != 1)
            throw new InvalidOperationException($"不同客户的采购明细不能放在同一采购单（{string.Join("、", customers)}），请按客户分别处理");
        return customers.Single();
    }
}
