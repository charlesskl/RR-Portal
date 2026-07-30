// 一次性修复脚本：将 2026-04-14 #1 机台第一条工程零件的入库时间恢复为 09:16
const fs = require('fs');
const data = JSON.parse(fs.readFileSync('data.json', 'utf8'));
const day = data.records['2026-04-14'];
if (!day) { console.log('未找到 2026-04-14 的记录'); process.exit(1); }

const target = day.items[8]; // index 8 = 第9行
if (target && target.machine === 1 && target.productName === '工程零件') {
  const correctTime = '2026-04-14T01:16:00.000Z'; // 09:16 北京时间
  console.log('修复前:', { printStartTime: target.printStartTime, createdAt: target.createdAt });
  target.printStartTime = correctTime;
  target.createdAt = correctTime;
  target._updatedAt = Date.now();
  console.log('修复后:', { printStartTime: target.printStartTime, createdAt: target.createdAt });
  fs.writeFileSync('data.json', JSON.stringify(data, null, 2), 'utf8');
  console.log('已保存到 data.json');
} else {
  console.log('目标记录不匹配，请检查:', target?.machine, target?.productName);
}
