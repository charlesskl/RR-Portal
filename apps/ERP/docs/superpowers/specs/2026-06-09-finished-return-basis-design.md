# 成品退货/退仓 带出原单基准 设计

> 兴信B ERP 净室重建 · P5 成品仓储体验补齐 · 2026-06-09

**目标**：成品退货(TH)/退仓(TC) 创建时，可按 出仓单号/入仓单号 **带出原单明细作基准**（BasisAsync），与半成品盘点/发外回收/销售退货的"带出基准"体验一致。当前这两单是自由录入、不带原单。

**决策**：带出仅**预填可改**（自由录入保留）；**不做超退累计校验**（同 P6a 销售退货首版）；单价按权限脱敏（同现有 Get/Detail）。

---

## 1. 数据模型 — 零改表

- `成品退货明细单` 已有 `出仓单号` 列；`成品退仓明细单` 已有 `入仓单号` 列（存原单引用）。
- 原单来源：`成品出仓明细单`(列含 单号/客户编号/客户名称/仓库/生产单号/款号/款式/床号/色号/颜色/尺码/数量/单价)、`成品入仓明细单`(列含 单号/供应商编号/供应商名称/仓库/生产单号/款号/款式/床号/色号/颜色/尺码/数量/单价)。
- **无新建/ALTER**。

## 2. 服务（`src/ErpApi/Features/Warehouse/Finished/`）

样板：`Sales/SalesReturnService.BasisAsync(销售单号)`。
- `FinishedSalesReturnService.BasisAsync(出仓单号)`：
  `SELECT [客户编号],[客户名称],[仓库],[生产单号],[款号],[款式],[床号],[色号],[颜色],[尺码],[数量],[单价] FROM [成品出仓明细单] WHERE [单号]=@出仓单号 ORDER BY [ID]` → `List<FinishedSalesReturnBasisRow>`。
- `FinishedVendorReturnService.BasisAsync(入仓单号)`：
  `SELECT [供应商编号],[供应商名称],[仓库],[生产单号],[款号],[款式],[床号],[色号],[颜色],[尺码],[数量],[单价] FROM [成品入仓明细单] WHERE [单号]=@入仓单号 ORDER BY [ID]` → `List<FinishedVendorReturnBasisRow>`。

DTO（`FinishedDtos.cs`）：
- `FinishedSalesReturnBasisRow {客户编号?,客户名称?,仓库?,生产单号?,款号?,款式?,床号?,色号?,颜色?,尺码?,数量?,单价?}`
- `FinishedVendorReturnBasisRow {供应商编号?,供应商名称?,仓库?,生产单号?,款号?,款式?,床号?,色号?,颜色?,尺码?,数量?,单价?}`

## 3. 控制器

各加 `GET basis`（`打开` 权限；无 `单价` 权限则每行 `单价=null`，同现有 Get 脱敏）：
- `FinishedSalesReturnController`：`GET basis?出仓单号=` → svc.BasisAsync。
- `FinishedVendorReturnController`：`GET basis?入仓单号=` → svc.BasisAsync。
（路由风格沿用控制器现有；如 `[HttpGet("basis")]`。）

## 4. 前端

`web/src/pages/finished/`（成品退货/退仓页）创建抽屉：
- 加 出仓单号/入仓单号 Input + **「带出原单」按钮** → 调 basis → 预填单头(客户/供应商、仓库、生产单号、款号、款式、床号) + 明细行(色号/颜色/尺码/数量/单价)；可继续编辑。
- api 加 `basis(出仓单号)` / `basis(入仓单号)`。

## 5. 测试

- 后端 DbTest：seed 成品出仓单+明细(单号 RB_C1,2行) → `FinishedSalesReturnService.BasisAsync("RB_C1")` 返回2行且 款号/数量/单价 正确；成品入仓同理(FinishedVendorReturnService)。清理。
- 后端 API 测试：basis 端点 200 带行；无 单价 权限 → 行 单价=null；无 打开 → 403。
- 前端：构建通过(带出按钮接线);现有测试不减。

## 6. 范围外（延后）

超退累计校验（已退数量扣减）、按客户/供应商过滤可选出仓单列表、退货原因码。

## 7. 风险与对策

| 风险 | 对策 |
|---|---|
| 带出覆盖用户已填 | 前端"带出"为显式按钮,提示将覆盖明细;自由录入仍可改。 |
| 单价泄露 | basis 端点无 单价 权限则置 null(同现有 Get/Detail 脱敏)。 |
| 原单号不存在 | BasisAsync 返回空列表(前端提示无数据)。 |
| 超退 | 本期不校验(同 P6a),仅预填;文档标注延后。 |
