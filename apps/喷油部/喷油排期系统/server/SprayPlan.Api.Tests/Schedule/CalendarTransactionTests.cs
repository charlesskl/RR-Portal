using System.Data.Common;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using SprayPlan.Api.Data;
using SprayPlan.Api.Entities;
using SprayPlan.Api.Services;

namespace SprayPlan.Api.Tests.Schedule;

// 在真实 HTTP + SQLite 中检查六个写入口的 SQL 交易上下文，而非检查源码文本。
public class CalendarTransactionTests
{
    sealed class TransactionProbe : DbCommandInterceptor
    {
        public bool Armed;
        public List<DbTransaction?> CalendarReads { get; } = [];
        public List<DbTransaction?> PlanWrites { get; } = [];
        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(DbCommand command, CommandEventData eventData,
            InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default)
        {
            if (Armed)
            {
                if (command.CommandText.Contains("FROM \"holidays\"")) CalendarReads.Add(command.Transaction);
                if (command.CommandText.Contains("INSERT INTO \"production_plans\"") || command.CommandText.Contains("UPDATE \"production_plans\"")) PlanWrites.Add(command.Transaction);
            }
            return base.ReaderExecutingAsync(command, eventData, result, cancellationToken);
        }
    }

    [Theory]
    [InlineData("create")]
    [InlineData("update")]
    [InlineData("reschedule")]
    [InlineData("monthly")]
    [InlineData("process")]
    [InlineData("urgent")]
    public async Task CalendarValidationAndPlanWriteUseSameSqliteTransaction(string operation)
    {
        var probe = new TransactionProbe(); using var factory = new ApiFactory(options => options.AddInterceptors(probe)); using var client = factory.CreateClient(); await factory.SeedAsync();
        var monday = DateTime.SpecifyKind(DateTime.UtcNow.AddHours(8).Date.AddDays(10), DateTimeKind.Utc);
        while (monday.DayOfWeek != DayOfWeek.Monday) monday = monday.AddDays(1);
        var orderId = 0; var partId = 0; var planId = 0;
        await factory.WithDbAsync(async db => {
            var product = new Product { ProductNo = "CALENDAR-TX" };
            product.Parts.Add(new ProductPart { PartName = "头", Craft = "移印", DailyCapacity = 10, StdMachineCount = 1 });
            db.Products.Add(product); await db.SaveChangesAsync(); partId = product.Parts[0].Id;
            var order = new Order { ExternalOrderNo = "CALENDAR-TX", Status = "received", ProductId = product.Id, OrderDate = monday };
            order.PartQtys.Add(new OrderPartQty { PartName = "头", SourcePartId = partId, Qty = 10 });
            db.Orders.Add(order); await db.SaveChangesAsync(); orderId = order.Id;
            if (operation is "update" or "reschedule")
            {
                var plan = new ProductionPlan { OrderId = orderId, LineId = 1, PartName = "头", SourcePartId = partId, PlanDate = monday, PlannedQty = 10 };
                db.ProductionPlans.Add(plan); await db.SaveChangesAsync(); planId = plan.Id;
            }
        });
        (await client.PostAsJsonAsync("/api/auth/login", new { username = "clerk", password = "clerk123" })).EnsureSuccessStatusCode();
        probe.Armed = true;
        var date = ScheduleCalc.Ymd(monday.AddDays(1));
        using var response = operation switch
        {
            "create" => await client.PostAsJsonAsync("/api/plans", new { plans = new[] { new { planDate = date, lineId = 1, orderId, partName = "头", plannedQty = 10 } } }),
            "update" => await client.PatchAsJsonAsync($"/api/plans/{planId}", new { planDate = date }),
            "reschedule" => await client.PostAsJsonAsync("/api/plans/reschedule", new { changes = new[] { new { id = planId, originalDate = ScheduleCalc.Ymd(monday), newDate = date } } }),
            "process" => await client.PostAsJsonAsync($"/api/orders/{orderId}/process-schedule", new { rows = new[] { new { startDate = date, lineId = 1, dailyTarget = 10 } } }),
            "urgent" => await client.PostAsJsonAsync("/api/schedule/urgent/commit", new { urgentOrderId = orderId, rows = new[] { new { planDate = date, lineId = 1, partName = "头", plannedQty = 10, workerCount = 1 } }, pausedOrderIds = Array.Empty<int>() }),
            _ => await client.PostAsJsonAsync("/api/schedule/auto/commit", new { month = monday.ToString("yyyy-MM"), mode = "incremental", draft = new[] {
                new { orderId, externalOrderNo = "CALENDAR-TX", productNo = "CALENDAR-TX", sourcePartId = partId, itemName = "", partName = "头", planDate = date,
                    plannedQty = 10, orderDate = ScheduleCalc.Ymd(monday), deliveryDate = (string?)null, lineId = 1, lineName = "胡旗拉", stepNo = 1, craft = "移印" } } })
        };
        response.EnsureSuccessStatusCode();
        Assert.NotEmpty(probe.CalendarReads);
        var calendarTransaction = probe.CalendarReads[0]; Assert.NotNull(calendarTransaction);
        Assert.All(probe.CalendarReads, transaction => Assert.Same(calendarTransaction, transaction));
        Assert.NotEmpty(probe.PlanWrites); Assert.All(probe.PlanWrites, transaction => Assert.Same(calendarTransaction, transaction));
    }
}
