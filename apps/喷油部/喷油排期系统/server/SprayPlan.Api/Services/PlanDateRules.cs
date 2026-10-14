using SprayPlan.Api.Entities;

namespace SprayPlan.Api.Services;

// 排期调整资格在写接口与列表共用，防止只凭 nullable 实绩字段判断而漏掉订单状态。
public static class PlanDateRules
{
    public static bool HasActuals(ProductionPlan plan)
        => plan.Status == "recorded" || plan.GoodQty is not null || plan.InboundQty is not null || plan.ReportedQty is not null;

    public static bool CanReschedule(ProductionPlan plan)
        => plan.DeletedAt is null && !HasActuals(plan) && plan.Order is not null && plan.Order.Status is not ("completed" or "archived");
}
