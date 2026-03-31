# Phase 2: 录入体验升级 - Research

**Researched:** 2026-03-19
**Domain:** Vue 3 行内编辑、键盘导航、数据复制 — CDN 单文件架构
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| ENTRY-01 | 用户只填日期+车间即可生成新数据行，其余字段在行内编辑 | 现有 `showAddDialog` + `handleAdd` 已实现迷你弹窗创建行；Phase 2 不需要重建，只需去除冗余弹窗步骤（见架构方案） |
| ENTRY-02 | 行内编辑时按 Tab 键自动跳到下一个可编辑字段（跳过计算列） | 当前 `<input>` 仅有 `@keyup.enter` 和 `@keyup.escape`，无 Tab 处理；需在 `@keydown.tab.prevent` 中计算下一个 editable 字段并调用 `startEdit` |
| ENTRY-03 | 用户可一键复制已有行的可编辑字段数据为新行，原行数据不受影响 | 需新增"复制行"按钮；后端 POST 接收已有行的可编辑字段值（date+workshop_id 来自源行，其余数值复制），后端已支持此调用方式 |
</phase_requirements>

---

## Summary

Phase 2 的三个需求（ENTRY-01/02/03）全部属于**纯前端键盘交互**改造。后端 API (`POST /:dept/records`) 已完整支持创建带字段值的记录，无需修改。核心工作集中在 `public/js/app.js` 的 `BalanceDetail` 组件（约第 270-758 行）。

**ENTRY-01** 现状：迷你弹窗已存在且工作正常——用户填日期+车间，POST 成功后自动进入第一个可编辑单元格。Phase 1 如果没有破坏此功能，ENTRY-01 实际上已完成，Phase 2 只需验证并确保流程顺滑（弹窗关闭后光标自动聚焦）。

**ENTRY-02** 现状：行内 `<input>` 只监听 `@keyup.enter`（失焦保存）和 `@keyup.escape`（取消），Tab 键没有被捕获，浏览器默认行为会让焦点跳出表格。需用 `@keydown.tab.prevent` 阻止默认行为，然后计算当前行所有 `editable: true` 且 `calculated: false` 的字段列表，找到当前字段的下一个，调用 `startEdit`。

**ENTRY-03** 现状：无复制功能。需在每行操作列（或行末）增加"复制"按钮，点击时读取该行所有可编辑字段值，组装 POST body（日期和车间 ID 来自源行），创建新行后新行高亮。

**Primary recommendation:** 三个需求全部在 `BalanceDetail` 组件内实现，不触及后端、不触及 `api.js`（`API.post` 调用签名已满足 ENTRY-03 需求），修改范围高度可控。

---

## Standard Stack

### Core（已有，不引入新依赖）

| 组件/API | 版本/来源 | 用途 | 说明 |
|---------|---------|------|------|
| Vue 3 CDN | 3.x | 响应式数据、模板指令 | 已在项目中使用 |
| Element Plus CDN | 2.x | `el-table`、`el-button`、`el-dialog` | 行内编辑 UI 已基于此 |
| 原生 `<input>` | 浏览器内置 | 行内编辑单元格 | 已有实现，Tab 处理在此添加 |
| `$nextTick` | Vue 3 内置 | 渲染后聚焦 | 已在 `startEdit` 中使用 |

### 无需新增依赖

Tab 导航、行复制均可用 Vue 3 原生事件处理 + 现有 `getDeptColumns()` 字段列表实现，不需要引入任何新 npm 包或 CDN 库。

---

## Architecture Patterns

### 现有行内编辑机制（重要：必须基于此扩展）

```
editingCell: { rowId: null, field: null }
    ↓
startEdit(row, col)  →  editingCell = { rowId, field }  →  $nextTick focus input
    ↓
saveCell(row, field, event)  →  API.put  →  editingCell = { null, null }
cancelEdit()  →  editingCell = { null, null }
```

`isEditing(rowId, field)` 控制单元格显示 `<input>` 还是显示值。这是核心状态机，Tab 导航必须复用此机制。

### 字段过滤逻辑（ENTRY-02 的关键依据）

`getDeptColumns(dept)` 返回完整字段列表，字段对象结构：

```javascript
{
  field: 'worker_count',   // 字段名
  label: '员工人数',
  editable: true,          // true = 可编辑，false = 计算/只读
  calculated: true/false,  // true = 计算字段，Tab 跳过
  type: 'integer'|'number'|'ratio'|'text'
}
```

Tab 导航跳过条件：`col.editable === false`（计算列已标记 `editable: false`）。

### Pattern 1: Tab 键跳转下一字段（ENTRY-02）

**What:** 在行内 `<input>` 的 `@keydown.tab.prevent` 事件中，找到当前字段在 `columns` 数组中的索引，取下一个 `editable: true` 的字段，调用 `saveCell` 后再调用 `startEdit`。

**When to use:** 用户在任意可编辑单元格内按下 Tab 键时触发。

**实现思路:**

```javascript
// 在 app.js 的 BalanceDetail 组件 methods 中新增
handleTabKey(row, currentField, event) {
  // 1. 阻止浏览器默认 Tab 行为（已通过 @keydown.tab.prevent 处理）
  // 2. 先保存当前单元格（触发 blur 相同逻辑）
  const value = event.target.value;
  this.saveCell(row, currentField, event);  // 注意：saveCell 已处理相同值不请求
  // 3. 找下一个可编辑字段
  const editableCols = this.columns.filter(c => c.editable);
  const idx = editableCols.findIndex(c => c.field === currentField);
  const next = editableCols[idx + 1];
  if (next) {
    this.$nextTick(() => this.startEdit(row, next));
  } else {
    // 已是最后一列，取消编辑
    this.cancelEdit();
  }
}
```

**模板绑定变更（单处修改）:**

```html
<!-- 现有代码（第 338-342 行区域） -->
<input :value="row[col.field]"
       @blur="saveCell(row, col.field, $event)"
       @keyup.enter="$event.target.blur()"
       @keyup.escape="cancelEdit"
       @keydown.tab.prevent="handleTabKey(row, col.field, $event)"
       @input="limitDecimals($event)"
       autofocus />
```

注意：`@keydown.tab.prevent` 必须用 `keydown`（不是 `keyup`），否则浏览器在 `keydown` 阶段就已经移动焦点。

### Pattern 2: 复制行（ENTRY-03）

**What:** 在操作列（或行内添加"复制"图标按钮）点击后，读取源行所有 `editable: true` 字段的值，加上源行的 `record_date` 和 `workshop_id`，POST 创建新行，新行高亮逻辑复用 `newRowId`。

**实现思路:**

```javascript
async handleCopyRow(row) {
  // 1. 收集源行的所有可编辑字段值
  const editableCols = this.columns.filter(c => c.editable);
  const body = {
    record_date: row.record_date,  // 保留日期
    workshop_id: row.workshop_id,  // 保留车间
  };
  for (const col of editableCols) {
    if (col.field !== 'record_date') {  // 避免重复
      body[col.field] = row[col.field] ?? 0;
    }
  }

  this.saving = true;
  try {
    const res = await API.post(`/${this.dept}/records`, body);
    ElementPlus.ElMessage.success('复制成功，已生成新行');
    await this.loadData();
    // 高亮新行，复用 newRowId 机制
    const newId = res.data?.id;
    if (newId) {
      this.newRowId = newId;
      setTimeout(() => { this.newRowId = null; }, 4000);
    }
  } catch (err) {
    ElementPlus.ElMessage.error('复制失败: ' + (err.message || '未知错误'));
  } finally {
    this.saving = false;
  }
}
```

**操作列按钮位置:** 在现有"删除"操作按钮旁边增加"复制"按钮，或在行末增加操作列。

### Pattern 3: 确认 ENTRY-01 工作正常

ENTRY-01 的实现已存在（`showAddDialog` → `handleAdd`），Phase 2 的任务是：
1. 确认 Phase 1 BUG 修复后该流程未破损
2. 确认弹窗关闭后光标正确聚焦到新行第一个可编辑单元格（现有代码第 674-677 行）
3. 如果聚焦失败（`querySelector` 选择器不精准），改用更可靠的 `ref` 方式

### Anti-Patterns to Avoid

- **不要给每列 `<input>` 添加 `tabindex`：** el-table 动态渲染列，tabindex 在虚拟 DOM 复用时会错乱，用 Vue 状态机控制更可靠。
- **不要在 `@keyup.tab` 中处理：** `keyup` 触发时浏览器已移动焦点，`preventDefault()` 无效。必须在 `@keydown.tab.prevent` 中处理。
- **saveCell 是异步的（await API.put）：** handleTabKey 中先触发保存、再切换字段，避免因网络延迟导致状态混乱。可以先切换 `editingCell`，让 `saveCell` 的 API 调用在后台完成（现有 saveCell 实现已在设置 `editingCell = null` 后异步请求，模式一致）。
- **不要修改 `getDeptColumns` 的字段顺序：** Tab 跳转顺序依赖 `columns` 数组顺序，该顺序在 CLAUDE.md 中已有明确分组规则，不应改变。
- **复制行时不要修改原行数据：** `row[col.field]` 只读取，不 `v-model` 绑定，安全。

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| 可编辑字段列表 | 手动列举字段名 | `this.columns.filter(c => c.editable)` | `getDeptColumns()` 已包含所有部门字段，手动列举会遗漏新增字段 |
| 行高亮 | 新增 CSS class 控制 | 复用 `newRowId` + `.new-row-highlight` | 机制已存在，重复实现增加维护负担 |
| 保存单元格 | 在 handleTabKey 中直接写 API.put | 调用已有的 `saveCell(row, field, event)` | saveCell 已处理相同值不请求、错误处理、editingCell 重置 |

---

## Common Pitfalls

### Pitfall 1: Tab 键在 `keyup` 而非 `keydown` 处理

**What goes wrong:** 用 `@keyup.tab` 监听时，`event.preventDefault()` 无法阻止浏览器的默认 Tab 焦点移动，焦点已经跳到下一个原生 focusable 元素。
**Why it happens:** 浏览器在 `keydown` 阶段处理焦点移动，`keyup` 触发时已完成。
**How to avoid:** 使用 `@keydown.tab.prevent`（Vue 的 `.prevent` 修饰符在 `keydown` 阶段调用 `preventDefault()`）。
**Warning signs:** 按 Tab 后焦点跳到浏览器地址栏或其他表单元素，而非下一列。

### Pitfall 2: `querySelector('.editing-cell-wrapper input')` 在多行编辑时选错元素

**What goes wrong:** 若表格中有多行同时满足选择器（理论上不应该，但滚动缓存可能导致），聚焦到错误单元格。
**Why it happens:** `this.$el.querySelector` 选择当前组件 DOM 内第一个匹配的元素，不保证是目标行的单元格。
**How to avoid:** 传递 `rowId` 和 `field` 到 `startEdit`，使用 `data-row-id` + `data-field` 属性定位具体 DOM；或在 `startEdit` 中使用 `$refs` 结合动态 ref（Vue 3 支持 `:ref="(el) => setRef(row.id, col.field, el)"`）。
**Warning signs:** Phase 1 已有此问题的报告（第 675 行 `querySelector('.data-table-wrapper input')` 的 selector 与 `startEdit` 里的 `'.editing-cell-wrapper input'` 不一致）。

### Pitfall 3: saveCell 的异步与 Tab 切换竞争

**What goes wrong:** 用户快速 Tab 连续跳过多列时，前一个 `saveCell` 的 API 请求尚未完成，`editingCell` 已被下一次 `startEdit` 修改，导致 `saveCell` 的回调在错误状态下执行。
**Why it happens:** `saveCell` 是 `async` 函数，内部有 `await API.put`，期间 `editingCell` 可能被 `startEdit` 更新。
**How to avoid:** `saveCell` 在方法开头第一行重置 `editingCell`（现有代码已如此，第 609 行），API 请求完成后不再修改 `editingCell`，因此竞争风险低。只需确认 `handleTabKey` 中的调用顺序：先调用一次函数触发保存逻辑，再调用 `startEdit` 切换到下一格。

### Pitfall 4: 复制行时 `workshop_id` 缺失

**What goes wrong:** 源行数据中存储的是 `workshop_name`（用于显示），而 POST body 需要 `workshop_id`（整数外键）。
**Why it happens:** BUG-02（Phase 1）修复后，`row.workshop_name` 正确显示，但 `row.workshop_id` 需要确认字段名在后端返回数据中存在。
**How to avoid:** 确认 `GET /:dept/records` 返回的每条记录包含 `workshop_id` 字段（检查 `routes/records.js` 的 SELECT 语句）。如果只返回 `workshop_name`，需要从 `workshopList` 中反查 ID。
**Warning signs:** 复制行时 POST 请求的 `workshop_id` 为 `undefined`，后端报 "请选择车间" 错误。

---

## Code Examples

### 当前行内编辑 input 绑定（需扩展）

```javascript
// app.js 第 337-342 行（当前代码）
<div v-if="isEditing(row.id, col.field) && col.editable" class="editing-cell-wrapper">
  <input :value="row[col.field]"
         @blur="saveCell(row, col.field, $event)"
         @keyup.enter="$event.target.blur()"
         @keyup.escape="cancelEdit"
         @input="limitDecimals($event)"
         autofocus />
</div>
```

扩展后新增一行 `@keydown.tab.prevent="handleTabKey(row, col.field, $event)"`，其余不变。

### 获取可编辑字段列表（Tab 跳转的基础）

```javascript
// BalanceDetail 组件 computed 或 methods 中
editableColumns() {
  return this.columns.filter(c => c.editable);
  // 结果：所有 editable:true 的字段，按 getDeptColumns 定义的列顺序排列
  // 自动跳过 editable:false 的计算字段（balance, balance_ratio, machine_rate 等）
}
```

### 后端 POST 接口支持携带字段值（ENTRY-03 无需后端改动的依据）

```javascript
// routes/records.js (现有) — POST /:dept/records
// 接收 req.body 中的所有字段，数值字段缺失时默认为 0
// 因此直接将源行的可编辑字段值塞入 POST body 即可
const res = await API.post(`/${this.dept}/records`, body);
// body = { record_date, workshop_id, worker_count, daily_output, ... }
```

---

## State of the Art

| 旧方式 | 当前方式 | 说明 |
|--------|---------|------|
| 弹窗录入所有字段 | 迷你弹窗（仅日期+车间）+ 行内编辑 | 已实现，Phase 2 在此基础上加 Tab 导航 |
| 无键盘导航 | Tab 跳转可编辑列 | Phase 2 新增 |
| 无复制功能 | 一键复制行 | Phase 2 新增 |

---

## Open Questions

1. **`row.workshop_id` 是否在 GET 结果中返回？**
   - What we know: `routes/records.js` 的 SELECT 需要同时返回 `workshop_id`（外键）和 `workshop_name`（JOIN 后的名称）
   - What's unclear: BUG-02（Phase 1）修复后，SELECT 语句是否包含 `workshop_id` 字段
   - Recommendation: 计划时在 ENTRY-03 的验证步骤中加一条"确认 GET 返回包含 `workshop_id`"

2. **Tab 到最后一列后的行为**
   - What we know: 需求未指定
   - What's unclear: 应该停在最后一列，还是跳到下一行的第一列，还是取消编辑
   - Recommendation: 最简单方案是到最后一列后取消编辑（`cancelEdit()`），后续版本再考虑跨行跳转

3. **复制行的日期是否使用源行日期还是今天**
   - What we know: 需求说"复制已有行的可编辑字段数据"，日期属于可编辑字段
   - Recommendation: 使用源行日期，这样最符合"复制"的语义；用户可在新行中单独修改日期

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Jest（已配置） |
| Config file | `package.json` 中 `"test": "jest --verbose"` |
| Quick run command | `npm test -- --testPathPattern=entry` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ENTRY-01 | POST 请求只含 date+workshop_id 时后端成功创建记录，数值字段默认 0 | unit（后端） | `npm test -- --testPathPattern=entry` | ❌ Wave 0 |
| ENTRY-02 | Tab 导航逻辑：`editableColumns` 过滤正确跳过计算字段 | unit（纯函数） | `npm test -- --testPathPattern=entry` | ❌ Wave 0 |
| ENTRY-03 | 复制行 POST 携带源行所有可编辑字段值，后端正确创建新记录 | unit（后端） | `npm test -- --testPathPattern=entry` | ❌ Wave 0 |

注意：ENTRY-02 的 Tab 键交互本身是前端行为，无法用 Jest 自动化测试（需要浏览器环境）。可测部分是"字段过滤逻辑"（`columns.filter(c => c.editable)` 的结果）。

### Sampling Rate

- **Per task commit:** `npm test -- --testPathPattern=entry` (只跑 entry 测试)
- **Per wave merge:** `npm test` (完整测试套件)
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `tests/entry-experience.test.js` — 覆盖 ENTRY-01（后端 POST 默认值）、ENTRY-02（字段过滤逻辑）、ENTRY-03（复制行 POST）
- [ ] 需确认 `tests/entry-experience.test.js` 中的 mock 策略（ENTRY-01/03 需要 mock 数据库，参考 `tests/calc.test.js` 直接测 calc 模块的方式）

---

## Sources

### Primary (HIGH confidence)

- `public/js/app.js`（第 270-758 行，BalanceDetail 组件）— 直接阅读源码，掌握现有 `editingCell`、`startEdit`、`saveCell`、`handleAdd`、`showAddDialog` 的完整实现
- `public/js/app.js`（第 1-220 行）— `DEPT_CONFIG`、`getDeptColumns`、字段 `editable` 属性的定义方式
- `.planning/REQUIREMENTS.md` — ENTRY-01/02/03 的精确描述
- MDN Web Docs — `keydown` 事件在 `preventDefault()` 中阻止 Tab 的时机（标准行为，HIGH 置信度）

### Secondary (MEDIUM confidence)

- Vue 3 官方文档 — `@keydown.tab.prevent` 修饰符链写法、`$nextTick` 用于 DOM 更新后聚焦
- Element Plus 文档 — `el-table` `row-class-name` prop 用于行高亮（现有代码已使用）

### Tertiary (LOW confidence)

- 无

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — 全部使用现有技术栈，无新依赖
- Architecture: HIGH — 基于直接阅读的源码，状态机逻辑清晰
- Pitfalls: HIGH — Pitfall 1/2/4 基于源码中已存在的问题迹象（querySelector 不一致、workshop_id 缺失风险）

**Research date:** 2026-03-19
**Valid until:** 稳定（项目技术栈固定，30 天内有效）
