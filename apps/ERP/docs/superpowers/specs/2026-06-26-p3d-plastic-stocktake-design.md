# 塑胶盘点(盈亏±)(塑胶模块 P3d)· 设计 · 2026-06-26

## 目标

塑胶 P3 仓库收官子阶段。**镜像物料 `MaterialStocktake`**(盘点单/盘点明细单)实现塑胶盘点录入单,但精简——无月结锁、无审计(与塑胶模块现有 controller 一致,塑胶模块没有月结)。

流程:选仓 → `basis` 从 `PlasticInventoryService.ListAsync` 拉账面系统数量 → 录实盘数 → 盈亏 = 盘点 − 系统 → 审核后**有符号盈亏**入塑胶库存 UNION 第 6 支。

完成后塑胶库存 = 入仓(+) + 领料(−) + 退料(+) + 退仓(−) + 报废(−) ± 盘点盈亏(±),共 **6 支**,P3 全部接通。

## 架构

盘点不是「物料明细行」单据(无单价/金额/采购语义),与 P3a-c 的入仓/领料/退料/退仓/报废不同构,因此**不复用塑胶单据通用组件**,前端用**专用页**(镜像 `MaterialStocktakePage`)。

后端仍是「单头 + 明细」两层,审核位仅在单头;库存引擎按单头 JOIN 过滤审核。审核后由 `PlasticInventoryService` 实时聚合,单据不写库存余额。

**单据**:`塑胶盘点单`(头)+ `塑胶盘点明细单`(明细),单号主从,前缀 **SPD**。

- 头列:`单号,日期,仓库,操作员,审核,审核人,审核日期,备注`。
- 明细列:`单号,日期,仓库,物料编号,物料名称,规格,颜色,仓位号,单位,系统数量,盘点数量,盈亏数量`。
- **改进**:数量列用 `decimal(18,4)`。物料侧 `盘点单`/`盘点明细单` 用 `real` 导致读写要 CAST;塑胶为新建表,直接 decimal,免 CAST,DTO 直接 decimal。

## 后端组件

`Features/Plastics/PlasticStocktake/`(Dtos + Service + Controller),镜像 `Features/Materials/MaterialStocktake` 的录入部分(**不含** StocktakeQuery 报表方法——那是 P4):

- **DTO** `PlasticStocktakeDtos.cs`:`PlasticStocktakeBasisRow`(物料编号/名称/规格/单位/仓位号/系统数量)、`PlasticStocktakeLineDto`(物料编号/名称/规格/仓位号/单位/系统数量/盘点数量)、`PlasticStocktakeCreateDto`(仓库/备注/明细[])、`PlasticStocktakeHeaderDto`、`PlasticStocktakeLineRowDto`(系统/盘点/盈亏数量)、`PlasticStocktakeDetailDto`。
- **Service** `PlasticStocktakeService(ISqlConnectionFactory, IDocumentNumberGenerator, PlasticInventoryService)`:
  - `DocType="塑胶盘点单"`,`Prefix="SPD"`。
  - `BasisAsync(仓库)` → 调 `PlasticInventoryService.ListAsync(仓库, null)`,映射成 basis 行(带仓位号——PlasticStockRow 有该列;**注:库存 ListAsync 不返回颜色,故 basis/明细不带颜色**)。明细表 DDL 保留 `颜色` 列(可空,与其它塑胶明细表 schema 对齐,创建时不填)。
  - `CreateAsync(dto, user)`:空明细/空仓库抛 `ArgumentException`;Dapper 事务,SPD 单号;插单头(审核'0')+ 逐行插明细,`盈亏数量 = 盘点数量 − 系统数量`。
  - `ListAsync(page,size,keyword)`、`GetAsync(单号)`、`DeleteAsync(单号)`(仅未审核可删,FK 明细→单头)。
- **Controller** `PlasticStocktakeController(svc, IPostingEngine, IPermissionService)`(精简塑胶风格,无 PeriodLock/audit):
  - `GET basis?仓库=` → BasisAsync。
  - CRUD(List/Get/Create/Delete)+ `approve`/`unapprove`(走 IPostingEngine)。
  - 菜单/表名 `塑胶盘点单`,路由 `api/plastic-stocktakes`。盘点无单价保密。
- **库存** `PlasticInventoryService.LedgerUnion` 追加第 6 支:
  ```sql
  UNION ALL SELECT d.[物料编号],d.[物料名称],d.[规格],d.[单位],d.[仓库], d.[盈亏数量]
      FROM [塑胶盘点明细单] d JOIN [塑胶盘点单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'
  ```
  注释更新为 6 支齐全,去掉「后续阶段加 盘点±」。
- **过账白名单** `PostableDocuments.cs` 加 `["塑胶盘点单"]="单号"`。
- **菜单** `MenuCatalog.cs` 加 `new("塑胶仓储","塑胶盘点单")`(紧跟塑胶报废单)。
- **种子** `db/seed_plastic_stocktake_perms.sql` 给 admin 塑胶盘点单全权限。
- **DB** `db/21_plastic_stocktake.sql` 建 2 表(幂等),含审核留痕列。
- **注册** `Program.cs` 加 1 个 `AddScoped<PlasticStocktakeService>`。

## 前端组件(专用页)

镜像 `MaterialStocktakePage`(~100 行),不用通用组件:

- `web/src/api/plasticStocktake.ts`:`basis(仓库)`、`list`、`create`、`approve`、`unapprove`、`remove` + 类型(PSBasisRow/PSHeader/PSLine)。
- `web/src/pages/plastics/PlasticStocktakePage.tsx`:仓库输入框 + 「带出库存」按钮(load basis,盘点数默认=系统数)+ basis 表(系统数量只读、盘点数量 InputNumber、盈亏 render)+ 提交盘点 + 下方盘点单列表(审核/反审核/删除内联,按权限)。MENU="塑胶盘点单"。
- `App.tsx` 加路由 `plastic-stocktakes` → `<PlasticStocktakePage/>`。
- `menuTree.tsx` 把占位 `M("塑胶盘点单")` 改为 `M("塑胶盘点单","/plastic-stocktakes","塑胶盘点单")`。

## 测试

- 后端 `tests/ErpApi.Tests/PlasticStocktakeServiceDbTests.cs`:basis 拉账面(种入仓审核后 basis 含该物料系统数量)、create(盈亏=盘点−系统、SPD 前缀、金额无)、delete 守卫(已审核不可删)。
- `PlasticInventoryServiceDbTests` 追加盘点联动:入仓 100 审核 → 100;塑胶盘点(系统100/实盘90)审核 → 盈亏 −10 → 库存 90。
- 全量 `dotnet test`(后端 352 → 约 355)、`npm --prefix web run test`(54)、`build` + tsc 干净。
- 冒烟:入仓 100 → 盘点带出 → 录 90 → 审核 → `GET /api/plastic-inventory` = 90。

## 执行

writing-plans → subagent-driven 逐任务 → opus 全分支终审 → 分支 `feat-plastic-stocktake` `--no-ff` 合并 master,删分支 → worklog + 更新 MEMORY.md(P3 收官,下一步 P4 塑胶报表)。

## 不做(YAGNI)

- 塑胶盘点查询报表(明细/汇总两 Tab·带价·专用只读抽屉)→ 留 P4 塑胶报表阶段。
- 月结锁(塑胶模块无月结)。
- 单价/金额成本保密(盘点单据无价格列)。
- 盘点 basis 仅含非零账面行(镜像物料侧 ListAsync 的 `HAVING <>0`);账面为 0 的物料无法盘盈——与物料侧行为一致,不在本阶段改。
