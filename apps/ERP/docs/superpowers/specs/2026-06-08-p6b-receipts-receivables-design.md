# P6b 销售收款 + 应收对账 设计

> 兴信B ERP 净室重建 · P6 下游(M9)第二切片 · 2026-06-08 · 算法5(应收)落地

**目标**：建**销售收款单**（客户级挂账收款，冲应收）+ **应收对账报表**（算法5：`应收余额 = 出货 − 收款 − 退货` 按客户）。出货/退货段已由 P6a 就绪，本片补收款段 + 对账。

**已确认决策（与用户）**：
- 收款挂应收按**客户级预收/挂账**（收款明细=客户+收款金额；货款金额/应收金额留空作备注；不做逐单核销/账龄）。
- 两个同构收款单族只建**销售收款单**（算法5 用 `销售收款明细单`）；成品客户收款单弃用/延后。
- 应收对账报表：有「应收对账」菜单**打开权限即可看金额**（财务报表本质是金额，不逐列脱敏）。
- 收款是应收类，**不碰库存**、**不接 periodLock**（不在月结库存口径）。

---

## 1. 数据模型 — 零改表

`销售收款单`/`销售收款明细单` 已存在。已核实：
- 明细列 = 出仓单号/单号/日期/客户编号/客户名称/货款金额/收款金额/应收金额/备注 —— **无 `审核` 列**（半成品式：审核仅单头）。
- FK：`销售收款明细单.单号` → `销售收款单`(主从)、`.客户编号` → `客户资料`(查找，547→客户不存在)。
- `销售收款单` 已在 `PostableDocuments` 白名单（单号列=`单号`），审核人/审核日期列 `03_p0_additions.sql` 已补。
- **无新建/ALTER 脚本**。

## 2. 销售收款服务（`src/ErpApi/Features/Sales/SalesReceiptService.cs`，前缀 `XK`）

- DocType `销售收款单`，Prefix `XK`。两层 Dapper 事务（明细单号主从，插头→明细，删反序，UPDLOCK 删除守卫），仿 P6a `SalesShipmentService`。
- 头：单号/日期/金额(=Σ收款金额)/操作员/审核'0'/备注；`出仓单号` 可空（本片不强用，留作引用）。
- 明细：客户编号/客户名称/收款金额；`货款金额`/`应收金额` 本片留 0（客户级挂账不逐单算余额）；`出仓单号` 可空。明细不写审核列。
- `CreateAsync`（校验明细非空；客户级——每行客户编号必填或头级客户？取**明细级客户**，每行带客户编号/客户名称+收款金额，支持一单收多客户；金额合计回写头）、`ListAsync`（单号/客户名称模糊）、`GetAsync`、`DeleteAsync`（已审核不可删→InvalidOperationException）。

## 3. 应收对账服务 + 控制器（`src/ErpApi/Features/Sales/ReceivablesService.cs` + `ReceivablesController.cs`）

算法5（Dapper 只读，UNION 符号法，JOIN 各单头按 `审核='1'` 过滤）：

```sql
SELECT 客户编号, MAX(客户名称) AS 客户名称,
       SUM(CASE WHEN 类型='出货' THEN 金额 ELSE 0 END) AS 出货金额,
       SUM(CASE WHEN 类型='收款' THEN 金额 ELSE 0 END) AS 收款金额,
       SUM(CASE WHEN 类型='退货' THEN 金额 ELSE 0 END) AS 退货金额,
       SUM(CASE WHEN 类型='出货' THEN 金额 WHEN 类型='收款' THEN -金额 WHEN 类型='退货' THEN -金额 ELSE 0 END) AS 应收余额
FROM (
    SELECT d.客户编号, d.客户名称, '出货' AS 类型, ISNULL(d.金额,0) AS 金额
      FROM [销售出货明细单] d JOIN [销售出货单] h ON h.单号=d.单号 WHERE ISNULL(h.审核,'0')='1'
    UNION ALL
    SELECT d.客户编号, d.客户名称, '退货', ISNULL(d.金额,0)
      FROM [销售退货明细单] d JOIN [销售退货单] h ON h.单号=d.单号 WHERE ISNULL(h.审核,'0')='1'
    UNION ALL
    SELECT d.客户编号, d.客户名称, '收款', ISNULL(d.收款金额,0)
      FROM [销售收款明细单] d JOIN [销售收款单] h ON h.单号=d.单号 WHERE ISNULL(h.审核,'0')='1'
) t
WHERE @客户编号 IS NULL OR 客户编号=@客户编号
GROUP BY 客户编号
ORDER BY 客户编号;
```

- `ReceivablesService.ListAsync(客户编号?)` → `IReadOnlyList<ReceivableRow>`（客户编号/客户名称/出货金额/收款金额/退货金额/应收余额，均 decimal）。
- `ReceivablesController`：`GET /api/receivables?客户编号=`；Menu `应收对账`；仅 `打开` 权限（**无逐列脱敏**——财务报表本质是金额，按用户决策）。只读，无审核/无写。

## 4. 控制器 + DI + 权限

- `SalesReceiptController`：`api/sales-receipts`；Menu `销售收款`；Table `销售收款单`；模式同 P6a（List/Get/Create/Delete/Approve/Unapprove，审核引擎②，**无 SyncLineApprovalAsync**）。**成本保密**：Get 缺 `金额` 权限时把每行 `货款金额/收款金额/应收金额` 置 null（收款无单价列，按 `金额` 权限脱敏）。547→客户不存在。
- DI：`Program.cs` 注册 `SalesReceiptService`、`ReceivablesService`。
- 权限种子 `db/seed_p6b_perms.sql`：admin `销售收款`(9位全) + `应收对账`(打开/打印/功能)。

## 5. 前端

- `web/src/api/sales.ts` 追加：`salesReceiptApi`(list/get/create/remove/approve/unapprove)、`receivablesApi.list(客户编号?)` + 类型。
- 页面：`web/src/pages/sales/SalesReceiptPage.tsx`（收款单：客户+收款金额明细，审核/反审核/删除）、`web/src/pages/sales/ReceivablesPage.tsx`（应收对账报表：客户/出货金额/收款金额/退货金额/应收余额，可选客户筛选；应收余额>0 红色高亮）。
- 菜单：「销售管理」组追加 `销售收款`、`应收对账`（现共 4 项：出货/退货/收款/应收对账）；`App.tsx` 加路由 `/sales-receipts`、`/receivables`；Header 标题链补。

## 6. 测试

- 后端 `SalesReceiptServiceDbTests`：建单（金额=Σ收款金额回写）、删除护栏；seed 客户资料 FK。
- 后端 `ReceivablesServiceDbTests`：造客户的 出货100(审核) + 退货10(审核) + 收款30(审核) → 应收余额=60；未审核不计；按客户编号筛选。
- 后端 `P6bReceiptsApiIntegrationTests`：收款权限403/生命周期/成本保密(缺金额→金额列null)；应收对账 打开权限读报表（无打开→403）。
- 前端 util/页面测试。

## 7. 范围外（后续）

逐单核销/账龄、成品客户收款单、采购/发外付款+应付对账（P6c）、装箱、多币种、出仓单号联动收款。

## 8. 风险与对策

| 风险 | 对策 |
|---|---|
| 收款明细无审核列 | 审核仅单头（半成品式）；无 SyncLineApprovalAsync；应收对账 JOIN 单头审核。 |
| 应收对账金额泄露 | 按用户决策：「应收对账」打开权限即授权看金额（报表全是金额，不逐列脱敏）。收款单据 Get 仍按金额权限脱敏。 |
| 客户级 vs 逐单 | 本片客户级挂账（算法5 按客户汇总）；逐单核销/账龄延后。 |
| 双收款单族 | 只建销售收款单（算法5 用它）；成品客户收款单弃用。 |
| 不碰库存/不锁期 | 收款是纯应收，不进库存账本、不接 periodLock。 |
