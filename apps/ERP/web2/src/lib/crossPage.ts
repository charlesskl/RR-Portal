import type { QueryClient } from "@tanstack/react-query";

// 跨页缓存刷新(终审修复):keep-alive 下库存页常驻挂载、首页卡片切回才重挂载,
// 单据页变更(保存/审核/反审核/删除)成功后只 invalidate 自己的命名空间,
// 会让物料库存查询与首页统计卡长时间停留旧数据。各单据页变更成功后统一调本函数:
//  - ["material-inventory"]:库存页列表(前缀匹配,附带筛选条件的 key 一并失效)
//  - ["home-production-pending"] / ["home-inventory-negative"]:首页两张统计卡
// 失效的活跃查询(如常驻挂载的库存页)会立即重取,非活跃(首页)重进时重取。
export function invalidateCrossPage(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: ["material-inventory"] });
  void qc.invalidateQueries({ queryKey: ["home-production-pending"] });
  void qc.invalidateQueries({ queryKey: ["home-inventory-negative"] });
}
