# 明细表交互升级：缩窄列宽 + 行内新增 + Excel式键盘导航

**日期:** 2026-03-17
**状态:** 已确认
**影响文件:** `public/js/app.js`, `public/css/theme.css`
**后端改动:** 无

---

## 1. 背景

三个部门的明细表列数很多（啤机部 36 列、印喷部 48 列、装配部 36 列），导致：
- 表格宽度 3800-5000px，远超屏幕宽度 1920px，需要大量横向滚动
- 新增记录弹窗包含 25-35 个输入框，溢出屏幕无法操作
- 编辑单元格后只能用鼠标双击下一个，效率低

## 2. 设计方案

### 2.1 缩窄列宽

减小各类字段的列宽，配合 shortLabel 短表头：

| 字段类型 | 修改前 | 修改后 |
|----------|--------|--------|
| 数字列（金额等） | 110px | 80px |
| 比率列（百分比） | 80px | 65px |
| 整数列（人数、台数） | 85px | 65px |
| 备注列 | 120px | 120px（不变） |

效果估算：
- 啤机部：~3880px → ~2500px（减少 36%）
- 印喷部：~5080px → ~3200px（减少 37%）
- 装配部：~3880px → ~2500px（减少 36%）

修改位置：`app.js` 中 `getColumnWidth()` 方法。

### 2.2 行内新增（替换原弹窗表单）

**原流程：** 点"新增" → 弹出 600px 宽弹窗，包含所有可编辑字段的表单 → 填完点"保存"

**新流程：**

1. 点击"+ 新增"按钮
2. 弹出**迷你弹窗**（宽 320px），只有两个字段：
   - 日期（el-date-picker，默认今天）
   - 车间（el-select，从 workshopList 加载）
3. 点"确认创建" → 立即 POST `/:dept/records` 创建空记录
4. 关闭弹窗，刷新数据后新行出现在表格顶部（按日期倒序排列）
5. 自动进入新行第一个可编辑单元格的编辑模式
6. 用户通过键盘导航逐个填写数据

**设计要点：**
- 先 POST 保存再编辑，不存在"忘记保存数据丢失"的风险
- 新行高亮显示（淡紫色 `#F0E6F6` 背景），便于识别
- 删除原有的大弹窗（`addDialogVisible` + `addForm` + 所有 editableColumns 表单项）
- POST body 只发 `{ record_date, workshop_id }`，后端 `calculateRecord` 会把缺失的数值字段默认为 0
- "第一个可编辑单元格"定义为 `columns` 数组中第一个 `editable: true` 的列（各部门不同：啤机部是 `total_machines`，印喷部是 `pad_total_machines`，装配部是 `planned_wage_tax`）

### 2.3 Excel 式键盘导航

改造现有的双击编辑功能，增加方向键导航：

| 操作 | 行为 |
|------|------|
| **双击单元格** | 进入编辑模式，光标定位到该单元格的 input |
| **← →** | 保存当前值，跳到左/右相邻的可编辑单元格（自动跳过计算列） |
| **↑ ↓** | 保存当前值，跳到上/下同列单元格 |
| **Tab / Shift+Tab** | 同 → / ←，行尾时自动跳到下一行第一个可编辑列 |
| **Enter** | 同 ↓，保存并跳到下方同列 |
| **Esc** | 取消编辑（不保存当前修改），退出编辑模式 |
| **鼠标点击其他地方** | 保存当前值，退出编辑模式（需重新双击进入） |

**实现要点：**

#### 键盘事件：替换现有 @keyup 为 @keydown

现有 input 上有 `@keyup.enter`（触发 blur）和 `@keyup.escape`（取消编辑）。
**必须全部替换**为单个 `@keydown="handleEditKeydown($event, row, col)"`，否则新旧事件会冲突导致双重触发。

#### 方向键与文本光标的兼容

← → 方向键同时用于文本光标移动和单元格导航，需要区分：
- **← 跳转条件：** 光标在 input 最左边（`selectionStart === 0`）时才跳转到左边单元格，否则正常移动文本光标
- **→ 跳转条件：** 光标在 input 最右边（`selectionStart === value.length`）时才跳转，否则正常移动文本光标
- **↑ ↓ Enter Tab Esc：** 始终触发导航/退出，不需要判断光标位置

```javascript
handleEditKeydown(event, row, col) {
  const input = event.target;
  const atStart = input.selectionStart === 0;
  const atEnd = input.selectionStart === input.value.length;

  switch(event.key) {
    case 'ArrowLeft':
      if (!atStart) return; // 光标不在最左边，让浏览器处理
      event.preventDefault(); this.navigateEdit('left'); break;
    case 'ArrowRight':
      if (!atEnd) return;
      event.preventDefault(); this.navigateEdit('right'); break;
    case 'ArrowUp':    event.preventDefault(); this.navigateEdit('up'); break;
    case 'ArrowDown':  event.preventDefault(); this.navigateEdit('down'); break;
    case 'Tab':        event.preventDefault(); this.navigateEdit(event.shiftKey ? 'left' : 'right'); break;
    case 'Enter':      event.preventDefault(); this.navigateEdit('down'); break;
    case 'Escape':     this.cancelEdit(); break;
  }
}
```

#### navigateEdit 导航核心逻辑

```javascript
async navigateEdit(direction) {
  // 1. 捕获当前位置（必须在 saveCell 清除 editingCell 之前）
  const currentRowId = this.editingCell.rowId;
  const currentField = this.editingCell.field;

  // 2. 触发保存：对当前 input 调用 blur()，触发已有的 @blur="saveCell(...)"
  const input = this.$el.querySelector('.data-table-wrapper input:focus');
  if (input) input.blur();
  // blur 会触发 saveCell → 发 PUT（如果值变了）→ 调 loadData()

  // 3. 计算下一个位置
  const rowIndex = this.tableData.findIndex(r => r.id === currentRowId);
  const colIndex = this.columns.findIndex(c => c.field === currentField);
  const next = this.findNextEditable(rowIndex, colIndex, direction);
  if (!next) return; // 到达边界，不跳转

  // 4. 等 loadData 完成后设置新位置
  await this.$nextTick();
  const nextRow = this.tableData[next.rowIndex];
  if (nextRow) {
    this.editingCell = { rowId: nextRow.id, field: this.columns[next.colIndex].field };
    // 5. 等 Vue 渲染新 input 后聚焦
    await this.$nextTick();
    const newInput = this.$el.querySelector('.data-table-wrapper input');
    if (newInput) newInput.focus();
  }
}
```

**关键点：**
- 步骤 1 必须在 blur/saveCell 之前捕获当前位置，因为 `saveCell` 第一行就清除 `editingCell`
- 步骤 4-5 用 `$nextTick` 等待 Vue DOM 更新，确保新 input 已渲染再聚焦

#### saveCell 与 loadData 的性能优化

现有 `saveCell` 每次保存后调 `loadData()` 刷新全表。快速连按 Tab 时会触发多次 loadData。

优化方案：navigateEdit 中触发 blur 保存后，**不等 loadData 完成就设置新位置**。saveCell 中的 `loadData` 仍会执行，但导航不阻塞等待它。如果 loadData 返回后 tableData 变化导致行 ID 失效，editingCell 自动失效（isEditing 返回 false），用户看到编辑框消失，可重新双击。

#### Esc 取消编辑的保障

现有 input 用 `:value="row[col.field]"` 单向绑定（非 `v-model`），编辑中的修改只在 input.value 中，不会写回 `row[col.field]`。Esc 调用 `cancelEdit()` 只清除 editingCell，input 消失后显示的是原始的 `row[col.field]` 值——修改被自动丢弃。实现时必须保持 `:value` 单向绑定，不能改为 `v-model`。

#### 跳过计算列的逻辑

```javascript
findNextEditable(rowIndex, colIndex, direction) {
  const rows = this.tableData;
  const cols = this.columns;
  let r = rowIndex, c = colIndex;

  if (direction === 'right' || direction === 'left') {
    const step = direction === 'right' ? 1 : -1;
    c += step;
    while (c >= 0 && c < cols.length) {
      if (cols[c].editable) return { rowIndex: r, colIndex: c };
      c += step;
    }
    // Tab 换行：到行尾跳下一行首个可编辑列
    if (direction === 'right' && r + 1 < rows.length) {
      r++;
      c = cols.findIndex(col => col.editable);
      if (c !== -1) return { rowIndex: r, colIndex: c };
    }
    return null; // 到达边界
  }

  if (direction === 'up' || direction === 'down') {
    r += direction === 'down' ? 1 : -1;
    if (r >= 0 && r < rows.length) return { rowIndex: r, colIndex: c };
    return null;
  }
}
```

## 3. 不做的事情

- **列分组折叠** — 用户选择了缩窄列宽方案，不做分组
- **Ctrl+S 整行保存** — 每个单元格独立保存，和现有逻辑一致
- **新行自动创建** — Tab 到表格末尾不自动新增行
- **多单元格选择** — 不做 Excel 的拖选功能
- **复制粘贴** — 不做 Ctrl+C/V 多单元格复制

## 4. 测试验证

| 场景 | 预期结果 |
|------|---------|
| 点新增 → 填日期车间 → 确认 | 新行出现在表格顶部，第一个可编辑单元格自动进入编辑 |
| 编辑中按 → | 保存当前值，跳到右边下一个可编辑单元格 |
| 编辑中按 → 遇到计算列 | 自动跳过计算列，到达下一个可编辑列 |
| 编辑中按 Tab 到行尾 | 跳到下一行第一个可编辑列 |
| 编辑中按 Shift+Tab | 跳到左边上一个可编辑列 |
| 编辑中按 ↓ | 保存当前值，跳到下方同列单元格 |
| 编辑中按 Esc | 不保存修改，退出编辑模式 |
| 编辑中点击表格外空白处 | 保存当前值，退出编辑模式 |
| 退出编辑后按方向键 | 无反应（需双击重新进入编辑模式） |
| 保存失败（网络错误） | 值回滚，显示错误提示，焦点不离开 |
| 编辑数字"12345"按 ← | 光标不在最左边时移动文本光标，在最左边时跳到左边单元格 |
| 快速连按 Tab 穿过多个单元格 | 每个单元格的值被保存，不会因 loadData 阻塞 |
