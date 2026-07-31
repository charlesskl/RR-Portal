# 同模机台批量同步 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用户手动修改排机明细机台时，确认后将当前排单内模号名称完全相同的记录一起改到目标机台。

**Architecture:** 前端用一个纯函数计算同模条数和是否需要确认，快速切换与完整编辑共用同一套确认流程。后端仍使用现有明细更新接口，只有收到显式同步标志且机台确实变化时，才在事务中按 `schedule_id + mold_name` 批量更新并返回同步条数。

**Tech Stack:** React 19、Ant Design 6、Axios、Express 4、better-sqlite3、Node.js `node:test`

## Global Constraints

- “同一套模”按 `mold_name`（模号名称）完全相等判断。
- 同步范围仅限当前 `schedule_id` 对应的排单。
- 只同步 `machine_no`（机台号）。
- 同模记录有两条或以上时必须先确认；用户取消时不保存。
- 编辑其他字段但机台号未改变时不得批量覆盖同模记录。
- 当前目录不是 Git 仓库，不执行分支、worktree 或提交步骤。

---

### Task 1: 后端同模同步接口

**Files:**
- Modify: `server/tests/schedulingItemUpdate.test.js`
- Modify: `server/routes/scheduling.js`

**Interfaces:**
- Consumes: `PUT /api/scheduling/:id/items/:itemId` 请求体中的 `machine_no` 和 `sync_same_mold_machine`
- Produces: 更新后的明细对象和数值字段 `synced_same_mold_count`

- [ ] **Step 1: 写当前排单同模同步的失败测试**

在测试数据库中建立当前排单的两条同模记录、一条不同模记录和另一排单的一条同模记录。调用：

```js
invokeUpdate(scheduleId, itemId, {
  machine_no: 'C-20#',
  sync_same_mold_machine: true,
});
```

断言当前排单两条同模记录均为 `C-20#`、不同模记录和另一排单记录不变，并断言：

```js
assert.equal(result.payload.synced_same_mold_count, 2);
```

- [ ] **Step 2: 运行测试并确认因缺少批量同步而失败**

Run:

```bash
node --test server/tests/schedulingItemUpdate.test.js
```

Expected: 新测试失败，第二条同模记录仍保留原机台或响应缺少 `synced_same_mold_count`。

- [ ] **Step 3: 写机台未变化和路由归属校验的失败测试**

分别断言：

```js
invokeUpdate(scheduleId, itemId, {
  notes: '只改备注',
  machine_no: 'C-4#',
  sync_same_mold_machine: true,
});
```

不会修改另一条同模记录原有机台；用其他 `scheduleId` 配合同一 `itemId` 调用时返回 404 且原记录不变。

- [ ] **Step 4: 实现最小后端逻辑**

在路由开头按排单和明细联合查询：

```js
const currentItem = db.prepare(
  'SELECT * FROM schedule_items WHERE id = ? AND schedule_id = ?'
).get(itemId, id);
if (!currentItem) return res.status(404).json({ message: '记录不存在' });
```

计算显式批量同步条件：

```js
const shouldSyncSameMold = (
  req.body.sync_same_mold_machine === true
  && req.body.machine_no !== undefined
  && req.body.machine_no !== currentItem.machine_no
  && Boolean(currentItem.mold_name)
);
```

用 better-sqlite3 事务执行当前行更新和同模机台更新：

```js
let syncedSameMoldCount = 1;
db.transaction(() => {
  db.prepare(`UPDATE schedule_items SET ${updates.join(', ')} WHERE id = ?`).run(...values, itemId);
  if (shouldSyncSameMold) {
    const result = db.prepare(`
      UPDATE schedule_items
      SET machine_no = ?
      WHERE schedule_id = ? AND mold_name = ?
    `).run(req.body.machine_no, id, currentItem.mold_name);
    syncedSameMoldCount = result.changes;
  }
})();
```

响应中增加：

```js
res.json({ ...item, synced_same_mold_count: syncedSameMoldCount });
```

- [ ] **Step 5: 运行后端测试并确认全部通过**

Run:

```bash
node --test server/tests/schedulingItemUpdate.test.js
```

Expected: 全部测试通过，0 failures。

### Task 2: 前端同模确认与共用交互

**Files:**
- Create: `client/src/utils/sameMoldMachineSync.js`
- Create: `client/tests/sameMoldMachineSync.test.mjs`
- Modify: `client/src/pages/ScheduleResult.jsx`

**Interfaces:**
- Produces: `getSameMoldMachineChange(items, record, newMachineNo)`
- Returns: `{ sameMoldCount, shouldConfirm, shouldSync }`
- Consumes: 后端响应 `synced_same_mold_count`

- [ ] **Step 1: 写前端判断函数的失败测试**

测试文件用动态导入捕获模块尚不存在的情况，并先断言导出函数存在，使首次运行表现为明确的行为断言失败而不是模块加载错误：

```js
let helperModule = {};
try {
  helperModule = await import('../src/utils/sameMoldMachineSync.js');
} catch {
  // RED 阶段：模块尚未实现
}

test('exports the same-mold machine change decision', () => {
  assert.equal(typeof helperModule.getSameMoldMachineChange, 'function');
});
```

随后测试真实输入输出：

```js
assert.deepEqual(
  getSameMoldMachineChange(items, items[0], '20#'),
  { sameMoldCount: 2, shouldConfirm: true, shouldSync: true }
);
```

并覆盖模号不同、空模号、机台未变化三个边界；机台未变化时 `shouldConfirm` 与 `shouldSync` 必须都是 `false`。

- [ ] **Step 2: 运行前端测试并确认因模块不存在而失败**

Run:

```bash
node --test client/tests/sameMoldMachineSync.test.mjs
```

Expected: FAIL，断言 `getSameMoldMachineChange` 应为函数但实际为 `undefined`。

- [ ] **Step 3: 实现纯判断函数**

```js
export function getSameMoldMachineChange(items, record, newMachineNo) {
  const machineChanged = newMachineNo !== record.machine_no;
  const sameMoldCount = record.mold_name
    ? items.filter(item => item.mold_name === record.mold_name).length
    : 1;
  const shouldSync = machineChanged && sameMoldCount > 1;

  return {
    sameMoldCount,
    shouldConfirm: shouldSync,
    shouldSync,
  };
}
```

- [ ] **Step 4: 运行判断函数测试并确认通过**

Run:

```bash
node --test client/tests/sameMoldMachineSync.test.mjs
```

Expected: 全部测试通过，0 failures。

- [ ] **Step 5: 将快速切换和完整编辑接入共用确认流程**

在 `ScheduleResult.jsx` 中导入判断函数。保存前生成判断结果，批量时通过 `Modal.confirm` 显示：

```jsx
title: `同模共 ${sameMoldCount} 条`,
content: `将一起移到 ${newMachineNo} 机台，是否确认？`,
okText: '确认更改',
cancelText: '取消',
```

确认后发送：

```js
{
  ...body,
  ...(shouldSync ? { sync_same_mold_machine: true } : {}),
}
```

完整编辑只有 `editingData.machine_no !== record.machine_no` 才进入同模确认；非机台编辑直接保存。成功时优先根据 `synced_same_mold_count` 显示：

```js
`已将同模 ${count} 条排机记录移动到 ${machineNo}`
```

取消确认时保持编辑状态或关闭快速机台选择，不发请求。

- [ ] **Step 6: 运行前端自动化测试和构建**

Run:

```bash
node --test client/tests/*.test.mjs
npm run build --prefix client
```

Expected: 所有前端测试通过，Vite 构建成功。

### Task 3: 回归验证与正式服务

**Files:**
- Verify: `server/routes/scheduling.js`
- Verify: `client/src/pages/ScheduleResult.jsx`
- Build output: `client/dist/`

**Interfaces:**
- Consumes: 本地正式服务 `http://localhost:3000`
- Produces: 可在浏览器中确认、取消和保存的同模机台同步功能

- [ ] **Step 1: 运行完整相关测试**

Run:

```bash
node --test server/tests/*.test.js
node --test client/tests/*.test.mjs
npm run build --prefix client
```

Expected: 测试全部通过且构建成功。

- [ ] **Step 2: 重启正式服务器**

终止当前项目占用的 `3000` 端口进程后，在 `server` 目录执行：

```bash
npm start
```

只终止已核对命令行属于当前应用 `server/app.js` 的进程。

- [ ] **Step 3: 浏览器验证快速机台切换**

在测试排单中准备两条 `mold_name` 完全相同但机台不同的记录。点击其中一条机台号并选择新机台：

- 确认框显示同模总条数和目标机台。
- 点击取消后两条数据均不变。
- 再次操作并确认后两条数据同时变成目标机台。

- [ ] **Step 4: 浏览器验证完整编辑与非机台编辑**

- “编辑”中修改机台并保存，确认框和批量同步行为与快速切换一致。
- 只修改颜色或备注时不出现同模确认，字段正常保存。

- [ ] **Step 5: 检查服务健康**

Run:

```bash
curl -fsS http://localhost:3000/health
curl -I -s http://localhost:3000/
```

Expected: 健康接口成功，首页返回 HTTP 200。
