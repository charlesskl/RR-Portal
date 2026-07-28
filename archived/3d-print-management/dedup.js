/**
 * 一次性去重脚本：清理 data.json 中的重复记录
 * 运行方式：node dedup.js
 * 运行完成后可删除此文件
 */
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data.json');
const BACKUP_FILE = path.join(__dirname, 'data.backup.' + Date.now() + '.json');

const raw = fs.readFileSync(DATA_FILE, 'utf8');
const data = JSON.parse(raw);

// 先备份
fs.writeFileSync(BACKUP_FILE, raw, 'utf8');
console.log('已备份到:', BACKUP_FILE);

let totalRemoved = 0;

for (const dateStr of Object.keys(data.records || {})) {
  const day = data.records[dateStr];
  if (!day || !day.items || !day.items.length) continue;

  const kept = [];
  const seen = new Map(); // key -> index in kept

  for (const item of day.items) {
    if (item._deleted) {
      kept.push(item);
      continue;
    }

    // 生成去重 key：机器 + 产品名 + 开始时间（精确到分钟）
    let key;
    if (item.printStartTime) {
      // 自动记录：按机器 + gcodeFile 或 printStartTime（精确到分钟）去重
      const t = item.printStartTime.slice(0, 16);
      const g = item._gcodeFile || '';
      key = `${item.machine}|${g || t}`;
    } else {
      // 手动记录：机器+产品名+数量+重量+单价+客户+创建时间全部相同才算重复
      const qty       = String(item.qty       ?? '');
      const weight    = String(item.weight    ?? '');
      const price     = String(item.price     ?? '');
      const client    = String(item.client    ?? '');
      const createdAt = String(item.createdAt ?? '');
      key = `${item.machine}|${item.productName || ''}|${qty}|${weight}|${price}|${client}|${createdAt}|manual`;
    }

    if (seen.has(key)) {
      const prevIdx = seen.get(key);
      const prev = kept[prevIdx];
      // 保留 _updatedAt 更新的那条
      if ((item._updatedAt || 0) > (prev._updatedAt || 0)) {
        kept[prevIdx] = item;
      }
      totalRemoved++;
    } else {
      seen.set(key, kept.length);
      kept.push(item);
    }
  }

  if (kept.length !== day.items.length) {
    console.log(`${dateStr}: ${day.items.length} 条 → ${kept.length} 条（删除 ${day.items.length - kept.length} 条重复）`);
  }
  day.items = kept;
}

data._snapshotUpdatedAt = Date.now();

fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
console.log(`\n去重完成，共删除 ${totalRemoved} 条重复记录`);
console.log('请重启 server.js 使数据生效');
