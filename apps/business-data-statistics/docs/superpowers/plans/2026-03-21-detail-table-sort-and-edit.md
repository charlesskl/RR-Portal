# 明细表排序固定与编辑增强 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复明细表排序乱跳问题，去掉序号列，让日期和车间字段支持行内编辑，车间下拉按区域分组展示。

**Architecture:** 后端仅修改 GET 记录查询的 SELECT 和 ORDER BY（使用已有的 `w.sort_order` 字段，不硬编码车间名），前端 loadData() 统一调用 sortRecords() 保证视图有序；日期/车间列改为条件渲染的行内编辑器，编辑后本地重排，不发起全量 loadData()。汇总路由（summary）已经正确使用 `w.sort_order`，不需要改动。

**Tech Stack:** Express 5 + PostgreSQL（supertest 集成测试）；Vue 3 CDN + Element Plus（手动验证）

---

## 文件变更地图

| 文件 | 操作 | 说明 |
|------|------|------|
| `routes/records.js` | 修改 | 仅修改 GET records 查询（约第 26-35 行）：SELECT 加 `w.sort_order as workshop_sort_order`；ORDER BY 改三级升序。汇总路由（约第 159-161 行）不动 |
| `public/js/app.js` | 修改 | 去序号列；加 sortRecords()；loadData() 调用 sortRecords；加 computed workshopGroups；date/workshop 列改为可编辑；加状态变量和编辑方法；workshopList 加 sort_order |
| `tests/detail-sort-edit.test.js` | 新建 | 后端集成测试：排序顺序验证、workshop_sort_order 字段验证 |

---

## Task 1：后端修复 SELECT + ORDER BY

**Files:**
- Modify: `routes/records.js:26-35`
- Create: `tests/detail-sort-edit.test.js`

### 1.1 先写失败测试

- [ ] 新建 `tests/detail-sort-edit.test.js`，内容如下：

```javascript
// tests/detail-sort-edit.test.js
// SORT-01/02/03: 明细表排序固定 — 日期升序、车间固定顺序、id 升序

const request = require('supertest');
const app = require('../server');
const { query } = require('../db/postgres');

const TEST_DATE_EARLY = '2099-07-01';
const TEST_DATE_LATE  = '2099-07-15';
let token = '';
let workshopA, workshopB;

beforeAll(async () => {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ username: 'RRxing', password: 'admin123' });
  token = res.body.token;

  // 取啤机部前两个车间（sort_order 1 和 2）
  const wRes = await request(app)
    .get('/api/workshops')
    .query({ department: 'beer' })
    .set('Authorization', `Bearer ${token}`);
  const ws = (wRes.body.data || []).sort((a, b) => a.sort_order - b.sort_order);
  workshopA = ws[0];
  workshopB = ws[1];

  if (!workshopA || !workshopB) {
    console.warn('SORT-TEST: 跳过 — 数据库中啤机部车间数量不足');
    return;
  }

  // 插入两条记录：晚日期先插，早日期后插（验证排序不按插入顺序）
  await request(app).post('/api/beer/records')
    .set('Authorization', `Bearer ${token}`)
    .send({ record_date: TEST_DATE_LATE, workshop_id: workshopB.id });
  await request(app).post('/api/beer/records')
    .set('Authorization', `Bearer ${token}`)
    .send({ record_date: TEST_DATE_EARLY, workshop_id: workshopA.id });
});

afterAll(async () => {
  // 清理测试数据（pool 由 Jest 隔离环境管理，不需要手动 pool.end()）
  try {
    await query(`DELETE FROM beer_records WHERE record_date IN (?, ?)`,
      [TEST_DATE_EARLY, TEST_DATE_LATE]);
  } catch (e) {}
});

describe('SORT-01/02: 日期升序 + 车间固定顺序', () => {
  test('GET /api/beer/records 返回日期升序排列', async () => {
    if (!workshopA) return;
    const res = await request(app)
      .get('/api/beer/records')
      .query({ start_date: TEST_DATE_EARLY, end_date: TEST_DATE_LATE })
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const records = res.body.data || res.body;
    expect(records.length).toBeGreaterThanOrEqual(2);
    // 第一条应该是早日期
    expect(records[0].record_date.substring(0, 10)).toBe(TEST_DATE_EARLY);
    expect(records[records.length - 1].record_date.substring(0, 10)).toBe(TEST_DATE_LATE);
  });

  test('GET /api/beer/records 返回 workshop_sort_order 字段（数字类型）', async () => {
    if (!workshopA) return;
    const res = await request(app)
      .get('/api/beer/records')
      .query({ start_date: TEST_DATE_EARLY, end_date: TEST_DATE_LATE })
      .set('Authorization', `Bearer ${token}`);
    const records = res.body.data || res.body;
    expect(records[0]).toHaveProperty('workshop_sort_order');
    expect(typeof records[0].workshop_sort_order).toBe('number');
  });
});
```

> **注意：** `afterAll` 不调用 `pool.end()`。Jest 默认为每个测试文件提供独立的模块沙箱，pool 生命周期由各自的沙箱管理，手动调用 `pool.end()` 反而会影响同文件内的异步清理。`entry-experience.test.js` 里的 `pool.end()` 是历史遗留写法，可以保留但本文件不复制该模式。

- [ ] 运行测试，确认**失败**：
```bash
cd "D:/03-AI related/02-Business data statistics"
npx jest tests/detail-sort-edit.test.js --no-coverage 2>&1 | tail -20
```
期望：FAIL（records 返回降序，且无 workshop_sort_order 字段）

### 1.2 修改后端代码

- [ ] 打开 `routes/records.js`，找到约第 26 行的 SELECT 语句：

**当前代码：**
```javascript
  let sql = `SELECT r.*, w.name as workshop_name, w.region
             FROM ${config.tableName} r
             LEFT JOIN workshops w ON r.workshop_id = w.id
             WHERE 1=1`;
```

**改为：**
```javascript
  let sql = `SELECT r.*, w.name as workshop_name, w.region, w.sort_order as workshop_sort_order
             FROM ${config.tableName} r
             LEFT JOIN workshops w ON r.workshop_id = w.id
             WHERE 1=1`;
```

- [ ] 找到约第 35 行的 ORDER BY：

**当前代码：**
```javascript
  sql += ' ORDER BY r.record_date DESC, w.sort_order ASC';
```

**改为：**
```javascript
  sql += ' ORDER BY r.record_date ASC, w.sort_order ASC, r.id ASC';
```

> **不要动**约第 159-161 行的汇总路由 ORDER BY（`GROUP BY w.id... ORDER BY w.sort_order`），该路由已经正确，且不需要 workshop_sort_order。

### 1.3 验证测试通过

- [ ] 运行测试，确认**通过**：
```bash
npx jest tests/detail-sort-edit.test.js --no-coverage 2>&1 | tail -20
```
期望：PASS（2 tests passed）

### 1.4 提交

```bash
git add routes/records.js tests/detail-sort-edit.test.js
git commit -m "fix: 明细表排序改为日期升序+车间顺序+id稳定，接口返回 workshop_sort_order"
```

---

## Task 2：前端基础改动（去序号列 + sortRecords）

**Files:**
- Modify: `public/js/app.js`

### 2.1 去掉序号列

- [ ] 在 `app.js` 中找到（约第 323 行）：
```html
          <el-table-column type="index" label="序号" width="50" fixed="left" />
```
删除这一整行。三个部门共用同一个模板组件，删一处即可。

### 2.2 去掉日期列的 sortable 属性

- [ ] 找到（约第 324 行）：
```html
          <el-table-column prop="record_date" label="日期" width="110" fixed="left" sortable>
```
改为（去掉 `sortable`，宽度从 110 改为 120 为日期选择器留空间）：
```html
          <el-table-column prop="record_date" label="日期" width="120" fixed="left">
```

### 2.3 新增 sortRecords 方法

- [ ] 在 `methods` 里 `loadWorkshops()` 前面，新增：

```javascript
    // 三级排序：日期升序 → 车间 sort_order 升序 → id 升序（创建先后）
    sortRecords(records) {
      return [...records].sort((a, b) => {
        if (a.record_date < b.record_date) return -1;
        if (a.record_date > b.record_date) return 1;
        const wa = a.workshop_sort_order ?? 99;
        const wb = b.workshop_sort_order ?? 99;
        if (wa !== wb) return wa - wb;
        return a.id - b.id;
      });
    },
```

### 2.4 在 loadData 中调用 sortRecords

- [ ] 找到（约第 502 行）：
```javascript
        this.tableData = recordsRes.data || recordsRes || [];
```
改为：
```javascript
        this.tableData = this.sortRecords(recordsRes.data || recordsRes || []);
```

### 2.5 浏览器验证

- [ ] 重启服务（`npm start` 或 `pm2 restart all`）
- [ ] 打开啤机部明细表，确认：
  - 不再显示序号列
  - 日期从 1 日到 31 日升序排列
  - 编辑任意数字后行不跳位

### 2.6 提交

```bash
git add public/js/app.js
git commit -m "feat: 去掉序号列，移除日期列 sortable，新增 sortRecords 保证前端排序稳定"
```

---

## Task 3：日期列行内编辑

**Files:**
- Modify: `public/js/app.js`

### 3.1 新增状态变量

- [ ] 在 `data()` 的返回对象里（找到 `workshopList: []` 附近），新增：

```javascript
      editingDateRowId: null,     // 当前正在编辑日期的行 id
      editingWorkshopRowId: null, // 当前正在编辑车间的行 id（Task 4 使用）
```

### 3.2 替换日期列模板

- [ ] 找到（约第 324-326 行，经 Task 2.2 修改后的版本）：
```html
          <el-table-column prop="record_date" label="日期" width="120" fixed="left">
            <template #default="{ row }">{{ row.record_date ? row.record_date.substring(0, 10) : '' }}</template>
          </el-table-column>
```
替换为：
```html
          <el-table-column prop="record_date" label="日期" width="120" fixed="left">
            <template #default="{ row }">
              <el-date-picker
                v-if="editingDateRowId === row.id"
                v-model="row._editDate"
                type="date"
                size="small"
                value-format="YYYY-MM-DD"
                style="width:108px"
                @change="saveDate(row)"
                @blur="cancelEditDate(row)"
              />
              <span
                v-else
                @click="startEditDate(row)"
                style="cursor:pointer;display:block;padding:2px 4px"
              >{{ row.record_date ? row.record_date.substring(0, 10) : '' }}</span>
            </template>
          </el-table-column>
```

> **日期选择器事件说明：** Element Plus 的 `el-date-picker` 在用户选择日期时先触发 `@change`，再触发 `@blur`。`saveDate` 在 `@change` 里完成保存并设 `editingDateRowId = null`；`cancelEditDate` 在 `@blur` 里执行（此时已无编辑态，属于无害操作）。两者不会互相干扰。

### 3.3 新增日期编辑方法

- [ ] 在 `methods` 里 `sortRecords` 下面，新增三个方法：

```javascript
    startEditDate(row) {
      row._editDate = row.record_date;
      this.editingDateRowId = row.id;
    },
    async saveDate(row) {
      // 必填校验
      if (!row._editDate) {
        ElementPlus.ElMessage.warning('日期为必填项，不能清空');
        row._editDate = row.record_date;
        this.editingDateRowId = null;
        return;
      }
      // 值未变化，直接退出
      if (row._editDate === row.record_date) {
        this.editingDateRowId = null;
        return;
      }
      const oldDate = row.record_date;
      this.editingDateRowId = null;
      try {
        await API.put(`/${this.dept}/records/${row.id}`, { record_date: row._editDate });
        row.record_date = row._editDate;
        // 本地重排，行立即移到新日期对应位置
        this.tableData = this.sortRecords(this.tableData);
      } catch (err) {
        row.record_date = oldDate; // 失败恢复原值
        ElementPlus.ElMessage.error('保存日期失败: ' + (err.message || '未知错误'));
      }
    },
    cancelEditDate(row) {
      // 仅在未保存的情况下关闭编辑态（@change 已保存时，此处为 no-op）
      this.editingDateRowId = null;
    },
```

### 3.4 浏览器验证

- [ ] 重启服务
- [ ] 点击某行日期，出现日期选择器
- [ ] 改为更大的日期（如 28 日），行立即移到正确位置
- [ ] 清空日期直接点其他地方，提示"日期为必填项"，原值恢复
- [ ] 网络断开后修改日期，提示"保存日期失败"，原值恢复

### 3.5 提交

```bash
git add public/js/app.js
git commit -m "feat: 日期列支持行内编辑，保存后立即重排位置"
```

---

## Task 4：车间列行内编辑（含区域分组下拉）

**Files:**
- Modify: `public/js/app.js`

**注意：本 Task 的步骤顺序不可颠倒**——必须先在 `workshopList` 里加入 `sort_order` 字段（步骤 4.1），再写用到 `found.sort_order` 的 `saveWorkshop` 方法（步骤 4.3）。

### 4.1 workshopList 补充 sort_order 字段

- [ ] 找到（约第 484 行）`loadWorkshops` 中的映射：
```javascript
        this.workshopList = (res.data || res || []).map(w => ({ id: w.id, name: w.name, region: w.region, company: w.company }));
```
改为（加上 `sort_order`）：
```javascript
        this.workshopList = (res.data || res || []).map(w => ({ id: w.id, name: w.name, region: w.region, company: w.company, sort_order: w.sort_order }));
```

### 4.2 新增 computed workshopGroups

- [ ] 在 `app.js` 中找到已有的 `computed` 块（约第 451 行，里面有 `columns()` 和 `editableColumns()`）。**在该块内部**追加 `workshopGroups` 属性，不要创建新的 `computed:` 块（否则会覆盖 `columns` 和 `editableColumns`）。

找到 `computed` 块中最后一个属性的结尾 `},`，在其后追加：

```javascript
    workshopGroups() {
      // 按区域分组展示：清溪在前，湖南在后
      const groups = {};
      for (const w of this.workshopList) {
        const region = w.region || '其他';
        if (!groups[region]) groups[region] = [];
        groups[region].push(w);
      }
      const order = ['清溪', '湖南'];
      return order
        .filter(r => groups[r])
        .map(r => ({ label: r, options: groups[r] }))
        .concat(
          Object.keys(groups)
            .filter(r => !order.includes(r))
            .map(r => ({ label: r, options: groups[r] }))
        );
    },
```

### 4.3 新增车间编辑方法

- [ ] 在 `methods` 里 `cancelEditDate` 下面，新增三个方法：

```javascript
    startEditWorkshop(row) {
      row._editWorkshopId = row.workshop_id;
      this.editingWorkshopRowId = row.id;
    },
    async saveWorkshop(row) {
      // 必填校验
      if (!row._editWorkshopId) {
        ElementPlus.ElMessage.warning('车间为必填项，不能清空');
        row._editWorkshopId = row.workshop_id;
        this.editingWorkshopRowId = null;
        return;
      }
      // 值未变化，直接退出
      if (row._editWorkshopId === row.workshop_id) {
        this.editingWorkshopRowId = null;
        return;
      }
      const oldId = row.workshop_id;
      const oldName = row.workshop_name;
      const oldSortOrder = row.workshop_sort_order;
      this.editingWorkshopRowId = null;
      try {
        await API.put(`/${this.dept}/records/${row.id}`, { workshop_id: row._editWorkshopId });
        // PUT 接口不返回 workshop_name/sort_order，从本地 workshopList 查找
        // workshopList 在 Task 4.1 中已加入 sort_order 字段
        const found = this.workshopList.find(w => w.id === row._editWorkshopId);
        if (found) {
          row.workshop_id = found.id;
          row.workshop_name = found.name;
          row.workshop_sort_order = found.sort_order ?? 99;
        }
        // 本地重排
        this.tableData = this.sortRecords(this.tableData);
      } catch (err) {
        row.workshop_id = oldId;
        row.workshop_name = oldName;
        row.workshop_sort_order = oldSortOrder;
        ElementPlus.ElMessage.error('保存车间失败: ' + (err.message || '未知错误'));
      }
    },
    cancelEditWorkshop(row) {
      this.editingWorkshopRowId = null;
    },
```

### 4.4 替换车间列模板

- [ ] 找到（约第 328 行）：
```html
          <el-table-column prop="workshop_name" label="车间" width="80" fixed="left" />
```
替换为：
```html
          <el-table-column prop="workshop_name" label="车间" width="95" fixed="left">
            <template #default="{ row }">
              <el-select
                v-if="editingWorkshopRowId === row.id"
                v-model="row._editWorkshopId"
                size="small"
                style="width:83px"
                @change="saveWorkshop(row)"
                @blur="cancelEditWorkshop(row)"
              >
                <el-option-group
                  v-for="group in workshopGroups"
                  :key="group.label"
                  :label="group.label"
                >
                  <el-option
                    v-for="w in group.options"
                    :key="w.id"
                    :label="w.name"
                    :value="w.id"
                  />
                </el-option-group>
              </el-select>
              <span
                v-else
                @click="startEditWorkshop(row)"
                style="cursor:pointer;display:block;padding:2px 4px"
              >{{ row.workshop_name }}</span>
            </template>
          </el-table-column>
```

### 4.5 浏览器验证

- [ ] 重启服务
- [ ] 点击某行车间，出现**分区域**下拉（清溪一组 / 湖南一组）
- [ ] 改为其他车间，行移动到新车间对应位置
- [ ] 在印喷部、装配部分别验证上述行为一致
- [ ] 装配部确认华嘉出现在下拉列表（如数据库已有该车间）

### 4.6 提交

```bash
git add public/js/app.js
git commit -m "feat: 车间列支持行内编辑，下拉按清溪/湖南区域分组展示"
```

---

## 验收检查清单

全部 Task 完成后，逐项验证：

- [ ] 编辑啤机部某行任意数字，行位置不变
- [ ] 新增行（选5月15日），行出现在14日和16日之间
- [ ] 三个部门均不显示序号列
- [ ] 点击日期弹出日期选择器，改日期后行立即移到正确位置
- [ ] 点击车间弹出分组下拉，改车间后行立即重排
- [ ] 清空日期/车间不允许保存，弹提示
- [ ] API 失败时原值恢复
- [ ] 后端集成测试全部通过：`npx jest tests/detail-sort-edit.test.js --no-coverage`

---

*计划创建时间：2026-03-21（v2 — 修复4个关键问题：record_date字段名、Task 4步骤顺序、computed块合并、pool.end移除）*
*关联设计文档：docs/superpowers/specs/2026-03-21-detail-table-sort-and-edit-design.md*
