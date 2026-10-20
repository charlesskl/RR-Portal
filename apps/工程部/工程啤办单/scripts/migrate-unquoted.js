#!/usr/bin/env node
/**
 * 夹具单流程迁移：先报价后审核（方案 A）
 *
 * 旧流程：开单【待审核】→ 主管审核 →【待报价】→ 报价 →【待经理审核】→ 经理审核 →【待生产】
 * 新流程：开单【未报价】→ 夹具部报价 →【待审核】→ 主管审核 →【待经理审核】→ 经理审核 →【待生产】
 *
 * 本脚本把 data.json 中的历史数据迁移到新流程：
 *   1. 状态为「待报价」的夹具单 →「未报价」
 *   2. 状态为「待审核」且所有明细均未填价格的夹具单（从未报价的旧单）→「未报价」
 * 已填过价格的「待审核」单保持不变（视为已报价，等主管审核）。
 *
 * 用法：node scripts/migrate-unquoted.js
 * 幂等，可重复执行；执行前自动备份 data.json。
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_PATH || path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'data.json');

if (!fs.existsSync(DATA_FILE)) {
  console.log(`未找到 ${DATA_FILE}，无需迁移`);
  process.exit(0);
}

const raw = fs.readFileSync(DATA_FILE, 'utf8');
const data = JSON.parse(raw);

const backup = `${DATA_FILE}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
fs.writeFileSync(backup, raw);
console.log(`已备份: ${backup}`);

let renamed = 0;
let unquoted = 0;

for (const o of data.assembly_orders || []) {
  if (o.status === '待报价') {
    o.status = '未报价';
    renamed++;
  } else if (o.status === '待审核') {
    const items = (data.assembly_items || []).filter(it => it.order_id === o.id);
    const hasPrice = items.some(it => it.price !== null && it.price !== undefined && String(it.price).trim() !== '');
    if (!hasPrice) {
      o.status = '未报价';
      unquoted++;
    }
  }
}

const tmp = DATA_FILE + '.tmp';
fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
fs.renameSync(tmp, DATA_FILE);

console.log(`迁移完成: 待报价→未报价 ${renamed} 条; 待审核(无价格)→未报价 ${unquoted} 条`);
