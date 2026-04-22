const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const XLSX = require('xlsx');

const DATA_FILE = path.join(__dirname, '..', 'data', 'molds.json');
const upload = multer({ dest: path.join(__dirname, '..', 'uploads') });

function readMolds() {
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}
function writeMolds(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// 下载排模表模板
router.get('/template', (req, res) => {
  const wb = XLSX.utils.book_new();
  const data = [
    ['模具编号', '模穴', '周期', '机台型号', '单件重量'],
    ['RABTB-01M-01', 1, 30, '24A', 50],
    ['RABTB-03M-01', 2, 28, '12A', 45],
    ['MCKP-01M-01',  4, 25, '36A', 30],
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [{ wch: 18 }, { wch: 8 }, { wch: 8 }, { wch: 12 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, ws, '排模表');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename*=UTF-8\'\'%E6%8E%92%E6%A8%A1%E8%A1%A8%E6%A8%A1%E6%9D%BF.xlsx');
  res.send(buf);
});

// 获取所有排模数据
router.get('/', (req, res) => {
  res.json(readMolds());
});

// 新增排模
router.post('/', (req, res) => {
  const molds = readMolds();
  const mold = { ...req.body, id: Date.now().toString(), createdAt: new Date().toISOString() };
  molds.push(mold);
  writeMolds(molds);
  res.json(mold);
});

// 更新排模
router.put('/:id', (req, res) => {
  const molds = readMolds();
  const idx = molds.findIndex(m => m.id === req.params.id);
  if (idx === -1) return res.status(404).json({ message: '排模记录不存在' });
  molds[idx] = { ...molds[idx], ...req.body };
  writeMolds(molds);
  res.json(molds[idx]);
});

// 删除排模
router.delete('/:id', (req, res) => {
  const molds = readMolds();
  writeMolds(molds.filter(m => m.id !== req.params.id));
  res.json({ message: '已删除' });
});

// 导入 Excel
// 在原始行数组中自动找含关键字的表头行
function findHeaderRow(rawRows) {
  const strongKeys = ['模具编号', '模具号', '工模编号', '工模号', 'MoldNo', 'Mold No', 'mold_no'];
  const weakKeys = [
    '模穴', '穴数', '模腔数', 'Cavity', 'cavity',
    '周期', '成型周期', '射出时间', 'Cycle', 'cycle', 'CT',
    '日产能', '产能',
    '机台', '机型', '注塑机', '啤机', 'Machine', 'machine',
    '单件重量', '单净重', '件重', '重量', 'Weight', 'weight',
  ];
  for (let i = 0; i < rawRows.length; i++) {
    const row = rawRows[i].map(c => String(c ?? ''));
    if (row.some(c => strongKeys.some(k => c.trim() === k || c.includes(k)))) return i;
    const weakHits = row.filter(c => weakKeys.some(k => c.includes(k))).length;
    if (weakHits >= 2) return i;
  }
  return 0;
}

router.post('/import', upload.single('file'), (req, res) => {
  try {
    const wb = XLSX.readFile(req.file.path);
    const ws = wb.Sheets[wb.SheetNames[0]];

    // 读取原始二维数组（不自动用第一行当表头）
    const rawRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    // 找到真正的表头行
    const headerRowIdx = findHeaderRow(rawRows);
    const headers = rawRows[headerRowIdx].map(c => String(c ?? '').trim());
    const dataRows = rawRows.slice(headerRowIdx + 1);

    // 根据表头定位列索引（包含关键字即匹配）
    const findIdx = (...keywords) => headers.findIndex(h => keywords.some(k => h.includes(k)));
    const colIdx = {
      模具编号: findIdx('工模编号', '模具编号', '模具号', '工模号', 'MoldNo'),
      工模名称: findIdx('工模名称', '模具名称'),
      模穴:    findIdx('整啤模腔数', '模腔数', '模穴', '穴数', 'Cavity'),
      周期:    findIdx('周期', 'Cycle', 'CT'),
      日产能:  findIdx('日产能', '模具日产能', '产能'),
      机台型号: findIdx('啤机机型', '机台型号', '机台', '机器', 'Machine', '啤机'),
      单件重量: findIdx('单净重', '单件重量', '净重', '重量', 'Weight'),
      色粉编号: findIdx('色粉号', '色粉编号'),
      料型:    findIdx('用料名称', '料型', '材料'),
      水口比率: findIdx('水口比率', '水口百分比', '水口比例'),
      混水口比率: findIdx('混水口比例', '混水口'),
      啤重G:   findIdx('整啤毛重', '啤重G', '啤重'),
    };

    const get = (row, key) => {
      const idx = colIdx[key];
      return idx >= 0 ? String(row[idx] ?? '').trim() : '';
    };

    const molds = readMolds();
    let added = 0;
    let updated = 0;

    dataRows.forEach(row => {
      const 模具编号 = get(row, '模具编号');
      if (!模具编号) return; // 只处理有模具编号的行（跳过子行）

      // 周期：优先取直接列，否则从日产能计算（周期=24*3600÷日产能）
      let 周期val = Number(get(row, '周期')) || 0;
      if (!周期val) {
        const 产能 = Number(get(row, '日产能'));
        if (产能 > 0) 周期val = Math.round(24 * 3600 / 产能);
      }
      if (!周期val) 周期val = 30;

      const idx = molds.findIndex(m => m.模具编号 === 模具编号);
      const entry = {
        模具编号,
        工模名称: get(row, '工模名称'),
        模穴:    Number(get(row, '模穴'))    || 1,
        周期:    周期val,
        机台型号: get(row, '机台型号'),
        单件重量: Number(get(row, '单件重量')) || 0,
        色粉编号: get(row, '色粉编号'),
        料型:    get(row, '料型'),
        水口比率: parseFloat(get(row, '水口比率')) || 0,
        混水口比率: parseFloat(get(row, '混水口比率')) || 0,
        啤重G:   Number(get(row, '啤重G')) || 0,
      };
      if (idx !== -1) {
        molds[idx] = { ...molds[idx], ...entry };
        updated++;
      } else {
        molds.push({ ...entry, id: Date.now().toString() + Math.random().toString(36).slice(2), createdAt: new Date().toISOString() });
        added++;
      }
    });

    writeMolds(molds);
    fs.unlinkSync(req.file.path);

    let msg;
    if (added === 0 && updated === 0) {
      const preview = rawRows.slice(0, 5).map((r, i) => `第${i+1}行：${r.filter(Boolean).join('、')}`).join(' | ');
      msg = `导入完成，但未识别到有效数据。\n文件前5行内容：${preview}\n` +
            `请确认文件包含以下列之一：模具编号/模具号，以及 模穴/穴数、周期/成型周期、机台型号/机台`;
    } else {
      msg = `导入成功，新增 ${added} 条，更新 ${updated} 条`;
    }
    res.json({ message: msg, added, updated });
  } catch (err) {
    res.status(500).json({ message: '导入失败：' + err.message });
  }
});

module.exports = router;
