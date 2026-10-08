# 塑胶采购单(塑胶采购订单)· 设计 · 2026-06-29

## 目标

⑦ 塑胶采购「塑胶采购订单」落地。全屏主从录入单据:头(供应商/客户/日期/交货日期/交货地点/编号/备注)+ 左明细网格(按生产单号从 BOM 调入)+ 右侧只读合并汇总 + 审核(纯锁定·不动库存)+ 列表/打开/删除。镜像塑胶物料单(P2)的 head+detail+审核 模式。

## 范围与决策(已确认)

- **审核 = 纯锁定·不动库存**(走通用过账引擎只翻 审核='1'·三件套:`PostableDocuments` 白名单 + 头 审核日期列 + 回归测试)。无任何库存引擎读此单。
- **调入清单 = 按生产单号从塑胶共用物料表 BOM 带入**(同 `PlasticMaterialDocService.BasisAsync` 口径:`塑胶共用物料表 p JOIN 生产制单货号 g ON g.货号=p.塑胶货号`,+生产制单款号)。
- **右侧物料清单(合并)= 只读汇总**(前端 useMemo 按物料编号 SUM 数量合计·标签三列[每箱/预计/实需]无源省略)。
- **v1 范围**:头+左明细+保存+审核+列表/打开/删除。省略 标识贴/文本导出/前后单/打印合并/表格设置/标签三列。

## 数据源(新表·`db/27_plastic_purchase_order.sql`·EF 不迁移)

```sql
IF OBJECT_ID(N'[塑胶采购订单]', N'U') IS NULL
CREATE TABLE [塑胶采购订单] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NOT NULL,
    [日期] datetime NULL,
    [交货日期] datetime NULL,
    [供应商编号] nvarchar(20) NULL,
    [供应商名称] nvarchar(60) NULL,
    [客户名称] nvarchar(60) NULL,
    [交货地点] nvarchar(60) NULL,
    [编号] nvarchar(40) NULL,
    [数量] decimal(18,4) NULL,
    [操作员] nvarchar(20) NULL,
    [审核] nvarchar(5) NULL,
    [审核人] nvarchar(20) NULL,
    [审核日期] datetime NULL,
    [备注] nvarchar(200) NULL
);
IF OBJECT_ID(N'[塑胶采购订单明细]', N'U') IS NULL
CREATE TABLE [塑胶采购订单明细] (
    [ID] bigint IDENTITY(1,1) PRIMARY KEY,
    [单号] nvarchar(20) NOT NULL,
    [生产单号] nvarchar(50) NULL,
    [款号] nvarchar(40) NULL,
    [物料编号] nvarchar(20) NULL,
    [物料名称] nvarchar(40) NULL,
    [模具编号] nvarchar(30) NULL,
    [用量] decimal(18,4) NULL,
    [套数] decimal(18,4) NULL,
    [数量] decimal(18,4) NULL,
    [颜色] nvarchar(20) NULL,
    [色粉号] nvarchar(30) NULL,
    [用料名称] nvarchar(40) NULL,
    [备注] nvarchar(200) NULL
);
```

## ① 后端(`Features/Plastics/PlasticPurchaseOrder/`)

**`PlasticPurchaseOrderDtos.cs`**:`PlasticPurchaseOrderHeaderDto`(ID/单号/日期/交货日期/供应商编号/供应商名称/客户名称/交货地点/编号/数量/操作员/审核/审核人/备注)、`PlasticPurchaseOrderLineDto`(ID/生产单号/款号/物料编号/物料名称/模具编号/用量/套数/数量/颜色/色粉号/用料名称/备注)、`PlasticPurchaseOrderDetailDto`(单头+明细)、`PlasticPurchaseOrderCreateLineDto`(同 Line 去 ID)、`PlasticPurchaseOrderCreateDto`(供应商编号/供应商名称/客户名称/交货日期/交货地点/编号/备注/明细)、`PlasticPurchaseOrderBasisRow`(生产单号/款号/物料编号/物料名称/模具编号/用量/套数/颜色/色粉号/用料名称)。

**`PlasticPurchaseOrderService.cs`**(`(ISqlConnectionFactory factory, IDocumentNumberGenerator docNo)`):
- `const DocType="塑胶采购订单"; const Prefix="SP";`
- `BasisAsync(生产单号)`:
```sql
SELECT g.[生产单号], pm.[款号], p.[物料编号], p.[物料名称], p.[工模编号] AS 模具编号,
       p.[用量], p.[套数], p.[颜色], p.[色粉号], p.[用料名称]
FROM [塑胶共用物料表] p
JOIN [生产制单货号] g ON g.[货号] = p.[塑胶货号]
LEFT JOIN [生产制单] pm ON pm.[生产单号] = g.[生产单号]
WHERE g.[生产单号] = @生产单号
ORDER BY p.[ID]
```
- `CreateAsync(dto,user)`:`数量合计=明细.Sum(数量)`;事务:`单号=NextAsync(DocType,Prefix,now,c,tx)`;INSERT 头(审核'0')+ 逐行 INSERT 明细;返回单号。
- `ListAsync(page,size,keyword)`:`COUNT + SELECT [ID],[单号],[日期],[交货日期],[供应商名称],[客户名称],[数量],[操作员],[审核],[审核人],[备注] FROM [塑胶采购订单] WHERE @kw IS NULL OR [单号] LIKE @kw OR [供应商名称] LIKE @kw OR [客户名称] LIKE @kw ORDER BY [ID] DESC OFFSET...`(分页)。
- `GetAsync(单号)`:头 SELECT(全列含交货日期/交货地点/编号)+ 明细 SELECT。
- `DeleteAsync(单号)`:UPDLOCK 读审核;已审核('1')抛 `InvalidOperationException`;否则删明细+头(事务)。

**`PlasticPurchaseOrderController.cs`**(`[Route("api/plastic-purchase-orders")]`·菜单 `塑胶采购订单`·注入 `PlasticPurchaseOrderService`+`IPostingEngine`+`IPermissionService`):
- `GET ?page=&size=&keyword=`(打开)、`GET basis?生产单号=`(打开·返 BasisRow[])、`GET {单号}`(打开)、`POST`(保存)、`DELETE {单号}`(删除·Conflict 捕 InvalidOperationException)、`POST {单号}/approve`(审核·`posting.ApproveAsync("塑胶采购订单",单号,user)`)、`POST {单号}/unapprove`(反审核)。镜像 `PlasticReceiptController` 的权限/动作骨架(无脱敏——采购单数量无价)。

**过账白名单**:`src/ErpApi/Engines/Posting/PostableDocuments.cs` 加 `["塑胶采购订单"] = "单号",`。

**菜单 + 权限**:`MenuCatalog` 在 `new("塑胶采购","塑胶订单制作"),` 后加 `new("塑胶采购","塑胶采购订单"),`;`db/seed_plastic_purchase_order_perms.sql` admin 9 位·两库。

## ② 前端

- `api/plasticPurchaseOrder.ts`:Header/Line/Detail/Basis 接口 + `plasticPurchaseOrderApi`(list/basis(生产单号)/get/create/remove/approve/unapprove)。
- `PlasticPurchaseOrderPage.tsx`(全屏主从·镜像塑胶单据录入页如 `PlasticReceiptFormPage` 结构):
  - 头 Form:供应商(SupplierPicker)/日期(只读 today)/交货日期(DatePicker)/客户名称/交货地点/编号/备注/操作员(只读)。
  - **调入清单** 按钮 → ProductionPicker 选生产单 → `plasticPurchaseOrderApi.basis(生产单号)` → 填左明细(每行 数量 默认=用量×套数? 否则 0,可录)。**注:数量列用户可录(默认空/0)**。
  - 左明细可编辑网格 `PlasticPurchaseOrderLineTable`(生产单号🔍ProductionPicker/款号/物料编号🔍PlasticMaterialPicker[手工补行带出名称/颜色]/物料名称只读/模具编号/用量/套数/数量[InputNumber]/颜色/色粉号/用料名称/备注/删除)。
  - 右侧只读合并 Table(useMemo 按物料编号 GROUP:序号/物料编号/物料名称/数量合计=SUM 数量)。
  - 底部 数量合计 Statistic。
  - 下方历史列表 Table(单号点开 openDoc·供应商/客户/数量/日期/状态/操作[审核/反审核/删除])。
  - 保存校验:至少一行有效(物料编号+数量>0)。
- `App.tsx` 路由 `plastic-purchase-orders`;`menuTree.tsx` ⑦ 占位 `M("塑胶采购订单")` → 带路由。

## ③ 测试

- 后端 `PlasticPurchaseOrderServiceDbTests`:
  - `Create_then_Get`:种 款号总表(父)+生产制单+生产制单货号+塑胶共用物料表(BOM)→ `BasisAsync` 带出 BOM 行(模具编号=工模编号/套数/色粉号)→ `CreateAsync`(2 明细)→ `GetAsync` 回读头(数量合计)+明细一致。
  - `Approve_flips_审核`:create → `IPostingEngine.ApproveAsync("塑胶采购订单",单号,user)` → Get 审核='1'(三件套验证·**审核日期非空**)。
  - `Delete_approved_throws`:审核后删抛 InvalidOperationException。
  - 清理(反 FK 序:明细/头·BOM/生产制单货号/生产制单/款号总表)。`using Dapper;`。
- 全量 `dotnet test` 绿(377→380 约 +3);前端 54 + tsc 干净。
- 冒烟:种链 → `basis` 带出 → `POST` 创建 → `GET` 回读 → `approve` → Get 审核='1'·审核日期非空。**起后端 `--contentRoot 输出目录` + 冒烟前 `dotnet build -c Release`(锁先 Stop-Process)。**

## 不做(YAGNI)

- 标识贴/文本导出/前后单/打印合并/表格设置/标签三列/价格。

## 执行

writing-plans → subagent-driven → opus 终审 → 分支 `feat-plastic-purchase-order` `--no-ff` 合并 → worklog + MEMORY。**坑前置**:审核三件套(PostableDocuments 白名单 + 审核日期列 + 回归测试)·生产制单.款号 FK→款号总表(种父反序清)。
