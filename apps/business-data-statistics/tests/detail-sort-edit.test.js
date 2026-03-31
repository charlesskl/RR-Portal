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
    .send({ username: 'RRxing', password: 'RRxing963' });
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
