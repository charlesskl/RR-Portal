// tests/bug-fixes.test.js
// Phase 1 BUG 回归测试 + 三部门基础 CRUD 测试
// Wave 0: RED 状态骨架 — 测试应当失败，证明 BUG 确实存在

const request = require('supertest');
const app = require('../server');
const { getAll, query } = require('../db/postgres');
const fs = require('fs');
const path = require('path');

// 测试用的唯一日期标识，方便清理
const TEST_DATE = '2099-01-01';
const TEST_WORKSHOP_NAME = '测试车间2099';
let token = '';

// 获取 JWT token（所有需要认证的测试都依赖此 token）
beforeAll(async () => {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ username: 'RRxing', password: 'RRxing963' });
  token = res.body.token;
});

// 清理所有测试数据
afterAll(async () => {
  try {
    // 清理测试记录
    await query(`DELETE FROM beer_records WHERE record_date = ?`, [TEST_DATE]);
    await query(`DELETE FROM print_records WHERE record_date = ?`, [TEST_DATE]);
    await query(`DELETE FROM assembly_records WHERE record_date = ?`, [TEST_DATE]);
    // 清理测试车间
    await query(`DELETE FROM workshops WHERE name = ?`, [TEST_WORKSHOP_NAME]);
    // 清理测试锁定记录
    await query(`DELETE FROM data_locks WHERE lock_month = ?`, ['2099-01']);
  } catch (e) {
    // 忽略清理错误
  }
  // 关闭数据库连接池
  const pool = require('../db/postgres').pool;
  if (pool && pool.end) await pool.end();
});

// ===== BUG 回归测试 =====
describe('BUG 回归测试', () => {

  // BUG-01: DELETE /api/beer/records/batch 不被 /:id 拦截
  test('BUG-01: DELETE /api/beer/records/batch 不被 /:id 拦截', async () => {
    const res = await request(app)
      .delete('/api/beer/records/batch')
      .set('Authorization', `Bearer ${token}`)
      .send({ ids: [] });
    // 路由顺序正确时应返回 400（空 ids）而非 404（被 /:id 拦截）
    expect(res.status).not.toBe(404);
  });

  // BUG-02: GET /api/beer/records 返回 workshop_name 字段
  test('BUG-02: GET /api/beer/records 返回 workshop_name 字段', async () => {
    const res = await request(app)
      .get('/api/beer/records')
      .set('Authorization', `Bearer ${token}`);
    expect(res.body.success).toBe(true);
    // 如果有数据，检查 workshop_name 字段存在
    if (res.body.data && res.body.data.length > 0) {
      expect(res.body.data[0]).toHaveProperty('workshop_name');
    }
  });

  // BUG-03: POST /api/workshops 保存 company 字段
  test('BUG-03: POST /api/workshops 保存 company 字段', async () => {
    // 创建带 company 的测试车间
    const createRes = await request(app)
      .post('/api/workshops')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: TEST_WORKSHOP_NAME,
        region: '清溪',
        department: 'beer',
        company: '测试公司',
        sort_order: 99
      });
    expect(createRes.body.success).toBe(true);
    const workshopId = createRes.body.data.id;

    // 查询该车间，验证 company 字段有值
    const getRes = await request(app)
      .get('/api/workshops')
      .set('Authorization', `Bearer ${token}`);
    const found = getRes.body.data.find(w => w.id === workshopId);
    expect(found).toBeDefined();
    expect(found.company).toBe('测试公司');
  });

  // BUG-04: POST /api/settings/data-locks 接受 department 字段
  test('BUG-04: POST /api/settings/data-locks 接受 department 字段', async () => {
    const res = await request(app)
      .post('/api/settings/data-locks')
      .set('Authorization', `Bearer ${token}`)
      .send({ department: 'beer', lock_month: '2099-01' });
    // 字段名匹配时应能正常处理（200 或 400），不应返回 500
    expect(res.status).not.toBe(500);
  });

  // BUG-05: GET /api/beer/records/summary 返回独有费用字段（现在路由是 /api/beer/summary）
  test('BUG-05: GET /api/beer/summary 返回独有费用字段', async () => {
    const res = await request(app)
      .get('/api/beer/summary')
      .set('Authorization', `Bearer ${token}`)
      .query({ start_date: '2020-01-01', end_date: '2099-12-31' });
    expect(res.body.success).toBe(true);
    // 如果有数据，检查是否包含啤机部独有费用字段 machine_repair
    if (res.body.data && res.body.data.length > 0) {
      expect(res.body.data[0]).toHaveProperty('machine_repair');
    }
  });

  // BUG-06: init.sql 包含 workshops 表 company 列
  test('BUG-06: init.sql 包含 workshops 表 company 列', () => {
    const initSql = fs.readFileSync(
      path.join(__dirname, '..', 'db', 'init.sql'),
      'utf8'
    );
    // 检查 workshops 表定义中是否包含 company
    expect(initSql).toContain('company');
  });

  // BUG-07: GET /api/settings/data-locks 返回 locked_by_name 字段
  test('BUG-07: GET /api/settings/data-locks 返回 locked_by_name 字段', async () => {
    const res = await request(app)
      .get('/api/settings/data-locks')
      .set('Authorization', `Bearer ${token}`);
    expect(res.body.success).toBe(true);
    // 如果有锁定数据，检查 locked_by_name 字段
    if (res.body.data && res.body.data.length > 0) {
      expect(res.body.data[0]).toHaveProperty('locked_by_name');
    }
  });

  // BUG-11: workshops 中 department=NULL 的记录不导致查询错误
  test('BUG-11: workshops 中 department=NULL 的记录不导致查询错误', async () => {
    const res = await request(app)
      .get('/api/workshops')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  // BUG-12: Excel 导入后数据存在于数据库
  test('BUG-12: Excel 导入后数据存在于数据库', async () => {
    const XLSX = require('xlsx');

    // 构造一个最小的 Excel buffer（啤机部格式）
    const wb = XLSX.utils.book_new();
    const wsData = [
      ['日期', '车间', '管工人数', '员工人数', '总产值/天'],
      [TEST_DATE, '兴信A', 2, 50, 10000]
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    // 上传 Excel
    const importRes = await request(app)
      .post('/api/beer/import')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', buffer, 'test-import.xlsx');

    // 导入应该成功（不报 500 错误）
    expect(importRes.status).not.toBe(500);

    // 查询导入的数据是否存在
    const records = await getAll(
      `SELECT * FROM beer_records WHERE record_date = ?`,
      [TEST_DATE]
    );
    expect(records.length).toBeGreaterThan(0);
  });
});

// ===== 三部门基础 CRUD 测试 =====
describe('三部门基础 CRUD', () => {
  const depts = ['beer', 'print', 'assembly'];

  for (const dept of depts) {
    describe(`${dept} 部门 CRUD`, () => {
      let recordId;
      let workshopId;

      // 获取该部门第一个车间的 ID
      beforeAll(async () => {
        const workshops = await getAll(
          `SELECT id FROM workshops WHERE department = ? ORDER BY sort_order LIMIT 1`,
          [dept]
        );
        workshopId = workshops[0]?.id;
      });

      test(`POST 创建一条 ${dept} 记录`, async () => {
        expect(workshopId).toBeDefined();
        const res = await request(app)
          .post(`/api/${dept}/records`)
          .set('Authorization', `Bearer ${token}`)
          .send({
            record_date: TEST_DATE,
            workshop_id: workshopId,
            daily_output: 10000,
            worker_count: 50,
            supervisor_count: 2,
            worker_wage: 5000,
            supervisor_wage: 500
          });
        expect(res.body.success).toBe(true);
        expect(res.body.data).toHaveProperty('id');
        recordId = res.body.data.id;
      });

      test(`GET 查询 ${dept} 记录存在`, async () => {
        const res = await request(app)
          .get(`/api/${dept}/records`)
          .set('Authorization', `Bearer ${token}`)
          .query({ start_date: TEST_DATE, end_date: TEST_DATE });
        expect(res.body.success).toBe(true);
        const found = res.body.data.find(r => r.id === recordId);
        expect(found).toBeDefined();
      });

      test(`PUT 更新 ${dept} 记录`, async () => {
        const res = await request(app)
          .put(`/api/${dept}/records/${recordId}`)
          .set('Authorization', `Bearer ${token}`)
          .send({ daily_output: 20000 });
        expect(res.body.success).toBe(true);
        expect(Number(res.body.data.daily_output)).toBe(20000);
      });

      test(`DELETE 删除 ${dept} 记录`, async () => {
        const res = await request(app)
          .delete(`/api/${dept}/records/${recordId}`)
          .set('Authorization', `Bearer ${token}`);
        expect(res.body.success).toBe(true);
      });
    });
  }
});
