# 塑胶类型客户统计 · 设计 · 2026-06-26

## 目标

P4 塑胶报表第三张。按日期区间(单据日期 + 仅审核='1')出**行=客户 × 列=塑胶类型(加工内容)×(本月数量/本月金额) + 总合计**的透视表,底部总合计行。

## 范围与决策(已确认)

- 数据源:**塑胶物料单**(头 客户/日期/审核) + **塑胶物料明细单**(加工内容=塑胶类型、订购数量=本月数量、金额=本月金额)。仅 `审核='1'` + 单据日期在区间。
- 透视列:**动态**——按数据里实际出现的 `加工内容` 值生成列组(原胶件/印喷件/电镀件…+ 总合计)。
- 货币转换:**v1 只「默认」**(金额按原值,不做汇率换算)。
- 后端返回**扁平行**(客户/类型/数量/金额),前端做透视;**金额按「塑胶类型客户统计·金额」权限脱敏**。

## 架构

后端在 `PlasticMaterialDocService`(P2 已建,拥有塑胶物料单)加一个统计查询方法,返回扁平 `{客户,类型,数量,金额}` 行(明细 JOIN 单头,按 客户×加工内容 聚合,审核+日期过滤)。新独立 Controller(菜单「塑胶类型客户统计」,金额脱敏)。前端新页取扁平行,在前端透视成 客户行 × 类型列组,加客户级总合计与底部总合计行,复用日期工具栏 + `tableExport`(导出/打印按透视后的扁平展开列)。

## ① 后端

**`src/ErpApi/Features/Plastics/PlasticMaterialDoc/PlasticMaterialDocService.cs`**(P2 服务,扩一方法)
- 新 DTO `PlasticCustomerTypeStatRow`(放该 service 的 Dtos 文件 `PlasticMaterialDocDtos.cs`):`客户`(string?)、`类型`(string?)、`数量`(decimal)、`金额`(decimal?)。
- 新方法:
```csharp
public async Task<IReadOnlyList<PlasticCustomerTypeStatRow>> CustomerTypeStatsAsync(DateTime 起, DateTime 止, string? 客户)
{
    var qi = 起.Date; var qe = 止.Date.AddDays(1);
    var ck = string.IsNullOrWhiteSpace(客户) ? null : $"%{客户.Trim()}%";
    using var c = factory.Create();
    var rows = await c.QueryAsync<PlasticCustomerTypeStatRow>(@"
SELECT h.[客户] AS 客户, ISNULL(NULLIF(LTRIM(RTRIM(d.[加工内容])), N''), N'未分类') AS 类型,
       SUM(ISNULL(d.[订购数量],0)) AS 数量, SUM(ISNULL(d.[金额],0)) AS 金额
FROM [塑胶物料明细单] d JOIN [塑胶物料单] h ON h.[单号]=d.[单号]
WHERE ISNULL(h.[审核],'0')='1' AND h.[日期] >= @qi AND h.[日期] < @qe
  AND (@ck IS NULL OR h.[客户] LIKE @ck)
GROUP BY h.[客户], ISNULL(NULLIF(LTRIM(RTRIM(d.[加工内容])), N''), N'未分类')
HAVING SUM(ISNULL(d.[订购数量],0)) <> 0 OR SUM(ISNULL(d.[金额],0)) <> 0
ORDER BY h.[客户], 类型", new { qi, qe, ck });
    return rows.AsList();
}
```
（`factory` 即 `PlasticMaterialDocService` 既有的 `ISqlConnectionFactory`。）

**`src/ErpApi/Features/Plastics/PlasticCustomerType/PlasticCustomerTypeController.cs`**(新)
- `[Route("api/plastic-customer-type-stats")]`,菜单 `塑胶类型客户统计`,注入 `PlasticMaterialDocService` + `IPermissionService`。
- `GET ?起=&止=&客户=` → 校验「打开」→ `CustomerTypeStatsAsync` → 无「金额」权限则 `foreach r: r.金额 = null` → Ok。

**菜单 + 权限**
- `MenuCatalog.cs` 加 `new("塑胶报表","塑胶类型客户统计")`。
- `db/seed_plastic_customer_type_perms.sql` 给 admin 9 位权限,应用两库。

## ② 前端

**`web/src/api/plasticCustomerType.ts`**:`PlasticCustomerTypeStatRow {客户?,类型?,数量,金额?:number|null}` + `plasticCustomerTypeApi.list(起,止,客户?)`。

**`web/src/pages/plastics/PlasticCustomerTypeStatsPage.tsx`**:
- 工具栏:上月/本月/下月 + RangePicker(默认本月)+ 客户关键词 `Input.Search` + 货币转换下拉(只「默认」占位·禁用)+ 导出EXCEL + 打印。
- **前端透视**(useMemo):
  - `types` = 扁平行去重 `类型`(排序;有「金额」权限决定是否含金额列)。
  - `customers` = 按 `客户` 聚合:`pivot[客户][类型] = {数量,金额}`;`客户总数量/客户总金额` = 跨类型合计。
  - antd `Table` 列:固定首列 客户;每 `类型` 一个**列组**(children 本月数量 + 本月金额[有权限]);末「总合计」列组(总数量 + 总金额[有权限])。
  - 底部 `Table.Summary` 总合计行:各类型/总合计的数量、金额(有权限)across 所有客户。
  - 导出/打印:把透视后的每客户行摊平成 `{客户, <类型>_数量, <类型>_金额, 总数量, 总金额}`,`ExportCol` 按动态类型生成。
- 权限:`can(perms,"塑胶类型客户统计","打开")` 守卫;`金额隐藏 = !can(perms,"塑胶类型客户统计","金额")`(后端已置 null,前端据此不渲染金额列)。

**`App.tsx`**:加路由 `plastic-customer-type-stats` → 页。
**`menuTree.tsx`**:把占位 `M("塑胶类型客户统计")` 改为 `M("塑胶类型客户统计","/plastic-customer-type-stats","塑胶类型客户统计")`。

## ③ 测试

- 后端 `PlasticCustomerTypeStatsServiceDbTests`:种 塑胶物料单 2 张(客户 A:类型 原胶件 数量10/金额100 + 印喷件 数量5/金额50;客户 B:原胶件 数量3/金额30)审核·日期本月,另种 1 张区间外(上月)或未审核 → `CustomerTypeStatsAsync(本月起,止,null)`:A-原胶件(10/100)、A-印喷件(5/50)、B-原胶件(3/30) 三行,区间外/未审核不计;`客户="A"` 过滤只剩 A 两行。清理。
- 全量 `dotnet test` 绿(363 → 364)。
- 前端 `npm --prefix web run test`(54)+ `build` tsc 干净。
- 冒烟:种数据 → `GET /api/plastic-customer-type-stats?起=&止=` 返回扁平行;无金额权限用户金额=null。

## 不做(YAGNI)

- 货币汇率换算(只默认)。
- 固定类型列(用动态)。
- 生产单号条件 / 精确查询 / 高级查询 / 表格设置。

## 执行

writing-plans → subagent-driven → opus 终审 → 分支 `feat-plastic-customer-type-stats` `--no-ff` 合并 master 删分支 → worklog + MEMORY。
