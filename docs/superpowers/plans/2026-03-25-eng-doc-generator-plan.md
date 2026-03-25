# 工程资料生成器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone Node.js plugin that lets engineers input product data once and auto-generate 5 Excel documents (排模表, 外箱资料, 外购清单, 生产注意事项, 作业指导书).

**Architecture:** Express server with JSON file storage (one file per product). Frontend is Bootstrap 5 + vanilla JS with two pages (product list + product editor with 6 tabs). Excel generation uses exceljs library, ZIP packaging with archiver. Deployed as a Docker container in RR Portal.

**Tech Stack:** Node.js, Express, exceljs, archiver, uuid, Bootstrap 5

**Spec:** `docs/superpowers/specs/2026-03-25-eng-doc-generator-design.md`

**Reference patterns:** Follow `plugins/新产品开发进度表/server.js` for Express setup, JSON read/write with backup, write queue serialization, and error handling patterns.

---

## File Structure

```
plugins/工程资料生成器/
├── server.js                  # Express server, all API routes, data layer
├── package.json               # Dependencies
├── Dockerfile.node            # Docker build
├── .env.example               # Environment variable template
├── generators/
│   ├── common.js              # Shared Excel styles, header/footer helpers
│   ├── mold-table.js          # 排模表 generator
│   ├── carton-spec.js         # 外箱资料 generator
│   ├── purchase-list.js       # 外购清单 generator
│   ├── production-notes.js    # 生产注意事项 generator
│   └── work-instructions.js   # 作业指导书 generator
├── public/
│   ├── index.html             # Product list page
│   ├── product.html           # Product editor (6 tabs)
│   ├── style.css              # Shared styles
│   └── utils.js               # Shared JS utilities (API calls, helpers)
├── assets/
│   ├── huadeng.png            # 华登 logo (copy from existing)
│   └── xingxin.png            # 兴信 logo (copy from existing)
└── data/
    ├── config.json            # Factory/engineer/supplier config
    ├── index.json             # Product index for fast listing
    └── products/              # One JSON per product
```

---

## Task 1: Project Scaffold

**Files:**
- Create: `plugins/工程资料生成器/package.json`
- Create: `plugins/工程资料生成器/.env.example`
- Create: `plugins/工程资料生成器/Dockerfile.node`
- Create: `plugins/工程资料生成器/data/config.json`
- Create: `plugins/工程资料生成器/data/index.json`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "eng-doc-generator",
  "version": "1.0.0",
  "description": "工程资料生成器 - 一键生成全套工程Excel文档",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "node --watch server.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "exceljs": "^4.4.0",
    "archiver": "^6.0.1",
    "uuid": "^9.0.0",
    "multer": "^1.4.5-lts.1"
  }
}
```

- [ ] **Step 2: Create .env.example and .env**

`.env.example`:
```
PORT=3000
DATA_PATH=./data
```

Copy `.env.example` to `.env` (same content for local dev).

- [ ] **Step 3: Create Dockerfile.node**

```dockerfile
FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache curl
COPY plugins/工程资料生成器/package.json ./
RUN npm install --production
COPY plugins/工程资料生成器/ ./
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD curl -f http://localhost:3000/health || exit 1
CMD ["node", "server.js"]
```

- [ ] **Step 4: Create initial data files**

`data/config.json`:
```json
{
  "factories": [
    { "name": "华登", "full_name": "东莞华登塑胶制品有限公司", "logo": "huadeng.png" },
    { "name": "兴信", "full_name": "东莞兴信塑胶制品有限公司", "logo": "xingxin.png" }
  ],
  "engineers": [],
  "suppliers": []
}
```

`data/index.json`:
```json
[]
```

Create empty `data/products/` directory (add `.gitkeep`).

- [ ] **Step 5: Copy logo files to assets/**

Copy logo PNGs from `plugins/工程啤办单/public/` (华登logo and 兴信logo) into `plugins/工程资料生成器/assets/`.

- [ ] **Step 6: Install dependencies**

Run: `cd plugins/工程资料生成器 && npm install`

- [ ] **Step 7: Commit**

```
git add plugins/工程资料生成器/
git commit -m "feat(工程资料生成器): scaffold project with package.json, Dockerfile, initial data"
```

---

## Task 2: Express Server + Data Layer

**Files:**
- Create: `plugins/工程资料生成器/server.js`

- [ ] **Step 1: Create server.js with Express setup and data layer**

Server must include:
- Express setup (json body parser 50mb, static file serving from `public/`, assets serving from `assets/`)
- `DATA_PATH` and `PORT` from env vars
- Per-product file storage: `loadConfig()`, `saveConfig()`, `loadIndex()`, `saveIndex()`, `loadProduct(id)`, `saveProduct(product)`
- Write queue pattern (serialized writes via promise chain, same as 新产品开发进度表)
- `.bak` backup before every write
- Auto-create `data/products/` directory if not exists
- `GET /health` endpoint

Key data functions:

```javascript
const DATA_PATH = process.env.DATA_PATH || './data';
const CONFIG_FILE = path.join(DATA_PATH, 'config.json');
const INDEX_FILE = path.join(DATA_PATH, 'index.json');
const PRODUCTS_DIR = path.join(DATA_PATH, 'products');

let writeChain = Promise.resolve();

function loadIndex() {
  if (!fs.existsSync(INDEX_FILE)) {
    fs.writeFileSync(INDEX_FILE, '[]', 'utf-8');
  }
  return JSON.parse(fs.readFileSync(INDEX_FILE, 'utf-8'));
}

function saveIndex(index) {
  writeChain = writeChain.then(() => {
    if (fs.existsSync(INDEX_FILE)) {
      fs.copyFileSync(INDEX_FILE, INDEX_FILE + '.bak');
    }
    fs.writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2), 'utf-8');
  });
  return writeChain;
}

function loadProduct(id) {
  const file = path.join(PRODUCTS_DIR, `${id}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

function saveProduct(product) {
  const file = path.join(PRODUCTS_DIR, `${product.id}.json`);
  writeChain = writeChain.then(() => {
    if (fs.existsSync(file)) {
      fs.copyFileSync(file, file + '.bak');
    }
    fs.writeFileSync(file, JSON.stringify(product, null, 2), 'utf-8');
  });
  return writeChain;
}
```

- [ ] **Step 2: Verify server starts**

Run: `cd plugins/工程资料生成器 && node server.js`
Visit: `http://localhost:3000/health` → should return `{ "status": "ok" }`

- [ ] **Step 3: Commit**

```
git commit -m "feat(工程资料生成器): add Express server with data layer and health check"
```

---

## Task 3: CRUD API Routes

**Files:**
- Modify: `plugins/工程资料生成器/server.js`

- [ ] **Step 1: Add product CRUD routes**

```
GET    /api/products          - List products from index (supports ?search=&engineer= query)
GET    /api/products/:id      - Load full product JSON
POST   /api/products          - Create new product (validate factory, product_number, product_name required)
PUT    /api/products/:id      - Update product (merge fields, update index entry)
DELETE /api/products/:id      - Delete product file + remove from index
```

Validation middleware for POST/PUT:
- `factory`, `product_number`, `product_name` are required
- Numeric fields (weights, dimensions) must be number or null if present

Index entry format (stored in index.json for fast listing):
```json
{
  "id": "uuid",
  "product_number": "T02428",
  "product_name": "9.5寸暴力熊",
  "client_name": "Toy Monster",
  "factory": "华登",
  "engineer": "胡帆",
  "created_at": "2026-03-25",
  "updated_at": "2026-03-25"
}
```

- [ ] **Step 2: Add copy route**

```
POST /api/products/:id/copy  - Deep copy product, assign new UUID, clear product_number, update timestamps
```

- [ ] **Step 3: Add config routes**

```
GET /api/config   - Return config.json contents
PUT /api/config   - Overwrite config.json (with .bak backup)
```

- [ ] **Step 4: Verify all routes with curl**

```bash
# Create
curl -X POST http://localhost:3000/api/products -H "Content-Type: application/json" -d '{"factory":"华登","product_number":"TEST-001","product_name":"测试产品","client_name":"Test"}'

# List
curl http://localhost:3000/api/products

# Get
curl http://localhost:3000/api/products/<id>

# Update
curl -X PUT http://localhost:3000/api/products/<id> -H "Content-Type: application/json" -d '{"product_name":"测试产品-修改"}'

# Copy
curl -X POST http://localhost:3000/api/products/<id>/copy

# Delete
curl -X DELETE http://localhost:3000/api/products/<id>
```

- [ ] **Step 5: Commit**

```
git commit -m "feat(工程资料生成器): add CRUD + copy + config API routes"
```

---

## Task 4: Frontend Utilities (utils.js + style.css)

**Files:**
- Create: `plugins/工程资料生成器/public/utils.js`
- Create: `plugins/工程资料生成器/public/style.css`

- [ ] **Step 1: Create utils.js**

Shared frontend utilities:
- `api(method, url, body)` — fetch wrapper with JSON handling and error display
- `showToast(message, type)` — Bootstrap toast notification
- `formatDate(dateStr)` — format ISO date to YYYY-MM-DD display
- `debounce(fn, ms)` — debounce for search input

Follow the same patterns as `plugins/工程啤办单/public/utils.js`.

- [ ] **Step 2: Create style.css**

Shared styles matching the existing RR Portal look:
- Company brand colors
- Table styles (striped, hover)
- Tab panel styles
- Dynamic row add/delete button styles
- Form layout for the 6-tab editor
- Responsive adjustments

Follow Bootstrap 5 conventions, matching `plugins/工程啤办单/public/style.css` aesthetic.

- [ ] **Step 3: Commit**

```
git commit -m "feat(工程资料生成器): add frontend utilities and styles"
```

---

## Task 5: Product List Page (index.html)

**Files:**
- Create: `plugins/工程资料生成器/public/index.html`

- [ ] **Step 1: Create index.html**

Page structure:
- Header: "工程资料生成器" title
- Search bar: text input for product_number/name/client search
- Filter: dropdown for engineer filter (populated from /api/config)
- Action buttons: 「新建产品」→ redirect to product.html, 「从已有产品复制」→ modal
- Product table: columns = 产品编号, 产品名称, 客户, 厂区, 工程师, 更新日期, 操作
- 操作 column: 编辑 (→ product.html?id=xxx), 生成Excel (POST /api/products/:id/generate → download ZIP), 删除 (confirm → DELETE)
- Copy modal: show product list, click to copy → redirects to product.html?id=<new_id>

Load data from `GET /api/products?search=&engineer=`. Search is client-side filtered + server query param.

Include Bootstrap 5 CDN, utils.js, style.css.

- [ ] **Step 2: Verify page loads and shows empty list**

Run server, open `http://localhost:3000/index.html`
Expected: Page renders with empty table, "新建产品" button visible.

- [ ] **Step 3: Commit**

```
git commit -m "feat(工程资料生成器): add product list page"
```

---

## Task 6: Product Editor Page — Tab 1-3 (product.html)

**Files:**
- Create: `plugins/工程资料生成器/public/product.html`

- [ ] **Step 1: Create product.html with base structure and Tab 1 (基本信息)**

Page structure:
- Read `?id=xxx` from URL. If present, load product via `GET /api/products/:id`. If not, new product mode.
- 6 Bootstrap nav-tabs: 基本信息 | 零件清单 | 外购件 | 尺寸重量 | 生产注意事项 | 作业指导书
- Top action bar: 「保存」button (PUT/POST), 「生成Excel」button, 「返回列表」link
- Auto-save indicator

Tab 1 — 基本信息:
- 厂区: radio buttons (华登 / 兴信)
- 产品编号: text input
- 产品名称: text input
- 客户名称: text input
- 订单数量: number input
- 年龄分组: text input (e.g. "4+")
- 工程师: text input
- 编制日期: date input (default today)

- [ ] **Step 2: Add Tab 2 (零件清单)**

Dynamic table with add/delete rows. Columns:
- 分组 (group): text — for multi-Sheet in 排模表
- 模具编号 (mold_id): text
- 模具名称 (mold_name): text
- 零件编号 (part_number): text
- 物料名称 (part_name): text
- 材料 (material): text
- 海关备案名称 (customs_name): text
- 颜色 (color): text
- 色粉编号 (pigment_no): text
- 加工内容 (process): text
- 水口比率% (runner_ratio): number
- 混水口比例% (mixed_ratio): number
- 整啤毛重g (gross_weight_g): number
- 整啤净重g (net_weight_g): number
- 单净重g (single_net_weight_g): number
- 模腔数 (cavities): number
- 出模数 (output_per_shot): number
- 套数 (sets): number
- 用量 (usage_ratio): text (e.g. "1/4")
- 需求数 (order_qty): number
- 机型 (machine_type): text
- 模架尺寸 (mold_size): text
- 模具数量 (mold_count): text
- 备注 (notes): text

Table is horizontally scrollable. "添加行" button at bottom, each row has "删除" button.

- [ ] **Step 3: Add Tab 3 (外购件)**

Dynamic table with add/delete rows. Columns:
- 类别 (category): select (彩盒 / 吸塑 / 辅料 / 纸箱)
- 物料名称 (name): text
- 物料编号 (part_number): text
- 规格 (spec): text
- 材料 (material): text
- 海关备案名称 (customs_name): text
- 颜色 (color): text
- 用量 (usage_ratio): text
- 需求数 (order_qty): number
- 单重g (unit_weight_g): number
- 供应商 (supplier): text
- 表面处理 (surface_treatment): text
- 用途 (purpose): text
- 备注 (notes): text

Rows can be grouped by category (optional visual grouping).

- [ ] **Step 4: Wire up save button for Tabs 1-3**

Save button collects data from all tabs into a product object and sends:
- `POST /api/products` for new products
- `PUT /api/products/:id` for existing products

After save, update URL with `?id=<new_id>` if newly created.

- [ ] **Step 5: Verify create + edit flow**

1. Open `http://localhost:3000/product.html`
2. Fill Tab 1 basic info
3. Add a part row in Tab 2
4. Add a purchase row in Tab 3
5. Click Save → should redirect to `product.html?id=<uuid>`
6. Refresh page → data should reload from server

- [ ] **Step 6: Commit**

```
git commit -m "feat(工程资料生成器): add product editor page with tabs 1-3 (基本信息, 零件, 外购件)"
```

---

## Task 7: Product Editor Page — Tab 4-6

**Files:**
- Modify: `plugins/工程资料生成器/public/product.html`

- [ ] **Step 1: Add Tab 4 (尺寸重量)**

Form sections:
- 装箱方式 (packing_method): text
- 内箱材质 (inner_box_material): text
- 外箱材质 (outer_box_material): text

Subsections with labeled fieldsets:
- **产品光身**: 阶段(stage), 长(width), 宽(depth), 高(height), 重量kg(weight_kg)
- **包装**: 阶段, 长, 宽, 高含J钩(height_with_hook), 高不含J钩(height_no_hook), 毛重kg(gross_weight_kg)
- **PDQ/展示盒** (collapsible): 长, 宽, 组装高(closed_height), 打开高(open_height), 总重量kg(total_weight_kg)
- **内箱-订箱尺寸**: 长, 宽, 高, 净重, 毛重
- **内箱-量箱尺寸**: 长, 宽, 高, 净重, 毛重
- **外箱-订箱尺寸**: 长, 宽, 高, 净重, 毛重
- **外箱-量箱尺寸**: 长, 宽, 高, 净重, 毛重

All dimension fields are number inputs with "cm" or "kg" suffix labels.

- [ ] **Step 2: Add Tab 5 (生产注意事项)**

Form fields (all textarea, 4-6 rows):
- 产品介绍 (product_intro)
- 功能玩法描述 (function_desc)
- 测试要求 (test_requirements)
- 啤塑注意事项 (injection_notes)
- 装配/贴水纸注意事项 (assembly_notes)
- 包装注意事项 (packaging_notes)

- [ ] **Step 3: Add Tab 6 (作业指导书)**

Dynamic list of work instruction cards. Each card:
- Header: 工序编号 (seq, auto-numbered), 工序名称 (name), 操作时间 (cycle_time)
- 使用零件 table: 名称(name), 材料规格(material), 用量(qty) — dynamic rows
- 作业内容 (steps): numbered textarea lines — each step is a line
- 作业工具 (tools): comma-separated text input
- 注意事项 (cautions): comma-separated text input
- Delete button per card, "添加工序" button at bottom

Seq numbers auto-renumber when cards are added/deleted.

- [ ] **Step 4: Wire up save for all 6 tabs**

Update the save function to collect data from Tabs 4-6 into the product object:
- `dimensions` object from Tab 4
- `production_notes` object from Tab 5
- `work_instructions` array from Tab 6

- [ ] **Step 5: Verify full save/load cycle**

1. Create a product with all 6 tabs filled
2. Save → Refresh → All data persists
3. Edit some fields → Save → Refresh → Changes persisted

- [ ] **Step 6: Commit**

```
git commit -m "feat(工程资料生成器): add product editor tabs 4-6 (尺寸重量, 注意事项, 作业指导书)"
```

---

## Task 8: Excel Generator — Common Helpers

**Files:**
- Create: `plugins/工程资料生成器/generators/common.js`

- [ ] **Step 1: Create common.js**

Shared utilities for all 5 generators:

```javascript
const ExcelJS = require('exceljs');
const path = require('path');

// Standard fonts
const TITLE_FONT = { name: '宋体', size: 16, bold: true };
const HEADER_FONT = { name: '宋体', size: 10, bold: true };
const CELL_FONT = { name: '宋体', size: 9 };

// Standard borders
const THIN_BORDER = {
  top: { style: 'thin' }, bottom: { style: 'thin' },
  left: { style: 'thin' }, right: { style: 'thin' }
};

// Add company header (logo + company name + document title)
async function addCompanyHeader(worksheet, factoryConfig, docTitle, docNumber, startRow) { ... }

// Add signature footer (编制/审核/批准/日期)
function addSignatureFooter(worksheet, startRow) { ... }

// Apply border to a range
function applyBorders(worksheet, startRow, endRow, startCol, endCol) { ... }

// Merge and center
function mergeCenter(worksheet, startRow, startCol, endRow, endCol, value, font) { ... }

module.exports = { TITLE_FONT, HEADER_FONT, CELL_FONT, THIN_BORDER,
  addCompanyHeader, addSignatureFooter, applyBorders, mergeCenter };
```

`addCompanyHeader` should:
- Insert logo image from `assets/{logo}` (use `worksheet.addImage()`)
- Merge cells for company name across columns
- Add document title below
- Add document number/version if provided

`addSignatureFooter` should:
- Add row: "编制：" | "" | "审核：" | "" | "批准：" | "" | "日期："
- Add row: "Name 姓名:" repeated
- Add row: "Date 日期:" repeated

- [ ] **Step 2: Verify common.js loads without errors**

```bash
node -e "const c = require('./generators/common.js'); console.log(Object.keys(c));"
```

- [ ] **Step 3: Commit**

```
git commit -m "feat(工程资料生成器): add common Excel generation helpers"
```

---

## Task 9: Excel Generator — 排模表 (Mold Table)

**Files:**
- Create: `plugins/工程资料生成器/generators/mold-table.js`

- [ ] **Step 1: Create mold-table.js**

Reference template: `D:/产品/Toy monster/暴力熊/Toy Monster Bear T02428 暴力熊/9.5寸/9.5寸暴力熊工程资料/T02428 9.5寸暴力熊排模表.xls`

The generator must:
1. Group parts by `group` field → each group becomes a separate Sheet
2. Per sheet:
   - Company header with logo, "排模表", 文件编号 HSQR0064, 版本号 A/0
   - Info row: 客户名称, 产品编号, 产品名称, 编制, 审核, 批准, 日期
   - Right-aligned: "Total Order Quantities (pcs)" with order_qty
   - Header row with all column labels (工模编号, 模具名称, 零件编号, 物料名称, 用料名称, 海关备案料件名称, 颜色, 色粉编号, 加工内容, 水口比率%, 混水口比例%, 整啤毛重g, 整啤净重g, 单净重g, 整啤模腔数, 出模数, 套数, 用量, 订单需求数, 搭配, 机型, 日产能, 模架尺寸, 备注)
   - Data rows: one row per part, with sub-rows for parts sharing a mold (mold_id grouping)
   - Signature footer

```javascript
async function generate(product, factoryConfig) {
  const workbook = new ExcelJS.Workbook();
  // Group parts by group field
  const groups = {};
  for (const part of product.parts || []) {
    const g = part.group || '默认';
    if (!groups[g]) groups[g] = [];
    groups[g].push(part);
  }
  for (const [groupName, parts] of Object.entries(groups)) {
    const ws = workbook.addWorksheet(groupName);
    // ... build sheet
  }
  return workbook;
}
```

- [ ] **Step 2: Test generation with sample data**

```bash
node -e "
const gen = require('./generators/mold-table.js');
const product = {
  factory: '华登', product_number: 'TEST-001', product_name: '测试产品',
  client_name: 'Test', order_qty: 20000,
  parts: [{ group: '默认', mold_id: 'M01', mold_name: '测试模', part_number: 'P01',
    part_name: '零件1', material: 'ABS', color: '白色', gross_weight_g: 50, net_weight_g: 45,
    single_net_weight_g: 45, cavities: 1, output_per_shot: 1, sets: 1, usage_ratio: '1/1',
    order_qty: 20000 }]
};
const config = { name: '华登', full_name: '东莞华登塑胶制品有限公司', logo: 'huadeng.png' };
gen.generate(product, config).then(wb => wb.xlsx.writeFile('/tmp/test-mold.xlsx')).then(() => console.log('OK'));
"
```

- [ ] **Step 3: Commit**

```
git commit -m "feat(工程资料生成器): add 排模表 Excel generator"
```

---

## Task 10: Excel Generator — 外箱资料 (Carton Spec)

**Files:**
- Create: `plugins/工程资料生成器/generators/carton-spec.js`

- [ ] **Step 1: Create carton-spec.js**

Reference template: `D:/产品/Toy monster/暴力熊/Toy Monster Bear T02428 暴力熊/9.5寸/9.5寸暴力熊工程资料/T02428 9.5寸暴力熊外箱资料.xlsx`

Sheet 1 "数据表":
- Company header + "外箱放产资料" title
- Info section: 客户名称, 产品编号, 产品名称, 装箱方式, 内箱材质, 外箱材质
- 产品资料 section: header row (阶段, Prod Width cm, Prod Depth cm, Prod Height cm, Prod Weight kg), data row
- 包装资料 section: similar layout with package dimensions
- PDQ section: (if display data exists)
- 内箱资料 section: 订箱尺寸 + 量箱尺寸 rows
- 外箱资料 section: 订箱尺寸 + 量箱尺寸 rows
- Signature footer

Sheet 2 "相片" (placeholder):
- "外箱放产资料" title
- Sections: 量箱完整示图, 量箱尺寸放大图, 毛重磅称示图, 净重磅称示图, 产品包装示图
- Each section has placeholder cells (photos to be manually inserted later)

- [ ] **Step 2: Test generation**

- [ ] **Step 3: Commit**

```
git commit -m "feat(工程资料生成器): add 外箱资料 Excel generator"
```

---

## Task 11: Excel Generator — 外购清单 (Purchase List)

**Files:**
- Create: `plugins/工程资料生成器/generators/purchase-list.js`

- [ ] **Step 1: Create purchase-list.js**

Reference template: `D:/产品/Toy monster/暴力熊/Toy Monster Bear T02428 暴力熊/9.5寸/9.5寸暴力熊工程资料/T02428 9.5寸暴力熊外购清单(5).xls`

Sheet "外购件":
- Company header + "外购件清单" title, 文件编号 HSQR0063, 版本号 A/0
- Info row: 客户名称, 产品编号, 产品名称, 编制, 审核, 批准, 日期
- Header row: 序号, 类别, 物料名称, 物料编号, 规格, 材料, 海关备案料件名称, 颜色, 用量, 订单需求数, 单重g, 供应商, 表面处理, 用途, 备注
- Data rows: grouped by category (彩盒, 吸塑, 辅料, 纸箱) with blank separator rows between groups
- Counter (序号) resets per category group
- Footer note: "所有物料均要符合ROHS/NP和客PO及客相关测试要求"
- Right-aligned: "Total Order Quantities (pcs)" with order_qty

- [ ] **Step 2: Test generation**

- [ ] **Step 3: Commit**

```
git commit -m "feat(工程资料生成器): add 外购清单 Excel generator"
```

---

## Task 12: Excel Generator — 生产注意事项 (Production Notes)

**Files:**
- Create: `plugins/工程资料生成器/generators/production-notes.js`

- [ ] **Step 1: Create production-notes.js**

Reference template: `D:/产品/Toy monster/暴力熊/Toy Monster Bear T02428 暴力熊/9.5寸/9.5寸暴力熊工程资料/T02428 9.5寸暴力熊 生產注意事項.xlsx`

Single sheet "重点工位生产注意事项":
- Company header + "重点工位生产注意事项" title, 文件编号 HSQR0076
- Info row: 产品编号, 产品名称, 年龄分组, 版本号 A0
- 发放部门 checkboxes (text): □经理室 □计划部 □啤机部 □喷油部 □装配部 □QC部
- Sections with Roman numerals:
  - 一、产品介绍 (product_intro) — with space for images
  - 二、功能玩法以及描述 (function_desc)
  - 三、测试要求 (test_requirements)
  - 四、啤塑 (injection_notes)
  - 五、装配/贴水纸 (assembly_notes)
  - 六、包装 (packaging_notes)
- Each section: title row + multi-line text content (split by \n into rows)
- Signature footer with date

- [ ] **Step 2: Test generation**

- [ ] **Step 3: Commit**

```
git commit -m "feat(工程资料生成器): add 生产注意事项 Excel generator"
```

---

## Task 13: Excel Generator — 作业指导书 (Work Instructions)

**Files:**
- Create: `plugins/工程资料生成器/generators/work-instructions.js`

- [ ] **Step 1: Create work-instructions.js**

Reference template: `D:/产品/Toy monster/暴力熊/Toy Monster Bear T02428 暴力熊/9.5寸/9.5寸暴力熊工程资料/9.5寸暴力熊作业指导书20250826.xlsx`

Each work instruction (工序) generates ONE sheet in the workbook. Sheet name = "工序{seq}-{name}".

Per sheet layout:
- Company header + "作业指导书" title
- Info row: 产品编号, 货名, 客户, 单工位操作时间, 目标数
- Sub-header: 产品名称, 工序编号, 工序名称, 工作时间
- Main table:
  - Left columns: 序号, 零件名称, 零件材料和规格, 用量, 作业内容 (multi-row)
  - Right columns: 作业图示 (placeholder for images)
- Bottom section:
  - 作业工具 table: numbered list
  - 注意事项 table: numbered list
- Signature footer: 编制, 审核, 日期

- [ ] **Step 2: Test generation**

- [ ] **Step 3: Commit**

```
git commit -m "feat(工程资料生成器): add 作业指导书 Excel generator"
```

---

## Task 14: Generate & Download API Routes

**Files:**
- Modify: `plugins/工程资料生成器/server.js`

- [ ] **Step 1: Add generate routes to server.js**

```javascript
const archiver = require('archiver');
const moldTable = require('./generators/mold-table');
const cartonSpec = require('./generators/carton-spec');
const purchaseList = require('./generators/purchase-list');
const productionNotes = require('./generators/production-notes');
const workInstructions = require('./generators/work-instructions');

const GENERATORS = {
  mold: { gen: moldTable, suffix: '排模表' },
  carton: { gen: cartonSpec, suffix: '外箱资料' },
  purchase: { gen: purchaseList, suffix: '外购清单' },
  notes: { gen: productionNotes, suffix: '生产注意事项' },
  sop: { gen: workInstructions, suffix: '作业指导书' },
};

// Generate all → ZIP
app.post('/api/products/:id/generate', async (req, res) => {
  const product = loadProduct(req.params.id);
  if (!product) return res.status(404).json({ error: 'Product not found' });

  const config = loadConfig();
  const factory = config.factories.find(f => f.name === product.factory);

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition',
    `attachment; filename="${encodeURIComponent(product.product_number + '_' + product.product_name)}_工程资料.zip"`);

  const archive = archiver('zip');
  archive.pipe(res);

  for (const [key, { gen, suffix }] of Object.entries(GENERATORS)) {
    const wb = await gen.generate(product, factory);
    const buffer = await wb.xlsx.writeBuffer();
    const fileName = `${product.product_number} ${product.product_name}${suffix}.xlsx`;
    archive.append(buffer, { name: fileName });
  }

  await archive.finalize();
});

// Generate single document
app.post('/api/products/:id/generate/:type', async (req, res) => {
  const { type } = req.params;
  if (!GENERATORS[type]) return res.status(400).json({ error: 'Invalid type' });

  const product = loadProduct(req.params.id);
  if (!product) return res.status(404).json({ error: 'Product not found' });

  const config = loadConfig();
  const factory = config.factories.find(f => f.name === product.factory);
  const { gen, suffix } = GENERATORS[type];
  const wb = await gen.generate(product, factory);
  const buffer = await wb.xlsx.writeBuffer();
  const fileName = `${product.product_number} ${product.product_name}${suffix}.xlsx`;

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
  res.send(buffer);
});
```

- [ ] **Step 2: Wire up "生成Excel" button in index.html and product.html**

In both pages, the generate button should:
```javascript
async function generateExcel(productId) {
  const res = await fetch(`/api/products/${productId}/generate`, { method: 'POST' });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = ''; // Use Content-Disposition filename
  a.click();
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 3: Test end-to-end**

1. Create a product with all tabs filled
2. Click "生成Excel" from list page
3. ZIP downloads with 5 xlsx files
4. Open each xlsx → verify formatting matches templates

- [ ] **Step 4: Commit**

```
git commit -m "feat(工程资料生成器): add Excel generate & download API with ZIP packaging"
```

---

## Task 15: Docker & Nginx Integration

**Files:**
- Modify: `docker-compose.cloud.yml` (or `docker-compose.yml`)
- Modify: `nginx/nginx.cloud.conf` (or `nginx/nginx.conf`)

- [ ] **Step 1: Add service to docker-compose**

Add `eng-doc-generator` service to docker-compose file:
```yaml
eng-doc-generator:
  build:
    context: .
    dockerfile: plugins/工程资料生成器/Dockerfile.node
  environment:
    - PORT=3000
    - DATA_PATH=/app/data
  volumes:
    - "./plugins/工程资料生成器/data:/app/data"
  restart: unless-stopped
  networks:
    - platform-net
```

- [ ] **Step 2: Add Nginx upstream and location**

Add to nginx config:
```nginx
upstream eng-doc-generator { server eng-doc-generator:3000; }

location /eng-docs/api/ { proxy_pass http://eng-doc-generator/api/; }
location /eng-docs/     { proxy_pass http://eng-doc-generator/; }
```

- [ ] **Step 3: Update CLAUDE.md plugin registry**

Add to the plugin registry table:
```
| 工程资料生成器 | 工程资料生成器 | Engineering | Standalone (Node.js) | — |
```

- [ ] **Step 4: Build and test in Docker**

```bash
docker compose up -d --build eng-doc-generator
docker compose logs eng-doc-generator
docker compose restart nginx
```

Verify: `http://localhost/eng-docs/` loads the product list page.

- [ ] **Step 5: Commit**

```
git commit -m "feat(工程资料生成器): add Docker and Nginx integration"
```

---

## Task 16: Final Polish & Verification

**Files:**
- Various minor fixes across all files

- [ ] **Step 1: Test complete workflow**

Full end-to-end test:
1. Open product list → empty
2. Click "新建产品" → fill all 6 tabs with real data (use 暴力熊 T02428 as reference)
3. Save → product appears in list
4. Click "从已有产品复制" → select the product → new copy created with empty product_number
5. Edit the copy → change product_number and name → save
6. From list, click "生成Excel" on original product → download ZIP
7. Open each of the 5 Excel files → verify:
   - Company header correct (华登/兴信)
   - Data filled correctly
   - Formatting matches original templates
   - Signature footer present
8. Delete the test copy → confirm deletion works
9. Search/filter works on list page

- [ ] **Step 2: Fix any issues found in testing**

- [ ] **Step 3: Final commit**

```
git commit -m "feat(工程资料生成器): polish and final verification"
```
