# 库存月结（月结快照）设计

> 兴信B ERP 净室重建 · P5 仓储模块剩余项之一 · 2026-06-06

**目标**：按 `年月 × 仓库 × SKU` 把 期初 / 本期入 / 本期出 / 结存 滚存进 `结存快照表`，提供库存月报查询与反月结。**软月结**（只生成快照、不锁单据）、覆盖**成品 + 半成品**、**不改实时库存查询热路径**（FinishedGoodsAsync / SemiFinishedAsync 保持全量实时）。

**口径决策（已与用户确认）**：
- 覆盖：成品 + 半成品（物料/原料仓延后）。
- 架构：快照表 + 月报查询；实时库存不变（单厂数据量小，性能非瓶颈，不接入 `IInventorySnapshotProvider` 热路径——该插槽继续保留 `NullSnapshotProvider`）。
- 锁期：软月结（已结月份单据仍可改/审核，允许反月结重算）。
- 菜单：独立顶级组「月结管理」，当前一项「库存月结」。
- 月结粒度：close/reopen 时仓库参数缺省 = 该口径当月有流水的全部仓库一键处理；传仓库则只处理单仓。

---

## 1. 数据模型 — 扩展现有 `结存快照表`

`结存快照表`（`db/03_p0_additions.sql` 建，至今为空）现有列：
`ID, 年月 char(6), 仓库, 款号, 款式, 色号, 颜色, 尺码, 期初, 本期入, 本期出, 结存, 生成时间`，
唯一索引 `UX_结存快照_维度 (年月,仓库,款号,色号,颜色,尺码)`。

它只建模成品维度。新增幂等脚本 `db/09_p5_month_end.sql`：

```sql
-- 加半成品维度列（均可空，成品行留空、半成品行填）
IF COL_LENGTH(N'结存快照表', N'口径') IS NULL
    ALTER TABLE [结存快照表] ADD [口径] nvarchar(8) NOT NULL DEFAULT N'成品';
IF COL_LENGTH(N'结存快照表', N'物料编号') IS NULL
    ALTER TABLE [结存快照表] ADD [物料编号] nvarchar(30) NULL;
IF COL_LENGTH(N'结存快照表', N'物料名称') IS NULL
    ALTER TABLE [结存快照表] ADD [物料名称] nvarchar(40) NULL;
IF COL_LENGTH(N'结存快照表', N'规格') IS NULL
    ALTER TABLE [结存快照表] ADD [规格] nvarchar(40) NULL;
IF COL_LENGTH(N'结存快照表', N'单位') IS NULL
    ALTER TABLE [结存快照表] ADD [单位] nvarchar(10) NULL;

-- 重建唯一索引把 口径 + 物料编号 纳入：成品行靠款号维度唯一，半成品行靠物料编号+颜色唯一
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name=N'UX_结存快照_维度')
    DROP INDEX UX_结存快照_维度 ON [结存快照表];
CREATE UNIQUE INDEX UX_结存快照_维度 ON [结存快照表]
    ([年月],[仓库],[口径],[款号],[色号],[颜色],[尺码],[物料编号]);
```

说明：
- 表当前为空，重建索引安全。
- 唯一性：成品行 `物料编号=NULL`，靠 `款号/色号/颜色/尺码` 区分；半成品行 `款号/色号/尺码=NULL`，靠 `物料编号/颜色` 区分；`口径` 列再加一道兜底，二者绝不冲突。
- **仅数量列**，无金额（加权出库成本/金额月结沿用 P5 延后项）。
- 部署同 P5c：`db/run-db.ps1` 加载 + `tools/DbDeploy`。脚本须对 `erp` 与 `erp_test` 都生效。

## 2. 月结算法（自洽，不依赖上一期快照）

核心：复用 P5 已验证的同一 UNION 账本，只加日期谓词。月初 = `年月` 当月 1 日 00:00；月末次 = 下月 1 日 00:00（用 `< 下月初` 表达「含当月」，避开 datetime 边界）。

对某 `年月(yyyyMM)` + `口径` + 一个仓库：

- **期初** = Σ 有符号流水 where `日期 < 月初`（月初时点实时余额）
- **本期入** = Σ 正向流水额 where `月初 <= 日期 < 下月初`
- **本期出** = Σ 负向流水额的绝对值 where `月初 <= 日期 < 下月初`
- **结存** = 期初 + 本期入 − 本期出（恒等于「月末时点实时余额」）

「有符号流水」沿用各口径现有 UNION 的符号约定：

**成品口径**（分组键 `款号,色号,颜色,尺码`，过滤明细 `ISNULL(审核,'0')='1'`，明细自带 `日期`）：
- 入仓明细单 `+数量`、退货明细单 `+数量`、调拨明细单(目标仓库=@仓) `+数量`
- 出仓明细单 `−数量`、退仓明细单 `−数量`、调拨明细单(源仓库=@仓) `−数量`
- 盘点明细单 `+盈亏数量`（盈亏为有符号，正入负出）

**半成品口径**（分组键 `物料编号,颜色`，明细**无审核列** → JOIN 单头过滤 `ISNULL(h.审核,'0')='1'`，明细自带 `日期`；盘点 系统/盘点/盈亏数量为 `real` → `CAST(... AS decimal(18,4))`）：
- 入仓明细单 `+数量`、领料明细单 `−数量`、盘点明细单 `+盈亏数量`

实现方式：每个口径写一个「带日期范围与符号拆分的账本 CTE」，一次查询同时算出 期初/本期入/本期出。示意（成品，单仓单月）：

```sql
WITH 账本 AS (
    -- 每行：维度 + 日期 + 有符号数量(签)；下面 UNION ALL 全部成品流水
    SELECT 款号,款式,色号,颜色,尺码, 日期, 数量 AS 签 FROM [成品入仓明细单] WHERE 仓库=@仓 AND ISNULL(审核,'0')='1'
    UNION ALL SELECT 款号,款式,色号,颜色,尺码, 日期, 数量      FROM [成品退货明细单] WHERE 仓库=@仓 AND ISNULL(审核,'0')='1'
    UNION ALL SELECT 款号,款式,色号,颜色,尺码, 日期, 数量*-1   FROM [成品出仓明细单] WHERE 仓库=@仓 AND ISNULL(审核,'0')='1'
    UNION ALL SELECT 款号,款式,色号,颜色,尺码, 日期, 数量*-1   FROM [成品退仓明细单] WHERE 仓库=@仓 AND ISNULL(审核,'0')='1'
    UNION ALL SELECT 款号,款式,色号,颜色,尺码, 日期, 盈亏数量  FROM [成品盘点明细单] WHERE 仓库=@仓 AND ISNULL(审核,'0')='1'
    UNION ALL SELECT 款号,款式,色号,颜色,尺码, 日期, 数量      FROM [成品调拨明细单] WHERE 目标仓库=@仓 AND ISNULL(审核,'0')='1'
    UNION ALL SELECT 款号,款式,色号,颜色,尺码, 日期, 数量*-1   FROM [成品调拨明细单] WHERE 源仓库=@仓 AND ISNULL(审核,'0')='1'
)
SELECT 款号, MAX(款式) AS 款式, 色号, 颜色, 尺码,
       SUM(CASE WHEN 日期 <  @月初                        THEN 签 ELSE 0 END)               AS 期初,
       SUM(CASE WHEN 日期 >= @月初 AND 日期 < @下月初 AND 签 > 0 THEN 签 ELSE 0 END)         AS 本期入,
       SUM(CASE WHEN 日期 >= @月初 AND 日期 < @下月初 AND 签 < 0 THEN -签 ELSE 0 END)        AS 本期出
FROM 账本
GROUP BY 款号,色号,颜色,尺码
HAVING SUM(CASE WHEN 日期 < @下月初 THEN 签 ELSE 0 END) <> 0          -- 月末结存
    OR SUM(CASE WHEN 日期 >= @月初 AND 日期 < @下月初 THEN 1 ELSE 0 END) > 0;  -- 或当月有流水
```

`结存 = 期初 + 本期入 − 本期出` 在服务端（或 SELECT 表达式）算出后写库。半成品 CTE 同形，把各 UNION 段换成半成品三表 + JOIN 单头取审核 + CAST。

**写入**：逐仓库算完后，INSERT 进 `结存快照表`（`生成时间 = now`，`口径`/维度列按口径填，另一口径列留 NULL）。整月所有仓库放一个 Dapper 事务。

**「全部有流水仓库」的确定**：close 未传仓库时，先查该口径当月有审核流水（`日期 < @下月初`）涉及的不同 `仓库` 列表，逐仓生成。

## 3. 反月结 / 重算

- close 某 `年月+仓库+口径`，若该组合已存在快照行 → **409 Conflict**，须先反月结再结。
- reopen（反月结）= 删除该 `年月+仓库+口径` 的快照行。
- **护栏**：若存在**更晚**年月（同仓库+口径）的快照，拒绝反月结（不能掀开被压在下面的月份）→ **409**。
- 软月结，无单据锁需释放。
- close 全仓模式下，对已结的仓库逐仓判断：本设计取「全仓 close 时跳过已结仓库、只结未结仓库」过于隐式 → 改为：**close 全仓时，若其中任一(年月+仓库+口径)已存在快照，整批 409 并列出冲突仓库**，要求先反月结。保持「显式、可预期」。

## 4. API（新 `src/ErpApi/Features/MonthEnd/`）

`MonthEndService` + `MonthEndController`，路由 `api/month-end`（ASCII），表名/菜单中文。

| 方法 | 路由 | 入参 | 行为 | 返回 |
|---|---|---|---|---|
| POST | `/api/month-end/close` | `{年月:"yyyyMM", 口径:"成品"\|"半成品", 仓库?:string}` | Dapper 事务：算 UNION → 写快照 | `200 {结数:int, 仓库:string[]}` |
| POST | `/api/month-end/reopen` | `{年月, 口径, 仓库?}` | 删快照（带更晚月护栏） | `200 {删数:int}` |
| GET | `/api/month-end` | `?年月=&口径=&仓库=` | 读快照月报行 | `MonthEndRow[]` |
| GET | `/api/month-end/periods` | `?口径=` | 已结年月去重列表（倒序） | `string[]` |

入参校验：`年月` 须 6 位数字 yyyyMM；`口径` ∈ {成品,半成品}；非法 → `400 BadRequest`。
DTO：`MonthEndRow { 年月, 仓库, 口径, 款号?, 款式?, 色号?, 颜色?, 尺码?, 物料编号?, 物料名称?, 规格?, 单位?, 期初, 本期入, 本期出, 结存 }`（decimal 数量列）。

## 5. 权限 / 成本保密 / 审计

- 新菜单名 **「库存月结」**，9 位权限矩阵：`打开`=查月报/已结月份、`功能`=执行月结(close)、`删除`=反月结(reopen)。其余位不用。
- Controller 各动作用 `can(perms, "库存月结", action)` 守卫（`打开`/`功能`/`删除`）。
- **成本保密：快照只有数量列，无单价/金额 → 无需脱敏**（与库存查询页一致）。
- 审计：close/reopen 走现有审计写入（与各单据 Create/Delete 一致的 AuditLog）。
- 开发种子 `db/seed_p5_month_end_perms.sql`：给 admin 授「库存月结」 打开/删除/功能 = 1。

## 6. 前端

- `web/src/api/monthEnd.ts`：`monthEndApi.close/reopen/report/periods` + 类型 `MonthEndRow`。`import { api } from "./client"`。
- `web/src/pages/warehouse/MonthEnd.tsx`：单页
  - 顶部筛选：口径(Select 成品/半成品)、仓库(Input，可空=全部)、年月(月份选择，提交 yyyyMM)。
  - 按钮：`执行月结`（功能权限）、`反月结`（删除权限），二次确认 Popconfirm。
  - 月报表格：列随口径切换（成品列 款号/色号/颜色/尺码；半成品列 物料编号/规格/颜色）+ 公共列 期初/本期入/本期出/结存；`usePerms()` 控制按钮可见。
  - 「已结月份」展示（periods 接口）。
- 菜单：`web/src/App.tsx` 加路由 `/month-end`；`web/src/pages/MainLayout.tsx` 新增独立顶级菜单组 **「月结管理」**（key `me`），子项「库存月结」，图标复用已引入的 `CalendarOutlined`/`AuditOutlined` 之类（按现有 imports 选）。Header 标题链补「月结管理 / 库存月结」。

## 7. 测试

- 后端 `MonthEndServiceDbTests`（`erp_test`）：造数据（沿用 P5/P5c 测试数据模式，插单头+明细，设 `日期` 跨月），验证：
  - 单月单仓成品：上月入 100 审核（日期上月）→ 本月出 30（日期本月）→ close 本月 → 期初100/本期入0/本期出30/结存70。
  - 半成品口径同形（物料维度，JOIN 单头审核，real CAST）。
  - 全仓缺省 close：两仓各有流水 → 各自生成。
  - 重复 close 同组合 → 抛冲突（409 语义）。
  - reopen 删除；存在更晚月快照时 reopen 被拒。
  - 只取审核='1' 流水；未审核不计。
- 后端 `P5MonthEndApiIntegrationTests`：端到端 close→report→reopen + 权限校验（无功能权限 close→403）。
- 前端 `MonthEnd` 组件测试（Vitest）：渲染、口径切换列变化、按钮按权限显隐。
- API 冒烟：复用 `tmp/smoke_p4` HttpClient 改 month-end 全链路。

## 8. 范围外（延后）

加权出库成本/金额月结、硬月结锁期、物料(原料仓)月结、月结定时自动、把快照接入实时库存热路径（`IInventorySnapshotProvider`）。

## 9. 关键风险与对策

| 风险 | 对策 |
|---|---|
| 明细 `日期` 是否可靠 | 已核查：成品/半成品各单据服务 INSERT 单头+明细均写 `日期 = now`，明细自带 `日期`，可直接日期过滤（成品按明细审核，半成品 JOIN 单头审核）。 |
| 唯一索引 NULL 冲突 | 口径 + 物料编号 纳入索引；成品/半成品维度互斥，无 NULL 碰撞。 |
| 边界日期（含当月最后一天的时间分量） | 用 `< 下月初` 表达「含当月」，不用 `<= 月末`，避开 datetime 末时刻。 |
| real → decimal | 半成品盘点 系统/盘点/盈亏数量 `CAST(... AS decimal(18,4))`（同 P5c）。 |
| 不破坏实时库存 | 月结查询为独立 SQL，绝不改 FinishedGoodsAsync/SemiFinishedAsync。 |
