using Microsoft.Data.SqlClient;
namespace ErpApi.Engines.Inventory;
public interface IMaterialInventoryService
{
    // 单物料全仓库存（缺料计算用）；可传入已打开的连接+事务以参与上层事务，传 null 则自开连接。
    Task<decimal> StockOfAsync(string 物料编号, (SqlConnection conn, SqlTransaction tx)? scope);
    // 库存查询列表（按仓库/物料关键字过滤），物料编号×仓库 汇总。
    // 含零库存=false（默认，盘点/辅料口径）：仅非零；=true（库存统计表口径）：以物料资料为主档，每个分类显示全部物料，无库存显示 0。
    Task<IReadOnlyList<MaterialStockRow>> ListAsync(string? 仓库, string? keyword, string? 物料类别 = null, bool 含零库存 = false);
    // 库存统计表左树：全部物料类别 + 各类别有库存(非零)的物料数（无库存类别计数 0，与列表仅非零口径一致；新类别随物料资料自动出现）。
    Task<IReadOnlyList<ErpApi.Features.Materials.MaterialMaster.MaterialCategoryNode>> CategoryCountsAsync();
    // 库存月报（按仓库/物料类别过滤），同库存口径拆分期初、本期入出、盘点盈亏。
    Task<IReadOnlyList<MaterialMonthlyRow>> MonthlyAsync(DateTime 起, DateTime 止, string? 仓库, string? 物料类别 = null, string? keyword = null);
}
