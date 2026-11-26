const { endsWithJazwaresCustomer, packagingFromNotes } = require('./jazwares-packaging');
/**
 * Sky Castle PO PDF 解析器
 *
 * pdf-parse提取后格式:
 *   表头: SKUSKUDescriptionDescriptionQtyQtyPricePriceTotalTotal
 *   每个item块: SKU + description多行 + 数字行: "7501.471,102.50"
 *   数字行格式: Qty + Price(2位小数) + Total(2位小数) 连在一起
 */

function detect(text) {
  return text.includes('Sky Castle') || text.includes('skycastletoys') || text.includes('SKY CASTLE');
}

function parse(text, filename) {
  const result = {
    client: 'Sky Castle',
    poNumber: '',
    customerPO: '',
    creationDate: '',
    shippingDate: '',
    shipTo: '',
    items: [],
    notes: '',
    packaging: '',
    filename,
  };

  // Extract PO number
  // PO 号可能带 "-N" 后缀（PO0000303-1 / PO0000303-2 等子单）
  const poMatch = text.match(/(PO\d{5,}(?:-\d+)?)/);
  if (poMatch) result.poNumber = poMatch[1];

  // Extract Customer Purchase Order
  // pdf-parse 提取后的两种常见格式：
  //   (a) "INT297100 (WMCA PO 7000994984)Customer Purchase Order:"  — 值在标签前
  //   (b) "Customer Purchase Order:INT297100 (WMCA PO 7000994984)"  — 值在标签后
  // 先试模式 (a)（跟 Creation date / Shipping date 一致）
  let custPOMatch = text.match(/([A-Z0-9][^\n]*?)Customer Purchase Order/i);
  if (!custPOMatch) {
    custPOMatch = text.match(/Customer Purchase Order[:\s]*([^\n]+)/i);
  }
  if (custPOMatch) {
    // 去掉结尾可能的重复标签、冒号和空白
    result.customerPO = custPOMatch[1]
      .replace(/Customer Purchase Order.*$/i, '')
      .replace(/^[:：\s]+|[:：\s]+$/g, '')
      .trim();
  }

  // Extract dates
  const createMatch = text.match(/(\w+\s+\d{1,2},?\s+\d{4})Creation date/i) ||
                      text.match(/Creation date[:\s]*(\w+\s+\d{1,2},?\s+\d{4})/i);
  if (createMatch) result.creationDate = parseDateUS(createMatch[1]);

  const shipMatch = text.match(/(\w+\s+\d{1,2},?\s+\d{4})Shipping date/i) ||
                    text.match(/Shipping date[:\s]*(\w+\s+\d{1,2},?\s+\d{4})/i);
  if (shipMatch) result.shippingDate = parseDateUS(shipMatch[1]);

  // Extract Ship To
  const shipToMatch = text.match(/SHIP TO(?:SHIP TO)?\s*\n([\s\S]*?)(?:VENDOR|$)/i);
  if (shipToMatch) {
    result.shipTo = shipToMatch[1].trim().split('\n').map(l => l.trim()).filter(Boolean).join(', ');
  }

  // Extract notes
  const notesMatch = text.match(/NOTES(?:NOTES)?\s*\n([\s\S]*?)(?:Bill order|$)/i);
  if (notesMatch) result.notes = notesMatch[1].trim();

  // Extract Packaging 版本信息 — 按优先级依次匹配：
  //   (1) "Packaging: 2L ENGLISH/FRENCH" / "Packaging artwork: COUK" — 明确标签
  //   (2) "NL LANG/LANG" 模式（如 REMARKS 里的 "2) 2L ENGLISH/FRENCH"）
  //   (3) NOTES 里形如 "*US Generic packaging, will apply importer label" — 没有标签但描述了包装
  let packaging = '';
  const pkgLabelMatch = text.match(/Packaging(?:\s+(?:artwork|version))?\s*[:：]\s*([^\n]+)/i);
  if (pkgLabelMatch) {
    packaging = pkgLabelMatch[1].trim().replace(/[;；]$/, '').trim();
  }
  if (!packaging) {
    const langMatch = text.match(/\b(\d+L\s+[A-Z]+(?:\/[A-Z]+)+)\b/);
    if (langMatch) packaging = langMatch[1].trim();
  }
  if (!packaging) {
    // 在 NOTES/body 中找包含 packaging 关键词的描述行
    // 覆盖 "*US Generic packaging, will apply importer label"
    //     "(1) US PACKAGING" / "(2) UK PACKAGING" 等 NOTES 编号列表
    //     "Packaging Artwork: All the packaging artwork is same as..."
    const lines = text.split('\n');
    for (const line of lines) {
      if (!/packag/i.test(line) || line.length >= 200) continue;
      if (/label|artwork|generic|\bUS\b|\bUK\b|\bCOUK\b/i.test(line)) {
        // 去掉开头的 *、-、数字.、(数字)、空白
        packaging = line.replace(/^[\s*•\-]*(?:[（(]?\d+[.)）]\s*)?/, '').trim();
        break;
      }
    }
  }
  if (packaging) result.packaging = packaging;

  // Parse items from the text
  // Strategy: find lines that are purely numbers (qty+price+total)
  // These lines look like: "7501.471,102.50" or "1,1040.90993.60" or "2,0160.000.00"
  // Pattern: Qty + Price(x.xx) + Total(x,xxx.xx or x.xx)
  // From right: Total = last xxx.xx, Price = second-to-last x.xx, Qty = remaining digits

  const lines = text.split('\n');

  // First, identify the table zone
  // 注意：多页 PDF 会重复表头，只取第一次出现的位置作为表起点
  let tableStartIdx = -1;
  let tableEndIdx = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (tableStartIdx < 0 && (lines[i].includes('TotalTotal') || lines[i].match(/^Total\s*$/))) {
      tableStartIdx = i + 1;
    }
    if (lines[i].includes('Total units:') || lines[i].includes('Total units')) {
      tableEndIdx = i;
      break;
    }
  }

  if (tableStartIdx < 0) {
    // Try alternative table start
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].match(/SKU.*Description.*Qty.*Price/i)) {
        tableStartIdx = i + 1;
        break;
      }
    }
  }

  if (tableStartIdx < 0) return result;

  // Now scan the table zone for items
  // Each item has: SKU line(s) with description, followed by a numbers-only line
  let currentSku = '';
  let currentDesc = '';
  const seen = new Set();

  for (let i = tableStartIdx; i < tableEndIdx; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // "Importer label" is not a separate line item in the schedule
    // Instead, its unit price goes into the remarks of each product row as "贴纸$X.XX一张"
    // In pdf-parse output, it may appear as: "Importer labelImporter label6,4140.02128.28" (all one line)
    if (line.toLowerCase().includes('importer label')) {
      const numbersInLine = line.match(/([\d,]+\.[\d,.]+)$/);
      if (numbersInLine) {
        const parsed = parseNumbersLine(numbersInLine[1]);
        if (parsed) {
          result.labelUnitPrice = parsed.price;
          result.labelQty = parsed.qty;
          result.labelTotal = parsed.total;
        }
      } else {
        currentSku = 'IMPORTER_LABEL';
      }
      continue;
    }

    // "MOQ COST" 行 — 客户因为订单未达起订量而加收的一次性费用
    // pdf-parse 输出形如: "MOQ COST1390.00390.00" 或 SKU 列无值单独 "MOQ COST" 一行
    if (/\bMOQ\s*COST\b/i.test(line) || /^MOQ\b/i.test(line)) {
      const numbersInLine = line.match(/([\d,]+\.[\d,.]+)$/);
      if (numbersInLine) {
        const parsed = parseNumbersLine(numbersInLine[1]);
        if (parsed) {
          result.moqCost = parsed;
        }
      } else {
        currentSku = 'MOQ_COST';
        currentDesc = 'MOQ COST';
      }
      continue;
    }

    // Check if line starts with a SKU pattern
    // pdf-parse often doubles: "SR600SR600 description..." or "SR1023CDU-24STICKI ROLLS..."
    const skuMatch = line.match(/^((?:SR|JS|JC|SRSM|SRTD|SRMC|SRBFF|SRAP)[\w-]+)/);
    if (skuMatch) {
      let sku = skuMatch[1];
      let rest = line.substring(skuMatch[0].length).trim();

      // Handle doubled SKU: "SR600SR600 desc" or "SR1023CDU-24SR1023CDU-24desc"
      // Check if first half equals second half
      if (sku.length >= 8) {
        const half = Math.floor(sku.length / 2);
        for (let len = 4; len <= half; len++) {
          const prefix = sku.substring(0, len);
          const afterPrefix = sku.substring(len);
          if (afterPrefix.startsWith(prefix)) {
            rest = afterPrefix.substring(prefix.length) + ' ' + rest;
            sku = prefix;
            break;
          }
        }
      }

      // Also trim trailing description words from SKU
      // SKU 形如:
      //   SR1023CDU-24       SR + 4digits + CDU-24
      //   SRAP4302-CDU12     SR + 2letters + 4digits + -CDU12 (连字符在 CDU 前)
      //   SRAP1302CDU-24     SR + 2letters + 4digits + CDU-24
      //   SRMC302            SR + 2letters + 3digits
      //   SR102C-CDU-16      SR + 3digits + 字母后缀 C + -CDU + -16
      //   SR600              SR + 3digits
      //   JC100CDU-24        JC + 3digits + CDU-24
      //   JC120-ECOMM-2PK-A  JC + 3digits + -ECOMM + -2PK + -A (亚马逊 ECOMM 系列)
      //   SR8003-ECOMM-2PK-A SR + 4digits + -ECOMM + -2PK + -A
      //   SRMC103-ECOMM-2PK  SR + 2letters + 3digits + -ECOMM-2PK (无尾部字母)
      //   SRMC400-ECOMM-A    SR + 2letters + 3digits + -ECOMM-A (无 -NPK)
      // 字母后缀 (如 SR102C 的 C) 只有后面接 -|CDU|末尾 时才算，避免吃到描述 "SRAP3202STICKI" 的 S
      const skuClean = sku.match(/^((?:SR|JS|JC)(?:[A-Z]{2,3})?\d+(?:[A-Z](?=-|CDU|$))?(?:-?CDU\d*)?(?:-\d+)?(?:-ECOMM(?:-\d+PK)?(?:-[A-Z])?)?)/);
      if (skuClean && skuClean[1].length < sku.length) {
        rest = sku.substring(skuClean[1].length) + ' ' + rest;
        sku = skuClean[1];
      }

      // Also check if the rest starts with the sku (separate doubling)
      if (rest.startsWith(sku)) {
        rest = rest.substring(sku.length).trim();
      }

      currentSku = sku;
      currentDesc = rest;
      continue;
    }

    // Check if this is a numbers line (qty + price + total concatenated)
    // e.g., "7501.471,102.50" = qty:750, price:1.47, total:1,102.50
    // Must have exactly 2 dots (price decimal + total decimal)
    if (/^[\d,.]+$/.test(line) && currentSku) {
      // Only attempt parsing if line has dots (skip pure digit lines like UPC codes)
      const dotCount = (line.match(/\./g) || []).length;
      if (dotCount === 2) {
        const parsed = parseNumbersLine(line);
        if (parsed) {
          if (currentSku === 'IMPORTER_LABEL') {
            // Store label unit price for remarks — don't create a line item
            result.labelUnitPrice = parsed.price;
            result.labelQty = parsed.qty;
            result.labelTotal = parsed.total;
          } else if (currentSku === 'MOQ_COST') {
            result.moqCost = parsed;
          } else {
            const key = `${currentSku}-${parsed.qty}-${parsed.price}`;
            if (!seen.has(key)) {
              seen.add(key);
              result.items.push({
                partNo: currentSku,
                custPartNo: '',
                description: currentDesc,
                dueDate: result.shippingDate,
                quantity: parsed.qty,
                unitPrice: parsed.price,
                amount: parsed.total,
                country: extractCountry(result.shipTo),
                purchasePoint: '',
                factory: '',
              });
            }
          }
        }
        currentSku = '';
        currentDesc = '';
      }
      // If no dots or wrong dot count, don't reset - it's likely a UPC code
    }
  }

  // If Importer label was found, add its info as remark to all product items
  if (result.labelUnitPrice != null && result.labelUnitPrice > 0) {
    const labelNote = `贴纸$${result.labelUnitPrice}一张`;
    result.items.forEach(item => {
      item.remark = labelNote;
    });
  }

  // MOQ 费用：作为独立一行加入 items（货号 "MOQ COST"，qty/price/total 照搬）
  // 用户可在排期表里人工决定保留/删除
  if (result.moqCost && result.moqCost.total > 0) {
    result.items.push({
      partNo: 'MOQ COST',
      custPartNo: '',
      description: 'MOQ COST',
      dueDate: result.shippingDate,
      quantity: result.moqCost.qty,
      unitPrice: result.moqCost.price,
      amount: result.moqCost.total,
      country: extractCountry(result.shipTo),
      purchasePoint: '',
      factory: '',
      isMoqCost: true,
    });
  }

  // Parse diversion/amend info from NOTES
  // Sky Castle patterns: "from PO XXXXXXX", "split from PO", etc.
  const fullText = text;
  const fromPOMatch = fullText.match(/from\s+PO\s*#?\s*(PO\d+|\d+)/i);
  const toPOMatch = fullText.match(/(?:split|transfer|divert)\w*\s+(?:to|into)\s+PO\s*#?\s*(PO\d+|\d+)/i);
  const amendMatch = fullText.match(/amend[:\s]*(.+?)(?:\n|$)/i);

  if (fromPOMatch) {
    result.items.forEach(item => {
      item.divertedFrom = { sourcePO: fromPOMatch[1], qty: item.quantity };
    });
  }
  if (toPOMatch) {
    result.items.forEach(item => {
      item.divertedTo = { targetPO: toPOMatch[1], qty: item.quantity };
    });
  }
  if (amendMatch) {
    result.amendNote = amendMatch[1].trim();
  }

  const shipToName = shipToMatch?.[1].trim().split(/\n/)[0] || '';
  if (endsWithJazwaresCustomer(shipToName)) {
    try {
      const version = packagingFromNotes(result.notes);
      if (version) for (const item of result.items) item.customerPackaging = version;
    } catch (err) {
      result.error = err.message;
      result.items = [];
    }
  }
  return result;
}

/**
 * Parse a concatenated numbers line like "7501.471,102.50" into {qty, price, total}
 *
 * 格式说明:
 *   PDF 抽取后数字行形如 "{qty}{price}{total}"（无空格），其中
 *   - qty  可带千位逗号（如 "3,000"），整数
 *   - price 两位小数（如 "1.47"）
 *   - total 两位小数（可带千位逗号，如 "1,102.50"）
 *
 * 策略:
 *   1) 标准场景（price>0）: 暴力尝试所有 split 点，找 qty*price ≈ total 的
 *   2) 0 价 + 0 金额场景（补货/样品）: 无法用乘积校验，
 *      此时令 price 占位 "0.00"（dots[0]-1 处开始），剩下的前缀数字全归 qty。
 *      旧版 bug 是首次命中 priceStart=1 就返回 qty=3 (实际 3000)。
 */
function parseNumbersLine(line) {
  const clean = line.replace(/,/g, '');

  const dots = [];
  for (let i = 0; i < clean.length; i++) {
    if (clean[i] === '.') dots.push(i);
  }
  if (dots.length !== 2) return null;

  const priceEnd = dots[0] + 3;
  const totalStr = clean.substring(priceEnd);
  const total = parseFloat(totalStr);
  if (isNaN(total)) return null;

  // 第一轮：找 qty * price ≈ total 的精确匹配（跳过 price=0 的候选）
  for (let priceStart = 1; priceStart <= dots[0]; priceStart++) {
    const qtyStr = clean.substring(0, priceStart);
    const priceStr = clean.substring(priceStart, priceEnd);
    const qty = parseInt(qtyStr, 10);
    const price = parseFloat(priceStr);
    if (isNaN(qty) || isNaN(price) || price === 0) continue;

    const computed = Math.round(qty * price * 100) / 100;
    if (Math.abs(computed - total) < 0.02) {
      return { qty, price, total };
    }
  }

  // 第二轮：0 价 + 0 金额场景。priceStart = dots[0] - 1 让 priceStr 恰好是 "0.00"
  // （1 位整数 + ".00"），qty 占前面所有数字。
  if (total === 0 && dots[0] >= 2) {
    const priceStart = dots[0] - 1;
    const qtyStr = clean.substring(0, priceStart);
    const priceStr = clean.substring(priceStart, priceEnd);
    const qty = parseInt(qtyStr, 10);
    const price = parseFloat(priceStr);
    if (!isNaN(qty) && !isNaN(price) && price === 0) {
      return { qty, price, total };
    }
  }

  return null;
}

function parseDateUS(dateStr) {
  if (!dateStr) return '';
  const months = {
    Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
    Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
    January: '01', February: '02', March: '03', April: '04',
    June: '06', July: '07', August: '08', September: '09',
    October: '10', November: '11', December: '12',
  };
  const m = dateStr.match(/(\w+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (m) {
    return `${m[3]}-${months[m[1]] || '01'}-${m[2].padStart(2, '0')}`;
  }
  return dateStr;
}

function extractCountry(shipTo) {
  if (!shipTo) return '';
  // 取地址最后一个有效部分作为国家（PO里国家永远是地址最后一行）
  const parts = shipTo.split(',').map(s => s.trim()).filter(Boolean);
  const lastPart = parts[parts.length - 1] || '';

  // 翻译常见英文国家名
  const map = {
    'indonesia': '印尼', 'united states': '美国', 'usa': '美国',
    'united kingdom': '英国', 'uk': '英国', 'australia': '澳大利亚',
    'ireland': '爱尔兰', 'mexico': '墨西哥', 'greece': '希腊',
    'france': '法国', 'germany': '德国', 'canada': '加拿大',
    'japan': '日本', 'serbia': '塞尔维亚', 'turkey': '土耳其',
    'spain': '西班牙', 'italy': '意大利', 'netherlands': '荷兰',
    'belgium': '比利时', 'brazil': '巴西', 'poland': '波兰',
    'mongolia': '蒙古', 'philippines': '菲律宾', 'south korea': '韩国',
    'korea': '韩国', 'china': '中国', 'hong kong': '香港',
    'taiwan': '台湾', 'malaysia': '马来西亚', 'singapore': '新加坡',
    'thailand': '泰国', 'vietnam': '越南', 'romania': '罗马尼亚',
    'czech republic': '捷克', 'hungary': '匈牙利', 'croatia': '克罗地亚',
    'new zealand': '新西兰', 'south africa': '南非', 'chile': '智利',
    'colombia': '哥伦比亚', 'peru': '秘鲁', 'uruguay': '乌拉圭',
    'argentina': '阿根廷', 'egypt': '埃及', 'israel': '以色列',
    'uae': '阿联酋', 'saudi arabia': '沙特', 'india': '印度',
    'pakistan': '巴基斯坦', 'bangladesh': '孟加拉', 'russia': '俄罗斯',
    'sweden': '瑞典', 'norway': '挪威', 'denmark': '丹麦',
    'finland': '芬兰', 'austria': '奥地利', 'switzerland': '瑞士',
    'portugal': '葡萄牙',
  };

  const lower = lastPart.toLowerCase().replace(/[.\d]/g, '').trim();
  if (map[lower]) return map[lower];

  // 也在整个shipTo里找
  for (const [en, cn] of Object.entries(map)) {
    if (shipTo.toLowerCase().includes(en)) return cn;
  }

  // 找不到翻译就原样返回
  return lastPart;
}

module.exports = { detect, parse };
