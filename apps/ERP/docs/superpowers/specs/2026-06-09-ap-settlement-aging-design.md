# 应付 AP 逐单核销 + 账龄 设计

> 兴信B ERP 净室重建 · P6 下游财务增强(对称 AR) · 2026-06-09

**目标**：应付(AP)从「往来级挂账」升级到**逐单核销 + 账龄**，对称复制 AR(应收)的派生只读层。两条平行轨：**供应商(采购入仓单 ← 采购付款)** + **加工厂(发外单 ← 发外回收/发外付款)**。零改表。

**已确认**(对称 AR + 用户选 AP)：派生式核销(无核销表);账龄桶 0-30/31-60/61-90/90+;增强 采购付款 & 发外付款 录入「带出待付单」。

---

## 1. 数据模型 — 零改表

**供应商轨**(按 采购入仓单.单号)：
- 应付金额 = `采购入仓单.金额`(单头,审核'1')
- 已付金额 = Σ `采购付款明细单.付款金额` (by 入仓单号,付款单头审核'1')
- 未付余额 = 应付 − 已付;账龄 by `采购入仓单.日期`

**加工厂轨**(按 发外单号——发外付款按发外单号关联,非回收单号)：
- 应付金额 = Σ `发外回收明细单.金额` (by 发外单号,**明细审核'1'**——发外回收 detail-审核)
- 已付金额 = Σ `发外加工付款明细单.付款金额` (by 发外单号,付款单头审核'1')
- 未付余额 = 应付 − 已付;账龄 by `MIN(发外回收明细单.日期)` (by 发外单号)

**无新建/ALTER**。

## 2. 服务（`src/ErpApi/Features/Payables/PayablesService.cs` 增方法，保留现有 SupplierAsync/FactoryAsync 算法5）

per-doc 派生子查询常量两段：
```sql
-- PerPurchase (供应商轨)
SELECT s.[单号] AS 入仓单号, s.[日期] AS 入仓日期, s.[供应商编号], s.[供应商名称],
  ISNULL(s.[金额],0) AS 应付金额, ISNULL(p.已付,0) AS 已付金额, ISNULL(s.[金额],0)-ISNULL(p.已付,0) AS 未付余额
FROM [采购入仓单] s
LEFT JOIN (SELECT d.[入仓单号],SUM(ISNULL(d.[付款金额],0)) 已付 FROM [采购付款明细单] d JOIN [采购付款单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1' GROUP BY d.[入仓单号]) p ON p.[入仓单号]=s.[单号]
WHERE ISNULL(s.[审核],'0')='1'

-- PerOutsource (加工厂轨)
SELECT f.发外单号, f.回收日期, f.加工厂编号, f.加工厂名称,
  ISNULL(f.应付,0) AS 应付金额, ISNULL(p.已付,0) AS 已付金额, ISNULL(f.应付,0)-ISNULL(p.已付,0) AS 未付余额
FROM (SELECT d.[发外单号], MIN(d.[日期]) AS 回收日期, MAX(d.[加工厂编号]) AS 加工厂编号, MAX(d.[加工厂名称]) AS 加工厂名称, SUM(ISNULL(d.[金额],0)) AS 应付
      FROM [发外回收明细单] d WHERE ISNULL(d.[审核],'0')='1' GROUP BY d.[发外单号]) f
LEFT JOIN (SELECT d.[发外单号],SUM(ISNULL(d.[付款金额],0)) 已付 FROM [发外加工付款明细单] d JOIN [发外加工付款单] h ON h.[单号]=d.[单号] WHERE ISNULL(h.[审核],'0')='1' GROUP BY d.[发外单号]) p ON p.[发外单号]=f.发外单号
```
方法（6 个，套子查询 + 过滤/分桶，同 AR）：
- `SupplierSettlementAsync(供应商编号?, 仅未结清)` / `SupplierAgingAsync(供应商编号?, 基准日?)` / `SupplierUnpaidAsync(供应商编号)`
- `FactorySettlementAsync(加工厂编号?, 仅未结清)` / `FactoryAgingAsync(加工厂编号?, 基准日?)` / `FactoryUnpaidAsync(加工厂编号)`
- 仅未结清/Unpaid 过滤 `未付余额 > 0.005`;账龄 `DATEDIFF(day, 入仓/回收日期, @基准)` 分桶。

DTO（`PayablesDtos.cs`）：
- `PayableSupplierSettlementRow {入仓单号,入仓日期,供应商编号,供应商名称,应付金额,已付金额,未付余额}`
- `PayableFactorySettlementRow {发外单号,回收日期,加工厂编号,加工厂名称,应付金额,已付金额,未付余额}`
- `PayableSupplierAgingRow {供应商编号,供应商名称,账龄0_30,账龄31_60,账龄61_90,账龄90以上,合计}`
- `PayableFactoryAgingRow {加工厂编号,加工厂名称,账龄0_30,账龄31_60,账龄61_90,账龄90以上,合计}`
- `UnpaidPurchaseRow {入仓单号,入仓日期,应付金额,已付金额,未付余额}`
- `UnpaidOutsourceRow {发外单号,回收日期,应付金额,已付金额,未付余额}`

## 3. 控制器（`PayablesController`，Menu 应付对账，打开）

`api/payables` 加 6 端点：
- `GET supplier-settlement?供应商编号=&仅未结清=` / `GET supplier-aging?供应商编号=&基准日=` / `GET supplier-unpaid?供应商编号=`(必填,缺→400)
- `GET factory-settlement?加工厂编号=&仅未结清=` / `GET factory-aging?加工厂编号=&基准日=` / `GET factory-unpaid?加工厂编号=`(必填)
- 复用「应付对账」菜单 打开;不脱敏(金额报表);**MenuCatalog 无需改**。

## 4. 付款录入增强

- 采购付款创建抽屉：选供应商 → 「带出待付入仓单」→ supplier-unpaid → 勾选填本次付款 → 明细行(入仓单号/货款金额=应付/付款金额=本次/尚欠金额=余额−本次)。
- 发外付款创建抽屉：选加工厂 → 「带出待付发外单」→ factory-unpaid → 明细行(发外单号/货款金额/付款金额/尚欠金额)。

## 5. 前端

- 应付对账 api 加 6 方法;页面加 Tabs（供应商汇总(现有)/供应商逐单/供应商账龄/加工厂汇总(现有)/加工厂逐单/加工厂账龄，或两组 Tab）。
- 采购付款、发外付款 创建抽屉加「带出待付单」picker。

## 6. 测试

- 后端 `PayablesSettlementDbTests`：
  - 供应商：seed 供应商+采购入仓单(CG_T1,金额1000,审核,日期d0)+采购付款明细(入仓单号=CG_T1,付款金额400,付款单审核)→ SupplierSettlementAsync 该单 应付1000/已付400/未付600;SupplierAgingAsync(d0+45) 账龄31_60=600;SupplierUnpaidAsync 含 CG_T1 余额600。
  - 加工厂：seed 加工厂+发外回收明细(发外单号 FW_T1,金额800,审核'1',日期d0)+发外付款明细(发外单号=FW_T1,付款金额300,付款单审核)→ FactorySettlementAsync FW_T1 应付800/已付300/未付500;FactoryAging(d0+10) 账龄0_30=500;FactoryUnpaid 含 FW_T1 余额500。
  - 清理。
- 后端 API 测试：无 应付对账 打开→6端点403;有→settlement/aging 200;unpaid 缺编号→400。
- 前端：构建通过;测试不减。

## 7. 范围外（延后）

采购退仓/退料冲应付、超付/预付、按发票号账龄、手工核销冲账链接表、多币种。

## 8. 风险与对策

| 风险 | 对策 |
|---|---|
| 发外付款关联键 | 按 **发外单号**(发外付款明细/发外回收明细 共有),非回收单号;加工厂轨以发外单号为核销单元。 |
| 发外回收 detail-审核 | 应付源 Σ发外回收明细.金额 WHERE 明细[审核]='1'(沿用 P6c 算法5 口径);付款按付款单头审核'1'。 |
| 采购入仓 应付取值 | 取 采购入仓单.金额(单头,同算法5),非明细Σ。 |
| 余额浮点 | `> 0.005` 容差;decimal。 |
| 不脱敏/菜单 | 沿用应付对账菜单(打开),金额报表不脱敏,MenuCatalog 不改。 |
