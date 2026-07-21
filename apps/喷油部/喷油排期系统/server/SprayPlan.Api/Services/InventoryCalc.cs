using System.Linq;

namespace SprayPlan.Api.Services;

// 库存派生公式（spec §2.3）。全部纯函数：库存数字永远算出来、不另存，保证与实绩一致。
public static class InventoryCalc
{
    // 成品在库 = 该部位累计良品 + 该订单该部位所有 owner 出账(均为负)
    public static int FinishedInStock(int cumulativeGood, IEnumerable<int> ownerMoveDeltas)
        => cumulativeGood + ownerMoveDeltas.Sum();

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
