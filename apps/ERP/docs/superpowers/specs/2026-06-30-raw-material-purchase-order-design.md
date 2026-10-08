# 原料采购订单 · 设计 · 2026-06-30

## 目标

⑪ 原料仓库「原料采购订单」——全屏主从录入单(原料采购计划)。**审核纯锁定不动库存**(订单=计划·收货/入仓才动库存·与塑胶采购订单/塑胶加工采购单一致)。镜像 塑胶加工采购单(PlasticProcessPurchaseOrder)·供应商头 + 原料明细(带价)。**新表**。后续 原料采购进度表 以本单明细为订购源。

## 范围与决策(已确认)

- 审核纯锁定·不动库存(三件套:PostableDocuments 白名单 + 头 审核日期列)。
- 单价类型 = 下拉(含税/未税)。
- 原料 手录(原料编号🔍 从 塑胶原料资料 带出·**无 BOM 调入**)。
- 单价/金额按权限脱敏。
- v1 = 头+明细+保存+审核/反审核+列表/打开/删除。

## 新表(`db/32_raw_material_purchase_order.sql`·EF 不迁移·幂等)

**原料采购订单**(头):
```sql
[ID] bigint IDENTITY(1,1) PRIMARY KEY,
[单号] nvarchar(20) NOT NULL,
[供应商编号] nvarchar(40) NULL,
[供应商名称] nvarchar(80) NULL,
[订购日期] datetime NULL,
[交货日期] datetime NULL,
[数量] decimal(18,4) NULL,
[金额] decimal(18,4) NULL,
[操作员] nvarchar(20) NULL,
[审核] nvarchar(5) NULL,
[审核人] nvarchar(20) NULL,
[审核日期] datetime NULL,
[备注] nvarchar(200) NULL
```
**原料采购订单明细**(明细):
```sql
[ID] bigint IDENTITY(1,1) PRIMARY KEY,
[单号] nvarchar(20) NOT NULL,
[原料编号] nvarchar(40) NULL,
[原料名称] nvarchar(80) NULL,
[规格] nvarchar(60) NULL,
[单位] nvarchar(20) NULL,
[单价类型] nvarchar(20) NULL,
[订货数量] decimal(18,4) NULL,
[单价] decimal(18,4) NULL,
[金额] decimal(18,4) NULL,
[备注] nvarchar(200) NULL
```

## ① 后端(新 `Features/Plastics/PlasticRawMaterialPurchaseOrder/`·克隆塑胶加工采购单去 BOM 调入)

**DTOs**:
- `PlasticRawMaterialPurchaseOrderHeaderDto`:ID/单号/供应商编号/供应商名称/订购日期/交货日期/数量/金额/操作员/审核/审核人/备注。
- `PlasticRawMaterialPurchaseOrderLineDto`:ID/原料编号/原料名称/规格/单位/单价类型/订货数量/单价/金额/备注。
- `PlasticRawMaterialPurchaseOrderDetailDto`:单头? + List<明细>。
- `PlasticRawMaterialPurchaseOrderCreateLineDto`:原料编号/原料名称/规格/单位/单价类型/订货数量/单价/备注。
- `PlasticRawMaterialPurchaseOrderCreateDto`:供应商编号/供应商名称/交货日期/备注 + List<明细>。

**Service**(`DocType="原料采购订单"; Prefix="YCD"`):
- `CreateAsync(dto,user)`:明细空抛 ArgumentException;数量合计=SUM(订货数量)、金额合计=SUM(订货数量×单价);INSERT 头(审核'0'·订购日期=now·操作员=user)+ 逐行 INSERT 明细(金额=订货数量×单价);前缀 YCD。
- `ListAsync(page,size,keyword)`:keyword LIKE 单号/供应商名称;SELECT 头列;ORDER BY ID DESC 分页。
- `GetAsync(单号)`:头 + 明细。
- `DeleteAsync(单号)`:UPDLOCK 取审核;已审核抛 InvalidOperationException;删明细+头。

**Controller**(`api/plastic-raw-material-purchase-order`·Menu="原料采购订单"):list/get/create/delete/approve/unapprove(审核走 IPostingEngine·Table="原料采购订单")。**无单价权限:list 头 金额=null;get 明细 单价/金额=null + 头 金额=null**(镜像 PlasticProcessPurchaseOrderController 脱敏)。

**过账白名单**:`PostableDocuments.cs` 加 `["原料采购订单"]="单号"`。
**DI**:`Program.cs` 注册 `PlasticRawMaterialPurchaseOrderService`。
**菜单+权限**:`MenuCatalog.cs` 加 `new("原料仓库","原料采购订单")`;**新建 `db/seed_raw_material_purchase_order_perms.sql`(先 grep 确认未占用)** admin 9 位(两库)。

## ② 前端(克隆 `PlasticProcessPurchaseOrderPage`)

- `api/plasticRawMaterialPurchaseOrder.ts`:`RMPOLine`(原料编号/原料名称/规格/单位/单价类型/订货数量/单价/金额/备注)+ `RMPOHeader` + `RMPODetail`;base `/plastic-raw-material-purchase-order`;list/get/create/remove/approve/unapprove。
- `PlasticRawMaterialPurchaseOrderLineTable.tsx`(克隆 PlasticProcessPurchaseOrderLineTable):列 原料编号🔍(**PlasticRawMaterialPicker** 回填 原料编号/原料名称/规格/单位/单价)|原料名称只读|规格|单位|单价类型(Select 含税/未税)|订货数量(InputNumber)|单价(InputNumber·hidePrice 隐藏)|金额(=订货数量×单价·hidePrice 隐藏)|备注|删除。
- `PlasticRawMaterialPurchaseOrderPage.tsx`(克隆 PlasticProcessPurchaseOrderPage):
  - 头:供应商(SupplierPicker🔍·必填)/订购日期(只读)/交货日期(DatePicker)/操作员(只读)/备注。
  - 工具栏:新建/保存/审核/反审核/删除/打印(**无调入清单**)。
  - 明细 LineTable;底部 数量合计 + 金额合计(hidePrice 时隐藏金额)+ 制单人。
  - 历史单列表(单号链打开 + 审核/反审核/删除门控·Tag 状态)。
  - 校验:明细 `原料编号 && 订货数量>0` 至少一行;供应商必填。
- `App.tsx`:import + `<Route path="plastic-raw-material-purchase-order" element={<PlasticRawMaterialPurchaseOrderPage />} />`。
- `menuTree.tsx`:`M("原料采购订单")` → `M("原料采购订单","/plastic-raw-material-purchase-order","原料采购订单")`。

## ③ 测试

- 后端 `PlasticRawMaterialPurchaseOrderServiceDbTests`:create(明细 2 行·订货数量 5/3·单价 3)→ 前缀 YCD·get 头 数量=8/金额=24(5×3+3×3)·明细 2 行·明细[0] 金额=15;approve(`engine.ApproveAsync("原料采购订单",单号,...)`)→ 审核1+审核日期非空;delete 已审核抛 InvalidOperationException。Clean 逆序删。
- 全量 `dotnet test` 绿(409→≥412);前端 54 + `tsc` 干净。
- **HTTP 冒烟**:登录 → POST 建(2 明细)→ approve → GET 验 审核=1/数量=8/金额=24/明细2 → 已审核删拒409 → 反审核后删。**起后端 Release(锁先 PID Stop-Process)+ `--contentRoot 输出目录`;node axios `proxy:false`。**

## 不做(YAGNI)

- BOM 调入、复制单、原料采购进度表(下一增量)、收货单联动。

## 执行

writing-plans → subagent-driven → opus 终审 → 分支 `feat-raw-material-purchase-order` `--no-ff` 合并 master → worklog + MEMORY。
