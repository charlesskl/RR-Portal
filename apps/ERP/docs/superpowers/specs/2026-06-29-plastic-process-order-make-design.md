# 塑胶加工订单制作 · 设计 · 2026-06-29

## 目标

⑩ 发外加工「塑胶加工订单制作」落地。只读单表平铺查询(只显示已审核 BOM·调整审核='1'),把已审核塑胶 BOM 按生产单展开。**塑胶订单制作(⑦·`OrderMakeListAsync`)的克隆**,加 **色粉号 / 加工内容** 列(发外加工口径)。

## 范围与决策(已确认)

- = 塑胶订单制作 发外加工版:同 BOM 源(`生产制单货号 JOIN 塑胶共用物料表[调整审核='1'] JOIN 生产制单`)、订购数量=用量×计划数量、金额=订购×加工单价。
- 加 色粉号(p.色粉号)+ 加工内容(p.加工内容)列(均在塑胶共用物料表)。
- 订单单号列省略(无源·同塑胶订单制作)。加工单价/金额按「塑胶加工订单制作·单价」脱敏。
- v1 省略:开单/精确/高级查询/表格设置。保留 上月/本月/下月+RangePicker+关键词+导出/打印+"共 N 条"。

## ① 后端

**DTO**(`PlasticMaterialDocDtos.cs` 末尾加·= `PlasticOrderMakeRow` + 色粉号/加工内容):
```csharp
public sealed class PlasticProcessOrderMakeRow
{
    public DateTime? 单据日期 { get; set; }
    public string? 生产单号 { get; set; }
    public string? 款号 { get; set; }
    public string? 塑胶货号 { get; set; }
    public string? 工模编号 { get; set; }
    public string? 物料编号 { get; set; }
    public string? 物料名称 { get; set; }
    public string? 颜色 { get; set; }
    public string? 色粉号 { get; set; }
    public string? 加工内容 { get; set; }
    public string? 用料名称 { get; set; }
    public string? 单位 { get; set; }
    public decimal? 用量 { get; set; }
    public decimal? 计划数量 { get; set; }
    public decimal? 订购数量 { get; set; }
    public decimal? 加工单价 { get; set; }
    public decimal? 金额 { get; set; }
}
```

**`PlasticMaterialDocService.cs`** 加方法(克隆 `OrderMakeListAsync`·SELECT 加 `p.[色粉号], p.[加工内容]`):
```csharp
    public async Task<IReadOnlyList<PlasticProcessOrderMakeRow>> ProcessOrderMakeListAsync(DateTime 起, DateTime 止, string? keyword)
    {
        var qi = 起.Date; var qe = 止.Date.AddDays(1);
        var kw = string.IsNullOrWhiteSpace(keyword) ? null : $"%{keyword.Trim()}%";
        using var c = factory.Create();
        var rows = await c.QueryAsync<PlasticProcessOrderMakeRow>(@"
SELECT pm.[日期] AS 单据日期, g.[生产单号], pm.[款号], g.[货号] AS 塑胶货号, p.[工模编号], p.[物料编号], p.[物料名称], p.[颜色],
       p.[色粉号], p.[加工内容], p.[用料名称], m.[单位], p.[用量], pm.[计划数量],
       p.[用量]*ISNULL(pm.[计划数量],0) AS 订购数量, p.[加工单价],
       p.[用量]*ISNULL(pm.[计划数量],0)*ISNULL(p.[加工单价],0) AS 金额
FROM [生产制单货号] g
JOIN [塑胶共用物料表] p ON p.[塑胶货号] = g.[货号]
JOIN [生产制单] pm ON pm.[生产单号] = g.[生产单号]
LEFT JOIN (SELECT [物料编号], MAX([单位]) AS 单位 FROM [塑胶物料资料] GROUP BY [物料编号]) m ON m.[物料编号] = p.[物料编号]
WHERE pm.[日期] >= @qi AND pm.[日期] < @qe
  AND p.[调整审核] = '1'
  AND (@kw IS NULL OR g.[生产单号] LIKE @kw OR pm.[款号] LIKE @kw OR p.[物料编号] LIKE @kw OR p.[物料名称] LIKE @kw OR g.[货号] LIKE @kw)
ORDER BY g.[生产单号], p.[物料编号]", new { qi, qe, kw });
        return rows.AsList();
    }
```

**`PlasticProcessOrderMakeController.cs`**(新·`Features/Plastics/PlasticProcessOrderMake/`):`[Route("api/plastic-process-order-make")]`·菜单 `塑胶加工订单制作`·注入 `PlasticMaterialDocService`+`IPermissionService`。`GET ?起=&止=&keyword=` → 校验「打开」→ `ProcessOrderMakeListAsync` → 无「单价」权限 `r.加工单价=null; r.金额=null` → Ok。

**菜单 + 权限**:`MenuCatalog` 加 `new("发外加工","塑胶加工订单制作")`(组"发外加工"已核实);`db/seed_plastic_process_order_make_perms.sql` admin 9 位·两库。

## ② 前端

- `api/plasticProcessOrderMake.ts`:`PlasticProcessOrderMakeRow`(同后端)+ `plasticProcessOrderMakeApi.list({起,止,keyword?})`(端点 `/plastic-process-order-make`)。
- `PlasticProcessOrderMakePage.tsx`(克隆 `PlasticOrderMakePage` 单 Tab 平铺·列加 色粉号/加工内容):上月/本月/下月+RangePicker(默认本月)+关键词+导出EXCEL/打印+"共 N 条";列 单据日期/生产单号/款号/塑胶货号/工模编号/物料编号/物料名称/颜色/色粉号/加工内容/用料名称/单位/用量/计划数量/订购数量/(加工单价/金额 hidePrice 隐藏)。`can(perms,"塑胶加工订单制作","打开")` 守卫。
- `App.tsx` 路由 `plastic-process-order-make`;`menuTree.tsx` ⑩ 发外加工 占位 `M("塑胶加工订单制作")` → 带路由。

## ③ 测试

- 后端 `PlasticProcessOrderMakeServiceDbTests`:种 款号总表(父)→生产制单(计划数量100)→生产制单货号→塑胶共用物料表(调整审核'1'·色粉号 C1·加工内容 喷油·用量2·加工单价3·另一行调整审核'0')→塑胶物料资料 → `ProcessOrderMakeListAsync(本月,"物料")` 验:仅调整审核1行·订购数量=2×100=200·金额=600·**色粉号=C1·加工内容=喷油**·款号/单位带出;keyword/区间过滤·调整审核0不出。清理(反 FK 序·含款号总表)。`using Dapper;`。
- 全量 `dotnet test` 绿(+1);前端 54 + tsc 干净。
- 冒烟:种链 → `GET /api/plastic-process-order-make` 订购=用量×计划·色粉号/加工内容带出·金额脱敏。**起后端 `--contentRoot 输出目录` + 冒烟前 `dotnet build -c Release`(锁先按 PID Stop-Process)。**

## 不做(YAGNI)

- 订单单号列、开单/精确/高级查询/表格设置。

## 执行

writing-plans → subagent-driven → opus 终审 → 分支 `feat-plastic-process-order-make` `--no-ff` 合并 → worklog + MEMORY。**坑**:生产制单.款号 FK→款号总表(种父反序清)。
