# Phase 3: 前端双格式展示 - Context

**Gathered:** 2026-03-28
**Status:** Ready for planning

<domain>
## Phase Boundary

前端界面适配毛绒公仔格式，新增车缝明细和搪胶件 tab，确保两种格式数据正确展示。

</domain>

<decisions>
## Implementation Decisions

### Tab 显示策略
- **D-01:** 全部显示 — 两种格式都显示所有 tab，无数据的 tab 显示"暂无数据"
- **D-02:** 不根据 format_type 动态隐藏 tab

### 车缝明细 tab
- **D-03:** 放在 Body Cost Breakdown 下，作为 F. Sewing Detail（与 Raw Material/Molding Labour 并列）
- **D-04:** 可编辑 — 支持编辑/添加/删除，与其他 tab 一致
- **D-05:** 表格列：布料名称、部位、裁片数、用量、物料价RMB、价钱RMB、码点、总价RMB

### 搪胶件 tab
- **D-06:** 放在 Body Cost Breakdown 下，作为 G. Rotocast Items
- **D-07:** 可编辑，表格列：模号、名称、出数、用量pcs、单价HK$、合计HK$、备注

### Claude's Discretion
- tab 文件命名和内部结构（参考现有 bd-material.js 模式）
- 汇总行显示方式

</decisions>

<canonical_refs>
## Canonical References

### 现有 tab 模式
- `client/js/tabs/bd-material.js` — 参考实现模式（render + init + editable cells）
- `client/js/tabs/bd-purchase.js` — 简单表格 tab 参考
- `client/js/app.js` — tab 注册和切换逻辑

### API
- `server/routes/versions.js` — sewing-detail 和 rotocast 已注册为 section

### 样式
- `client/css/style.css` — 现有 tab 样式
- `client/index.html` — tab 按钮注册

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `makeEditable()` — 可编辑单元格 helper，所有 tab 共用
- `api.addSectionItem()` / `api.updateSectionItem()` / `api.deleteSectionItem()` — CRUD API
- `escapeHtml()`, `formatNumber()` — 格式化 helpers

### Established Patterns
- 每个 tab 是一个 `tab_xxx` 对象，含 `render(versionData)` 和 `init(container, versionData, versionId)` 方法
- render 返回 HTML 字符串，init 绑定事件

### Integration Points
- `client/js/app.js` 的 tab 注册数组需添加新 tab
- `client/index.html` 的 Body Cost Breakdown tab 按钮区域需添加 F 和 G

</code_context>

<specifics>
## Specific Ideas

No specific requirements — follow existing tab patterns.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 03-plush-frontend*
*Context gathered: 2026-03-28*
