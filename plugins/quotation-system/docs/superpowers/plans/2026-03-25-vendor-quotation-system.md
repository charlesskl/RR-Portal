# Vendor Quotation System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a web-based quotation system that imports 本厂报价明细 Excel, edits cost data organized by Vendor Quotation / Body Cost Breakdown sections, and exports TOMY-formatted Excel.

**Architecture:** Node.js + Express backend with SQLite (better-sqlite3) for persistence, ExcelJS for Excel I/O, vanilla HTML/CSS/JS frontend. Template-driven export reads TOMY xlsx template and fills data while preserving formatting.

**Tech Stack:** Node.js, Express, ExcelJS, better-sqlite3, vanilla HTML/CSS/JS

**Spec:** `docs/superpowers/specs/2026-03-25-vendor-quotation-system-design.md`

---

## File Map

### Server
| File | Responsibility |
|------|---------------|
| `server/server.js` | Express app, static serving, route mounting |
| `server/services/db.js` | SQLite schema init, CRUD helpers for all tables |
| `server/services/excel-parser.js` | Parse 本厂报价明细: detect latest sheet, extract all sections |
| `server/services/calculator.js` | Cost calculation engine: material cost, labor, totals, summary |
| `server/services/excel-exporter.js` | Read TOMY template, fill cells, stream download |
| `server/routes/products.js` | GET/POST/DELETE /api/products |
| `server/routes/versions.js` | GET/PUT/DELETE /api/versions, section data CRUD |
| `server/routes/import.js` | POST /api/import — file upload + parse |
| `server/routes/export.js` | GET /api/export/:id — generate and download xlsx |
| `server/templates/` | TOMY template xlsx file (manually placed) |
| `server/data/` | SQLite database file (auto-created) |

### Client
| File | Responsibility |
|------|---------------|
| `client/index.html` | Main SPA shell: sidebar + content area + tab container |
| `client/css/style.css` | All styles: sidebar, tabs, tables, params panel, summary bar |
| `client/js/app.js` | App init, sidebar navigation, tab switching, state management |
| `client/js/api.js` | Fetch wrapper for all API calls |
| `client/js/utils.js` | escapeHtml, formatNumber, debounce, editable cell helpers |
| `client/js/params.js` | Parameter panel: render, edit, save, trigger recalculation |
| `client/js/tabs/vq-body-cost.js` | VQ A区: read-only summary from Breakdown |
| `client/js/tabs/vq-packaging.js` | VQ B区: packaging items table with CRUD |
| `client/js/tabs/vq-purchase.js` | VQ C区: inter-purchase parts table |
| `client/js/tabs/vq-carton.js` | VQ D区: master carton form |
| `client/js/tabs/vq-transport.js` | VQ E区: transport config and cost calc |
| `client/js/tabs/vq-summary.js` | VQ Cost Summary: MOQ × trade term matrix |
| `client/js/tabs/bd-material.js` | Breakdown A: raw material cost table |
| `client/js/tabs/bd-molding.js` | Breakdown B: molding labour table |
| `client/js/tabs/bd-purchase.js` | Breakdown C: purchase parts table |
| `client/js/tabs/bd-decoration.js` | Breakdown D: decoration/painting form |
| `client/js/tabs/bd-others.js` | Breakdown E: others (assembly, accessories) |

### Config
| File | Responsibility |
|------|---------------|
| `package.json` | Dependencies, scripts |
| `Dockerfile` | Container build |
| `docker-compose.yml` | Service orchestration |
| `.gitignore` | Ignore node_modules, data/*.db, dist |

---

## Task 1: Project Setup & Database Schema

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `server/server.js`
- Create: `server/services/db.js`

- [ ] **Step 1: Initialize project**

```bash
cd D:/Projects/报价
npm init -y
npm install express better-sqlite3 exceljs multer cors
```

Update `package.json` scripts:
```json
{
  "scripts": {
    "start": "node server/server.js",
    "dev": "node --watch server/server.js"
  }
}
```

- [ ] **Step 2: Create .gitignore**

```
node_modules/
server/data/*.db
.superpowers/
dist/
*.zip
```

- [ ] **Step 3: Write database service**

Create `server/services/db.js` with:
- `initDb()` — creates all tables from spec (Product, QuoteVersion, QuoteParams, MaterialPrice, MachinePrice, MoldPart, HardwareItem, ElectronicItem, ElectronicSummary, PaintingDetail, PackagingItem, TransportConfig, MoldCost, ProductDimension)
- Each table has version_id FK with CASCADE delete
- Export `getDb()` function that returns initialized db instance

All column names and types match the spec data model exactly.

- [ ] **Step 4: Write Express server**

Create `server/server.js`:
- Import express, cors, path
- Call `initDb()` on startup
- Serve `client/` as static files
- Mount routes at `/api/products`, `/api/versions`, `/api/import`, `/api/export`
- Listen on port 3000 (configurable via PORT env)
- Log "Server running on http://localhost:3000"

- [ ] **Step 5: Verify server starts**

```bash
mkdir -p server/data server/templates server/routes
# Create empty route files so require doesn't fail
echo "const router = require('express').Router(); module.exports = router;" > server/routes/products.js
echo "const router = require('express').Router(); module.exports = router;" > server/routes/versions.js
echo "const router = require('express').Router(); module.exports = router;" > server/routes/import.js
echo "const router = require('express').Router(); module.exports = router;" > server/routes/export.js
npm start
```

Expected: "Server running on http://localhost:3000"

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json .gitignore server/server.js server/services/db.js server/routes/
git commit -m "feat: project setup with Express server and SQLite schema"
```

---

## Task 2: Product & Version CRUD APIs

**Files:**
- Modify: `server/routes/products.js`
- Modify: `server/routes/versions.js`
- Create: `server/services/calculator.js` (stub)

- [ ] **Step 1: Implement product routes**

`server/routes/products.js`:
- `GET /` — list all products with version count
- `POST /` — create product (item_no, item_desc, vendor)
- `GET /:id` — get product with all versions (ordered by created_at desc)
- `DELETE /:id` — delete product (CASCADE deletes versions)

- [ ] **Step 2: Implement version routes**

`server/routes/versions.js`:
- `GET /:id` — get full version data: params + all section data (mold_parts, hardware_items, etc.)
- `PUT /:id` — update version metadata (status, version_name)
- `DELETE /:id` — delete version
- `POST /:id/duplicate` — deep copy version with all related records

Section data CRUD (generic pattern):
- `GET /:id/sections/:section` — list items for section
- `POST /:id/sections/:section` — add item
- `PUT /:id/sections/:section/:itemId` — update item
- `DELETE /:id/sections/:section/:itemId` — delete item

Section name → table mapping: `mold-parts` → MoldPart, `hardware` → HardwareItem, `electronics` → ElectronicItem, `packaging` → PackagingItem, etc.

- [ ] **Step 3: Implement params CRUD**

In versions routes:
- `GET /:id/params` — get QuoteParams + MaterialPrice[] + MachinePrice[]
- `PUT /:id/params` — update QuoteParams
- `PUT /:id/material-prices` — bulk update MaterialPrice[]
- `PUT /:id/machine-prices` — bulk update MachinePrice[]

- [ ] **Step 4: Create calculator stub**

`server/services/calculator.js`:
- Export `recalculate(versionId)` — placeholder that returns empty summary
- Will be fully implemented in Task 5

- [ ] **Step 5: Test APIs with curl**

```bash
# Create product
curl -X POST http://localhost:3000/api/products -H "Content-Type: application/json" -d "{\"item_no\":\"47712\",\"item_desc\":\"Big Farm\",\"vendor\":\"ROYAL REGENT\"}"

# List products
curl http://localhost:3000/api/products
```

Expected: JSON responses with created/listed products.

- [ ] **Step 6: Commit**

```bash
git add server/routes/ server/services/calculator.js
git commit -m "feat: product and version CRUD APIs with section data endpoints"
```

---

## Task 3: Excel Import (报价明细 Parser)

**Files:**
- Create: `server/services/excel-parser.js`
- Modify: `server/routes/import.js`

This is the most complex backend task. The parser must handle the specific layout of 本厂报价明细.

- [ ] **Step 1: Write sheet detection logic**

In `excel-parser.js`, function `detectLatestSheet(workbook)`:
- Get all sheet names
- Filter sheets matching pattern `报价明细-*`
- Extract date portion: "260310" → parse as YYMMDD
- Also handle older formats: "V2", "V3", "0725", "0904" etc.
- Return sheet name with the highest date
- Fallback: last sheet with "报价明细" prefix

- [ ] **Step 2: Write header parser**

Function `parseHeader(worksheet)`:
- R1: product_no (B1)
- R2-R6: material price table (料型 row → 单价HKD/磅 row → 料单价HKD/g row)
  - Iterate columns B through V, build MaterialPrice[] array
- R8-R10: machine price table (机型 row → 啤工价HKD row → 啤工价RMB row)
  - Iterate columns B through N, build MachinePrice[] array
- R11-R14: exchange rates and params
  - C11: hkd_rmb_quote, C12: hkd_rmb_check, C13: rmb_hkd, C14: hkd_usd
  - F13: labor_hkd, F14: box_price_hkd
- R15: date_code, R16: reference number
- Return: { product_no, materialPrices[], machinePrices[], params }

- [ ] **Step 3: Write mold parts parser**

Function `parseMoldParts(worksheet)`:
- Start at R17 (header row): verify A17 = "模号"
- Read rows R18 onward until hitting "合计:" in column C or I
- For each row: part_no(A), description(B), material(C), weight_g(D), unit_price(E), machine_type(F), cavity_count(G), sets_per_toy(H), target_qty(I), molding_labor(J), material_cost_hkd(K), mold_cost_rmb(L), remark(M)
- Mark as is_old_mold if remark contains "旧模" or mold_cost_rmb is null/empty
- Return MoldPart[] array

- [ ] **Step 4: Write cost items parser**

Function `parseCostItems(worksheet)`:
- R40-R47: Labor items (装配人工, 包装人工, 喷油人工, 油漆)
  - Extract: name(A), quantity(B), old_price(C), new_price(D), difference(E)
- R48-R73: Hardware items (五金件, 电镀件, 贴纸, IC, PCBA, 电池)
  - Each row: name(A), quantity(B), old_price(C), new_price(D), difference(E), tax_type(I)
- R76-R93: Packaging items (Window Box, Insert card, Blister, etc.)
  - Same column pattern as hardware
- Return: { laborItems[], hardwareItems[], packagingItems[] }

- [ ] **Step 5: Write summary and config parsers**

Function `parseSummary(worksheet)`:
- R94: 包装合计 (C94)
- R95: 附加税 (C95)
- R97-R105: Cost progression (出厂价, 运费, 码点, 找数, TOTAL HK$/USD)
- R107-R112: Product/carton dimensions, carton price, CU.FT
- R129-R136: Mold costs (模具费用, 五金模, 喷油模具, 总计, 客补贴, 分摊)

Function `parseTransport(worksheet)`:
- R141-R155: All transport config values (CUFT, capacities, costs per route)

Function `parseElectronics(workbook)`:
- Check if sheet "电子" exists
- If yes, parse R6-R35: component list and summary costs
- Return ElectronicItem[] + ElectronicSummary

Function `parsePainting(worksheet)`:
- R46-R47: labor and paint costs
- R129-R132: painting detail (夹/印/抹油/边/散枪 counts)
- Return PaintingDetail

- [ ] **Step 6: Write main import function**

Function `parseWorkbook(filePath)`:
- Read workbook with ExcelJS
- Call detectLatestSheet()
- Get worksheet
- Call all parsers
- Return complete data object: { product, params, materialPrices, machinePrices, moldParts, hardwareItems, electronicItems, electronicSummary, paintingDetail, packagingItems, transportConfig, moldCost, productDimension, summary }

- [ ] **Step 7: Implement import route**

`server/routes/import.js`:
- Use multer for file upload (memory storage)
- Save uploaded file to temp path
- Call `parseWorkbook(tempPath)`
- Create or find Product by item_no
- Create QuoteVersion
- Insert all parsed data into respective tables
- Delete temp file
- Return { productId, versionId }

- [ ] **Step 8: Test import with actual file**

```bash
curl -X POST http://localhost:3000/api/import -F "file=@D:/Projects/报价/47712 本厂报价明细20260310 （电子加价改内部码点）.xlsx"
```

Expected: JSON with productId and versionId. Then verify data:
```bash
curl http://localhost:3000/api/versions/1
```

Should return full version data with all sections populated.

- [ ] **Step 9: Commit**

```bash
git add server/services/excel-parser.js server/routes/import.js
git commit -m "feat: Excel import parser for 本厂报价明细 with all sections"
```

---

## Task 4: Frontend Shell (Layout, Sidebar, Tabs)

**Files:**
- Create: `client/index.html`
- Create: `client/css/style.css`
- Create: `client/js/app.js`
- Create: `client/js/api.js`
- Create: `client/js/utils.js`

- [ ] **Step 1: Create HTML shell**

`client/index.html`:
- Sidebar (fixed left 230px, dark theme): title, import/new buttons, search, product list container
- Main content area: info bar, params panel (collapsible), two-level tab nav, tab content container, summary bar
- Top-level tabs: "Vendor Quotation" / "Body Cost Breakdown"
- VQ sub-tabs: A. Body Cost | B. Packaging | C. Purchase Parts | D. Master Carton | E. Transport | Summary
- Breakdown sub-tabs: A. Raw Material | B. Molding Labour | C. Purchase Parts | D. Decoration | E. Others
- Script tags for all JS files (app.js, api.js, utils.js, params.js, all tab files)
- Hidden file input for import
- Import modal for upload progress

- [ ] **Step 2: Create CSS**

`client/css/style.css`:
- Sidebar styles (dark gradient, nav items, product tree)
- Main content layout (flex column)
- Info bar (product header)
- Params panel (collapsible, grid layout)
- Two-level tab navigation (top-level dark, sub-level pills)
- Table styles (sticky header, striped rows, editable cells)
- Toolbar (add/delete buttons, stats)
- Summary bar (bottom, flex with dividers)
- Modal styles
- Responsive adjustments

Style should match the mockup: `#1a1a2e` dark sidebar, `#4a90d9` blue accents, `#f0f2f5` content background.

- [ ] **Step 3: Create API client**

`client/js/api.js`:
- `api.getProducts()` — GET /api/products
- `api.getVersion(id)` — GET /api/versions/:id
- `api.updateVersion(id, data)` — PUT /api/versions/:id
- `api.importFile(formData)` — POST /api/import
- `api.exportExcel(versionId)` — GET /api/export/:id (triggers download)
- `api.getParams(versionId)` — GET /api/versions/:id/params
- `api.updateParams(versionId, data)` — PUT /api/versions/:id/params
- `api.getSectionItems(versionId, section)` — GET
- `api.addSectionItem(versionId, section, data)` — POST
- `api.updateSectionItem(versionId, section, itemId, data)` — PUT
- `api.deleteSectionItem(versionId, section, itemId)` — DELETE
- `api.calculate(versionId)` — GET /api/versions/:id/calculate

- [ ] **Step 4: Create utils**

`client/js/utils.js`:
- `escapeHtml(str)` — prevent XSS
- `formatNumber(val, decimals)` — number formatting with commas
- `formatCurrency(val, currency)` — e.g. "HK$ 121.63"
- `debounce(fn, ms)` — debounce for auto-save
- `makeEditable(td, options)` — double-click to edit cell (input/select), Enter save, Escape cancel, blur save. Options: { type: 'text'|'number'|'select', choices: [], onSave: fn }

- [ ] **Step 5: Create app.js**

`client/js/app.js`:
- State: `currentProductId`, `currentVersionId`, `currentTab`, `currentLevel` (vq/bd)
- `init()` — load products, render sidebar, set up event listeners
- `renderSidebar(products)` — product tree with expandable versions
- `selectVersion(productId, versionId)` — load version data, render all tabs
- `switchLevel(level)` — switch between VQ and Breakdown top tabs
- `switchTab(tabName)` — switch sub-tab, render content
- `handleImport()` — file dialog, upload, refresh sidebar
- `renderInfoBar(product, version)` — top info bar
- `renderSummaryBar(summary)` — bottom summary totals

- [ ] **Step 6: Test shell loads**

```bash
npm run dev
```

Open http://localhost:3000 — should see the empty shell with sidebar, tabs, no data. Import button should trigger file dialog.

- [ ] **Step 7: Commit**

```bash
git add client/
git commit -m "feat: frontend shell with sidebar, two-level tabs, and API client"
```

---

## Task 5: Calculation Engine

**Files:**
- Modify: `server/services/calculator.js`

- [ ] **Step 1: Implement per-part calculations**

```javascript
function calcMoldPart(part, materialPrices, machinePrices) {
  // Lookup material price
  const mp = materialPrices.find(m => m.material_type.trim() === part.material.trim());
  const unitPrice = mp ? mp.price_hkd_per_g : 0;

  // Lookup machine price
  const machinePrice = lookupMachinePrice(part.machine_type, machinePrices);

  // Calculate
  const materialCost = part.weight_g * unitPrice;
  const moldingLabor = machinePrice / part.cavity_count / part.target_qty * part.sets_per_toy;

  return { unit_price_hkd_g: unitPrice, material_cost_hkd: materialCost, molding_labor: moldingLabor };
}
```

`lookupMachinePrice(machineType, machinePrices)`: match "14A" to "14A-16A" range by parsing the range string.

- [ ] **Step 2: Implement Body Cost Breakdown summary**

```javascript
function calcBodyBreakdown(moldParts, hardwareItems, paintingDetail, params) {
  const rawMaterial = { subTotal: sum(moldParts, 'material_cost_hkd'), markup: params.markup_body };
  const moldingLabour = { subTotal: sum(moldParts, 'molding_labor'), markup: params.markup_body };
  const purchaseParts = { subTotal: sumHardware(hardwareItems), markup: params.markup_body };
  const decoration = { subTotal: paintingDetail.labor_cost_hkd + paintingDetail.paint_cost_hkd, markup: params.markup_body };
  const others = { subTotal: calcOthers(...), markup: params.markup_body };

  // Each: amount = subTotal * (1 + markup)
  // pctToBody = amount / totalBodyCost
  // totalBodyCost = sum of all amounts

  return { rawMaterial, moldingLabour, purchaseParts, decoration, others, totalBodyCost };
}
```

- [ ] **Step 3: Implement Vendor Quotation summary**

```javascript
function calcVqSummary(bodyBreakdown, packagingItems, hardwareItems, transportConfig, params) {
  // A. Body Cost (from breakdown)
  const bodyCost = bodyBreakdown.totalBodyCost;

  // B. Packaging (sum items + packing labour + markup)
  const packagingTotal = calcPackagingTotal(packagingItems, params);

  // C. Inter-purchase (subset of hardware that goes to VQ C section)
  const purchaseTotal = calcPurchaseTotal(hardwareItems);

  // D. Master Carton
  const cartonTotal = calcCartonTotal(productDimension);

  // E. Transport (per route: ex-factory, FOB FCL, FOB LCL)
  const transport = calcTransport(transportConfig);

  // Cost Summary matrix: per MOQ × per trade term
  // Standard MOQ: 2.5K, 5K, 10K, 15K (mold amortization varies)
  return { bodyCost, packagingTotal, purchaseTotal, cartonTotal, transport, summaryMatrix };
}
```

- [ ] **Step 4: Implement full recalculation**

```javascript
function recalculate(versionId) {
  const db = getDb();
  // Load all data for this version
  // Run calcMoldPart for each part, update DB
  // Run calcBodyBreakdown, return summary
  // Run calcVqSummary, return full summary
  // Return everything for frontend rendering
}
```

- [ ] **Step 5: Wire calculation to API**

Add to versions routes:
- `GET /:id/calculate` — calls `recalculate(versionId)`, returns JSON summary

- [ ] **Step 6: Commit**

```bash
git add server/services/calculator.js server/routes/versions.js
git commit -m "feat: cost calculation engine with body breakdown and VQ summary"
```

---

## Task 6: Params Panel & Body Cost Breakdown Tabs

**Files:**
- Create: `client/js/params.js`
- Create: `client/js/tabs/bd-material.js`
- Create: `client/js/tabs/bd-molding.js`
- Create: `client/js/tabs/bd-purchase.js`
- Create: `client/js/tabs/bd-decoration.js`
- Create: `client/js/tabs/bd-others.js`

- [ ] **Step 1: Implement params panel**

`client/js/params.js`:
- `renderParams(params, materialPrices, machinePrices)` — render collapsible panel
- Main params row: exchange rates, markup, labor, box price, 码点, 找数, 附加税
- Expandable sections: material price table, machine price table
- Double-click to edit any value
- On save: PUT /api/versions/:id/params → trigger recalculation → update summary bar

- [ ] **Step 2: Implement Raw Material tab (bd-material.js)**

Renders table of mold parts showing material-related columns:
- Columns: ☐, 模号, 名称, 料型(dropdown from MaterialPrice), 料重(G), 料价HKD/g(auto), 料金额HKD(calc)
- Toolbar: add row, delete selected, stats (Sub Total / Mark Up / Amount / % to Body)
- Editable: 料型 (dropdown), 料重
- Changing 料型 → auto-updates 料价HKD/g from MaterialPrice table
- Changing 料重 → auto-recalculates 料金额HKD
- New/old mold grouping with collapsible separator

- [ ] **Step 3: Implement Molding Labour tab (bd-molding.js)**

Same mold parts data, different columns:
- Columns: ☐, 模号, 名称, 机型(dropdown from MachinePrice), 出模件数, 出模套数, 目标数, 啤工(calc)
- Editable: 机型 (dropdown), 出模件数, 出模套数, 目标数
- Changing any → recalculates 啤工
- Stats: Sub Total / Mark Up / Amount / % to Body

- [ ] **Step 4: Implement Purchase Parts tab (bd-purchase.js)**

Hardware items table:
- Columns: ☐, 名称, 用量, 开模报价, 样板报价, 差额(calc), 含税/不含税
- Editable: all columns except 差额
- Add/delete rows
- Stats: Sub Total / Mark Up / Amount / % to Body

- [ ] **Step 5: Implement Decoration tab (bd-decoration.js)**

Painting detail form:
- Operation counts: 夹, 印, 抹油, 边, 散枪, 总次数(calc)
- Costs: 喷油人工 HKD, 油漆 HKD, 报价 HKD
- All editable
- Stats: Sub Total / Mark Up / Amount / % to Body

- [ ] **Step 6: Implement Others tab (bd-others.js)**

Mixed items:
- Assembly labor (装配人工): count, cost
- Packaging labor (包装人工): count, cost
- Accessories, tooling, mold costs
- Table format similar to purchase parts
- Stats: Sub Total / Mark Up / Amount / % to Body

- [ ] **Step 7: Test Breakdown tabs with imported data**

Import the 47712 file, switch to Body Cost Breakdown, verify each tab shows correct data. Edit a 料重 value, verify recalculation.

- [ ] **Step 8: Commit**

```bash
git add client/js/params.js client/js/tabs/bd-*.js
git commit -m "feat: params panel and Body Cost Breakdown tabs with editing"
```

---

## Task 7: Vendor Quotation Tabs

**Files:**
- Create: `client/js/tabs/vq-body-cost.js`
- Create: `client/js/tabs/vq-packaging.js`
- Create: `client/js/tabs/vq-purchase.js`
- Create: `client/js/tabs/vq-carton.js`
- Create: `client/js/tabs/vq-transport.js`
- Create: `client/js/tabs/vq-summary.js`

- [ ] **Step 1: Implement VQ A. Body Cost tab**

`vq-body-cost.js`:
- Read-only view showing VQ A区 structure:
  - Part No., Descriptions, MOQ, Usage/Toy, Unit Cost HK$, Amount HK$
  - Body + battery items
  - Total line
- Info banner: "数据由 Body Cost Breakdown 自动汇总生成"
- Breakdown source display: Raw Material / Molding Labour / Purchase Parts / Decoration / Others amounts

- [ ] **Step 2: Implement VQ B. Packaging tab**

`vq-packaging.js`:
- Table matching VQ B区 structure:
  - PM No., Part Descriptions, Specifications, MOQ, Usage/Toy, Unit Cost HK$, Amount HK$
- Items from PackagingItem table
- Packing Labour row
- Accessories row
- Mark Up row with percentage
- All editable, add/delete rows

- [ ] **Step 3: Implement VQ C. Purchase Parts tab**

`vq-purchase.js`:
- Table matching VQ C区:
  - Unit No., Unit Descriptions, Inter Purchase Vendor, Usage/pc, Unit Cost HK$, Handling %, Amount HK$
- Subset of hardware/electronic items designated as inter-purchase
- Editable, add/delete rows

- [ ] **Step 4: Implement VQ D. Master Carton tab**

`vq-carton.js`:
- Form/table matching VQ D区:
  - Part Desc (Polybag, Inner, Master Carton)
  - Dimension L×W×H (inch), Paper, Case Pack, Unit Cost HK$, Amount HK$
- Data from ProductDimension
- Editable fields

- [ ] **Step 5: Implement VQ E. Transport tab**

`vq-transport.js`:
- Port Location (dropdown: Jakarta ID/HK, Yantian CN/HK, etc. from List sheet)
- Cu.Ft./Toy display
- Cost table: Trans Cost Parameter, Ex-Factory/FOB FCL/FOB LCL
- Transport config editing (routes, costs, split ratio)
- Auto-calculates per-unit transport cost

- [ ] **Step 6: Implement VQ Cost Summary tab**

`vq-summary.js`:
- Read-only matrix:
  - Rows: MOQ levels (2.5K, 5K, 10K, 15K)
  - Columns: Trade Terms (Ex-Factory, FOB FCL, FOB LCL)
  - Each cell: HK$ amount + USD amount
- Trade Term header, Cost Type (Standard)
- Auto-calculated from all other sections

- [ ] **Step 7: Test VQ tabs end-to-end**

Import 47712, verify all VQ tabs render correctly. Edit packaging item, verify summary updates.

- [ ] **Step 8: Commit**

```bash
git add client/js/tabs/vq-*.js
git commit -m "feat: Vendor Quotation tabs (A-E + Summary) with editing"
```

---

## Task 8: Excel Export (Template-Driven)

**Files:**
- Create: `server/services/excel-exporter.js`
- Modify: `server/routes/export.js`

- [ ] **Step 1: Place TOMY template**

Copy the template file to `server/templates/`:
```bash
cp "D:/Projects/报价/47712 Vendor Quotation R01 RR&nbsp OCT-07-2025.xlsx" server/templates/vendor-quotation-template.xlsx
```

- [ ] **Step 2: Map template cell positions**

Read the template with ExcelJS to document exact cell positions for each field. Create a mapping object in `excel-exporter.js`:

```javascript
const VQ_MAP = {
  header: {
    vendor: 'C2', itemNo: 'C3', itemDesc: 'C4',
    preparedBy: 'H2', quoteDate: 'H3', quoteRev: 'H4'
  },
  sectionA: { startRow: 10, cols: { partNo: 'A', desc: 'B', moq: 'E', usage: 'F', unitCost: 'G', amount: 'H' } },
  sectionB: { startRow: 22, ... },
  sectionC: { startRow: 42, ... },
  sectionD: { startRow: 49, ... },
  sectionE: { startRow: 57, ... },
  summary: { startRow: 67, ... }
};
```

Note: Actual positions will be verified by reading the template during this step.

- [ ] **Step 3: Implement Vendor Quotation sheet export**

```javascript
async function exportVendorQuotation(versionId) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(templatePath);

  const vqSheet = workbook.getWorksheet('Vendor Quotation');
  const bdSheet = workbook.getWorksheet('Body Cost Breakdown');

  // Load all version data from DB
  const data = loadVersionData(versionId);
  const summary = recalculate(versionId);

  // Fill VQ header
  fillCell(vqSheet, VQ_MAP.header.vendor, data.product.vendor);
  // ... fill all header cells

  // Fill section A rows
  fillSectionA(vqSheet, summary.bodyItems);

  // Fill section B-E
  fillSectionB(vqSheet, data.packagingItems, summary);
  fillSectionC(vqSheet, data.interPurchaseItems);
  fillSectionD(vqSheet, data.productDimension);
  fillSectionE(vqSheet, data.transportConfig, summary);

  // Fill cost summary
  fillCostSummary(vqSheet, summary.summaryMatrix);

  return workbook;
}
```

- [ ] **Step 4: Implement Body Cost Breakdown sheet export**

```javascript
function fillBreakdownSheet(bdSheet, moldParts, summary) {
  // Fill summary table (rows 13-22)
  fillCell(bdSheet, 'D14', summary.rawMaterial.subTotal);
  fillCell(bdSheet, 'E14', summary.rawMaterial.markup);
  fillCell(bdSheet, 'F14', summary.rawMaterial.amount);
  // ... for each category

  // Fill detail part list (row 27+)
  moldParts.forEach((part, i) => {
    const row = 27 + i;
    fillCell(bdSheet, `A${row}`, part.part_no);
    fillCell(bdSheet, `B${row}`, part.description);
    // ... other fields
  });
}
```

- [ ] **Step 5: Implement export route**

`server/routes/export.js`:
```javascript
router.get('/:versionId', async (req, res) => {
  const workbook = await exportVendorQuotation(req.params.versionId);
  const product = getProduct(versionId);

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${product.item_no} Vendor Quotation.xlsx"`);

  await workbook.xlsx.write(res);
});
```

- [ ] **Step 6: Test export**

Import 47712 → export → open generated xlsx → compare with original template to verify formatting and data accuracy.

- [ ] **Step 7: Commit**

```bash
git add server/services/excel-exporter.js server/routes/export.js server/templates/
git commit -m "feat: template-driven Excel export for Vendor Quotation"
```

---

## Task 9: Integration & Polish

**Files:**
- Modify: `client/js/app.js`
- Modify: various tab files
- Create: `Dockerfile`
- Create: `docker-compose.yml`

- [ ] **Step 1: Wire import → sidebar refresh**

After successful import:
- Refresh sidebar product list
- Auto-select the newly created version
- Trigger full data load and tab rendering

- [ ] **Step 2: Wire editing → recalculation → summary update**

After any edit (params, section items):
- Save change via API
- Call calculate endpoint
- Update summary bar with new totals
- If editing Breakdown tab, also update VQ A tab data

- [ ] **Step 3: Wire export button**

Export button click → call api.exportExcel(currentVersionId) → trigger browser download.

- [ ] **Step 4: Add version comparison**

Simple side-by-side: select two versions → display key metrics diff (total cost, material, labor, profit). Color-code increases (red) and decreases (green). Implement as a modal.

- [ ] **Step 5: Create Dockerfile**

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY server/ server/
COPY client/ client/
EXPOSE 3000
CMD ["node", "server/server.js"]
```

- [ ] **Step 6: Create docker-compose.yml**

```yaml
version: '3.8'
services:
  quotation:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - ./server/data:/app/server/data
      - ./server/templates:/app/server/templates
```

- [ ] **Step 7: End-to-end test**

Full workflow: import 47712 → view all tabs → edit a material weight → verify recalculation → export Excel → verify output matches TOMY template format.

- [ ] **Step 8: Commit**

```bash
git add .
git commit -m "feat: integration, Docker deployment, and end-to-end workflow"
```
