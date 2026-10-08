# 应收 逐单核销 + 账龄 设计

> 兴信B ERP 净室重建 · P6 下游财务增强 · 2026-06-09

**目标**：应收(AR)从「客户级挂账」升级到**逐张出货单核销 + 账龄分析**。现有 `销售收款明细单` 已按单记账(出仓单号/货款金额/收款金额/应收金额)，故逐单核销为**纯派生只读层**(零改表)；并增强销售收款录入「带出客户待核销出货单」。

**已确认决策**：仅应收 AR(应付 AP 同构后续);**派生式核销**(无核销表/无手工匹配,收款明细.出仓单号 即逐单关联);账龄桶 **0-30 / 31-60 / 61-90 / 90+**;增强收款录入带出待核销出货单。

---

## 1. 数据模型 — 零改表

逐单核销按 `销售出货单.单号` 派生（均限 审核='1'）：
- 应收金额 = Σ `销售出货明细单.金额` (by 单号)
- 退货金额 = Σ `销售退货明细单.金额` (by 销售单号 = 原出货单号)
- 已收金额 = Σ `销售收款明细单.收款金额` (by 出仓单号 = 出货单号)
- 未核销余额 = 应收 − 退货 − 已收
- 账龄 = DATEDIFF(day, 销售出货单.日期, 基准日)

**无新建/ALTER**。

## 2. 服务（`src/ErpApi/Features/Sales/ReceivablesService.cs` 增方法）

注入沿用 `ISqlConnectionFactory factory`。新增（共用一段 per-invoice 派生子查询）：
- `SettlementAsync(string? 客户编号, bool 仅未结清=false)` → `List<ReceivableSettlementRow>`：逐张出货单 应收/退货/已收/未核销余额 + 出货日期/客户;仅未结清时过滤 `余额 > 0.005`。按 客户编号,日期,单号 排序。
- `AgingAsync(string? 客户编号, DateTime? 基准日)` → `List<ReceivableAgingRow>`：在 per-invoice(仅余额>0) 上 `DATEDIFF(day,出货日期,@基准)` 分桶，按客户聚合 4 桶 + 合计。基准日缺省今天。
- `UnsettledShipmentsAsync(string 客户编号)` → `List<UnsettledShipmentRow>`：某客户**未核销出货单**(余额>0) 列表(出货单号/出货日期/应收金额/已收金额/未核销余额)，供收款录入带出。

派生 SQL 骨架：
```sql
FROM [销售出货单] s
LEFT JOIN (SELECT [单号],SUM(ISNULL([金额],0)) 应收 FROM [销售出货明细单] GROUP BY [单号]) o ON o.[单号]=s.[单号]
LEFT JOIN (SELECT d.[销售单号],SUM(ISNULL(d.[金额],0)) 退货 FROM [销售退货明细单] d JOIN [销售退货单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1' GROUP BY d.[销售单号]) r ON r.[销售单号]=s.[单号]
LEFT JOIN (SELECT d.[出仓单号],SUM(ISNULL(d.[收款金额],0)) 已收 FROM [销售收款明细单] d JOIN [销售收款单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1' GROUP BY d.[出仓单号]) p ON p.[出仓单号]=s.[单号]
WHERE ISNULL(s.[审核],'0')='1' AND (@客户编号 IS NULL OR s.[客户编号]=@客户编号)
```
余额 = `ISNULL(o.应收,0)-ISNULL(r.退货,0)-ISNULL(p.已收,0)`。

DTO（`SalesDtos.cs`）：
- `ReceivableSettlementRow {出货单号,出货日期(DateTime?),客户编号,客户名称,应收金额,退货金额,已收金额,未核销余额}`
- `ReceivableAgingRow {客户编号,客户名称,账龄0_30,账龄31_60,账龄61_90,账龄90以上,合计}`（C# 中文标识符可含数字,不以数字开头）
- `UnsettledShipmentRow {出货单号,出货日期(DateTime?),应收金额,已收金额,未核销余额}`

## 3. 控制器（`ReceivablesController`，Menu 应收对账，打开权限）

`api/receivables` 加：
- `GET settlement?客户编号=&仅未结清=` → SettlementAsync。
- `GET aging?客户编号=&基准日=` → AgingAsync。
- `GET unsettled?客户编号=`(必填) → UnsettledShipmentsAsync。
- 复用「应收对账」菜单 打开 权限(均只读金额类,沿用该菜单授权;**不脱敏**——应收对账本就是金额视图,与现有 list 一致)。**MenuCatalog 无需改**。

## 4. 收款录入增强

`SalesReceiptController`(Menu 销售收款) 加 `GET unsettled?客户编号=`(打开权限) 或前端直接调 receivables/unsettled。前端销售收款创建抽屉：选客户 → 「带出待核销出货单」→ 列出未核销出货单(应收/已收/余额) → 勾选并填本次收款金额 → 生成明细行(出仓单号=出货单号,货款金额=应收,收款金额=本次,应收金额=余额−本次)。

## 5. 前端

- `web/src/api/` 应收对账/收款 api 加 `settlement/aging/unsettled`。
- 应收对账页：加 Tabs「客户汇总(现有)/逐单核销/账龄」。逐单核销 Table(出货单号/日期/客户/应收/退货/已收/余额,可筛客户+仅未结清);账龄 Table(客户/4桶/合计,可筛客户+基准日)。
- 销售收款创建抽屉：客户 + 「带出待核销出货单」按钮 → 弹列表勾选填收款金额 → 填明细。

## 6. 测试

- 后端 `ReceivablesSettlementDbTests`：seed 客户+出货单(XS_T1,审核,明细金额1000)+收款(XK,出仓单号=XS_T1,收款金额400,审核)+退货(销售单号=XS_T1,金额100,审核)→ SettlementAsync 该单 应收1000/退货100/已收400/余额500;AgingAsync(基准日=出货日+45天) 该客户 账龄31_60=500;UnsettledShipmentsAsync 含 XS_T1 余额500;全额收款后(再收500)余额0→仅未结清不含。清理。
- 后端 API 测试：无打开→403;settlement/aging/unsettled 200。
- 前端：构建通过;现有测试不减。

## 7. 范围外（延后）

应付 AP 逐单核销/账龄(同构,后续对称复制)、手工核销冲账(指定某收款冲某单的明细级链接表)、超收/预收处理、账龄按发票号而非出货单、多币种账龄。

## 8. 风险与对策

| 风险 | 对策 |
|---|---|
| 出仓单号语义 | 收款明细.出仓单号 存的是被收款的销售出货单号(=AR源单号);派生按 出仓单号=出货单.单号 关联;文档/前端带出时写入出货单号确保一致。 |
| 余额浮点 | 比较用 `> 0.005` 容差;decimal 计算。 |
| 性能 | 派生子查询各自 GROUP BY 后 JOIN;数据量大时可后续接快照,本期实时。 |
| 退货/收款口径 | 均限 审核='1'(与现有算法5一致)。 |
| 不脱敏 | 应收视图本就是金额报表,沿用应收对账菜单授权(打开即看),与现有 list 一致。 |
