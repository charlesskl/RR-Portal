using System.Text.Json;
using Dapper;
using IndoShipping.Api.Controllers;
using IndoShipping.Api.Features.Bootstrap;
using IndoShipping.Infrastructure.Persistence;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Http;
using Npgsql;
using Xunit;

namespace IndoShipping.Api.Tests;

public class MaterialCompletionIntegrationTests
{
    [Theory]
    [InlineData("text")]
    [InlineData("json")]
    [InlineData("jsonb")]
    public async Task History_capture_supports_legacy_schedule_storage_and_preserves_completion_hash(string storageType)
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        await f.Db.ExecuteAsync($"ALTER TABLE schedules ALTER COLUMN raw_rows TYPE {storageType} USING raw_rows::{storageType}");
        await f.Acknowledge();
        var original = await f.Db.ExecuteScalarAsync<string>("SELECT raw_rows::text FROM schedules WHERE id=1");
        await using (var tx = await f.Db.BeginTransactionAsync())
        {
            await MaterialTrackingHistory.CaptureAsync(f.Db, tx);
            await tx.CommitAsync();
        }
        Assert.Equal(original, await f.Db.ExecuteScalarAsync<string>("SELECT raw_rows::text FROM schedules WHERE id=1"));
        Assert.True(await f.Db.ExecuteScalarAsync<bool>("SELECT acknowledged FROM material_tracking_history WHERE schedule_id=1 ORDER BY id DESC LIMIT 1"));
        Assert.Equal(await f.Db.ExecuteScalarAsync<string>("SELECT md5(raw_rows::text) FROM schedules WHERE id=1"),
            await f.Db.ExecuteScalarAsync<string>("SELECT rows_hash FROM material_tracking_history WHERE schedule_id=1 ORDER BY id DESC LIMIT 1"));
    }

    [Fact]
    public async Task Quantity_corrections_follow_actual_increases_decreases_and_reediting_without_compounding()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        await f.Upload("10-10", """[{"code":"A","orderNo":"PO1","qty":500}]""");
        var body = await f.Adjustment(Purchase(await f.Read()));
        body.ordered_qty = 100; body.received_qty = 100; body.outbound_qty = 100;
        Assert.IsType<OkObjectResult>(await f.Alerts.SaveAdjustment(body));
        await f.Db.ExecuteAsync("INSERT INTO po_items VALUES(1,1,50,50); INSERT INTO po_receipts VALUES(1,50); INSERT INTO outbound VALUES(1,50)");
        var item = Purchase(await f.Read());
        foreach (var field in new[] { "ordered_qty", "received_qty", "outbound_qty" })
        {
            Assert.Equal(150, item.GetProperty(field).GetDecimal());
            Assert.Equal(150, item.GetProperty("order_details")[0].GetProperty(field).GetDecimal());
        }
        Assert.Equal(850, item.GetProperty("shortage_qty").GetDecimal());
        // Resaving the displayed total retains +100, it must not add another +150.
        body = await f.Adjustment(item); body.ordered_qty = 150; body.received_qty = 150; body.outbound_qty = 150;
        Assert.IsType<OkObjectResult>(await f.Alerts.SaveAdjustment(body));
        await f.Db.ExecuteAsync("UPDATE po_items SET purchase_qty=75, qty=75; UPDATE po_receipts SET qty=75; UPDATE outbound SET qty=75");
        item = Purchase(await f.Read());
        Assert.Equal(175, item.GetProperty("received_qty").GetDecimal());
        await f.Db.ExecuteAsync("UPDATE po_items SET purchase_qty=25, qty=25; UPDATE po_receipts SET qty=25; UPDATE outbound SET qty=25");
        item = Purchase(await f.Read());
        Assert.Equal(125, item.GetProperty("received_qty").GetDecimal());
        Assert.Equal(125, item.GetProperty("ordered_qty").GetDecimal());
        Assert.Equal(125, item.GetProperty("outbound_qty").GetDecimal());
        Assert.Equal(25, await f.Db.ExecuteScalarAsync<decimal>("SELECT SUM(qty) FROM po_receipts"));
        body = await f.Adjustment(item); body.reset = true;
        Assert.IsType<OkObjectResult>(await f.Alerts.SaveAdjustment(body));
        Assert.Equal(25, Purchase(await f.Read()).GetProperty("received_qty").GetDecimal());
    }

    [Fact]
    public async Task Negative_correction_and_explicit_zero_follow_future_actuals_without_negative_tracking()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        await f.Upload("10-10", """[{"code":"A","orderNo":"PO1","qty":500}]""");
        await f.Db.ExecuteAsync("INSERT INTO po_items VALUES(1,1,100,100); INSERT INTO po_receipts VALUES(1,100)");
        var body = await f.Adjustment(Purchase(await f.Read())); body.received_qty = 0;
        Assert.IsType<OkObjectResult>(await f.Alerts.SaveAdjustment(body));
        await f.Db.ExecuteAsync("UPDATE po_receipts SET qty=150");
        Assert.Equal(50, Purchase(await f.Read()).GetProperty("received_qty").GetDecimal());
        await f.Db.ExecuteAsync("UPDATE po_receipts SET qty=25");
        Assert.Equal(0, Purchase(await f.Read()).GetProperty("received_qty").GetDecimal());
        // Clamping display to zero must not discard the persisted -100 correction.
        await f.Db.ExecuteAsync("UPDATE po_receipts SET qty=175");
        Assert.Equal(75, Purchase(await f.Read()).GetProperty("received_qty").GetDecimal());
    }

    [Fact]
    public async Task Clamped_negative_corrections_survive_note_edits_and_still_allow_changes_clearing_and_reset()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        await f.Upload("10-10", """[{"code":"A","orderNo":"PO1","qty":50}]""");
        await f.Acknowledge();
        await f.Db.ExecuteAsync("INSERT INTO po_items VALUES(1,1,100,100); INSERT INTO po_receipts VALUES(1,100); INSERT INTO outbound VALUES(1,100)");
        var body = await f.Adjustment(Purchase(await f.Read()));
        body.required_qty = 0; body.ordered_qty = 0; body.received_qty = 0; body.outbound_qty = 0; body.manual_qty = 0;
        Assert.IsType<OkObjectResult>(await f.Alerts.SaveAdjustment(body));

        await f.Upload("10-10", """[{"code":"A","orderNo":"PO1","qty":12.5}]""");
        await f.Acknowledge();
        await f.Db.ExecuteAsync("UPDATE po_items SET purchase_qty=25,qty=25; UPDATE po_receipts SET qty=25; UPDATE outbound SET qty=25");
        var item = Purchase(await f.Read());
        body = await f.FormAdjustment(item); body.note = "只补充原因，不改变数量";
        Assert.IsType<OkObjectResult>(await f.Alerts.SaveAdjustment(body));
        item = Purchase(await f.Read());
        var adjustment = item.GetProperty("order_details")[0].GetProperty("adjustment");
        Assert.Equal(-100, adjustment.GetProperty("required_delta").GetDecimal());
        foreach (var field in new[] { "ordered_base", "received_base", "outbound_base", "manual_base" })
            Assert.Equal(100, adjustment.GetProperty(field).GetDecimal());

        await f.Upload("10-10", """[{"code":"A","orderNo":"PO1","qty":87.5}]""");
        await f.Acknowledge();
        await f.Db.ExecuteAsync("UPDATE po_items SET purchase_qty=175,qty=175; UPDATE po_receipts SET qty=175; UPDATE outbound SET qty=175");
        item = Purchase(await f.Read());
        Assert.Equal(75, item.GetProperty("required_qty").GetDecimal());
        foreach (var field in new[] { "ordered_qty", "received_qty", "outbound_qty", "manual_qty" })
            Assert.Equal(75, item.GetProperty("order_details")[0].GetProperty(field).GetDecimal());
        Assert.Equal(175, await f.Db.ExecuteScalarAsync<decimal>("SELECT SUM(qty) FROM po_receipts"));

        // A changed number establishes a new baseline; untouched numbers keep
        // their original -100 correction, including the clamped demand field.
        body = await f.FormAdjustment(item); body.received_qty = 80;
        Assert.IsType<OkObjectResult>(await f.Alerts.SaveAdjustment(body));
        await f.Upload("10-10", """[{"code":"A","orderNo":"PO1","qty":100}]""");
        await f.Acknowledge();
        await f.Db.ExecuteAsync("UPDATE po_items SET purchase_qty=200,qty=200; UPDATE po_receipts SET qty=200; UPDATE outbound SET qty=200");
        item = Purchase(await f.Read());
        Assert.Equal(100, item.GetProperty("required_qty").GetDecimal());
        Assert.Equal(105, item.GetProperty("received_qty").GetDecimal());
        body = await f.FormAdjustment(item); body.received_qty = null;
        Assert.IsType<OkObjectResult>(await f.Alerts.SaveAdjustment(body));
        item = Purchase(await f.Read());
        Assert.Equal(200, item.GetProperty("received_qty").GetDecimal());
        Assert.Equal(100, item.GetProperty("required_qty").GetDecimal());
        body = await f.FormAdjustment(item); body.required_qty = null;
        Assert.IsType<OkObjectResult>(await f.Alerts.SaveAdjustment(body));
        item = Purchase(await f.Read());
        Assert.Equal(200, item.GetProperty("required_qty").GetDecimal());
        var version = item.GetProperty("order_details")[0].GetProperty("adjustment_version").GetInt64();
        body = await f.FormAdjustment(item); body.reset = true;
        Assert.IsType<OkObjectResult>(await f.Alerts.SaveAdjustment(body));
        item = Purchase(await f.Read());
        Assert.False(item.GetProperty("has_adjustments").GetBoolean());
        Assert.Equal(version + 1, item.GetProperty("order_details")[0].GetProperty("adjustment_version").GetInt64());
        Assert.Equal(200, item.GetProperty("required_qty").GetDecimal());
        Assert.Equal(200, item.GetProperty("received_qty").GetDecimal());
    }

    [Fact]
    public async Task Completed_status_note_edits_do_not_confirm_new_demand_and_audit_effective_quantities()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        var body = await f.Adjustment(Purchase(await f.Read())); body.status = "已送完";
        Assert.IsType<OkObjectResult>(await f.Alerts.SaveAdjustment(body));
        await f.Upload("10-10", """[{"code":"A","orderNo":"PO1","qty":15}]""");
        var item = Purchase(await f.Read());
        body = await f.FormAdjustment(item); body.note = "需求增加后仅修改备注";
        Assert.IsType<OkObjectResult>(await f.Alerts.SaveAdjustment(body));
        item = Purchase(await f.Read());
        Assert.Equal(20, item.GetProperty("order_details")[0].GetProperty("manual_qty").GetDecimal());
        Assert.Equal(10, item.GetProperty("shortage_qty").GetDecimal());
        Assert.NotEqual("covered", item.GetProperty("status").GetString());

        // A source confirmation adds 30 to the original +20 correction. The
        // audit must record the displayed 50, not the stored override of 20.
        await f.Acknowledge();
        item = Purchase(await f.Read());
        body = await f.FormAdjustment(item); body.note = "仅修改备注，保留已有确认修正";
        Assert.IsType<OkObjectResult>(await f.Alerts.SaveAdjustment(body));
        using (var audit = JsonDocument.Parse((await f.Db.ExecuteScalarAsync<string>("SELECT details::text FROM audit_logs ORDER BY id DESC LIMIT 1"))!))
        {
            Assert.Equal(20, audit.RootElement.GetProperty("after").GetProperty("manual_qty").GetDecimal());
            Assert.Equal(50, audit.RootElement.GetProperty("current").GetProperty("manual_qty").GetDecimal());
        }
        await f.Upload("10-10", """[{"code":"A","orderNo":"PO1","qty":40}]""");
        item = Purchase(await f.Read());
        body = await f.FormAdjustment(item); body.note = "再次增加需求仍仅补充备注";
        Assert.IsType<OkObjectResult>(await f.Alerts.SaveAdjustment(body));
        item = Purchase(await f.Read());
        Assert.Equal(50, item.GetProperty("order_details")[0].GetProperty("manual_qty").GetDecimal());
        Assert.Equal(30, item.GetProperty("shortage_qty").GetDecimal());

        // A genuine transition to completion still confirms the current demand.
        body = await f.FormAdjustment(item); body.status = "部分已送完";
        Assert.IsType<OkObjectResult>(await f.Alerts.SaveAdjustment(body));
        body = await f.FormAdjustment(Purchase(await f.Read())); body.status = "已送完";
        Assert.IsType<OkObjectResult>(await f.Alerts.SaveAdjustment(body));
        item = Purchase(await f.Read());
        Assert.Equal(80, item.GetProperty("order_details")[0].GetProperty("manual_qty").GetDecimal());
        Assert.Equal("covered", item.GetProperty("status").GetString());
    }

    [Fact]
    public async Task Legacy_fixed_quantity_keeps_null_baseline_on_note_edit_and_audits_after_rebasing()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        await f.Upload("10-10", """[{"code":"A","orderNo":"PO1","qty":500}]""");
        await f.Db.ExecuteAsync("INSERT INTO po_items VALUES(1,1,25,25); INSERT INTO po_receipts VALUES(1,25)");
        var body = await f.Adjustment(Purchase(await f.Read()));
        var value = JsonSerializer.Serialize(new Dictionary<string, MaterialAlertsController.TrackingAdjustment> {
            [body.order_key] = new() { version = 1, active = true, received_qty = 100, note = "旧版固定数量" }
        });
        await f.Db.ExecuteAsync("INSERT INTO settings VALUES('material_tracking_order_adjustments',@value)", new { value });
        body = await f.FormAdjustment(Purchase(await f.Read())); body.note = "仅修改旧版备注";
        Assert.IsType<OkObjectResult>(await f.Alerts.SaveAdjustment(body));
        Assert.Equal(JsonValueKind.Null, Purchase(await f.Read()).GetProperty("order_details")[0]
            .GetProperty("adjustment").GetProperty("received_base").ValueKind);
        await f.Db.ExecuteAsync("UPDATE po_receipts SET qty=175");
        Assert.Equal(100, Purchase(await f.Read()).GetProperty("received_qty").GetDecimal());

        body = await f.FormAdjustment(Purchase(await f.Read())); body.received_qty = 120;
        Assert.IsType<OkObjectResult>(await f.Alerts.SaveAdjustment(body));
        await f.Db.ExecuteAsync("UPDATE po_receipts SET qty=200");
        var item = Purchase(await f.Read());
        Assert.Equal(145, item.GetProperty("received_qty").GetDecimal());
        body = await f.FormAdjustment(item); body.note = "只补备注，审计记录有效数量";
        Assert.IsType<OkObjectResult>(await f.Alerts.SaveAdjustment(body));
        using (var audit = JsonDocument.Parse((await f.Db.ExecuteScalarAsync<string>("SELECT details::text FROM audit_logs ORDER BY id DESC LIMIT 1"))!))
        {
            Assert.Equal(120, audit.RootElement.GetProperty("after").GetProperty("received_qty").GetDecimal());
            Assert.Equal(145, audit.RootElement.GetProperty("current").GetProperty("received_qty").GetDecimal());
        }
    }

    [Fact]
    public async Task Existing_partial_label_allows_note_edits_after_demand_drops_but_new_changes_are_validated()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        await f.Upload("10-10", """[{"code":"A","orderNo":"PO1","qty":50}]""");
        var body = await f.Adjustment(Purchase(await f.Read())); body.status = "部分已送完"; body.manual_qty = 50;
        Assert.IsType<OkObjectResult>(await f.Alerts.SaveAdjustment(body));
        await f.Upload("10-10", """[{"code":"A","orderNo":"PO1","qty":20}]""");
        var item = Purchase(await f.Read());
        body = await f.FormAdjustment(item); body.note = "需求下降后只补充备注";
        Assert.IsType<OkObjectResult>(await f.Alerts.SaveAdjustment(body));
        item = Purchase(await f.Read());
        Assert.Equal("covered", item.GetProperty("status").GetString());
        Assert.Equal(50, item.GetProperty("order_details")[0].GetProperty("manual_qty").GetDecimal());
        Assert.Equal("部分已送完", item.GetProperty("order_details")[0].GetProperty("adjustment").GetProperty("status").GetString());
        body = await f.FormAdjustment(item); body.manual_qty = 60;
        Assert.IsType<BadRequestObjectResult>(await f.Alerts.SaveAdjustment(body));
        body = await f.FormAdjustment(item); body.required_qty = 30;
        Assert.IsType<BadRequestObjectResult>(await f.Alerts.SaveAdjustment(body));
        body = await f.FormAdjustment(item); body.status = null;
        Assert.IsType<OkObjectResult>(await f.Alerts.SaveAdjustment(body));
        body = await f.FormAdjustment(Purchase(await f.Read())); body.status = "部分已送完";
        Assert.IsType<BadRequestObjectResult>(await f.Alerts.SaveAdjustment(body));
        body.manual_qty = 20;
        Assert.IsType<OkObjectResult>(await f.Alerts.SaveAdjustment(body));
        Assert.NotEqual("covered", Purchase(await f.Read()).GetProperty("status").GetString());

        await f.Upload("10-10", """[{"code":"A","orderNo":"PO1","qty":5}]""");
        item = Purchase(await f.Read());
        body = await f.FormAdjustment(item); body.reset = true;
        Assert.IsType<OkObjectResult>(await f.Alerts.SaveAdjustment(body));
        item = Purchase(await f.Read());
        Assert.False(item.GetProperty("has_adjustments").GetBoolean());
        Assert.Equal(10, item.GetProperty("required_qty").GetDecimal());
        Assert.Equal(0, item.GetProperty("order_details")[0].GetProperty("manual_qty").GetDecimal());
    }

    [Fact]
    public async Task Changed_actual_allocation_rejects_stale_correction_baseline()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        var body = await f.Adjustment(Purchase(await f.Read())); body.received_qty = 100;
        await f.Db.ExecuteAsync("INSERT INTO po_items VALUES(1,1,5,5); INSERT INTO po_receipts VALUES(1,5)");
        Assert.IsType<ConflictObjectResult>(await f.Alerts.SaveAdjustment(body));
        Assert.Equal(0, await f.Db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM audit_logs"));
    }

    [Fact]
    public async Task Adjustment_history_preserves_actor_reason_snapshots_and_reset_without_cross_order_leakage()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        f.Alerts.HttpContext.User = new System.Security.Claims.ClaimsPrincipal(new System.Security.Claims.ClaimsIdentity(
            new[] { new System.Security.Claims.Claim(System.Security.Claims.ClaimTypes.Name, "测试操作员") }, "test"));
        var body = await f.Adjustment(Purchase(await f.Read())); body.received_qty = 100; body.note = "补录历史收货";
        Assert.IsType<OkObjectResult>(await f.Alerts.SaveAdjustment(body));
        var reset = await f.Adjustment(Purchase(await f.Read())); reset.reset = true; reset.note = "恢复原始统计";
        Assert.IsType<OkObjectResult>(await f.Alerts.SaveAdjustment(reset));
        var history = JsonSerializer.SerializeToElement(Assert.IsType<OkObjectResult>(await f.Alerts.AdjustmentHistory(body.order_key)).Value);
        Assert.Equal(2, history.GetProperty("total").GetInt32());
        var rows = history.GetProperty("items");
        Assert.Equal("reset-adjustment", rows[0].GetProperty("action").GetString());
        Assert.Equal(100, rows[0].GetProperty("details").GetProperty("previous").GetProperty("received_qty").GetDecimal());
        Assert.Equal(0, rows[0].GetProperty("details").GetProperty("current").GetProperty("received_qty").GetDecimal());
        Assert.Equal("测试操作员", rows[1].GetProperty("username").GetString());
        Assert.Equal("补录历史收货", rows[1].GetProperty("details").GetProperty("after").GetProperty("note").GetString());
        Assert.Equal(100, rows[1].GetProperty("details").GetProperty("current").GetProperty("received_qty").GetDecimal());
        Assert.Equal(0, rows[1].GetProperty("details").GetProperty("source").GetProperty("received_qty").GetDecimal());
        Assert.False(string.IsNullOrEmpty(rows[1].GetProperty("occurred_at").GetString()));
        history = JsonSerializer.SerializeToElement(Assert.IsType<OkObjectResult>(await f.Alerts.AdjustmentHistory("other-order")).Value);
        Assert.Equal(0, history.GetProperty("total").GetInt32());
        history = JsonSerializer.SerializeToElement(Assert.IsType<OkObjectResult>(await f.Alerts.AdjustmentHistory(body.order_key, 2)).Value);
        Assert.Empty(history.GetProperty("items").EnumerateArray());
    }

    [Fact]
    public async Task Tracking_quantities_are_persisted_separately_and_do_not_change_business_records()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        await f.AddLeadProfiles();
        var before = Purchase(await f.Read());
        var body = await f.Adjustment(before);
        body.required_qty = 30; body.ordered_qty = 25; body.received_qty = 15; body.outbound_qty = 12; body.manual_qty = 10;
        body.status = "部分入库";
        Assert.IsType<OkObjectResult>(await f.Alerts.SaveAdjustment(body));
        var item = Purchase(await f.Read());
        Assert.True(item.GetProperty("has_adjustments").GetBoolean());
        Assert.Equal(30, item.GetProperty("required_qty").GetDecimal());
        Assert.Equal(25, item.GetProperty("ordered_qty").GetDecimal());
        Assert.Equal(15, item.GetProperty("received_qty").GetDecimal());
        Assert.Equal(12, item.GetProperty("outbound_qty").GetDecimal());
        Assert.Equal(18, item.GetProperty("shortage_qty").GetDecimal());
        Assert.Equal(20, item.GetProperty("source_required_qty").GetDecimal());
        Assert.Equal(0, item.GetProperty("source_received_qty").GetDecimal());
        Assert.Equal("部分入库(手动)", item.GetProperty("order_details")[0].GetProperty("status").GetString());
        foreach (var table in new[] { "po_items", "po_receipts", "outbound" })
            Assert.Equal(0, await f.Db.ExecuteScalarAsync<int>($"SELECT COUNT(*) FROM {table}"));
        Assert.Equal(2, await f.Db.ExecuteScalarAsync<decimal>("SELECT usage_qty FROM materials WHERE id=1"));
        Assert.Equal(1, await f.Db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM audit_logs"));
        Assert.False((await f.Read())[1].GetProperty("has_adjustments").GetBoolean());
    }

    [Fact]
    public async Task Manual_completion_stops_risk_but_new_demand_stays_open_and_history_is_unchanged()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        await f.AddLeadProfiles();
        var revision = await f.Db.ExecuteScalarAsync<long>("SELECT MAX(id) FROM material_tracking_history");
        var body = await f.Adjustment(Purchase(await f.Read())); body.status = "已送完";
        Assert.IsType<OkObjectResult>(await f.Alerts.SaveAdjustment(body));
        var item = Purchase(await f.Read());
        Assert.Equal("covered", item.GetProperty("status").GetString());
        Assert.Equal(0, item.GetProperty("shortage_qty").GetDecimal());
        Assert.Equal(JsonValueKind.Null, item.GetProperty("due_date").ValueKind);
        Assert.Equal(0, item.GetProperty("received_qty").GetDecimal());
        Assert.False(Purchase(await f.Read(revision)).GetProperty("has_adjustments").GetBoolean());
        Assert.Equal(20, Purchase(await f.Read(revision)).GetProperty("shortage_qty").GetDecimal());
        await f.Upload("10-10", """[{"code":"A","orderNo":"PO1","qty":15}]""");
        item = Purchase(await f.Read());
        Assert.NotEqual("covered", item.GetProperty("status").GetString());
        Assert.Equal(10, item.GetProperty("shortage_qty").GetDecimal());
        Assert.Equal("部分已送完(手动)", item.GetProperty("order_details")[0].GetProperty("status").GetString());
        var restore = await f.Adjustment(item); restore.reset = true;
        Assert.IsType<OkObjectResult>(await f.Alerts.SaveAdjustment(restore));
        item = Purchase(await f.Read());
        Assert.False(item.GetProperty("has_adjustments").GetBoolean());
        Assert.Equal(30, item.GetProperty("shortage_qty").GetDecimal());
        Assert.Equal(2, item.GetProperty("order_details")[0].GetProperty("adjustment_version").GetInt64());
        Assert.IsType<ConflictObjectResult>(await f.Alerts.SaveAdjustment(body));
    }

    [Fact]
    public async Task Demand_correction_is_relative_and_status_only_does_not_fake_stock_or_complete()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        var body = await f.Adjustment(Purchase(await f.Read())); body.required_qty = 25; body.status = "已入库";
        Assert.IsType<OkObjectResult>(await f.Alerts.SaveAdjustment(body));
        await f.Upload("10-10", """[{"code":"A","orderNo":"PO1","qty":15}]""");
        var item = Purchase(await f.Read());
        Assert.Equal(35, item.GetProperty("required_qty").GetDecimal());
        Assert.Equal(35, item.GetProperty("shortage_qty").GetDecimal());
        Assert.Equal(0, item.GetProperty("received_qty").GetDecimal());
        Assert.NotEqual("covered", item.GetProperty("status").GetString());
    }

    [Fact]
    public async Task Adjusting_one_order_does_not_change_other_orders_fifo_allocation()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        await f.Upload("10-10", """[{"code":"A","orderNo":"PO1","qty":10},{"code":"A","orderNo":"PO2","qty":10}]""");
        await f.Db.ExecuteAsync("INSERT INTO po_items VALUES(1,1,25,25); INSERT INTO po_receipts VALUES(1,25); INSERT INTO outbound VALUES(1,22)");
        var before = Purchase(await f.Read());
        var second = before.GetProperty("order_details")[1].GetRawText();
        var body = await f.Adjustment(before); body.required_qty = 30; body.outbound_qty = 0;
        Assert.IsType<OkObjectResult>(await f.Alerts.SaveAdjustment(body));
        var after = Purchase(await f.Read());
        Assert.Equal(second, after.GetProperty("order_details")[1].GetRawText());
        Assert.Equal(22, after.GetProperty("source_outbound_qty").GetDecimal());
        Assert.Equal(22, await f.Db.ExecuteScalarAsync<decimal>("SELECT SUM(qty) FROM outbound"));
    }

    [Fact]
    public async Task Adjustment_validation_rejects_invalid_stale_or_missing_targets()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        var item = Purchase(await f.Read());
        var body = await f.Adjustment(item); body.ordered_qty = -1;
        Assert.IsType<BadRequestObjectResult>(await f.Alerts.SaveAdjustment(body));
        body = await f.Adjustment(item); body.status = "不存在";
        Assert.IsType<BadRequestObjectResult>(await f.Alerts.SaveAdjustment(body));
        body = await f.Adjustment(item); body.status = "部分已送完"; body.manual_qty = 20;
        Assert.IsType<BadRequestObjectResult>(await f.Alerts.SaveAdjustment(body));
        body = await f.Adjustment(item); body.status = "已排产";
        Assert.IsType<BadRequestObjectResult>(await f.Alerts.SaveAdjustment(body));
        body = await f.Adjustment(item); body.order_key = "missing";
        Assert.IsType<NotFoundObjectResult>(await f.Alerts.SaveAdjustment(body));
        body = await f.Adjustment(item); body.expected_source_required = 999;
        Assert.IsType<ConflictObjectResult>(await f.Alerts.SaveAdjustment(body));
        body = await f.Adjustment(item);
        await f.Upload("10-10", """[{"code":"A","orderNo":"PO1","qty":15}]""");
        Assert.IsType<ConflictObjectResult>(await f.Alerts.SaveAdjustment(body));
    }

    [Fact]
    public async Task Production_status_and_explicit_zero_can_be_adjusted_and_restored()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        await f.Acknowledge();
        var item = (await f.Read()).EnumerateArray().Single(x => x.GetProperty("tracking_type").GetString() == "plastic");
        var body = await f.Adjustment(item); body.status = "未排产"; body.manual_qty = 0; body.ordered_qty = 0;
        Assert.IsType<OkObjectResult>(await f.Alerts.SaveAdjustment(body));
        item = (await f.Read()).EnumerateArray().Single(x => x.GetProperty("tracking_type").GetString() == "plastic");
        Assert.NotEqual("covered", item.GetProperty("status").GetString());
        Assert.Equal(10, item.GetProperty("shortage_qty").GetDecimal());
        Assert.Equal("未排产(手动)", item.GetProperty("order_details")[0].GetProperty("status").GetString());
        body = await f.Adjustment(item); body.reset = true;
        Assert.IsType<OkObjectResult>(await f.Alerts.SaveAdjustment(body));
        Assert.All((await f.Read()).EnumerateArray(), row => Assert.Equal("covered", row.GetProperty("status").GetString()));
    }

    [Fact]
    public async Task Concurrent_adjustments_conflict_instead_of_overwriting_each_other()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        var item = Purchase(await f.Read());
        var first = await f.Adjustment(item); first.ordered_qty = 3;
        var second = await f.Adjustment(item); second.ordered_qty = 7;
        var results = await Task.WhenAll(f.Alerts.SaveAdjustment(first), f.Alerts.SaveAdjustment(second));
        Assert.Single(results.OfType<OkObjectResult>());
        Assert.Single(results.OfType<ConflictObjectResult>());
        Assert.Equal(1, await f.Db.ExecuteScalarAsync<int>("SELECT COUNT(*) FROM audit_logs"));
    }

    [Fact]
    public async Task Manual_completion_uses_exact_quantity_and_does_not_hide_small_extra_demand()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        await f.AddLeadProfiles();
        await f.Db.ExecuteAsync("UPDATE materials SET usage_qty=0.000001");
        var body = await f.Adjustment(Purchase(await f.Read())); body.status = "已送完";
        Assert.IsType<OkObjectResult>(await f.Alerts.SaveAdjustment(body));
        Assert.Equal("covered", Purchase(await f.Read()).GetProperty("status").GetString());
        await f.Upload("10-10", """[{"code":"A","orderNo":"PO1","qty":11}]""");
        Assert.NotEqual("covered", Purchase(await f.Read()).GetProperty("status").GetString());
    }

    [Fact]
    public async Task Completed_old_orders_do_not_make_new_orders_overdue()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        await f.AddLeadProfiles();
        await f.Upload("10-01", """[{"code":"A","orderNo":"PO1","orderDate":"2026-03-18","qty":10}]""");
        await f.Acknowledge();
        await f.Upload("10-10", """[{"code":"A","orderNo":"PO2","orderDate":"2026-10-10","qty":5}]""");
        foreach (var item in (await f.Read()).EnumerateArray())
        {
            Assert.Equal("2026-10-10", item.GetProperty("accepted_date").GetString());
            Assert.Equal("2026-10-25", item.GetProperty("due_date").GetString());
            Assert.Equal((new DateTime(2026, 10, 25) - DateTime.Today).Days, item.GetProperty("days_remaining").GetInt32());
            Assert.Equal(2, item.GetProperty("order_count").GetInt32());
            Assert.Equal("2026-03-18", item.GetProperty("order_details")[0].GetProperty("accepted_date").GetString());
        }
        // Future pending orders must produce a normal risk regardless of old completed dates.
        var futureDate = DateTime.Today.AddDays(10).ToString("yyyy-MM-dd");
        await f.Upload("10-10", JsonSerializer.Serialize(new[] { new { code = "A", orderNo = "PO2", orderDate = futureDate, qty = 5 } }));
        Assert.All((await f.Read()).EnumerateArray(), x => Assert.Equal("normal", x.GetProperty("status").GetString()));
        await f.Acknowledge();
        foreach (var item in (await f.Read()).EnumerateArray())
        {
            Assert.Equal("covered", item.GetProperty("status").GetString());
            Assert.Equal("", item.GetProperty("accepted_date").GetString());
            Assert.Equal(JsonValueKind.Null, item.GetProperty("due_date").ValueKind);
            Assert.Equal(JsonValueKind.Null, item.GetProperty("days_remaining").ValueKind);
            Assert.Equal(2, item.GetProperty("order_details").GetArrayLength());
        }
    }

    [Fact]
    public async Task Actual_deliveries_exclude_old_order_but_partial_delivery_keeps_its_deadline()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        await f.AddLeadProfiles();
        await f.Upload("10-01", """[{"code":"A","orderNo":"PO1","orderDate":"2026-03-18","qty":10}]""");
        await f.Upload("10-10", """[{"code":"A","orderNo":"PO2","orderDate":"2026-10-10","qty":5}]""");
        await f.Db.ExecuteAsync("INSERT INTO po_items VALUES(1,1,20,20); INSERT INTO po_receipts VALUES(1,20); INSERT INTO outbound VALUES(1,20)");
        var item = Purchase(await f.Read());
        Assert.Equal("2026-10-10", item.GetProperty("accepted_date").GetString());
        Assert.Equal("2026-10-25", item.GetProperty("due_date").GetString());
        Assert.Equal(10, item.GetProperty("shortage_qty").GetDecimal());
        await f.Db.ExecuteAsync("UPDATE outbound SET qty=19");
        item = Purchase(await f.Read());
        Assert.Equal("2026-03-18", item.GetProperty("accepted_date").GetString());
        Assert.Equal("2026-04-02", item.GetProperty("due_date").GetString());
        Assert.Equal(11, item.GetProperty("shortage_qty").GetDecimal());
    }

    [Fact]
    public async Task Partial_manual_confirmation_keeps_old_deadline_and_only_remaining_capacity()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        await f.AddLeadProfiles();
        await f.Upload("10-01", """[{"code":"A","orderNo":"PO1","orderDate":"2026-03-18","qty":10}]""");
        await f.Acknowledge();
        await f.Upload("10-10", """[{"code":"A","orderNo":"PO1","orderDate":"2026-03-18","qty":15},{"code":"A","orderNo":"PO2","orderDate":"2026-10-10","qty":5}]""");
        await f.Db.ExecuteAsync("UPDATE material_lead_profiles SET lead_days=0,capacity_per_day=10");
        foreach (var item in (await f.Read()).EnumerateArray())
        {
            Assert.Equal("2026-03-18", item.GetProperty("accepted_date").GetString());
            // Purchase: 20 outstanding / 10 per day; plastic: 10 outstanding / 10.
            Assert.Equal(item.GetProperty("tracking_type").GetString() == "purchase" ? "2026-03-20" : "2026-03-19",
                item.GetProperty("due_date").GetString());
        }
        await f.Db.ExecuteAsync("DELETE FROM material_lead_profiles");
        Assert.All((await f.Read()).EnumerateArray(), item => {
            Assert.Equal("unconfigured", item.GetProperty("status").GetString());
            Assert.Equal(JsonValueKind.Null, item.GetProperty("due_date").ValueKind);
        });
    }

    [Fact]
    public async Task New_week_keeps_completion_without_duplicate_demand_or_fake_stock()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        await f.Acknowledge();
        await f.Upload("10-10", """[{"code":"A","orderNo":"PO1","qty":10}]""");
        var items = await f.Read();
        Assert.Equal(2, items.GetArrayLength());
        Assert.All(items.EnumerateArray(), x => {
            Assert.True(x.GetProperty("manual_completed").GetBoolean());
            Assert.Equal("covered", x.GetProperty("status").GetString());
            Assert.Equal(0, x.GetProperty("shortage_qty").GetDecimal());
            Assert.Equal(0, x.GetProperty("received_qty").GetDecimal());
            Assert.Equal(0, x.GetProperty("outbound_qty").GetDecimal());
        });
        Assert.Equal(20, Purchase(items).GetProperty("required_qty").GetDecimal());
        foreach (var table in new[] { "po_items", "po_receipts", "outbound" })
            Assert.Equal(0, await f.Db.ExecuteScalarAsync<int>($"SELECT COUNT(*) FROM {table}"));
    }

    [Fact]
    public async Task Same_week_overwrite_retains_history_and_tracks_only_extra_quantity()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        await f.Acknowledge();
        var originalId = await f.Db.ExecuteScalarAsync<long>("SELECT min(id) FROM material_tracking_history");
        await f.Upload("10-01", """[{"code":"A","orderNo":"PO1","qty":15}]""");
        var item = Purchase(await f.Read());
        Assert.Equal(30, item.GetProperty("required_qty").GetDecimal());
        Assert.Equal(10, item.GetProperty("shortage_qty").GetDecimal());
        Assert.False(item.GetProperty("manual_completed").GetBoolean());
        Assert.Equal(20, item.GetProperty("order_details")[0].GetProperty("manual_qty").GetDecimal());
        var old = Purchase(await f.Read(originalId));
        Assert.Equal(20, old.GetProperty("required_qty").GetDecimal());
        Assert.True(old.GetProperty("manual_completed").GetBoolean());
        Assert.Equal(2, await f.Db.ExecuteScalarAsync<int>("SELECT count(*) FROM material_tracking_history"));
        await f.Upload("10-01", """[{"code":"A","orderNo":"PO1","qty":10}]""");
        Assert.Equal(3, await f.Db.ExecuteScalarAsync<int>("SELECT count(*) FROM material_tracking_history"));
        var history = Assert.IsType<OkObjectResult>(await f.Alerts.History());
        Assert.Equal(3, JsonSerializer.SerializeToElement(history.Value).GetArrayLength());
        Assert.IsType<NotFoundObjectResult>(await f.Alerts.List(long.MaxValue));
    }

    [Fact]
    public async Task Backdated_same_week_upload_still_uses_the_new_revision_and_tracks_extra_quantity()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        await f.Acknowledge();
        var oldVersion = await f.Db.ExecuteScalarAsync<long>("SELECT min(id) FROM material_tracking_history");
        await f.Upload("10-01", """[{"code":"A","orderNo":"PO1","qty":15}]""", new DateTime(2026, 9, 30));
        var current = Purchase(await f.Read());
        Assert.Equal(30, current.GetProperty("required_qty").GetDecimal());
        Assert.Equal(10, current.GetProperty("shortage_qty").GetDecimal());
        Assert.False(current.GetProperty("manual_completed").GetBoolean());
        var historical = Purchase(await f.Read(oldVersion));
        Assert.Equal(20, historical.GetProperty("required_qty").GetDecimal());
        Assert.True(historical.GetProperty("manual_completed").GetBoolean());
    }

    [Fact]
    public async Task Missing_old_orders_remain_but_new_orders_do_not_inherit_completion()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        await f.Acknowledge();
        await f.Upload("10-10", """[{"code":"A","orderNo":"PO2","qty":5}]""");
        var item = Purchase(await f.Read());
        Assert.Equal(30, item.GetProperty("required_qty").GetDecimal());
        Assert.Equal(10, item.GetProperty("shortage_qty").GetDecimal());
        var details = item.GetProperty("order_details").EnumerateArray().ToList();
        Assert.Equal("已送完(手动)", details.Single(x => x.GetProperty("order_no").GetString() == "PO1").GetProperty("status").GetString());
        Assert.Equal(0, details.Single(x => x.GetProperty("order_no").GetString() == "PO2").GetProperty("manual_qty").GetDecimal());
        var version = await f.Db.ExecuteScalarAsync<long>("SELECT max(id) FROM material_tracking_history");
        Assert.Equal(10, Purchase(await f.Read(version)).GetProperty("required_qty").GetDecimal());
    }

    [Fact]
    public async Task Customer_full_product_variant_and_new_material_have_separate_identities()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        await f.Acknowledge();
        await f.Db.ExecuteAsync("INSERT INTO materials VALUES(2,'A','M2','新物料','五金','测试供应商',1,true,2)");
        await f.Upload("10-10", """
            [{"code":"A","orderNo":"PO1","qty":10},
             {"code":"A","customer":"other","orderNo":"PO1","qty":10},
             {"code":"A-VARIANT","orderNo":"PO1","qty":10}]
            """);
        var items = await f.Read();
        var original = items.EnumerateArray().Single(x => x.GetProperty("material_id").GetInt32() == 1);
        Assert.Equal(60, original.GetProperty("required_qty").GetDecimal());
        Assert.Equal(40, original.GetProperty("shortage_qty").GetDecimal());
        var added = items.EnumerateArray().Single(x => x.GetProperty("material_id").GetInt32() == 2);
        Assert.Equal(30, added.GetProperty("shortage_qty").GetDecimal());
        Assert.False(added.GetProperty("manual_completed").GetBoolean());
    }

    [Fact]
    public async Task Frozen_BOM_preserves_history_and_usage_increase_does_not_inherit_extra_completion()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        await f.Acknowledge();
        var version = await f.Db.ExecuteScalarAsync<long>("SELECT min(id) FROM material_tracking_history");
        await f.Db.ExecuteAsync("UPDATE materials SET usage_qty=3");
        Assert.Equal(10, Purchase(await f.Read()).GetProperty("shortage_qty").GetDecimal());
        Assert.Equal(20, Purchase(await f.Read(version)).GetProperty("required_qty").GetDecimal());
        await f.Db.ExecuteAsync("UPDATE materials SET active=false");
        Assert.Equal(20, Purchase(await f.Read(version)).GetProperty("required_qty").GetDecimal());
    }

    [Fact]
    public async Task Duplicate_lines_sum_within_revision_and_zero_demand_does_not_resurrect_old_quantity()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        await f.Upload("10-10", """[{"code":"A","orderNo":"PO1","qty":4},{"code":"A","orderNo":"PO1","qty":6}]""");
        Assert.Equal(20, Purchase(await f.Read()).GetProperty("required_qty").GetDecimal());
        await f.Upload("10-10", """[{"code":"A","orderNo":"PO1","qty":0},{"code":"A","orderNo":"PO1","qty":5}]""");
        Assert.Equal(10, Purchase(await f.Read()).GetProperty("required_qty").GetDecimal());
        await f.Upload("10-10", """[{"code":"A","orderNo":"PO1","qty":0}]""");
        Assert.Empty((await f.Read()).EnumerateArray());
    }

    [Fact]
    public async Task Zero_order_quantity_cancels_historical_materials_even_after_BOM_replacement()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        var oldVersion = await f.Db.ExecuteScalarAsync<long>("SELECT min(id) FROM material_tracking_history");
        await f.Db.ExecuteAsync("UPDATE materials SET active=false; INSERT INTO materials VALUES(2,'A','M2','替换物料','五金','测试供应商',1,true,2)");
        await f.Upload("10-10", """[{"code":"A","orderNo":"PO1","qty":0}]""");
        Assert.Empty((await f.Read()).EnumerateArray());
        Assert.Equal(20, Purchase(await f.Read(oldVersion)).GetProperty("required_qty").GetDecimal());
    }

    [Fact]
    public async Task Cancellation_does_not_remove_other_orders_customers_or_full_product_variants()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        await f.Upload("10-02", """
            [{"code":"A","orderNo":"PO1","qty":10},
             {"code":"A","orderNo":"PO2","qty":5},
             {"code":"A","customer":"other","orderNo":"PO1","qty":7},
             {"code":"A-VARIANT","orderNo":"PO1","qty":9}]
            """);
        await f.Db.ExecuteAsync("UPDATE materials SET active=false; INSERT INTO materials VALUES(2,'A','M2','替换物料','五金','测试供应商',1,true,2)");
        await f.Upload("10-10", """[{"code":"A","orderNo":"PO1","qty":0}]""");
        var item = Purchase(await f.Read());
        Assert.Equal(42, item.GetProperty("required_qty").GetDecimal());
        var details = item.GetProperty("order_details").EnumerateArray().ToList();
        Assert.Equal(3, details.Count);
        Assert.DoesNotContain(details, d => d.GetProperty("order_no").GetString() == "PO1"
            && d.GetProperty("customer").GetString() == ""
            && d.GetProperty("product_code").GetString() == "A");
    }

    [Fact]
    public async Task Missing_order_number_is_not_matched_between_revisions()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        // Replace the bootstrap source before testing unidentified rows.
        await f.Db.ExecuteAsync("DELETE FROM material_tracking_history; DELETE FROM schedules");
        await f.Upload("10-01", """[{"code":"A","qty":10}]""");
        await f.Acknowledge();
        await f.Upload("10-10", """[{"code":"A","qty":10}]""");
        var items = await f.Read();
        Assert.Equal(20, Purchase(items).GetProperty("required_qty").GetDecimal());
        Assert.All(items.EnumerateArray(), x => Assert.False(x.GetProperty("manual_completed").GetBoolean()));
    }

    [Fact]
    public async Task Legacy_null_schedule_rows_do_not_break_history_bootstrap()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        await f.Db.ExecuteAsync("INSERT INTO schedules(week_label,raw_rows) VALUES('空排期',NULL)");
        await f.Upload("10-10", "[]");
        Assert.Equal(3, await f.Db.ExecuteScalarAsync<int>("SELECT count(*) FROM material_tracking_history"));
        Assert.Equal(20, Purchase(await f.Read()).GetProperty("required_qty").GetDecimal());
    }

    [Fact]
    public async Task Invalid_or_stale_hash_does_not_fabricate_completion()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        foreach (var value in new[] { "not-json", "[]", "{\"1\":true}", "{\"1\":\"wrong\"}" })
        {
            await f.Db.ExecuteAsync("INSERT INTO settings VALUES('material_tracking_completed_schedules',@value) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value", new { value });
            Assert.All((await f.Read()).EnumerateArray(), x => Assert.False(x.GetProperty("manual_completed").GetBoolean()));
        }
    }

    [Theory]
    [InlineData("0.333333")]
    [InlineData("0.000001")]
    public async Task Fractional_usage_keeps_fully_confirmed_orders_complete(string usageText)
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        var usage = decimal.Parse(usageText, System.Globalization.CultureInfo.InvariantCulture);
        await f.Db.ExecuteAsync("UPDATE materials SET usage_qty=@usage", new { usage });
        await f.Upload("10-01", """
            [{"code":"A","orderNo":"PO1","qty":1},
             {"code":"A","orderNo":"PO2","qty":1},
             {"code":"A","orderNo":"PO3","qty":1}]
            """);
        await f.Acknowledge();
        var item = Purchase(await f.Read());
        Assert.True(item.GetProperty("manual_completed").GetBoolean());
        Assert.Equal("covered", item.GetProperty("status").GetString());
        Assert.Equal("已送完(手动)", item.GetProperty("workflow_status").GetString());
    }

    [Fact]
    public async Task Small_extra_requirement_does_not_become_complete_when_display_quantities_round_to_zero()
    {
        await using var f = await Fixture.Create(); if (f is null) return;
        await f.AddLeadProfiles();
        await f.Db.ExecuteAsync("UPDATE materials SET usage_qty=0.000001");
        await f.Upload("10-01", """[{"code":"A","orderNo":"PO1","qty":11}]""");
        await f.Acknowledge();
        await f.Upload("10-01", """[{"code":"A","orderNo":"PO1","qty":12}]""");
        var item = Purchase(await f.Read());
        Assert.False(item.GetProperty("manual_completed").GetBoolean());
        Assert.NotEqual("covered", item.GetProperty("status").GetString());
        Assert.Equal("2026-10-10", item.GetProperty("accepted_date").GetString());
        Assert.Equal("2026-10-25", item.GetProperty("due_date").GetString());
    }

    private static JsonElement Purchase(JsonElement items) => items.EnumerateArray()
        .Single(x => x.GetProperty("tracking_type").GetString() == "purchase");

    private sealed class Fixture(NpgsqlConnection admin, NpgsqlConnection db, string schema, string connection) : IAsyncDisposable
    {
        public NpgsqlConnection Db => db;
        public MaterialAlertsController Alerts { get; } = new(new SqlConnectionFactory(connection)) {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() }
        };
        public async Task<MaterialAlertsController.AdjustmentBody> Adjustment(JsonElement item)
        {
            var detail = item.GetProperty("order_details")[0];
            return new() {
                order_key = detail.GetProperty("key").GetString()!,
                expected_version = detail.GetProperty("adjustment_version").GetInt64(),
                expected_source_required = detail.GetProperty("source_required_qty").GetDecimal(),
                expected_source_ordered = detail.GetProperty("source_ordered_qty").GetDecimal(),
                expected_source_received = detail.GetProperty("source_received_qty").GetDecimal(),
                expected_source_outbound = detail.GetProperty("source_outbound_qty").GetDecimal(),
                expected_source_manual = detail.GetProperty("source_manual_qty").GetDecimal(),
                expected_revision_id = await db.ExecuteScalarAsync<long>("SELECT MAX(id) FROM material_tracking_history"),
                note = "测试追踪调整",
            };
        }
        public async Task<MaterialAlertsController.AdjustmentBody> FormAdjustment(JsonElement item)
        {
            var body = await Adjustment(item);
            var detail = item.GetProperty("order_details")[0];
            var adjustment = detail.GetProperty("adjustment");
            static bool Has(JsonElement adjustment, string field) => adjustment.TryGetProperty(field, out var value)
                && value.ValueKind != JsonValueKind.Null;
            body.required_qty = Has(adjustment, "required_delta") ? detail.GetProperty("required_qty").GetDecimal() : null;
            body.ordered_qty = Has(adjustment, "ordered_qty") ? detail.GetProperty("ordered_qty").GetDecimal() : null;
            body.received_qty = Has(adjustment, "received_qty") ? detail.GetProperty("received_qty").GetDecimal() : null;
            body.outbound_qty = Has(adjustment, "outbound_qty") ? detail.GetProperty("outbound_qty").GetDecimal() : null;
            body.manual_qty = Has(adjustment, "manual_qty") ? detail.GetProperty("manual_qty").GetDecimal() : null;
            body.status = adjustment.GetProperty("status").GetString();
            return body;
        }
        public async Task AddLeadProfiles() => await db.ExecuteAsync("""
            INSERT INTO material_lead_profiles VALUES
                ('A','测试产品','五金','',15,0,true),
                ('A','测试产品','塑胶','',15,0,true)
            """);
        public async Task<JsonElement> Read(long? revision = null) => JsonSerializer.SerializeToElement(
            Assert.IsType<OkObjectResult>(await Alerts.List(revision)).Value).GetProperty("items");
        public async Task Acknowledge() => await db.ExecuteAsync("""
            INSERT INTO settings VALUES('material_tracking_completed_schedules',
                (SELECT jsonb_object_agg(id::text,md5(raw_rows::text))::text FROM schedules))
            ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value
            """);
        public async Task Upload(string label, string rows, DateTime? uploadDate = null) => Assert.IsType<OkObjectResult>(
            await new SchedulesController(new SqlConnectionFactory(connection)).Create(new SchedulesController.CreateBody {
                week_label = label, upload_date = uploadDate ?? new DateTime(2026, 10, 10), raw_rows = JsonSerializer.Deserialize<JsonElement>(rows)
            }));
        public static async Task<Fixture?> Create()
        {
            var connection = Environment.GetEnvironmentVariable("SUPPLIER_SYNC_TEST_CONNECTION");
            if (string.IsNullOrWhiteSpace(connection)) return null;
            var schema = "tracking_test_" + Guid.NewGuid().ToString("N");
            var admin = new NpgsqlConnection(connection); await admin.OpenAsync();
            await admin.ExecuteAsync($"CREATE SCHEMA {schema}");
            // Every fixture has a unique search path. Pooling would leave an
            // idle pool per dropped schema until its timeout, exhausting CI's
            // PostgreSQL connection limit as coverage grows.
            var scoped = new NpgsqlConnectionStringBuilder(connection) { SearchPath = schema, Pooling = false }.ConnectionString;
            var db = new NpgsqlConnection(scoped); await db.OpenAsync();
            var fixture = new Fixture(admin, db, schema, scoped);
            try
            {
                await db.ExecuteAsync("""
                    CREATE TABLE schedules(id int GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, week_label text UNIQUE,
                        upload_date timestamp, raw_rows jsonb, diff_from_prev jsonb);
                    CREATE TABLE settings(key text PRIMARY KEY, value text);
                    CREATE TABLE audit_logs(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, occurred_at timestamptz DEFAULT now(),
                        user_id int, username text, module text, action text, entity_type text,
                        entity_id text, summary text, details jsonb, ip_address text);
                    CREATE TABLE material_lead_profiles(product_code text, product_name text, category text,
                        component_name text, lead_days int, capacity_per_day numeric, active boolean);
                    CREATE TABLE materials(id int, product_code text, item_no text, name_zh text, category text,
                        supplier text, usage_qty numeric, active boolean, sort_order int);
                    CREATE TABLE products(code text, name text, moldings jsonb, active boolean);
                    CREATE TABLE po_items(id int, material_id int, purchase_qty numeric, qty numeric);
                    CREATE TABLE po_receipts(po_item_id int, qty numeric);
                    CREATE TABLE outbound(po_item_id int, qty numeric);
                    INSERT INTO schedules(week_label,upload_date,raw_rows) VALUES('10-01','2026-10-01',
                        '[{"code":"A","orderNo":"PO1","qty":10}]');
                    INSERT INTO materials VALUES(1,'A','M1','测试物料','五金','测试供应商',2,true,1);
                    INSERT INTO products VALUES('A','测试产品',
                        '[{"moldId":"M1","moldName":"模具","category":"塑胶","parts":[]}]',true);
                    """);
                await db.ExecuteAsync(MaterialTrackingHistory.SchemaSql);
                await db.ExecuteAsync(ScheduleCustomerSchema.SchemaSql);
                await using var tx = await db.BeginTransactionAsync();
                await MaterialTrackingHistory.CaptureAsync(db, tx);
                await tx.CommitAsync();
                return fixture;
            }
            catch { await fixture.DisposeAsync(); throw; }
        }
        public async ValueTask DisposeAsync()
        {
            await db.DisposeAsync();
            await admin.ExecuteAsync($"DROP SCHEMA {schema} CASCADE");
            await admin.DisposeAsync();
        }
    }
}
