const { createWorker } = require('tesseract.js');
const path = require('path');

let worker = null;

async function getWorker() {
  if (!worker) {
    worker = await createWorker('chi_sim+eng');
  }
  return worker;
}

/**
 * OCR识别图片中的订单表格
 */
async function parseImageOrders(imagePath) {
  const w = await getWorker();
  const { data } = await w.recognize(imagePath);
  const text = data.text;

  console.log('[OCR] 识别文本:\n', text);

  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  console.log('[OCR] 共', lines.length, '行');

  const orders = [];

  // 检测是否为管道符分隔的表格格式
  const hasPipes = lines.filter(l => (l.match(/\|/g) || []).length >= 3).length > 3;

  if (hasPipes) {
    console.log('[OCR] 检测到管道符表格格式');
    for (const line of lines) {
      if ((line.match(/\|/g) || []).length < 3) continue;
      // 跳过表头和汇总行
      if (line.includes('模具') && line.includes('编号')) continue;
      if (line.includes('本页') || line.includes('制表') || line.includes('审核')) continue;
      if (line.includes('用料') && line.includes('型')) continue;

      const parts = line.split('|').map(p => p.trim().replace(/^[_\s"。]+|[_\s"]+$/g, ''));

      // 找包含RC/PASR/模具编号的列和数字列
      const order = extractFromPipeLine(parts);
      if (order) orders.push(order);
    }
  } else {
    // 空格分隔模式
    for (const line of lines) {
      if (line.includes('合计') || line.includes('制表') || line.includes('本页')) continue;
      if (!/\d/.test(line)) continue;
      const parts = line.split(/\s{2,}|\t/).map(p => p.trim()).filter(p => p);
      if (parts.length < 4) continue;
      const order = extractOrderFromParts(parts);
      if (order) orders.push(order);
    }
  }

  console.log('[OCR导入] 解析出', orders.length, '条订单');
  return { orders, rawText: text, lines };
}

/**
 * 从管道符分隔的行提取订单
 * 表格列顺序: 货号 | 模具编号 | 模具名称 | 颜色/编号 | 用料 | 啤净重 | 订单数量 | 出模数 | 需啤数量 | 用料KG | ...
 */
function extractFromPipeLine(parts) {
  // 过滤空列
  const cols = parts.filter(p => p.length > 0);
  if (cols.length < 6) return null;

  // 找模具编号列（RC/PASR/MNVN/字母+数字+连字符 模式）
  let moldIdx = -1;
  for (let i = 0; i < cols.length; i++) {
    if (/[A-Z]{2,}\d+|[A-Z]+-\d+|\d{4}-\d{4,5}/.test(cols[i].replace(/[^A-Za-z0-9-]/g, ''))) {
      moldIdx = i;
      break;
    }
  }
  if (moldIdx < 0) return null;

  // 货号在模具编号之前
  const product_code = moldIdx > 0 ? extractDigits(cols[moldIdx - 1]) : '';
  if (!product_code) return null;

  const mold_no_raw = cols[moldIdx].replace(/[^A-Za-z0-9-]/g, '');
  const mold_name_raw = moldIdx + 1 < cols.length ? cols[moldIdx + 1] : '';

  // 颜色/编号
  let color = '', color_powder_no = '';
  if (moldIdx + 2 < cols.length) {
    const colorStr = cols[moldIdx + 2];
    const cm = colorStr.match(/([\u4e00-\u9fa5]+(?:\s*色)?)\s*(\d{4,5})?/);
    if (cm) {
      color = cm[1];
      if (cm[2]) color_powder_no = cm[2];
    } else {
      color = colorStr;
    }
  }

  // 用料/料型
  let material_type = '';
  if (moldIdx + 3 < cols.length) {
    material_type = cols[moldIdx + 3];
  }

  // 从剩余列中提取数字字段
  const numbers = [];
  for (let i = moldIdx + 4; i < cols.length; i++) {
    const cleaned = cols[i].replace(/[^0-9.]/g, '');
    if (cleaned && /^\d+\.?\d*$/.test(cleaned)) {
      numbers.push(parseFloat(cleaned));
    }
  }

  // 数字字段顺序: 啤净重, 订单数量, 出模数, 需啤数量, 用料KG
  let shot_weight = 0, quantity_needed = 0, material_kg = 0, cavity = 1;
  if (numbers.length >= 4) {
    shot_weight = numbers[0];      // 啤净重
    // numbers[1] = 订单数量
    cavity = numbers[2] || 1;      // 出模数
    quantity_needed = numbers[3];   // 需啤数量
    if (numbers.length >= 5) material_kg = numbers[4];
  } else if (numbers.length >= 2) {
    shot_weight = numbers[0];
    quantity_needed = numbers[1];
  }

  if (!quantity_needed || quantity_needed < 10) return null;

  const fullMoldName = mold_name_raw ? `${mold_no_raw} ${mold_name_raw}` : mold_no_raw;

  return {
    product_code,
    mold_no: mold_no_raw,
    mold_name: fullMoldName,
    color,
    color_powder_no,
    material_type,
    shot_weight,
    quantity_needed,
    material_kg,
    cavity,
    order_no: '',
    notes: '',
  };
}

/**
 * 从字符串中提取主要数字（货号等）
 */
function extractDigits(str) {
  const m = str.replace(/[^0-9A-Za-z&]/g, '').match(/\d{4,5}[A-Za-z0-9&]*/);
  return m ? m[0] : str.replace(/[^0-9A-Za-z&-]/g, '');
}

/**
 * 从空格分隔的列数据中提取订单字段（备用）
 */
function extractOrderFromParts(parts) {
  let product_code = '', mold_no = '', mold_name = '', color = '', color_powder_no = '';
  let material_type = '', shot_weight = 0, quantity_needed = 0, material_kg = 0, cavity = 1;

  for (const p of parts) {
    if (/^\d{4,5}$/.test(p) && !product_code) { product_code = p; continue; }
    if (/^[A-Z]{2,}[\w-]*\d/.test(p) && p.includes('-') && !mold_no) { mold_no = p; continue; }
    if (/[\u4e00-\u9fa5]{2,}/.test(p) && !mold_name &&
        !/^(黑|白|红|蓝|绿|黄|灰|棕|橙|紫|粉|银|透明|啡|咖|本白)/.test(p) &&
        !/(ABS|PP|PVC|PC|TPR|PA)/.test(p)) { mold_name = p; continue; }
    if (/^(黑|白|红|蓝|绿|黄|灰|棕|橙|紫|粉|银|透明|啡|咖|本白|浅|深)/.test(p) && !color) {
      const cm = p.match(/^([\u4e00-\u9fa5]+[a-zA-Z]*)\s*(\d{4,5})?$/);
      if (cm) { color = cm[1]; if (cm[2]) color_powder_no = cm[2]; } else { color = p; }
      continue;
    }
    if (/(ABS|PP\s|PP$|PVC|PC\b|TPR|TPE|PA\d|PA-|HDPE)/i.test(p) && !material_type) { material_type = p; continue; }
    if (/^\d+\.?\d*$/.test(p)) {
      const v = parseFloat(p);
      if (v > 0 && v < 1000 && p.includes('.') && !shot_weight) { shot_weight = v; }
      else if (v >= 1000 && !quantity_needed) { quantity_needed = v; }
    }
  }

  if ((!mold_name && !mold_no) || !quantity_needed) return null;
  const fullMoldName = mold_no && mold_name ? `${mold_no} ${mold_name}` : mold_name || mold_no;
  return { product_code, mold_no: mold_no || '', mold_name: fullMoldName, color, color_powder_no, material_type, shot_weight, quantity_needed, material_kg, cavity, order_no: '', notes: '' };
}

module.exports = { parseImageOrders };
