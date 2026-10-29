'use strict';
// A one-off, hash-guarded timestamp repair. No business values are stored here.
const crypto = require('node:crypto');

function requireCondition(value, message) {
  if (!value) throw new Error(message);
}
function exactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
}
function rowJson(row) {
  return JSON.stringify(Object.fromEntries(Object.keys(row).sort().map(key => [key, row[key]])));
}
function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}
function tableHash(rows) {
  return digest(JSON.stringify(rows.map(rowJson)));
}
function parsePlan(raw) {
  requireCondition(typeof raw === 'string' && raw.length > 0 && raw.length <= 4096, 'Private repair plan missing or oversized');
  const plan = JSON.parse(raw);
  requireCondition(exactKeys(plan, ['id', 'workshop', 'expectedRowSha256', 'restoredRowSha256', 'restore']), 'Repair plan fields differ');
  requireCondition(plan.id === 372 && plan.workshop === 'AT', 'Repair target is not allowed');
  requireCondition(/^[a-f0-9]{64}$/.test(plan.expectedRowSha256) && /^[a-f0-9]{64}$/.test(plan.restoredRowSha256), 'Repair hashes are invalid');
  requireCondition(plan.expectedRowSha256 !== plan.restoredRowSha256, 'Repair must restore a changed row');
  requireCondition(exactKeys(plan.restore, ['checked_in_at', 'updated_at']), 'Only two timestamp fields may be restored');
  for (const key of ['checked_in_at', 'updated_at']) {
    requireCondition(typeof plan.restore[key] === 'string' && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{3}Z)?$/.test(plan.restore[key]), 'Restore timestamp format is invalid');
  }
  return plan;
}

function repair(db, plan) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const before = db.prepare('SELECT * FROM pi_warehouse_orders ORDER BY id').all();
    const current = before.find(row => row.id === plan.id);
    requireCondition(current && current.workshop === 'AT' && current.status === 'checked-in', 'Target receipt state differs');
    requireCondition(digest(rowJson(current)) === plan.expectedRowSha256, 'Current full receipt hash differs');
    requireCondition(current.checked_in_at !== plan.restore.checked_in_at && current.updated_at !== plan.restore.updated_at, 'Exactly both timestamps must change');
    const restored = { ...current, ...plan.restore };
    requireCondition(digest(rowJson(restored)) === plan.restoredRowSha256, 'Restored full receipt hash differs');
    const beforeChanges = db.prepare('SELECT total_changes() AS count').get().count;
    const result = db.prepare(`UPDATE pi_warehouse_orders
      SET checked_in_at = @checked, updated_at = @updated
      WHERE id = @id AND workshop = @workshop
        AND checked_in_at IS @currentChecked AND updated_at IS @currentUpdated`).run({
      checked: plan.restore.checked_in_at, updated: plan.restore.updated_at,
      id: plan.id, workshop: plan.workshop,
      currentChecked: current.checked_in_at, currentUpdated: current.updated_at,
    });
    requireCondition(result.changes === 1, 'Receipt repair did not change exactly one row');
    const afterChanges = db.prepare('SELECT total_changes() AS count').get().count;
    requireCondition(afterChanges - beforeChanges === 1, 'Additional SQLite writes were detected');
    const after = db.prepare('SELECT * FROM pi_warehouse_orders ORDER BY id').all();
    const expected = before.map(row => row.id === plan.id ? restored : row);
    requireCondition(tableHash(after) === tableHash(expected), 'Receipt table changed outside the two timestamps');
    const actual = after.find(row => row.id === plan.id);
    requireCondition(digest(rowJson(actual)) === plan.restoredRowSha256, 'Restored receipt readback differs');
    db.exec('COMMIT');
    return { verified: true, changes: 1, beforeRowSha256: plan.expectedRowSha256,
      afterRowSha256: plan.restoredRowSha256, beforeTableSha256: tableHash(before),
      afterTableSha256: tableHash(after), unchangedExceptTwoTimestamps: true };
  } catch (error) {
    if (db.inTransaction) db.exec('ROLLBACK');
    throw error;
  }
}

function main() {
  const plan = parsePlan(process.env.P90_PAIJI_TIMESTAMP_REPAIR_PLAN);
  const Database = require('better-sqlite3');
  const db = new Database('/app/data/paiji.db', { fileMustExist: true });
  try { console.log(JSON.stringify(repair(db, plan))); } finally { db.close(); }
}
module.exports = { parsePlan, rowJson, digest, repair, tableHash };
if (require.main === module || process.argv[1] === '-') {
  try { main(); } catch {
    // Do not leak SQLite values, the plan, or timestamps into workflow logs.
    console.error('[FAIL] Receipt timestamp repair refused; no retry or fallback');
    process.exitCode = 1;
  }
}
