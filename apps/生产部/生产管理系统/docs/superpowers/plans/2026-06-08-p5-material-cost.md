# 物料加权出库成本 / 金额月结 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 给物料月结加成本层——全月一次加权平均算出库成本，快照记 期初/本期入/本期出/结存金额 + 加权单价；仅物料口径；金额列受成本保密保护；不回写出库单据。

**Architecture:** `结存快照表` 加 5 个金额列；`MonthEndService.CloseAsync` 仅对 `口径=='物料'` 算金额（本期入金额取自账本入库金额、期初金额取自上期快照结存金额、加权单价=（期初金额+本期入金额）/（期初数量+本期入数量）、本期出金额=本期出数量×加权单价）；`MonthEndController.Report` 缺 `单价` 权限时金额列置 null；前端月结页物料口径展示金额列。

**Tech Stack:** .NET 8 + Dapper；React + TS + AntD v6 + Vitest；xUnit。依据 `docs/superpowers/specs/2026-06-08-p5-material-cost-design.md`。

---

## Task 1: DB — 结存快照表加 5 个金额列 + 加载脚本 + 部署

**Files:** Create `db/10b_p5_material_cost.sql`；Modify `db/run-db.ps1`.

- [ ] **Step 1: 写 10 脚本（幂等）**
```sql
-- P5 物料加权成本：结存快照表加金额列（物料口径填，成品/半成品留 NULL）。幂等。
SET XACT_ABORT ON;
IF COL_LENGTH(N'结存快照表', N'期初金额')  IS NULL ALTER TABLE [结存快照表] ADD [期初金额]  decimal(18,4) NULL;
IF COL_LENGTH(N'结存快照表', N'本期入金额') IS NULL ALTER TABLE [结存快照表] ADD [本期入金额] decimal(18,4) NULL;
IF COL_LENGTH(N'结存快照表', N'本期出金额') IS NULL ALTER TABLE [结存快照表] ADD [本期出金额] decimal(18,4) NULL;
IF COL_LENGTH(N'结存快照表', N'结存金额')  IS NULL ALTER TABLE [结存快照表] ADD [结存金额]  decimal(18,4) NULL;
IF COL_LENGTH(N'结存快照表', N'加权单价')  IS NULL ALTER TABLE [结存快照表] ADD [加权单价]  decimal(18,4) NULL;
```

- [ ] **Step 2: run-db.ps1 追加 10**

把 `09_p5_month_end.sql` 那行末尾加续行反引号，并追加：
```powershell
  (Join-Path $dir "09_p5_month_end.sql") `
  (Join-Path $dir "10b_p5_material_cost.sql")
```

- [ ] **Step 3: 部署两库 + 验证列**
```powershell
& "D:\WebpageERP\db\run-db.ps1" -ConnectionString $env:ERP_DB
& "D:\WebpageERP\db\run-db.ps1" -ConnectionString $env:ERP_TEST_DB
dotnet run --project D:\WebpageERP\tmp\dbquery -- $env:ERP_DB "SELECT COL_LENGTH('结存快照表','加权单价') AS 加权单价, COL_LENGTH('结存快照表','结存金额') AS 结存金额"
dotnet run --project D:\WebpageERP\tmp\dbquery -- $env:ERP_TEST_DB "SELECT COL_LENGTH('结存快照表','加权单价') AS 加权单价, COL_LENGTH('结存快照表','结存金额') AS 结存金额"
```
Expected：两库均非 NULL。（若 run-db.ps1 输出 lenient 跳过噪音属正常；关键是 10 脚本 strict 无错、列出现。ErpApi 占用先 `Get-Process -Name ErpApi -ErrorAction SilentlyContinue | Stop-Process -Force`。）

- [ ] **Step 4: Commit**
```bash
git add db/10b_p5_material_cost.sql db/run-db.ps1
git commit -m "feat(P5): 结存快照表加金额列(期初/本期入/本期出/结存金额+加权单价)+加载脚本"
```

---

## Task 2: 后端 — 物料加权成本计算 + DbTest

**Files:** Modify `src/ErpApi/Features/MonthEnd/MonthEndDtos.cs`, `src/ErpApi/Features/MonthEnd/MonthEndService.cs`, `tests/ErpApi.Tests/MonthEndServiceDbTests.cs`.

- [ ] **Step 1: MonthEndRow 加 5 个可空金额字段**

`MonthEndDtos.cs` 的 `MonthEndRow` 类，在 `public decimal 结存 { get; set; }` 之后追加：
```csharp
    public decimal? 期初金额 { get; set; }
    public decimal? 本期入金额 { get; set; }
    public decimal? 本期出金额 { get; set; }
    public decimal? 结存金额 { get; set; }
    public decimal? 加权单价 { get; set; }
```

- [ ] **Step 2: 物料账本Sql 增 本期入金额**

把现有 `物料账本Sql` 整块替换为（每段加 `金额签`、SELECT 加 `本期入金额`）：
```csharp
    private const string 物料账本Sql = @"
WITH 账本 AS (
    SELECT d.物料编号,d.物料名称,d.规格,d.单位,d.[日期], ISNULL(d.数量,0)    AS 签, ISNULL(d.金额,0) AS 金额签
      FROM [采购入仓明细单] d JOIN [采购入仓单] h ON h.单号=d.单号 WHERE d.仓库=@仓 AND ISNULL(h.审核,'0')='1'
    UNION ALL
    SELECT d.物料编号,d.物料名称,d.规格,d.单位,d.[日期], ISNULL(d.数量,0),    ISNULL(d.金额,0)
      FROM [退料明细单] d JOIN [退料单] h ON h.单号=d.单号 WHERE d.仓库=@仓 AND ISNULL(h.审核,'0')='1'
    UNION ALL
    SELECT d.物料编号,d.物料名称,d.规格,d.单位,d.[日期], ISNULL(d.数量,0)*-1, 0
      FROM [领料明细单] d JOIN [领料单] h ON h.单号=d.单号 WHERE d.仓库=@仓 AND ISNULL(h.审核,'0')='1'
)
SELECT 物料编号, MAX(物料名称) AS 物料名称, MAX(规格) AS 规格, MAX(单位) AS 单位,
       SUM(CASE WHEN [日期] <  @月初 THEN 签 ELSE 0 END)                                  AS 期初,
       SUM(CASE WHEN [日期] >= @月初 AND [日期] < @下月初 AND 签 > 0 THEN 签  ELSE 0 END) AS 本期入,
       SUM(CASE WHEN [日期] >= @月初 AND [日期] < @下月初 AND 签 < 0 THEN -签 ELSE 0 END) AS 本期出,
       SUM(CASE WHEN [日期] >= @月初 AND [日期] < @下月初 THEN 金额签 ELSE 0 END)         AS 本期入金额
FROM 账本
GROUP BY 物料编号
HAVING SUM(CASE WHEN [日期] < @下月初 THEN 签 ELSE 0 END) <> 0
    OR SUM(CASE WHEN [日期] >= @月初 AND [日期] < @下月初 THEN ABS(签) ELSE 0 END) > 0;";
```

- [ ] **Step 3: 新增 物料期初金额Sql 常量**

在 `物料仓库Sql` 常量之后追加：
```csharp
    // ---- 物料期初金额：上一期快照(同仓+口径'物料'，年月<当前的最近一条)的结存金额。无上期→该物料编号取0。----
    private const string 物料期初金额Sql = @"
SELECT s.物料编号, s.结存金额
FROM [结存快照表] s
JOIN (
    SELECT 物料编号, MAX(年月) AS m
    FROM [结存快照表]
    WHERE 仓库=@仓 AND 口径=N'物料' AND 年月 < @年月
    GROUP BY 物料编号
) x ON x.物料编号 = s.物料编号 AND x.m = s.年月
WHERE s.仓库=@仓 AND s.口径=N'物料' AND s.年月 < @年月;";
```

- [ ] **Step 4: InsertSql 加 5 个金额列**

把 `InsertSql` 整块替换为：
```csharp
    private const string InsertSql = @"
INSERT INTO [结存快照表]([年月],[仓库],[口径],[款号],[款式],[色号],[颜色],[尺码],[物料编号],[物料名称],[规格],[单位],[期初],[本期入],[本期出],[结存],[期初金额],[本期入金额],[本期出金额],[结存金额],[加权单价],[生成时间])
VALUES(@年月,@仓库,@口径,@款号,@款式,@色号,@颜色,@尺码,@物料编号,@物料名称,@规格,@单位,@期初,@本期入,@本期出,@结存,@期初金额,@本期入金额,@本期出金额,@结存金额,@加权单价,@生成时间);";
```

- [ ] **Step 5: CloseAsync — 物料金额计算 + INSERT 带金额**

把 `CloseAsync` 中 `foreach (var wh in whs)` 整个循环体替换为：
```csharp
        foreach (var wh in whs)
        {
            var rows = (await c.QueryAsync<MonthEndRow>(ledger, new { 仓 = wh, 月初, 下月初 }, tx)).ToList();

            // 物料口径：全月一次加权平均。期初金额取上期快照结存金额（序贯）。
            Dictionary<string, decimal> 期初金额表 = new();
            if (口径 == "物料")
            {
                var prior = await c.QueryAsync(物料期初金额Sql, new { 仓 = wh, 年月 = req.年月 }, tx);
                foreach (var p in prior)
                    期初金额表[(string)p.物料编号] = (decimal)p.结存金额;
            }

            foreach (var r in rows)
            {
                r.年月 = req.年月; r.仓库 = wh; r.口径 = 口径;
                r.结存 = r.期初 + r.本期入 - r.本期出;
                if (口径 == "物料")
                {
                    var 期初额 = (r.物料编号 != null && 期初金额表.TryGetValue(r.物料编号, out var pv)) ? pv : 0m;
                    var 入额 = r.本期入金额 ?? 0m;
                    var 分母 = r.期初 + r.本期入;
                    var 加权 = 分母 > 0 ? (期初额 + 入额) / 分母 : 0m;
                    r.期初金额 = 期初额;
                    r.本期入金额 = 入额;
                    r.加权单价 = decimal.Round(加权, 4);
                    r.本期出金额 = decimal.Round(r.本期出 * r.加权单价.Value, 4);
                    r.结存金额 = 期初额 + 入额 - r.本期出金额.Value;
                }
                await c.ExecuteAsync(InsertSql, new
                {
                    r.年月, r.仓库, r.口径, r.款号, r.款式, r.色号, r.颜色, r.尺码,
                    r.物料编号, r.物料名称, r.规格, r.单位, r.期初, r.本期入, r.本期出, r.结存,
                    r.期初金额, r.本期入金额, r.本期出金额, r.结存金额, r.加权单价, 生成时间 = now
                }, tx);
                结数++;
            }
        }
```
（成品/半成品口径：5 个金额字段保持 null，INSERT 写 NULL，数量月结行为不变。`QueryAsync` 不带泛型返回 dynamic 行，`(string)p.物料编号`/`(decimal)p.结存金额` 转型——与 Dapper 一致。）

- [ ] **Step 6: ReportAsync SELECT 带金额列**

把 `ReportAsync` 的 SQL 中 SELECT 列表（`...[本期出],[结存]` 那行）改为含金额列：
```sql
SELECT [年月],[仓库],[口径],[款号],[款式],[色号],[颜色],[尺码],[物料编号],[物料名称],[规格],[单位],[期初],[本期入],[本期出],[结存],[期初金额],[本期入金额],[本期出金额],[结存金额],[加权单价]
FROM [结存快照表]
WHERE [年月]=@年月 AND [口径]=@k AND (@仓库 IS NULL OR [仓库]=@仓库)
ORDER BY [仓库],[款号],[物料编号],[色号],[颜色],[尺码]
```

- [ ] **Step 7: 写序贯加权 DbTest（红）**

在 `MonthEndServiceDbTests` 追加（复用 `Clean物料`/`Seed物料MM1`/`Svc()`/`本月日期` 等已有成员；上月用 `"202601"`、本月 `"202602"`，日期 `2026-01-15`/`2026-02-10`）：
```csharp
    [SkippableFact]
    public async Task Close_物料_全月加权_序贯成本()
    {
        Skip.IfNot(fx.Available, "未设置 ERP_TEST_DB");
        const string wh = "ME成本仓";
        using var c = fx.Open();
        Clean物料(c, wh); Seed物料MM1(c);
        try
        {
            // 上月采购入仓 100 @单价10(金额1000)
            c.Execute("INSERT INTO [采购入仓单]([单号],[日期],[仓库],[审核]) VALUES(N'CST_R1',N'2026-01-15',@wh,'1')", new { wh });
            c.Execute("INSERT INTO [采购入仓明细单]([单号],[日期],[仓库],[物料编号],[物料名称],[规格],[单位],[数量],[单价],[金额]) VALUES(N'CST_R1',N'2026-01-15',@wh,N'MM1',N'原料甲',N'规X',N'KG',100,10,1000)", new { wh });
            await Svc().CloseAsync(new MonthEndCloseRequest { 年月 = "202601", 口径 = "物料", 仓库 = wh }, "tester");
            var m1 = c.QueryFirst<(decimal 结存数量, decimal 结存金额, decimal 加权单价)>(
                "SELECT [结存],[结存金额],[加权单价] FROM [结存快照表] WHERE [年月]='202601' AND [口径]=N'物料' AND [仓库]=@wh", new { wh });
            Assert.Equal(100m, m1.结存数量);
            Assert.Equal(1000m, m1.结存金额);
            Assert.Equal(10m, m1.加权单价);

            // 本月采购入仓 50 @单价14(金额700) + 领料 30
            c.Execute("INSERT INTO [采购入仓单]([单号],[日期],[仓库],[审核]) VALUES(N'CST_R2',N'2026-02-10',@wh,'1')", new { wh });
            c.Execute("INSERT INTO [采购入仓明细单]([单号],[日期],[仓库],[物料编号],[物料名称],[规格],[单位],[数量],[单价],[金额]) VALUES(N'CST_R2',N'2026-02-10',@wh,N'MM1',N'原料甲',N'规X',N'KG',50,14,700)", new { wh });
            c.Execute("INSERT INTO [领料单]([单号],[日期],[仓库],[审核]) VALUES(N'CST_L1',N'2026-02-10',@wh,'1')", new { wh });
            c.Execute("INSERT INTO [领料明细单]([单号],[日期],[仓库],[物料编号],[物料名称],[规格],[单位],[数量]) VALUES(N'CST_L1',N'2026-02-10',@wh,N'MM1',N'原料甲',N'规X',N'KG',30)", new { wh });
            await Svc().CloseAsync(new MonthEndCloseRequest { 年月 = "202602", 口径 = "物料", 仓库 = wh }, "tester");

            var m2 = c.QueryFirst<(decimal 期初金额, decimal 本期入金额, decimal 本期出金额, decimal 结存金额, decimal 加权单价, decimal 结存数量)>(
                "SELECT [期初金额],[本期入金额],[本期出金额],[结存金额],[加权单价],[结存] FROM [结存快照表] WHERE [年月]='202602' AND [口径]=N'物料' AND [仓库]=@wh", new { wh });
            Assert.Equal(1000m, m2.期初金额);
            Assert.Equal(700m, m2.本期入金额);
            Assert.Equal(11.3333m, m2.加权单价);              // (1000+700)/(100+50)
            Assert.Equal(340.00m, Math.Round(m2.本期出金额, 2)); // 30×11.3333≈339.999→340.00(四舍五入到分)
            Assert.Equal(120m, m2.结存数量);
            Assert.Equal(1360m, Math.Round(m2.结存金额, 0));    // 1000+700-339.999≈1360.001→1360
        }
        finally
        {
            c.Execute("DELETE FROM [采购入仓明细单] WHERE [仓库]=@wh", new { wh });
            c.Execute("DELETE FROM [采购入仓单] WHERE [仓库]=@wh", new { wh });
            c.Execute("DELETE FROM [领料明细单] WHERE [仓库]=@wh", new { wh });
            c.Execute("DELETE FROM [领料单] WHERE [仓库]=@wh", new { wh });
            c.Execute("DELETE FROM [结存快照表] WHERE [仓库]=@wh", new { wh });
            c.Execute("DELETE FROM [物料资料] WHERE [物料编号]=N'MM1'");
        }
    }
```
注：`加权单价=11.3333`（round 到 4 位）；`本期出金额=30×11.3333=339.999`，断言用 `Math.Round(...,2)==340.00`；`结存金额=1000+700-339.999=1360.001`，断言 `Math.Round(...,0)==1360`。若想精确，亦可断言 `本期出金额` 在 (339.99, 340.01) 区间——但 round-to-2/round-to-0 已足够稳。

- [ ] **Step 8: 跑测试（绿）**

`Get-Process -Name ErpApi -ErrorAction SilentlyContinue | Stop-Process -Force`；
`dotnet test tests/ErpApi.Tests --filter MonthEndServiceDbTests` → 预期全过（含新用例）；
`dotnet test tests/ErpApi.Tests` → 预期全过（146）。
若金额断言差，多半是账本本期入金额列或加权公式/期初金额查询——修服务，不改断言数学。

- [ ] **Step 9: Commit**
```bash
git add src/ErpApi/Features/MonthEnd/MonthEndDtos.cs src/ErpApi/Features/MonthEnd/MonthEndService.cs tests/ErpApi.Tests/MonthEndServiceDbTests.cs
git commit -m "feat(P5): 物料全月一次加权平均出库成本(月结算期初/本期入出/结存金额+加权单价)+序贯DbTest"
```

---

## Task 3: 后端 — 月报金额成本保密 + API 测试

**Files:** Modify `src/ErpApi/Features/MonthEnd/MonthEndController.cs`, `tests/ErpApi.Tests/P5MonthEndApiIntegrationTests.cs`.

- [ ] **Step 1: Report 缺单价权限脱敏金额列**

`MonthEndController` 的 `Report` 方法体改为（取数后按 `单价` 权限脱敏；并把头部注释「仅数量、无脱敏」更新为含金额脱敏）：
```csharp
    [HttpGet]
    public async Task<IActionResult> Report(
        [FromQuery(Name = "年月")] string 年月, [FromQuery(Name = "口径")] string 口径,
        [FromQuery(Name = "仓库")] string? 仓库 = null)
    {
        if (!await AllowAsync(PermissionAction.打开)) return Forbid();
        IReadOnlyList<MonthEndRow> rows;
        try { rows = await svc.ReportAsync(年月, 口径, 仓库); }
        catch (ArgumentException ex) { return BadRequest(new { 消息 = ex.Message }); }
        if (!await AllowAsync(PermissionAction.单价))
            foreach (var r in rows)
            { r.期初金额 = null; r.本期入金额 = null; r.本期出金额 = null; r.结存金额 = null; r.加权单价 = null; }
        return Ok(rows);
    }
```
并把类顶注释 `// 库存月结 REST。...仅数量、无脱敏。` 改为 `// 库存月结 REST。打开=看月报/已结月份、功能=月结、删除=反月结。物料金额列缺 单价 权限时脱敏。`

- [ ] **Step 2: API 测试加成本保密用例（红）**

在 `P5MonthEndApiIntegrationTests` 追加。需造物料采购入仓(本月,审核)+月结，再用 有/无 `单价` 权限两个用户读月报。`SeedPerms` 现仅插 打开/删除/功能——加一个带 `单价` 的种子或扩展。简单起见在本测试内写独立 seed：

```csharp
    private void SeedPermsPrice(string user, bool price)
    {
        using var c = new SqlConnection(fx.ConnectionString); c.Open();
        c.Execute("DELETE FROM [userbqrpower] WHERE [用户]=@user AND [菜单]=N'库存月结'", new { user });
        c.Execute(@"INSERT INTO [userbqrpower]([用户],[菜单],[打开],[删除],[功能],[单价]) VALUES(@user,N'库存月结',1,1,1,@price)",
            new { user, price });
    }

    private const string costWh = "ME_API成本仓";
    private void SeedCostDocs()
    {
        using var c = new SqlConnection(fx.ConnectionString); c.Open();
        CleanCost();
        c.Execute("IF NOT EXISTS (SELECT 1 FROM [物料资料] WHERE [物料编号]=N'MMP1') INSERT INTO [物料资料]([物料编号],[物料名称],[规格],[单位]) VALUES(N'MMP1',N'保密料',N'规Y',N'KG')");
        c.Execute("INSERT INTO [采购入仓单]([单号],[日期],[仓库],[审核]) VALUES(N'CSTAPI',N'2026-03-10',@wh,'1')", new { wh = costWh });
        c.Execute("INSERT INTO [采购入仓明细单]([单号],[日期],[仓库],[物料编号],[物料名称],[规格],[单位],[数量],[单价],[金额]) VALUES(N'CSTAPI',N'2026-03-10',@wh,N'MMP1',N'保密料',N'规Y',N'KG',10,5,50)", new { wh = costWh });
    }
    private void CleanCost()
    {
        using var c = new SqlConnection(fx.ConnectionString); c.Open();
        c.Execute("DELETE FROM [采购入仓明细单] WHERE [仓库]=@wh", new { wh = costWh });
        c.Execute("DELETE FROM [采购入仓单] WHERE [仓库]=@wh", new { wh = costWh });
        c.Execute("DELETE FROM [结存快照表] WHERE [仓库]=@wh", new { wh = costWh });
        c.Execute("DELETE FROM [物料资料] WHERE [物料编号]=N'MMP1'");
    }

    [SkippableFact]
    public async Task Report_物料金额_按单价权限脱敏()
    {
        using var app = Factory();
        SeedCostDocs();
        try
        {
            // 先用有功能权限的用户月结物料 202603（含单价以便后续读到金额）
            SeedPermsPrice("me_cost", price: true);
            var client = Client(app, "me_cost");
            var close = await client.PostAsJsonAsync("/api/month-end/close", new { 年月 = "202603", 口径 = "物料", 仓库 = costWh });
            Assert.Equal(HttpStatusCode.OK, close.StatusCode);

            var url = $"/api/month-end?{Uri.EscapeDataString("年月")}=202603&{Uri.EscapeDataString("口径")}={Uri.EscapeDataString("物料")}&{Uri.EscapeDataString("仓库")}={Uri.EscapeDataString(costWh)}";

            // 有单价权限：加权单价非空(=5)
            var withPrice = await client.GetFromJsonAsync<JsonElement>(url);
            var r0 = withPrice.EnumerateArray().First();
            Assert.Equal(JsonValueKind.Number, r0.GetProperty("加权单价").ValueKind);
            Assert.Equal(5m, r0.GetProperty("加权单价").GetDecimal());

            // 无单价权限：金额列为 null，数量列仍在
            SeedPermsPrice("me_noprice", price: false);
            var noPrice = await Client(app, "me_noprice").GetFromJsonAsync<JsonElement>(url);
            var n0 = noPrice.EnumerateArray().First();
            Assert.Equal(JsonValueKind.Null, n0.GetProperty("加权单价").ValueKind);
            Assert.Equal(JsonValueKind.Null, n0.GetProperty("结存金额").ValueKind);
            Assert.Equal(10m, n0.GetProperty("结存").GetDecimal());  // 数量不脱敏
        }
        finally { CleanCost(); }
    }
```
（若 `userbqrpower` 部分列插入因 NOT NULL 失败，参照既有 `SeedPerms` 补齐列；现有 SeedPerms 用部分列插入是成功的，故 SeedPermsPrice 同样可行。）

- [ ] **Step 3: 跑测试（绿）**

`dotnet test tests/ErpApi.Tests --filter P5MonthEndApiIntegrationTests` → 预期全过（含新用例）；全量 `dotnet test tests/ErpApi.Tests` → 预期全过。

- [ ] **Step 4: Commit**
```bash
git add src/ErpApi/Features/MonthEnd/MonthEndController.cs tests/ErpApi.Tests/P5MonthEndApiIntegrationTests.cs
git commit -m "feat(P5): 月报金额列成本保密(缺单价权限置null)+API测试"
```

---

## Task 4: 前端 — 金额列展示

**Files:** Modify `web/src/api/monthEnd.ts`, `web/src/utils/monthEnd.ts`, `web/src/pages/warehouse/MonthEnd.tsx`, `web/src/__tests__/monthEnd.test.ts`.

- [ ] **Step 1: api 类型加金额字段**

`web/src/api/monthEnd.ts` 的 `MonthEndRow` 接口，在 `结存: number;` 后追加：
```ts
  期初金额?: number | null; 本期入金额?: number | null; 本期出金额?: number | null; 结存金额?: number | null; 加权单价?: number | null;
```

- [ ] **Step 2: utils 加 moneyColumns**

`web/src/utils/monthEnd.ts` 末尾追加：
```ts
// 物料口径的金额列(成本保密由服务端置 null 落地)；其它口径无金额列
export function moneyColumns(kind: Kind): { title: string; dataIndex: string }[] {
  if (kind !== "物料") return [];
  return [
    { title: "加权单价", dataIndex: "加权单价" },
    { title: "期初金额", dataIndex: "期初金额" },
    { title: "本期入金额", dataIndex: "本期入金额" },
    { title: "本期出金额", dataIndex: "本期出金额" },
    { title: "结存金额", dataIndex: "结存金额" },
  ];
}
```

- [ ] **Step 3: 页面拼接金额列**

`web/src/pages/warehouse/MonthEnd.tsx`：
- import 增 `moneyColumns`：把 `import { dimColumns, toYearMonth, type Kind } from "../../utils/monthEnd";` 改为 `import { dimColumns, moneyColumns, toYearMonth, type Kind } from "../../utils/monthEnd";`
- 在 `columns` 定义里，金额列追加在数量列之后。把现有 `const columns = [ ...dimColumns(kind), {期初}, {本期入}, {本期出}, {结存} ];` 改为在末尾加金额列（null 渲染为「—」）：
```tsx
  const money = (v: number | null | undefined) => (v == null ? "—" : v);
  const columns = [
    ...dimColumns(kind),
    { title: "期初", dataIndex: "期初", render: (v: number) => <span className="erp-num">{v}</span> },
    { title: "本期入", dataIndex: "本期入" },
    { title: "本期出", dataIndex: "本期出" },
    { title: "结存", dataIndex: "结存",
      render: (v: number) => <span style={{ fontWeight: 600, color: v < 0 ? "#cf1322" : undefined }}>{v}</span> },
    ...moneyColumns(kind).map(col => ({ ...col, render: (v: number | null) => money(v) })),
  ];
```
（保留原数量列定义不变，只在末尾追加 `moneyColumns` 映射。读取现有 `columns` 定义后做最小改动即可。）

- [ ] **Step 4: util 测试加 moneyColumns 断言**

`web/src/__tests__/monthEnd.test.ts` 加一个 it：
```ts
  it("moneyColumns 仅物料口径有金额列", () => {
    const m = moneyColumns("物料").map(c => c.dataIndex);
    expect(m).toContain("加权单价");
    expect(m).toContain("结存金额");
    expect(moneyColumns("成品")).toHaveLength(0);
    expect(moneyColumns("半成品")).toHaveLength(0);
  });
```
并把顶部 import 改为 `import { dimColumns, moneyColumns, toYearMonth } from "../utils/monthEnd";`。

- [ ] **Step 5: 测试 + 构建**

`npm --prefix web run test -- --run monthEnd`（预期 3 个 it 通过）；`npm --prefix web run test -- --run`（全过）；`npm --prefix web run build`（无 TS 错误）。

- [ ] **Step 6: Commit**
```bash
git add web/src/api/monthEnd.ts web/src/utils/monthEnd.ts web/src/pages/warehouse/MonthEnd.tsx web/src/__tests__/monthEnd.test.ts
git commit -m "feat(P5): 月结前端物料金额列展示(加权单价/期初/本期入出/结存金额,null→—)+util测试"
```

---

## Task 5: 验证 + 收尾

- [ ] **Step 1: 全量回归** — `Get-Process -Name ErpApi ... | Stop-Process -Force` 后 `dotnet test tests/ErpApi.Tests`（全过）；`npm --prefix web run test -- --run`（全过）；`npm --prefix web run build`（通过）。
- [ ] **Step 2: 整体终审** — diff 范围只动 db(10)+MonthEnd service/controller/dtos+测试+前端 4 文件。
- [ ] **Step 3: 收尾** — finishing-a-development-branch：合并 master 本地→删分支→重启 5000/5173→更新记忆（erp-status.md 在 P5 月结条目补「物料加权出库成本/金额月结」+剩余项去掉「加权出库成本」）。另把 `10b_p5_material_cost.sql` 已部署到 `erp`（Task1 已做）记一笔。

---

## Self-Review

- **Spec 覆盖**：金额列(T1)、本期入金额+期初金额查询+加权公式+InsertSql+ReportAsync+DbTest(T2)、成本保密+API测试(T3)、前端金额列+util测试(T4)、回归收尾(T5)。仅物料口径、不回写、序贯期初金额——均落实。✓
- **占位符**：无。每步完整代码/命令/期望值。✓
- **类型/命名一致**：`MonthEndRow` 5 金额字段(decimal?)贯穿 service/controller/api(number|null)；`物料账本Sql 本期入金额`↔`MonthEndRow.本期入金额`；`物料期初金额Sql` 返回 物料编号/结存金额；`moneyColumns` 仅物料；脱敏键 `单价` 权限。✓
- **关键坑**：期初金额序贯(上期快照结存金额,无则0)；加权除零→0；round 加权单价/本期出金额到4位、结存金额=期初+入−出(残差归结存);成本保密缺单价置null(数量不脱敏);成品/半成品金额列NULL;ErpApi占用先Stop-Process。✓
