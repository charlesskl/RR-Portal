# 白件领料单 · 设计 · 2026-06-29

## 目标

⑩ 发外加工「白件领料单」落地——全屏主从录入单。白件=半成品发给加工厂喷油/电镀。**审核 = 纯锁定**(走通用过账引擎只翻 `审核='1'`,**不动塑胶库存**;白件库存未建模,LedgerUnion 字节不变)。镜像 `塑胶加工采购单`(PlasticProcessPurchaseOrder)纯锁定流派,去价格,换头字段(领料部门/领料人/胶箱数/卡板数/领料备注),明细加 `发外采购` 列。

## 范围与决策(已确认)

- **审核纯锁定·不动库存**(同塑胶加工采购单·三件套:PostableDocuments 白名单 + 头 审核日期列 + 测试断言 审核='1' AND 审核日期非空)。**不碰 `PlasticInventoryService.LedgerUnion`**。
- v1 = 头 + 明细 + 保存 + 审核/反审核 + 列表/打开/删除 + 调入清单(按生产单号从 BOM)。
- **省右侧库存参考面板、前后单导航、打印合并、表格列设置、重量统计(无源)**。
- 无单价/金额列 → **无脱敏**(单据不带价)。

## 数据源 / 新表(`db/29_plastic_white_part_issue.sql`,EF 不迁移)

**白件领料单**(头):
```sql
[ID] bigint IDENTITY(1,1) PRIMARY KEY,
[单号] nvarchar(20) NOT NULL,
[日期] datetime NULL,
[领料部门] nvarchar(40) NULL,
[领料人] nvarchar(30) NULL,
[胶箱数] decimal(18,4) NULL,
[卡板数] decimal(18,4) NULL,
[领料备注] nvarchar(30) NULL,
[数量] decimal(18,4) NULL,
[操作员] nvarchar(20) NULL,
[电脑单号] nvarchar(30) NULL,
[审核] nvarchar(5) NULL,
[审核人] nvarchar(20) NULL,
[审核日期] datetime NULL,
[备注] nvarchar(200) NULL
```

**白件领料明细单**(明细):
```sql
[ID] bigint IDENTITY(1,1) PRIMARY KEY,
[单号] nvarchar(20) NOT NULL,
[发外采购] nvarchar(20) NULL,
[生产单号] nvarchar(50) NULL,
[款号] nvarchar(40) NULL,
[物料编号] nvarchar(20) NULL,
[模具编号] nvarchar(30) NULL,
[物料名称] nvarchar(40) NULL,
[颜色] nvarchar(20) NULL,
[用料名称] nvarchar(40) NULL,
[单位] nvarchar(10) NULL,
[数量] decimal(18,4) NULL,
[备注] nvarchar(200) NULL
```

调入清单来源:`塑胶共用物料表 p JOIN 生产制单货号 g ON g.[货号]=p.[塑胶货号] LEFT JOIN 生产制单 pm ON pm.[生产单号]=g.[生产单号]`,带出 生产单号/款号/模具编号(=p.工模编号)/物料编号/物料名称/颜色/用料名称;单位 LEFT JOIN `塑胶物料资料`(GROUP BY 物料编号·MAX(单位))。**发外采购无 BOM 源 → 调入留空,用户可录入。数量录入(默认 0)。**

## ① 后端(新 `Features/Plastics/PlasticWhitePartIssue/`)

**DTOs**(`PlasticWhitePartIssueDtos.cs`):
- `PlasticWhitePartIssueHeaderDto`:ID/单号/日期/领料部门/领料人/胶箱数/卡板数/领料备注/数量/操作员/电脑单号/审核/审核人/备注(全 nullable,单号="")。
- `PlasticWhitePartIssueLineDto`:ID/发外采购/生产单号/款号/物料编号/模具编号/物料名称/颜色/用料名称/单位/数量(decimal)/备注。
- `PlasticWhitePartIssueDetailDto`:单头? + List<明细>。
- `PlasticWhitePartIssueCreateLineDto`:发外采购/生产单号/款号/物料编号/模具编号/物料名称/颜色/用料名称/单位/数量(decimal)/备注。
- `PlasticWhitePartIssueCreateDto`:领料部门/领料人/胶箱数/卡板数/领料备注/电脑单号/备注 + List<明细>。
- `PlasticWhitePartIssueBasisRow`:生产单号/款号/模具编号/物料编号/物料名称/颜色/用料名称/单位。

**`PlasticWhitePartIssueService.cs`**(克隆 `PlasticProcessPurchaseOrderService` 去价格):
- `const string DocType = "白件领料单"; const string Prefix = "BJL";`
- `BasisAsync(生产单号)`:上述 BOM SQL,`ORDER BY p.[ID]`。
- `CreateAsync(dto, user)`:明细空抛 `ArgumentException`;数量合计=SUM(明细.数量);INSERT 头(审核='0')+ 逐行 INSERT 明细;前缀 BJL;返回单号。
- `ListAsync(page,size,keyword)`:keyword LIKE 单号/领料部门/领料人;SELECT ID/单号/日期/领料部门/领料人/数量/操作员/审核/审核人/备注;`ORDER BY [ID] DESC` 分页。
- `GetAsync(单号)`:头 + 明细(ORDER BY ID)。
- `DeleteAsync(单号)`:UPDLOCK 取审核;已审核抛 `InvalidOperationException`;删明细+头。

**`PlasticWhitePartIssueController.cs`**(`[Route("api/plastic-white-part-issue")]`):
- `Menu="白件领料单"; Table="白件领料单"`;注入 `PlasticWhitePartIssueService` + `IPostingEngine` + `IPermissionService`。`IPermissionService` 仅做 打开/保存/删除/审核/反审核 9 位授权,**无单价脱敏**(单据不带价)。
- `GET /`(list·授权 打开)/`GET /basis?生产单号=`/`GET /{单号}`/`POST /`(保存)/`DELETE /{单号}`/`POST /{单号}/approve`/`POST /{单号}/unapprove`。镜像 PlasticProcessPurchaseOrderController,**删去所有 `CanPrice()`/金额置 null 逻辑**。

**过账白名单**:`PostableDocuments.cs` Map 加 `["白件领料单"]="单号"`。

**DI**:`Program.cs` 加 `builder.Services.AddScoped<...PlasticWhitePartIssue.PlasticWhitePartIssueService>();`(紧挨 PlasticProcessPurchaseOrderService 那行)。

**菜单 + 权限**:`MenuCatalog.cs` 发外加工组加 `new("发外加工","白件领料单")`;`db/seed_plastic_white_part_issue_perms.sql` admin 9 位(两库)。

## ② 前端

- `api/plasticWhitePartIssue.ts`:`WPILine`(发外采购/生产单号/款号/物料编号/模具编号/物料名称/颜色/用料名称/单位/数量/备注)、`WPIHeader`、`WPIDetail`、`WPIBasisRow`;`base="/plastic-white-part-issue"`;list/basis/get/create/remove/approve/unapprove(镜像 plasticProcessPurchaseOrder.ts·无价格字段)。
- `PlasticWhitePartIssueLineTable.tsx`(克隆 PlasticProcessPurchaseOrderLineTable 去价格列):列序 发外采购|生产单号🔍|款号|模具编号|物料编号🔍|物料名称只读|颜色|用料名称|单位|数量|备注|删除。复用 `PlasticMaterialPicker`(物料编号回填 物料编号/物料名称/颜色)+ `ProductionPicker`(生产单号/款号)。
- `PlasticWhitePartIssuePage.tsx`(克隆 PlasticProcessPurchaseOrderPage 风格 + PlasticIssueFormPage 头):
  - 头(Form):领料部门(Input)/日期(只读)/领料人(EmployeePicker🔍·必填)/操作员(只读)/电脑单号(只读)/胶箱数(InputNumber)/卡板数(InputNumber)/领料备注(Select·生产领料/样品领料/维修领料)/备注(Input)。
  - 工具栏:新建/保存/调入清单(→ ProductionPicker → basis → setLines)/打印。
  - 明细 LineTable;底部合计 数量合计 + 制单人(**省金额/重量**)。
  - 历史单列表(单号 a 链打开 / 审核·反审核·删除 操作列·Tag 审核状态)。
  - 校验:明细 `物料编号 && 数量>0` 至少一行;领料人必填。
- `App.tsx`:import + `<Route path="plastic-white-part-issue" element={<PlasticWhitePartIssuePage />} />`。
- `menuTree.tsx`:`M("白件领料单")` → `M("白件领料单","/plastic-white-part-issue","白件领料单")`。

## ③ 测试

- 后端 `PlasticWhitePartIssueServiceDbTests`(克隆 PlasticProcessPurchaseOrderServiceDbTests):
  - 种 款号总表/生产制单/生产制单货号/塑胶共用物料表/塑胶物料资料(单位 kg)。
  - `Basis_brings_bom_then_Create_then_Get`:basis 单行验 模具编号/物料名称/款号/单位=kg;create 前缀 BJL;get 头 数量合计=8(5+3)、明细 2 行、明细[0] 物料编号/模具编号/数量=5。
  - `Approve_flips_审核_and_writes_审核日期`:`engine.ApproveAsync("白件领料单",单号,"tester")` → 审核='1' 且 审核日期非空。
  - `Delete_approved_throws`:审核后删抛 `InvalidOperationException`。
  - Clean 逆序删(明细/头/共用物料表/物料资料/生产制单货号/生产制单/款号总表)。
- 全量 `dotnet test` 绿(390→391);前端 54 + `tsc` 干净。
- **HTTP 冒烟**:登录 → `GET /basis?生产单号=` → `POST /`(建单)→ `POST /{单号}/approve` → `GET /{单号}` 验 审核=1。**起后端 `dotnet build -c Release`(锁先按 PID Stop-Process)+ `--contentRoot 输出目录`;node axios `proxy:false`。**

## 不做(YAGNI)

- 右侧库存参考面板、前后单导航、打印合并、表格列设置、重量统计、单价/金额、白件领料查询页(后续)。

## 执行

writing-plans → subagent-driven(per-task subagent + 两段审查)→ opus 终审 → 分支 `feat-plastic-white-part-issue` `--no-ff` 合并 master → worklog + MEMORY。
