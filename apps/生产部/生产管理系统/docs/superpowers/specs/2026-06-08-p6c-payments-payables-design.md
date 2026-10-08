# P6c 采购/发外付款 + 应付对账 设计

> 兴信B ERP 净室重建 · P6 下游(M9)第三切片 · 2026-06-08 · 算法5(应付)落地 · P6 主线收官

**目标**：建**采购付款单**（供应商应付）+ **发外加工付款单**（加工厂应付），与**应付对账报表**（算法5 AP：`应付余额 = 入仓/回收 − 付款`，按供应商/加工厂两口径）。与 P6b 收款/应收完全对称（镜像）。完成后 P6 主线（出货/收付款/应收应付）基本闭环。

**已确认决策（与用户）**：
- 付款按**供应商/加工厂级挂账**（付款明细=对方+付款金额；货款/尚欠金额留 0）。
- 应付对账**两个报表/端点**（供应商口径、加工厂口径，维度不同）。
- 任务 5 切：采购付款 / 发外付款 / 应付对账 / 前端 / 收尾。
- 付款是纯应付，**不碰库存、不接 periodLock**。`成品入仓付款单` 延后。

---

## 1. 数据模型 — 零改表

`采购付款单`/`采购付款明细单`、`发外加工付款单`/`发外加工付款明细单` 已存在。已核实：
- 付款明细列：(入仓单号/发外单号)/单号/日期/对方编号/对方名称/货款金额/付款金额/尚欠金额/备注 —— **无 `审核` 列**（半成品式，审核仅单头）。
- FK：采购付款明细单.单号→采购付款单、.供应商编号→供应商资料(547)；发外加工付款明细单.单号→发外加工付款单、.加工厂编号→加工厂资料(547)。
- 两付款单都在 `PostableDocuments` 白名单，审核留痕列 03 已补。**无新建/ALTER 脚本**。

**应付金额来源**（已核实）：
- 供应商：`采购入仓单`(头) 有 供应商编号/供应商名称/金额/审核 —— 入仓段用**单头**(一入仓单一供应商)。
- 加工厂：`发外回收明细单` 有 加工厂编号/加工厂名称/金额(加工费)/**审核(明细自带)** —— 回收段用**明细**直接过滤 `审核='1'`(类成品)。

## 2. 付款服务（`src/ErpApi/Features/Payables/`）

镜像 P6b `SalesReceiptService`（两层 Dapper 事务，半成品式单头审核，UPDLOCK 删除守卫，明细级对方）：

### PurchasePaymentService（采购付款，前缀 `CF`，DocType `采购付款单`）
- 头：入仓单号?/单号/日期/金额(=Σ付款金额)/操作员/审核'0'/备注。
- 明细：供应商编号/供应商名称/付款金额；货款金额/尚欠金额留 0；入仓单号?。
- CreateAsync/ListAsync/GetAsync/DeleteAsync。

### OutsourcePaymentService（发外加工付款，前缀 `FF`，DocType `发外加工付款单`）
- 头：发外单号?/单号/日期/金额/操作员/审核'0'/备注。
- 明细：加工厂编号/加工厂名称/付款金额；货款金额/尚欠金额留 0；发外单号?。
- CreateAsync/ListAsync/GetAsync/DeleteAsync。

## 3. 应付对账（`PayablesService` + `PayablesController`，只读 Dapper，算法5）

### 供应商应付 SupplierAsync(供应商编号?)
```sql
SELECT 供应商编号, MAX(供应商名称) AS 供应商名称,
       SUM(CASE WHEN 类型='入仓' THEN 金额 ELSE 0 END) AS 入仓金额,
       SUM(CASE WHEN 类型='付款' THEN 金额 ELSE 0 END) AS 付款金额,
       SUM(CASE WHEN 类型='入仓' THEN 金额 WHEN 类型='付款' THEN -金额 ELSE 0 END) AS 应付余额
FROM (
    SELECT 供应商编号, 供应商名称, '入仓' AS 类型, ISNULL(金额,0) AS 金额
      FROM [采购入仓单] WHERE ISNULL(审核,'0')='1'
    UNION ALL
    SELECT d.供应商编号, d.供应商名称, '付款', ISNULL(d.付款金额,0)
      FROM [采购付款明细单] d JOIN [采购付款单] h ON h.单号=d.单号 WHERE ISNULL(h.审核,'0')='1'
) t WHERE @供应商编号 IS NULL OR 供应商编号=@供应商编号
GROUP BY 供应商编号 ORDER BY 供应商编号;
```

### 加工厂应付 FactoryAsync(加工厂编号?)
```sql
SELECT 加工厂编号, MAX(加工厂名称) AS 加工厂名称,
       SUM(CASE WHEN 类型='回收' THEN 金额 ELSE 0 END) AS 回收金额,
       SUM(CASE WHEN 类型='付款' THEN 金额 ELSE 0 END) AS 付款金额,
       SUM(CASE WHEN 类型='回收' THEN 金额 WHEN 类型='付款' THEN -金额 ELSE 0 END) AS 应付余额
FROM (
    SELECT 加工厂编号, 加工厂名称, '回收' AS 类型, ISNULL(金额,0) AS 金额
      FROM [发外回收明细单] WHERE ISNULL(审核,'0')='1'
    UNION ALL
    SELECT d.加工厂编号, d.加工厂名称, '付款', ISNULL(d.付款金额,0)
      FROM [发外加工付款明细单] d JOIN [发外加工付款单] h ON h.单号=d.单号 WHERE ISNULL(h.审核,'0')='1'
) t WHERE @加工厂编号 IS NULL OR 加工厂编号=@加工厂编号
GROUP BY 加工厂编号 ORDER BY 加工厂编号;
```

- DTO：`PayableSupplierRow`(供应商编号/供应商名称/入仓金额/付款金额/应付余额)、`PayableFactoryRow`(加工厂编号/加工厂名称/回收金额/付款金额/应付余额)。
- `PayablesController`：`GET api/payables/supplier?供应商编号=`、`GET api/payables/factory?加工厂编号=`；Menu `应付对账`；仅 `打开` 权限（财务报表，打开即看金额，不逐列脱敏）。

## 4. 控制器 + DI + 权限

- `PurchasePaymentController`(`api/purchase-payments`,Menu `采购付款`,Table `采购付款单`)、`OutsourcePaymentController`(`api/outsource-payments`,Menu `发外付款`,Table `发外加工付款单`)：镜像 P6b `SalesReceiptController`（审核引擎②，**无 SyncLineApprovalAsync**，成本保密**按 `金额` 权限**剥离 货款/付款/尚欠金额，547→对方不存在）。
- DI：`Program.cs` 注册 PurchasePaymentService/OutsourcePaymentService/PayablesService。
- 权限种子 `db/seed_p6c_perms.sql`：admin 采购付款(9位全)、发外付款(9位全)、应付对账(打开/打印/金额/功能)。

## 5. 前端

- `web/src/api/payables.ts`：`purchasePaymentApi`、`outsourcePaymentApi`（list/get/create/remove/approve/unapprove）、`payablesApi.supplier(供应商编号?)`/`payablesApi.factory(加工厂编号?)` + 类型。
- 页面 `web/src/pages/payables/`：采购付款页、发外付款页（仿 P6b 收款页，明细=对方+付款金额）、应付对账页（口径 Select 供应商/加工厂 切换两端点，列 对方/入仓或回收金额/付款金额/应付余额，应付余额>0 红色）。
- 菜单：新独立组 **「应付管理」**（key `ap`）：采购付款/发外付款/应付对账；`App.tsx` 加路由 `/purchase-payments`、`/outsource-payments`、`/payables`；Header 标题链补。
- `web/src/utils/payLines.ts`：`sumPay(lines)`=Σ付款金额 + 单测。

## 6. 测试

- 后端 `PurchasePaymentServiceDbTests`/`OutsourcePaymentServiceDbTests`：建单(金额=Σ付款金额)+删除护栏；seed 供应商资料/加工厂资料 FK。
- 后端 `PayablesServiceDbTests`：供应商 入仓100(审核)−付款30(审核)=应付70；加工厂 回收80(明细审核)−付款20(审核)=应付60。
- 后端 `P6cPayablesApiIntegrationTests`：付款权限403/生命周期/成本保密(缺金额→金额列null)；应付对账 打开权限读两端点。
- 前端 util/页面测试。

## 7. 范围外（后续）

逐单核销/账龄、成品入仓付款单、装箱、多币种。

## 8. 风险与对策

| 风险 | 对策 |
|---|---|
| 付款明细无审核列 | 审核仅单头（半成品式）；无 SyncLineApprovalAsync；应付对账付款段 JOIN 单头审核。 |
| 入仓/回收 审核口径不同 | 采购入仓用单头审核(入仓段取单头)；发外回收用**明细审核**(发外回收明细单自带审核列,直接过滤)。 |
| 两口径维度不同 | 供应商/加工厂两个独立端点+DTO，不混表。 |
| 金额泄露 | 付款单据 Get 按 `金额` 权限脱敏；应付对账打开权限即看(财务报表本质金额)。 |
| 不碰库存/不锁期 | 付款纯应付，不进库存账本、不接 periodLock。 |
