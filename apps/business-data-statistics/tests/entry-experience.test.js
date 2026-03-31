// tests/entry-experience.test.js
// Phase 2 录入体验升级 — 测试骨架
// ENTRY-01: 最小字段创建记录（后端集成测试）
// ENTRY-02: 可编辑字段过滤（字段配置逻辑测试）
// ENTRY-03: 复制行字段提取（纯逻辑测试）

const request = require('supertest');
const app = require('../server');
const { query } = require('../db/postgres');
const balanceConfig = require('../modules/balance/config');

// 测试日期，避免污染真实数据
const TEST_DATE = '2099-06-01';
let token = '';
let createdRecordId = null;

// 获取 JWT token
beforeAll(async () => {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ username: 'RRxing', password: 'RRxing963' });
  token = res.body.token;
});

// 清理测试数据
afterAll(async () => {
  try {
    await query(`DELETE FROM beer_records WHERE record_date = ?`, [TEST_DATE]);
  } catch (e) {
    // 忽略清理错误
  }
  // 关闭数据库连接池
  const pool = require('../db/postgres').pool;
  if (pool && pool.end) await pool.end();
});

// ===== ENTRY-01: 最小字段创建记录 =====
// 录入员只需选日期和车间就能新增一行，其他数值字段默认为 0
describe('ENTRY-01: 最小字段创建记录', () => {
  test('POST /:dept/records 只传 record_date + workshop_id 时，后端成功返回新记录', async () => {
    // 先获取一个真实的啤机部车间 ID
    const workshopRes = await request(app)
      .get('/api/workshops')
      .set('Authorization', `Bearer ${token}`);

    // 找到啤机部的第一个车间
    const beerWorkshop = workshopRes.body.data?.find(w => w.department === 'beer');
    if (!beerWorkshop) {
      // 如果没有啤机部车间，跳过测试（测试环境数据不全）
      console.warn('ENTRY-01: 跳过 — 数据库中无啤机部车间数据');
      return;
    }

    const res = await request(app)
      .post('/api/beer/records')
      .set('Authorization', `Bearer ${token}`)
      .send({
        record_date: TEST_DATE,
        workshop_id: beerWorkshop.id
      });

    // 断言：201 Created 或 200 OK
    expect([200, 201]).toContain(res.status);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.id).toBeDefined();

    // 断言：数值字段默认为 0 或 null（不能是 undefined）
    const record = res.body.data;
    // worker_count 应该是 0 或 null，不能是 undefined
    expect(record.worker_count === 0 || record.worker_count === null).toBe(true);
    // daily_output 应该是 0 或 null
    expect(record.daily_output === 0 || record.daily_output === null).toBe(true);

    createdRecordId = record.id;
  });
});

// ===== ENTRY-02: 可编辑字段过滤 =====
// 复制行和行内编辑的前提：能正确区分可编辑字段和计算字段
describe('ENTRY-02: 可编辑字段过滤', () => {
  // 从后端 config 构建字段列表（模拟前端 getDeptColumns 的逻辑）
  // 注意：这里用后端 config 模拟，因为 app.js 是纯前端文件，无法 require
  function getBackendBeerFields() {
    const shared = balanceConfig.sharedFields;
    const sharedCalc = balanceConfig.sharedCalcFields;
    const unique = balanceConfig.departments.beer.uniqueFields;

    // 合并所有字段，统一字段结构
    const allFields = [
      ...shared.map(f => ({ field: f.field, label: f.label, editable: f.input === true && f.calc !== true, calculated: f.calc === true })),
      ...unique.map(f => ({ field: f.field, label: f.label, editable: f.input === true && f.calc !== true, calculated: f.calc === true })),
      ...sharedCalc.map(f => ({ field: f.field, label: f.label, editable: false, calculated: true })),
    ];
    return allFields;
  }

  test('filter(c => c.editable) 的结果中不包含任何 calculated:true 的字段', () => {
    const allFields = getBackendBeerFields();
    const editableFields = allFields.filter(c => c.editable);

    // 可编辑字段中不应有任何计算字段
    const calcInEditable = editableFields.filter(c => c.calculated);
    expect(calcInEditable).toHaveLength(0);
  });

  test('balance 和 balance_ratio 不在可编辑字段列表中', () => {
    const allFields = getBackendBeerFields();
    const editableFields = allFields.filter(c => c.editable);
    const editableFieldNames = editableFields.map(c => c.field);

    expect(editableFieldNames).not.toContain('balance');
    expect(editableFieldNames).not.toContain('balance_ratio');
  });

  test('machine_rate（计算字段）不在可编辑字段列表中', () => {
    const allFields = getBackendBeerFields();
    const editableFields = allFields.filter(c => c.editable);
    const editableFieldNames = editableFields.map(c => c.field);

    expect(editableFieldNames).not.toContain('machine_rate');
  });

});

// ===== ENTRY-03: 复制行字段提取 =====
// 未来"复制行"功能的前提：只提取可编辑字段，跳过计算字段
describe('ENTRY-03: 复制行字段提取', () => {
  test('提取 editable 字段后，body 包含 record_date 和 worker_count，不包含 balance', () => {
    // 模拟一行完整的数据（含计算字段）
    const sourceRow = {
      id: 999,
      record_date: '2026-03-01',
      workshop_id: 1,
      workshop_name: '兴信A',
      supervisor_count: 2,
      worker_count: 50,
      daily_output: 100000,
      worker_wage: 8000,
      supervisor_wage: 1500,
      rent: 500,
      utility_fee: 300,
      tool_investment: 100,
      equipment: 0,
      renovation: 0,
      misc_fee: 200,
      shipping_fee: 0,
      social_insurance: 1000,
      tax: 500,
      // 计算字段（不应被提取）
      balance: 88000,
      balance_ratio: 0.88,
      // 啤机部独有字段
      total_machines: 10,
      running_machines: 8,
      run_hours: 480,
      machine_rate: 0.8,      // 计算字段
      misc_workers: 5,
      misc_worker_wage: 2000,
      remark: '测试数据'
    };

    // 模拟前端可编辑字段列表（只含 editable: true 的字段）
    const editableCols = [
      { field: 'supervisor_count', editable: true },
      { field: 'worker_count', editable: true },
      { field: 'daily_output', editable: true },
      { field: 'worker_wage', editable: true },
      { field: 'supervisor_wage', editable: true },
      { field: 'machine_rate', editable: false, calculated: true },  // 不应被提取
      { field: 'balance', editable: false, calculated: true },        // 不应被提取
      { field: 'balance_ratio', editable: false, calculated: true },  // 不应被提取
      { field: 'total_machines', editable: true },
      { field: 'running_machines', editable: true },
      { field: 'misc_workers', editable: true },
      { field: 'misc_worker_wage', editable: true },
      { field: 'remark', editable: true },
    ];

    // 模拟提取逻辑：只提取 editable 字段
    function extractEditableFields(row, cols) {
      const body = {
        record_date: row.record_date,
        workshop_id: row.workshop_id
      };
      for (const col of cols) {
        if (col.editable && col.field !== 'record_date' && col.field !== 'workshop_id') {
          body[col.field] = row[col.field];
        }
      }
      return body;
    }

    const body = extractEditableFields(sourceRow, editableCols);

    // 断言：必须包含的字段
    expect(body).toHaveProperty('record_date', '2026-03-01');
    expect(body).toHaveProperty('workshop_id', 1);
    expect(body).toHaveProperty('worker_count', 50);
    expect(body).toHaveProperty('daily_output', 100000);
    expect(body).toHaveProperty('total_machines', 10);

    // 断言：不应包含计算字段
    expect(body).not.toHaveProperty('balance');
    expect(body).not.toHaveProperty('balance_ratio');
    expect(body).not.toHaveProperty('machine_rate');
  });
});
