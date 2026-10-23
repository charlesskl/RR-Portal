using System.Text.Json;
using System.Text.Json.Nodes;
using IndoShipping.Api.Features.Schedules;
using Xunit;

namespace IndoShipping.Api.Tests;

public class ScheduleLineHistoryTests
{
    static JsonObject Row(int qty = 100, string eta = "2026-11-01", string orderDate = "2026-09-01") => new()
    {
        ["source"] = "KIK", ["customer"] = "TOMY", ["code"] = "47712A", ["orderNo"] = "MA",
        ["productName"] = "绿色拖拉机", ["qty"] = qty, ["eta"] = eta, ["orderDate"] = orderDate,
        ["unitPrice"] = 1.5,
    };
    static ScheduleLineHistory.Snapshot Snapshot(int id, string label, params JsonObject[] rows) =>
        new(id, label, new DateTime(2026, 10, 19), JsonSerializer.Serialize(rows));
    static string Id(JsonObject r) => ScheduleLineHistory.LineKey(r);
    static bool Eligible(JsonObject r) => r["_legacyPlacedEligible"]!.GetValue<bool>();

    [Fact]
    public void Interleaved_customers_compare_only_their_own_previous_period()
    {
        JsonObject Spin(int qty) { var row = Row(qty); row["customer"] = "Spin Master"; return row; }
        var views = ScheduleLineHistory.Build([
            Snapshot(1, "2026-W41", Row()),
            Snapshot(2, "2026-W41", Spin(100)) with { Customer = "Spin Master" },
            Snapshot(3, "2026-W42", Row(150)),
            Snapshot(4, "2026-W43", Spin(200)) with { Customer = "Spin Master" }
        ]).ToDictionary(v => v.Snapshot.Id);
        Assert.Empty(views[2].Diff.removed);
        Assert.Single(views[2].Diff.added);
        Assert.Equal(Id(views[1].Rows[0]), Id(views[3].Rows[0]));
        Assert.Equal(Id(views[2].Rows[0]), Id(views[4].Rows[0]));
        Assert.NotEqual(Id(views[1].Rows[0]), Id(views[2].Rows[0]));
        Assert.Single(views[3].Diff.changed);
        Assert.Single(views[4].Diff.changed);
        Assert.Empty(views[3].Diff.removed);
        Assert.Empty(views[4].Diff.added);
        // A legacy PO + code flag is not copied onto another customer's order.
        Assert.True(Eligible(views[1].Rows[0]));
        Assert.False(Eligible(views[2].Rows[0]));
    }

    [Fact]
    public void New_duplicate_is_added_and_does_not_inherit_old_flags()
    {
        var views = ScheduleLineHistory.Build([
            Snapshot(1, "2026-W42", Row()), Snapshot(2, "26-10-19", Row(), Row(200, "2026-12-01"))]);
        var current = views[1];
        Assert.Equal(Id(views[0].Rows[0]), Id(current.Rows[0]));
        Assert.NotEqual(Id(current.Rows[0]), Id(current.Rows[1]));
        Assert.True(Eligible(current.Rows[0]));
        Assert.False(Eligible(current.Rows[1]));
        Assert.False(current.Rows[1]["_legacyProductionEligible"]!.GetValue<bool>());
        Assert.Same(current.Rows[1], Assert.Single(current.Diff.added));
        Assert.Empty(current.Diff.changed);
        Assert.Empty(current.Diff.removed);
    }

    [Fact]
    public void Exact_match_is_reserved_even_when_new_row_comes_first()
    {
        var views = ScheduleLineHistory.Build([
            Snapshot(1, "2026-W42", Row()), Snapshot(2, "26-10-19", Row(200), Row())]);
        Assert.Equal(Id(views[0].Rows[0]), Id(views[1].Rows[1]));
        Assert.Same(views[1].Rows[0], Assert.Single(views[1].Diff.added));
        Assert.False(Eligible(views[1].Rows[0]));
    }

    [Fact]
    public void Identical_duplicate_occurrences_are_not_collapsed()
    {
        var views = ScheduleLineHistory.Build([
            Snapshot(1, "2026-W42", Row()), Snapshot(2, "26-10-19", Row(), Row()),
            Snapshot(3, "2026-W44", Row(), Row())]);
        Assert.Single(views[1].Diff.added);
        Assert.Equal(2, views[1].Rows.Select(Id).Distinct().Count());
        Assert.Empty(views[2].Diff.added);
        Assert.Equal(views[1].Rows.Select(Id), views[2].Rows.Select(Id));
    }

    [Fact]
    public void Removing_one_duplicate_is_detected()
    {
        var views = ScheduleLineHistory.Build([
            Snapshot(1, "2026-W42", Row(), Row(200)), Snapshot(2, "26-10-19", Row(200))]);
        Assert.Equal(Id(views[0].Rows[0]), Id(Assert.Single(views[1].Diff.removed)));
        Assert.Equal(Id(views[0].Rows[1]), Id(views[1].Rows[0]));
    }

    [Fact]
    public void Unique_quantity_and_eta_edit_retains_line_identity()
    {
        var views = ScheduleLineHistory.Build([
            Snapshot(1, "2026-W42", Row()), Snapshot(2, "26-10-19", Row(200, "2026-12-01"))]);
        Assert.Equal(Id(views[0].Rows[0]), Id(views[1].Rows[0]));
        Assert.Single(views[1].Diff.changed);
        Assert.Empty(views[1].Diff.added);
        Assert.True(Eligible(views[1].Rows[0]));
    }

    [Theory]
    [InlineData("customerPO", "new-po")]
    [InlineData("orderDate", "2026-10-19")]
    [InlineData("source", "RRM")]
    [InlineData("customer", "OTHER")]
    [InlineData("country", "美国")]
    [InlineData("endCustomer", "NEW CUSTOMER")]
    public void Different_order_identity_does_not_inherit_status(string field, string value)
    {
        var added = Row(); added[field] = value;
        var views = ScheduleLineHistory.Build([
            Snapshot(1, "2026-W42", Row()), Snapshot(2, "26-10-19", Row(), added)]);
        Assert.Single(views[1].Diff.added);
        Assert.False(Eligible(views[1].Rows[1]));
    }

    [Fact]
    public void Ambiguous_legacy_duplicates_are_not_all_marked_as_placed()
    {
        var view = Assert.Single(ScheduleLineHistory.Build([Snapshot(1, "2026-W42", Row(), Row(200))]));
        Assert.All(view.Rows, r => Assert.False(Eligible(r)));
    }

    [Fact]
    public void Ambiguous_changed_duplicates_are_not_guessed()
    {
        var views = ScheduleLineHistory.Build([
            Snapshot(1, "2026-W42", Row()), Snapshot(2, "26-10-19", Row(200), Row(300))]);
        Assert.Equal(2, views[1].Diff.added.Count);
        Assert.Single(views[1].Diff.removed);
        Assert.All(views[1].Rows, r => Assert.False(Eligible(r)));
    }

    [Fact]
    public void Mixed_labels_sort_by_period_not_lexically_or_upload_order()
    {
        var views = ScheduleLineHistory.Build([
            Snapshot(2, "26-10-19", Row()), Snapshot(1, "2026-W42", Row())]);
        Assert.Equal(1, views[0].Snapshot.Id);
        Assert.Empty(views[1].Diff.added);
        Assert.Equal(Id(views[0].Rows[0]), Id(views[1].Rows[0]));
    }

    [Fact]
    public void Removed_then_reintroduced_order_gets_a_new_identity()
    {
        var views = ScheduleLineHistory.Build([
            Snapshot(1, "2026-W42", Row()), Snapshot(2, "2026-W43"), Snapshot(3, "2026-W44", Row())]);
        Assert.NotEqual(Id(views[0].Rows[0]), Id(views[2].Rows[0]));
        Assert.False(Eligible(views[2].Rows[0]));
    }

    [Fact]
    public void First_period_quantity_edit_and_reorder_preserve_saved_ids_and_owners()
    {
        var original = Snapshot(1, "2026-W42", Row(), Row(200));
        var before = ScheduleLineHistory.Build([original]);
        var ledger = ScheduleLineHistory.Freeze(before);
        var replacement = Snapshot(1, "2026-W42", Row(200), Row(150));
        ledger.Snapshots[1] = ScheduleLineHistory.Replacement(replacement, before[0].Rows);
        var after = ScheduleLineHistory.Build([replacement], ledger);
        Assert.Equal(Id(before[0].Rows[1]), Id(after[0].Rows[0]));
        Assert.Equal(Id(before[0].Rows[0]), Id(after[0].Rows[1]));
        Assert.All(after[0].Rows, r => Assert.False(Eligible(r)));
    }

    [Fact]
    public void Earlier_backfill_cannot_take_frozen_ids_or_legacy_ownership()
    {
        var existing = new[] { Snapshot(1, "2026-W42", Row()), Snapshot(2, "2026-W43", Row()) };
        var before = ScheduleLineHistory.Build(existing);
        var ledger = ScheduleLineHistory.Freeze(before);
        var after = ScheduleLineHistory.Build(existing.Append(Snapshot(3, "2026-W41", Row())), ledger);
        Assert.Equal(Id(before[0].Rows[0]), Id(after[1].Rows[0]));
        Assert.Equal(Id(before[1].Rows[0]), Id(after[2].Rows[0]));
        Assert.Equal(Id(before[0].Rows[0]), Id(after[0].Rows[0]));
        Assert.True(Eligible(after[0].Rows[0]));
        Assert.True(after[0].Rows[0]["_legacyProductionEligible"]!.GetValue<bool>());
        Assert.True(Eligible(after[1].Rows[0]));
        Assert.True(after[1].Rows[0]["_legacyProductionEligible"]!.GetValue<bool>());
        Assert.All(after.Skip(1), view => { Assert.Empty(view.Diff.added); Assert.Empty(view.Diff.removed); Assert.Empty(view.Diff.changed); });
    }

    [Fact]
    public void Deleted_identity_is_not_reused_by_same_period_reintroduction()
    {
        var original = Snapshot(1, "2026-W42", Row());
        var before = ScheduleLineHistory.Build([original]);
        var ledger = ScheduleLineHistory.Freeze(before);
        var empty = Snapshot(1, "2026-W42");
        ledger.Snapshots[1] = ScheduleLineHistory.Replacement(empty, before[0].Rows);
        ledger = ScheduleLineHistory.Freeze(ScheduleLineHistory.Build([empty], ledger), ledger);
        ledger.Snapshots[1] = ScheduleLineHistory.Replacement(original, []);
        var restored = ScheduleLineHistory.Build([original], ledger);
        Assert.NotEqual(Id(before[0].Rows[0]), Id(restored[0].Rows[0]));
        Assert.False(Eligible(restored[0].Rows[0]));
        Assert.False(restored[0].Rows[0]["_legacyProductionEligible"]!.GetValue<bool>());
    }

    [Fact]
    public void New_exact_row_cannot_collide_with_identity_preserved_by_an_edit()
    {
        var before = ScheduleLineHistory.Build([Snapshot(1, "2026-W42", Row())]);
        var ledger = ScheduleLineHistory.Freeze(before);
        var edited = Snapshot(1, "2026-W42", Row(200));
        ledger.Snapshots[1] = ScheduleLineHistory.Replacement(edited, before[0].Rows);
        var current = ScheduleLineHistory.Build([edited], ledger);
        ledger = ScheduleLineHistory.Freeze(current, ledger);
        var added = Snapshot(1, "2026-W42", Row(200), Row());
        ledger.Snapshots[1] = ScheduleLineHistory.Replacement(added, current[0].Rows);
        var after = ScheduleLineHistory.Build([added], ledger);
        Assert.Equal(Id(before[0].Rows[0]), Id(after[0].Rows[0]));
        Assert.NotEqual(Id(after[0].Rows[0]), Id(after[0].Rows[1]));
        Assert.False(Eligible(after[0].Rows[1]));
    }

    [Fact]
    public void Same_period_delete_and_restore_cannot_revive_an_id_from_an_earlier_period()
    {
        var first = Snapshot(1, "2026-W42", Row());
        var second = Snapshot(2, "2026-W43", Row());
        var before = ScheduleLineHistory.Build([first, second]);
        var ledger = ScheduleLineHistory.Freeze(before);
        var empty = Snapshot(2, "2026-W43");
        ledger.Snapshots[2] = ScheduleLineHistory.Replacement(empty, before[1].Rows);
        var removed = ScheduleLineHistory.Build([first, empty], ledger);
        ledger = ScheduleLineHistory.Freeze(removed, ledger);
        ledger.Snapshots[2] = ScheduleLineHistory.Replacement(second, []);
        var restored = ScheduleLineHistory.Build([first, second], ledger);
        Assert.NotEqual(Id(before[1].Rows[0]), Id(restored[1].Rows[0]));
        Assert.False(Eligible(restored[1].Rows[0]));
        Assert.False(restored[1].Rows[0]["_legacyProductionEligible"]!.GetValue<bool>());
        Assert.Single(restored[1].Diff.added);
        Assert.Single(restored[1].Diff.removed);
        var reread = ScheduleLineHistory.Build([first, second], ScheduleLineHistory.Freeze(restored, ledger));
        Assert.Equal(Id(restored[1].Rows[0]), Id(reread[1].Rows[0]));
        Assert.Single(reread[1].Diff.added);
        Assert.Single(reread[1].Diff.removed);
    }

    [Fact]
    public void Stale_ledger_is_rejected_and_client_identity_metadata_is_ignored()
    {
        var original = Snapshot(1, "2026-W42", Row());
        var ledger = ScheduleLineHistory.Freeze(ScheduleLineHistory.Build([original]));
        Assert.Throws<InvalidOperationException>(() => ScheduleLineHistory.Build([Snapshot(1, "2026-W42", Row(200))], ledger));
        var forged = Row(); forged["_scheduleLineId"] = "line:forged";
        forged["_legacyPlacedEligible"] = false; forged["_legacyProductionEligible"] = false;
        var actual = ScheduleLineHistory.Build([Snapshot(1, "2026-W42", forged)])[0].Rows[0];
        Assert.NotEqual("line:forged", Id(actual));
        Assert.True(Eligible(actual));
        Assert.DoesNotContain(ScheduleLineHistory.Parse(JsonSerializer.Serialize(new[] { forged }))[0], p => p.Key.StartsWith("_schedule") || p.Key.StartsWith("_legacy"));
    }

    [Fact]
    public void Backfill_does_not_cross_an_empty_period_or_calendar_gap()
    {
        var existing = new[] { Snapshot(1, "2026-W42"), Snapshot(2, "2026-W43", Row()) };
        var before = ScheduleLineHistory.Build(existing);
        var ledger = ScheduleLineHistory.Freeze(before);
        var after = ScheduleLineHistory.Build(existing.Append(Snapshot(3, "2026-W41", Row())), ledger);
        Assert.NotEqual(Id(after[0].Rows[0]), Id(after[2].Rows[0]));
        Assert.False(Eligible(after[0].Rows[0]));
        var onlyLater = new[] { Snapshot(2, "2026-W43", Row()) };
        var laterLedger = ScheduleLineHistory.Freeze(ScheduleLineHistory.Build(onlyLater));
        var gap = ScheduleLineHistory.Build(onlyLater.Append(Snapshot(3, "2026-W41", Row())), laterLedger);
        Assert.NotEqual(Id(gap[0].Rows[0]), Id(gap[1].Rows[0]));
    }

    [Fact]
    public void Backfill_cannot_merge_two_established_identities()
    {
        var existing = new[] { Snapshot(1, "2026-W40", Row()), Snapshot(2, "2026-W41"), Snapshot(3, "2026-W44", Row()) };
        var before = ScheduleLineHistory.Build(existing);
        var ledger = ScheduleLineHistory.Freeze(before);
        // First extend the earlier identity to W42; W44's identity remains a separate order.
        var firstFill = existing.Append(Snapshot(4, "2026-W42", Row())).ToArray();
        var intermediate = ScheduleLineHistory.Build(firstFill, ledger);
        ledger = ScheduleLineHistory.Freeze(intermediate, ledger);
        var final = ScheduleLineHistory.Build(firstFill.Append(Snapshot(5, "2026-W43", Row())), ledger);
        var current = final.Single(v => v.Snapshot.Id == 5);
        Assert.Equal(Id(intermediate.Single(v => v.Snapshot.Id == 4).Rows[0]), Id(current.Rows[0]));
        Assert.NotEqual(Id(current.Rows[0]), Id(final.Single(v => v.Snapshot.Id == 3).Rows[0]));
        Assert.Equal(Id(before[2].Rows[0]), Id(final.Single(v => v.Snapshot.Id == 3).Rows[0]));
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void Backfill_does_not_guess_among_identical_duplicate_occurrences(bool duplicatesInBackfill)
    {
        var next = duplicatesInBackfill ? Snapshot(1, "2026-W42", Row()) : Snapshot(1, "2026-W42", Row(), Row());
        var before = ScheduleLineHistory.Build([next]);
        var ledger = ScheduleLineHistory.Freeze(before);
        var earlier = duplicatesInBackfill ? Snapshot(2, "2026-W41", Row(), Row()) : Snapshot(2, "2026-W41", Row());
        var after = ScheduleLineHistory.Build([next, earlier], ledger);
        Assert.DoesNotContain(after[0].Rows, r => before[0].Rows.Any(old => Id(old) == Id(r)));
        Assert.All(after[0].Rows, r => Assert.False(Eligible(r)));
    }

    [Fact]
    public void Backfill_cannot_ignore_a_pending_replacement_duplicate_when_counting_exact_candidates()
    {
        var original = Snapshot(1, "2026-W42", Row());
        var before = ScheduleLineHistory.Build([original]);
        var ledger = ScheduleLineHistory.Freeze(before);
        var replacement = Snapshot(1, "2026-W42", Row(), Row());
        ledger.Snapshots[1] = ScheduleLineHistory.Replacement(replacement, before[0].Rows);
        var after = ScheduleLineHistory.Build([replacement, Snapshot(2, "2026-W41", Row())], ledger);
        Assert.DoesNotContain(after[1].Rows, row => Id(row) == Id(after[0].Rows[0]));
        Assert.Equal(Id(before[0].Rows[0]), Id(after[1].Rows[0]));
    }
}
