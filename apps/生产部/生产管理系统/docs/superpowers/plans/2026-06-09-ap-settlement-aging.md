# 应付 AP 逐单核销 + 账龄 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** 应付逐单核销+账龄(派生只读,零改表),两轨:供应商(采购入仓单←采购付款)+加工厂(发外单号←发外回收/发外付款);并增强采购付款/发外付款录入带出待付单。对称 AR。

**Architecture:** PayablesService 加 6 方法(Supplier/Factory × Settlement/Aging/Unpaid),per-doc 派生(采购入仓单头金额−采购付款Σ按入仓单号;发外回收明细Σ金额按发外单号[明细审核]−发外付款Σ按发外单号)+PayablesController 6 端点+前端。`src/ErpApi/Features/Payables/`。依据 `docs/superpowers/specs/2026-06-09-ap-settlement-aging-design.md`。样板:刚合并的 AR `ReceivablesService`(SettlementAsync/AgingAsync/UnsettledShipmentsAsync 结构) + 现有 PayablesService(算法5)。

---

## Task 1: 后端 — 6 方法 + DTO + DbTest

**Files:** Modify `src/ErpApi/Features/Payables/PayablesService.cs`、`PayablesDtos.cs`；Test `tests/ErpApi.Tests/PayablesSettlementDbTests.cs`.

- [ ] **Step 1: DTOs** 追加 PayablesDtos.cs（见设计 §2 DTO 六个）：PayableSupplierSettlementRow/PayableFactorySettlementRow/PayableSupplierAgingRow/PayableFactoryAgingRow/UnpaidPurchaseRow/UnpaidOutsourceRow（账龄列名 账龄0_30/账龄31_60/账龄61_90/账龄90以上/合计）。
- [ ] **Step 2: PayablesService 加两 per-doc 常量 + 6 方法**（结构对照 AR ReceivablesService 的 SettlementAsync/AgingAsync/UnsettledShipmentsAsync）：
  - `PerPurchase` 常量 = 设计 §2 供应商轨 SQL（采购入仓单 LEFT JOIN 采购付款明细Σ付款金额 by 入仓单号[付款单审核'1'],WHERE 入仓单审核'1'）。
  - `PerOutsource` 常量 = 设计 §2 加工厂轨 SQL（发外回收明细Σ金额 by 发外单号[明细审核'1'] LEFT JOIN 发外付款Σ付款金额 by 发外单号[付款单审核'1']）。
  - `SupplierSettlementAsync(供应商编号?, 仅未结清)`：`SELECT * FROM ({PerPurchase} AND (@编 IS NULL OR s.[供应商编号]=@编)) t` + 仅未结清时 `WHERE t.未付余额>0.005` + `ORDER BY t.供应商编号,t.入仓日期,t.入仓单号`。
  - `SupplierAgingAsync(供应商编号?, 基准日?)`：套 PerPurchase(仅余额>0) 外 `DATEDIFF(day,t.入仓日期,@基准)` 分桶 GROUP BY 供应商编号(MAX 名称)，基准缺省今天。
  - `SupplierUnpaidAsync(供应商编号)`：`SELECT 入仓单号,入仓日期,应付金额,已付金额,未付余额 FROM ({PerPurchase} AND s.[供应商编号]=@编) t WHERE t.未付余额>0.005 ORDER BY t.入仓日期,t.入仓单号`。
  - `FactorySettlementAsync(加工厂编号?, 仅未结清)` / `FactoryAgingAsync(加工厂编号?, 基准日?)` / `FactoryUnpaidAsync(加工厂编号)`：同上套 `PerOutsource`，过滤/分桶用 f.发外单号/f.加工厂编号/回收日期(注意 PerOutsource 外层别名 t.加工厂编号/t.回收日期/t.未付余额)。
  - 参数命名：供应商用 `@编`(string?)、加工厂用 `@编`、基准 `@基准`(DateTime)；`仅未结清` 拼 WHERE。
  - 保留现有 SupplierAsync/FactoryAsync(算法5)。
- [ ] **Step 3: DbTest** `PayablesSettlementDbTests.cs`(`[Collection("db")]`+Factory())：
  - **供应商**：seed 供应商资料(AP_S1)+采购入仓单(单号 AP_CG1,供应商 AP_S1,金额 1000,日期 new DateTime(2026,4,1),审核'1')[守FK]+采购付款单(AP_CF1,审核'1')+采购付款明细单(单号 AP_CF1,入仓单号 AP_CG1,供应商 AP_S1,付款金额 400)。`new PayablesService(Factory())`:SupplierSettlementAsync("AP_S1",false) AP_CG1 应付1000/已付400/未付600;SupplierAgingAsync("AP_S1",d0.AddDays(45)) 账龄31_60=600;SupplierUnpaidAsync("AP_S1") 含 AP_CG1 余额600。
  - **加工厂**：seed 加工厂资料(AP_F1)+发外回收明细单(发外单号 AP_FW1,加工厂 AP_F1,金额 800,日期 d0,审核'1')[守FK:发外回收明细单的FK,参照现有发外DbTest]+发外加工付款单(AP_FF1,审核'1')+发外加工付款明细单(单号 AP_FF1,发外单号 AP_FW1,加工厂 AP_F1,付款金额 300)。FactorySettlementAsync("AP_F1",false) AP_FW1 应付800/已付300/未付500;FactoryAgingAsync("AP_F1",d0.AddDays(10)) 账龄0_30=500;FactoryUnpaidAsync("AP_F1") 含 AP_FW1 余额500。
  - 清理删 各单头/明细(AP_*) + 供应商/加工厂资料。参照现有 Payables/采购/发外 DbTest 的 FK 顺序与清理。
- [ ] **Step 4: 测试(绿)+Commit**
```bash
git add src/ErpApi/Features/Payables/PayablesService.cs src/ErpApi/Features/Payables/PayablesDtos.cs tests/ErpApi.Tests/PayablesSettlementDbTests.cs
git commit -m "feat(P6): 应付逐单核销+账龄服务(供应商采购入仓/加工厂发外单两轨·派生)+DbTest

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: 控制器 6 端点 + API 测试

**Files:** Modify `src/ErpApi/Features/Payables/PayablesController.cs`；Test `tests/ErpApi.Tests/P6ApSettlementApiTests.cs`.

- [ ] **Step 1: 端点**（Menu 应付对账,打开;沿用 CurrentUser/perms；用 `[FromQuery(Name="...")]` 绑中文参数,同现有）：
  - `GET supplier-settlement` (供应商编号?,仅未结清=false) / `GET supplier-aging` (供应商编号?,基准日?) / `GET supplier-unpaid` (供应商编号,缺→400)
  - `GET factory-settlement` (加工厂编号?,仅未结清=false) / `GET factory-aging` (加工厂编号?,基准日?) / `GET factory-unpaid` (加工厂编号,缺→400)
  - 每个先 `if(!await perms.HasAsync(CurrentUser,Menu,PermissionAction.打开)) return Forbid();`
- [ ] **Step 2: API 测试** `P6ApSettlementApiTests.cs`：无 应付对账 打开→6端点403;有→supplier/factory settlement+aging 200;supplier-unpaid/factory-unpaid 缺编号→400。内联种权限(同现有 P6 API 测试)。
- [ ] **Step 3: 测试(绿)+Commit**
```bash
git add src/ErpApi/Features/Payables/PayablesController.cs tests/ErpApi.Tests/P6ApSettlementApiTests.cs
git commit -m "feat(P6): 应付逐单核销/账龄REST(供应商/加工厂各settlement/aging/unpaid·应付对账门控)+API测试

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: 前端 — 应付对账加逐单/账龄 + 采购/发外付款带出待付

**Files:** Modify 应付对账 api/页面、采购付款 & 发外付款 创建抽屉。先 grep:`grep -rl "应付对账\|payables\|采购付款\|发外.*付款\|purchasePayment\|outsourcePayment" web/src`.

- [ ] **Step 1: api** payables api 加 6 方法(supplierSettlement/supplierAging/supplierUnpaid/factorySettlement/factoryAging/factoryUnpaid) + 行类型。
- [ ] **Step 2: 应付对账页 Tabs** 现有应付对账页(供应商汇总/加工厂汇总)扩为 Tabs：供应商(汇总现有 + 逐单核销 settlement + 账龄 aging) / 加工厂(汇总 + 逐单 + 账龄)。逐单列(入仓/发外单号、日期、编号名称、应付/已付/未付),账龄列(编号名称+4桶+合计),可筛编号+(账龄)基准日+(逐单)仅未结清。
- [ ] **Step 3: 采购付款带出** 采购付款创建抽屉:供应商编号填后「带出待付入仓单」→ supplierUnpaid → Modal 勾选+本次付款(默认余额)→ 明细行(入仓单号/货款金额=应付/付款金额=本次/尚欠金额=余额−本次/供应商)。
- [ ] **Step 4: 发外付款带出** 发外付款创建抽屉:加工厂编号填后「带出待付发外单」→ factoryUnpaid → 明细行(发外单号/货款金额/付款金额/尚欠金额/加工厂)。
- [ ] **Step 5: 构建+测试+Commit**
```bash
npm --prefix web run build; npm --prefix web run test -- --run
git add web/src && git commit -m "feat(P6): 应付对账加逐单核销/账龄Tab(供应商+加工厂)+采购/发外付款带出待付单

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: 验证 + 收尾

- [ ] **Step 1: 全量回归** — 后端 `dotnet test tests/ErpApi.Tests`(全过);前端 test+build(全过)。
- [ ] **Step 2: 终审** — diff:两轨派生(采购入仓头金额/发外按发外单号明细审核)、账龄DATEDIFF、余额容差、零改表、复用应付对账菜单。
- [ ] **Step 3: 收尾** — finishing-a-development-branch:合并 master 本地→删分支→重启 5000/5173→更新记忆(P6 应付AP逐单核销+账龄已建,AR/AP 财务对账闭环;手工核销冲账/退仓冲应付/多币种 延后)。

---

## Self-Review

- **Spec 覆盖**:6方法两轨+DTO(T1)、6端点+API(T2)、前端Tabs+两付款带出(T3)、回归收尾(T4)。✓
- **占位符**:DTO/方法结构(引用设计§2 SQL)+DbTest精确数值(供应商600/加工厂500)+端点/前端步骤明确。对照已合并 AR 同构实现。✓
- **类型/命名一致**:api/payables/{supplier,factory}-{settlement,aging,unpaid};Menu 应付对账;DTO Payable{Supplier,Factory}{Settlement,Aging}Row/Unpaid{Purchase,Outsource}Row;账龄桶 0_30/31_60/61_90/90以上。✓
- **关键坑**:供应商应付取采购入仓单**头金额**;加工厂按**发外单号**关联(发外付款明细/发外回收明细共有键,非回收单号)且应付源用**发外回收明细 detail-审核**;付款Σ按付款单头审核'1';余额>0.005;账龄DATEDIFF(day,日期,基准);中文列名→DTO属性匹配(AS别名一致);复用应付对账菜单不改MenuCatalog;DbTest守发外/采购明细FK;提交带trailer;ErpApi占用先Stop-Process。✓
