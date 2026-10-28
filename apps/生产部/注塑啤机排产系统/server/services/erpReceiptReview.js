const assert = require('node:assert/strict');

class ReviewError extends Error {
  constructor(message, status = 409) { super(message); this.status = status; }
}
const fail = message => { throw new ReviewError(message); };
const sameIds = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const now = () => new Date().toISOString();

// Schema upgrades are additive and keep every historic receipt untouched.
function initErpReceiptReview(db) {
  const existing = new Set(db.prepare('PRAGMA table_info(pi_warehouse_orders)').all().map(c => c.name));
  for (const [name, type] of Object.entries({
    erp_receipt_no: 'TEXT', erp_return_token: 'TEXT', erp_return_round: 'INTEGER',
    erp_review_status: 'TEXT', erp_return_reason: 'TEXT', erp_submission_revision: 'INTEGER',
  })) {
    if (!existing.has(name)) db.exec(`ALTER TABLE pi_warehouse_orders ADD COLUMN ${name} ${type}`);
  }
  db.exec(`CREATE TABLE IF NOT EXISTS erp_receipt_returns (
    request_id TEXT PRIMARY KEY, erp_receipt_no TEXT NOT NULL, round INTEGER NOT NULL,
    workshop TEXT NOT NULL, reason TEXT NOT NULL, ids_json TEXT NOT NULL,
    request_json TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('returned','resubmitted')),
    submission_revision INTEGER NOT NULL DEFAULT 0, submission_json TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    UNIQUE(erp_receipt_no, round)
  );
  CREATE TABLE IF NOT EXISTS erp_receipt_review_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, request_id TEXT NOT NULL,
    action TEXT NOT NULL, submission_revision INTEGER NOT NULL, payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );`);
}

// These validators run only at HTTP boundaries. Internal operations receive the
// canonical DTO, and use assertions for states that the database must guarantee.
function parseRequest(body, kind) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ReviewError('请求内容无效', 400);
  const keys = ['request_id', 'erp_receipt_no', 'round', 'workshop', 'ids'];
  if (kind !== 'resubmit') keys.push('reason');
  if (kind !== 'return') keys.push('submission_revision');
  if (kind === 'resubmit') keys.push('rows');
  if (Object.keys(body).some(k => !keys.includes(k))) throw new ReviewError('请求包含不支持的字段', 400);
  if (typeof body.request_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.request_id))
    throw new ReviewError('打回请求编号必须为UUID', 400);
  if (typeof body.erp_receipt_no !== 'string' || !body.erp_receipt_no.trim() || body.erp_receipt_no.length > 50)
    throw new ReviewError('ERP入仓单号无效', 400);
  if (!['A', 'AT', 'B', 'C', 'W'].includes(body.workshop) || !Number.isSafeInteger(body.round) || body.round < 1)
    throw new ReviewError('车间或打回轮次无效', 400);
  if (!Array.isArray(body.ids) || !body.ids.length || body.ids.length > 1000 ||
      body.ids.some(id => !Number.isSafeInteger(id) || id < 1) || new Set(body.ids).size !== body.ids.length)
    throw new ReviewError('必须提供整组唯一入库单ID', 400);
  const dto = { request_id: body.request_id.toLowerCase(), erp_receipt_no: body.erp_receipt_no.trim(),
    round: body.round, workshop: body.workshop, ids: [...body.ids].sort((a, b) => a - b) };
  if (kind !== 'resubmit') {
    if (typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length > 1000)
      throw new ReviewError('请填写1000字以内的打回原因', 400);
    dto.reason = body.reason.trim();
  }
  if (kind !== 'return') {
    if (!Number.isSafeInteger(body.submission_revision) || body.submission_revision < (kind === 'reopen' ? 1 : 0))
      throw new ReviewError('重新送审版本无效', 400);
    dto.submission_revision = body.submission_revision;
  }
  if (kind === 'resubmit') {
    if (!Array.isArray(body.rows) || body.rows.length !== dto.ids.length)
      throw new ReviewError('必须同时提交整组物料数量', 400);
    dto.rows = body.rows.map(row => {
      if (!row || typeof row !== 'object' || Object.keys(row).some(k => !['id', 'delivery_pcs', 'delivery_shots'].includes(k)) ||
          !Number.isSafeInteger(row.id)) throw new ReviewError('数量行包含不支持的字段', 400);
      return { id: row.id, ...parseQuantities(row) };
    }).sort((a, b) => a.id - b.id);
    if (!sameIds(dto.rows.map(r => r.id), dto.ids)) throw new ReviewError('提交数量必须对应整组入库单', 400);
  }
  return dto;
}
function parseQuantities(body) {
  if (!Number.isSafeInteger(body.delivery_pcs) || body.delivery_pcs < 1 || body.delivery_pcs > 2147483647)
    throw new ReviewError('实收件数必须为大于0的整数', 400);
  const shots = body.delivery_shots ?? null;
  if (shots !== null && (!Number.isSafeInteger(shots) || shots < 1 || shots > 2147483647))
    throw new ReviewError('送货啤数必须为大于0的整数或留空', 400);
  return { delivery_pcs: body.delivery_pcs, delivery_shots: shots };
}

function createErpReceiptReview(db) {
  const get = db.prepare('SELECT * FROM erp_receipt_returns WHERE request_id=?');
  const row = db.prepare('SELECT * FROM pi_warehouse_orders WHERE id=?');
  function result(group) {
    return { request_id: group.request_id, erp_receipt_no: group.erp_receipt_no, round: group.round,
      workshop: group.workshop, ids: JSON.parse(group.ids_json), status: group.status,
      submission_revision: group.submission_revision };
  }
  function event(group, action, payload) {
    db.prepare(`INSERT INTO erp_receipt_review_events(request_id,action,submission_revision,payload_json,created_at)
      VALUES(?,?,?,?,?)`).run(group.request_id, action, group.submission_revision, JSON.stringify(payload), now());
  }
  function groupRows(group) {
    const rows = JSON.parse(group.ids_json).map(id => row.get(id));
    assert(rows.every(Boolean), 'ERP group member must still exist');
    assert(rows.every(r => r.erp_return_token === group.request_id && r.erp_return_round === group.round && r.erp_submission_revision === group.submission_revision && r.erp_review_status === group.status), 'ERP group state must remain atomic');
    return rows;
  }
  function exactGroup(dto) {
    const group = get.get(dto.request_id);
    if (!group || group.erp_receipt_no !== dto.erp_receipt_no || group.workshop !== dto.workshop || group.round !== dto.round || !sameIds(JSON.parse(group.ids_json), dto.ids))
      fail('打回请求与当前完整单据不一致，请刷新后重试');
    if (dto.ids.some(id => row.get(id)?.erp_return_token !== group.request_id)) fail('该打回请求已被新轮次替代，请刷新');
    groupRows(group);
    return group;
  }
  const returnReceipt = db.transaction(dto => {
    const existing = get.get(dto.request_id);
    if (existing) {
      if (existing.request_json !== JSON.stringify(dto)) fail('同一打回请求不能更换单据、物料或原因');
      // A delayed first request must never reopen a newer submission.
      return result(existing);
    }
    const prior = db.prepare('SELECT * FROM erp_receipt_returns WHERE erp_receipt_no=? ORDER BY round DESC LIMIT 1').get(dto.erp_receipt_no);
    if (prior && (prior.status !== 'resubmitted' || dto.round !== prior.round + 1 || prior.workshop !== dto.workshop || !sameIds(JSON.parse(prior.ids_json), dto.ids)))
      fail('上一轮尚未重新送审，或新轮次/整组物料与原单不一致');
    if (!prior && dto.round !== 1) fail('首次打回必须从第1轮开始');
    const rows = dto.ids.map(id => row.get(id));
    if (rows.some(r => !r || r.workshop !== dto.workshop || r.status !== 'checked-in')) fail('入库单不存在、车间不一致或尚未送ERP');
    if (rows.some(r => !/^ERP:\S+/i.test((r.notes || '').trimStart()) || /^ERP:SR/i.test((r.notes || '').trimStart())))
      fail('只能打回有明确ERP采购来源的入库单');
    if (rows.some(r => r.erp_return_token && (!prior || r.erp_return_token !== prior.request_id))) fail('物料已属于其他ERP打回单');
    const time = now();
    db.prepare(`INSERT INTO erp_receipt_returns(request_id,erp_receipt_no,round,workshop,reason,ids_json,request_json,status,submission_revision,created_at,updated_at)
      VALUES(@request_id,@erp_receipt_no,@round,@workshop,@reason,@ids_json,@request_json,'returned',0,@time,@time)`)
      .run({ ...dto, ids_json: JSON.stringify(dto.ids), request_json: JSON.stringify(dto), time });
    const update = db.prepare(`UPDATE pi_warehouse_orders SET erp_receipt_no=?,erp_return_token=?,erp_return_round=?,erp_review_status='returned',erp_return_reason=?,erp_submission_revision=0,updated_at=? WHERE id=?`);
    for (const id of dto.ids) update.run(dto.erp_receipt_no, dto.request_id, dto.round, dto.reason, time, id);
    const group = get.get(dto.request_id);
    event(group, 'returned', dto);
    return result(group);
  });
  const reopen = db.transaction(dto => {
    const group = exactGroup(dto);
    if (group.submission_revision !== dto.submission_revision) fail('送审版本已变化，旧打回不能覆盖新版本');
    if (group.status === 'returned') {
      if (group.reason !== dto.reason) fail('同一拒绝版本的打回原因不一致');
      return result(group);
    }
    assert(group.status === 'resubmitted');
    const time = now();
    db.prepare(`UPDATE erp_receipt_returns SET status='returned',reason=?,updated_at=? WHERE request_id=?`).run(dto.reason, time, dto.request_id);
    db.prepare(`UPDATE pi_warehouse_orders SET erp_review_status='returned',erp_return_reason=?,updated_at=? WHERE erp_return_token=?`).run(dto.reason, time, dto.request_id);
    const updated = get.get(dto.request_id);
    event(updated, 'reopened', dto);
    return result(updated);
  });
  const resubmit = db.transaction(dto => {
    const group = exactGroup(dto);
    if (group.status === 'resubmitted' && group.submission_revision === dto.submission_revision + 1 && group.submission_json === JSON.stringify(dto.rows)) return result(group);
    if (group.status !== 'returned' || group.submission_revision !== dto.submission_revision) fail('该单已送审或版本已更新，请刷新');
    const revision = group.submission_revision + 1;
    const time = now();
    const update = db.prepare(`UPDATE pi_warehouse_orders SET delivery_pcs=?,delivery_shots=?,
      amount=CASE WHEN ? IS NOT NULL AND unit_price IS NOT NULL THEN ROUND(?*unit_price,2) ELSE NULL END,
      erp_review_status='resubmitted',erp_submission_revision=?,updated_at=? WHERE id=?`);
    for (const item of dto.rows) update.run(item.delivery_pcs, item.delivery_shots, item.delivery_shots, item.delivery_shots, revision, time, item.id);
    db.prepare(`UPDATE erp_receipt_returns SET status='resubmitted',submission_revision=?,submission_json=?,updated_at=? WHERE request_id=?`)
      .run(revision, JSON.stringify(dto.rows), time, dto.request_id);
    const updated = get.get(dto.request_id);
    event(updated, 'resubmitted', dto);
    return result(updated);
  });
  const updateQuantities = db.transaction((id, values) => {
    const current = row.get(id);
    assert(current?.erp_return_token);
    if (current.erp_review_status !== 'returned') fail('该单已重新送ERP审核，不能再修改数量');
    db.prepare(`UPDATE pi_warehouse_orders SET delivery_pcs=?,delivery_shots=?,
      amount=CASE WHEN ? IS NOT NULL AND unit_price IS NOT NULL THEN ROUND(?*unit_price,2) ELSE NULL END,updated_at=? WHERE id=?`)
      .run(values.delivery_pcs, values.delivery_shots, values.delivery_shots, values.delivery_shots, now(), id);
    event(get.get(current.erp_return_token), 'quantity-edited', { id, ...values });
    return row.get(id);
  });
  function list(workshop) {
    return db.prepare(`SELECT * FROM erp_receipt_returns r WHERE workshop=? AND round=(SELECT MAX(round) FROM erp_receipt_returns x WHERE x.erp_receipt_no=r.erp_receipt_no) ORDER BY updated_at DESC`).all(workshop)
      .map(group => ({ ...result(group), reason: group.reason, rows: groupRows(group) }));
  }
  return { returnReceipt, reopen, resubmit, updateQuantities, list };
}
module.exports = { initErpReceiptReview, createErpReceiptReview, parseRequest, parseQuantities, ReviewError };
