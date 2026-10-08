# 会话工作日志 · 2026-06-12 采购管理 / 仓库管理 表单复刻批次

> 本文件是该会话进度的存档(「保存聊天记录」)。结构化跨会话记忆见
> `C:\Users\DELL\.claude\projects\D--WebpageERP\memory\erp-purchase-warehouse-forms-0612.md`。

## 背景

承接 P0–P8 路线图收官后的「照原系统(bmain.exe)截图逐个复刻表单」系列。用户逐张发原系统截图,每个模块走
brainstorm → 设计 doc → 计划 → subagent-driven 开发(实现 + 规格审查 + 质量审查 + 终审)→ merge --no-ff 到 master → 清分支 → 重启服务。

均零改核心架构,复用既有引擎与配置驱动物料单据组件。**全部已合并 master。最终测试:后端 290/290、前端 38/38。**

## 本批完成并合并的 7 项

| # | 模块 | 归属 | 要点 |
|---|------|------|------|
| 1 | 订单进度表 | 采购管理 | `PurchaseOrderService.ProgressAsync` 只读聚合:按 订单单号+物料编号+颜色,已审核采购订单(订购) LEFT JOIN 已审核采购入仓明细(入仓) 求欠数;点行→打开该采购订单 |
| 2 | 进度明细表 | 采购管理 | 订单进度的逐入仓单展开(每张入仓单一行),点行→采购订单 |
| 3 | 物料资料 | 仓库管理 | 左物料分类树 + 右物料网格(`CategoriesAsync` + `ListAsync`) |
| 4 | 脱敏价回写修复 | 横切 bug | 无「单价」权限用户编辑主数据会把脱敏(null)价格写回库 → 静默丢价。`MasterCrudController.Update` 缺权限时从库 re-hydrate `[PriceField]`;`UpdateAsync` 改 `CurrentValues.SetValues` |
| 5 | 采购入仓订单选择器 | 采购入仓单 | 录入行点款号 → `OrderLinePicker` 弹欠数采购订单行 → 回填 + 持久化 订单单号,闭环让订单进度表入仓数量有值(E2E:订购100/入仓30/欠70) |
| 6 | 采购退仓单(CT) | 采购管理/仓库 | 采购入仓单镜像,**唯一差异库存方向减(−)**;`LedgerUnion` 加第4支 采购退仓×-1(入仓+/退料+/领料−/采购退仓−);`db/13` 加 订单单号;退仓不进进度聚合 |
| 7 | 物料选择器 | 共享四单据 | `MaterialLineTable` 物料列「前500下拉框」换点击弹出可搜索 `MaterialPicker`(编号/名称/规格/材料/颜色/单位 + ☑只查有库存 + 分页50);后端只加 `ListAsync` 的 `onlyStock` 参,无新端点 |

> 领料/退料/采购入仓/采购退仓 四单据共享 `MaterialLineTable`,故第7项一次性覆盖四单。
> **退料单**功能本就与领料单一致(仅库存方向 退料+/领料−),已随本批拿到物料选择器,无需单独开发。

## 踩过的坑

1. `MaterialMasterService.GetAsync` 一度改 `AsNoTracking` 破坏 MasterCrud 往返测试(EF 同键双实例)→ 回退跟踪,改 `UpdateAsync` 用 `db.Entry(existing).CurrentValues.SetValues(entity)`(既保留脱敏价修复又不破坏跟踪)。
2. `OrderLinePicker`/`MaterialPicker` 静默 `catch {}` 被审查打回 → 改 `message.error`;`OrderLinePicker` effect 依赖应为 `[open, 供应商]` 不是 `[open, load]`(否则每次输入重载)。
3. 计划 `Body()` 匿名数组混 int/double 字面量 C# 无法统一 → 单价写 `10.0`/`0.5`。

## 会话收尾

- 分支清理:`feat-material-picker`(合并 7272e17)已删除,现仅剩 `master`,工作树干净。
- 进度存盘:新建 `memory/erp-purchase-warehouse-forms-0612.md` + `MEMORY.md` 索引补一行。
- 服务重启:后端 ErpApi → http://localhost:5000 ✅;前端 Vite → http://localhost:5173 ✅(HTTP 200)。admin/admin123。

## 仍延后(本批未触)

工票打印 · 装箱 · 多币种 · 逐单核销账龄。
