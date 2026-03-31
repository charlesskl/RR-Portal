# 明细表交互升级 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 缩窄列宽 + 迷你弹窗行内新增 + Excel式键盘导航，提升明细表录入效率

**Architecture:** 仅修改前端 DeptDetail 组件（`app.js`）和样式（`theme.css`）。后端 API 不变。将现有大弹窗新增改为迷你弹窗+行内编辑，将现有双击编辑扩展为支持方向键导航。

**Tech Stack:** Vue 3 (CDN) + Element Plus + 现有 API 封装（`api.js`）

**Spec:** `docs/superpowers/specs/2026-03-17-inline-edit-design.md`

---

## Chunk 1: 缩窄列宽 + 迷你弹窗新增

### Task 1: 缩窄列宽

**Files:**
- Modify: `public/js/app.js:584-589` — `getColumnWidth()` 方法
- Modify: `public/js/app.js:371` — 合计区列宽引用

- [ ] **Step 1: 修改 `getColumnWidth` 方法**

找到 `getColumnWidth(col)` 方法（约第 584 行），修改列宽值：

```javascript
getColumnWidth(col) {
  if (col.field === 'remark') return 120;
  if (col.type === 'ratio') return 65;    // 修改前: 80
  if (col.type === 'integer') return 65;  // 修改前: 85
  return 80;                               // 修改前: 110
},
```

- [ ] **Step 2: 验证页面显示**

Run: `pm2 restart production-system`

浏览器 Ctrl+F5 刷新，打开印喷部明细表，确认：
- 列宽明显缩窄
- shortLabel 表头文字没有截断
- 横向滚动减少

- [ ] **Step 3: Commit**

```bash
git add public/js/app.js
git commit -m "feat: 缩窄明细表列宽 — 数字80px/比率65px/整数65px"
```

---

### Task 2: 迷你弹窗替换大弹窗

**Files:**
- Modify: `public/js/app.js:409-429` — 新增对话框 template
- Modify: `public/js/app.js:612-634` — `showAddDialog()` 和 `handleAdd()` 方法
- Modify: `public/js/app.js:443-444` — `addForm` data 定义

- [ ] **Step 1: 替换新增对话框 template**

找到现有的新增对话框（约第 409-429 行）：

```html
<!-- 新增对话框 -->
<el-dialog v-model="addDialogVisible" title="新增记录" width="600px" destroy-on-close>
  <el-form :model="addForm" label-width="110px" size="default">
    ...所有 editableColumns 表单项...
  </el-form>
  ...
</el-dialog>
```

替换为迷你弹窗（只有日期和车间）：

```html
<!-- 新增记录迷你弹窗（只填日期和车间，创建后行内编辑） -->
<el-dialog v-model="addDialogVisible" title="新增记录" width="320px" destroy-on-close>
  <el-form :model="addForm" label-width="60px" size="default">
    <el-form-item label="日期" required>
      <el-date-picker v-model="addForm.record_date" type="date" placeholder="选择日期"
                       value-format="YYYY-MM-DD" style="width:100%" />
    </el-form-item>
    <el-form-item label="车间" required>
      <el-select v-model="addForm.workshop_id" placeholder="选择车间" style="width:100%">
        <el-option v-for="w in workshopList" :key="w.id" :label="w.name" :value="w.id" />
      </el-select>
    </el-form-item>
  </el-form>
  <template #footer>
    <el-button @click="addDialogVisible = false">取消</el-button>
    <el-button type="primary" @click="handleAdd" :loading="saving">确认创建</el-button>
  </template>
</el-dialog>
```

- [ ] **Step 2: 简化 `showAddDialog` 方法**

找到 `showAddDialog()` 方法（约第 612 行），替换为：

```javascript
showAddDialog() {
  // 迷你弹窗只需日期和车间，其他字段创建后行内编辑
  this.addForm = { record_date: formatDate(new Date()), workshop_id: '' };
  this.addDialogVisible = true;
},
```

注意：删除原有的 `this.editableColumns.forEach(...)` 循环（不再需要初始化所有字段）。

- [ ] **Step 3: 修改 `handleAdd` 方法 — 创建后自动聚焦新行**

找到 `handleAdd()` 方法（约第 619 行），替换为：

```javascript
async handleAdd() {
  if (!this.addForm.record_date || !this.addForm.workshop_id) {
    ElementPlus.ElMessage.warning('请填写日期和车间');
    return;
  }
  this.saving = true;
  try {
    // POST 只发日期和车间，后端会把数值字段默认为 0
    const res = await API.post(`/${this.dept}/records`, this.addForm);
    this.addDialogVisible = false;
    ElementPlus.ElMessage.success('新增成功');
    await this.loadData();
    // 自动进入新行第一个可编辑单元格的编辑模式
    const newId = res.data?.id;
    if (newId) {
      const firstEditable = this.columns.find(c => c.editable);
      if (firstEditable) {
        this.editingCell = { rowId: newId, field: firstEditable.field };
        this.$nextTick(() => {
          const input = this.$el?.querySelector('.data-table-wrapper input');
          if (input) input.focus();
        });
      }
    }
  } catch (err) {
    ElementPlus.ElMessage.error('新增失败: ' + (err.message || '未知错误'));
  } finally {
    this.saving = false;
  }
},
```

- [ ] **Step 4: 验证新增流程**

Run: `pm2 restart production-system`

浏览器 Ctrl+F5 刷新，测试：
1. 点"+ 新增" → 弹出迷你弹窗（只有日期和车间）
2. 选择日期和车间 → 点"确认创建"
3. 新行出现在表格中，第一个可编辑单元格自动进入编辑模式
4. 双击其他单元格可以编辑

- [ ] **Step 5: Commit**

```bash
git add public/js/app.js
git commit -m "feat: 迷你弹窗新增 — 只填日期车间，创建后行内编辑"
```

---

## Chunk 2: Excel 式键盘导航

### Task 3: 添加键盘导航核心方法

**Files:**
- Modify: `public/js/app.js` — DeptDetail 组件的 methods 部分

- [ ] **Step 1: 添加 `findNextEditable` 方法**

在 DeptDetail 组件的 `methods` 中（`cancelEdit` 方法之后，约第 536 行），添加：

```javascript
// 查找下一个可编辑单元格的位置
// direction: 'left' | 'right' | 'up' | 'down'
findNextEditable(rowIndex, colIndex, direction) {
  const rows = this.tableData;
  const cols = this.columns;
  let r = rowIndex, c = colIndex;

  if (direction === 'right' || direction === 'left') {
    const step = direction === 'right' ? 1 : -1;
    c += step;
    // 在当前行中查找下一个可编辑列
    while (c >= 0 && c < cols.length) {
      if (cols[c].editable) return { rowIndex: r, colIndex: c };
      c += step;
    }
    // Tab/右键到行尾：跳到下一行第一个可编辑列
    if (direction === 'right' && r + 1 < rows.length) {
      r++;
      c = cols.findIndex(col => col.editable);
      if (c !== -1) return { rowIndex: r, colIndex: c };
    }
    // Shift+Tab/左键到行首：跳到上一行最后一个可编辑列
    if (direction === 'left' && r - 1 >= 0) {
      r--;
      for (c = cols.length - 1; c >= 0; c--) {
        if (cols[c].editable) return { rowIndex: r, colIndex: c };
      }
    }
    return null; // 到达边界
  }

  if (direction === 'up' || direction === 'down') {
    r += direction === 'down' ? 1 : -1;
    if (r >= 0 && r < rows.length) return { rowIndex: r, colIndex: c };
    return null; // 到达边界
  }
  return null;
},
```

- [ ] **Step 2: 添加 `navigateEdit` 方法**

紧接着 `findNextEditable` 之后添加：

```javascript
// Excel式导航：保存当前单元格，跳到下一个可编辑单元格
// 关键：用 _isNavigating 标志防止 @blur 触发 saveCell 导致双重保存
navigateEdit(direction) {
  // 1. 捕获当前位置（必须在任何状态变更之前）
  const currentRowId = this.editingCell.rowId;
  const currentField = this.editingCell.field;
  const rowIndex = this.tableData.findIndex(r => r.id === currentRowId);
  const colIndex = this.columns.findIndex(c => c.field === currentField);
  if (rowIndex === -1 || colIndex === -1) return;

  // 2. 计算下一个位置
  const next = this.findNextEditable(rowIndex, colIndex, direction);
  if (!next) return; // 到达边界，不跳转

  // 3. 保存当前单元格（手动处理，阻止 blur 的 saveCell 双重保存）
  this._isNavigating = true;
  const input = this.$el.querySelector('.data-table-wrapper input:focus');
  if (input) {
    const value = input.value;
    const row = this.tableData[rowIndex];
    if (row && String(row[currentField]) !== String(value)) {
      const oldValue = row[currentField];
      row[currentField] = value;
      // 异步保存，不阻塞导航；失败时回滚并提示
      API.put(`/${this.dept}/records/${row.id}`, { [currentField]: value })
        .then(() => this.loadData())
        .catch(err => {
          row[currentField] = oldValue;
          ElementPlus.ElMessage.error('保存失败: ' + (err.message || '未知错误'));
        });
    }
  }

  // 4. 立即设置新位置（不等 loadData 完成）
  const nextRow = this.tableData[next.rowIndex];
  if (nextRow) {
    this.editingCell = { rowId: nextRow.id, field: this.columns[next.colIndex].field };
    this.$nextTick(() => {
      this._isNavigating = false;
      const newInput = this.$el.querySelector('.data-table-wrapper input');
      if (newInput) {
        newInput.focus();
        newInput.select(); // 选中内容，方便直接输入覆盖
      }
    });
  } else {
    this._isNavigating = false;
  }
},
```

- [ ] **Step 3: 添加 `handleEditKeydown` 方法**

紧接着 `navigateEdit` 之后添加：

```javascript
// 编辑中的键盘事件处理
handleEditKeydown(event, row, col) {
  const input = event.target;
  const atStart = input.selectionStart === 0;
  const atEnd = input.selectionStart === input.value.length;

  switch (event.key) {
    case 'ArrowLeft':
      if (!atStart) return; // 光标不在最左边，让浏览器正常移动文本光标
      event.preventDefault();
      this.navigateEdit('left');
      break;
    case 'ArrowRight':
      if (!atEnd) return; // 光标不在最右边，让浏览器正常移动文本光标
      event.preventDefault();
      this.navigateEdit('right');
      break;
    case 'ArrowUp':
      event.preventDefault();
      this.navigateEdit('up');
      break;
    case 'ArrowDown':
      event.preventDefault();
      this.navigateEdit('down');
      break;
    case 'Tab':
      event.preventDefault();
      this.navigateEdit(event.shiftKey ? 'left' : 'right');
      break;
    case 'Enter':
      event.preventDefault();
      this.navigateEdit('down');
      break;
    case 'Escape':
      event.preventDefault();
      this.cancelEdit();
      break;
  }
},
```

- [ ] **Step 4: Commit**

```bash
git add public/js/app.js
git commit -m "feat: 添加Excel式键盘导航方法 — findNextEditable/navigateEdit/handleEditKeydown"
```

---

### Task 4: 绑定键盘事件到 template

**Files:**
- Modify: `public/js/app.js:336-343` — 编辑状态 input 的 template

- [ ] **Step 1: 替换 input 上的事件绑定**

找到编辑状态的 input（约第 336-343 行）：

```html
<input :value="row[col.field]" @blur="saveCell(row, col.field, $event)"
       @keyup.enter="$event.target.blur()"
       @keyup.escape="cancelEdit"
       @input="limitDecimals($event)"
       autofocus
       :type="col.type === 'text' ? 'text' : 'text'"
       style="width:100%; border:2px solid var(--primary); outline:none; padding:0 4px; font-size:13px; text-align:right; background:#fff;" />
```

替换为：

```html
<input :value="row[col.field]" @blur="saveCell(row, col.field, $event)"
       @keydown="handleEditKeydown($event, row, col)"
       @input="limitDecimals($event)"
       autofocus
       style="width:100%; border:2px solid var(--primary); outline:none; padding:0 4px; font-size:13px; text-align:right; background:#fff;" />
```

变化说明：
- 删除 `@keyup.enter="$event.target.blur()"` — 由 handleEditKeydown 的 Enter 处理
- 删除 `@keyup.escape="cancelEdit"` — 由 handleEditKeydown 的 Escape 处理
- 新增 `@keydown="handleEditKeydown($event, row, col)"` — 统一键盘事件入口
- 删除 `:type` 属性（始终为 text，无需动态绑定）
- 保持 `:value` 单向绑定（非 v-model），确保 Esc 取消时不会写回修改

- [ ] **Step 1.5: 在 `saveCell` 中添加导航保护**

找到 `saveCell` 方法（约第 569 行），在方法体最开头添加导航保护：

```javascript
async saveCell(row, field, event) {
  // 键盘导航中由 navigateEdit 处理保存，跳过 blur 触发的 saveCell 防止双重保存
  if (this._isNavigating) return;
  const value = event.target.value;
  // ...后续现有逻辑不变...
```

只添加 `if (this._isNavigating) return;` 这一行，其余逻辑不动。

- [ ] **Step 2: 验证完整流程**

Run: `pm2 restart production-system`

浏览器 Ctrl+F5 刷新，在印喷部创建一条测试记录后验证：

1. **双击** 任意可编辑单元格 → 进入编辑模式 ✓
2. 输入数字，按 **→** → 跳到右边下一个可编辑列 ✓
3. 按 **→** 遇到计算列 → 自动跳过 ✓
4. 按 **Tab** 到行尾 → 跳到下一行第一个可编辑列 ✓
5. 按 **Shift+Tab** → 跳到左边上一个可编辑列 ✓
6. 按 **↓** → 跳到下方同列 ✓
7. 按 **↑** → 跳到上方同列 ✓
8. 按 **Enter** → 跳到下方同列 ✓
9. 按 **Esc** → 取消编辑，退出编辑模式 ✓
10. 编辑中 **点击表格外空白处** → 保存并退出编辑模式 ✓
11. 退出后按方向键 → 无反应，需双击重新进入 ✓
12. 编辑数字 "12345"，**按 ←** → 光标在中间时移动文本光标，光标到最左边时才跳转 ✓

- [ ] **Step 3: Commit**

```bash
git add public/js/app.js
git commit -m "feat: 绑定Excel式键盘导航到编辑input — 方向键/Tab/Enter/Esc"
```

---

### Task 5: 新行高亮样式

**Files:**
- Modify: `public/css/theme.css` — 添加新行高亮样式
- Modify: `public/js/app.js:315-318` — el-table 添加 row-class-name
- Modify: `public/js/app.js:432-446` — data 添加 newRowId

- [ ] **Step 1: 添加 CSS 样式**

在 `public/css/theme.css` 文件末尾添加：

```css
/* 新增行高亮 — 淡紫色背景，3秒渐隐动画 */
.el-table .new-row-highlight td {
  animation: row-highlight-fade 3s ease forwards;
}
@keyframes row-highlight-fade {
  0% { background-color: #F0E6F6; }
  100% { background-color: transparent; }
}
```

- [ ] **Step 2: 修改 el-table 添加 row-class-name**

找到 el-table 标签（约第 315 行），添加 `:row-class-name` 属性：

在 `v-loading="loading"` 之后，`ref="dataTable"` 之前添加：
```
:row-class-name="getRowClass"
```

- [ ] **Step 3: 在 data 中添加 newRowId 状态**

在 `data()` 的 return 对象中（约第 444 行 `addForm: {}` 之后）添加：
```javascript
newRowId: null,  // 最近新增的行ID，用于高亮显示
```

- [ ] **Step 4: 添加 getRowClass 方法**

在 methods 中添加（`headerCellClass` 方法附近）：
```javascript
getRowClass({ row }) {
  return row.id === this.newRowId ? 'new-row-highlight' : '';
},
```

- [ ] **Step 5: 在 handleAdd 中设置 newRowId**

在 `handleAdd` 方法中，`await this.loadData()` 之后、设置 `editingCell` 之前添加：
```javascript
    // 高亮新行，3秒后消除
    this.newRowId = newId;
    setTimeout(() => { this.newRowId = null; }, 4000); // 动画3秒，4秒后清除class
```

- [ ] **Step 6: 验证新行高亮**

Run: `pm2 restart production-system`

新增一条记录，确认：
- 新行出现时有淡紫色背景
- 3 秒后渐变消失

- [ ] **Step 7: Commit**

```bash
git add public/js/app.js public/css/theme.css
git commit -m "feat: 新增行淡紫色高亮 — 3秒渐隐"
```
