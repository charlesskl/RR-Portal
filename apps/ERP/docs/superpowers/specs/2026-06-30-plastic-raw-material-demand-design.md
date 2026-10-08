# 原料生产需求表 · 设计 · 2026-06-30

## 目标

⑪ 原料仓库「原料生产需求表」——全屏主从录入单(生产领料需求计划)。**审核纯锁定不动库存**(需求=计划·三件套·不碰任何库存)。镜像 白件领料单(PlasticWhitePartIssue)。**新表**。

## 范围与决策(已确认)

- 审核纯锁定·不动库存(同白件领料单·进 PostableDocuments 白名单 + 头 审核日期列)。
- 明细 原料编号🔍 从 塑胶原料资料 带出 原料名称/单位;每包重量手录;**需求数量(KG) 与 需求数量(包) 两者独立录入**;底部分别汇总。
- v1 = 头+明细+保存+审核/反审核+列表/打开/删除。无单价/金额 → 无脱敏。
- **不做**:调入清单、最后号码按钮、生产车间下拉数据源、原料库存联动。

## 新表(`db/31_plastic_raw_material_demand.sql`·EF 不迁移·幂等)

**原料生产需求表**(头):
```sql
[ID] bigint IDENTITY(1,1) PRIMARY KEY,
[单号] nvarchar(20) NOT NULL,
[啤机生产单号] nvarchar(50) NULL,
[开单日期] datetime NULL,
[制单人] nvarchar(30) NULL,
[领料备注] nvarchar(30) NULL,
[生产车间] nvarchar(40) NULL,
[操作员] nvarchar(20) NULL,
[数量KG] decimal(18,4) NULL,
[数量包] decimal(18,4) NULL,
[审核] nvarchar(5) NULL,
[审核人] nvarchar(20) NULL,
[审核日期] datetime NULL,
[备注] nvarchar(200) NULL
```
**原料生产需求明细单**(明细):
```sql
[ID] bigint IDENTITY(1,1) PRIMARY KEY,
[单号] nvarchar(20) NOT NULL,
[原料编号] nvarchar(40) NULL,
[原料名称] nvarchar(80) NULL,
[每包重量] decimal(18,4) NULL,
[单位] nvarchar(20) NULL,
[需求数量KG] decimal(18,4) NULL,
[需求数量包] decimal(18,4) NULL,
[备注] nvarchar(200) NULL
```

## ① 后端(新 `Features/Plastics/PlasticRawMaterialDemand/`·克隆白件领料单去价格、换头/明细字段)

**DTOs**:
- `PlasticRawMaterialDemandHeaderDto`:ID/单号/啤机生产单号/开单日期/制单人/领料备注/生产车间/操作员/数量KG/数量包/审核/审核人/备注。
- `PlasticRawMaterialDemandLineDto`:ID/原料编号/原料名称/每包重量/单位/需求数量KG/需求数量包/备注。
- `PlasticRawMaterialDemandDetailDto`:单头? + List<明细>。
- `PlasticRawMaterialDemandCreateLineDto`:原料编号/原料名称/每包重量/单位/需求数量KG/需求数量包/备注。
- `PlasticRawMaterialDemandCreateDto`:啤机生产单号/制单人/领料备注/生产车间/备注 + List<明细>。

**Service**(`const DocType="原料生产需求表"; const Prefix="YLX"`):
- `CreateAsync(dto,user)`:明细空抛 ArgumentException;数量KG合计=SUM(明细.需求数量KG)、数量包合计=SUM(明细.需求数量包);INSERT 头(审核'0'·开单日期=now·操作员=user)+ 逐行 INSERT 明细;前缀 YLX;返回单号。
- `ListAsync(page,size,keyword)`:keyword LIKE 单号/啤机生产单号/制单人;SELECT 头列;ORDER BY ID DESC 分页。
- `GetAsync(单号)`:头 + 明细(ORDER BY ID)。
- `DeleteAsync(单号)`:UPDLOCK 取审核;已审核抛 InvalidOperationException;删明细+头。

**Controller**(`api/plastic-raw-material-demand`·Menu="原料生产需求表"):list/get/create/delete/approve/unapprove(审核走 IPostingEngine·Table="原料生产需求表")。注入 IPermissionService 仅做 9 位授权(**无单价脱敏**)。

**过账白名单**:`PostableDocuments.cs` Map 加 `["原料生产需求表"]="单号"`。
**DI**:`Program.cs` 注册 `PlasticRawMaterialDemandService`。
**菜单+权限**:`MenuCatalog.cs` 加 `new("原料仓库","原料生产需求表")`;**新建 `db/seed_plastic_raw_material_demand_perms.sql`(确认文件名未占用)** admin 9 位(两库)。

## ② 前端

- 新 `PlasticRawMaterialPicker.tsx`(克隆 PlasticMaterialPicker over `plasticRawMaterialMasterApi`·标题"选择原料"·列 物料编号/物料名称/规格/单位·onPick 返回行)。
- `api/plasticRawMaterialDemand.ts`:`RMDLine`(原料编号/原料名称/每包重量/单位/需求数量KG/需求数量包/备注)+ `RMDHeader` + `RMDDetail`;base `/plastic-raw-material-demand`;list/get/create/remove/approve/unapprove。
- `PlasticRawMaterialDemandLineTable.tsx`(克隆 PlasticWhitePartIssueLineTable):列 原料编号🔍(PlasticRawMaterialPicker 回填 原料编号/原料名称/单位)|原料名称(只读)|每包重量(InputNumber)|单位(只读·可改)|需求数量KG(InputNumber)|需求数量包(InputNumber)|备注|删除。
- `PlasticRawMaterialDemandPage.tsx`(克隆 PlasticWhitePartIssuePage):
  - 头:啤机生产单号(Input)/开单日期(只读)/制单人(EmployeePicker🔍·必填)/操作员(只读)/领料备注(Select 生产领料/样品领料/维修领料)/生产车间(Input)/备注(Input)。
  - 工具栏:新建/保存/审核/反审核/删除/打印。
  - 明细 LineTable;底部 **需求数量(KG)合计 + 需求数量(包)合计** + 制单人。
  - 历史单列表(单号链打开 + 审核/反审核/删除·Tag 状态)。
  - 校验:明细 `原料编号 && (需求数量KG>0 || 需求数量包>0)` 至少一行;制单人必填。
- `App.tsx`:import + `<Route path="plastic-raw-material-demand" element={<PlasticRawMaterialDemandPage />} />`。
- `menuTree.tsx` line126:`M("原料生产需求表")` → `M("原料生产需求表","/plastic-raw-material-demand","原料生产需求表")`。

## ③ 测试

- 后端 `PlasticRawMaterialDemandServiceDbTests`:create(明细 2 行·需求KG 5+3=8·需求包 1+1=2)→ 前缀 YLX·get 头 数量KG=8/数量包=2/明细2行/原料编号;approve(`engine.ApproveAsync("原料生产需求表",单号,...)`)→ 审核1+审核日期非空;delete 已审核抛 InvalidOperationException。Clean 逆序删(明细/头·按 单号 LIKE 'YLX%' 或固定测试值)。
- 全量 `dotnet test` 绿(404→≥406);前端 54 + `tsc` 干净。
- **HTTP 冒烟**:登录 → POST 建(2 明细)→ approve → GET 验 审核=1/数量KG/数量包/明细。**起后端 Release(锁先 PID Stop-Process)+ `--contentRoot 输出目录`;node axios `proxy:false`。**

## 执行

writing-plans → subagent-driven → opus 终审 → 分支 `feat-plastic-raw-material-demand` `--no-ff` 合并 master → worklog + MEMORY。
