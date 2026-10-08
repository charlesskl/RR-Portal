# 物料(原料仓)月结 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 把库存月结扩到第三个口径 `物料`（按 `物料编号×仓库`，忽略颜色），复用同一算法/页面/权限，零改表。

**Architecture:** 只在 `MonthEndService` 加 `物料账本Sql`/`物料仓库Sql` 并放行 `物料` 口径（其余方法口径无关，自动支持）；前端在「库存月结」页加第三个口径选项与维度列。

**Tech Stack:** .NET 8 + Dapper；React + TS + AntD v6 + Vitest；xUnit。

依据：`docs/superpowers/specs/2026-06-08-p5-material-month-end-design.md`。设计基线见 `docs/superpowers/specs/2026-06-06-p5-month-end-design.md`。

---

## Task 1: 后端 — MonthEndService 放行物料口径 + 账本/发现 SQL + DbTest

**Files:**
- Modify: `src/ErpApi/Features/MonthEnd/MonthEndService.cs`
- Modify: `tests/ErpApi.Tests/MonthEndServiceDbTests.cs`

- [ ] **Step 1: 放行 `物料` 口径**

`MonthEndService.cs` 的 `NormalizeKind`，把：
```csharp
        if (k != "成品" && k != "半成品") throw new ArgumentException("口径须为 成品 或 半成品。");
```
改为：
```csharp
        if (k != "成品" && k != "半成品" && k != "物料") throw new ArgumentException("口径须为 成品 / 半成品 / 物料。");
```

- [ ] **Step 2: 新增物料账本与发现 SQL 常量**

在 `半成品仓库Sql` 常量之后（类内）追加：
```csharp
    // ---- 物料(原料)账本：物料编号×仓库(忽略颜色，与 MaterialInventoryService 一致)。审核在单头→JOIN 单头。----
    private const string 物料账本Sql = @"
WITH 账本 AS (
    SELECT d.物料编号,d.物料名称,d.规格,d.单位,d.[日期], ISNULL(d.数量,0)    AS 签
      FROM [采购入仓明细单] d JOIN [采购入仓单] h ON h.单号=d.单号 WHERE d.仓库=@仓 AND ISNULL(h.审核,'0')='1'
    UNION ALL
    SELECT d.物料编号,d.物料名称,d.规格,d.单位,d.[日期], ISNULL(d.数量,0)
      FROM [退料明细单] d JOIN [退料单] h ON h.单号=d.单号 WHERE d.仓库=@仓 AND ISNULL(h.审核,'0')='1'
    UNION ALL
    SELECT d.物料编号,d.物料名称,d.规格,d.单位,d.[日期], ISNULL(d.数量,0)*-1
      FROM [领料明细单] d JOIN [领料单] h ON h.单号=d.单号 WHERE d.仓库=@仓 AND ISNULL(h.审核,'0')='1'
)
SELECT 物料编号, MAX(物料名称) AS 物料名称, MAX(规格) AS 规格, MAX(单位) AS 单位,
       SUM(CASE WHEN [日期] <  @月初 THEN 签 ELSE 0 END)                                  AS 期初,
       SUM(CASE WHEN [日期] >= @月初 AND [日期] < @下月初 AND 签 > 0 THEN 签  ELSE 0 END) AS 本期入,
       SUM(CASE WHEN [日期] >= @月初 AND [日期] < @下月初 AND 签 < 0 THEN -签 ELSE 0 END) AS 本期出
FROM 账本
GROUP BY 物料编号
HAVING SUM(CASE WHEN [日期] < @下月初 THEN 签 ELSE 0 END) <> 0
    OR SUM(CASE WHEN [日期] >= @月初 AND [日期] < @下月初 THEN ABS(签) ELSE 0 END) > 0;";

    private const string 物料仓库Sql = @"
SELECT DISTINCT 仓库 FROM (
    SELECT d.仓库 FROM [采购入仓明细单] d JOIN [采购入仓单] h ON h.单号=d.单号 WHERE ISNULL(h.审核,'0')='1' AND d.[日期] < @下月初
    UNION SELECT d.仓库 FROM [退料明细单] d JOIN [退料单] h ON h.单号=d.单号 WHERE ISNULL(h.审核,'0')='1' AND d.[日期] < @下月初
    UNION SELECT d.仓库 FROM [领料明细单] d JOIN [领料单] h ON h.单号=d.单号 WHERE ISNULL(h.审核,'0')='1' AND d.[日期] < @下月初
) t WHERE 仓库 IS NOT NULL AND 仓库 <> N'';";
```

- [ ] **Step 3: CloseAsync 三元选择账本与发现 SQL**

在 `CloseAsync` 中，把发现 SQL 选择（当前）：
```csharp
        List<string> whs = string.IsNullOrWhiteSpace(req.仓库)
            ? (await c.QueryAsync<string>(口径 == "成品" ? 成品仓库Sql : 半成品仓库Sql, new { 下月初 }, tx)).ToList()
            : [req.仓库.Trim()];
```
改为：
```csharp
        List<string> whs = string.IsNullOrWhiteSpace(req.仓库)
            ? (await c.QueryAsync<string>(
                口径 == "成品" ? 成品仓库Sql : 口径 == "半成品" ? 半成品仓库Sql : 物料仓库Sql, new { 下月初 }, tx)).ToList()
            : [req.仓库.Trim()];
```
并把账本选择（当前）：
```csharp
        var ledger = 口径 == "成品" ? 成品账本Sql : 半成品账本Sql;
```
改为：
```csharp
        var ledger = 口径 == "成品" ? 成品账本Sql : 口径 == "半成品" ? 半成品账本Sql : 物料账本Sql;
```
（`ReopenAsync`/`ReportAsync`/`PeriodsAsync` 无需改动——它们只依赖 `NormalizeKind` 与按 `口径` 字符串过滤。）

- [ ] **Step 4: 写物料口径 DbTest（红）**

在 `MonthEndServiceDbTests` 类内追加。物料明细 FK 物料编号→物料资料；款号/生产单号留 NULL 避其它 FK。`Clean物料` 删明细/单头/物料资料。

```csharp
    private static void Clean物料(Microsoft.Data.SqlClient.SqlConnection c, string wh)
    {
        c.Execute("DELETE FROM [采购入仓明细单] WHERE [仓库]=@wh", new { wh });
        c.Execute("DELETE FROM [采购入仓单]   WHERE [单号]=N'MMR_L'");
        c.Execute("DELETE FROM [领料明细单]   WHERE [仓库]=@wh", new { wh });
        c.Execute("DELETE FROM [领料单]       WHERE [单号]=N'MML_T'");
        c.Execute("DELETE FROM [结存快照表]   WHERE [仓库]=@wh", new { wh });
        c.Execute("DELETE FROM [物料资料]     WHERE [物料编号]=N'MM1'");
    }
    private static void Seed物料(Microsoft.Data.SqlClient.SqlConnection c)
    {
        c.Execute("IF NOT EXISTS (SELECT 1 FROM [物料资料] WHERE [物料编号]=N'MM1') INSERT INTO [物料资料]([物料编号],[物料名称],[规格],[单位]) VALUES(N'MM1',N'原料甲',N'规X',N'KG')");
    }

    [SkippableFact]
    public async Task Close_物料_单仓_期初本期入本期出结存()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        const string wh = "ME原料仓A";
        using var c = fx.Open();
        Clean物料(c, wh); Seed物料(c);
        try
        {
            // 上月采购入仓 100（单头审核'1'）
            c.Execute("INSERT INTO [采购入仓单]([单号],[日期],[仓库],[审核]) VALUES(N'MMR_L',@d,@wh,'1')", new { d = 上月日期, wh });
            c.Execute("INSERT INTO [采购入仓明细单]([单号],[日期],[仓库],[物料编号],[物料名称],[规格],[单位],[数量]) VALUES(N'MMR_L',@d,@wh,N'MM1',N'原料甲',N'规X',N'KG',100)", new { d = 上月日期, wh });
            // 本月领料 30
            c.Execute("INSERT INTO [领料单]([单号],[日期],[仓库],[审核]) VALUES(N'MML_T',@d,@wh,'1')", new { d = 本月日期, wh });
            c.Execute("INSERT INTO [领料明细单]([单号],[日期],[仓库],[物料编号],[物料名称],[规格],[单位],[数量]) VALUES(N'MML_T',@d,@wh,N'MM1',N'原料甲',N'规X',N'KG',30)", new { d = 本月日期, wh });

            var res = await Svc().CloseAsync(new MonthEndCloseRequest { 年月 = 年月, 口径 = "物料", 仓库 = wh }, "tester");
            Assert.Equal(1, res.结数);

            var row = c.QueryFirst<(decimal 期初, decimal 本期入, decimal 本期出, decimal 结存)>(
                "SELECT [期初],[本期入],[本期出],[结存] FROM [结存快照表] WHERE [年月]=@年月 AND [口径]=N'物料' AND [仓库]=@wh", new { 年月, wh });
            Assert.Equal(100m, row.期初);
            Assert.Equal(0m,   row.本期入);
            Assert.Equal(30m,  row.本期出);
            Assert.Equal(70m,  row.结存);

            // 单位带出
            var 单位 = c.QueryFirst<string>("SELECT [单位] FROM [结存快照表] WHERE [年月]=@年月 AND [口径]=N'物料' AND [仓库]=@wh", new { 年月, wh });
            Assert.Equal("KG", 单位);
        }
        finally { Clean物料(c, wh); }
    }
```
注：`Clean物料` 对单头按固定单号删（采购入仓单/领料单 无 仓库 列也能按单号删；若它们有 仓库 列亦可按仓库删——读表结构择一，按单号删最稳妥）。`上月日期`/`本月日期`/`年月`/`Svc()` 复用文件已有常量与方法。

- [ ] **Step 5: 跑测试（绿）**

先 `Get-Process -Name ErpApi -ErrorAction SilentlyContinue | Stop-Process -Force`。
Run: `dotnet test tests/ErpApi.Tests --filter MonthEndServiceDbTests` → 预期 9 passed / 0 skipped（8 旧 + 1 新）。
再跑全量 `dotnet test tests/ErpApi.Tests` → 预期 145 passed / 0 skipped。
若物料口径断言失败，多半是账本 SQL 的列名/JOIN/日期谓词问题——修服务 SQL，不改断言。

- [ ] **Step 6: Commit**
```bash
git add src/ErpApi/Features/MonthEnd/MonthEndService.cs tests/ErpApi.Tests/MonthEndServiceDbTests.cs
git commit -m "feat(P5): 月结放行物料口径(物料编号×仓库忽略颜色,复用采购入仓/退料/领料账本)+DbTest"
```

---

## Task 2: 前端 — 口径加「物料」+ 维度列 + util 测试

**Files:**
- Modify: `web/src/utils/monthEnd.ts`
- Modify: `web/src/pages/warehouse/MonthEnd.tsx`
- Modify: `web/src/__tests__/monthEnd.test.ts`

- [ ] **Step 1: 扩展 Kind 与 dimColumns**

`web/src/utils/monthEnd.ts`：
- 把 `export type Kind = "成品" | "半成品";` 改为 `export type Kind = "成品" | "半成品" | "物料";`
- 在 `dimColumns` 里把当前的二元三目改为成品/半成品/物料三分支。完整替换 `dimColumns` 为：
```ts
export function dimColumns(kind: Kind): { title: string; dataIndex: string }[] {
  if (kind === "成品")
    return [
      { title: "仓库", dataIndex: "仓库" },
      { title: "款号", dataIndex: "款号" },
      { title: "色号", dataIndex: "色号" },
      { title: "颜色", dataIndex: "颜色" },
      { title: "尺码", dataIndex: "尺码" },
    ];
  if (kind === "半成品")
    return [
      { title: "仓库", dataIndex: "仓库" },
      { title: "物料编号", dataIndex: "物料编号" },
      { title: "规格", dataIndex: "规格" },
      { title: "颜色", dataIndex: "颜色" },
    ];
  return [
    { title: "仓库", dataIndex: "仓库" },
    { title: "物料编号", dataIndex: "物料编号" },
    { title: "物料名称", dataIndex: "物料名称" },
    { title: "规格", dataIndex: "规格" },
    { title: "单位", dataIndex: "单位" },
  ];
}
```
（`toYearMonth` 不变。）

- [ ] **Step 2: 口径 Select 加「物料」项**

`web/src/pages/warehouse/MonthEnd.tsx`，把：
```tsx
            options={[{ value: "成品", label: "成品" }, { value: "半成品", label: "半成品" }]} />
```
改为：
```tsx
            options={[{ value: "成品", label: "成品" }, { value: "半成品", label: "半成品" }, { value: "物料", label: "物料" }]} />
```

- [ ] **Step 3: util 测试加物料断言（红）**

`web/src/__tests__/monthEnd.test.ts`，在 `dimColumns 按口径切换维度列` 测试体末尾追加：
```ts
    const mat = dimColumns("物料").map(c => c.dataIndex);
    expect(mat).toContain("物料编号");
    expect(mat).toContain("单位");
    expect(mat).not.toContain("款号");
    expect(mat).not.toContain("颜色");
```

- [ ] **Step 4: 跑前端测试 + 构建（绿）**

Run: `npm --prefix web run test -- --run monthEnd` → 2 passed（断言增多仍 2 个 it）。
Run: `npm --prefix web run build` → 无 TS 错误。

- [ ] **Step 5: Commit**
```bash
git add web/src/utils/monthEnd.ts web/src/pages/warehouse/MonthEnd.tsx web/src/__tests__/monthEnd.test.ts
git commit -m "feat(P5): 月结前端口径加物料(物料编号×仓库维度列)+util测试"
```

---

## Task 3: 验证 + 收尾

- [ ] **Step 1: 全量回归**

`Get-Process -Name ErpApi -ErrorAction SilentlyContinue | Stop-Process -Force` 后：
Run: `dotnet test tests/ErpApi.Tests`（预期 145 全过）；`npm --prefix web run test -- --run`（预期全过）；`npm --prefix web run build`（通过）。

- [ ] **Step 2: 整体终审**

派整体 code-reviewer 审本分支全部改动（或控制器自查 diff 范围只动了 service+前端+测试）。

- [ ] **Step 3: 收尾**

superpowers:finishing-a-development-branch：验证测试→合并 master 本地→删分支。合并后重启后端(5000)+前端(5173)，更新记忆 `erp-status.md`（在 P5 月结条目补「物料口径」）+ `MEMORY.md`。

---

## Self-Review

- **Spec 覆盖**：放行物料口径(T1S1)、物料账本+发现SQL(T1S2)、CloseAsync三元(T1S3)、DbTest(T1S4)、前端Kind/dimColumns/Select(T2)、util测试(T2S3)、回归+收尾(T3)。零改表（设计已确认无需 ALTER）。✓
- **占位符**：无。每步给完整代码/命令/期望值。✓
- **类型/命名一致**：口径值 `物料`、维度 `物料编号×仓库`、`Kind` 三值、SQL 常量名 `物料账本Sql`/`物料仓库Sql` 与既有 `成品/半成品*Sql` 同构；测试数据 物料编号 `MM1`、单号 `MMR_L`/`MML_T`、年月沿用 `202602`。✓
- **关键坑**：物料按 物料编号 GROUP（忽略颜色，对齐实时库存）；明细 JOIN 单头取审核；`ISNULL`/`ABS(签)`/`<下月初` 同其它口径；测试只 seed 物料资料、款号/生产单号留 NULL 避 FK；ErpApi 占用先 Stop-Process。✓
