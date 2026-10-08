# 生产通知单（一单多货号）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development。依据 `docs/superpowers/specs/2026-06-10-production-notice-design.md`。
> 大工程,分 6 片,逐片合并。本计划详写**第①片(改表+回填)**;②~⑥ 列骨架,做到时各自细化。

**Goal:** 生产制单重做成原系统「生产通知单」(一单多货号·单据表单页),算3/4按货号,P4加货号维。

**锁定模型**:单头加列(订单类型/标识/装箱方式/订单总箱数/默认单价;下单日期已有);新表 `生产制单货号`;子表+P4 加货号列;色×码=货号维下颜色尺码;货号与BOM款号两列;制单内容=货号色码数量、物料清单=算4缺料;MO单录入/图片备注 延后。

---

## 第①片:改表脚本 + 数据回填 + 校验测试

**Files:** Create `db/10_production_notice.sql`；Test `tests/ErpApi.Tests/ProductionNoticeSchemaDbTests.cs`.

- [ ] **Step 1: `db/10_production_notice.sql`(幂等)**:
  - 单头 `生产制单` 加列(COL_LENGTH 判断后 ALTER ADD):`订单类型 nvarchar(10) NULL`、`标识 nvarchar(10) NULL`、`装箱方式 nvarchar(10) NULL`、`订单总箱数 int NULL`、`默认单价 nvarchar(20) NULL`。
  - 新建 `生产制单货号`(IF OBJECT_ID IS NULL):`ID bigint IDENTITY(1,1) PRIMARY KEY, 生产单号 nvarchar(30) NOT NULL, 序号 int NULL, 货号 nvarchar(40) NULL, BOM款号 nvarchar(40) NULL, 款号名称 nvarchar(60) NULL, 数量 decimal(18,4) NULL, 比例 decimal(18,4) NULL, 分析 bit NULL DEFAULT 0`。建索引 `IX_生产制单货号_生产单号`。(不加 FK,避免 生产单号 唯一性约束问题;应用层保证。)
  - 子表加 `货号 nvarchar(40) NULL`(COL_LENGTH 判断):`生产制单数量`、`生产制单工序表`、`生产BOM物料清单`。
  - P4 加 `货号 nvarchar(40) NULL`:`裁床单`、`计件表`。
  - **数据回填**(幂等,WHERE 货号 IS NULL):
    - `UPDATE [生产制单数量] SET [货号]=[款号] WHERE [货号] IS NULL AND [款号] IS NOT NULL`
    - `UPDATE [生产制单工序表] SET [货号]=[款号] WHERE [货号] IS NULL AND [款号] IS NOT NULL`
    - `UPDATE [生产BOM物料清单] SET [货号]=[款号] WHERE [货号] IS NULL AND [款号] IS NOT NULL`
    - `UPDATE [裁床单] SET [货号]=[款号] WHERE [货号] IS NULL AND [款号] IS NOT NULL`
    - `UPDATE [计件表] SET [货号]=...` — 计件表无款号列?(确认:计件表列)。若计件表无款号,则货号回填从 裁床单/生产制单工序表 关联取;**实现时先查计件表列**,无款号则该回填改为 `UPDATE q SET 货号=c.款号 FROM 计件表 q JOIN 裁床单 c ON c.裁床单号=q.裁床单号`(按计件表实际关联键)。
    - `生产制单货号` 回填:每个既有 生产制单 插一行 `INSERT 生产制单货号(生产单号,序号,货号,BOM款号,款号名称,数量,比例,分析) SELECT 生产单号,1,款号,款号,款式,计划数量,1,0 FROM 生产制单 WHERE 生产单号 NOT IN (SELECT 生产单号 FROM 生产制单货号)`(幂等)。
- [ ] **Step 2: 跑脚本到 erp_test**:`dotnet run --project tmp/dbquery -- $env:ERP_TEST_DB "@db/10_production_notice.sql"`(实现者执行确认无错;幂等可重跑)。同时跑到 `$env:ERP_DB`(开发库)。
- [ ] **Step 3: 校验测试** `tests/ErpApi.Tests/ProductionNoticeSchemaDbTests.cs`(`[Collection("db")]`+Factory()):
  - 断言列存在:`SELECT COL_LENGTH('生产制单','订单类型')` 等 5 列非 null;`COL_LENGTH('生产制单数量','货号')`/`('生产制单工序表','货号')`/`('生产BOM物料清单','货号')`/`('裁床单','货号')`/`('计件表','货号')` 非 null;`OBJECT_ID('生产制单货号')` 非 null。
  - 回填冒烟:seed 一张旧式 生产制单(款号 PN_K1,计划数量100,审核'0')+生产制单数量(款号PN_K1,货号NULL,色码,数量) → 重跑脚本回填 → 该数量行 货号=PN_K1、生产制单货号 有 PN 行 货号=PN_K1。清理。
- [ ] **Step 4: 全量回归**:`dotnet test tests/ErpApi.Tests`(既有 P2/P4 测试仍绿——本片只加列+新表+回填,不改服务,不应破坏)。
- [ ] **Step 5: Commit**:
```bash
git add db/10_production_notice.sql tests/ErpApi.Tests/ProductionNoticeSchemaDbTests.cs
git commit -m "feat(生产通知单): 第①片改表(单头加列+生产制单货号表+子表/P4加货号列+数据回填)+校验测试

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## ② 后端 ProductionService 重写(多货号) — 骨架(做时细化)
CreateDto 改 多货号(货号明细 List[{货号,BOM款号,款号名称,数量,比例,色码数量List}]);CreateAsync:插单头(新字段)→逐货号(插生产制单货号+色码数量[带货号]+算3工序[带货号]+算4BOM[带货号])→汇总计划数量/工序数/物料金额回写单头。GetAsync 返回 单头+货号明细+(按货号)数量/工序/物料。DeleteAsync 加删 生产制单货号。DbTest 多货号端到端。

## ③ 控制器 + API 测试 — 骨架
ProductionController 适配新 DTO;DocumentNumber 不变;API 测试。

## ④ P4 加货号维 — 骨架
裁床/计件 录入带货号;计件单价取价 join `生产制单工序表 WHERE 生产单号+货号+工序号`;计件汇总按 货号×工序;回归 P4 测试。

## ⑤ 前端 生产通知单 单据表单页 — 骨架
工具条(新建/打开/保存/删除/审核/反审核/打印/关闭)+单头(原系统字段)+货号明细网格(序号/BOM款号/款号名称/数量/比例/分析)+页签(制单内容=选中货号色码数量+工序 / 物料清单=算4缺料 / MO单录入·图片备注 占位)。打开→单号列表。api。

## ⑥ 菜单接线 + 验证收尾 — 骨架
menuTree「生产通知单」→ 新页 /production-notice(或复用 /production);全量回归;收尾合并。

---

## Self-Review(第①片)
- 覆盖:改表脚本(单头+新表+子表/P4货号列+回填)、校验测试、回归。✓
- 占位符:脚本各 ALTER/CREATE/回填 SQL 给出;计件表款号未确认→实现者先查列再定回填来源。✓
- 关键坑:幂等(COL_LENGTH/OBJECT_ID判断+WHERE货号IS NULL);不加FK避唯一性问题;计件表回填关联键按实际列;本片不改服务保P2/P4回归;脚本两库都跑;提交带trailer。✓
