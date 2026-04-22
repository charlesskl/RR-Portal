const fs = require('fs');
const pdfParse = require('pdf-parse');

/**
 * 解析PMC啤机部生产啤货表PDF
 *
 * 每条订单固定行结构（以日期行结尾）：
 *   Line A: <5位色粉号><料型+型号><啤重G>       如: 89956ABS KF-74086.4
 *   Line B: <加工金额>                           如: 2,444.4
 *   Line C: <款号><模具编号><工模名称><总套数><啤数>  如: 77858-MAMCKP-01M-01洗手盆模105005250
 *   Line D+: <颜色>（可能跨行）                   如: 米黄/90\n64C
 *   Line E: <总净重KG><备注?><加工单价>           如: 453.6喷油0.4656
 *   Line F: <日期>                               如: 2026/3/2
 *
 * 注意：款号可能跨行（如77858-MA/77858-MA/\n77858-MA），模具编号在下一行
 */
async function parsePdf(filePath) {
  // 优先使用XY坐标解析（更准确）
  try {
    const { parsePdfXY } = require('./pdfParserXY');
    const xyResult = await parsePdfXY(filePath);
    if (xyResult.length > 0) {
      console.log('[PDF] XY坐标解析成功:', xyResult.length, '条');
      return xyResult;
    }
    console.log('[PDF] XY坐标解析无结果，回退到文本解析');
  } catch (e) {
    console.log('[PDF] XY解析失败，回退到文本解析:', e.message);
  }

  const buf = fs.readFileSync(filePath);
  const data = await pdfParse(buf);
  const text = data.text;

  console.log('[PDF] 原始文本前500字符:', text.substring(0, 500));
  console.log('[PDF] 总行数:', text.split('\n').length);

  // 委托加工合同格式（ZCS/CMC/ZWZ/ZWY 单号）
  // 区分倒序格式（色粉号在表头最前面）vs 兴信格式（款号在前面）
  const isReversedLayout = text.indexOf('色粉号') < text.indexOf('款号') && text.indexOf('色粉号') >= 0 && text.indexOf('色粉号') < 200;
  if (text.includes('委托加工合同') || (isReversedLayout && /(?:ZCS|CMC|ZWZ|ZWY)\d{6,}/.test(text))) {
    console.log('[PDF] 检测为委托加工合同格式');
    const result = parseZCSPdf(text);
    console.log('[PDF] 解析结果条数:', result.length);
    return result;
  }
  // 华登格式（啤机喷油生产单）
  if (text.includes('华登啤机') || text.includes('华登注塑') || ((text.includes('FDYA-') || text.includes('FDTA-')) && text.includes('JAZ-'))) {
    console.log('[PDF] 检测为华登格式');
    const result = parseHuadengPdf(text);
    console.log('[PDF] 解析结果条数:', result.length);
    return result;
  }
  // 兴信格式
  if (text.includes('啤货表') || text.includes('啤 机') || text.includes('生产单号')) {
    console.log('[PDF] 检测为兴信格式');
    const result = parseXingxinPdf(text);
    console.log('[PDF] 兴信解析结果条数:', result.length);
    // 如果兴信解析效果不好，尝试ZCS倒序
    if (result.length <= 1 || result.filter(r => r.quantity_needed > 0).length === 0) {
      const orderNoMatch2 = text.match(/(?:ZCS|CMC|ZWZ|ZWY)\d{6,}/);
      if (orderNoMatch2) {
        const lines2 = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        const reversed = parseZCSReversed(lines2, orderNoMatch2[0]);
        const validReversed = reversed.filter(r => r.quantity_needed > 0);
        if (validReversed.length > result.length) {
          console.log('[PDF] ZCS倒序结果更好，使用倒序结果:', validReversed.length);
          return validReversed;
        }
      }
    }
    return result;
  }
  console.log('[PDF] 检测为通用格式');
  const result = parseGenericPdf(text);
  console.log('[PDF] 解析结果条数:', result.length);
  return result;
}

function parseXingxinPdf(text) {
  const results = [];

  // 提取生产单号（如 CMC260056，通常在PDF末尾）
  const orderNoMatch = text.match(/([A-Z]{2,4}\d{6})/);
  const orderNo = orderNoMatch ? orderNoMatch[1] : '';

  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  // 找数据起点（跳过表头）
  let start = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('交货日期') && i < 20) {
      start = i + 1;
      break;
    }
  }

  // 找数据终点（汇总行或页脚）
  let end = lines.length;
  for (let i = start; i < lines.length; i++) {
    if (lines[i].includes('〖') || lines[i].includes('特别注明') || lines[i].includes('下单人')) {
      end = i;
      break;
    }
  }

  const dataLines = lines.slice(start, end);
  const dateRe = /^\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}$/;
  // 匹配模具行：字母前缀 + 至少一个"-字母数字"段 + 中文（如 CSM1405-04中, MCKP-02M-01洗）
  // 也支持数字开头的模具编号（如 9680-P02旗子）
  const moldLinePattern = /(?:[A-Z]{2,}[A-Z0-9]*(?:-[A-Z0-9]+)+|\d{3,}-P\d{2})\s*[\u4e00-\u9fa5]/;

  // 判断是否有每行日期列
  const hasDateLines = dataLines.some(l => dateRe.test(l));

  const pushParsed = (entryLines) => {
    const parsed = parseEntryLines(entryLines, orderNo);
    if (parsed) results.push(...parsed);
  };

  if (hasDateLines) {
    // 原逻辑：按日期行分割条目
    let entryLines = [];
    for (const line of dataLines) {
      if (dateRe.test(line)) {
        if (entryLines.length > 0) pushParsed(entryLines);
        entryLines = [];
      } else {
        entryLines.push(line);
      }
    }
    if (entryLines.length > 0) pushParsed(entryLines);
  } else {
    // 无日期列：按模具行分割条目
    const moldIdxs = [];
    for (let i = 0; i < dataLines.length; i++) {
      if (moldLinePattern.test(dataLines[i])) moldIdxs.push(i);
    }

    if (moldIdxs.length === 0) {
      pushParsed(dataLines);
      return results;
    }

    // 找每个模具行之后的重量行索引
    const weightIdxs = moldIdxs.map(moldIdx => {
      for (let j = moldIdx + 1; j < dataLines.length; j++) {
        if (/^\d+\.\d/.test(dataLines[j])) return j;
        if (j > moldIdx + 1 && moldLinePattern.test(dataLines[j])) return -1;
      }
      return -1;
    });

    // 每条条目的结束边界（重量行 + 可能的备注行）
    const boundaries = weightIdxs.map(wi => {
      if (wi < 0) return wi;
      let b = wi + 1;
      // 跳过短备注行（纯中文，≤8字）
      while (b < dataLines.length && /^[\u4e00-\u9fa5]{1,8}$/.test(dataLines[b])) b++;
      return b;
    });

    for (let m = 0; m < moldIdxs.length; m++) {
      const entryStart = m === 0
        ? 0
        : (boundaries[m - 1] >= 0 ? boundaries[m - 1] : moldIdxs[m - 1] + 1);
      const entryEnd = boundaries[m] >= 0
        ? boundaries[m]
        : (m < moldIdxs.length - 1 ? moldIdxs[m + 1] : dataLines.length);

      const entryLines = dataLines.slice(entryStart, entryEnd);
      if (entryLines.length >= 2) pushParsed(entryLines);
    }
  }

  return results;
}

/**
 * 解析一条订单的多行文本
 */
function parseEntryLines(lines, orderNo) {
  if (lines.length < 3) return null;

  // === 第1步：找模具行（含模具编号 + 中文名称）===
  // 模具编号格式: 字母前缀 + 至少一个"-字母数字"段，后跟中文
  // 例: CSM1405-04, MCKP-04M-01, TIUK-T72465-P03, 9680-P02
  const moldLinePattern = /(?:[A-Z]{2,}[A-Z0-9]*(?:-[A-Z0-9]+)+|\d{3,}-P\d{2})\s*[\u4e00-\u9fa5]/;
  let moldLineIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (moldLinePattern.test(lines[i])) {
      moldLineIdx = i;
      break;
    }
  }
  if (moldLineIdx === -1) return null;

  // === 第2步：解析料型行（模具行之前，跳过金额行） ===
  let colorPowderNo = '', materialType = '', shotWeight = 0;

  // 金额行模式: 纯数字+逗号+小数点（如 2,444.4 或 6,300.0）
  const amountRe = /^\d{1,3}(,\d{3})*\.\d+$/;

  // 找金额行（模具行之前的最后一个纯数字行）
  // 注意：啤重也可能是纯数字行（如PVC的2.1），但金额总在啤重之后
  // 所以取最后一个匹配的
  let amountLineIdx = -1;
  for (let i = 0; i < moldLineIdx; i++) {
    if (amountRe.test(lines[i])) {
      amountLineIdx = i; // 取最后一个
    }
  }

  // 材料信息 = 金额行之前的所有行
  // 对于ABS: 一行 "89956ABS KF-74086.4"
  // 对于PVC: 多行 "89957", "PVC", "110度本白", "2.1"
  let materialLines = [];
  if (amountLineIdx > 0) {
    materialLines = lines.slice(0, amountLineIdx);
  } else if (amountLineIdx < 0) {
    // 没找到金额行——PVC等跨行材料的情况
    // 材料行 = 模具行之前、不含模具编号模式的行
    for (let i = 0; i < moldLineIdx; i++) {
      if (/^\d{4,}-/.test(lines[i]) || /[A-Z]{2,}[A-Z0-9]*(?:-[A-Z0-9]+)+/.test(lines[i])) break;
      materialLines.push(lines[i]);
    }
    // 金额行可能在材料行末尾
    if (materialLines.length > 1 && amountRe.test(materialLines[materialLines.length - 1])) {
      amountLineIdx = materialLines.length - 1;
      materialLines = materialLines.slice(0, -1);
    } else {
      amountLineIdx = materialLines.length;
    }
  }

  // 合并材料信息（保留空格分隔）
  const materialText = materialLines.join(' ');

  // 解析色粉号（5位数字）
  const powderMatch = materialText.match(/(\d{5})/);
  if (powderMatch) colorPowderNo = powderMatch[1];

  // 提取料型和啤重
  // 方法：用已知料型名做子串匹配，料型后面的数字就是啤重
  // 例: "89956ABS KF-74086.4" → 去掉89956 → "ABS KF-74086.4"
  //     匹配 "ABS KF-740" → 剩余 "86.4" → 啤重=86.4
  const afterPowder = materialText.replace(/\d{5}\s*/, '');
  const knownMaterials = [
    'ABS KF-740', 'ABS 750NSW', 'ABS 750', 'ABS',
    'PP 5090T', 'PP',
    'PVC 110度本白', 'PVC 80度（本白）', 'PVC 80度(本白)', 'PVC 75度本白', 'PVC 90度本白',
    'PVC 95度（透明）', 'PVC 85度（透明）', 'PVC',
    'PC HS182S', 'PC',
    'PA6 1010C2', 'PA6 1010C', 'PA6',
    'TPR', 'TPE', 'HDPE', 'LDPE', '尼龙', '透明PP',
  ];
  // 动态检测 "数字#料型 型号" 格式（如 "1#PP EP332K"、"2#PVC"）
  // 型号必须以字母结尾（避免拾取啤重数字，如 EP332K 后的 54.8）
  const gradedMatMatch = afterPowder.match(/(\d#(?:PP|ABS|PVC|PC|TPR|TPE|HDPE|LDPE)(?:\s+[A-Z]+[0-9]*[A-Z]+)*)/i);
  if (gradedMatMatch) {
    knownMaterials.unshift(gradedMatMatch[1].trim());
  }
  // 无"数字#"前缀但有型号（如 "PP EP332K"、"ABS 709S"）
  // 型号必须以字母结尾（支持数字开头如709S）
  if (!gradedMatMatch) {
    const plainGradeMatch = afterPowder.match(/((?:PP|ABS)\s+[A-Z0-9]+[A-Z])/);
    if (plainGradeMatch) {
      knownMaterials.unshift(plainGradeMatch[1].trim());
    }
  }
  // 动态检测 PVC 度数型号（如 "PVC 95度（透明）"、"PVC 85度（透明）"）
  const pvcGradeMatch = materialText.match(/(PVC\s*\d+度[（(][^）)]*[）)])/);
  if (pvcGradeMatch) {
    knownMaterials.unshift(pvcGradeMatch[1].trim());
  }
  knownMaterials.sort((a, b) => b.length - a.length);
  for (const mat of knownMaterials) {
    const idx = afterPowder.indexOf(mat);
    if (idx >= 0) {
      materialType = mat;
      const remainder = afterPowder.substring(idx + mat.length);
      const swMatch = remainder.match(/(\d+\.?\d*)/);
      if (swMatch) shotWeight = parseFloat(swMatch[1]);
      break;
    }
  }

  // 若提取的啤重是整数（可能来自料型号码如EP332K），则改用材料行末尾的小数
  // 例: "1#PP EP332K34.4" → PP找到后余量"EP332K34.4"首数字=332(整数) → 应取末尾34.4
  if (Number.isInteger(shotWeight) && shotWeight > 0) {
    const lastDecimalMatch = materialText.match(/(\d+\.\d+)\s*$/);
    if (lastDecimalMatch) shotWeight = parseFloat(lastDecimalMatch[1]);
  }

  // === 第3步：解析模具行 + 款号 ===
  // 款号可能跨行（金额行和模具行之间），如:
  //   77858-MA/77858-MA/
  //   77858-MA
  //   MCKP-09M-01水阀模7800078000
  let productCodeLines = [];
  const startAfterAmount = amountLineIdx >= 0 ? amountLineIdx + 1 : materialLines.length;
  for (let i = startAfterAmount; i < moldLineIdx; i++) {
    productCodeLines.push(lines[i]);
  }

  const moldLine = lines[moldLineIdx];

  // 找模具编号：支持 MCKP-04M-01 和 TIUK-T72465-P03 等格式
  // 模具编号 = 2+字母 + 可选数字 + 至少两个"-字母数字段"
  const moldNoRe = /([A-Z]{2,}[A-Z0-9]*(?:-[A-Z0-9]+)+)/g;
  let moldNo = '';
  let prefixInMoldLine = '';
  let afterMoldPart = '';

  // 特殊情况：数字开头的模具编号（如 9680-P02）
  // 找 -P\d{2} 紧跟中文，再向前提取模具数字前缀（处理产品编号拼接的情况）
  if (/^\d/.test(moldLine)) {
    const pMatch = moldLine.match(/-P(\d{2})[\u4e00-\u9fa5]/);
    if (pMatch) {
      const pIdx = moldLine.indexOf(pMatch[0]);
      // 向前找连续数字
      let digitStart = pIdx;
      while (digitStart > 0 && /\d/.test(moldLine[digitStart - 1])) digitStart--;
      let allDigits = moldLine.substring(digitStart, pIdx);
      // 若数字过长（>5位），说明产品编号数字和模具数字拼接了
      // 如 "96809680" = 产品"9680" + 模具"9680"，取后半段
      if (allDigits.length > 5) {
        const half = Math.floor(allDigits.length / 2);
        if (allDigits.substring(0, half) === allDigits.substring(half)) {
          digitStart += half;
          allDigits = allDigits.substring(half);
        }
      }
      moldNo = allDigits + moldLine.substring(pIdx, pIdx + 4); // digits + -P + 2digits
      prefixInMoldLine = moldLine.substring(0, digitStart);
      afterMoldPart = moldLine.substring(pIdx + 4);
    }
  }

  // 若模具行以数字开头，先提取嵌入的产品编号前缀（如 92125-MA）
  // 使用前瞻：产品编号后缀(-MA等)之后紧跟模具前缀(2+大写字母+-)
  if (!moldNo && /^\d/.test(moldLine)) {
    const pcPrefixMatch = moldLine.match(/^(\d[\d\/]*(?:-[A-Z]{1,3})?(?=[A-Z]{2,}[A-Z0-9]*-[A-Z0-9]))/);
    if (pcPrefixMatch) {
      prefixInMoldLine = pcPrefixMatch[1];
      const rest = moldLine.substring(pcPrefixMatch[0].length);
      const m = rest.match(/^([A-Z]{2,}[A-Z0-9]*(?:-[A-Z0-9]+)+)/);
      if (m) {
        moldNo = m[1];
        afterMoldPart = rest.substring(m[1].length);
      }
    }
  }

  // 普通情况：直接在模具行中找模具编号
  if (!moldNo) {
    let match, lastMatch;
    moldNoRe.lastIndex = 0;
    // 优先策略：找模具编号后面紧跟中文（工模名称）的匹配
    // 例: "9561（总MA）PABR-24M-01压片" → PABR-24M-01 后紧跟 "压"
    while ((match = moldNoRe.exec(moldLine)) !== null) {
      const afterMatch = moldLine.substring(match.index + match[0].length);
      if (/^\s*[\u4e00-\u9fa5]/.test(afterMatch)) {
        lastMatch = match;
        break;
      }
    }
    // 回退策略：找第一个中文之前的匹配
    if (!lastMatch) {
      moldNoRe.lastIndex = 0;
      while ((match = moldNoRe.exec(moldLine)) !== null) {
        const chineseIdx = moldLine.search(/[\u4e00-\u9fa5]/);
        if (chineseIdx < 0 || match.index < chineseIdx) {
          lastMatch = match;
          break;
        }
      }
    }
    if (!lastMatch) return null;
    moldNo = lastMatch[1];
    // 去掉前缀末尾多余的 "-"（如 "77858-" → "77858"）
    prefixInMoldLine = moldLine.substring(0, lastMatch.index).replace(/-+$/, '');
    afterMoldPart = moldLine.substring(lastMatch.index + moldNo.length);
  }

  if (!moldNo) return null;

  // 去掉前缀中的中文括号注释（如 "9561（总MA）" → "9561"）
  const cleanPrefix = prefixInMoldLine.replace(/[（(][^）)]*[）)]/g, '').replace(/[\u4e00-\u9fa5]+/g, '').trim();

  // 合并款号：productCodeLines 直接拼接（不加/），避免PDF换行截断产生碎片
  // 例: ["T72465BZR2/T72465B", "ZR2/T72465IT3"] → "T72465BZR2/T72465BZR2/T72465IT3"
  const pcLinesText = productCodeLines.join('').replace(/\s+/g, '');
  // cleanPrefix 若有值（如 "9561"）则以 / 追加，避免与 pcLinesText 最后字符粘连
  let rawProductCode = cleanPrefix ? pcLinesText + '/' + cleanPrefix : pcLinesText;
  rawProductCode = rawProductCode.replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
  // 先去掉中文括号块（括号内可能含 / 会导致误分割，如「77843-5#抹茶（SK1/SK/GQ2展示产品）」）
  const pcCleaned = rawProductCode.replace(/[（(][^）)]*[）)]/g, '');
  // 去掉每个编号末尾的工厂后缀（-MA、-MAR、-MAM 等）以及中文后缀（-总MA、-5#抹茶 等）
  let allCodeParts = pcCleaned.split('/')
    .map(c => {
      c = c.replace(/-MA[A-Z]*/g, '');            // 去掉 -MA/-MAR 等工厂代码
      c = c.replace(/-[\u4e00-\u9fa5][^\/]*/g, ''); // 去掉 -中文... 后缀（如 -总MA）
      c = c.replace(/[\u4e00-\u9fa5].*$/g, '');   // 去掉从第一个中文字符起的尾巴
      c = c.replace(/-\d+#.*$/, '');               // 去掉颜色后缀（如 -5#抹茶 → 去掉 -5# 及之后）
      c = c.replace(/#.*$/, '');                  // 去掉 # 及其后内容（兜底）
      if (/^\d+-.+/.test(c)) c = c.replace(/-[A-Z]+$/, ''); // 纯数字款号去掉变体后缀（如 9680-SRB → 9680）
      c = c.replace(/-+$/, '');                   // 去掉末尾多余的 -
      return c.trim();
    })
    // 过滤：必须含数字 + 长度 >= 3（排除 SK、GQ2 等碎片）
    .filter(c => c.length >= 3 && /\d/.test(c));
  // 去重
  const uniqueCodes = [...new Set(allCodeParts)].filter(c => c.length > 0);

  // 模具编号后面：工模名称 + 总套数 + 啤数
  const afterMoldNo = afterMoldPart;
  // 工模名称 = 中文/字符直到数字
  const nameMatch = afterMoldNo.match(/^([\u4e00-\u9fa5\w\s()（）]+?)(\d+)/);
  let moldName = '';
  let numbersStr = '';
  if (nameMatch) {
    moldName = nameMatch[1].trim();
    numbersStr = afterMoldNo.substring(nameMatch.index + nameMatch[1].length);
  }

  // 若数字串末尾嵌有颜色（如 "1032010320白色"），先提取出来
  let embeddedColor = '';
  const embColorMatch = numbersStr.match(/([\u4e00-\u9fa5]+(?:\/[\dA-Za-z]+C?)?)$/);
  if (embColorMatch) {
    embeddedColor = embColorMatch[1];
    numbersStr = numbersStr.substring(0, numbersStr.length - embColorMatch[0].length);
  }

  // 从数字串提取总套数和啤数
  // 例: "105005250" → 可能是 10500+5250 或 1050+05250
  // 策略: 尝试找出两个合理的数字（总套数通常≥啤数）
  let totalSets = 0, quantity = 0;
  const allDigits = numbersStr.replace(/[^\d]/g, '');

  if (allDigits.length > 0) {
    // 尝试从中间切分，找最合理的组合
    const len = allDigits.length;

    // 尝试各种切分位置
    for (let split = Math.floor(len / 2) - 1; split <= Math.ceil(len / 2) + 1; split++) {
      if (split <= 0 || split >= len) continue;
      const a = parseInt(allDigits.substring(0, split));
      const b = parseInt(allDigits.substring(split));
      // 总套数通常是啤数的1~3倍（啤数 = 总套数 / 模穴数）
      if (a > 0 && b > 0 && a >= b && a <= b * 10) {
        totalSets = a;
        quantity = b;
        break;
      }
    }

    // 如果没找到合理切分，尝试相等或2倍关系
    if (totalSets === 0) {
      for (let split = 1; split < len; split++) {
        const a = parseInt(allDigits.substring(0, split));
        const b = parseInt(allDigits.substring(split));
        if (a > 0 && b > 0) {
          totalSets = a;
          quantity = b;
          break;
        }
      }
    }
  }

  // === 第4步：解析颜色（模具行之后，重量行之前）及备注（重量行之后） ===
  let colorLines = [];
  let notes = '';
  let weightFound = false;
  let afterWeightLines = [];
  let nextLineQty = 0; // 模具行后独立的啤数行（如153244单独一行）

  for (let i = moldLineIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!weightFound && /^\d+\.\d/.test(line)) {
      weightFound = true;
      // 尝试从重量行内提取夹在两个小数之间的中文备注（如 39.6喷油0.4656）
      const notesMatch = line.match(/\d+\.\d+([^\d.][^0-9.]*?)\d+\.\d+/);
      if (notesMatch && notesMatch[1]?.trim()) {
        notes = notesMatch[1].trim();
      }
    } else if (weightFound) {
      // 重量行之后的行可能是备注列内容
      afterWeightLines.push(line);
    } else {
      // 颜色行之前若有纯整数行（≥100），当作独立啤数处理，不加入颜色
      if (colorLines.length === 0 && /^\d+$/.test(line) && parseInt(line) >= 100) {
        nextLineQty = parseInt(line);
      } else {
        colorLines.push(line);
      }
    }
  }

  // 若重量行内没提取到备注，从后续行中找含中文的短行作为备注（排除款号/产品编码）
  if (!notes && afterWeightLines.length > 0) {
    const noteCandidates = afterWeightLines.filter(l => {
      if (!/[\u4e00-\u9fa5]/.test(l)) return false;   // 必须含中文
      if (/^\d{4}[-\/]\d/.test(l)) return false;        // 排除日期
      if (/^\d{5}-/.test(l)) return false;              // 排除款号（如77843-）
      if (l.includes('/') && /\d/.test(l)) return false; // 排除含/的产品编码
      if (l.length > 20) return false;                  // 太长的不是备注
      return true;
    });
    if (noteCandidates.length > 0) notes = noteCandidates.join(' ');
  }

  let color = colorLines.join('').replace(/\s+/g, '');
  // 若颜色行为空但模具行末尾有嵌入颜色（如 "1032010320白色"），使用嵌入颜色
  if (!color && embeddedColor) color = embeddedColor;
  // 若啤数在独立行读到，用它覆盖从模具行数字串推算的值
  if (nextLineQty > 0) quantity = nextLineQty;

  const fullMoldName = `${moldNo} ${moldName}`.trim();

  const baseEntry = {
    mold_no: moldNo,
    mold_name: fullMoldName,
    color,
    color_powder_no: colorPowderNo,
    material_type: materialType,
    shot_weight: shotWeight,
    quantity_needed: quantity,
    cavity: 1,
    cycle_time: 0,
    order_no: orderNo,
    is_three_plate: fullMoldName.includes('三板') || fullMoldName.includes('热流道') ? 1 : 0,
    packing_qty: 0,
    notes,
  };

  // 多款号共用一套模：每个唯一产品编号生成一条订单
  if (uniqueCodes.length > 1) {
    return uniqueCodes.map(code => ({ ...baseEntry, product_code: code }));
  }
  return [{ ...baseEntry, product_code: uniqueCodes[0] || '' }];
}

/**
 * 解析华登啤机喷油生产单格式
 *
 * PDF结构：每条订单可能跨多行，以 JAZ- 模具编号为锚点：
 *   - 产品货号（如 JWC0807）可能在 JAZ- 同行前缀，或单独一行
 *   - 模具编号格式：JAZ-XXXXX-M01
 *   - 数据行包含：机型A目标数 + 啤重G + 订单数 + 1/腔数 + 需啤数 + 用料KG + 水口%
 *     例: 18A360078.60 3100 1/13100 244.9 9%
 */
function parseHuadengPdf(text) {
  const orderNoMatch = text.match(/FD[YTA]A?-\d+/);
  const orderNo = orderNoMatch ? orderNoMatch[0] : '';

  const rawLines = text.split('\n').map(l => l.trim()).filter(Boolean);

  // 预处理：合并跨行的 JAZ- 模具编号（如 "JAZ-CMW0008-M12-" + "001"）
  const mergedLines = [];
  for (let i = 0; i < rawLines.length; i++) {
    const l = rawLines[i];
    if (l.startsWith('JAZ-') && l.endsWith('-') && i + 1 < rawLines.length) {
      // 下一行是编号的延续部分（如 "001" 或 "001-01"）
      const next = rawLines[i + 1];
      if (/^\d{3}/.test(next) && next.length < 10) {
        mergedLines.push(l + next);
        i++; // 跳过下一行
        continue;
      }
    }
    mergedLines.push(l);
  }

  const results = [];

  // 产品货号模式：2-6大写字母 + 4+位数字，单独一行或在JAZ-前缀
  const productCodeRe = /^([A-Z]{2,6}\d{4,})$/;
  // 日期行模式（如 26/4/30）
  const dateRe = /^\d{2}\/\d{1,2}\/\d{1,2}$/;

  // 找所有含 JAZ- 的行索引
  const jazIdxs = mergedLines.reduce((acc, l, i) => {
    if (l.includes('JAZ-')) acc.push(i);
    return acc;
  }, []);

  if (jazIdxs.length === 0) {
    // 非JAZ-格式的华登啤机单（如50#92108啤机更改单）
    // 格式: 产品编号+BBCL-01M-01+名称+颜色/色粉+料型+数字...
    console.log('[华登] 无JAZ-行，尝试BBCL/直排格式');
    const directResult = parseHuadengDirect(mergedLines, orderNo, text);
    return directResult;
  }

  let currentProduct = '';

  for (let ji = 0; ji < jazIdxs.length; ji++) {
    const jazIdx = jazIdxs[ji];
    const nextJazIdx = ji + 1 < jazIdxs.length ? jazIdxs[ji + 1] : mergedLines.length;

    // 向前找产品货号行（上一行是单独的货号）
    let entryStart = jazIdx;
    if (jazIdx > 0) {
      const prevLine = mergedLines[jazIdx - 1];
      const prevJazIdx = ji > 0 ? jazIdxs[ji - 1] : -1;
      if (!prevLine.includes('JAZ-') && !dateRe.test(prevLine) &&
          productCodeRe.test(prevLine) && jazIdx - 1 > prevJazIdx) {
        entryStart = jazIdx - 1;
      }
    }

    // 本条目结束位置：下一个JAZ-行前（若下一个JAZ-前有独立货号行，则在货号行前结束）
    let entryEnd = nextJazIdx;
    if (ji + 1 < jazIdxs.length) {
      const nj = jazIdxs[ji + 1];
      if (nj > 0 && !mergedLines[nj - 1].includes('JAZ-') && !dateRe.test(mergedLines[nj - 1]) &&
          productCodeRe.test(mergedLines[nj - 1])) {
        entryEnd = nj - 1;
      }
    }

    // 收集条目行，过滤日期行
    const entryLines = mergedLines.slice(entryStart, entryEnd).filter(l => !dateRe.test(l));
    const entryText = entryLines.join(' ');

    // 提取模具编号（支持 JAZ-XXX-M01, JAZ-CMW0008-M12-001, JAZ-CMW0001-M27-001-01 等）
    const moldNoMatch = entryText.match(/(JAZ-[A-Z0-9]+-M\d+-\d+(?:-\d+)?)/);
    if (!moldNoMatch) {
      // 兜底：只到 -Mxx
      const moldNoMatch2 = entryText.match(/(JAZ-[A-Z0-9]+-M\d{2})/);
      if (!moldNoMatch2) continue;
      var moldNo = moldNoMatch2[1];
    } else {
      var moldNo = moldNoMatch[1];
    }

    // 更新产品货号
    const beforeJaz = entryText.slice(0, entryText.indexOf('JAZ-'));
    const productMatch = beforeJaz.match(/([A-Z]{2,6}\d{4,})/);
    if (productMatch) currentProduct = productMatch[1];

    // 模具编号之后的文本
    const afterMoldStart = entryText.indexOf(moldNo) + moldNo.length;
    const afterMold = entryText.slice(afterMoldStart);

    // 机型+目标数（如 18A3600）：目标数为3-4位整数
    const machineMatch = afterMold.match(/(\d{1,2})A(\d{3,4})/);
    let target24h = 0;
    let beforeMachine, afterMachine;

    if (machineMatch) {
      target24h = parseInt(machineMatch[2]);
      beforeMachine = afterMold.slice(0, afterMold.indexOf(machineMatch[0]));
      afterMachine = afterMold.slice(afterMold.indexOf(machineMatch[0]) + machineMatch[0].length);
    } else {
      // 无机型标记（如 CMW0298 格式: "2#下身40001000 359C 绿色85928ABS 750NSW13.0113.0"）
      beforeMachine = afterMold;
      afterMachine = '';
    }

    // 啤重G
    let shotWeight = 0;
    if (afterMachine) {
      const shotMatch = afterMachine.match(/^(\d{1,4}\.\d{1,2})/);
      shotWeight = shotMatch ? parseFloat(shotMatch[1]) : 0;
    }

    // 需啤数
    let quantityNeeded = 0;
    if (afterMachine) {
      const qtyMatch = afterMachine.match(/(\d+)\s*1\/(\d)\s*(\d+)/);
      if (qtyMatch) quantityNeeded = parseInt(qtyMatch[3]);
    }

    // 无机型时从 beforeMachine 直接提取（格式: "名称+总套数+啤数 颜色+色粉号+料型+啤重+净重"）
    if (!machineMatch) {
      // 总套数+啤数（如 "40001000"）
      const qtyMatch2 = beforeMachine.match(/(\d{3,}?)(\d{3,})\s/);
      if (qtyMatch2) {
        // 尝试合理分割
        const fullNum = beforeMachine.match(/(\d{4,})\s/);
        if (fullNum) {
          const d = fullNum[1];
          for (let sp = Math.floor(d.length/2)-1; sp <= Math.ceil(d.length/2)+1; sp++) {
            if (sp <= 0 || sp >= d.length) continue;
            const a = parseInt(d.substring(0, sp));
            const b = parseInt(d.substring(sp));
            if (a > 0 && b > 0 && a >= b && a <= b * 10) { quantityNeeded = b; break; }
          }
        }
      }
      // 啤重（料型后面的第一个小数）
      const swMatch = beforeMachine.match(/(?:ABS|PP|PVC|LDPE|POM|透明)[\w\s（）()度]*?(\d+\.?\d)\d*\.?\d*/);
      if (swMatch) shotWeight = parseFloat(swMatch[1]);
    }

    // 色粉号（/ 后4-6位数字）
    const powderMatch = beforeMachine.match(/\/\s*(\d{4,6})/);
    const colorPowder = powderMatch ? powderMatch[1] : '';
    // 也试直接数字模式
    let colorPowder2 = '';
    if (!colorPowder) {
      const cpnMatch = beforeMachine.match(/(?:色|蓝|绿|红|白|黄|紫|粉)\s*(\d{5})/);
      if (cpnMatch) colorPowder2 = cpnMatch[1];
    }

    // 用料类型
    let material = '';
    const matPatterns = [
      /透明ABS\s*[\w+():\d\/\s.-]*/,
      /ABS\s*[\w+():\d\/\s.-]*/,
      /PP[\u4e00-\u9fa5]+/,
      /PP\s*[\(\w+():\d\/\s.()\[\]-]*/,
      /TPR[\w\s.-]*/,
      /PVC[\w\s.（）()度-]*/,
      /LDPE\s*[\w.-]*/,
      /POM\s*[\w.-]*/,
      /KR\d+[\w\s.-]*/,
      /K料[\w\s.-]*/,
    ];
    for (const pat of matPatterns) {
      const m = beforeMachine.match(pat);
      if (m) {
        material = m[0].trim().replace(/\s+$/, '').replace(/\d+\.?\d*$/, '').trim();
        break;
      }
    }

    // 提取颜色
    const textBeforeMat = material
      ? beforeMachine.slice(0, beforeMachine.indexOf(material))
      : beforeMachine;
    const cleanForColor = textBeforeMat.replace(/\/\s*\d{4,6}/, '').replace(/[A-Z0-9]{4,}/g, '');
    const colorWords = [...cleanForColor.matchAll(/((?:高光|浅|深|淡|半透明|珠光)?(?:黑|白|红|蓝|绿|黄|灰|棕|橙|紫|粉|金|银|肉|咖|透明|本白|奶白|原色|渌)色?(?:\+闪粉)?(?:\/\w+)?)/g)];
    const color = colorWords.length > 0 ? colorWords[colorWords.length - 1][1].trim() : '';

    // 模具名称：颜色之前的中文文字（如"儿童黑豹 2"、"电池箱"）
    let moldName = moldNo;
    if (color && cleanForColor.includes(color)) {
      const nameText = cleanForColor.slice(0, cleanForColor.lastIndexOf(color)).replace(/[\/\s]+$/, '').trim();
      if (nameText && /[\u4e00-\u9fa5]/.test(nameText)) moldName = moldNo + ' ' + nameText;
    } else {
      const simpleMatch = cleanForColor.match(/^\s*([\u4e00-\u9fa5][\u4e00-\u9fa5A-Za-z0-9\s·]{1,20})/);
      if (simpleMatch) moldName = moldNo + ' ' + simpleMatch[1].trim();
    }

    results.push({
      product_code: currentProduct,
      mold_no: moldNo,
      mold_name: moldName,
      color,
      color_powder_no: colorPowder,
      material_type: material,
      shot_weight: shotWeight,
      quantity_needed: quantityNeeded,
      target_24h: target24h,
      cavity: 1,
      cycle_time: 0,
      order_no: orderNo,
      is_three_plate: 0,
      packing_qty: 0,
      notes: '',
    });
  }

  console.log('[华登] 解析结果:', results.map(r =>
    `${r.product_code} ${r.mold_no} qty=${r.quantity_needed} color=${r.color} mat=${r.material_type} shot=${r.shot_weight}`
  ));
  return results;
}

/**
 * 通用PDF格式解析
 */
function parseGenericPdf(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const results = [];
  const moldRe = /([A-Z0-9]{2,10}-\d{2}[A-Z]-\d{2})/;
  for (const line of lines) {
    const m = line.match(moldRe);
    if (!m) continue;
    const parts = line.split(/\s+/);
    const numIdx = parts.findIndex(p => /^\d{3,}$/.test(p.replace(/,/g, '')));
    results.push({
      product_code: parts[0] || '',
      mold_no: m[1],
      mold_name: '',
      color: '',
      material_type: '',
      shot_weight: 0,
      quantity_needed: numIdx !== -1 ? (parseInt(parts[numIdx].replace(/,/g, '')) || 0) : 0,
      cavity: 1,
      cycle_time: 0,
      order_no: '',
      is_three_plate: 0,
      packing_qty: 0,
    });
  }
  return results;
}

/**
 * 解析委托加工合同格式 PDF（ZCS 单号）
 *
 * PDF 实际文本结构（每列单独一行，极度碎片化）：
 *   [数量]
 *   [货物名称][货號，如 大蛋角92125-MA]
 *   [用料名称行1][用料名称行2]
 *   [啤数，如 20000.0]
 *   [总重量+单重G+色粉号 拼接，如 300015089208]
 *   [模具编号行1][模具编号行2]
 *   [生产单号行1][生产单号行2]
 *   [颜色行1][颜色行2]
 *   [备注（可选）]
 *
 * 策略：把数据区所有行合并后，按货號模式（\d{5}-[A-Z]+）拆成每条记录，
 *        再从每条记录文本中提取各字段。
 */
function parseZCSPdf(text) {
  const results = [];

  // 提取采购单号（支持 ZCS / CMC / ZWZ / ZWY 格式）
  const orderNoMatch = text.match(/(?:ZCS|CMC|ZWZ|ZWY)\d{6,}/);
  const orderNo = orderNoMatch ? orderNoMatch[0] : '';

  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  // 找数据区（含"颜色"或"啤数"的表头行之后，"附送"/"合計"/"注意事项" 之前）
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('颜色') || lines[i].includes('啤数') || lines[i].includes('模具编号')) {
      headerIdx = i;
      break;
    }
  }
  let dataLines = lines.slice(headerIdx >= 0 ? headerIdx + 1 : 0);
  const endIdx = dataLines.findIndex(l =>
    l.includes('附送') || l.startsWith('合計') || l.startsWith('合计') ||
    l.includes('注意事项') || l.includes('日期:年月日')
  );
  if (endIdx > 0) dataLines = dataLines.slice(0, endIdx);

  // 找所有含货號的行，支持三种格式：
  //   格式A: "大蛋角92125-MA"（5位数字-字母，带连字符）
  //   格式B: "15750"（单独一行5位数字，下一行为"总MA"）
  //   格式C: "25000牙齿模15785MA"（5位数字紧跟MA，无连字符）
  const pcLineIdxs = [];
  for (let i = 0; i < dataLines.length; i++) {
    const line = dataLines[i];
    if (/(\d{5})-[A-Z]+/.test(line)) {
      pcLineIdxs.push(i); // 格式A
    } else if (/^\d{5}$/.test(line) && i + 1 < dataLines.length && /^总?MA/.test(dataLines[i + 1])) {
      pcLineIdxs.push(i); // 格式B
    } else if (/\d{5}MA/.test(line) && !/^[A-Z_]/.test(line)) {
      pcLineIdxs.push(i); // 格式C（排除以大写字母开头的生产单号行）
    }
  }

  if (pcLineIdxs.length === 0) {
    console.log('[ZCS] 未找到货號行，尝试倒序格式解析');
    // 倒序格式：色粉+料型+啤重在前，款号+模具编号+名称在后
    // 锚点：找含模具编号的行（字母-数字M-数字 或 数字-M数字 模式）
    const reversedResult = parseZCSReversed(lines, orderNo);
    if (reversedResult.length > 0) return reversedResult;
    return results;
  }

  // 已知料型列表
  const knownMats = [
    'ABS KF-740', 'ABS 750NSW', 'ABS 750', 'ABS',
    'PP 5090T', 'PP',
    'PVC 110度本白', 'PVC 85度', 'PVC 80度', 'PVC 75度', 'PVC 90度', 'PVC',
    'PC', 'TPR', 'TPE', 'HDPE', 'LDPE', '尼龙',
  ];

  for (let pi = 0; pi < pcLineIdxs.length; pi++) {
    const pcIdx = pcLineIdxs[pi];
    const nextPcIdx = pi + 1 < pcLineIdxs.length ? pcLineIdxs[pi + 1] : dataLines.length;

    // 根据格式提取产品编号
    const pcLine = dataLines[pcIdx];
    let productCode = '';
    if (/(\d{5})-[A-Z]+/.test(pcLine)) {
      productCode = pcLine.match(/(\d{5})-[A-Z]+/)[1]; // 格式A
    } else if (/^\d{5}$/.test(pcLine)) {
      productCode = pcLine; // 格式B
    } else {
      const m = pcLine.match(/(\d{5})MA/);
      if (m) productCode = m[1]; // 格式C
    }

    // 该记录覆盖的行（货號行前3行 + 货號行 + 直到下一货號行）
    const rowStart = Math.max(0, pcIdx - 3);
    const rowLines = dataLines.slice(rowStart, nextPcIdx);

    // 用空字符串连接（用于提取被换行截断的模具编号）
    const rowTextJoined = rowLines.join('');
    // 用空格连接（用于其他字段）
    const rowText = rowLines.join(' ');

    console.log(`[ZCS] 行${pi} rowText:`, rowText.substring(0, 150));

    // ===== 啤数（按格式分别处理，避免跨记录污染）=====
    let quantityNeeded = 0;
    if (/\d{5}MA/.test(pcLine)) {
      // 格式C：qty在pcLine内（如"25000牙齿模15785MA"）或前一行独立整数
      const qm = pcLine.match(/\b(\d{4,})[\u4e00-\u9fa5]/);
      if (qm) {
        quantityNeeded = parseInt(qm[1]);
      } else if (pcIdx > 0 && /^\d{5,}$/.test(dataLines[pcIdx - 1].trim())) {
        quantityNeeded = parseInt(dataLines[pcIdx - 1].trim());
      }
    } else if (/^\d{5}$/.test(pcLine)) {
      // 格式B：qty在pcLine之前的行（如"15000牙齿模"），不向后搜，避免下条记录数字混入
      const preLines = dataLines.slice(Math.max(0, pcIdx - 4), pcIdx);
      const preText = preLines.join(' ');
      const qms = [...preText.matchAll(/\b(\d{4,})[\u4e00-\u9fa5]/g)];
      if (qms.length > 0) quantityNeeded = Math.max(...qms.map(mm => parseInt(mm[1])));
    } else {
      // 格式A：qty在rowText中
      const qms = [...rowText.matchAll(/\b(\d{4,})[\u4e00-\u9fa5]/g)];
      if (qms.length > 0) quantityNeeded = Math.max(...qms.map(mm => parseInt(mm[1])));
      else {
        const bm = rowText.match(/\b(\d{3,})\.\d+/);
        if (bm) quantityNeeded = parseInt(bm[1]);
      }
    }

    // ===== 模具编号：优先从行首匹配（避免数字前缀污染）=====
    let moldNo = '';
    // 方法1：逐行找以大写字母开头的模具行（行首没有数字污染）
    for (let ri = 0; ri < rowLines.length; ri++) {
      const ln = rowLines[ri].trim();
      if (!ln || /^\d/.test(ln)) continue; // 跳过数字开头的行
      const lm = ln.match(/^([A-Z]{2,}[A-Z0-9]*(?:-[A-Z0-9]+)*)/);
      if (!lm || !lm[1].includes('-')) continue;
      let cand = lm[1];
      if (ri + 1 < rowLines.length) {
        const next = rowLines[ri + 1].trim();
        if (ln.endsWith('-') && /^\d/.test(next)) {
          // 情形1：本行末有连字符，下行为数字（如 "FUGG-08M-" + "01"）
          const full = ln + next;
          const fm = full.match(/^([A-Z]{2,}[A-Z0-9]*(?:-[A-Z0-9]+)+)/);
          if (fm) cand = fm[1];
        } else if (!ln.endsWith('-') && /^-[A-Z0-9]/.test(next)) {
          // 情形2：本行无末连字符，下行以"-数字/字母"开头（如 "FUGGE-07M" + "-01"）
          const full = ln + next;
          const fm = full.match(/^([A-Z]{2,}[A-Z0-9]*(?:-[A-Z0-9]+)+)/);
          if (fm) cand = fm[1];
        }
      }
      if (!cand.includes('M')) continue; // 必须含M（如M-01）
      if (cand.includes('_')) continue; // 排除生产单号（含下划线）
      if (!moldNo || cand.length > moldNo.length) moldNo = cand;
    }
    // 方法2：备用 - 从拼接文本中提取（可能含数字前缀污染）
    if (!moldNo) {
      const moldNoRe = /([A-Z]{2,}[A-Z0-9]*(?:-[A-Z0-9]+)+)/g;
      let m;
      while ((m = moldNoRe.exec(rowTextJoined)) !== null) {
        if (m[1].includes('_')) continue;
        let cand = m[1];
        const afterCand = rowTextJoined.substring(m.index + cand.length);
        if (afterCand.startsWith('_')) cand = cand.replace(/[A-Z]+$/, '');
        if (!cand.includes('-')) continue;
        if (!moldNo || cand.split('-').length > moldNo.split('-').length) moldNo = cand;
      }
    }
    if (!moldNo) {
      console.log('[ZCS] 未找到模具编号，跳过');
      continue;
    }

    // ===== 色粉号：从产品码行之后的非中文行中找5位数字（排除产品货号和啤数）=====
    // 过滤含中文的行（如"15000牙齿模"），避免下一条记录前缀混入
    // 用 (?!\d) 代替 \b，可匹配嵌在数字串末尾的色粉号（如"16.8488397"→88397）
    const postLines = dataLines.slice(pcIdx, nextPcIdx);
    const powderLines = postLines.filter(l => !/[\u4e00-\u9fa5]/.test(l));
    const powderText = powderLines.join(' ');
    const allFiveDigits = [...powderText.matchAll(/(\d{5})(?!\d)/g)].map(x => x[1]);
    const qtyStr = quantityNeeded ? String(quantityNeeded) : null;
    const colorPowderNo = allFiveDigits.find(p => p !== productCode && p !== qtyStr) || '';

    // ===== 颜色：中文+"/"+字母数字（允许中间有空格）=====
    const COLOR_HEADERS = new Set(['颜色', '颜', '色']);
    let color = '';
    const colorMatch = rowText.match(/([\u4e00-\u9fa5]+)\s*\/\s*([A-Z0-9]+C?)/);
    if (colorMatch) {
      color = `${colorMatch[1]}/${colorMatch[2]}`;
    } else {
      // 备用：纯中文颜色（如"浅咖色"、"肉色"、"原色"），跳过表头词"颜色"
      for (const cm of rowText.matchAll(/([\u4e00-\u9fa5]{1,5}色|原色|透明|本色)/g)) {
        if (!COLOR_HEADERS.has(cm[1])) { color = cm[1]; break; }
      }
    }

    // ===== 用料名称 =====
    let materialType = '';
    // 优先匹配带#前缀的完整型号，如 "1#PP EP332K"、"2#PVC 85度"
    const numberedGradeMatch = rowText.match(/[12]#(?:PP|ABS|PVC|PC|TPR|TPE)(?:\s+[A-Z][A-Z0-9]*)*/);
    if (numberedGradeMatch) {
      materialType = numberedGradeMatch[0].trim(); // 如 "1#PP EP332K"
    }
    // 无#前缀但有型号，如 "PP EP332K"、"ABS 750NSW"
    if (!materialType) {
      const plainGradeMatch = rowText.match(/(?:PP|ABS|PVC|PC)\s+[A-Z][A-Z0-9]*/);
      if (plainGradeMatch) materialType = plainGradeMatch[0].trim();
    }
    // 再用固定列表兜底
    if (!materialType) {
      for (const km of knownMats) {
        if (rowText.includes(km)) { materialType = km; break; }
      }
    }

    // ===== 单重G：仅在产品码行之后（postLines）提取，避免拾取单价等预行数字 =====
    let shotWeight = 0;
    // 从pcIdx+1开始，跳过产品码行本身（如"15750"会被误判为总重量）
    const postLinesNonChinese = dataLines.slice(pcIdx + 1, nextPcIdx).filter(l => !/[\u4e00-\u9fa5]/.test(l));

    // 策略1：若已知色粉号，在含色粉号的行中提取行首数字作为单重
    // 如 "52.516.888397" → before="52.516.8" → 枚举分割点找合理单重: 52.5
    // 如 "8012.888397"   → before="8012.8"   → 枚举分割点: 80（整数）+ 12.8（比例）
    if (colorPowderNo) {
      for (const pl of postLinesNonChinese) {
        const ci = pl.indexOf(colorPowderNo);
        if (ci > 0) {
          const before = pl.substring(0, ci);
          let found = 0;
          for (let k = 1; k < before.length; k++) {
            const part1 = before.substring(0, k);
            if (!/^\d+(\.\d+)?$/.test(part1) || part1.endsWith('.')) continue;
            const sw = parseFloat(part1);
            if (sw < 10 || sw >= 5000) continue; // 单重通常10-5000g
            const part2 = before.substring(k);
            if (part2.length > 0 && !/^\d/.test(part2)) continue; // 剩余必须以数字开头
            found = sw;
            break;
          }
          if (found) { shotWeight = found; break; }
        }
      }
    }

    // 策略2：postLines中，总重量(≥100KG)之后紧邻的第一个合理纯数字行(1~1000g)
    // ZCS PDF列顺序：用料名称 → 总重量 → 单重G → 色粉号，单重紧跟在总重量之后
    // 限制查找范围：总重量之后最多3行，避免拾取下一条记录的金额
    if (!shotWeight) {
      let passedTotalWeight = false;
      let linesAfterTotal = 0;
      for (const pl of postLinesNonChinese) {
        if (!passedTotalWeight) {
          if (/^\d+\.?\d*$/.test(pl) && parseFloat(pl) >= 100) passedTotalWeight = true;
          continue;
        }
        linesAfterTotal++;
        if (linesAfterTotal > 3) break;
        if (/^\d+\.?\d*$/.test(pl)) {
          const v = parseFloat(pl);
          if (v >= 1 && v < 1000) { shotWeight = v; break; }
        }
      }
    }

    // ===== 备注：短中文词组（过滤颜色名）=====
    let notes = '';
    const colorChars = color.split('/')[0];
    const chineseWords = [...rowText.matchAll(/[\u4e00-\u9fa5]{2,6}/g)].map(x => x[0]);
    const actionNotes = chineseWords.filter(w =>
      !colorChars.includes(w) && !w.match(/透明|度（/) &&
      ['先啤','后啤','注意','先做','后做','急单'].includes(w)
    );
    notes = actionNotes.join(' ');

    // ===== 模号名称：从 "{qty}{产品名}模" 中提取产品描述 =====
    let moldName = moldNo;
    const nameMatch = rowText.match(/\d+([\u4e00-\u9fa5]{1,6})模/);
    if (nameMatch && nameMatch[1]) {
      moldName = moldNo + ' ' + nameMatch[1];
    }

    results.push({
      product_code: productCode,
      mold_no: moldNo,
      mold_name: moldName,
      color,
      color_powder_no: colorPowderNo,
      material_type: materialType,
      shot_weight: shotWeight,
      material_kg: 0,
      quantity_needed: Math.round(quantityNeeded),
      accumulated: 0,
      cavity: 1,
      cycle_time: 0,
      order_no: orderNo,
      is_three_plate: 0,
      packing_qty: 0,
      notes,
    });
  }

  console.log('[ZCS] 解析结果:', results.map(r =>
    `${r.product_code} ${r.mold_no} qty=${r.quantity_needed} color=${r.color} mat=${r.material_type}`
  ));

  // 过滤掉啤重和啤数都为0的无效结果
  const validResults = results.filter(r => r.quantity_needed > 0 || r.shot_weight > 0);

  // 如果有效结果太少，尝试倒序格式
  if (validResults.length <= 1) {
    const reversedResult = parseZCSReversed(lines, orderNo);
    const validReversed = reversedResult.filter(r => r.quantity_needed > 0);
    if (validReversed.length > validResults.length) {
      console.log('[ZCS] 倒序格式结果更好，使用倒序结果');
      return validReversed;
    }
  }

  return validResults.length > 0 ? validResults : results;

  return results;
}

/**
 * 解析倒序格式的 ZCS/CMC/ZWZ PDF（动态按日期行分组）
 *
 * 策略：用日期行（2026-xx-xx 或 2026/x/x）作为每条记录的结束标志
 * 把两个日期行之间的所有行合并成一条记录的文本，然后从中提取各字段
 */
function parseZCSReversed(lines, orderNo) {
  const results = [];

  // 过滤掉表头、页脚、汇总行，只保留数据行
  const skipPatterns = [
    /^$/, /〖/, /特别注明/, /操作员/, /下单人/, /接单人/, /收货人/,
    /啤 机 部/, /供应商/, /塑 胶/, /^第\d+/, /^页，共/, /^\d+页$/,
    /色粉号用料/, /款号模具/, /净重G/, /加工金/, /额\(HK/, /^整啤$/,
    /总净$/, /^重KG/, /加工单价/, /生产单号/, /出单日期/, /交货日期：/,
    /地址：/, /傳真：/, /電話：/, /^(?:ZCS|CMC|ZWZ|ZWY|FDYA|FDTA)\d/,
    /^备\s*注$/, /凡是移印/,
  ];
  const isSkipLine = l => skipPatterns.some(p => p.test(l));
  const isDateLine = l => /^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(l) || /^0?26\/\d{1,2}\/\d{1,2}$/.test(l);

  // 找数据区起点
  let dataStart = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('交货日期') && !lines[i].includes('交货日期：')) {
      dataStart = i + 1; break;
    }
  }

  // 按日期行分组：每遇到日期行就结束一条记录
  const records = [];
  let currentLines = [];
  for (let i = dataStart; i < lines.length; i++) {
    const l = lines[i];
    if (isSkipLine(l)) continue;
    if (isDateLine(l)) {
      if (currentLines.length > 0) {
        records.push(currentLines);
        currentLines = [];
      }
      continue;
    }
    currentLines.push(l);
  }

  console.log('[ZCS动态] 按日期分组:', records.length, '条记录');

  // 已知料型关键词
  const matKeywords = ['ABS', 'MABS', 'PP', 'PVC', 'LDPE', 'POM', 'POK', 'PA6', 'PA-', 'TPR', 'TPE', 'HDPE', 'PC', '尼龙', '透明ABS', '透明MABS'];
  const hasMat = s => matKeywords.some(k => s.toUpperCase().includes(k));
  const colorWords = ['黑', '白', '红', '蓝', '绿', '黄', '灰', '棕', '橙', '紫', '粉', '银', '金', '透明', '啡', '咖', '原色', '浅', '深', '珠光', '玫红', '温变'];
  const hasColor = s => colorWords.some(c => s.includes(c)) || /^\d+[A-Z]\//.test(s) || /^色$/.test(s);

  for (const rec of records) {
    let productCode = '', moldNo = '', moldName = '', color = '';
    let colorPowderNo = '', materialType = '', shotWeight = 0, quantityNeeded = 0;
    let materialKg = 0, notes = '';

    // 逐行分类
    const matLines = [];     // 料型相关行
    const moldLines = [];    // 含模具编号的行
    const colorLines = [];   // 颜色行
    const numberLines = [];  // 纯数字行

    for (const l of rec) {
      // 含模具编号的行（多种格式）
      if ((/[A-Z]{2,}[\w]*-\d+/.test(l) || /[A-Z]+\d+-M\d+-\d+/.test(l)) && /[\u4e00-\u9fa5]/.test(l)) {
        moldLines.push(l);
      } else if (/\d{4,}-[PM]\d+/.test(l) && /[\u4e00-\u9fa5]/.test(l)) {
        moldLines.push(l);
      } else if (/\d{4,5}[A-Z]{2,}-\d+/.test(l) && /[\u4e00-\u9fa5]/.test(l)) {
        moldLines.push(l); // 20388WT-03, 1113-03
      } else if (/\d{5,}-M\d+/.test(l)) {
        moldLines.push(l);
      } else if (/\d{3,}-\d{2}/.test(l) && /[\u4e00-\u9fa5]{2,}/.test(l)) {
        moldLines.push(l); // 1113-03灯罩... (数字-数字+中文名称2字以上)
      } else if (hasMat(l)) {
        matLines.push(l);
      } else if (hasColor(l)) {
        colorLines.push(l);
      } else if (/^\d+\.\d+/.test(l) && !l.includes('喷油')) {
        numberLines.push(l);
      } else if (l.includes('喷油')) {
        notes = '喷油';
        // 也可能含净重（如 "64.8喷油0"）
        const nwm = l.match(/^(\d+\.?\d*)/);
        if (nwm) materialKg = parseFloat(nwm[1]);
      }
    }

    // 提取模具编号和名称
    const moldText = moldLines.join('');
    if (moldText) {
      // 模具编号模式
      const moldPatterns = [
        /([A-Z]{2,}[\w]*-\d+M-\d+(?:-\d+)?)/, // PABR-01M-01
        /([A-Z]+\d+-M\d+-\d+)/,                // PF001-M07-01
        /(\d{5,}-M\d+)/,                        // 1226146-M01
        /(\d{4,5}[A-Z]{2,}-\d+)/,              // 20388WT-03
        /(\d{4,}-P\d+)/,                        // 9680-P01
        /(\d{3,4}-\d{2})/,                      // 1113-03
        /([A-Z]{2,}-\d{4,5}(?:-\d+)?)/,         // YH-10866
      ];
      for (const pat of moldPatterns) {
        const mm = moldText.match(pat);
        if (mm) { moldNo = mm[1]; break; }
      }

      if (moldNo) {
        const idx = moldText.indexOf(moldNo);
        // 款号在模具编号之前
        const before = moldText.substring(0, idx).replace(/[（(][^）)]*[）)]/g, '');
        const pcm = before.match(/(\d{4,7})/);
        if (pcm) productCode = pcm[1];

        // 模具名称在模具编号之后
        const after = moldText.substring(idx + moldNo.length);
        const nm = after.match(/^([\u4e00-\u9fa5/()（）]+)/);
        if (nm) moldName = nm[1];

        // 数字部分：总套数+啤数
        const afterName = nm ? after.substring(nm[0].length) : after;
        // 提取所有数字（包含可能粘连的颜色文字后的数字）
        const digitsOnly = afterName.replace(/[\u4e00-\u9fa5a-zA-Z/（）()]/g, '').replace(/\s/g, '');
        if (digitsOnly.length >= 4) {
          for (let sp = Math.floor(digitsOnly.length / 2) - 1; sp <= Math.ceil(digitsOnly.length / 2) + 1; sp++) {
            if (sp <= 0 || sp >= digitsOnly.length) continue;
            const a = parseInt(digitsOnly.substring(0, sp));
            const b = parseInt(digitsOnly.substring(sp));
            if (a > 0 && b > 0 && a >= b && a <= b * 20) {
              quantityNeeded = b; break;
            }
          }
        }
      }
    }

    if (!moldNo) continue;

    // 如果没款号，从记录行中查找含字母+数字的款号行
    if (!productCode) {
      for (const l of rec) {
        // 跨行款号如 "PF001A1-KMART/PF001A1-KMART/..."
        const pcMatch2 = l.match(/([A-Z]{2,}\d+[A-Z0-9]*(?:-[A-Z]+)?)/);
        if (pcMatch2 && !hasMat(l) && !hasColor(l) && !l.includes('JAZ-')) {
          productCode = pcMatch2[1];
          break;
        }
      }
    }
    // 从模具编号提取（如 1226146-M01 → 1226146）
    if (!productCode) {
      const pcm = moldNo.match(/^(\d{4,7})-/);
      if (pcm) productCode = pcm[1];
    }

    // 提取料型：把所有料型行合并
    const matText = matLines.join(' ');
    if (matText) {
      // 提取色粉号（4-5位数字，在料型关键词之前）
      const cpnMatch = matText.match(/^(\d{4,5})/);
      if (cpnMatch) colorPowderNo = cpnMatch[1];

      // 提取料型名称和啤重
      // 合并后的matText如: "89324POM M90-4420.8" 或 "63138ABS 750NSW76.2" 或 "63374 透明ABS TR558AI 33.0"
      // 去掉色粉号后: "POM M90-4420.8"
      let afterCpn = matText.replace(/^\d{4,5}\s*/, '');
      // 用已知料型列表精确匹配，把料型和啤重分开
      const knownMats = [
        'POM M90-44', 'POM M90',
        'ABS KF-740', 'ABS 750NSW', 'ABS 750', 'ABS 709S', 'ABS AG15AIH', 'ABS GP22', 'ABS GP',
        'ABS 557AI', 'ABS PA-747',
        '透明ABS TR558AI', '透明ABS TR557I', '透明ABS',
        '透明MABS TX-0520IM-NP', '透明MABS',
        'PP EP332K', 'PP 5090T', 'PP 3015', 'PP3015', 'PP 1120', 'PP',
        '1#PP EP332K',
        'PVC 110度本白', 'PVC 95度（透明）', 'PVC 95度（本白）', 'PVC 85度（透明）', 'PVC 85度（本白）',
        'PVC 80度', 'PVC 75度', 'PVC',
        'LDPE 260GG', 'LDPE',
        'POK YM-MF060', 'POK',
        'PA6 1010C2', 'PA6',
        'TPR I603BT-B4709', 'TPR I602BT-B5478', 'TPR',
        'TPE', 'HDPE', 'PC', 'SAN 310NTR', '尼龙',
      ];
      let matched = false;
      for (const km of knownMats) {
        const idx = afterCpn.indexOf(km);
        if (idx >= 0) {
          materialType = km;
          const afterMat = afterCpn.substring(idx + km.length);
          // 啤重是料型后面的数字
          const swMatch = afterMat.match(/^(\d+\.?\d*)/);
          if (swMatch) {
            const sw = parseFloat(swMatch[1]);
            if (sw >= 1 && sw < 1000) shotWeight = sw;
          }
          matched = true;
          break;
        }
      }
      if (!matched) {
        // 兜底：整个文本作为料型
        materialType = afterCpn.replace(/\d+\.?\d*$/, '').trim();
        const swFallback = afterCpn.match(/(\d+\.?\d*)$/);
        if (swFallback) {
          const sw = parseFloat(swFallback[1]);
          if (sw >= 1 && sw < 1000) shotWeight = sw;
        }
      }
    }

    // 提取颜色
    color = colorLines.join('').replace(/\s+/g, '');
    // 颜色也可能嵌在模具行末尾（如 "...40000白色"）
    if (!color && moldText) {
      const embColor = moldText.match(/([\u4e00-\u9fa5]*(?:黑|白|红|蓝|绿|黄|灰|棕|橙|紫|粉|银|金|透明|啡|咖|原色|浅|深|珠光)色?)$/);
      if (embColor) color = embColor[1];
    }

    // 净重KG
    if (!materialKg && numberLines.length > 0) {
      // 最大的数字通常是净重
      for (const nl of numberLines) {
        const v = parseFloat(nl);
        if (v > 10 && v < 100000) materialKg = v;
      }
    }

    const fullMoldName = moldName ? `${moldNo} ${moldName}` : moldNo;

    results.push({
      product_code: productCode,
      mold_no: moldNo,
      mold_name: fullMoldName,
      color,
      color_powder_no: colorPowderNo,
      material_type: materialType,
      shot_weight: shotWeight,
      material_kg: materialKg,
      sprue_pct: 0,
      ratio_pct: 0,
      quantity_needed: quantityNeeded,
      accumulated: 0,
      cavity: 1,
      cycle_time: 0,
      order_no: orderNo,
      is_three_plate: 0,
      packing_qty: 0,
      notes,
    });
  }

  console.log('[ZCS动态] 解析结果:', results.map(r =>
    `${r.product_code} ${r.mold_no} qty=${r.quantity_needed} color=${r.color} mat=${r.material_type} shot=${r.shot_weight}`
  ));
  return results;
}

/**
 * 解析华登直排格式（无JAZ-前缀，如92108啤机更改单）
 * 每行格式: 产品编号+模具编号+名称+颜色/色粉+料型+啤重+数量+腔数+啤数+用料KG+水口%
 * 例: 92108BBCL-01M-01独角兽摇床上壳珠光浅渌/93468
 *     PP(EP332K)+TPE 50
 *     96:4
 *     140.8 62431/23121.5441.7 4%
 */
function parseHuadengDirect(lines, orderNo, text) {
  const results = [];

  // 提取产品编号（从标题行"编号："或"（数字）"）
  let productCode = '';
  const pcMatch = text.match(/[（(](\d{5})[）)]/);
  if (pcMatch) productCode = pcMatch[1];

  // 找含模具编号的行（如 BBCL-01M-01, RBCA-08M-01 等）
  const moldRe = /([A-Z]{2,}-\d+M-\d+)/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const moldMatch = line.match(moldRe);
    if (!moldMatch) continue;

    const moldNo = moldMatch[1];
    const moldIdx = line.indexOf(moldNo);

    // 模具编号之前可能有产品编号
    const before = line.substring(0, moldIdx);
    const pcm = before.match(/(\d{5})/);
    if (pcm) productCode = pcm[1];
    // 也可能有"大摇篮公仔"等前缀（跳过）

    // 模具编号之后提取名称
    const after = line.substring(moldIdx + moldNo.length);
    const nameMatch = after.match(/^([\u4e00-\u9fa5/()（）\s]+)/);
    const moldName = nameMatch ? nameMatch[1].trim() : '';

    // 颜色/色粉号在名称之后
    let color = '', colorPowderNo = '';
    const afterName = nameMatch ? after.substring(nameMatch[0].length) : after;
    const colorMatch = afterName.match(/([\u4e00-\u9fa5+]+(?:\/\d{5})?)/);
    if (colorMatch) {
      const cv = colorMatch[1];
      const cpnM = cv.match(/\/(\d{5})$/);
      if (cpnM) {
        color = cv.substring(0, cv.indexOf('/'));
        colorPowderNo = cpnM[1];
      } else {
        color = cv;
      }
    }

    // 料型在下面几行（含 ABS/PP/PVC/LDPE/POM/TPE/透明 等）
    let materialType = '', shotWeight = 0, quantityNeeded = 0, materialKg = 0, cavity = 1;
    const matLines = [];
    for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
      const nl = lines[j];
      if (moldRe.test(nl)) break; // 下一条记录了
      if (nl.includes('共用模') || nl.includes('PO:') || nl.includes('备注')) break;
      matLines.push(nl);
    }

    const matText = matLines.join(' ');
    // 提取料型
    const matMatch = matText.match(/((?:PP|ABS|PVC|LDPE|POM|TPE|透明ABS|SAN)[^0-9]*)/i);
    if (matMatch) materialType = matMatch[1].trim();

    // 提取啤重（第一个合理小数）
    const swMatch = matText.match(/(\d+\.?\d*)\s+\d+/);
    if (swMatch) {
      const sw = parseFloat(swMatch[1]);
      if (sw > 0 && sw < 1000) shotWeight = sw;
    }

    // 提取数量：格式 "62431/23121.5" → 总套数=6243, 腔数=1/2, 啤数=3121
    // 或 "10001/8125" → 总套数=1000, 腔数=1/8, 啤数=125
    const qtyMatch = matText.match(/(\d+)(\d)\/(\d)(\d+)/);
    if (qtyMatch) {
      // 解析：数字分割点在 cavity(1/X) 处
      // 尝试各种分割
      const fullDigits = matText.match(/(\d+)\/(\d)(\d+)/);
      if (fullDigits) {
        cavity = parseInt(fullDigits[2]);
        quantityNeeded = parseInt(fullDigits[3]);
        // 如果啤数太大或太小，重新分割
        if (quantityNeeded < 10 && fullDigits[3].length > 1) {
          // 可能分割错了，用整个数字
        }
      }
    }

    // 更简单的方式：找 "数字 1/数字 数字" 模式
    const simpleQty = matText.match(/(\d+)\s+(\d)\/(\d)\s*(\d+)/);
    if (simpleQty) {
      quantityNeeded = parseInt(simpleQty[4]);
      cavity = parseInt(simpleQty[3]);
    }

    // 用料KG
    const kgMatch = matText.match(/(\d+\.?\d*)\s+\d+%/);
    if (kgMatch) materialKg = parseFloat(kgMatch[1]);

    if (!moldNo) continue;

    const fullMoldName = moldName ? `${moldNo} ${moldName}` : moldNo;

    results.push({
      product_code: productCode,
      mold_no: moldNo,
      mold_name: fullMoldName,
      color,
      color_powder_no: colorPowderNo,
      material_type: materialType,
      shot_weight: shotWeight,
      material_kg: materialKg,
      sprue_pct: 0,
      ratio_pct: 0,
      quantity_needed: quantityNeeded,
      accumulated: 0,
      cavity,
      cycle_time: 0,
      order_no: orderNo,
      is_three_plate: 0,
      packing_qty: 0,
      notes: '',
    });
  }

  console.log('[华登直排] 解析结果:', results.length, '条');
  return results;
}

module.exports = { parsePdf };
