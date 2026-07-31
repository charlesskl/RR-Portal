# 华登机台扩充至 38 台实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将华登正常编号机台从 `C-1#`～`C-34#`扩充为连续的`C-1#`～`C-38#`，并让初始化、种子数据和当前数据库保持一致。

**Architecture:** 继续沿用现有 `server/db/init.js` 的幂等 `INSERT OR IGNORE` 初始化机制，将华登生成数量调整为 38；同时扩充 `server/seed/machines.json`，保证归档恢复数据一致。通过临时数据库集成测试验证初始化行为，再重启当前服务使初始化逻辑安全补入四台机。

**Tech Stack:** Node.js `node:test`、better-sqlite3、Express、SQLite、JSON 种子数据。

## Global Constraints

- 新增编号仅为 `C-35#`、`C-36#`、`C-37#`、`C-38#`。
- 四台机属性固定为：博创、150T、三轴单臂、启用、C 车间。
- `其他机台`和`吹气机台`不计入 38 台正常编号机台。
- 不修改 A、B 车间，不覆盖既有机台，不改变既有排产记录。
- 初始化必须幂等，重复执行后华登接口总数仍为 40。
- 当前目录不是 Git 仓库，因此本计划不执行提交；改动完成后与归档源文件逐项比较。

---

### Task 1: 用集成测试定义华登 38 台行为

**Files:**
- Create: `server/tests/huadengMachines.test.js`
- Test: `server/tests/huadengMachines.test.js`

**Interfaces:**
- Consumes: `server/db/init.js` 导出的 `initDatabase()`，环境变量 `DATA_PATH`，`server/seed/machines.json`。
- Produces: 对初始化数据库与种子数据的可重复验收测试。

- [ ] **Step 1: 写入失败测试**

测试用临时目录作为 `DATA_PATH`，在独立 Node 子进程中执行真实 `initDatabase()`；随后读取临时 SQLite 数据库，断言：

```js
assert.deepEqual(
  regularMachines.map((m) => m.machine_no),
  Array.from({ length: 38 }, (_, i) => `C-${i + 1}#`)
);
assert.equal(allHuadengMachines.length, 40);
assert.equal(new Set(allHuadengMachines.map((m) => m.machine_no)).size, 40);
```

再读取真实种子 JSON，断言 `C-35#`～`C-38#` 均具备以下字面属性：

```js
{
  brand: '博创',
  tonnage: 150,
  arm_type: '三轴单臂',
  status: 'active',
  workshop: 'C'
}
```

- [ ] **Step 2: 运行测试并确认按预期失败**

运行：

```bash
node --test tests/huadengMachines.test.js
```

预期：FAIL；实际初始化和种子数据只包含 `C-1#`～`C-34#`。

- [ ] **Step 3: 做测试变异检查**

确认生产代码保持 `length: 34` 时测试失败；这证明测试能捕获“华登仍为 34 台”的回归。

---

### Task 2: 扩充初始化与种子数据

**Files:**
- Modify: `server/db/init.js:201-205`
- Modify: `server/seed/machines.json`
- Test: `server/tests/huadengMachines.test.js`

**Interfaces:**
- Consumes: Task 1 的真实初始化集成测试。
- Produces: 幂等创建 `C-1#`～`C-38#` 的初始化逻辑，以及包含完整 38 台华登机台的种子数据。

- [ ] **Step 1: 修改最小生产代码**

将：

```js
// ========== 预置华登(C车间)34台机 ==========
const machinesC = Array.from({ length: 34 }, (_, i) => ({
```

改为：

```js
// ========== 预置华登(C车间)38台机 ==========
const machinesC = Array.from({ length: 38 }, (_, i) => ({
```

- [ ] **Step 2: 扩充种子数据**

在 `server/seed/machines.json` 的华登正常编号机台末尾加入 `C-35#`～`C-38#`；每条数据使用：

```json
{
  "machine_no": "C-35#",
  "brand": "博创",
  "tonnage": 150,
  "arm_type": "三轴单臂",
  "model_desc": "博创150T三轴单臂",
  "status": "active",
  "workshop": "C"
}
```

其余三条仅替换编号。

- [ ] **Step 3: 运行针对性测试并确认通过**

运行：

```bash
node --test tests/huadengMachines.test.js
```

预期：PASS，0 个失败。

- [ ] **Step 4: 运行全部后端测试**

运行：

```bash
node --test tests/*.test.js
```

预期：全部 PASS，0 个失败。

---

### Task 3: 更新当前数据库并验证运行服务

**Files:**
- Modify at runtime: `server/data/paiji.db`
- Verify: `server/db/init.js`
- Verify: `server/seed/machines.json`

**Interfaces:**
- Consumes: Task 2 的幂等初始化逻辑。
- Produces: 当前运行数据库中的 38 台正常华登机台和 2 台特殊机台。

- [ ] **Step 1: 重启当前服务触发幂等初始化**

停止当前明确运行的啤机 Node 服务，再使用 bundled Node 从 `server/app.js` 启动。初始化应只补入缺少的四台华登机台。

- [ ] **Step 2: 验证数据库完整性与机台数据**

运行：

```bash
sqlite3 server/data/paiji.db "
PRAGMA integrity_check;
SELECT COUNT(*) FROM machines WHERE workshop='C' AND machine_no GLOB 'C-[0-9]*#';
SELECT COUNT(*) FROM machines WHERE workshop='C';
SELECT machine_no,brand,tonnage,arm_type,status
FROM machines
WHERE workshop='C' AND machine_no IN ('C-35#','C-36#','C-37#','C-38#')
ORDER BY CAST(REPLACE(REPLACE(machine_no,'C-',''),'#','') AS INTEGER);
"
```

预期：完整性为 `ok`，正常编号 38 条，总数 40 条，四台新增机属性正确。

- [ ] **Step 3: 验证幂等性**

再次执行 `initDatabase()`，重复 Task 3 Step 2 的计数查询。

预期：正常编号仍为 38，总数仍为 40，没有重复。

- [ ] **Step 4: 验证 HTTP 服务**

运行：

```bash
curl -fsS http://127.0.0.1:3000/health
curl -fsS 'http://127.0.0.1:3000/api/machines?workshop=C'
```

预期：健康接口返回 `{"status":"ok"}`；机台接口返回 40 条，其中正常编号连续覆盖 `C-1#`～`C-38#`。

- [ ] **Step 5: 验证前端构建**

安装客户端锁定依赖后运行：

```bash
pnpm run build
```

预期：构建退出码 0。

- [ ] **Step 6: 范围复核**

将当前工作区与归档源目录比较，确认业务改动仅包含：

- `server/db/init.js`
- `server/seed/machines.json`
- `server/tests/huadengMachines.test.js`
- 设计与计划文档
- 当前数据库中新增四条华登机台记录

依赖目录与本地运行配置不计入业务源码变更。
