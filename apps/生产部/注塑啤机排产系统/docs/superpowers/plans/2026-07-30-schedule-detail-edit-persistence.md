# 排机明细编辑持久化修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让草稿排机明细中已经显示为“保存成功”的编辑值真正写入数据库，并在前端重新读取后保持不变。

**Architecture:** 保留现有前端编辑与刷新流程，只修正 `PUT /api/scheduling/:id/items/:itemId` 的后端更新逻辑。使用真实临时 SQLite 数据库调用真实路由处理器，先复现遗漏字段，再验证字段持久化和欠数重算。

**Tech Stack:** Node.js `node:test`、Express Router、better-sqlite3、React、Vite。

## Global Constraints

- 只修复草稿排机明细保存，不改变 confirmed 排机单的只读规则。
- 保存颜色、色粉编号、料型、啤重、用料和需啤数。
- 修改需啤数时使用当前累计数重算欠数。
- 不修改原始订单和历史记录。
- 当前目录不是 Git 仓库，不执行提交或推送。

---

### Task 1: 用真实路由和临时数据库复现保存失败

**Files:**
- Create: `server/tests/schedulingItemUpdate.test.js`
- Test: `server/tests/schedulingItemUpdate.test.js`

**Interfaces:**
- Consumes: `server/routes/scheduling.js` 的 `PUT /:id/items/:itemId` 路由。
- Produces: 可重复验证数据库持久化结果的路由集成测试。

- [ ] **Step 1: 写颜色字段持久化测试**

测试创建临时 SQLite 数据库，初始化一条草稿排机明细，调用真实路由处理器提交：

```js
{ color: '蓝色2147C' }
```

断言响应为 `200`，并且重新查询数据库得到 `color = '蓝色2147C'`。

- [ ] **Step 2: 运行测试确认失败**

运行：

```bash
node --test tests/schedulingItemUpdate.test.js
```

预期：FAIL，当前接口返回 `400 没有要更新的字段`。

- [ ] **Step 3: 写完整字段与欠数测试**

提交颜色、色粉编号、料型、啤重、用料、需啤数，并断言所有字段写入；当累计数为 200、需啤数改为 1500 时，欠数必须为 1300。

---

### Task 2: 修复更新接口

**Files:**
- Modify: `server/routes/scheduling.js`
- Test: `server/tests/schedulingItemUpdate.test.js`

**Interfaces:**
- Consumes: Task 1 的失败测试。
- Produces: 接收全部前端编辑字段并返回更新后明细的 PUT 接口。

- [ ] **Step 1: 加入缺失文本字段**

将 `color`、`color_powder_no`、`material_type` 加入允许更新字段。

- [ ] **Step 2: 加入数值字段**

将 `shot_weight`、`material_kg` 转换为数字后更新。

- [ ] **Step 3: 统一累计数、需啤数和欠数计算**

当 `accumulated` 或 `quantity_needed` 任一出现时，读取当前明细，使用请求值覆盖对应当前值，再计算：

```js
const shortage = Math.max(0, quantityNeeded - accumulated);
```

只在请求包含对应字段时更新 `accumulated` 或 `quantity_needed`，并写入重算后的 `shortage`。

- [ ] **Step 4: 运行针对性测试**

运行：

```bash
node --test tests/schedulingItemUpdate.test.js
```

预期：全部 PASS。

- [ ] **Step 5: 运行全部后端测试**

运行：

```bash
node --test tests/*.test.js
```

预期：全部 PASS，0 个失败。

---

### Task 3: 构建与运行验证

**Files:**
- Verify: `client/src/pages/ScheduleResult.jsx`
- Verify: `client/dist/`

**Interfaces:**
- Consumes: 修复后的保存接口和现有前端保存后 `fetchDetail()` 流程。
- Produces: 可运行的页面和保存后重新读取仍保持的新值。

- [ ] **Step 1: 构建前端**

运行 Vite 生产构建，预期退出码 0。

- [ ] **Step 2: 启动隔离诊断服务**

使用临时数据库在 3100 端口启动服务，不写正式数据。

- [ ] **Step 3: 通过页面编辑并保存**

在草稿排机明细中修改颜色和用料，点击保存后重新读取详情。

- [ ] **Step 4: 验证页面和数据库**

页面显示新值；临时 SQLite 数据库查询结果与页面一致。

- [ ] **Step 5: 范围复核**

业务代码改动仅限 `server/routes/scheduling.js`；另新增测试、设计和计划文档。
