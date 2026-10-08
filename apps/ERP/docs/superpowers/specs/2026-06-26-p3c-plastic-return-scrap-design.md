# 塑胶退仓(库存−)+ 塑胶报废(库存−)(塑胶模块 P3c)· 设计 · 2026-06-26

## 目标

塑胶 P3 仓库第三子阶段。照 P3a 塑胶入仓 / P3b 塑胶领料退料**纵切克隆**两张出库单据,接入塑胶库存 UNION,两支均 `数量*-1`:

- **塑胶退仓单**(头 `塑胶退仓单` + 明细 `塑胶退仓明细单`·STC 单号·头字段 供应商编号/供应商名称):库存 **−号**。语义=把入仓的塑胶料退回供应商出仓(镜像物料模块「采购退仓单」,头与塑胶入仓对称)。
- **塑胶报废单**(头 `塑胶报废单` + 明细 `塑胶报废明细单`·SBF 单号·头字段 报废部门/报废人):库存 **−号**。语义=车间/部门报废塑胶料。

完成后塑胶库存 = 入仓(+) + 领料(−) + 退料(+) + 退仓(−) + 报废(−),共 5 支。

## 架构

与 P3a/P3b 完全同构。每张单据「单头 + 物料明细」两层,明细 `单号` 主从,审核后由 `PlasticInventoryService` 实时 UNION 聚合(单据不写库存余额)。两单据均为出库(−),只与 P3b 退料(+)在库存符号与单头字段上不同。

**单据矩阵**

| 单据 | 头表 / 明细表 | 前缀 | 单头差异字段 | 库存方向 |
|---|---|---|---|---|
| 塑胶退仓单 | `塑胶退仓单` / `塑胶退仓明细单` | STC | 供应商编号 / 供应商名称 / 仓库 / 备注 | − (`数量*-1`) |
| 塑胶报废单 | `塑胶报废单` / `塑胶报废明细单` | SBF | 报废部门 / 报废人 / 仓库 / 备注 | − (`数量*-1`) |

明细列(两单据相同,镜像塑胶领料/退料明细):`单号,日期,仓库,物料编号,物料名称,规格,颜色,仓位号,单位,数量,单价,金额,备注`。头表均含审核留痕列 `审核人 / 审核日期`(P2 教训:接审核必须有此列,否则 approve 500)。

## 后端组件

每单据三件套,镜像 `Features/Plastics/PlasticReturn`(退料,+)与 `PlasticReceipt`(入仓,供应商头):

- **DB** `db/20_plastic_return_scrap.sql` — 4 表(`塑胶退仓单`/`塑胶退仓明细单`/`塑胶报废单`/`塑胶报废明细单`),`IF OBJECT_ID ... IS NULL` 幂等,头表含 `审核/审核人/审核日期`。
- **退仓** `Features/Plastics/PlasticWarehouseReturn/`:`PlasticWarehouseReturnDtos.cs` + `Service.cs` + `Controller.cs`。
  - 路由 `api/plastic-warehouse-returns`,菜单/表名 `塑胶退仓单`,前缀 `STC`。
  - 单头字段:供应商编号/供应商名称/仓库/备注(同 `PlasticReceipt`)。
- **报废** `Features/Plastics/PlasticScrap/`:`PlasticScrapDtos.cs` + `Service.cs` + `Controller.cs`。
  - 路由 `api/plastic-scraps`,菜单/表名 `塑胶报废单`,前缀 `SBF`。
  - 单头字段:报废部门/报废人/仓库/备注。
- **Service** Dapper 事务:`CreateAsync`(空明细抛 `ArgumentException`、数量/金额合计、单头→明细插入)、`ListAsync`(分页+关键字)、`GetAsync`(头+明细)、`DeleteAsync`(仅未审核可删,FK 顺序明细→单头)。
- **Controller** REST + 审核(走 `IPostingEngine`)+ 权限(`IPermissionService`)+ 审计 + 成本保密(无 `单价` 权限剥离单头 `金额` 与明细 `单价/金额`)。
- **库存** `PlasticInventoryService.LedgerUnion` 追加 2 支:
  ```sql
  UNION ALL SELECT ... d.[数量]*-1 FROM [塑胶退仓明细单] d JOIN [塑胶退仓单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'
  UNION ALL SELECT ... d.[数量]*-1 FROM [塑胶报废明细单] d JOIN [塑胶报废单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1'
  ```
  并更新顶部注释(去掉「后续阶段加 退仓−/报废−」,留 盘点±)。
- **过账白名单** `PostableDocuments.cs` 加 `["塑胶退仓单"]="单号"`、`["塑胶报废单"]="单号"`。
- **菜单** `MenuCatalog.cs` 加 `塑胶退仓单`、`塑胶报废单` 两项(放塑胶单据组,紧跟塑胶退料单)。
- **种子** `db/seed_plastic_return_scrap_perms.sql` 给 admin 两菜单全权限(镜像 `seed_plastic_issue_return_perms.sql`)。
- **注册** `Program.cs` 加 2 个 `AddScoped`。

## 前端组件(零新组件)

复用 P3a 建立的塑胶单据通用组件(`PlasticDocPage`/`PlasticDocCreateDrawer`/`PlasticDocDetailDrawer`/`PlasticLineTable`):

- `web/src/pages/plastics/docs/PlasticDocConfigs.ts` 加 2 个 config:
  - `plastic-warehouse-returns`:menu `塑胶退仓单`,title 塑胶退仓,headerFields 供应商编号/供应商名称/仓库(必填)/备注,listExtra 供应商名称/仓库。
  - `plastic-scraps`:menu `塑胶报废单`,title 塑胶报废,headerFields 报废部门/报废人/仓库(必填)/备注,listExtra 报废人/仓库。
- `App.tsx` 加 2 路由 `<PlasticDocPage cfg={PLASTIC_DOC_CONFIGS["..."]} />`。
- `MainLayout.tsx` 塑胶单据菜单组加 2 项(紧跟塑胶退料单)。

## 测试

- 后端 `tests/ErpApi.Tests/PlasticReturnScrapServiceDbTests.cs`:退仓(create/get/金额合计/delete·STC)、报废(同·SBF)、空明细/空仓库拒。
- `PlasticInventoryServiceDbTests` 追加联动:入仓 100 审核 → 100;退仓 20 审核 → 80;报废 10 审核 → 70(验证两 − 支与符号)。
- 全量 `dotnet test`(预期 后端 347→约 351)、`npm --prefix web run test`(54)、`npm --prefix web run build` + tsc 干净。
- 冒烟:库存联动 入仓100→退仓80→报废70(STC/SBF 单号、审核即过账、符号正确)。

## 执行

writing-plans(任务级·退仓/报废均给全码避免「同上」)→ subagent-driven 逐任务 → opus 全分支终审 → 分支 `feat-plastic-return-scrap` `--no-ff` 合并 master,删分支 → worklog + 更新 MEMORY.md。

## 不做(YAGNI)

- 不做塑胶盘点(留 P3d)。
- 退仓不复用入仓订单选择器(物料模块那套订单留痕);塑胶入仓本身无订单选择器,保持对称。
- 不加多币种/逐单核销/打印增强。
