# 生产计划管理系统 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 order-sync 系统从"扫描Z盘+金山文档"改为"上传Excel → SQLite数据库 → 网页排单 → 导出Excel"的完整生产计划管理系统。

**Architecture:** Express + SQLite (better-sqlite3) 后端，React + Ant Design + Handsontable 前端。上传 Excel 后用 JSZip 解析 XML 检测行颜色（黄=新单，蓝=修改单），预览后导入数据库，网页端排单编辑，按车间导出 Excel。

**Tech Stack:** Node.js, Express, better-sqlite3, JSZip, ExcelJS, multer, React 18, Ant Design 5, Handsontable, Vite

**Existing Code:** 大部分代码已存在（之前重写时写过），本计划主要是修复、连接和完善。

---

## Task 1: 安装依赖

**Files:**
- Modify: `server/package.json`
- Modify: `client/package.json`

**Step 1: 安装服务端依赖**

```bash
cd C:/Users/Administrator/zouhuo-system/order-sync/server
npm install better-sqlite3 multer
```

better-sqlite3 用于 SQLite 数据库，multer 用于文件上传处理。
jszip 和 xlsx 已安装。

**Step 2: 安装客户端依赖**

```bash
cd C:/Users/Administrator/zouhuo-system/order-sync/client
npm install handsontable @handsontable/react
```

Handsontable 用于类 Excel 表格编辑。

**Step 3: 验证依赖安装成功**

```bash
cd C:/Users/Administrator/zouhuo-system/order-sync/server && node -e "require('better-sqlite3'); require('multer'); console.log('server deps OK')"
cd C:/Users/Administrator/zouhuo-system/order-sync/client && node -e "require('handsontable'); console.log('client deps OK')"
```

**Step 4: Commit**

```bash
git add server/package.json server/package-lock.json client/package.json client/package-lock.json
git commit -m "chore: add better-sqlite3, multer, handsontable dependencies"
```

---

## Task 2: XML 颜色检测服务

**Files:**
- Create: `server/services/color-reader.js`

核心模块：用 JSZip 解析 xlsx 文件的 XML，准确读取单元格颜色。已验证此方案可以 100% 检测到黄色/蓝色行（ExcelJS 读不到这些文件的颜色）。

**Step 1: 创建 color-reader.js**

```js
const JSZip = require('jszip');
const XLSX = require('xlsx');

// 黄色系 ARGB 值（新单）
const YELLOW_COLORS = new Set([
  'FFFFFF00', 'FFFFC000', 'FFFFF2CC', 'FFFFEB9C', 'FFFFFF99',
  'FFFFD966', 'FFFFFFE0', 'FFFFED00', 'FFFFCC00',
]);

// 蓝色系 ARGB 值（修改单）
const BLUE_COLORS = new Set([
  'FF9DC3E6', 'FF4472C4', 'FFBDD7EE', 'FF2E75B6', 'FF9BC2E6',
  'FF00B0F0', 'FF0070C0', 'FFB8CCE4', 'FFDAE3F3', 'FF1F77B4',
]);

function isYellowColor(rgb) {
  if (!rgb) return false;
  const upper = rgb.toUpperCase().replace(/^#/, '');
  // 补全为 8 位 ARGB
  const argb = upper.length === 6 ? 'FF' + upper : upper;
  return YELLOW_COLORS.has(argb);
}

function isBlueColor(rgb) {
  if (!rgb) return false;
  const upper = rgb.toUpperCase().replace(/^#/, '');
  const argb = upper.length === 6 ? 'FF' + upper : upper;
  return BLUE_COLORS.has(argb);
}

/**
 * 解析 theme 颜色表
 * Excel theme 顺序: dk1, lt1, dk2, lt2, accent1-6, hlink, folHlink
 * 但 Excel 内部映射是: 0=lt1, 1=dk1, 2=lt2, 3=dk2, 4+=accent1...
 */
function parseThemeColors(themeXml) {
  const colors = [];
  const schemeMatch = themeXml.match(/<a:clrScheme[^>]*>([\s\S]*?)<\/a:clrScheme>/);
  if (!schemeMatch) return colors;

  const entries = schemeMatch[1].match(/<a:(dk1|lt1|dk2|lt2|accent[1-6]|hlink|folHlink)>([\s\S]*?)<\/a:\1>/g);
  if (!entries) return colors;

  const ordered = [];
  for (const entry of entries) {
    const sysMatch = entry.match(/lastClr="([^"]+)"/);
    const srgbMatch = entry.match(/srgbClr val="([^"]+)"/);
    ordered.push(sysMatch ? sysMatch[1] : (srgbMatch ? srgbMatch[1] : '000000'));
  }

  // Excel 内部 theme index 映射: 0→lt1, 1→dk1, 2→lt2, 3→dk2, 4+→accent1...
  if (ordered.length >= 4) {
    colors[0] = ordered[1]; // dk1 → theme 0 实际是 lt1
    colors[1] = ordered[0]; // lt1 → theme 1 实际是 dk1
    colors[2] = ordered[3]; // dk2
    colors[3] = ordered[2]; // lt2
    for (let i = 4; i < ordered.length; i++) {
      colors[i] = ordered[i];
    }
  }
  return colors;
}

/**
 * 应用 tint 到颜色值（Excel 的亮度调整）
 * tint > 0: 混白色; tint < 0: 混黑色
 */
function applyTint(hexColor, tint) {
  if (!tint || tint === 0) return hexColor;
  const r = parseInt(hexColor.substring(0, 2), 16);
  const g = parseInt(hexColor.substring(2, 4), 16);
  const b = parseInt(hexColor.substring(4, 6), 16);

  let nr, ng, nb;
  if (tint > 0) {
    nr = Math.round(r + (255 - r) * tint);
    ng = Math.round(g + (255 - g) * tint);
    nb = Math.round(b + (255 - b) * tint);
  } else {
    nr = Math.round(r * (1 + tint));
    ng = Math.round(g * (1 + tint));
    nb = Math.round(b * (1 + tint));
  }
  const toHex = n => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
  return toHex(nr) + toHex(ng) + toHex(nb);
}

/**
 * 解析 styles.xml 中的 fills 和 cellXfs，构建 styleIndex → color 映射
 */
function parseStyles(stylesXml, themeColors) {
  // 1. 解析所有 fill 定义
  const fills = [];
  const fillMatches = stylesXml.match(/<fill>[\s\S]*?<\/fill>/g) || [];
  for (const f of fillMatches) {
    const patternMatch = f.match(/patternType="([^"]+)"/);
    if (!patternMatch || patternMatch[1] !== 'solid') {
      fills.push(null);
      continue;
    }
    const rgbMatch = f.match(/fgColor rgb="([^"]+)"/);
    const themeMatch = f.match(/fgColor theme="([^"]+)"/);
    const tintMatch = f.match(/fgColor[^>]*tint="([^"]+)"/);

    if (rgbMatch) {
      fills.push(rgbMatch[1]);
    } else if (themeMatch) {
      const themeIdx = parseInt(themeMatch[1]);
      const baseColor = themeColors[themeIdx] || '000000';
      const tint = tintMatch ? parseFloat(tintMatch[1]) : 0;
      const resolved = applyTint(baseColor, tint);
      fills.push('FF' + resolved.toUpperCase());
    } else {
      fills.push(null);
    }
  }

  // 2. 解析 cellXfs → 建立 styleIndex → fillColor 映射
  const styleColorMap = {};
  const xfsMatch = stylesXml.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/);
  if (xfsMatch) {
    const xfEntries = xfsMatch[1].match(/<xf[^>]*\/?>/g) || [];
    xfEntries.forEach((xf, i) => {
      const fillIdMatch = xf.match(/fillId="(\d+)"/);
      if (fillIdMatch) {
        const fillId = parseInt(fillIdMatch[1]);
        if (fills[fillId]) {
          styleColorMap[i] = fills[fillId];
        }
      }
    });
  }

  return styleColorMap;
}

/**
 * 解析单个 worksheet XML，返回每行的颜色
 * @returns Map<rowNumber, 'yellow'|'blue'>
 */
function getRowColors(sheetXml, styleColorMap) {
  const rowColors = new Map();
  const rows = sheetXml.match(/<row[^>]*>[\s\S]*?<\/row>/g) || [];

  for (const row of rows) {
    const rowNumMatch = row.match(/r="(\d+)"/);
    if (!rowNumMatch) continue;
    const rowNum = parseInt(rowNumMatch[1]);

    // 检查该行所有单元格的样式
    const cells = row.match(/<c[^>]*>/g) || [];
    for (const cell of cells) {
      const sMatch = cell.match(/ s="(\d+)"/);
      if (!sMatch) continue;
      const color = styleColorMap[parseInt(sMatch[1])];
      if (!color) continue;
      if (isYellowColor(color)) {
        rowColors.set(rowNum, 'yellow');
        break;
      }
      if (isBlueColor(color)) {
        rowColors.set(rowNum, 'blue');
        break;
      }
    }
  }

  return rowColors;
}

/**
 * 解析上传的 Excel 文件，返回所有带颜色的行数据
 * @param {Buffer} fileBuffer - 文件 buffer
 * @param {string} fileName - 文件名
 * @returns {Promise<Array>} 带颜色标记的行数据
 */
async function parseExcelWithColors(fileBuffer, fileName) {
  const results = [];

  // 检查文件格式: xlsx (PK) vs xls (OLE)
  const header = fileBuffer.slice(0, 4).toString('hex');
  const isXlsx = header === '504b0304';

  if (!isXlsx) {
    // .xls 格式: 用 xlsx 库读数据，但无法读颜色，返回所有行
    const wb = XLSX.read(fileBuffer, { type: 'buffer' });
    for (const sheetName of wb.SheetNames) {
      const ws = wb.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      if (data.length < 2) continue;
      const headers = data[0].map(h => String(h || '').trim());
      for (let i = 1; i < data.length; i++) {
        const row = data[i];
        if (row.every(v => v === '' || v === null || v === undefined)) continue;
        const rowData = {};
        headers.forEach((h, idx) => { if (h) rowData[h] = row[idx] ?? ''; });
        results.push({
          type: 'unknown',
          file: fileName,
          sheet: sheetName,
          row: i + 1,
          headers,
          data: rowData,
        });
      }
    }
    return results;
  }

  // .xlsx 格式: 用 JSZip 解析 XML 读颜色，用 xlsx 库读数据
  const zip = await JSZip.loadAsync(fileBuffer);

  // 读取 theme 颜色
  let themeColors = [];
  const themeFile = zip.file('xl/theme/theme1.xml');
  if (themeFile) {
    const themeXml = await themeFile.async('string');
    themeColors = parseThemeColors(themeXml);
  }

  // 读取 styles 并构建映射
  const stylesFile = zip.file('xl/styles.xml');
  let styleColorMap = {};
  if (stylesFile) {
    const stylesXml = await stylesFile.async('string');
    styleColorMap = parseStyles(stylesXml, themeColors);
  }

  // 用 xlsx 库读取数据
  const wb = XLSX.read(fileBuffer, { type: 'buffer' });

  // 遍历每个 sheet
  for (let si = 0; si < wb.SheetNames.length; si++) {
    const sheetName = wb.SheetNames[si];
    const ws = wb.Sheets[sheetName];
    if (!ws['!ref']) continue;

    // 读取对应的 sheet XML 获取颜色
    const sheetFile = zip.file(`xl/worksheets/sheet${si + 1}.xml`);
    if (!sheetFile) continue;
    const sheetXml = await sheetFile.async('string');
    const rowColors = getRowColors(sheetXml, styleColorMap);

    // 读取数据
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    if (data.length < 2) continue;

    const headers = data[0].map(h => String(h || '').trim());

    for (let i = 1; i < data.length; i++) {
      const excelRow = i + 1; // Excel 行号 (1-based, 第1行是表头)
      const color = rowColors.get(excelRow);
      if (!color) continue; // 只返回有颜色的行

      const row = data[i];
      if (row.every(v => v === '' || v === null || v === undefined)) continue;

      const rowData = {};
      headers.forEach((h, idx) => { if (h) rowData[h] = row[idx] ?? ''; });

      results.push({
        type: color === 'yellow' ? 'new' : 'modified',
        file: fileName,
        sheet: sheetName,
        row: excelRow,
        headers,
        data: rowData,
      });
    }
  }

  return results;
}

module.exports = { parseExcelWithColors };
```

**Step 2: 验证颜色检测**

```bash
cd C:/Users/Administrator/zouhuo-system/order-sync/server
node -e "
const fs = require('fs');
const { parseExcelWithColors } = require('./services/color-reader');
const buf = fs.readFileSync('Z:/各客排期/ZURU生产排期/2025年ZURU  #9548鸭妈妈生产排期.xlsx');
parseExcelWithColors(buf, 'test.xlsx').then(results => {
  console.log('Total colored rows:', results.length);
  const newOnes = results.filter(r => r.type === 'new');
  const modified = results.filter(r => r.type === 'modified');
  console.log('New (yellow):', newOnes.length);
  console.log('Modified (blue):', modified.length);
  if (results.length > 0) {
    console.log('Sample:', JSON.stringify(results[0], null, 2));
  }
});
"
```

Expected: 能检测到黄色和蓝色行，数量应与之前 XML 分析结果一致。

**Step 3: Commit**

```bash
git add server/services/color-reader.js
git commit -m "feat: add XML-based color detection for Excel files"
```

---

## Task 3: 文件上传 API

**Files:**
- Create: `server/routes/upload.js`

**Step 1: 创建上传路由**

```js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { parseExcelWithColors } = require('../services/color-reader');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.xlsx', '.xls'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('只支持 .xlsx 和 .xls 文件'));
    }
  },
});

// POST /api/upload — 上传并解析 Excel 文件，返回带颜色标记的行
router.post('/', upload.array('files', 10), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: '请上传文件' });
  }

  const allResults = [];
  const errors = [];

  for (const file of req.files) {
    try {
      const results = await parseExcelWithColors(file.buffer, file.originalname);
      allResults.push(...results);
    } catch (err) {
      errors.push({ file: file.originalname, error: err.message });
    }
  }

  res.json({
    total: allResults.length,
    newCount: allResults.filter(r => r.type === 'new').length,
    modifiedCount: allResults.filter(r => r.type === 'modified').length,
    results: allResults,
    errors,
  });
});

module.exports = router;
```

**Step 2: Commit**

```bash
git add server/routes/upload.js
git commit -m "feat: add file upload route with color detection"
```

---

## Task 4: 新入口文件（app.js）

**Files:**
- Modify: `server/app.js` — 重写为新的入口文件，集成数据库和所有路由

**Step 1: 重写 app.js**

现有的 `index.js` 用的是旧的扫描路由，不使用数据库。新的 `app.js` 要：
- 初始化 SQLite 数据库
- 挂载所有路由：upload, orders, export, summary
- 提供静态文件服务

```js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDatabase } = require('./db/init');

// 初始化数据库
initDatabase();

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// API 路由
app.use('/api/upload', require('./routes/upload'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/export', require('./routes/export'));
app.use('/api/summary', require('./routes/summary'));

app.get('/api/health', (req, res) => res.json({ status: 'ok', port: PORT }));

// 静态文件
const clientDist = path.join(__dirname, '../client/dist');
app.use(express.static(clientDist));
app.get('*', (req, res) => {
  const indexPath = path.join(clientDist, 'index.html');
  if (require('fs').existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.json({ message: 'Server running. Frontend not built yet. Run: cd client && npm run build' });
  }
});

app.listen(PORT, () => {
  console.log(`生产计划管理系统运行在端口 ${PORT}`);
});
```

**Step 2: 更新 start.bat**

修改 `start.bat` 从 `node index.js` 改为 `node app.js`。

```bat
@echo off
echo Starting Production Plan System on port 8080...
cd /d "C:\Users\Administrator\zouhuo-system\order-sync\server"
node app.js
```

**Step 3: 更新 server/package.json 的 scripts**

确保 `start` 和 `dev` 指向 `app.js`。

```json
"scripts": {
  "start": "node app.js",
  "dev": "nodemon app.js"
}
```

**Step 4: 确保 data 目录存在**

```bash
mkdir -p C:/Users/Administrator/zouhuo-system/order-sync/server/data
```

**Step 5: 测试启动**

```bash
cd C:/Users/Administrator/zouhuo-system/order-sync/server
node app.js
```

Expected: `生产计划管理系统运行在端口 8080`，数据库初始化完成。

**Step 6: 测试上传 API**

```bash
curl -X POST http://localhost:8080/api/upload \
  -F "files=@Z:/各客排期/ZURU生产排期/2025年ZURU  #9548鸭妈妈生产排期.xlsx"
```

Expected: 返回 JSON，包含检测到的黄色/蓝色行数据。

**Step 7: Commit**

```bash
git add server/app.js start.bat server/package.json
git commit -m "feat: new app entry point with database and upload support"
```

---

## Task 5: 前端 — App.jsx 路由和导航

**Files:**
- Modify: `client/src/App.jsx`
- Modify: `client/src/main.jsx`

**Step 1: 重写 App.jsx**

将 WorkshopPortal 和 SchedulingSheet 连接起来，实现车间选择 → 排期管理的导航。

```jsx
import { useState } from 'react';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import WorkshopPortal from './pages/WorkshopPortal';
import SchedulingSheet from './pages/SchedulingSheet';

const TABS = [
  { key: 'active', label: '在产订单' },
  { key: 'completed', label: '完成订单' },
  { key: 'cancel1', label: '取消单' },
  { key: 'outsource', label: '外发货号' },
  { key: 'cancel2', label: '取消订单' },
];

const WORKSHOP_NAMES = { A: 'A车间', B: 'B车间', C: '华登' };

export default function App() {
  const [workshop, setWorkshop] = useState(null);
  const [tab, setTab] = useState('active');

  if (!workshop) {
    return (
      <ConfigProvider locale={zhCN}>
        <WorkshopPortal onEnter={(ws) => { setWorkshop(ws); setTab('active'); }} />
      </ConfigProvider>
    );
  }

  return (
    <ConfigProvider locale={zhCN}>
      <div style={{ minHeight: '100vh', background: '#f5f5f5' }}>
        {/* 顶部导航 */}
        <div style={{
          background: '#fff', padding: '0 24px', display: 'flex',
          alignItems: 'center', boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
          height: 48, position: 'sticky', top: 0, zIndex: 100,
        }}>
          <div
            style={{ cursor: 'pointer', fontWeight: 700, fontSize: 15, color: '#1890ff', marginRight: 32 }}
            onClick={() => setWorkshop(null)}
          >
            ← 返回
          </div>
          <div style={{ fontWeight: 700, fontSize: 16, marginRight: 32 }}>
            {WORKSHOP_NAMES[workshop]} · 排期管理
          </div>
          <div style={{ display: 'flex', gap: 0 }}>
            {TABS.map(t => (
              <div
                key={t.key}
                onClick={() => setTab(t.key)}
                style={{
                  padding: '12px 20px', cursor: 'pointer', fontSize: 14,
                  borderBottom: tab === t.key ? '2px solid #1890ff' : '2px solid transparent',
                  color: tab === t.key ? '#1890ff' : '#666',
                  fontWeight: tab === t.key ? 600 : 400,
                }}
              >
                {t.label}
              </div>
            ))}
          </div>
        </div>

        {/* 内容区 */}
        <div style={{ padding: '12px 16px' }}>
          <SchedulingSheet workshop={workshop} tab={tab} />
        </div>
      </div>
    </ConfigProvider>
  );
}
```

**Step 2: 更新 main.jsx**

确保引入了 antd 样式。

```jsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

**Step 3: Commit**

```bash
git add client/src/App.jsx client/src/main.jsx
git commit -m "feat: add workshop navigation with tab switching"
```

---

## Task 6: 前端 — SchedulingSheet 上传功能修复

**Files:**
- Modify: `client/src/pages/SchedulingSheet.jsx`

**Step 1: 修改 SchedulingSheet.jsx**

现有的 SchedulingSheet 已经有了大部分功能（表格编辑、上传、导出）。需要修改：
1. 上传调用 `/api/upload` 而不是 `/api/scan/upload`
2. 上传后显示预览弹窗，可以查看和选择要导入的行
3. 修复扫描按钮（移除Z盘扫描，只保留上传）
4. 增加拖拽上传支持
5. outsource tab 显示 status='outsource' 的订单

关键修改点：

- 移除 `handleScan` 方法和扫描Z盘按钮
- 修改 `handleUpload` 使用 `/api/upload` 接口
- 在上传后显示预览弹窗（Ant Design Table），展示检测到的行和颜色类型
- 用户勾选后确认导入
- STATUS_MAP 增加 outsource

```jsx
import { useEffect, useState, useRef, useCallback } from 'react';
import { Button, Space, message, Upload, Modal, Table, Tag, Alert } from 'antd';
import { DownloadOutlined, PlusOutlined, UploadOutlined, InboxOutlined } from '@ant-design/icons';
import { HotTable } from '@handsontable/react';
import { registerAllModules } from 'handsontable/registry';
import 'handsontable/dist/handsontable.full.min.css';
import axios from 'axios';
import { ORDER_COLUMNS } from '../constants/columns';

registerAllModules();

const STATUS_MAP = {
  active: 'active',
  completed: 'completed',
  cancel1: 'cancelled',
  outsource: 'outsource',
  cancel2: 'cancelled',
};

// 排期 Excel 表头 → 数据库字段映射
const HEADER_FIELD_MAP = {
  '主管': 'supervisor',
  '拉名': 'line_name',
  '人数': 'worker_count',
  '厂区': 'factory_area',
  '客名': 'client',
  '来单日期': 'order_date',
  '第三方客户名称': 'third_party',
  '国家': 'country',
  '合同': 'contract',
  'ZURU PO NO#': 'contract',
  '货号': 'item_no',
  '产品名称': 'product_name',
  '版本': 'version',
  '数量': 'quantity',
  '做工名称': 'work_type',
  '生产数': 'production_count',
  '生产进度': 'production_progress',
  '特别备注': 'special_notes',
  '胶件复期': 'plastic_due',
  '来料复期': 'material_due',
  '纸箱复期': 'carton_due',
  '纸箱回复': 'carton_due',
  '包材复期': 'packaging_due',
  '客贴纸': 'sticker',
  '贴纸': 'sticker',
  '上拉日期': 'start_date',
  '上拉期': 'start_date',
  '完成日期': 'complete_date',
  '完成期': 'complete_date',
  '走货期': 'ship_date',
  '目标数生产时间': 'target_time',
  '每天目标数': 'daily_target',
  '天数': 'days',
  '行Q期': 'inspection_date',
  '月份': 'month',
};

// 将排期 Excel 的行数据转换为数据库字段
function mapRowToOrder(rowData) {
  const order = {};
  for (const [header, value] of Object.entries(rowData)) {
    const field = HEADER_FIELD_MAP[header.trim()];
    if (field) {
      // Excel 日期序列号转换
      if (typeof value === 'number' && value > 40000 && value < 60000) {
        const date = new Date((value - 25569) * 86400 * 1000);
        order[field] = date.toISOString().split('T')[0];
      } else {
        order[field] = value;
      }
    }
  }
  return order;
}

export default function SchedulingSheet({ workshop, tab }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewData, setPreviewData] = useState([]);
  const [selectedRowKeys, setSelectedRowKeys] = useState([]);
  const [importing, setImporting] = useState(false);
  const hotRef = useRef(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const status = STATUS_MAP[tab] || 'active';
      const res = await axios.get('/api/orders', { params: { workshop, status } });
      setData(res.data);
    } catch {
      message.error('加载数据失败');
    }
    setLoading(false);
  }, [workshop, tab]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleAfterChange = useCallback(async (changes, source) => {
    if (source === 'loadData' || !changes) return;
    for (const [row, prop, oldVal, newVal] of changes) {
      if (oldVal === newVal) continue;
      const order = data[row];
      if (!order?.id) continue;
      try {
        await axios.put(`/api/orders/${order.id}`, { [prop]: newVal });
      } catch {
        message.error('保存失败');
      }
    }
  }, [data]);

  const handleUpload = async (info) => {
    const formData = new FormData();
    const files = info.fileList || [];
    files.forEach(f => formData.append('files', f.originFileObj || f));
    try {
      const res = await axios.post('/api/upload', formData);
      const results = res.data.results || [];
      if (results.length === 0) {
        message.info('未检测到带颜色标记的新订单');
        return;
      }
      // 给每行加 key 用于 table 选择
      const withKeys = results.map((r, i) => ({ ...r, _key: i }));
      setPreviewData(withKeys);
      setSelectedRowKeys(withKeys.map(r => r._key));
      setPreviewVisible(true);
    } catch (e) {
      message.error('上传解析失败: ' + (e.response?.data?.error || e.message));
    }
  };

  const handleImport = async () => {
    const selected = previewData.filter(r => selectedRowKeys.includes(r._key));
    if (selected.length === 0) {
      message.warning('请至少选择一条订单');
      return;
    }
    setImporting(true);
    try {
      const orders = selected.map(r => ({
        ...mapRowToOrder(r.data),
        workshop,
        status: 'active',
      }));
      await axios.post('/api/orders', orders);
      message.success(`已导入 ${orders.length} 条订单`);
      setPreviewVisible(false);
      setPreviewData([]);
      fetchData();
    } catch (e) {
      message.error('导入失败: ' + (e.response?.data?.error || e.message));
    }
    setImporting(false);
  };

  const handleAddRow = async () => {
    try {
      await axios.post('/api/orders', { workshop, status: STATUS_MAP[tab] || 'active' });
      fetchData();
    } catch {
      message.error('新增失败');
    }
  };

  const handleExport = () => {
    window.open(`/api/export?workshop=${workshop}`, '_blank');
  };

  // 预览表格列定义
  const previewColumns = [
    {
      title: '类型', dataIndex: 'type', width: 80,
      render: t => t === 'new'
        ? <Tag color="gold">新单</Tag>
        : t === 'modified'
          ? <Tag color="blue">修改单</Tag>
          : <Tag>未知</Tag>,
    },
    { title: '文件', dataIndex: 'file', width: 200, ellipsis: true },
    { title: 'Sheet', dataIndex: 'sheet', width: 120 },
    { title: '行号', dataIndex: 'row', width: 60 },
    {
      title: '主要信息', key: 'info',
      render: (_, r) => {
        const d = r.data;
        const parts = [];
        for (const key of ['客名', '货号', '产品名称', '数量', '合同']) {
          if (d[key]) parts.push(`${key}: ${d[key]}`);
        }
        return parts.join(' | ') || '-';
      },
    },
  ];

  return (
    <div style={{ padding: '8px 0' }}>
      {/* 工具栏 */}
      <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
        <Space>
          {tab === 'active' && (
            <Upload multiple accept=".xlsx,.xls" showUploadList={false}
              beforeUpload={() => false} onChange={handleUpload}>
              <Button icon={<UploadOutlined />} type="primary">导入排期</Button>
            </Upload>
          )}
          <Button icon={<PlusOutlined />} onClick={handleAddRow}>新增行</Button>
        </Space>
        <Button icon={<DownloadOutlined />} onClick={handleExport}>导出Excel</Button>
      </div>

      {/* 表格 */}
      <HotTable
        ref={hotRef}
        data={data}
        columns={ORDER_COLUMNS}
        colHeaders={ORDER_COLUMNS.map(c => c.title)}
        rowHeaders={true}
        height={600}
        width="100%"
        stretchH="none"
        licenseKey="non-commercial-and-evaluation"
        afterChange={handleAfterChange}
        manualColumnResize={true}
        manualRowResize={true}
        contextMenu={['row_above', 'row_below', 'remove_row', '---------', 'copy', 'cut']}
        fixedColumnsStart={5}
        wordWrap={false}
        renderAllRows={false}
        autoRowSize={false}
        autoColumnSize={false}
      />

      {/* 导入预览弹窗 */}
      <Modal
        title={`检测到 ${previewData.length} 条订单`}
        open={previewVisible}
        onCancel={() => setPreviewVisible(false)}
        width={1000}
        okText={`导入选中 (${selectedRowKeys.length})`}
        onOk={handleImport}
        confirmLoading={importing}
      >
        <Alert
          style={{ marginBottom: 12 }}
          message={`新单: ${previewData.filter(r => r.type === 'new').length} 条, 修改单: ${previewData.filter(r => r.type === 'modified').length} 条`}
          type="info"
          showIcon
        />
        <Table
          rowKey="_key"
          columns={previewColumns}
          dataSource={previewData}
          size="small"
          scroll={{ y: 400 }}
          pagination={false}
          rowSelection={{
            selectedRowKeys,
            onChange: setSelectedRowKeys,
          }}
        />
      </Modal>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add client/src/pages/SchedulingSheet.jsx
git commit -m "feat: replace Z-drive scan with file upload and preview modal"
```

---

## Task 7: 导出 Excel 格式对齐

**Files:**
- Modify: `server/services/exporter.js`

**Step 1: 更新导出逻辑**

对齐金山文档的 sheet 结构。需要修改：
- 外发货号 sheet 从 status='outsource' 查询
- 产值明细汇总 sheet 从 summary 表查询并格式化
- 日期字段导出时转回 Excel 日期格式

```js
const ExcelJS = require('exceljs');
const db = require('../db/connection');

const COLUMNS = [
  { key: 'supervisor',     header: '主管',       width: 8 },
  { key: 'line_name',      header: '拉名',       width: 8 },
  { key: 'worker_count',   header: '人数',       width: 6 },
  { key: 'factory_area',   header: '厂区',       width: 10 },
  { key: 'client',         header: '客名',       width: 10 },
  { key: 'order_date',     header: '来单日期',   width: 10 },
  { key: 'third_party',    header: '第三方客户名称', width: 20 },
  { key: 'country',        header: '国家',       width: 8 },
  { key: 'contract',       header: '合同',       width: 16 },
  { key: 'item_no',        header: '货号',       width: 16 },
  { key: 'product_name',   header: '产品名称',   width: 16 },
  { key: 'version',        header: '版本',       width: 8 },
  { key: 'quantity',       header: '数量',       width: 8 },
  { key: 'work_type',      header: '做工名称',   width: 8 },
  { key: 'production_count', header: '生产数',   width: 8 },
  { key: 'production_progress', header: '生产进度', width: 8 },
  { key: 'special_notes',  header: '特别备注',   width: 16 },
  { key: 'plastic_due',    header: '胶件复期',   width: 10 },
  { key: 'material_due',   header: '来料复期',   width: 10 },
  { key: 'carton_due',     header: '纸箱复期',   width: 10 },
  { key: 'packaging_due',  header: '包材复期',   width: 10 },
  { key: 'sticker',        header: '客贴纸',     width: 8 },
  { key: 'start_date',     header: '上拉日期',   width: 10 },
  { key: 'complete_date',  header: '完成日期',   width: 10 },
  { key: 'ship_date',      header: '走货期',     width: 10 },
  { key: 'inspection_date', header: '行Q期',     width: 8 },
  { key: 'month',          header: '月份',       width: 6 },
];

const HEADER_STYLE = {
  font: { bold: true, size: 10 },
  alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
  border: {
    top: { style: 'thin' }, bottom: { style: 'thin' },
    left: { style: 'thin' }, right: { style: 'thin' },
  },
  fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } },
};

const CELL_BORDER = {
  top: { style: 'thin' }, bottom: { style: 'thin' },
  left: { style: 'thin' }, right: { style: 'thin' },
};

function addOrderSheet(wb, sheetName, orders) {
  const ws = wb.addWorksheet(sheetName);
  ws.columns = COLUMNS.map(c => ({ header: c.header, key: c.key, width: c.width }));

  const headerRow = ws.getRow(1);
  headerRow.height = 30;
  headerRow.eachCell(cell => {
    cell.font = HEADER_STYLE.font;
    cell.alignment = HEADER_STYLE.alignment;
    cell.border = HEADER_STYLE.border;
    cell.fill = HEADER_STYLE.fill;
  });

  ws.views = [{ state: 'frozen', ySplit: 1 }];

  for (const order of orders) {
    const row = ws.addRow(order);
    row.eachCell(cell => {
      cell.font = { size: 9 };
      cell.alignment = { vertical: 'middle', wrapText: true };
      cell.border = CELL_BORDER;
    });
  }
}

function addSummarySheet(wb, workshop) {
  const ws = wb.addWorksheet('产值明细汇总');

  // 获取汇总数据
  const summaryRows = db.prepare('SELECT * FROM summary WHERE workshop = ?').all(workshop);

  // 获取所有客户名
  const clients = [...new Set(summaryRows.map(r => r.client).filter(Boolean))];

  // 表头: 拉名, 人数, 各客户, 小计, 月份, 备注
  const headers = ['拉名', '人数', ...clients, '小计', '月份', '备注'];

  // 标题行
  const workshopName = { A: '兴信A', B: '兴信B', C: '华登' }[workshop] || workshop;
  ws.mergeCells(1, 1, 1, headers.length);
  const titleCell = ws.getCell('A1');
  titleCell.value = `${workshopName}成品产值预算`;
  titleCell.font = { bold: true, size: 12 };
  titleCell.alignment = { horizontal: 'center' };

  // 表头行
  const headerRow = ws.addRow(headers);
  headerRow.eachCell(cell => {
    cell.font = HEADER_STYLE.font;
    cell.alignment = HEADER_STYLE.alignment;
    cell.border = HEADER_STYLE.border;
  });

  // 按 line_name 分组
  const lineNames = [...new Set(summaryRows.map(r => r.line_name).filter(Boolean))];
  for (const lineName of lineNames) {
    const lineData = summaryRows.find(r => r.line_name === lineName) || {};
    const rowValues = [lineName, lineData.worker_count || ''];
    let subtotal = 0;
    for (const client of clients) {
      const val = summaryRows.find(r => r.line_name === lineName && r.client === client)?.value || 0;
      rowValues.push(val);
      subtotal += val;
    }
    rowValues.push(subtotal, lineData.month || '', lineData.remark || '');
    const row = ws.addRow(rowValues);
    row.eachCell(cell => { cell.border = CELL_BORDER; });
  }
}

async function exportWorkbook(workshop) {
  const wb = new ExcelJS.Workbook();

  // Sheet 1: 产值明细汇总
  addSummarySheet(wb, workshop);

  // Sheet 2: 在产订单 (用主管名作为 sheet 名)
  const activeOrders = db.prepare('SELECT * FROM orders WHERE workshop = ? AND status = ? ORDER BY id ASC').all(workshop, 'active');
  const supervisorName = activeOrders[0]?.supervisor || '排期表';
  addOrderSheet(wb, supervisorName, activeOrders);

  // Sheet 3: 完成订单
  const completedOrders = db.prepare('SELECT * FROM orders WHERE workshop = ? AND status = ? ORDER BY id ASC').all(workshop, 'completed');
  addOrderSheet(wb, '完成订单', completedOrders);

  // Sheet 4: 取消单
  const cancelledOrders = db.prepare('SELECT * FROM orders WHERE workshop = ? AND status = ? ORDER BY id ASC').all(workshop, 'cancelled');
  addOrderSheet(wb, '取消单', cancelledOrders);

  // Sheet 5: Sheet9 (空)
  wb.addWorksheet('Sheet9');

  // Sheet 6: 完成成品数 (空表头)
  addOrderSheet(wb, '完成成品数', []);

  // Sheet 7: 外发货号
  const outsourceOrders = db.prepare('SELECT * FROM orders WHERE workshop = ? AND status = ? ORDER BY id ASC').all(workshop, 'outsource');
  addOrderSheet(wb, '外发货号', outsourceOrders);

  // Sheet 8: 取消订单 (同取消单)
  addOrderSheet(wb, '取消订单', cancelledOrders);

  return wb;
}

module.exports = { exportWorkbook };
```

**Step 2: Commit**

```bash
git add server/services/exporter.js
git commit -m "feat: align Excel export with production plan format"
```

---

## Task 8: 前端构建和端到端测试

**Step 1: 构建前端**

```bash
cd C:/Users/Administrator/zouhuo-system/order-sync/client
npm run build
```

Expected: 构建成功，dist/ 目录生成。

**Step 2: 停止旧服务，启动新服务**

```bash
# 杀掉占用 8080 端口的进程
netstat -ano | findstr :8080
taskkill /PID <pid> /F

# 启动新服务
cd C:/Users/Administrator/zouhuo-system/order-sync/server
node app.js
```

Expected: `生产计划管理系统运行在端口 8080` + `数据库初始化完成`

**Step 3: 端到端验证**

1. 打开 `http://localhost:8080` — 应该看到车间选择页（A/B/华登三张卡片）
2. 点击 B车间 — 进入排期管理，显示空表格
3. 点击"导入排期" → 选择一个 Z 盘的排期 Excel → 弹出预览弹窗
4. 确认导入 → 表格中显示导入的订单
5. 在表格中编辑一个单元格 → 刷新页面确认保存成功
6. 点击"导出Excel" → 下载的 Excel 应包含正确的 sheet 结构
7. 切换 tab 到"完成订单"、"取消单"等

**Step 4: Commit all and tag**

```bash
git add -A
git commit -m "feat: production plan management system v1.0

- XML-based Excel color detection (yellow=new, blue=modified)
- File upload with preview and selective import
- Workshop-based order management (A/B/华登)
- Handsontable spreadsheet editing with auto-save
- Excel export matching existing production plan format
- SQLite database for persistent storage"
```

---

## 已有代码复用清单

| 文件 | 状态 | 说明 |
|------|------|------|
| `server/db/connection.js` | 直接复用 | SQLite 连接 |
| `server/db/init.js` | 直接复用 | 表结构创建 |
| `server/routes/orders.js` | 直接复用 | 完整 CRUD API |
| `server/routes/export.js` | 直接复用 | 导出路由 |
| `server/routes/summary.js` | 直接复用 | 汇总路由 |
| `client/src/constants/columns.js` | 直接复用 | 列定义 |
| `client/src/pages/WorkshopPortal.jsx` | 直接复用 | 车间选择 |
| `server/services/exporter.js` | 修改 | 增加汇总sheet、外发sheet |
| `server/app.js` | 重写 | 新入口文件 |
| `client/src/App.jsx` | 重写 | 添加导航 |
| `client/src/pages/SchedulingSheet.jsx` | 修改 | 上传替代扫描 |
| `server/services/color-reader.js` | 新建 | XML颜色检测 |
| `server/routes/upload.js` | 新建 | 上传路由 |
