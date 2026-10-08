namespace ErpApi.Engines.Posting;

// 可审核的单头表白名单：表名只能来自此集合，杜绝拼接注入。
// 值 = 该表的单号列名（绝大多数表用 [单号]；生产制单 用 [生产单号]）。
public static class PostableDocuments
{
    private static readonly IReadOnlyDictionary<string, string> Map =
        new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["成品入仓单"] = "单号", ["成品出仓单"] = "单号", ["成品调拨单"] = "单号",
            ["成品盘点单"] = "单号", ["成品退仓单"] = "单号", ["成品退货单"] = "单号",
            ["采购入仓单"] = "单号", ["采购付款单"] = "单号", ["采购退仓单"] = "单号", ["采购订单"] = "单号",
            ["销售出货单"] = "单号", ["销售收款单"] = "单号", ["销售退货单"] = "单号",
            ["领料单"] = "单号", ["退料单"] = "单号", ["报废单"] = "单号", ["调拨单"] = "单号", ["盘点单"] = "单号",
            ["发外加工单"] = "单号", ["发外回收单"] = "单号", ["发外加工付款单"] = "单号",
            ["半成品入仓单"] = "单号", ["半成品退仓单"] = "单号", ["半成品领料单"] = "单号", ["半成品盘点单"] = "单号", ["半成品退库单"] = "单号", ["半成品报废单"] = "单号",
            ["成品客户订货单"] = "单号",
            ["塑胶物料单"] = "单号",
            ["塑胶采购订单"] = "单号",
            ["塑胶加工采购单"] = "单号",
            ["塑胶入仓单"] = "单号",
            ["塑胶领料单"] = "单号",
            ["塑胶退料单"] = "单号",
            ["塑胶退仓单"] = "单号",
            ["塑胶报废单"] = "单号",
            ["塑胶盘点单"] = "单号",
            ["白件领料单"] = "单号",
            ["原料生产需求表"] = "单号",
            ["原料采购订单"] = "单号",
            ["原料入仓单"] = "单号",
            ["原料退仓单"] = "单号",
            ["原料退库表"] = "单号",
            ["原料出库单"] = "单号",
            ["装配加工采购单"] = "单号",
            ["生产制单"] = "生产单号",
            ["裁床总表"] = "裁床单号"
            // 注：后续阶段可按需追加，但必须列入白名单才允许过账
        };

    public static readonly IReadOnlySet<string> Tables =
        new HashSet<string>(Map.Keys, StringComparer.Ordinal);

    public static bool IsAllowed(string table) => Map.ContainsKey(table);

    public static string DocNoColumn(string table) =>
        Map.TryGetValue(table, out var col)
            ? col
            : throw new InvalidOperationException($"表 [{table}] 不在可过账白名单内。");
}
