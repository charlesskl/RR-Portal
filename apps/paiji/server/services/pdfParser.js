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
  const buf = fs.readFileSync(filePath);
  const data = await pdfParse(buf);
  const text = data.text;

  console.log('[PDF] 原始文本前500字符:', text.substring(0, 500));
  console.log('[PDF] 总行数:', text.split('\n').length);

  // 委托加工合同格式（ZCS 单号）
  if (text.includes('委托加工合同')) {
    console.log('[PDF] 检测为委托加工合同格式');
    const result = parseZCSPdf(text);
    console.log('[PDF] 解析结果条数:', result.length);
    return result;
  }
  // 华登格式（啤机喷油生产单）
  if (text.includes('华登啤机') || text.includes('华登注塑') || (text.includes('FDYA-') && text.includes('JAZ-'))) {
    console.log('[PDF] 检测为华登格式');
    const result = parseHuadengPdf(text);
    console.log('[PDF] 解析结果条数:', result.length);
    return result;
  }
  // 兴信格式
  if (text.includes('啤货表') || text.includes('啤 机') || text.includes('生产单号')) {
    console.log('[PDF] 检测为兴信格式');
    const result = parseXingxinPdf(text);
    console.log('[PDF] 解析结果条数:', result.length);
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
  const orderNoMatch = text.match(/FDYA-\d+/);
  const orderNo = orderNoMatch ? orderNoMatch[0] : '';

  const rawLines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const results = [];

  // 产品货号模式：2-6大写字母 + 4+位数字，单独一行或在JAZ-前缀
  const productCodeRe = /^([A-Z]{2,6}\d{4,})$/;
  // 日期行模式（如 26/4/30）
  const dateRe = /^\d{2}\/\d{1,2}\/\d{1,2}$/;

  // 找所有含 JAZ- 的行索引
  const jazIdxs = rawLines.reduce((acc, l, i) => {
    if (l.includes('JAZ-')) acc.push(i);
    return acc;
  }, []);

  if (jazIdxs.length === 0) return results;

  let currentProduct = '';

  for (let ji = 0; ji < jazIdxs.length; ji++) {
    const jazIdx = jazIdxs[ji];
    const nextJazIdx = ji + 1 < jazIdxs.length ? jazIdxs[ji + 1] : rawLines.length;

    // 向前找产品货号行（上一行是单独的货号）
    let entryStart = jazIdx;
    if (jazIdx > 0) {
      const prevLine = rawLines[jazIdx - 1];
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
      if (nj > 0 && !rawLines[nj - 1].includes('JAZ-') && !dateRe.test(rawLines[nj - 1]) &&
          productCodeRe.test(rawLines[nj - 1])) {
        entryEnd = nj - 1;
      }
    }

    // 收集条目行，过滤日期行
    const entryLines = rawLines.slice(entryStart, entryEnd).filter(l => !dateRe.test(l));
    const entryText = entryLines.join(' ');

    // 提取模具编号（M后接2位数字，如 -M01 / -M02）
    const moldNoMatch = entryText.match(/(JAZ-[A-Z0-9]+-M\d{2})/);
    if (!moldNoMatch) continue;
    const moldNo = moldNoMatch[1];

    // 更新产品货号
    const beforeJaz = entryText.slice(0, entryText.indexOf('JAZ-'));
    const productMatch = beforeJaz.match(/([A-Z]{2,6}\d{4,})/);
    if (productMatch) currentProduct = productMatch[1];

    // 模具编号之后的文本
    const afterMoldStart = entryText.indexOf(moldNo) + moldNo.length;
    const afterMold = entryText.slice(afterMoldStart);

    // 机型+目标数（如 18A3600）：目标数为3-4位整数，避免与啤重小数粘连
    const machineMatch = afterMold.match(/(\d{1,2})A(\d{3,4})/);
    if (!machineMatch) continue;
    const target24h = parseInt(machineMatch[2]);

    const beforeMachine = afterMold.slice(0, afterMold.indexOf(machineMatch[0]));
    const afterMachine = afterMold.slice(afterMold.indexOf(machineMatch[0]) + machineMatch[0].length);

    // 啤重G（机型后第一个小数，最多2位小数避免粘连下一个数字）
    const shotMatch = afterMachine.match(/^(\d{1,4}\.\d{1,2})/);
    const shotWeight = shotMatch ? parseFloat(shotMatch[1]) : 0;

    // 需啤数：格式 {订单数} 1/{腔数}{需啤数}，腔数为1位，需啤数紧跟其后
    let quantityNeeded = 0;
    const qtyMatch = afterMachine.match(/(\d+)\s*1\/(\d)\s*(\d+)/);
    if (qtyMatch) {
      quantityNeeded = parseInt(qtyMatch[3]);
    }

    // 色粉号（/ 后4-6位数字）
    const powderMatch = beforeMachine.match(/\/\s*(\d{4,6})/);
    const colorPowder = powderMatch ? powderMatch[1] : '';

    // 用料类型
    let material = '';
    const matPatterns = [
      /透明ABS\s*[\w+():\d\/\s.-]*/,
      /ABS\s*[\w+():\d\/\s.-]*/,
      /PP[\u4e00-\u9fa5]+/,                           // PP黑色抽粒 等含中文的PP料型
      /PP\s*[\w+():\d\/\s.()\[\]-]*/,
      /TPR[\w\s.-]*/,
      /PVC[\w\s.-]*/,
      /KR\d+[\w\s.-]*/,                               // KR03 等KR系列料型
      /K料[\w\s.-]*/,
    ];
    for (const pat of matPatterns) {
      const m = beforeMachine.match(pat);
      if (m) {
        material = m[0].trim().replace(/\s+$/, '');
        break;
      }
    }

    // 先提取颜色，再用颜色定位模具名称（避免名称混入颜色）
    const textBeforeMat = material
      ? beforeMachine.slice(0, beforeMachine.indexOf(material))
      : beforeMachine;
    const cleanForColor = textBeforeMat.replace(/\/\s*\d{4,6}/, '').replace(/[A-Z0-9]{4,}/g, '');
    const colorWords = [...cleanForColor.matchAll(/((?:高光|浅|深|淡|半透明)?(?:黑|白|红|蓝|绿|黄|灰|棕|橙|紫|粉|金|银|肉|咖|透明|本白|奶白)色?(?:\/\w+)?)/g)];
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

  // 提取采购单号（支持 ZCS / CMC 格式）
  const orderNoMatch = text.match(/(?:ZCS|CMC)\d{6,}/);
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
    console.log('[ZCS] 未找到货號行，dataLines:', dataLines.slice(0, 10));
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
  return results;
}

module.exports = { parsePdf };
