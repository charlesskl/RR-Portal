const db = require('../db/connection');

/**
 * 颜色深浅排序（浅→深）
 */
const COLOR_ORDER = [
  '白', '透明', '米', '浅', '原色', '本色', '本白',
  '黄', '绿', '蓝',
  '红', '橙', '粉', '紫',
  '棕', '咖啡', '啡',
  '灰', '银',
  '深', '黑',
];

function getColorDepth(color) {
  if (!color) return 10;
  const c = color.trim();
  for (let i = 0; i < COLOR_ORDER.length; i++) {
    if (c.includes(COLOR_ORDER[i])) return i;
  }
  return 10;
}

const SPECIAL_MATERIALS = ['PVC', 'PC', 'TPR', 'TPE', 'HDPE', 'LDPE', '尼龙', 'ABS+PC', 'PA'];

function isSpecialMaterial(materialType) {
  if (!materialType) return false;
  const upper = materialType.toUpperCase();
  return SPECIAL_MATERIALS.some(m => upper.includes(m));
}

function needsFiveAxis(order) {
  if (order.is_three_plate) return true;
  const moldName = (order.mold_name || '').toLowerCase();
  return moldName.includes('三板') || moldName.includes('细水口') || moldName.includes('热流道');
}

/**
 * 获取上一班次
 * 夜班 → 同日白班
 * 白班 → 前一天夜班
 */
function getPreviousShiftSchedule(date, shift, workshop) {
  let prevDate = date;
  let prevShift;
  if (shift === '夜班') {
    prevShift = '白班';
    // 同日白班
  } else {
    // 白班 → 前一天夜班
    const d = new Date(date);
    d.setDate(d.getDate() - 1);
    prevDate = d.toISOString().slice(0, 10);
    prevShift = '夜班';
  }

  const ws = workshop || 'B';
  const schedule = db.prepare(
    'SELECT * FROM schedules WHERE schedule_date = ? AND shift = ? AND workshop = ? ORDER BY id DESC LIMIT 1'
  ).get(prevDate, prevShift, ws);

  if (!schedule) return null;

  const items = db.prepare(
    'SELECT * FROM schedule_items WHERE schedule_id = ? ORDER BY sort_order, id'
  ).all(schedule.id);

  return { schedule, items };
}

/**
 * 排机引擎核心
 *
 * 输入: orderIds[] + date + shift
 * 输出: schedule + schedule_items[]
 *
 * 连续排机规则:
 * - 自动查上一班次，将其所有订单作为"结转"排在当前班次最前
 * - 结转订单占用机台，新订单不重复安排同台机（除非机台有空余）
 * - 颜色接续：结转订单的颜色深度决定新订单颜色起点
 */
function generateSchedule({ orderIds, date, shift, workshop }) {
  const ws = workshop || 'B';
  // 1. 获取本班新订单
  const placeholders = orderIds.map(() => '?').join(',');
  const newOrders = orderIds.length > 0
    ? db.prepare(`SELECT * FROM orders WHERE id IN (${placeholders})`).all(...orderIds)
    : [];

  // 2. 获取机台配置（仅当前车间）
  const machines = db.prepare('SELECT * FROM machines WHERE status = ? AND workshop = ? ORDER BY id').all('active', ws);

  // 2b. 获取模具目标数据（仅当前车间）
  const allMoldTargets = db.prepare('SELECT * FROM mold_targets WHERE workshop = ?').all(ws);
  const moldTargetMap = {};
  // 只建立两种索引：完整 mold_no 原文 + 纯编号（去中文）
  // 不再做"逐步剥离前缀"的跨模具匹配，那会把 FUGG-05M-01 错匹配到 RBCEZ-05M-01
  for (const mt of allMoldTargets) {
    moldTargetMap[mt.mold_no] = mt;
    const codeOnly = mt.mold_no.replace(/[\u4e00-\u9fa5].*$/, '').trim();
    if (codeOnly && codeOnly !== mt.mold_no) moldTargetMap[codeOnly] = mt;
  }
  const findMoldTarget = (moldNo) => {
    if (!moldNo) return null;
    // 去掉订单模具号末尾中文
    const code = moldNo.replace(/[\u4e00-\u9fa5].*$/, '').trim();
    // 1) 精确匹配
    if (moldTargetMap[code]) return moldTargetMap[code];
    // 2) 同套模匹配：去掉末尾 "-数字"（如 FUGG-05M-01-1 → FUGG-05M-01）
    const parentCode = code.replace(/-\d+$/, '');
    if (parentCode !== code && moldTargetMap[parentCode]) return moldTargetMap[parentCode];
    // 3) 工厂前缀匹配：MAMNVN / MARBCEZ 等带 MA 前缀的去掉 MA（MAMNVN-17M-01 → MNVN-17M-01）
    const noMA = code.replace(/^MA(?=[A-Z]{3,})/, '');
    if (noMA !== code && moldTargetMap[noMA]) return moldTargetMap[noMA];
    const noMAparent = noMA.replace(/-\d+$/, '');
    if (noMAparent !== noMA && moldTargetMap[noMAparent]) return moldTargetMap[noMAparent];
    return null;
  };

  // 3. 获取上一班次结转项（排除欠数为0的已完成订单）
  const prevShiftData = getPreviousShiftSchedule(date, shift, ws);
  const carryOverItems = prevShiftData
    ? prevShiftData.items.filter(item => (item.shortage || 0) > 0)
    : [];

  // 4. 获取机台历史统计
  const machineStats = {};
  for (const m of machines) {
    const stats = db.prepare(`
      SELECT MIN(shot_weight) as min_w, MAX(shot_weight) as max_w,
             AVG(shot_weight) as avg_w, COUNT(*) as cnt
      FROM history_records WHERE machine_no = ? AND shot_weight > 0
    `).get(m.machine_no);

    const historyMolds = db.prepare(`
      SELECT DISTINCT mold_name FROM history_records WHERE machine_no = ?
    `).all(m.machine_no).map(r => r.mold_name);

    const historyMaterials = db.prepare(`
      SELECT DISTINCT material_type FROM history_records WHERE machine_no = ?
    `).all(m.machine_no).map(r => r.material_type);

    machineStats[m.machine_no] = {
      ...m,
      min_w: stats?.min_w || 0,
      max_w: stats?.max_w || 0,
      avg_w: stats?.avg_w || 0,
      cnt: stats?.cnt || 0,
      historyMolds,
      historyMaterials,
    };
  }

  // 5. 初始化机台负载（结转占用）
  const machineLoad = {};
  machines.forEach(m => { machineLoad[m.machine_no] = 0; });

  // 过滤掉机台已异常的结转项
  const activeMachineNos = new Set(machines.map(m => m.machine_no));
  const filteredCarryOver = carryOverItems.filter(item => activeMachineNos.has(item.machine_no));
  // 被过滤掉的结转项仍作为新订单重新分配
  const reAssignItems = carryOverItems
    .filter(item => !activeMachineNos.has(item.machine_no))
    .map(item => ({ ...item, machine_no: null }));

  // 结转项按机台分组，记录每台机最后一个结转订单的颜色深度
  const carryOverByMachine = {};  // machine_no -> [items]
  for (const item of filteredCarryOver) {
    if (!carryOverByMachine[item.machine_no]) {
      carryOverByMachine[item.machine_no] = [];
    }
    carryOverByMachine[item.machine_no].push(item);
    if (machineLoad[item.machine_no] !== undefined) {
      machineLoad[item.machine_no]++;
    }
  }

  // 6. 为新订单分配机台
  const newAssignments = [];
  // 提取模具核心编号，用于同套模分组
  // FUGG-07M-01 和 FUGG-07M-01-1 是同套模（转水口模），应分到同机
  // MNVN-17M-01 和 MAMNVN-17M-01-1 也是同套模
  // 核心规则：提取"字母前缀+数字M" (如 FUGG-07M, MNVN-17M)，忽略后面的 -01/-01-1
  const moldBase = s => {
    if (!s) return '';
    // 取模具编号部分（空格前）
    let code = String(s).split(' ')[0];
    // 去除 MA 工厂前缀（如 MAMNVN → MNVN, MARBCEZ2 → RBCEZ2）
    // 只去掉最前面的 MA，保留后面部分
    code = code.replace(/^MA(?=[A-Z]{3,})/, '');
    // 匹配"字母+数字M"（如 FUGG-07M、MNVN-17M、RBCEZ2-04M）
    const m = code.match(/^([A-Z]+\d*-\d+M)/);
    if (m) return m[1];
    // 匹配纯编号格式（如 1226146-M02 → 1226146）
    const m2 = code.match(/^(\d{4,})-[A-Z]\d+/);
    if (m2) return m2[1];
    // 无法识别的格式：直接返回原始编号（避免误合并不同模具）
    return code;
  };

  // 预记录：同模号已决定的机台（强制同机）
  const moldGroupMachine = {}; // moldBase(mold_name) -> machine_no

  // 重排新订单：同套模内按啤重降序，让啤重最大的先决定机台
  // 这样避免先排啤重小的导致机台锁定后无法容纳啤重大的
  const orderGroupMaxWeight = {};
  for (const o of newOrders) {
    const key = moldBase(o.mold_no || o.mold_name || '');
    const w = o.shot_weight || 0;
    if (!(key in orderGroupMaxWeight) || w > orderGroupMaxWeight[key]) {
      orderGroupMaxWeight[key] = w;
    }
  }
  newOrders.sort((a, b) => {
    const kA = moldBase(a.mold_no || a.mold_name || '');
    const kB = moldBase(b.mold_no || b.mold_name || '');
    // 组内按啤重降序，组间按组内最大啤重降序
    if (kA === kB) return (b.shot_weight || 0) - (a.shot_weight || 0);
    return (orderGroupMaxWeight[kB] || 0) - (orderGroupMaxWeight[kA] || 0);
  });

  for (const order of newOrders) {
    // 若同模号已分配过机台，直接强制分到同一台机
    const orderMoldKey = moldBase(order.mold_no || order.mold_name || '');
    if (orderMoldKey && moldGroupMachine[orderMoldKey]) {
      const forcedMachine = moldGroupMachine[orderMoldKey];
      newAssignments.push({
        order,
        machine_no: forcedMachine,
        score: 999,
        reasons: ['同套模强制同机'],
        is_carry_over: false,
      });
      machineLoad[forcedMachine] = (machineLoad[forcedMachine] || 0) + 1;
      continue;
    }

    {
    const candidates = [];
    const requireFiveAxis = needsFiveAxis(order);
    const shotWeight = order.shot_weight || 0;

    for (const m of machines) {
      const ms = machineStats[m.machine_no];
      if (!ms) continue;

      // 三板模/细水口 → 必须五轴双臂
      if (requireFiveAxis && m.arm_type !== '五轴双臂') continue;

      let score = 0;
      let reasons = [];

      // Step 1: 同模号历史 → +50分
      if (order.mold_name && ms.historyMolds.some(h => h && h.includes(order.mold_name.split(' ')[0]))) {
        score += 50;
        reasons.push('历史同模');
      }

      // Step 2: 啤重G在该机历史区间内 → +30分
      if (ms.cnt > 0 && shotWeight > 0) {
        if (shotWeight >= ms.min_w && shotWeight <= ms.max_w) {
          score += 30;
          reasons.push('啤重匹配');
        } else {
          // 啤重超出历史范围太多（>50%），直接跳过该机台
          const upperLimit = ms.max_w * 1.5;
          const lowerLimit = ms.min_w * 0.5;
          if (shotWeight > upperLimit || shotWeight < lowerLimit) {
            continue; // 跳过此机台
          }
          const distance = shotWeight < ms.min_w
            ? (ms.min_w - shotWeight) / ms.min_w
            : (shotWeight - ms.max_w) / ms.max_w;
          score -= Math.min(distance * 20, 20);
        }
      }

      // Step 3: 啤重越接近均值越好 → 0~10分
      if (ms.avg_w > 0 && shotWeight > 0) {
        const ratio = Math.abs(shotWeight - ms.avg_w) / ms.avg_w;
        score += Math.max(0, 10 - ratio * 10);
      }

      // Step 4: 特殊料 → 历史做过同类料 +15分
      if (isSpecialMaterial(order.material_type)) {
        const upperMaterial = order.material_type.toUpperCase();
        if (ms.historyMaterials.some(h => h && h.toUpperCase().includes(upperMaterial.split(' ')[0]))) {
          score += 15;
          reasons.push('历史同料');
        }
      }

      // Step 5: 颜色接续检查
      // 如果该机台有结转项，新订单颜色深度必须 >= 结转最后一项颜色深度（浅→深原则）
      if (carryOverByMachine[m.machine_no] && carryOverByMachine[m.machine_no].length > 0) {
        const lastCarryOver = carryOverByMachine[m.machine_no][carryOverByMachine[m.machine_no].length - 1];
        const lastColorDepth = getColorDepth(lastCarryOver.color);
        const newColorDepth = getColorDepth(order.color);
        if (newColorDepth < lastColorDepth) {
          // 颜色变浅，违反浅→深原则
          score -= 30;
          reasons.push('颜色逆序');
        }
        // 颜色接续正常，给予小加分
        if (newColorDepth >= lastColorDepth) {
          score += 5;
          reasons.push('颜色接续');
        }
      }

      // Step 5b: 同套模优先同台机 → +100分（强制同机）
      // 同组判断：精确匹配 / 前缀匹配（MCKP-27M-01 vs -01-1）/ 末尾数字不同（P04-1 vs P04-2）
      const isSameMold = (a, b) => {
        if (!a || !b) return false;
        if (a === b) return true;
        if (a.startsWith(b) || b.startsWith(a)) return true;
        const strip = s => s.replace(/-\d+$/, '');
        return strip(a) === strip(b);
      };
      const sameMoldNew = newAssignments.some(a =>
        a.machine_no === m.machine_no &&
        isSameMold(a.order.mold_no, order.mold_no)
      );
      const sameMoldCarryOver = (carryOverByMachine[m.machine_no] || []).some(item =>
        order.mold_no && item.mold_name && item.mold_name.includes(order.mold_no)
      );
      if (sameMoldNew || sameMoldCarryOver) {
        score += 100;
        reasons.push('同套模');
      }

      // Step 6: 负载均衡 → 已分配越少越好（结转已计入）
      // 递增惩罚：第1单-15，第2单-30，避免全堆一台机
      score -= machineLoad[m.machine_no] * 15;

      candidates.push({ machine_no: m.machine_no, score, reasons });
    }

    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];

    if (best) {
      newAssignments.push({
        order,
        machine_no: best.machine_no,
        score: best.score,
        reasons: best.reasons,
        is_carry_over: false,
      });
      machineLoad[best.machine_no]++;
      // 记录该模具号已决定的机台，后续同模订单强制同机
      if (orderMoldKey) moldGroupMachine[orderMoldKey] = best.machine_no;
    } else {
      newAssignments.push({
        order,
        machine_no: '未分配',
        score: -999,
        reasons: ['无匹配机台'],
        is_carry_over: false,
      });
    }
    } // end of scoring block
  }

  // 7. 同机台内新订单：先按模具分组（同套模排一起），组内按颜色浅→深
  const getMachineNum = (mno) => { const m = String(mno).match(/(\d+)/); return m ? parseInt(m[1]) : 99; };
  newAssignments.sort((a, b) => {
    if (a.machine_no !== b.machine_no) {
      const numA = getMachineNum(a.machine_no);
      const numB = getMachineNum(b.machine_no);
      return numA - numB;
    }
    // 同机台：同套模排在一起
    const baseA = moldBase(a.order.mold_no);
    const baseB = moldBase(b.order.mold_no);
    if (baseA !== baseB) {
      return baseA.localeCompare(baseB);
    }
    // 同套模内：颜色浅→深
    return getColorDepth(a.order.color) - getColorDepth(b.order.color);
  });

  // 检查同机台内黑色后接白色
  let prevByMachine = {};
  // 先用结转订单初始化
  for (const item of carryOverItems) {
    prevByMachine[item.machine_no] = item.color || '';
  }
  for (const a of newAssignments) {
    const prevColor = prevByMachine[a.machine_no];
    if (prevColor && prevColor.includes('黑') && a.order.color && a.order.color.includes('白')) {
      a.reasons.push('⚠️黑色后接白色');
    }
    prevByMachine[a.machine_no] = a.order.color || '';
  }

  // 8. 创建排机单并写入DB（若同日期+班次已有草稿则合并）
  const insertItem = db.prepare(`
    INSERT INTO schedule_items (schedule_id, machine_no, product_code, mold_name, color,
      color_powder_no, material_type, shot_weight, material_kg, sprue_pct, ratio_pct,
      accumulated, quantity_needed, shortage, order_no, target_24h, target_11h,
      days_needed, packing_qty, notes, sort_order, order_id, is_carry_over, robot_arm)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // 机台臂型映射
  const machineArmMap = {};
  machines.forEach(m => { machineArmMap[m.machine_no] = m.arm_type || ''; });

  const updateOrderStatus = db.prepare(`UPDATE orders SET status = 'scheduled' WHERE id = ?`);

  const carryOverNote = carryOverItems.length > 0
    ? `结转自${prevShiftData.schedule.schedule_date} ${prevShiftData.schedule.shift}，共${carryOverItems.length}条`
    : null;

  const result = db.transaction(() => {
    // 检查是否已有同日期+班次+车间的草稿排机单
    const existingDraft = db.prepare(
      `SELECT * FROM schedules WHERE schedule_date = ? AND shift = ? AND workshop = ? AND status = 'draft' ORDER BY id DESC LIMIT 1`
    ).get(date, shift, ws);

    let scheduleId;
    if (existingDraft) {
      // 合并进已有草稿
      scheduleId = existingDraft.id;
      // 更新结转说明（如有）
      if (carryOverNote && !existingDraft.notes) {
        db.prepare(`UPDATE schedules SET notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
          .run(carryOverNote, scheduleId);
      }
    } else {
      const scheduleResult = db.prepare(`
        INSERT INTO schedules (schedule_date, shift, status, notes, workshop) VALUES (?, ?, 'draft', ?, ?)
      `).run(date, shift, carryOverNote, ws);
      scheduleId = scheduleResult.lastInsertRowid;
    }

    // 当前最大 sort_order
    const maxSort = db.prepare(`SELECT MAX(sort_order) as m FROM schedule_items WHERE schedule_id = ?`).get(scheduleId);
    let sortOrder = (maxSort?.m ?? -1) + 1;

    // 先写结转项（is_carry_over=1，仅限机台正常的）
    for (const item of filteredCarryOver) {
      const shortage = Math.max(0, (item.quantity_needed || 0) - (item.accumulated || 0));
      insertItem.run(
        scheduleId, item.machine_no,
        item.product_code || '', item.mold_name || '', item.color || '',
        item.color_powder_no || '', item.material_type || '',
        item.shot_weight || 0, item.material_kg || 0,
        item.sprue_pct || 0, item.ratio_pct || 0,
        item.accumulated || 0, item.quantity_needed || 0, shortage,
        item.order_no || '', item.target_24h || 0, item.target_11h || 0,
        item.days_needed || 0, item.packing_qty || 0,
        `[结转]${(item.notes || '').replace(/^\[结转\]+/, '')}`, sortOrder++,
        item.order_id || null, 1, machineArmMap[item.machine_no] || item.robot_arm || ''
      );
    }

    // 再写新订单
    for (const a of newAssignments) {
      const o = a.order;
      const shortage = Math.max(0, (o.quantity_needed || 0) - (o.accumulated || 0));
      // 从模具目标表查找，找不到则留空（0）
      const moldTarget = findMoldTarget(o.mold_no);
      const target24h = moldTarget && moldTarget.target_24h > 0 ? moldTarget.target_24h : 0;
      const target11h = moldTarget && moldTarget.target_24h > 0
        ? (moldTarget.target_11h || Math.round(target24h / 24 * 11))
        : 0;
      const daysNeeded = target24h > 0 ? Math.round((shortage / target24h) * 100) / 100 : 0;
      const materialKg = o.material_kg || (o.shot_weight > 0 ? Math.round(o.shot_weight * shortage / 1000 * 100) / 100 : 0);
      const orderNotes = o.order_notes || '';
      const warnings = a.reasons.filter(r => r.startsWith('⚠️')).join('; ');
      const notes = [orderNotes, warnings].filter(Boolean).join(' | ');

      insertItem.run(
        scheduleId, a.machine_no,
        o.product_code || '', o.mold_name || '', o.color || '',
        o.color_powder_no || '', o.material_type || '',
        o.shot_weight || 0, materialKg, o.sprue_pct || 0, o.ratio_pct || 0,
        o.accumulated || 0, o.quantity_needed || 0, shortage,
        o.order_no || '', target24h, target11h, daysNeeded,
        o.packing_qty || 0, notes, sortOrder++, o.id, 0, machineArmMap[a.machine_no] || ''
      );

      updateOrderStatus.run(o.id);
    }

    return {
      scheduleId,
      itemCount: newAssignments.length,
      carryOverCount: carryOverItems.length,
      totalCount: carryOverItems.length + newAssignments.length,
    };
  })();

  return result;
}

module.exports = { generateSchedule, getColorDepth, isSpecialMaterial };
