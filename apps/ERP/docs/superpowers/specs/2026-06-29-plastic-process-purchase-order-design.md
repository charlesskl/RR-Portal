# 塑胶加工采购单(发外加工)· 设计 · 2026-06-29

## 目标

⑩ 发外加工「塑胶加工采购单」落地。全屏主从录入单据(头+明细+保存+审核+列表/打开/删除),按生产单号从 BOM 调入加工清单。**塑胶采购单(`PlasticPurchaseOrder`)的发外加工版**:头用加工厂(非供应商)、明细带 加工内容/单价/金额(发外加工带价)。

## 范围与决策(已确认)

- **调入加工清单 = 按生产单号从塑胶共用物料表 BOM 带入**(同塑胶采购单 BasisAsync 口径,带出 加工内容/加工单价)。
- v1 省略右侧合并面板;范围=头+明细+保存+审核+列表/打开/删除(镜像塑胶采购单)。
- **审核=纯锁定·不动库存**(三件套:`PostableDocuments` 白名单 + 头审核日期列 + 回归测试·走通用过账引擎只翻审核标志)。
- **单价/金额脱敏**(无「塑胶加工采购单·单价」权限置 null·明细单价/金额 + 头金额)。
- 加工厂选择器=新建 `FactoryPicker`(克隆 SupplierPicker→`masterApi("factories")`·返回 加工厂编号/加工厂名称)。

## 数据源(新表·`db/28_plastic_process_purchase_order.sql`·EF 不迁移)

```sql
IF OBJECT_ID(N'[塑胶加工采购单]', N'U') IS NULL
CREATE TABLE [塑胶加工采购单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NOT NULL,
    [日期] datetime NULL,
    [交货日期] datetime NULL,
    [加工厂编号] nvarchar(20) NULL,
    [加工厂名称] nvarchar(60) NULL,
    [客户名称] nvarchar(60) NULL,
    [收货仓库] nvarchar(30) NULL,
    [收货人] nvarchar(30) NULL,
    [数量] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,
    [操作员] nvarchar(20) NULL,
    [审核] nvarchar(5) NULL,
    [审核人] nvarchar(20) NULL,
    [审核日期] datetime NULL,
    [备注] nvarchar(200) NULL
);
IF OBJECT_ID(N'[塑胶加工采购单明细]', N'U') IS NULL
CREATE TABLE [塑胶加工采购单明细] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NOT NULL,
    [生产单号] nvarchar(50) NULL,
    [款号] nvarchar(40) NULL,
    [模具编号] nvarchar(30) NULL,
    [物料编号] nvarchar(20) NULL,
    [物料名称] nvarchar(40) NULL,
    [用料名称] nvarchar(40) NULL,
    [颜色] nvarchar(20) NULL,
    [加工内容] nvarchar(50) NULL,
    [数量] decimal(18,4) NULL,
    [单价] decimal(18,4) NULL,
    [金额] decimal(18,4) NULL,
    [备注] nvarchar(200) NULL
);
```

## ① 后端(`Features/Plastics/PlasticProcessPurchaseOrder/`·镜像 PlasticPurchaseOrder)

**DTOs**:`...HeaderDto`(ID/单号/日期/交货日期/加工厂编号/加工厂名称/客户名称/收货仓库/收货人/数量/金额/操作员/审核/审核人/备注)、`...LineDto`(ID/生产单号/款号/模具编号/物料编号/物料名称/用料名称/颜色/加工内容/数量/单价/金额/备注)、`...DetailDto`(单头+明细)、`...CreateLineDto`(同 Line 去 ID)、`...CreateDto`(加工厂编号/加工厂名称/客户名称/交货日期/收货仓库/收货人/备注/明细)、`...BasisRow`(生产单号/款号/模具编号/物料编号/物料名称/用料名称/颜色/加工内容/单价)。

**`PlasticProcessPurchaseOrderService.cs`**(`(ISqlConnectionFactory factory, IDocumentNumberGenerator docNo)`):
- `const DocType="塑胶加工采购单"; const Prefix="SJ";`
- `BasisAsync(生产单号)`:
```sql
SELECT g.[生产单号], pm.[款号], p.[工模编号] AS 模具编号, p.[物料编号], p.[物料名称],
       p.[用料名称], p.[颜色], p.[加工内容], p.[加工单价] AS 单价
FROM [塑胶共用物料表] p
JOIN [生产制单货号] g ON g.[货号] = p.[塑胶货号]
LEFT JOIN [生产制单] pm ON pm.[生产单号] = g.[生产单号]
WHERE g.[生产单号] = @生产单号
ORDER BY p.[ID]
```
- `CreateAsync(dto,user)`:`数量合计=明细.Sum(数量)`、`金额合计=明细.Sum(数量×(单价??0))`;事务 SJ 单号;INSERT 头(审核'0')+ 逐行 INSERT 明细(金额=数量×(单价??0))。
- `ListAsync(page,size,keyword)`(单号/加工厂名称/客户名称 LIKE)、`GetAsync(单号)`(头+明细)、`DeleteAsync(单号)`(已审核抛 InvalidOperationException)。

**`PlasticProcessPurchaseOrderController.cs`**(`[Route("api/plastic-process-purchase-orders")]`·菜单 `塑胶加工采购单`·注入 Service+`IPostingEngine`+`IPermissionService`):`GET`(list·**无单价权限置 金额 null**)、`GET basis?生产单号=`、`GET {单号}`(**无单价权限置 单头金额 null + 明细单价/金额 null**)、`POST`、`DELETE {单号}`(Conflict 捕)、`POST {单号}/approve`(`posting.ApproveAsync("塑胶加工采购单",单号,user)`)、`POST {单号}/unapprove`。

**过账白名单**:`PostableDocuments.cs` 加 `["塑胶加工采购单"]="单号",`。**DI**:`Program.cs` 加 `AddScoped<...PlasticProcessPurchaseOrderService>()`(显式注册·照塑胶采购单)。**菜单**:`MenuCatalog` 加 `new("发外加工","塑胶加工采购单")`;`db/seed_plastic_process_purchase_order_perms.sql` admin 9 位·两库。

## ② 前端

- `api/plasticProcessPurchaseOrder.ts`:Header/Line/Detail/Basis 接口 + `plasticProcessPurchaseOrderApi`(list/basis(生产单号)/get/create/remove/approve/unapprove·端点 `/plastic-process-purchase-orders`)。
- `FactoryPicker.tsx`(新·克隆 `SupplierPicker`·`masterApi("factories")`·返回 `{加工厂编号,加工厂名称}`·列 加工厂编号/加工厂名称)。
- `PlasticProcessPurchaseOrderLineTable.tsx`(克隆 `PlasticPurchaseOrderLineTable`·改列):生产单号(🔍ProductionPicker)|款号|模具编号|物料编号(🔍PlasticMaterialPicker 带出名称/颜色)|物料名称|用料名称|颜色|加工内容|数量(InputNumber)|单价(InputNumber·hidePrice 隐藏)|金额(=数量×单价·hidePrice 隐藏)|备注|删除。
- `PlasticProcessPurchaseOrderPage.tsx`(克隆 `PlasticPurchaseOrderPage`·去右侧合并):头 加工厂(FactoryPicker)/日期(只读)/交货日期(DatePicker)/客户名称/收货仓库/收货人/操作员(只读)/备注;**调入加工清单**(ProductionPicker→basis 填明细·数量默认0·单价从 basis 带)+ 左明细 LineTable + 底部数量/金额合计(`hidePrice` 隐藏金额)+ 历史列表(openDoc/审核/反审核/删除)。`MENU="塑胶加工采购单"`·`hidePrice(perms,MENU)`。
- `App.tsx` 路由 `plastic-process-purchase-orders`;`menuTree.tsx` ⑩ 占位 `M("塑胶加工采购单")` → 带路由。

## ③ 测试

- 后端 `PlasticProcessPurchaseOrderServiceDbTests`(参照 `PlasticPurchaseOrderServiceDbTests`):
  - `Create_then_Get`:种 款号总表(父)+生产制单+生产制单货号+塑胶共用物料表(加工内容 喷油·加工单价 3) → `BasisAsync` 带出 模具编号/加工内容/单价=3 → `CreateAsync`(2 明细·数量 5,3·单价 3)→ `GetAsync` 头数量=8/金额=24·明细回读。
  - `Approve_flips_审核`:approve → 审核='1' 且 审核日期非空。
  - `Delete_approved_throws`。
  - 清理(反 FK 序)。`using Dapper;`。
- 全量 `dotnet test` 绿(386→约389);前端 54 + tsc 干净。
- 冒烟:种链 → basis 带出加工内容/单价 → POST 创建(SJ 单号)→ Get 头数量/金额 → approve 审核='1' → 单价脱敏验证。**起后端 `--contentRoot 输出目录` + 冒烟前 `dotnet build -c Release`(锁先按 PID Stop-Process)。**

## 不做(YAGNI)

- 右侧合并面板、文本导出/前后单/合并/表格设置。

## 执行

writing-plans → subagent-driven → opus 终审 → 分支 `feat-plastic-process-purchase-order` `--no-ff` 合并 → worklog + MEMORY。**坑前置**:审核三件套(PostableDocuments+审核日期列+测试)·生产制单.款号 FK→款号总表(种父反序清)·塑胶服务 DI 显式 AddScoped。
