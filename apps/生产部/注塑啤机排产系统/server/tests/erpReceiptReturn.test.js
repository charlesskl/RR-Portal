const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paiji-erp-return-'));
process.env.DATA_PATH = dataDir;
process.env.ERP_RECEIPT_RETURN_TOKEN = 'p89-local-test-server-key';
process.env.WS_AT_PASS = 'p89-local-workshop-pass';
const { initDatabase } = require('../db/init');
const db = require('../db/connection');
const { signSession } = require('../services/erpReceiptAuth');
initDatabase();
const app = express();
app.use(express.json());
app.use('/api/auth', require('../routes/auth'));
app.use('/api/orders', require('../routes/orders'));
app.use('/api/warehouse-orders', require('../routes/warehouseOrders'));
app.use((error, req, res, next) => res.status(500).json({ message: error.message }));
let server;
let origin;
test.before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  await new Promise(resolve => server.close(resolve));
  db.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});
async function request(route, body, method = 'POST', auth = 'server') {
  const headers = { 'Content-Type': 'application/json' };
  if (auth === 'server') headers['X-ERP-Token'] = process.env.ERP_RECEIPT_RETURN_TOKEN;
  else if (auth) headers['X-Paiji-Session'] = auth;
  const response = await fetch(origin + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}
const api = '/api/warehouse-orders';
function seed({ count = 2, workshop = 'AT' } = {}) {
  const insert = db.prepare(`INSERT INTO pi_warehouse_orders(delivery_date,delivery_code,order_no,mold_no,part_name,color,color_powder_no,
    order_qty,delivery_pcs,cavity,delivery_shots,material_type,notes,workshop,status,unit_price,amount)
    VALUES('2026-10-28','P89-DEL','P89-MO','P89-SKU','P89-MOLD','紫','P89-POWDER',100,60,'6',10,'P89-RAW','ERP:P89-SP',?,'checked-in',2,20)`);
  const ids = Array.from({ length: count }, () => Number(insert.run(workshop).lastInsertRowid));
  return { request_id: crypto.randomUUID(), erp_receipt_no: 'P89-SR-' + ids[0], round: 1, workshop, reason: '实收数量需核对', ids };
}
const row = id => db.prepare('SELECT * FROM pi_warehouse_orders WHERE id=?').get(id);
const events = token => db.prepare('SELECT * FROM erp_receipt_review_events WHERE request_id=? ORDER BY id').all(token);
const submitDto = (group, revision = 0) => ({ request_id: group.request_id, erp_receipt_no: group.erp_receipt_no,
  round: group.round, workshop: group.workshop, ids: group.ids, submission_revision: revision,
  rows: group.ids.map(id => ({ id, delivery_pcs: 120, delivery_shots: 20 })) });
const reopenDto = (group, revision = 1) => ({ ...group, submission_revision: revision, reason: 'ERP订单可入仓额度不足，请核对' });

test('整组打回和原请求重试幂等，保留原行身份、数量、状态', async () => {
  const group = seed();
  const originals = group.ids.map(row);
  const first = await request(`${api}/_/erp-return`, group);
  assert.equal(first.status, 200);
  assert.equal(first.body.status, 'returned');
  assert.equal(first.body.submission_revision, 0);
  assert.deepEqual(first.body.ids, group.ids);
  assert.equal((await request(`${api}/_/erp-return`, group)).status, 200);
  assert.equal(events(group.request_id).length, 1);
  for (const [index, id] of group.ids.entries()) {
    const saved = row(id);
    for (const field of ['id','workshop','delivery_code','order_no','mold_no','part_name','color','color_powder_no','delivery_pcs','delivery_shots','cavity','notes','unit_price','status'])
      assert.equal(saved[field], originals[index][field], field);
    assert.equal(saved.erp_return_token, group.request_id);
    assert.equal(saved.erp_receipt_no, group.erp_receipt_no);
  }
});
test('真实登录签发车间session，legacy或伪造session不能修改ERP单', async () => {
  const group = seed();
  await request(`${api}/_/erp-return`, group);
  const login = await request('/api/auth/login', { workshop: 'AT', password: process.env.WS_AT_PASS }, 'POST', null);
  assert.equal(login.status, 200);
  assert.match(login.body.token, /^v2\./);
  const target = `${api}/${group.ids[0]}`;
  const values = { delivery_pcs: 30, delivery_shots: 5 };
  const legacy = Buffer.from('AT:' + Date.now()).toString('base64');
  assert.equal((await request(target, values, 'PUT', legacy)).status, 401);
  assert.equal((await request(target, values, 'PUT', login.body.token + 'x')).status, 401);
  assert.equal((await request(target, values, 'PUT', signSession('A'))).status, 403);
  assert.equal((await request(target, values, 'PUT', login.body.token)).status, 200);
  assert.equal(row(group.ids[0]).delivery_pcs, 30);
});
test('错误服务端密钥、缺配置、跨车间或未知行均整组不变', async () => {
  const group = seed();
  const before = JSON.stringify(group.ids.map(row));
  assert.equal((await request(`${api}/_/erp-return`, group, 'POST', 'bad')).status, 401);
  const secret = process.env.ERP_RECEIPT_RETURN_TOKEN;
  delete process.env.ERP_RECEIPT_RETURN_TOKEN;
  assert.equal((await request(`${api}/_/erp-return`, group)).status, 503);
  process.env.ERP_RECEIPT_RETURN_TOKEN = secret;
  assert.equal((await request(`${api}/_/erp-return`, { ...group, workshop: 'A' })).status, 409);
  assert.equal((await request(`${api}/_/erp-return`, { ...group, ids: [...group.ids, 99999999] })).status, 409);
  assert.equal(JSON.stringify(group.ids.map(row)), before);
  assert.equal(events(group.request_id).length, 0);
});
test('同token不同请求、重复ID、非法轮次或未确认入库不能打回', async () => {
  const group = seed();
  assert.equal((await request(`${api}/_/erp-return`, { ...group, round: 2 })).status, 409);
  assert.equal((await request(`${api}/_/erp-return`, { ...group, ids: [group.ids[0], group.ids[0]] })).status, 400);
  db.prepare("UPDATE pi_warehouse_orders SET status='pending' WHERE id=?").run(group.ids[1]);
  assert.equal((await request(`${api}/_/erp-return`, group)).status, 409);
  assert.equal(row(group.ids[0]).erp_return_token, null);
  db.prepare("UPDATE pi_warehouse_orders SET status='checked-in' WHERE id=?").run(group.ids[1]);
  await request(`${api}/_/erp-return`, group);
  assert.equal((await request(`${api}/_/erp-return`, { ...group, reason: '改过的原因' })).status, 409);
});
test('不能修改来源、腔数、token、revision、状态，不能删除或撤回', async () => {
  const group = seed();
  await request(`${api}/_/erp-return`, group);
  const before = JSON.stringify(group.ids.map(row));
  for (const field of ['notes','mold_no','material_name','cavity','erp_return_token','erp_submission_revision','status','workshop']) {
    const response = await request(`${api}/${group.ids[0]}`, { delivery_pcs: 30, [field]: '伪造' }, 'PUT', signSession('AT'));
    assert.equal(response.status, 409, field);
  }
  assert.equal((await request(`${api}/${group.ids[0]}`, undefined, 'DELETE')).status, 409);
  assert.equal((await request(`${api}/${group.ids[0]}/check-in`, { undo: true })).status, 409);
  assert.equal(JSON.stringify(group.ids.map(row)), before);
});
test('整组重提原子保存件数/啤数和独立金额，重试不增加版本', async () => {
  const group = seed();
  await request(`${api}/_/erp-return`, group);
  const dto = submitDto(group);
  const result = await request(`${api}/_/erp-resubmit`, dto, 'POST', signSession('AT'));
  assert.equal(result.status, 200);
  assert.equal(result.body.status, 'resubmitted');
  assert.equal(result.body.submission_revision, 1);
  for (const id of group.ids) {
    assert.equal(row(id).delivery_pcs, 120);
    assert.equal(row(id).delivery_shots, 20);
    assert.equal(row(id).amount, 40);
    assert.equal(row(id).erp_review_status, 'resubmitted');
    assert.equal(row(id).status, 'checked-in');
  }
  assert.equal((await request(`${api}/_/erp-resubmit`, dto, 'POST', signSession('AT'))).status, 200);
  assert.equal(events(group.request_id).length, 2);
  assert.equal((await request(`${api}/${group.ids[0]}`, { delivery_pcs: 1, delivery_shots: 1 }, 'PUT', signSession('AT'))).status, 409);
  assert.equal((await request(`${api}/_/erp-return`, group)).body.status, 'resubmitted');
});
test('部分重提、非法数量、跨车间重提整笔回滚，无身份或数量泄漏', async () => {
  const group = seed();
  await request(`${api}/_/erp-return`, group);
  const before = JSON.stringify(group.ids.map(row));
  const dto = submitDto(group);
  assert.equal((await request(`${api}/_/erp-resubmit`, { ...dto, rows: dto.rows.slice(0, 1) }, 'POST', signSession('AT'))).status, 400);
  const invalid = { ...dto, rows: [dto.rows[0], { ...dto.rows[1], delivery_pcs: 1.5 }] };
  assert.equal((await request(`${api}/_/erp-resubmit`, invalid, 'POST', signSession('AT'))).status, 400);
  assert.equal((await request(`${api}/_/erp-resubmit`, dto, 'POST', signSession('B'))).status, 403);
  assert.equal(JSON.stringify(group.ids.map(row)), before);
});
test('数据库中途失败整组回滚，重复并发请求只记录一次送审', async () => {
  const group = seed();
  await request(`${api}/_/erp-return`, group);
  const before = JSON.stringify(group.ids.map(row));
  db.exec(`CREATE TRIGGER p89_injected_failure BEFORE UPDATE ON pi_warehouse_orders
    WHEN NEW.id=${group.ids[1]} AND NEW.erp_review_status='resubmitted'
    BEGIN SELECT RAISE(ABORT, 'p89 test rollback'); END;`);
  try {
    assert.equal((await request(`${api}/_/erp-resubmit`, submitDto(group), 'POST', signSession('AT'))).status, 500);
    assert.equal(JSON.stringify(group.ids.map(row)), before);
    assert.equal(events(group.request_id).length, 1);
  } finally { db.exec('DROP TRIGGER p89_injected_failure'); }
  const results = await Promise.all(Array.from({ length: 3 }, () => request(`${api}/_/erp-resubmit`, submitDto(group), 'POST', signSession('AT'))));
  assert(results.every(result => result.status === 200));
  assert.equal(events(group.request_id).length, 2);
  assert.equal(row(group.ids[0]).erp_submission_revision, 1);
});
test('ERP拒绝重提按revision CAS解锁，迟到请求不能撤销新送审', async () => {
  const group = seed();
  await request(`${api}/_/erp-return`, group);
  await request(`${api}/_/erp-resubmit`, submitDto(group), 'POST', signSession('AT'));
  const rejection = reopenDto(group);
  assert.equal((await request(`${api}/_/erp-reopen`, rejection)).status, 200);
  assert.equal((await request(`${api}/_/erp-reopen`, rejection)).status, 200);
  assert.equal(row(group.ids[0]).erp_review_status, 'returned');
  assert.equal(row(group.ids[0]).erp_submission_revision, 1);
  assert.equal((await request(`${api}/_/erp-resubmit`, submitDto(group, 1), 'POST', signSession('AT'))).body.submission_revision, 2);
  assert.equal((await request(`${api}/_/erp-reopen`, rejection)).status, 409);
  assert.equal((await request(`${api}/_/erp-return`, group)).body.submission_revision, 2);
  assert.equal(row(group.ids[0]).erp_review_status, 'resubmitted');
  assert.equal(events(group.request_id).length, 4);
});
test('第二轮保留原行及第一轮历史，旧轮次不可覆盖新轮', async () => {
  const group = seed();
  await request(`${api}/_/erp-return`, group);
  const second = { ...group, request_id: crypto.randomUUID(), round: 2, reason: '第二轮核对' };
  assert.equal((await request(`${api}/_/erp-return`, second)).status, 409);
  await request(`${api}/_/erp-resubmit`, submitDto(group), 'POST', signSession('AT'));
  assert.equal((await request(`${api}/_/erp-return`, second)).status, 200);
  assert.equal((await request(`${api}/_/erp-reopen`, reopenDto(group))).status, 409);
  assert.equal(row(group.ids[0]).erp_return_token, second.request_id);
  assert.equal(row(group.ids[0]).delivery_pcs, 120);
  assert.equal(events(group.request_id).length, 2);
  assert.equal(events(second.request_id).length, 1);
  const list = await request(`${api}/_/erp-returns?workshop=AT`, undefined, 'GET', null);
  assert.equal(list.status, 200);
  const latest = list.body.filter(item => item.erp_receipt_no === group.erp_receipt_no);
  assert.equal(latest.length, 1);
  assert.equal(latest[0].request_id, second.request_id);
  assert.equal(latest[0].rows.length, group.ids.length);
});
test('不影响未接入ERP的普通手工单与单产物实收PCS/参考啤数', async () => {
  const ordinary = await request(api, { workshop: 'AT', status: 'pending', part_name: 'P89普通物料', delivery_pcs: 7 });
  assert.equal(ordinary.status, 200);
  const id = ordinary.body.id;
  assert.equal((await request(`${api}/${id}/check-in`, { undo: false })).status, 200);
  assert.equal((await request(`${api}/${id}/check-in`, { undo: true })).status, 200);
  assert.equal((await request(`${api}/${id}`, undefined, 'DELETE')).status, 200);
  assert.equal(row(id), undefined);
  const group = seed({ count: 1 });
  await request(`${api}/_/erp-return`, group);
  const dto = submitDto(group);
  dto.rows[0].delivery_pcs = 39;
  dto.rows[0].delivery_shots = null;
  assert.equal((await request(`${api}/_/erp-resubmit`, dto, 'POST', signSession('AT'))).status, 200);
  assert.equal(row(group.ids[0]).delivery_pcs, 39);
  assert.equal(row(group.ids[0]).delivery_shots, null);
  assert.equal(row(group.ids[0]).amount, null);
});
test('SQLite持久化升级幂等，重开仍保留待办和审核版本', () => {
  const group = seed();
  const { createErpReceiptReview, parseRequest } = require('../services/erpReceiptReview');
  createErpReceiptReview(db).returnReceipt(parseRequest(group, 'return'));
  initDatabase();
  const Database = require('better-sqlite3');
  const reopened = new Database(path.join(dataDir, 'paiji.db'));
  try {
    const result = createErpReceiptReview(reopened).list('AT').find(item => item.request_id === group.request_id);
    assert.equal(result.status, 'returned');
    assert.equal(result.rows.length, group.ids.length);
    assert.equal(result.reason, group.reason);
    assert.equal(result.submission_revision, 0);
  } finally { reopened.close(); }
});

test('独立物料名称从ERP任务保存、部分改名到完成订单选模，不改模号或数量', async () => {
  const names = 'P89铲子、P89猫砂盆';
  const created = await request('/api/orders', {
    workshop: 'AT', product_code: 'P89-SKU', mold_name: 'P89-EXACT-MOLD', mold_no: null,
    material_name: names, color: 'P89紫色', quantity_needed: 100, cavity: 6,
    status: 'completed', order_notes: 'ERP:P89-SP', serial_no: 'P89-01',
  });
  assert.equal(created.status, 200);
  const id = Number(created.body.id);
  const readOrder = () => db.prepare('SELECT * FROM orders WHERE id=?').get(id);
  assert.equal(readOrder().material_name, names);
  const before = readOrder();
  const renamed = names + '（已核对）';
  assert.equal((await request(`/api/orders/${id}`, { material_name: renamed }, 'PUT')).status, 200);
  assert.deepEqual({ ...readOrder(), material_name: names }, before);
  assert.equal((await request(`/api/orders/${id}`, { quantity_needed: 101 }, 'PUT')).status, 200);
  assert.equal(readOrder().material_name, renamed);
  const options = await request(`${api}/_/completed-orders?workshop=AT&keyword=${encodeURIComponent('猫砂盆')}`, undefined, 'GET', null);
  assert.equal(options.status, 200);
  assert.equal(options.body.length, 1);
  assert.equal(options.body[0].material_name, renamed);
  assert.equal(options.body[0].mold_name, 'P89-EXACT-MOLD');
  const receipt = await request(api, { workshop: 'AT', part_name: options.body[0].mold_name,
    material_name: options.body[0].material_name, delivery_pcs: 60, delivery_shots: 10, cavity: '6' });
  assert.equal(receipt.status, 200);
  assert.equal(receipt.body.part_name, 'P89-EXACT-MOLD');
  assert.equal(receipt.body.material_name, renamed);
  const detail = await request(`${api}/${receipt.body.id}`, undefined, 'GET', null);
  assert.equal(detail.body.material_name, renamed);
  const fullEdit = { ...detail.body, delivery_pcs: 66 };
  delete fullEdit.material_name; // An older caller does not erase new display metadata.
  const updated = await request(`${api}/${receipt.body.id}`, fullEdit, 'PUT');
  assert.equal(updated.status, 200);
  assert.equal(updated.body.material_name, renamed);
  assert.equal(updated.body.delivery_pcs, 66);
});
test('历史NULL名称不猜，普通人工物料名称可保存重开，非法输入在HTTP边界拦截', async () => {
  const created = await request('/api/orders', { workshop: 'AT', mold_name: 'P89-LEGACY-CODE', quantity_needed: 10 });
  assert.equal(created.status, 200);
  const legacy = db.prepare('SELECT material_name,mold_name FROM orders WHERE id=?').get(created.body.id);
  assert.deepEqual(legacy, { material_name: null, mold_name: 'P89-LEGACY-CODE' });
  const receipt = await request(api, { workshop: 'AT', part_name: 'P89手填模号', material_name: 'P89手填物料名称', delivery_pcs: 12 });
  assert.equal(receipt.status, 200);
  assert.equal((await request(`${api}/${receipt.body.id}`, undefined, 'GET', null)).body.material_name, 'P89手填物料名称');
  assert.equal((await request('/api/orders', { workshop: 'AT', material_name: { wrong: true } })).status, 400);
  assert.equal((await request(api, { workshop: 'AT', material_name: 'x'.repeat(4001) })).status, 400);
  assert.equal((await request(`/api/orders/${created.body.id}`, { material_name: null }, 'PUT')).status, 200);
  assert.equal(db.prepare('SELECT material_name FROM orders WHERE id=?').get(created.body.id).material_name, null);
});
test('已打回绑定行只补display名称：批量原子、可重试、来源数量与审核状态逐字段不变', async () => {
  const group = seed();
  await request(`${api}/_/erp-return`, group);
  await request(`${api}/_/erp-resubmit`, submitDto(group), 'POST', signSession('AT'));
  const before = group.ids.map(row);
  const payload = { workshop: 'AT', rows: group.ids.map((id, index) => ({ id, material_name: `P89真实成员${index}、P89另一个成员${index}` })) };
  const first = await request(`${api}/_/erp-material-names`, payload);
  assert.equal(first.status, 200);
  assert.deepEqual(first.body.ids, group.ids);
  assert.equal(first.body.updated, group.ids.length);
  for (const [index, id] of group.ids.entries()) {
    const saved = row(id);
    assert.equal(saved.material_name, payload.rows[index].material_name);
    assert.deepEqual({ ...saved, material_name: before[index].material_name }, before[index]);
  }
  const after = JSON.stringify(group.ids.map(row));
  assert.equal((await request(`${api}/_/erp-material-names`, payload)).status, 200);
  assert.equal(JSON.stringify(group.ids.map(row)), after);
  const todo = await request(`${api}/_/erp-returns?workshop=AT`, undefined, 'GET', null);
  assert.equal(todo.body.find(item => item.request_id === group.request_id).rows[0].material_name, payload.rows[0].material_name);
});
test('批量补名的未知ID、跨车间、额外qty字段、空名、重复ID和错误key均不留部分更新', async () => {
  const group = seed();
  const before = JSON.stringify(group.ids.map(row));
  const payload = { workshop: 'AT', rows: group.ids.map(id => ({ id, material_name: 'P89不应落库' })) };
  assert.equal((await request(`${api}/_/erp-material-names`, { ...payload, rows: [...payload.rows, { id: 999999, material_name: 'P89未知' }] })).status, 409);
  assert.equal((await request(`${api}/_/erp-material-names`, { ...payload, workshop: 'A' })).status, 409);
  assert.equal((await request(`${api}/_/erp-material-names`, { ...payload, rows: [{ ...payload.rows[0], delivery_pcs: 999 }] })).status, 400);
  assert.equal((await request(`${api}/_/erp-material-names`, { ...payload, rows: [{ id: group.ids[0], material_name: ' ' }] })).status, 400);
  assert.equal((await request(`${api}/_/erp-material-names`, { ...payload, rows: [payload.rows[0], payload.rows[0]] })).status, 400);
  assert.equal((await request(`${api}/_/erp-material-names`, { ...payload, rows: [{ id: group.ids[0], material_name: 'x'.repeat(1001) }] })).status, 400);
  assert.equal((await request(`${api}/_/erp-material-names`, payload, 'POST', 'bad')).status, 401);
  assert.equal(JSON.stringify(group.ids.map(row)), before);
});
