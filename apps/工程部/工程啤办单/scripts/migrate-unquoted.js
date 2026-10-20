#!/usr/bin/env node
'use strict';
// Run automatically before server.js loads its cache. CLI is inspection-only unless
// --offline is explicit: stop every old container/process using DATA_PATH first.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function migrationPlan(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid data root');
  for (const key of ['assembly_orders', 'assembly_items']) {
    if (data[key] !== undefined && !Array.isArray(data[key])) throw new Error(`Invalid ${key}`);
  }
  const next = structuredClone(data);
  const receipt = { renamed: 0, unquoted: 0, preservedAmbiguous: 0 };
  for (const order of next.assembly_orders || []) {
    if (!order || typeof order !== 'object') throw new Error('Invalid assembly order');
    if (order.status === '待报价') {
      order.status = '未报价'; receipt.renamed++;
    } else if (order.status === '待审核') {
      const items = (next.assembly_items || []).filter(it => it && it.order_id === order.id);
      const missing = value => value == null || (typeof value === 'string' && !value.trim());
      // No detail rows and partially quoted orders are ambiguous: preserve them.
      // Completion dates without prices also indicate possible prior quote work.
      if (items.length && items.every(it => missing(it.price) && missing(it.completion_time))) {
        order.status = '未报价'; receipt.unquoted++;
      } else if (!items.length || items.some(it => missing(it.price))) receipt.preservedAmbiguous++;
    }
  }
  return { next, receipt };
}
function fsyncDir(dir) {
  const fd = fs.openSync(dir, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function migrateUnquoted(filename, { dryRun = false } = {}) {
  if (!fs.existsSync(filename)) return { renamed: 0, unquoted: 0, preservedAmbiguous: 0 };
  const st = fs.lstatSync(filename);
  if (!st.isFile() || st.isSymbolicLink()) throw new Error('Migration requires a regular data file');
  const raw = fs.readFileSync(filename);
  const { next, receipt } = migrationPlan(JSON.parse(raw.toString('utf8')));
  if (dryRun || !(receipt.renamed + receipt.unquoted)) return receipt;
  const dir = path.dirname(filename);
  const token = crypto.randomBytes(12).toString('hex');
  const lock = filename + '.migration-lock';
  // Never steal a stale lock automatically: inspect recovery evidence offline.
  const lockfd = fs.openSync(lock, 'wx', 0o600);
  let temp;
  try {
    if (!fs.readFileSync(filename).equals(raw)) throw new Error('Data changed during migration');
    const backup = filename + '.bak-unquoted-' + token;
    let fd = fs.openSync(backup, 'wx', 0o600);
    try { fs.writeFileSync(fd, raw); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fsyncDir(dir);
    temp = filename + '.migration-' + token;
    fd = fs.openSync(temp, 'wx', st.mode & 0o7777);
    try {
      fs.fchmodSync(fd, st.mode & 0o7777);
      const current = fs.fstatSync(fd);
      if (current.uid !== st.uid || current.gid !== st.gid) fs.fchownSync(fd, st.uid, st.gid);
      fs.writeFileSync(fd, JSON.stringify(next, null, 2)); fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    if (!fs.readFileSync(filename).equals(raw)) throw new Error('Data changed during migration');
    fs.renameSync(temp, filename); temp = null; fsyncDir(dir);
    return receipt;
  } finally {
    if (temp && fs.existsSync(temp)) fs.unlinkSync(temp);
    fs.closeSync(lockfd); fs.unlinkSync(lock); fsyncDir(dir);
  }
}
if (require.main === module) {
  const file = path.join(process.env.DATA_PATH || path.join(__dirname, '..', 'data'), 'data.json');
  try {
    const offline = process.argv.includes('--offline');
    const result = migrateUnquoted(file, { dryRun: !offline });
    console.log(JSON.stringify({ mode: offline ? 'offline-write' : 'dry-run', ...result }));
    if (!offline) console.log('Inspection only. Stop all app processes before using --offline.');
  } catch { console.error('Migration failed; original data and any backup were retained. Inspect offline before retrying.'); process.exitCode = 1; }
}
module.exports = { migrationPlan, migrateUnquoted };
