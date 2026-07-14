const fs = require('fs');
const path = require('path');

// API key 必须由 .env.cloud.production 经 docker-compose 注入为 BAILIAN_API_KEY。
// 不再保留硬编码 fallback —— 历史泄露的 key 必须在阿里云 revoke。
const MODEL = process.env.BAILIAN_VISION_MODEL || 'qwen-vl-max';
const BASE_URL = process.env.BAILIAN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const API_URL = `${BASE_URL}/chat/completions`;

const PROMPT = `你是一个订单识别助手。请识别这张图片里的生产订单/啤货表/排单表格，把每一行订单数据提取出来。

字段说明：
- product_code: 产品货号（如 92105、47391、11494、1226146）
- mold_no: 模具编号（如 RBCA-08M-01、FUGG-05M-01、1226146-M02、YH-10866）
- mold_name: 模具名称（中文，如"奶嘴模具"、"牙齿模"、"眼睛"）
- color: 颜色（如"金色"、"银色"、"浅咖色"、"黑色"）
- color_powder_no: 色粉号（4-6位数字字母，如 87793、88397）
- material_type: 料型（如"ABS 750NSW"、"LDPE 260GG"、"PP EP332K"、"1#EP332K"、"透明ABS TR558AI"）
- shot_weight: 啤重G（数字，如 17.6、53.8）
- quantity_needed: ⚠️只取【啤数】列的值，绝对不要取【总套数】列！
  生产单中通常有两列数字相邻：「总套数」和「啤数」。
  关系：总套数 = 啤数 × 出模数（每模啤几个）。总套数通常更大。
  例：如果总套数=4002、啤数=667，quantity_needed 必须是 667，不是 4002。
- total_sets: 总套数（这个字段也提取出来，用于核对）
- material_kg: 总净重KG（数字，可选）
- order_no: 下单单号/生产单号（如 ZWY260002/B、CMC260173、ZCS2600109）
- notes: 备注（如"3牙齿"、"喷油"、"只啤Z-02牙齿"等。没有就留空）

要求：
1. 只输出 JSON 数组，不要任何其他文字、不要markdown代码块
2. ⚠️合并单元格继承（非常重要）：
   - 如果某行的【产品货号】列空白，继承上一行的产品货号
   - 如果某行的【颜色】列空白，继承上一行的颜色（同一批订单常用同色）
   - 如果某行的【色粉】列空白，继承上一行的色粉号
   - 如果某行的【料型】列空白，继承上一行的料型
   - 如果某行的【下单单号】列空白，继承上一行的下单单号
   - 只有视觉上确实是纵向合并单元格时才继承；如果该行是独立有边框的空单元格，保持为空，不要猜测
3. 跳过汇总行（含"合计"/"本页"/"总净重"等）、备注行、页脚行
4. 跳过模具编号明显无效的行
5. 啤重和啤数必须是纯数字，没有就填 0
6. 空字段用空字符串 ""
7. 严格按表格横向列边界读取，material_type、shot_weight、material_kg 是三个独立字段：
   - 料型格里的 ABS 750NSW、HIPS HI425、透明ABS TR558AI 等全部属于 material_type
   - "整啤净重G/啤净重G/啤重G"列属于 shot_weight
   - "总净重KG/用料KG"列属于 material_kg
   - 绝对不要把啤重或总净重拼到料型末尾
8. 单元格内容换成两三行显示时，要在同一个单元格内按从上到下拼接；不要把续行当成新订单，也不要让续行覆盖下一条订单
9. 用 shot_weight × quantity_needed ÷ 1000 ≈ material_kg 做自检；允许四舍五入误差。如果明显不成立，重新核对这三列和总套数/啤数列

输出格式（示例）：
[
  {"product_code":"92105","mold_no":"RBCA-08M-01","mold_name":"奶嘴模具","color":"金色","color_powder_no":"87793","material_type":"LDPE 260GG","shot_weight":17.6,"quantity_needed":4138,"material_kg":73.18,"order_no":"ZWY260002/B","notes":"3牙齿"}
]`;

async function parseImageWithQwen(imagePath) {
  const apiKey = process.env.BAILIAN_API_KEY;
  if (!apiKey) {
    throw new Error('BAILIAN_API_KEY 环境变量缺失。请上传原始 PDF/Excel，或配置百炼视觉识别密钥后再导入图片。');
  }

  const buf = fs.readFileSync(imagePath);
  const ext = path.extname(imagePath).toLowerCase().replace('.', '');
  const mimeMap = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', bmp: 'image/bmp' };
  const mimeType = mimeMap[ext] || 'image/jpeg';
  const dataUrl = `data:${mimeType};base64,${buf.toString('base64')}`;

  const body = {
    model: MODEL,
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: dataUrl } },
        { type: 'text', text: PROMPT },
      ],
    }],
    temperature: 0.1,
  };

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`百炼API错误: HTTP ${res.status} - ${errText.substring(0, 200)}`);
  }

  const data = await res.json();
  let content = data.choices?.[0]?.message?.content || '';
  console.log('[Qwen] 原始响应长度:', content.length);

  // 去掉可能的 markdown 代码块包裹
  content = content.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('百炼返回非JSON: ' + content.substring(0, 200));
    parsed = JSON.parse(jsonMatch[0]);
  }
  if (!Array.isArray(parsed)) throw new Error('百炼返回不是数组');

  const orders = parsed.map(o => {
    const moldNo = String(o.mold_no || '').trim();
    const moldName = String(o.mold_name || '').trim();
    const quantity = Math.round(Number(o.quantity_needed)) || 0;
    const totalSets = Math.round(Number(o.total_sets)) || 0;
    const cavityRatio = quantity > 0 ? totalSets / quantity : 0;
    const roundedCavity = Math.round(cavityRatio);
    const cavity = roundedCavity >= 1 && Math.abs(cavityRatio - roundedCavity) < 0.05
      ? roundedCavity
      : 1;
    const fullMoldName = moldNo && moldName ? `${moldNo} ${moldName}` : moldName || moldNo;
    return {
      product_code: String(o.product_code || '').trim(),
      mold_no: moldNo,
      mold_name: fullMoldName,
      color: String(o.color || '').trim(),
      color_powder_no: String(o.color_powder_no || '').trim(),
      material_type: String(o.material_type || '').trim(),
      shot_weight: parseFloat(o.shot_weight) || 0,
      material_kg: parseFloat(o.material_kg) || 0,
      sprue_pct: 0,
      ratio_pct: 0,
      quantity_needed: quantity,
      accumulated: 0,
      cavity,
      cycle_time: 0,
      order_no: String(o.order_no || '').trim(),
      is_three_plate: 0,
      packing_qty: 0,
      notes: String(o.notes || '').trim(),
    };
  }).filter(o => o.mold_no || o.mold_name);

  console.log('[Qwen] 识别到', orders.length, '条订单');
  return orders;
}

const REVIEW_TEXT_FIELDS = [
  'product_code',
  'mold_no',
  'mold_name',
  'color',
  'color_powder_no',
  'material_type',
  'order_no',
  'notes',
];
const REVIEW_NUMBER_FIELDS = ['shot_weight', 'quantity_needed', 'material_kg'];

function reviewText(value) {
  return String(value == null ? '' : value).trim();
}

function reviewNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function matchToken(value) {
  return reviewText(value).toUpperCase().replace(/[^A-Z0-9\u4E00-\u9FFF]/g, '');
}

function materialDeviation(row = {}) {
  const shotWeight = reviewNumber(row.shot_weight);
  const quantity = reviewNumber(row.quantity_needed);
  const materialKg = reviewNumber(row.material_kg);
  if (!(shotWeight > 0 && quantity > 0 && materialKg > 0)) return null;
  const expected = shotWeight * quantity / 1000;
  return Math.abs(expected - materialKg) / Math.max(expected, materialKg, 1);
}

function getAiReviewReasons(row = {}) {
  const reasons = [];
  if (!reviewText(row.product_code)) reasons.push('产品货号为空');
  if (!reviewText(row.mold_no) && !reviewText(row.mold_name)) reasons.push('模具信息为空');
  if (!reviewText(row.material_type)) reasons.push('料型为空');
  if (!(reviewNumber(row.shot_weight) > 0)) reasons.push('啤重无效');
  if (!(reviewNumber(row.quantity_needed) > 0)) reasons.push('需啤数无效');
  if (!(reviewNumber(row.material_kg) > 0)) reasons.push('用料KG无效');
  const deviation = materialDeviation(row);
  if (deviation != null && deviation > 0.1) reasons.push('重量校验偏差过大');
  return reasons;
}

function matchScore(ruleRow, aiRow, ruleIndex, aiIndex, sameLength) {
  let score = sameLength && ruleIndex === aiIndex ? 4 : 0;
  const weightedFields = [
    ['mold_no', 10],
    ['color_powder_no', 7],
    ['product_code', 5],
    ['color', 3],
    ['material_type', 2],
    ['order_no', 2],
  ];
  for (const [field, weight] of weightedFields) {
    const left = matchToken(ruleRow[field]);
    const right = matchToken(aiRow[field]);
    if (left && right && left === right) score += weight;
  }
  const ruleQuantity = Math.round(reviewNumber(ruleRow.quantity_needed));
  const aiQuantity = Math.round(reviewNumber(aiRow.quantity_needed));
  if (ruleQuantity > 0 && aiQuantity > 0 && ruleQuantity === aiQuantity) score += 7;
  return score;
}

function findAiMatch(ruleRow, ruleIndex, aiOrders, usedIndexes, sameLength) {
  let bestIndex = -1;
  let bestScore = -1;
  for (let aiIndex = 0; aiIndex < aiOrders.length; aiIndex += 1) {
    if (usedIndexes.has(aiIndex)) continue;
    const score = matchScore(ruleRow, aiOrders[aiIndex], ruleIndex, aiIndex, sameLength);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = aiIndex;
    }
  }
  if (bestScore >= 5) return bestIndex;
  if (sameLength && !usedIndexes.has(ruleIndex)) return ruleIndex;
  return -1;
}

function mergeRuleAndAiOrders(ruleOrders = [], aiOrders = []) {
  const usedIndexes = new Set();
  const corrections = [];
  const sameLength = ruleOrders.length === aiOrders.length;

  const orders = ruleOrders.map((ruleRow, ruleIndex) => {
    const aiIndex = findAiMatch(ruleRow, ruleIndex, aiOrders, usedIndexes, sameLength);
    if (aiIndex < 0) return ruleRow;
    usedIndexes.add(aiIndex);

    const aiRow = aiOrders[aiIndex];
    const merged = { ...ruleRow };
    const fields = [];

    for (const field of REVIEW_TEXT_FIELDS) {
      const aiValue = reviewText(aiRow[field]);
      if (!reviewText(merged[field]) && aiValue) {
        merged[field] = aiValue;
        fields.push(field);
      }
    }
    for (const field of REVIEW_NUMBER_FIELDS) {
      const aiValue = reviewNumber(aiRow[field]);
      if (!(reviewNumber(merged[field]) > 0) && aiValue > 0) {
        merged[field] = aiValue;
        fields.push(field);
      }
    }
    if (!(reviewNumber(merged.cavity) > 1) && reviewNumber(aiRow.cavity) > 1) {
      merged.cavity = Math.round(reviewNumber(aiRow.cavity));
      fields.push('cavity');
    }

    const ruleDeviation = materialDeviation(ruleRow);
    const aiDeviation = materialDeviation(aiRow);
    if (ruleDeviation != null && ruleDeviation > 0.1 && aiDeviation != null && aiDeviation <= 0.1) {
      for (const field of REVIEW_NUMBER_FIELDS) {
        const aiValue = reviewNumber(aiRow[field]);
        if (aiValue > 0 && reviewNumber(merged[field]) !== aiValue) {
          merged[field] = aiValue;
          fields.push(field);
        }
      }
    }

    const uniqueFields = [...new Set(fields)];
    if (uniqueFields.length > 0) {
      corrections.push({ row: ruleIndex + 1, fields: uniqueFields });
    }
    return merged;
  });

  return {
    orders,
    corrections,
    corrected_fields: corrections.reduce((sum, item) => sum + item.fields.length, 0),
    matched_rows: usedIndexes.size,
  };
}

module.exports = {
  parseImageWithQwen,
  getAiReviewReasons,
  mergeRuleAndAiOrders,
};
