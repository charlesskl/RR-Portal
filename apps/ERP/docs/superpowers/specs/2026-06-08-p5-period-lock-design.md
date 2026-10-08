# 硬月结锁期 设计

> 兴信B ERP 净室重建 · P5 仓储模块**收官项** · 2026-06-08 · 月结的强制层

**目标**：月结后，禁止对**已结期间**（该月及更早，按 仓库+口径）的仓储单据做 录入/审核/反审核，保护已结快照不被篡改。统一在控制器层加锁，命中返回 409。完成后 P5 正式收官。

**已确认决策（与用户）**：
- P5 收尾只做硬月结锁期；快照接热路径=YAGNI 丢弃、半成品BOM转化=移生产模块、成品/半成品加权成本=移 P7。
- 锁定操作：**录入(Create) + 审核(Approve) + 反审核(Unapprove)**。**Delete 不加锁**（只删未审核单，未审核不在库存账本，删它不影响已结快照）。
- 统一控制器层加锁（不改 12 个 service 签名）。

---

## 1. 锁定规则

单据 (口径 K, 仓库 W, 日期 D) **被锁** ⟺ `结存快照表` 存在 `口径=K AND 仓库=W AND 年月 >= yyyyMM(D)` 的行。

含义：一旦月结某月 M（该仓+口径生成了 年月=M 的快照），凡 **日期 ≤ M 月末** 的单据全部锁定（yyyyMM(D) ≤ M ≤ 已存在的快照年月）；日期在更晚月（未结）的不锁。反月结删快照后自动解锁。

## 2. PeriodLockService（新建 `src/ErpApi/Features/MonthEnd/PeriodLockService.cs`）

```csharp
using Dapper;
using ErpApi.Infrastructure.Db;
using Microsoft.Data.SqlClient;
namespace ErpApi.Features.MonthEnd;

public sealed class PeriodLockedException(string message) : Exception(message);

// 硬月结锁期：已结期间(该仓+口径,年月>=单据月)禁止录入/审核/反审核。读 结存快照表 判锁。
public sealed class PeriodLockService(ISqlConnectionFactory factory)
{
    public async Task<bool> IsLockedAsync(string 口径, string? 仓库, DateTime 日期, SqlConnection c, SqlTransaction? tx = null)
    {
        if (string.IsNullOrWhiteSpace(仓库)) return false;
        var ym = 日期.ToString("yyyyMM");
        var n = await c.ExecuteScalarAsync<int>(
            "SELECT COUNT(*) FROM [结存快照表] WHERE 口径=@口径 AND 仓库=@仓 AND 年月>=@ym",
            new { 口径, 仓 = 仓库.Trim(), ym }, tx);
        return n > 0;
    }
    private static PeriodLockedException Locked(string 口径, string 仓库, DateTime d) =>
        new($"仓库[{仓库}] {d:yyyy-MM} 期间已月结锁定（{口径}），不能录入/审核/反审核该期间单据，请先反月结。");

    // 录入用：校验某仓某日期（自开连接）
    public async Task EnsureWarehouseOpenAsync(string 口径, string? 仓库, DateTime 日期)
    {
        if (string.IsNullOrWhiteSpace(仓库)) return;
        using var c = factory.Create(); await c.OpenAsync();
        if (await IsLockedAsync(口径, 仓库, 日期, c)) throw Locked(口径, 仓库!.Trim(), 日期);
    }
    // 审核/反审核用：从单头表(有 仓库+日期 列)读取校验。table 为内部常量,非用户输入。
    public async Task EnsureHeaderOpenAsync(string 口径, string table, string 单号)
    {
        using var c = factory.Create(); await c.OpenAsync();
        var row = await c.QueryFirstOrDefaultAsync(
            $"SELECT [仓库] AS 仓库,[日期] AS 日期 FROM [{table}] WHERE [单号]=@单号", new { 单号 });
        if (row is null) return;
        string? 仓库 = row.仓库; DateTime? 日期 = row.日期;
        if (仓库 != null && 日期 != null && await IsLockedAsync(口径, 仓库, 日期.Value, c))
            throw Locked(口径, 仓库, 日期.Value);
    }
    // 成品调拨专用：日期在单头,源/目标仓库在明细,任一锁定即拒。
    public async Task EnsureTransferOpenAsync(string 单号)
    {
        using var c = factory.Create(); await c.OpenAsync();
        var 日期 = await c.ExecuteScalarAsync<DateTime?>("SELECT [日期] FROM [成品调拨单] WHERE [单号]=@单号", new { 单号 });
        if (日期 is null) return;
        var whs = await c.QueryAsync<string>(
            @"SELECT 源仓库 FROM [成品调拨明细单] WHERE 单号=@单号 AND 源仓库 IS NOT NULL
              UNION SELECT 目标仓库 FROM [成品调拨明细单] WHERE 单号=@单号 AND 目标仓库 IS NOT NULL", new { 单号 });
        foreach (var w in whs)
            if (await IsLockedAsync("成品", w, 日期.Value, c)) throw Locked("成品", w, 日期.Value);
    }
}
```

DI：`Program.cs` 注册 `builder.Services.AddScoped<ErpApi.Features.MonthEnd.PeriodLockService>();`。

## 3. 控制器加锁（12 个，注入 `PeriodLockService periodLock` + 加 `口径` 常量）

各控制器加一个 `private const string 口径 = "成品"|"半成品"|"物料";`，ctor 末尾加 `PeriodLockService periodLock`。

口径映射：
- **成品**(6)：FinishedReceipt(成品入仓单)、FinishedIssue(成品出仓单)、FinishedSalesReturn(成品退货单)、FinishedStocktake(成品盘点单)、FinishedVendorReturn(成品退仓单)、FinishedTransfer(成品调拨单·特殊)。
- **半成品**(3)：SemiReceipt(半成品入仓单)、SemiIssue(半成品领料单)、SemiStocktake(半成品盘点单)。
- **物料**(3)：PurchaseReceipt(采购入仓单)、MaterialIssue(领料单)、MaterialReturn(退料单)。

**Create**（在 `保存` 权限校验之后、调 `svc.CreateAsync` 之前）：
- 标准单：
  ```csharp
  try { await periodLock.EnsureWarehouseOpenAsync(口径, dto.仓库, DateTime.Now); }
  catch (PeriodLockedException ex) { return Conflict(new { 消息 = ex.Message }); }
  ```
- 成品调拨（无单头仓库，明细带源/目标仓库）：
  ```csharp
  try {
      foreach (var w in dto.明细.SelectMany(l => new[] { l.源仓库, l.目标仓库 })
                   .Where(x => !string.IsNullOrWhiteSpace(x)).Distinct())
          await periodLock.EnsureWarehouseOpenAsync("成品", w, DateTime.Now);
  } catch (PeriodLockedException ex) { return Conflict(new { 消息 = ex.Message }); }
  ```
  （需 `using System.Linq;`。`dto.明细` 行类型字段名以实际 DTO 为准。）

**Approve / Unapprove**（在 `审核`/`反审核` 权限校验之后、调 `posting.ApproveAsync/UnapproveAsync` 之前）：
- 标准单：
  ```csharp
  try { await periodLock.EnsureHeaderOpenAsync(口径, Table, 单号); }
  catch (PeriodLockedException ex) { return Conflict(new { 消息 = ex.Message }); }
  ```
- 成品调拨：`try { await periodLock.EnsureTransferOpenAsync(单号); } catch (PeriodLockedException ex) { return Conflict(new { 消息 = ex.Message }); }`

**Delete**：不加锁。

## 4. 测试

- 后端 `PeriodLockServiceDbTests`：月结某仓某口径某月后——该月日期 `IsLockedAsync`=true、更早月=true、更晚月=false、未结仓/口径=false；反月结(删快照)后=false。
- 后端集成测试（每口径 1 个，扩 `P5MonthEndApiIntegrationTests` 或新建）：造该仓本月审核入库→月结本月→①再录入该仓本月单 → 409；②审核/反审核该期间已存在单 → 409；③更晚月单不受影响（可选）。物料口径必测；半成品/成品各补一条审核锁定用例（成品含调拨）。
- 不破坏现有 147 后端 / 20 前端测试。

## 5. 前端

可选：月报页或单据页提示"已锁定"。**本期不做前端**——后端 409 + 消息已足够，前端按现有错误提示展示（各单据页 message.error 已显示后端消息）。保持本切片纯后端、低风险。

## 6. 范围外 / P5 收官

锁期不含 Delete（未审核单无害）；不做前端专门 UI；快照热路径/半成品BOM转化/成品半成品加权成本已归类移出 P5。本切片合并后 **P5 仓储模块正式收官**，下一步 P6 下游。

## 7. 风险与对策

| 风险 | 对策 |
|---|---|
| 12 控制器漏改 | 按口径分组逐组实现+集成测试每口径覆盖；终审 diff 核对 12 个都注入+加校验。 |
| 成品调拨仓库在明细 | 专用 `EnsureTransferOpenAsync`（单头取日期+明细取源/目标仓库）。 |
| `table` 拼进 SQL | 仅内部常量(Table)，非用户输入，无注入面。 |
| 创建日期=now 与服务端 now 微差 | 同月，锁判定一致。 |
| 反月结解锁 | 锁查实时读快照，反月结删行后立即解锁，无缓存。 |
| 误锁未审核单的删除 | Delete 不加锁，避免无谓拦截。 |
