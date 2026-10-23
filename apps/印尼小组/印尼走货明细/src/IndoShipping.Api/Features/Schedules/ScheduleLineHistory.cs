using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace IndoShipping.Api.Features.Schedules;

// A PO number is not a schedule-line ID (in particular, MA is reused).
// Match occurrences one-to-one, keeping exact old lines before pairing edits.
public static class ScheduleLineHistory
{
    public sealed record Snapshot(int Id, string? Label, DateTime? Uploaded, string? Raw, string Customer = "TOMY");
    public sealed record Difference(List<JsonObject> added, List<JsonObject> removed, List<object> changed);
    public sealed record View(Snapshot Snapshot, List<JsonObject> Rows, Difference Diff);
    public sealed record StoredLine(string Id, bool LegacyPlacedEligible, bool LegacyProductionEligible);
    public sealed record StoredSnapshot(string RawHash, List<StoredLine?> Lines);
    // Keep identities outside business raw_rows: material tracking hashes that JSON verbatim.
    public sealed class Ledger
    {
        public Dictionary<int, StoredSnapshot> Snapshots { get; set; } = [];
        public HashSet<string> UsedIds { get; set; } = [];
        public HashSet<string> LegacyKeys { get; set; } = [];
        public HashSet<string> ProductionPos { get; set; } = [];
    }
    static readonly string[] Identity = ["source", "customer", "code", "orderNo", "customerPO", "orderDate", "country", "endCustomer"];
    static readonly string[] Significant = ["qty", "eta", "productName", "unitPrice"];

    public static string Field(JsonObject row, string key) => row[key]?.ToString().Trim() ?? "";
    public static string LegacyKey(JsonObject row) => $"{Field(row, "orderNo")}|{Field(row, "code")}";
    public static string LineKey(JsonObject row) => Field(row, "_scheduleLineId");
    static string Signature(JsonObject row, IEnumerable<string> fields) =>
        JsonSerializer.Serialize(fields.Select(k => Field(row, k)));
    static bool Modified(JsonObject a, JsonObject b) => Significant.Any(k =>
        k is "qty" or "unitPrice"
            ? Number(a, k) != Number(b, k)
            : Field(a, k) != Field(b, k));
    static decimal Number(JsonObject row, string key) => decimal.TryParse(Field(row, key),
        NumberStyles.Any, CultureInfo.InvariantCulture, out var n) ? n : 0;

    public static DateTime Period(Snapshot snapshot)
    {
        var label = snapshot.Label?.Trim() ?? "";
        var week = Regex.Match(label, @"^(\d{4})-W(\d{1,2})$", RegexOptions.IgnoreCase);
        if (week.Success && int.TryParse(week.Groups[1].Value, out var year) && year is >= 1 and <= 9999 &&
            int.TryParse(week.Groups[2].Value, out var w) && w >= 1 && w <= ISOWeek.GetWeeksInYear(year))
            return ISOWeek.ToDateTime(year, w, DayOfWeek.Monday);
        if (Regex.IsMatch(label, @"^\d{2}-\d{2}-\d{2}$")) label = "20" + label;
        if (DateTime.TryParseExact(label, ["yyyy-MM-dd", "yyyy/M/d", "yyyy-M-d"],
            CultureInfo.InvariantCulture, DateTimeStyles.None, out var date)) return date;
        return snapshot.Uploaded?.Date ?? DateTime.MinValue;
    }

    public static Ledger ReadLedger(string? raw) => string.IsNullOrWhiteSpace(raw) ? new() :
        JsonSerializer.Deserialize<Ledger>(raw) ?? throw new InvalidOperationException("Invalid schedule identity ledger");
    static string RawHash(string? raw) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(raw ?? "[]")));
    static StoredLine Store(JsonObject row) => new(LineKey(row),
        row["_legacyPlacedEligible"]?.GetValue<bool>() == true,
        row["_legacyProductionEligible"]?.GetValue<bool>() == true);

    public static Ledger Freeze(IEnumerable<View> views, Ledger? previous = null)
    {
        var result = new Ledger
        {
            UsedIds = new(previous?.UsedIds ?? []),
            LegacyKeys = new(previous?.LegacyKeys ?? []),
            ProductionPos = new(previous?.ProductionPos ?? []),
        };
        foreach (var view in views)
        {
            result.Snapshots[view.Snapshot.Id] = new(RawHash(view.Snapshot.Raw), view.Rows.Select(r => (StoredLine?)Store(r)).ToList());
            result.UsedIds.UnionWith(view.Rows.Select(LineKey));
            result.LegacyKeys.UnionWith(view.Rows.Select(LegacyKey));
            result.ProductionPos.UnionWith(view.Rows.Select(r => Field(r, "orderNo")));
        }
        return result;
    }

    // Only the server calls this, after loading the overwritten period under the upload lock.
    public static StoredSnapshot Replacement(Snapshot snapshot, List<JsonObject> previousRows)
    {
        var rows = Parse(snapshot.Raw);
        var pairs = Pair(previousRows, rows);
        return new(RawHash(snapshot.Raw), rows.Select(r => pairs.TryGetValue(r, out var old) ? Store(old) : null).ToList());
    }

    static Dictionary<JsonObject, JsonObject> Pair(List<JsonObject> previous, List<JsonObject> rows)
    {
        var remaining = new HashSet<JsonObject>(previous, ReferenceEqualityComparer.Instance);
        var pairs = new Dictionary<JsonObject, JsonObject>(ReferenceEqualityComparer.Instance);
        // A persisted ID disambiguates duplicate edits; reserve those pairs before content matching.
        foreach (var row in rows.Where(r => LineKey(r).Length > 0))
        {
            var match = previous.FirstOrDefault(p => remaining.Contains(p) && LineKey(p) == LineKey(row));
            if (match is null) continue;
            pairs[row] = match;
            remaining.Remove(match);
        }
        var oldGroups = previous.GroupBy(p => Signature(p, Identity)).ToDictionary(g => g.Key, g => g.ToList());
        // An unmatched persisted ID is a separate line, even if an earlier backfill looks identical.
        foreach (var group in rows.Where(r => LineKey(r).Length == 0).GroupBy(r => Signature(r, Identity)))
        {
            var old = oldGroups.GetValueOrDefault(group.Key) ?? [];
            foreach (var row in group.Where(r => !pairs.ContainsKey(r)))
            {
                var match = old.FirstOrDefault(p => remaining.Contains(p) && !Modified(p, row));
                if (match is null) continue;
                pairs[row] = match;
                remaining.Remove(match);
            }
            var unmatched = group.Where(r => !pairs.ContainsKey(r)).ToList();
            var available = old.Where(remaining.Contains).ToList();
            // Only an unambiguous one-to-one remainder is an edit. Never guess among duplicates.
            if (unmatched.Count == 1 && available.Count == 1)
            {
                pairs[unmatched[0]] = available[0];
                remaining.Remove(available[0]);
            }
        }
        return pairs;
    }

    public static List<View> Build(IEnumerable<Snapshot> snapshots, Ledger? ledger = null)
    {
        var views = new List<View>();
        var previousByCustomer = new Dictionary<string, List<JsonObject>>(StringComparer.OrdinalIgnoreCase);
        var prepared = snapshots.OrderBy(Period).ThenBy(x => x.Id).Select(s => (Snapshot: s, Rows: Parse(s.Raw))).ToList();
        var newReplacementLines = new HashSet<JsonObject>(ReferenceEqualityComparer.Instance);
        var usedIds = new HashSet<string>(ledger?.UsedIds ?? []);
        // Old broad flags can belong to the first occurrence only, never every future row.
        var legacyOwners = new Dictionary<string, string>();
        var productionOwners = new Dictionary<string, HashSet<string>>();
        foreach (var key in ledger?.LegacyKeys ?? []) legacyOwners[key] = "";
        foreach (var po in ledger?.ProductionPos ?? []) productionOwners[po] = [];
        // Reserve persisted owners across the whole history before considering an earlier backfill.
        foreach (var (snapshot, rows) in prepared)
        {
            if (ledger is null || !ledger.Snapshots.TryGetValue(snapshot.Id, out var stored)) continue;
            if (stored.RawHash != RawHash(snapshot.Raw) || stored.Lines.Count != rows.Count)
                throw new InvalidOperationException("Schedule identity ledger does not match stored rows");
            for (var i = 0; i < rows.Count; i++)
            {
                if (stored.Lines[i] is not { } line)
                {
                    // This line was not present in the overwritten period. Do not revive a deleted ID
                    // merely because the same contents still exist in an even earlier period.
                    newReplacementLines.Add(rows[i]);
                    continue;
                }
                if (!line.Id.StartsWith("line:", StringComparison.Ordinal))
                    throw new InvalidOperationException("Invalid persisted schedule identity");
                var row = rows[i]; row["_scheduleLineId"] = line.Id;
                usedIds.Add(line.Id);
                var key = LegacyKey(row);
                legacyOwners.TryAdd(key, "");
                if (line.LegacyPlacedEligible) legacyOwners[key] = line.Id;
                var po = Field(row, "orderNo");
                if (!productionOwners.ContainsKey(po)) productionOwners[po] = [];
                if (line.LegacyProductionEligible) productionOwners[po].Add(line.Id);
            }
        }
        // A newly backfilled adjacent period can extend an already anchored line backwards.
        // Only unique exact matches qualify; replacement tombstones and established IDs are barriers.
        foreach (var customerPeriods in prepared.GroupBy(p => p.Snapshot.Customer, StringComparer.OrdinalIgnoreCase))
        {
            var periods = customerPeriods.ToList();
            for (var i = periods.Count - 2; i >= 0; i--)
            {
                var current = periods[i];
                var next = periods[i + 1];
                if (ledger?.Snapshots.ContainsKey(current.Snapshot.Id) == true) continue;
                var distance = Period(next.Snapshot) - Period(current.Snapshot);
                if (distance <= TimeSpan.Zero || distance > TimeSpan.FromDays(7)) continue;
                foreach (var row in current.Rows.Where(r => LineKey(r).Length == 0))
                {
                    bool Exact(JsonObject other) => Signature(other, Identity) == Signature(row, Identity) && !Modified(other, row);
                    var candidates = next.Rows.Where(Exact).ToList();
                    if (candidates.Count != 1 || LineKey(candidates[0]).Length == 0 || current.Rows.Count(Exact) != 1) continue;
                    var id = LineKey(candidates[0]);
                    // Do not shift a known identity boundary between two otherwise identical orders.
                    if (i > 0 && periods[i - 1].Rows.Any(r => LineKey(r).Length > 0 && LineKey(r) != id && Exact(r))) continue;
                    row["_scheduleLineId"] = id;
                }
            }
        }
        foreach (var (snapshot, rows) in prepared)
        {
            var previous = previousByCustomer.GetValueOrDefault(snapshot.Customer) ?? [];
            var pairs = Pair(previous, rows.Where(r => !newReplacementLines.Contains(r)).ToList());
            var remaining = new HashSet<JsonObject>(previous, ReferenceEqualityComparer.Instance);
            remaining.ExceptWith(pairs.Values);
            var added = new List<JsonObject>();
            var changed = new List<object>();
            var occurrences = new Dictionary<string, int>();
            foreach (var row in rows)
            {
                var signature = Signature(row, Identity.Concat(Significant));
                var occurrence = occurrences.GetValueOrDefault(signature);
                occurrences[signature] = occurrence + 1;
                if (pairs.TryGetValue(row, out var old))
                {
                    if (LineKey(row).Length == 0) row["_scheduleLineId"] = LineKey(old);
                    if (Modified(old, row)) changed.Add(new { from = old, to = row });
                }
                else
                {
                    var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(signature)))[..24];
                    if (LineKey(row).Length == 0)
                    {
                        var id = $"line:{snapshot.Id}:{hash}:{occurrence}";
                        while (!usedIds.Add(id)) id = $"line:{snapshot.Id}:{hash}:{++occurrence}";
                        row["_scheduleLineId"] = id;
                    }
                    added.Add(row);
                }
            }
            foreach (var group in rows.GroupBy(LegacyKey))
                if (!legacyOwners.ContainsKey(group.Key))
                    legacyOwners[group.Key] = group.Count() == 1 ? LineKey(group.First()) : "";
            foreach (var group in rows.GroupBy(r => Field(r, "orderNo")))
                if (!productionOwners.ContainsKey(group.Key))
                    productionOwners[group.Key] = group.Select(LineKey).ToHashSet();
            foreach (var row in rows)
            {
                row["_legacyPlacedEligible"] = legacyOwners[LegacyKey(row)] == LineKey(row);
                row["_legacyProductionEligible"] = productionOwners[Field(row, "orderNo")].Contains(LineKey(row));
            }
            views.Add(new(snapshot, rows, new(added, previous.Where(remaining.Contains).ToList(), changed)));
            previousByCustomer[snapshot.Customer] = rows;
        }
        return views;
    }

    public static List<JsonObject> Parse(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return [];
        try
        {
            var rows = (JsonNode.Parse(raw) as JsonArray)?.OfType<JsonObject>().Select(r => (JsonObject)r.DeepClone()).ToList() ?? [];
            foreach (var row in rows)
                foreach (var key in row.Select(p => p.Key).Where(k => k.StartsWith("_schedule", StringComparison.Ordinal) || k.StartsWith("_legacy", StringComparison.Ordinal)).ToList())
                    row.Remove(key);
            return rows;
        }
        catch (JsonException) { return []; }
    }
}
