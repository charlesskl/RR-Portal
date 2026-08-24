using System.Linq;

namespace SprayPlan.Api.Services;

// 库存派生公式（spec §2.3）。全部纯函数：库存数字永远算出来、不另存，保证与实绩一致。
public static class InventoryCalc
{
    // 成品在库 = 最后一道工序累计实际入库 + 该订单该部位所有 owner 出账(均为负)
    public static int FinishedInStock(int cumulativeInbound, IEnumerable<int> ownerMoveDeltas)
        => cumulativeInbound + ownerMoveDeltas.Sum();

    // 车间存数 = 最后一道工序累计完成数 − 累计实际入库数。
    public static int WorkshopStock(int finalStepGood, int finalStepInbound)
        => Math.Max(0, finalStepGood - finalStepInbound);

    // 工序半成品（库存页“散件”）= 每一道工序完成数 − 下一道工序完成数的差额之和。
    public static int ProcessLoose(IEnumerable<int> stepGoods)
    {
        var steps = stepGoods.ToList();
        return steps.Zip(steps.Skip(1), (current, next) => Math.Max(0, current - next)).Sum();
    }

    // 散件可用 = 该部位 owner=NULL 的所有 delta 求和
    public static int LooseAvailable(IEnumerable<int> looseMoveDeltas)
        => looseMoveDeltas.Sum();

    // 待领取 = 部位需求 − 已被装配领走
    public static int PendingPickup(int partDemand, int pickedUp)
        => partDemand - pickedUp;

    // 在产订单可翻单 = max(0, 成品在库 − 待领取)
    public static int ReorderAvailableInProduction(int finishedInStock, int pendingPickup)
        => Math.Max(0, finishedInStock - pendingPickup);
}
