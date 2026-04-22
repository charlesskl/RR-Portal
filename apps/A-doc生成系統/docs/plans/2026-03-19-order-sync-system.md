# 排期扫描同步系统 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an independent web system (port 8080) that scans all client schedule Excel files on Z: drive, detects yellow (new order) and blue (modified order) rows by cell color, displays them in a web UI for user confirmation, then writes confirmed orders to 金山文档 via API.

**Architecture:** New standalone Express.js app at `c:/Users/Administrator/zouhuo-system/order-sync/`, completely independent from the existing system on port 80. Backend reads Excel files using exceljs (color-aware), stores confirmed order IDs in a local JSON file for deduplication, and calls 金山文档 Open Platform API to write rows. React + Ant Design frontend served by Express in production.

**Tech Stack:** Node.js, Express.js, exceljs (cell color reading), React 18, Ant Design, axios, dotenv

---

## Task 1: Create Backend Project Structure

**Files:**
- Create: `order-sync/server/package.json`
- Create: `order-sync/server/.env`
- Create: `order-sync/server/index.js`
- Create: `order-sync/server/data/confirmed.json`

**Step 1: Create directory structure**

```bash
cd C:/Users/Administrator/zouhuo-system
mkdir -p order-sync/server/routes
mkdir -p order-sync/server/services
mkdir -p order-sync/server/data
mkdir -p order-sync/client/src/pages
```

**Step 2: Create `order-sync/server/package.json`**

```json
{
  "name": "order-sync-server",
  "version": "1.0.0",
  "main": "index.js",
  "scripts": {
    "start": "node index.js",
    "dev": "nodemon index.js"
  },
  "dependencies": {
    "cors": "^2.8.5",
    "dotenv": "^16.0.0",
    "exceljs": "^4.4.0",
    "express": "^4.18.0",
    "axios": "^1.6.0"
  },
  "devDependencies": {
    "nodemon": "^3.0.0"
  }
}
```

**Step 3: Create `order-sync/server/.env`**

```env
PORT=8080
SCAN_DIR=Z:/各客排期
KINGSOFT_APP_ID=
KINGSOFT_ACCESS_TOKEN=
KINGSOFT_FILE_ID=
```

**Step 4: Create `order-sync/server/data/confirmed.json`**

```json
[]
```

**Step 5: Install dependencies**

```bash
cd C:/Users/Administrator/zouhuo-system/order-sync/server
npm install
```

Expected: `node_modules` folder created, no errors.

**Step 6: Create `order-sync/server/index.js`**

```javascript
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const scanRoutes = require('./routes/scan');
const kingsoftRoutes = require('./routes/kingsoft');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());

// API routes
app.use('/api/scan', scanRoutes);
app.use('/api/kingsoft', kingsoftRoutes);

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'ok', port: PORT }));

// Serve React frontend in production
const clientDist = path.join(__dirname, '../client/dist');
app.use(express.static(clientDist));
app.get('*', (req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Order Sync Server running on port ${PORT}`);
});
```

**Step 7: Verify server starts**

```bash
cd C:/Users/Administrator/zouhuo-system/order-sync/server
node index.js
```

Expected: `Order Sync Server running on port 8080`

**Step 8: Commit**

```bash
cd C:/Users/Administrator/zouhuo-system
git init order-sync || true
cd order-sync
git add .
git commit -m "feat: initialize order-sync backend structure"
```

---

## Task 2: Build Excel Color Scanner Service

**Files:**
- Create: `order-sync/server/services/scanner.js`

**Background knowledge:**
- exceljs reads cell fill colors via `cell.fill.fgColor.argb` (8-char hex, first 2 = alpha)
- Yellow colors: `FFFFFF00`, `FFFFC000`, `FFFFF2CC`, `FFFFEB9C`, `FFFFFF99`
- Blue/light blue colors: `FF9DC3E6`, `FF4472C4`, `FFBDD7EE`, `FF2E75B6`, `FF9BC2E6`
- The scan dir is `Z:/各客排期` which has one subfolder per client, each containing `.xlsx` files
- Confirmed orders are stored in `data/confirmed.json` as array of unique keys (PO号 or row hash)

**Step 1: Create `order-sync/server/services/scanner.js`**

```javascript
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

const CONFIRMED_PATH = path.join(__dirname, '../data/confirmed.json');

// Color sets for detection (ARGB format, case-insensitive)
const YELLOW_COLORS = new Set([
  'FFFFFF00', 'FFFFC000', 'FFFFF2CC', 'FFFFEB9C', 'FFFFFF99',
  'FFFFD966', 'FFFFFFE0', 'FFFFED00', 'FFFFCC00'
]);

const BLUE_COLORS = new Set([
  'FF9DC3E6', 'FF4472C4', 'FFBDD7EE', 'FF2E75B6', 'FF9BC2E6',
  'FF00B0F0', 'FF0070C0', 'FFB8CCE4', 'FFDAE3F3', 'FF1F77B4'
]);

function getConfirmed() {
  try {
    return JSON.parse(fs.readFileSync(CONFIRMED_PATH, 'utf8'));
  } catch {
    return [];
  }
}

function isYellow(argb) {
  if (!argb) return false;
  return YELLOW_COLORS.has(argb.toUpperCase());
}

function isBlue(argb) {
  if (!argb) return false;
  return BLUE_COLORS.has(argb.toUpperCase());
}

function getRowColor(row) {
  // Check first 10 cells for color
  for (let col = 1; col <= 10; col++) {
    const cell = row.getCell(col);
    const fill = cell.fill;
    if (fill && fill.type === 'pattern' && fill.fgColor) {
      const argb = fill.fgColor.argb;
      if (isYellow(argb)) return 'yellow';
      if (isBlue(argb)) return 'blue';
    }
  }
  return null;
}

function rowToData(row, headers) {
  const data = {};
  headers.forEach((header, index) => {
    if (header) {
      const cell = row.getCell(index + 1);
      data[header] = cell.value;
    }
  });
  return data;
}

function makeKey(clientName, rowData) {
  // Unique key: client + PO号 or client + 合同 + 货号
  const po = rowData['合同'] || rowData['PO'] || rowData['订单号'] || '';
  const itemNo = rowData['货号'] || rowData['产品编号'] || '';
  return `${clientName}|${po}|${itemNo}`.toLowerCase().replace(/\s+/g, '');
}

async function scanFile(filePath, clientName) {
  const confirmed = getConfirmed();
  const results = [];

  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);

    for (const worksheet of workbook.worksheets) {
      // Get headers from first non-empty row
      let headers = [];
      let headerRowIndex = 0;

      worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        if (headerRowIndex === 0) {
          // First row with content = headers
          const rowValues = row.values.slice(1); // skip index 0
          if (rowValues.some(v => v !== null && v !== undefined)) {
            headers = rowValues.map(v => (v ? String(v).trim() : null));
            headerRowIndex = rowNumber;
          }
          return;
        }

        const color = getRowColor(row);
        if (!color) return;

        const data = rowToData(row, headers);
        const key = makeKey(clientName, data);

        if (confirmed.includes(key)) return; // already processed

        results.push({
          key,
          type: color === 'yellow' ? 'new' : 'modified',
          client: clientName,
          file: path.basename(filePath),
          sheet: worksheet.name,
          data
        });
      });
    }
  } catch (err) {
    console.error(`Error scanning ${filePath}:`, err.message);
  }

  return results;
}

async function scanAllClients(scanDir) {
  const allResults = [];
  const errors = [];

  let clientFolders;
  try {
    clientFolders = fs.readdirSync(scanDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
  } catch (err) {
    throw new Error(`Cannot read scan directory: ${scanDir} - ${err.message}`);
  }

  for (const clientName of clientFolders) {
    const clientDir = path.join(scanDir, clientName);
    let files;
    try {
      files = fs.readdirSync(clientDir)
        .filter(f => f.endsWith('.xlsx') && !f.startsWith('~$'));
    } catch {
      continue;
    }

    for (const file of files) {
      const filePath = path.join(clientDir, file);
      try {
        const results = await scanFile(filePath, clientName);
        allResults.push(...results);
      } catch (err) {
        errors.push({ file, error: err.message });
      }
    }
  }

  return { results: allResults, errors };
}

function confirmOrders(keys) {
  const confirmed = getConfirmed();
  const newConfirmed = [...new Set([...confirmed, ...keys])];
  fs.writeFileSync(CONFIRMED_PATH, JSON.stringify(newConfirmed, null, 2));
  return newConfirmed.length - confirmed.length; // count added
}

module.exports = { scanAllClients, confirmOrders };
```

**Step 2: Quick smoke test (manual)**

```bash
cd C:/Users/Administrator/zouhuo-system/order-sync/server
node -e "
const { scanAllClients } = require('./services/scanner');
scanAllClients('Z:/各客排期').then(r => {
  console.log('Found:', r.results.length, 'colored rows');
  console.log('Errors:', r.errors.length);
  if (r.results.length > 0) console.log('Sample:', JSON.stringify(r.results[0], null, 2));
}).catch(console.error);
"
```

Expected: Number of yellow/blue rows found across all client files printed.

**Step 3: Commit**

```bash
git add server/services/scanner.js
git commit -m "feat: add excel color scanner service"
```

---

## Task 3: Build Scan API Routes

**Files:**
- Create: `order-sync/server/routes/scan.js`

**Step 1: Create `order-sync/server/routes/scan.js`**

```javascript
const express = require('express');
const router = express.Router();
const { scanAllClients, confirmOrders } = require('../services/scanner');

const SCAN_DIR = process.env.SCAN_DIR || 'Z:/各客排期';

// GET /api/scan - trigger scan and return results
router.get('/', async (req, res) => {
  try {
    const { results, errors } = await scanAllClients(SCAN_DIR);

    // Group by client
    const grouped = {};
    for (const item of results) {
      if (!grouped[item.client]) grouped[item.client] = [];
      grouped[item.client].push(item);
    }

    res.json({
      total: results.length,
      clients: Object.keys(grouped).length,
      errors: errors.length,
      grouped,
      errorList: errors
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/scan/confirm - mark orders as confirmed
// Body: { keys: ['key1', 'key2', ...] }
router.post('/confirm', (req, res) => {
  const { keys } = req.body;
  if (!Array.isArray(keys) || keys.length === 0) {
    return res.status(400).json({ error: 'keys must be a non-empty array' });
  }
  const added = confirmOrders(keys);
  res.json({ success: true, added });
});

module.exports = router;
```

**Step 2: Test scan endpoint**

```bash
# Start server first
node index.js &
# Then test
curl http://localhost:8080/api/scan
```

Expected: JSON with `total`, `clients`, `grouped` fields.

**Step 3: Commit**

```bash
git add server/routes/scan.js
git commit -m "feat: add scan API routes"
```

---

## Task 4: Build 金山文档 API Service & Routes

**Files:**
- Create: `order-sync/server/services/kingsoft.js`
- Create: `order-sync/server/routes/kingsoft.js`

**Background:** 金山文档开放平台 API base URL: `https://api.kdocs.cn/api/v3`
- Auth: `Authorization: Bearer {access_token}` header
- Write rows to a sheet: `POST /files/{file_id}/sheets/{sheet_id}/rows`
- Get sheets list: `GET /files/{file_id}/sheets`

**Step 1: Create `order-sync/server/services/kingsoft.js`**

```javascript
const axios = require('axios');

const BASE_URL = 'https://api.kdocs.cn/api/v3';

function getHeaders() {
  return {
    'Authorization': `Bearer ${process.env.KINGSOFT_ACCESS_TOKEN}`,
    'Content-Type': 'application/json'
  };
}

// Get list of sheets in the target file
async function getSheets() {
  const fileId = process.env.KINGSOFT_FILE_ID;
  const res = await axios.get(`${BASE_URL}/files/${fileId}/sheets`, {
    headers: getHeaders()
  });
  return res.data;
}

// Append rows to a sheet
// rows: array of arrays (each inner array = one row's cell values in order)
async function appendRows(sheetId, rows) {
  const fileId = process.env.KINGSOFT_FILE_ID;
  const res = await axios.post(
    `${BASE_URL}/files/${fileId}/sheets/${sheetId}/rows`,
    { rows },
    { headers: getHeaders() }
  );
  return res.data;
}

// Map order data object to row array based on column order
// columnOrder: array of field names matching the sheet's columns
function orderToRow(orderData, columnOrder) {
  return columnOrder.map(col => {
    const val = orderData[col];
    if (val === null || val === undefined) return '';
    if (val instanceof Date) return val.toISOString().split('T')[0];
    return String(val);
  });
}

module.exports = { getSheets, appendRows, orderToRow };
```

**Step 2: Create `order-sync/server/routes/kingsoft.js`**

```javascript
const express = require('express');
const router = express.Router();
const { getSheets, appendRows, orderToRow } = require('../services/kingsoft');
const { confirmOrders } = require('../services/scanner');

// GET /api/kingsoft/sheets - list sheets in target doc
router.get('/sheets', async (req, res) => {
  try {
    const data = await getSheets();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message, detail: err.response?.data });
  }
});

// POST /api/kingsoft/write
// Body: { sheetId, orders: [{key, data: {...}}], columnOrder: ['字段1','字段2',...] }
router.post('/write', async (req, res) => {
  const { sheetId, orders, columnOrder } = req.body;
  if (!sheetId || !Array.isArray(orders) || !Array.isArray(columnOrder)) {
    return res.status(400).json({ error: 'sheetId, orders, columnOrder required' });
  }

  try {
    const rows = orders.map(o => orderToRow(o.data, columnOrder));
    await appendRows(sheetId, rows);

    // Mark as confirmed to prevent re-showing
    const keys = orders.map(o => o.key);
    confirmOrders(keys);

    res.json({ success: true, written: rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message, detail: err.response?.data });
  }
});

module.exports = router;
```

**Step 3: Commit**

```bash
git add server/services/kingsoft.js server/routes/kingsoft.js
git commit -m "feat: add kingsoft docs API service and routes"
```

---

## Task 5: Create React Frontend Project

**Files:**
- Create: `order-sync/client/` (Vite + React project)

**Step 1: Scaffold React project**

```bash
cd C:/Users/Administrator/zouhuo-system/order-sync
npm create vite@latest client -- --template react
cd client
npm install
npm install antd @ant-design/icons axios dayjs
```

**Step 2: Update `order-sync/client/vite.config.js`**

```javascript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 8081,
    proxy: {
      '/api': 'http://localhost:8080'
    }
  },
  build: {
    outDir: 'dist'
  }
})
```

**Step 3: Commit**

```bash
cd C:/Users/Administrator/zouhuo-system/order-sync
git add client/
git commit -m "feat: scaffold react frontend"
```

---

## Task 6: Build Scan Page (Main UI)

**Files:**
- Create: `order-sync/client/src/pages/ScanPage.jsx`
- Modify: `order-sync/client/src/App.jsx`

**Step 1: Create `order-sync/client/src/pages/ScanPage.jsx`**

```jsx
import { useState } from 'react';
import {
  Button, Card, Table, Tag, Space, Typography, Alert,
  Checkbox, Spin, message, Collapse, Badge
} from 'antd';
import { ScanOutlined, CheckCircleOutlined, WarningOutlined } from '@ant-design/icons';
import axios from 'axios';

const { Title, Text } = Typography;
const { Panel } = Collapse;

export default function ScanPage() {
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState(null);
  const [selectedKeys, setSelectedKeys] = useState([]);
  const [writing, setWriting] = useState(false);

  async function handleScan() {
    setScanning(true);
    setScanResult(null);
    setSelectedKeys([]);
    try {
      const { data } = await axios.get('/api/scan');
      setScanResult(data);
      message.success(`扫描完成，发现 ${data.total} 条新/修改订单`);
    } catch (err) {
      message.error('扫描失败: ' + (err.response?.data?.error || err.message));
    } finally {
      setScanning(false);
    }
  }

  async function handleConfirm() {
    if (selectedKeys.length === 0) {
      message.warning('请先勾选要确认的订单');
      return;
    }
    setWriting(true);
    try {
      await axios.post('/api/scan/confirm', { keys: selectedKeys });
      message.success(`已确认 ${selectedKeys.length} 条订单`);
      // Remove confirmed from results
      const newGrouped = {};
      Object.entries(scanResult.grouped).forEach(([client, orders]) => {
        const remaining = orders.filter(o => !selectedKeys.includes(o.key));
        if (remaining.length > 0) newGrouped[client] = remaining;
      });
      setScanResult({ ...scanResult, grouped: newGrouped, total: scanResult.total - selectedKeys.length });
      setSelectedKeys([]);
    } catch (err) {
      message.error('确认失败: ' + err.message);
    } finally {
      setWriting(false);
    }
  }

  const columns = [
    {
      title: '类型',
      dataIndex: 'type',
      width: 80,
      render: t => t === 'new'
        ? <Tag color="gold">新单</Tag>
        : <Tag color="blue">修改单</Tag>
    },
    { title: '文件', dataIndex: 'file', ellipsis: true, width: 180 },
    { title: 'Sheet', dataIndex: 'sheet', width: 120 },
    {
      title: '订单数据',
      dataIndex: 'data',
      render: data => (
        <Space wrap size="small">
          {Object.entries(data).filter(([k, v]) => v).slice(0, 6).map(([k, v]) => (
            <Text key={k} type="secondary" style={{ fontSize: 12 }}>
              <b>{k}:</b> {String(v).substring(0, 20)}
            </Text>
          ))}
        </Space>
      )
    },
    {
      title: '选择',
      width: 60,
      render: (_, row) => (
        <Checkbox
          checked={selectedKeys.includes(row.key)}
          onChange={e => {
            if (e.target.checked) setSelectedKeys(prev => [...prev, row.key]);
            else setSelectedKeys(prev => prev.filter(k => k !== row.key));
          }}
        />
      )
    }
  ];

  return (
    <div style={{ padding: 24, maxWidth: 1400, margin: '0 auto' }}>
      <Title level={2}>排期扫描同步系统</Title>

      <Card style={{ marginBottom: 16 }}>
        <Space>
          <Button
            type="primary"
            icon={<ScanOutlined />}
            onClick={handleScan}
            loading={scanning}
            size="large"
          >
            开始扫描 Z 盘
          </Button>
          {scanResult && (
            <Button
              icon={<CheckCircleOutlined />}
              onClick={handleConfirm}
              loading={writing}
              disabled={selectedKeys.length === 0}
              size="large"
            >
              确认已选 ({selectedKeys.length})
            </Button>
          )}
        </Space>
        {scanning && <Spin style={{ marginLeft: 16 }} tip="正在扫描所有客户排期文件..." />}
      </Card>

      {scanResult && (
        <>
          <Alert
            type={scanResult.total > 0 ? 'warning' : 'success'}
            message={`共发现 ${scanResult.total} 条新/修改订单，涉及 ${scanResult.clients} 个客户`}
            style={{ marginBottom: 16 }}
            icon={scanResult.errors > 0 ? <WarningOutlined /> : undefined}
            description={scanResult.errors > 0 ? `${scanResult.errors} 个文件读取失败` : undefined}
          />

          <Collapse defaultActiveKey={Object.keys(scanResult.grouped)}>
            {Object.entries(scanResult.grouped).map(([client, orders]) => (
              <Panel
                key={client}
                header={
                  <Space>
                    <b>{client}</b>
                    <Badge count={orders.filter(o => o.type === 'new').length} color="gold" />
                    <Badge count={orders.filter(o => o.type === 'modified').length} color="blue" />
                  </Space>
                }
              >
                <Button
                  size="small"
                  style={{ marginBottom: 8 }}
                  onClick={() => {
                    const keys = orders.map(o => o.key);
                    setSelectedKeys(prev => [...new Set([...prev, ...keys])]);
                  }}
                >
                  全选本客户
                </Button>
                <Table
                  dataSource={orders}
                  columns={columns}
                  rowKey="key"
                  size="small"
                  pagination={false}
                  rowStyle={row => ({
                    background: row.type === 'new' ? '#fffbe6' : '#e6f7ff'
                  })}
                />
              </Panel>
            ))}
          </Collapse>
        </>
      )}
    </div>
  );
}
```

**Step 2: Replace `order-sync/client/src/App.jsx`**

```jsx
import ScanPage from './pages/ScanPage';
import 'antd/dist/reset.css';

export default function App() {
  return <ScanPage />;
}
```

**Step 3: Start dev server and verify**

```bash
# Terminal 1: backend
cd C:/Users/Administrator/zouhuo-system/order-sync/server
node index.js

# Terminal 2: frontend
cd C:/Users/Administrator/zouhuo-system/order-sync/client
npm run dev
```

Open `http://localhost:8081`, click "开始扫描 Z 盘", verify results appear.

**Step 4: Commit**

```bash
git add client/src/
git commit -m "feat: add scan page UI with color-grouped order display"
```

---

## Task 7: Build Production & Launch Script

**Files:**
- Create: `order-sync/start.bat`

**Step 1: Build frontend**

```bash
cd C:/Users/Administrator/zouhuo-system/order-sync/client
npm run build
```

Expected: `dist/` folder created in client directory.

**Step 2: Verify production serve**

```bash
cd C:/Users/Administrator/zouhuo-system/order-sync/server
node index.js
```

Open `http://localhost:8080` — should see the React app served by Express.

**Step 3: Create `order-sync/start.bat`**

```bat
@echo off
cd /d "C:\Users\Administrator\zouhuo-system\order-sync\server"
node index.js
```

**Step 4: Final commit**

```bash
cd C:/Users/Administrator/zouhuo-system/order-sync
git add .
git commit -m "feat: add production build and launch script"
```

---

## Verification Checklist

1. `http://localhost:8080/api/health` returns `{"status":"ok","port":8080}`
2. `http://localhost:8080/api/scan` returns colored rows from Z: drive
3. Clicking "确认已选" marks orders as confirmed, they disappear on next scan
4. Frontend at `http://localhost:8080` shows scan page with yellow/blue grouping
5. 金山文档 API: configure `.env` with real credentials, test via `GET /api/kingsoft/sheets`

---

## Notes for After Implementation

- **金山文档 API credentials** needed before write-to-doc works: App ID, Access Token, File ID
- Color thresholds can be tuned in `scanner.js` `YELLOW_COLORS` / `BLUE_COLORS` sets if some files use different shades
- If a client folder has nested subfolders, scanner may need to be extended to recurse deeper
