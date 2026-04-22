/**
 * 一次性迁移脚本：修正历史订单用料金额（补乘 KG→磅 换算系数 2.20462）
 *
 * 用法: node migrate-amounts.js
 *   - 先备份 data/data.json
 *   - 运行后检查输出
 *   - 确认无误后删除此脚本
 */
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data', 'data.json');
const KG_TO_LB = 2.20462;

const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));

// 建立原料单价映射 (HKD/磅)
const priceMap = {};
(data.material_prices || []).forEach(p => {
  priceMap[p.material] = +(p.unit_price || 0);
});

let fixed = 0;
let skipped = 0;

(data.injection_items || []).forEach(item => {
  if (!item.actual_amount_hkd || !item.actual_weight_kg) return;

  const weight = +item.actual_weight_kg;
  const price = priceMap[item.material] || 0;
  if (weight <= 0 || price <= 0) { skipped++; return; }

  const oldAmt = +item.actual_amount_hkd;
  const correctAmt = Math.round(weight * KG_TO_LB * price * 100) / 100;

  // 检查是否是旧公式 (weight * price，未乘换算系数)
  const oldFormula = Math.round(weight * price * 100) / 100;
  if (Math.abs(oldAmt - oldFormula) < 0.02) {
    // 确认是旧公式计算的，需要修正
    console.log(`  FIX: item ${item.id} (${item.material}) ${weight}kg × ${price} HKD/磅`);
    console.log(`       旧金额: ${oldAmt} → 新金额: ${correctAmt}`);
    item.actual_amount_hkd = correctAmt;
    fixed++;
  } else if (Math.abs(oldAmt - correctAmt) < 0.02) {
    // 已经是正确值
    skipped++;
  } else {
    // 手动修改过的值，不动
    console.log(`  SKIP: item ${item.id} (${item.material}) 金额 ${oldAmt} 与公式不匹配，可能是手动修改的`);
    skipped++;
  }
});

if (fixed > 0) {
  // 备份
  const backupFile = DATA_FILE + '.bak-' + Date.now();
  fs.copyFileSync(DATA_FILE, backupFile);
  console.log(`\n备份已保存: ${backupFile}`);

  // 写入
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  console.log(`已修正 ${fixed} 条记录，跳过 ${skipped} 条`);
} else {
  console.log(`\n无需修正（${skipped} 条已正确或跳过）`);
}
