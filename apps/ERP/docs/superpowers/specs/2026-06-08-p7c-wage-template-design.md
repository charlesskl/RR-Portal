# P7c 工资模板/公式配置 设计

> 兴信B ERP 净室重建 · P7 算薪(M10)第三切片 · 2026-06-08

**目标**：建**工资模板配置 CRUD**——一个模板 = {模板编号/名称} + 工资项列表 {序号/台头项目/类型/公式}，整组替换保存（写 `工资模板项目`[类型] + `工资模板公式`[公式串] 两表）。只存配置，**不解析/求值公式**（P7d 工资表生成才用公式引擎）。

**已确认决策（与用户）**：
- 公式**模板级**（不分部门，`工资模板公式.部门编号` 留空=通用；分部门公式延后）。
- P7c **只存公式字符串，不校验语法/引用**（求值与校验留 P7d）。
- 模板编号**手填**（模板少，用户命名）。

---

## 1. 数据模型 — 零改表

- `工资模板项目`：模板编号 nvarchar(10)/模板名称/序号 real/台头项目 nvarchar(30)/类型 nvarchar(12)。工资项定义（项目名+类型+排序）。
- `工资模板公式`：模板编号/模板名称/部门编号(FK 部门信息,可空)/部门名称/序号 real/台头项目 nvarchar(50)/公式 nvarchar(500)。公式串（本期 部门编号=null 通用）。
- 两表按 **模板编号 + 台头项目** 串联（台头项目在模板内唯一）。序号 real → 读 `CAST(序号 AS int)`、写 int（隐式转 real）。
- **无新建/ALTER 脚本**。

## 2. 工资模板服务（`src/ErpApi/Features/Payroll/WageTemplateService.cs`）

聚合 CRUD（整组替换，仿 P2 款式聚合 / 物料单据 两层事务）：
- `ListAsync(keyword?)`：模板列表 = `SELECT 模板编号, MAX(模板名称) 模板名称, COUNT(*) 项目数 FROM 工资模板项目 [WHERE 模板编号/模板名称 LIKE] GROUP BY 模板编号`（按模板编号）。
- `GetAsync(模板编号)`：`工资模板项目 i LEFT JOIN 工资模板公式 f ON f.模板编号=i.模板编号 AND f.台头项目=i.台头项目 AND f.部门编号 IS NULL WHERE i.模板编号=@ ORDER BY i.序号` → 模板编号/模板名称 + 明细[{序号,台头项目,类型,公式}]。
- `SaveAsync(dto, user)`（整组替换，事务）：校验 模板编号/明细非空、台头项目模板内不重复；`DELETE 工资模板项目 WHERE 模板编号=@`、`DELETE 工资模板公式 WHERE 模板编号=@`；逐项 `INSERT 工资模板项目(模板编号,模板名称,序号,台头项目,类型)` + `INSERT 工资模板公式(模板编号,模板名称,部门编号=NULL,序号,台头项目,公式)`。序号按明细顺序 1..n（或用 dto.序号）。
- `DeleteAsync(模板编号)`：删两表该模板行。

DTO：`WageTemplateItemDto {序号 int, 台头项目, 类型?, 公式?}`、`WageTemplateSaveDto {模板编号, 模板名称?, 明细: List<Item>}`、`WageTemplateHeaderDto {模板编号, 模板名称?, 项目数 int}`、`WageTemplateDetailDto {模板编号, 模板名称?, 明细: List<ItemRow>}`。

## 3. 控制器（`WageTemplateController`）

- `api/payroll/wage-templates`：`GET`(list, keyword) / `GET {模板编号}`(detail) / `POST`(save=create-or-replace) / `DELETE {模板编号}`。
- Menu `工资模板`；9 位权限 打开/保存/删除；审计 保存/删除。
- **无金额脱敏**（公式/类型是配置串，非金额数据）。
- DI 注册 `WageTemplateService`。
- 权限种子 `db/seed_p7c_perms.sql`：admin 工资模板(打开/保存/删除/打印/功能)。

## 4. 前端

- `web/src/api/payroll.ts` 追加：`wageTemplateApi`(list/get/save/remove) + 类型 `WageTemplateItem/WageTemplateDetail/WageTemplateHeader`。
- 页面 `web/src/pages/payroll/WageTemplatePage.tsx`：模板列表(Card+Table，模板编号/名称/项目数) + 新建/编辑抽屉（模板编号 Input[新建可填,编辑只读]/模板名称 + 可编辑明细表：序号/台头项目/类型 Select[应发/应扣/合计]/公式 Input；增删行；整组保存）+ 删除。仿物料单据 CreateDrawer 的明细可编辑表模式。
- 菜单：「工资管理」组追加 工资模板；`App.tsx` 路由 `/payroll/wage-templates`；Header 标题链补。

## 5. 测试

- 后端 `WageTemplateServiceDbTests`：SaveAsync(模板 P7CT1,明细[基本工资/应发,计件工资/应发,社保费/应扣,实发合计/合计 各带公式]) → GetAsync 返回 4 项且公式/类型匹配、序号有序；再 SaveAsync(同模板,3项) → 整组替换为3项（旧4项清掉）；DeleteAsync → Get 为空。
- 后端 `P7cWageTemplateApiIntegrationTests`：无保存权限 save→403；保存→get→删除 生命周期；公式串原样存取。
- 前端 util/页面测试（如明细行校验 `validItems`）。

## 6. 范围外（后续）

公式解析/求值引擎（P7d）、分部门公式、公式语法校验、工资表生成（P7d 用本模板算 工资总表/明细表）。

## 7. 风险与对策

| 风险 | 对策 |
|---|---|
| 两表按台头项目串联 | 台头项目模板内唯一（保存时校验不重复）；Get 用 模板编号+台头项目+部门编号 IS NULL JOIN。 |
| 序号 real | 读 `CAST(序号 AS int)`，写 int 隐式转 real。 |
| 公式不校验 | 本期只存串；P7d 求值时解析+校验+报错。文档/前端标注「公式在工资表生成时求值」。 |
| 部门编号 FK | 本期 部门编号=NULL（通用），不触发 FK；分部门延后。 |
| 整组替换并发 | SaveAsync 事务内 删+插；模板配置低频，无需重锁。 |
