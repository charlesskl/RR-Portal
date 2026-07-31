const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paiji-scheduling-update-'));
process.env.DATA_PATH = dataDir;

const { initDatabase } = require('../db/init');
const db = require('../db/connection');
const schedulingRouter = require('../routes/scheduling');

initDatabase();

const updateLayer = schedulingRouter.stack.find(
  (layer) => layer.route?.path === '/:id/items/:itemId' && layer.route.methods.put
);
const updateItem = updateLayer.route.stack[0].handle;

test.after(() => {
  db.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function createDraftItem(overrides = {}) {
  const schedule = db.prepare(`
    INSERT INTO schedules (schedule_date, shift, status, notes, workshop)
    VALUES ('2026-07-30', '白班', 'draft', '编辑测试', 'C')
  `).run();

  const values = {
    machine_no: 'C-4#',
    product_code: '15752',
    mold_name: 'FUGG-03M-01 牙齿模',
    color: '浅咖色',
    color_powder_no: '88397',
    material_type: 'ABS 750NSW',
    shot_weight: 49.3,
    material_kg: 462.9,
    accumulated: 200,
    quantity_needed: 2000,
    shortage: 1800,
    notes: '',
    ...overrides,
  };

  const item = db.prepare(`
    INSERT INTO schedule_items (
      schedule_id, machine_no, product_code, mold_name, color, color_powder_no,
      material_type, shot_weight, material_kg, accumulated, quantity_needed,
      shortage, notes, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
  `).run(
    schedule.lastInsertRowid,
    values.machine_no,
    values.product_code,
    values.mold_name,
    values.color,
    values.color_powder_no,
    values.material_type,
    values.shot_weight,
    values.material_kg,
    values.accumulated,
    values.quantity_needed,
    values.shortage,
    values.notes
  );

  return {
    scheduleId: Number(schedule.lastInsertRowid),
    itemId: Number(item.lastInsertRowid),
  };
}

function createScheduleItem(scheduleId, overrides = {}) {
  const values = {
    machine_no: 'C-8#',
    product_code: '92125-MA',
    mold_name: 'RBCEZ2-06M-01 猫窝上盖',
    color: '珠光/210C',
    color_powder_no: '89222',
    material_type: '1#PPEP332K',
    shot_weight: 33.6,
    material_kg: 300,
    accumulated: 0,
    quantity_needed: 1000,
    shortage: 1000,
    notes: '',
    ...overrides,
  };

  const item = db.prepare(`
    INSERT INTO schedule_items (
      schedule_id, machine_no, product_code, mold_name, color, color_powder_no,
      material_type, shot_weight, material_kg, accumulated, quantity_needed,
      shortage, notes, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
  `).run(
    scheduleId,
    values.machine_no,
    values.product_code,
    values.mold_name,
    values.color,
    values.color_powder_no,
    values.material_type,
    values.shot_weight,
    values.material_kg,
    values.accumulated,
    values.quantity_needed,
    values.shortage,
    values.notes
  );

  return Number(item.lastInsertRowid);
}

function invokeUpdate(scheduleId, itemId, body) {
  let statusCode = 200;
  let payload;
  let nextError;
  const response = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(value) {
      payload = value;
      return this;
    },
  };

  updateItem(
    { params: { id: String(scheduleId), itemId: String(itemId) }, body },
    response,
    (error) => {
      nextError = error;
    }
  );

  if (nextError) throw nextError;
  return { statusCode, payload };
}

test('persists a color edited in a draft schedule item', () => {
  const { scheduleId, itemId } = createDraftItem();

  const result = invokeUpdate(scheduleId, itemId, { color: '蓝色2147C' });
  const saved = db.prepare('SELECT color FROM schedule_items WHERE id = ?').get(itemId);

  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.color, '蓝色2147C');
  assert.equal(saved.color, '蓝色2147C');
});

test('persists all editable production fields and recalculates shortage', () => {
  const { scheduleId, itemId } = createDraftItem();
  const body = {
    accumulated: 200,
    color: '米黄/9064C',
    color_powder_no: '89956',
    material_type: 'ABS KF-740',
    shot_weight: 86.4,
    material_kg: 691.2,
    quantity_needed: 1500,
  };

  const result = invokeUpdate(scheduleId, itemId, body);
  const saved = db.prepare(`
    SELECT accumulated, color, color_powder_no, material_type, shot_weight,
           material_kg, quantity_needed, shortage
    FROM schedule_items
    WHERE id = ?
  `).get(itemId);

  assert.equal(result.statusCode, 200);
  assert.deepEqual(saved, {
    accumulated: 200,
    color: '米黄/9064C',
    color_powder_no: '89956',
    material_type: 'ABS KF-740',
    shot_weight: 86.4,
    material_kg: 691.2,
    quantity_needed: 1500,
    shortage: 1300,
  });
  assert.equal(result.payload.shortage, 1300);
});

test('syncs a changed machine to exact same-mold items only in the current schedule', () => {
  const moldName = 'RBCEZ2-06M-01 猫窝上盖';
  const { scheduleId, itemId } = createDraftItem({
    machine_no: 'C-4#',
    mold_name: moldName,
  });
  const sameMoldItemId = createScheduleItem(scheduleId, {
    machine_no: 'C-8#',
    mold_name: moldName,
  });
  const differentMoldItemId = createScheduleItem(scheduleId, {
    machine_no: 'C-12#',
    mold_name: 'RBCEZ2-07M-01 猫窝底座',
  });
  const otherSchedule = createDraftItem({
    machine_no: 'C-16#',
    mold_name: moldName,
  });

  const result = invokeUpdate(scheduleId, itemId, {
    machine_no: 'C-20#',
    sync_same_mold_machine: true,
  });

  const saved = db.prepare(`
    SELECT id, machine_no
    FROM schedule_items
    WHERE id IN (?, ?, ?, ?)
    ORDER BY id
  `).all(itemId, sameMoldItemId, differentMoldItemId, otherSchedule.itemId);

  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.synced_same_mold_count, 2);
  assert.deepEqual(saved, [
    { id: itemId, machine_no: 'C-20#' },
    { id: sameMoldItemId, machine_no: 'C-20#' },
    { id: differentMoldItemId, machine_no: 'C-12#' },
    { id: otherSchedule.itemId, machine_no: 'C-16#' },
  ]);
});

test('does not sync same-mold items when the submitted machine has not changed', () => {
  const moldName = 'RBCEZ2-05M-01 罐头';
  const { scheduleId, itemId } = createDraftItem({
    machine_no: 'C-4#',
    mold_name: moldName,
  });
  const sameMoldItemId = createScheduleItem(scheduleId, {
    machine_no: 'C-24#',
    mold_name: moldName,
  });

  const result = invokeUpdate(scheduleId, itemId, {
    notes: '只改备注',
    machine_no: 'C-4#',
    sync_same_mold_machine: true,
  });
  const saved = db.prepare(
    'SELECT machine_no FROM schedule_items WHERE id = ?'
  ).get(sameMoldItemId);

  assert.equal(result.statusCode, 200);
  assert.equal(saved.machine_no, 'C-24#');
});

test('rejects an item that does not belong to the schedule in the route', () => {
  const source = createDraftItem({ machine_no: 'C-4#' });
  const otherSchedule = createDraftItem({ machine_no: 'C-8#' });

  const result = invokeUpdate(otherSchedule.scheduleId, source.itemId, {
    machine_no: 'C-30#',
    sync_same_mold_machine: true,
  });
  const saved = db.prepare(
    'SELECT machine_no FROM schedule_items WHERE id = ?'
  ).get(source.itemId);

  assert.equal(result.statusCode, 404);
  assert.equal(saved.machine_no, 'C-4#');
});
