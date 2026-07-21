using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SprayPlan.Api.Data;

namespace SprayPlan.Api.Features.Dashboard;

// 仪表盘统计 —— 对应现有 src/app/page.tsx 的 4 个统计卡（任意登录可读）。
public record DashboardStats(int OrdersTotal, int OrdersActive, int Overdue, int ProductsCount);

[ApiController]
[Route("api/dashboard")]
[Authorize]
public class DashboardController(AppDbContext db) : ControllerBase
{
    // GET /api/dashboard
    [HttpGet]
    public async Task<IActionResult> Get()
    {
        var now = DateTime.UtcNow;
        var ordersTotal = await db.Orders.CountAsync();
        // 在产订单数：只数状态为「在产」的订单（业务方 2026-06-12 定口径，原 "confirmed" 为不存在的值恒 0，已修正）
        var ordersActive = await db.Orders.CountAsync(o => o.Status == "in_production");
        // 已逾期：交货日已过 且 未作废（deliveryDate 为 null 不计入，与现有 lt 语义一致）
        var overdue = await db.Orders.CountAsync(o => o.DeliveryDate < now && o.Status != "archived");
        var productsCount = await db.Products.CountAsync(p => p.Status != "archived");
        return Ok(new DashboardStats(ordersTotal, ordersActive, overdue, productsCount));
    }
}
