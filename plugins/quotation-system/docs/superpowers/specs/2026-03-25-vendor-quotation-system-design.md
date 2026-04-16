# Vendor Quotation System - Design Spec

## Overview

A web-based quotation management system that imports internal cost breakdown data (本厂报价明细), provides editing capabilities, and exports TOMY-formatted Vendor Quotation Excel files with pixel-perfect template matching.

## Problem Statement

Currently, generating Vendor Quotation files for TOMY requires manually transferring data from internal cost spreadsheets (本厂报价明细) into the TOMY template. This is error-prone and time-consuming, especially when managing multiple products and versions.

## Goals

1. Import 本厂报价明细 Excel files and auto-detect the latest version sheet
2. Display data organized by **target output structure** — Vendor Quotation sections (A~E + Summary) and Body Cost Breakdown sections (Raw Material, Molding Labour, Purchase Parts, Decoration, Others)
3. Support parameter adjustments (exchange rates, markup, labor costs) with auto-recalculation
4. Support adding/deleting rows in all sections
5. Export Vendor Quotation Excel (2 sheets: Vendor Quotation + Body Cost Breakdown) that exactly matches TOMY's template format
6. Manage multiple products and multiple versions per product
7. Persist all data in SQLite for cross-session access

## Non-Goals

- User authentication / multi-user access
- Online deployment (local tool only)
- Modifying the TOMY template structure itself

## Architecture

### Tech Stack

- **Frontend**: Vanilla HTML + CSS + JS (consistent with existing project style)
- **Backend**: Node.js + Express
- **Excel Processing**: ExcelJS (read template, fill data, export)
- **Database**: SQLite (via better-sqlite3)
- **Deployment**: Docker + docker-compose

### Project Structure

```
D:/Projects/报价/
├── client/
│   ├── index.html          # Main SPA
│   ├── css/
│   │   └── style.css
│   └── js/
│       ├── app.js           # Main app logic, routing
│       ├── api.js           # API client
│       ├── params.js        # Parameter panel logic
│       ├── tabs/
│       │   ├── vq-body-cost.js      # VQ A区: Body Cost (auto from Breakdown)
│       │   ├── vq-packaging.js      # VQ B区: Packaging Materials & Labour
│       │   ├── vq-purchase.js       # VQ C区: Inter Purchase Parts
│       │   ├── vq-carton.js         # VQ D区: Master Carton
│       │   ├── vq-transport.js      # VQ E区: Transportation
│       │   ├── vq-summary.js        # VQ Cost Summary
│       │   ├── bd-material.js       # Breakdown: Raw Material Cost
│       │   ├── bd-molding.js        # Breakdown: Molding Labour Cost
│       │   ├── bd-purchase.js       # Breakdown: Purchase Parts Cost
│       │   ├── bd-decoration.js     # Breakdown: Decoration (喷油)
│       │   └── bd-others.js         # Breakdown: Others (装配/其他人工)
│       └── utils.js         # Shared utilities
├── server/
│   ├── server.js            # Express entry point
│   ├── routes/
│   │   ├── products.js      # Product CRUD
│   │   ├── versions.js      # Version CRUD
│   │   ├── import.js        # Excel import
│   │   └── export.js        # Excel export
│   ├── services/
│   │   ├── excel-parser.js  # Parse 本厂报价明细
│   │   ├── excel-exporter.js # Generate Vendor Quotation
│   │   ├── calculator.js    # Cost calculation engine
│   │   └── db.js            # SQLite operations
│   ├── templates/           # TOMY template xlsx files
│   └── data/                # SQLite database file
├── package.json
├── Dockerfile
└── docker-compose.yml
```

## Data Model

### Product (产品)

| Field | Type | Description |
|-------|------|-------------|
| id | INTEGER PK | Auto-increment |
| item_no | TEXT | Product number, e.g. "47712" |
| item_desc | TEXT | Product description, e.g. "Big Farm" |
| vendor | TEXT | Vendor name |
| created_at | DATETIME | |
| updated_at | DATETIME | |

### QuoteVersion (报价版本)

| Field | Type | Description |
|-------|------|-------------|
| id | INTEGER PK | Auto-increment |
| product_id | INTEGER FK | → Product |
| version_name | TEXT | e.g. "260310" |
| source_sheet | TEXT | Original sheet name from Excel |
| date_code | TEXT | e.g. "46260D-1" |
| quote_date | TEXT | |
| status | TEXT | "draft" or "final" |
| created_at | DATETIME | |
| updated_at | DATETIME | |

### QuoteParams (报价参数)

| Field | Type | Description |
|-------|------|-------------|
| id | INTEGER PK | |
| version_id | INTEGER FK | → QuoteVersion |
| hkd_rmb_quote | REAL | 报价 港币兑人民币 (0.87) |
| hkd_rmb_check | REAL | 核价 港币兑人民币 (0.87) |
| rmb_hkd | REAL | 人民币兑港币 (0.85) |
| hkd_usd | REAL | 港币兑美金 (0.1291) |
| markup_body | REAL | Body markup % (0.18) |
| markup_packaging | REAL | Packaging markup % (0.12) |
| labor_hkd | REAL | 人工HKD (240) |
| box_price_hkd | REAL | 箱价 (2.8) |
| tax_point | REAL | 税点 (1) |
| markup_point | REAL | 码点 (1.22325) |
| payment_divisor | REAL | 找数 (0.98) |
| surcharge_pct | REAL | 附加税 (0.004) |
| mold_subsidy | REAL | 模费补贴 (0) |

### MaterialPrice (料型单价表)

| Field | Type | Description |
|-------|------|-------------|
| id | INTEGER PK | |
| version_id | INTEGER FK | → QuoteVersion |
| material_type | TEXT | e.g. "ABS", "PP K8009", "PVC" |
| price_hkd_per_lb | REAL | HKD/磅 |
| price_hkd_per_g | REAL | HKD/g (calculated: price_per_lb / 454) |
| price_rmb_per_g | REAL | RMB/g |

### MachinePrice (啤机工价表)

| Field | Type | Description |
|-------|------|-------------|
| id | INTEGER PK | |
| version_id | INTEGER FK | → QuoteVersion |
| machine_type | TEXT | e.g. "4A-6A", "14A-16A" |
| price_hkd | REAL | |
| price_rmb | REAL | |

### MoldPart (模具零件 - Row 17~37)

| Field | Type | Description |
|-------|------|-------------|
| id | INTEGER PK | |
| version_id | INTEGER FK | → QuoteVersion |
| part_no | TEXT | 模号 (e.g. "47712-P01") |
| description | TEXT | 名称 |
| material | TEXT | 料型 (e.g. "ABS") |
| weight_g | REAL | 料重(G) |
| unit_price_hkd_g | REAL | 料价HKD/g (auto from MaterialPrice) |
| machine_type | TEXT | 机型 (e.g. "20A") |
| cavity_count | INTEGER | 出模件数 |
| sets_per_toy | REAL | 出模套数 |
| target_qty | INTEGER | 目标数 |
| molding_labor | REAL | 啤工 (calculated) |
| material_cost_hkd | REAL | 报价料金额HKD (calculated) |
| mold_cost_rmb | REAL | 模费RMB (null for 旧模) |
| remark | TEXT | 备注 ("旧模" etc.) |
| is_old_mold | BOOLEAN | Whether this is a reused mold |
| sort_order | INTEGER | |

**Calculation rules:**
- `unit_price_hkd_g` = lookup from MaterialPrice by material type
- `material_cost_hkd` = weight_g × unit_price_hkd_g
- `molding_labor` = machine_price_hkd / cavity_count / target_qty × sets_per_toy
  - Where machine_price_hkd is looked up from MachinePrice by machine_type

### HardwareItem (五金件 - Row 48~70)

| Field | Type | Description |
|-------|------|-------------|
| id | INTEGER PK | |
| version_id | INTEGER FK | → QuoteVersion |
| name | TEXT | 名称 (e.g. "小轮T钉4.0*44") |
| quantity | REAL | 用量(pcs) |
| old_price | REAL | 开模报价 2.5K (Col C) |
| new_price | REAL | 样板报价 2.5K (Col D) |
| difference | REAL | 差额 (Col E) |
| tax_type | TEXT | "含税" or "不含税" (Col I) |
| remark | TEXT | |
| sort_order | INTEGER | |

### ElectronicItem (电子 - from 电子 sheet)

| Field | Type | Description |
|-------|------|-------------|
| id | INTEGER PK | |
| version_id | INTEGER FK | → QuoteVersion |
| part_name | TEXT | 零件名称 |
| spec | TEXT | 规格 |
| quantity | REAL | 用量 |
| unit_price_usd | REAL | 单价USD |
| total_usd | REAL | 合计USD |
| remark | TEXT | |
| sort_order | INTEGER | |

### ElectronicSummary (电子汇总)

| Field | Type | Description |
|-------|------|-------------|
| id | INTEGER PK | |
| version_id | INTEGER FK | → QuoteVersion |
| parts_cost | REAL | 零件成本 |
| bonding_cost | REAL | 邦定成本 |
| smt_cost | REAL | 贴片成本 |
| labor_cost | REAL | 人工成本 |
| test_cost | REAL | 测试费用 |
| packaging_transport | REAL | 包装运输 |
| total_cost | REAL | 合计成本 |
| profit_margin | REAL | 利润率 (0.12) |
| final_price_usd | REAL | 含利润价 |
| pcb_mold_cost_usd | REAL | PCB模费 |

### PaintingDetail (喷油 - Row 46~47 + Row 129~132)

| Field | Type | Description |
|-------|------|-------------|
| id | INTEGER PK | |
| version_id | INTEGER FK | → QuoteVersion |
| labor_cost_hkd | REAL | 喷油人工 (8.584) |
| paint_cost_hkd | REAL | 油漆 (2.146) |
| clamp_count | INTEGER | 夹 (16) |
| print_count | INTEGER | 印 (39) |
| wipe_count | INTEGER | 抹油 (2) |
| edge_count | INTEGER | 边 (23) |
| spray_count | INTEGER | 散枪 |
| total_operations | INTEGER | 总次数 (80) |
| quoted_price_hkd | REAL | 报价HKD (10.73) |

### PackagingItem (包装 - Row 76~93)

| Field | Type | Description |
|-------|------|-------------|
| id | INTEGER PK | |
| version_id | INTEGER FK | → QuoteVersion |
| name | TEXT | 名称 (e.g. "Window Box", "FSC Insert card") |
| quantity | REAL | 用量 |
| old_price | REAL | 开模报价 (Col C) |
| new_price | REAL | 样板报价 (Col D) |
| difference | REAL | 差额 |
| tax_type | TEXT | "含税" or "不含税" |
| remark | TEXT | |
| sort_order | INTEGER | |

### TransportConfig (运费配置 - Row 141~155)

| Field | Type | Description |
|-------|------|-------------|
| id | INTEGER PK | |
| version_id | INTEGER FK | → QuoteVersion |
| cuft_per_box | REAL | 1箱的CUFT (3.213) |
| pcs_per_box | INTEGER | 1箱装的个数 (2) |
| truck_10t_cuft | INTEGER | 10吨车 CUFT (1166) |
| truck_5t_cuft | INTEGER | 5吨车 CUFT (750) |
| container_40_cuft | INTEGER | 40柜 CUFT (1980) |
| container_20_cuft | INTEGER | 20柜 CUFT (883) |
| hk_40_cost | REAL | HK 40"运费+吊柜费 (8000) |
| hk_20_cost | REAL | HK 20"运费+吊柜费 (7100) |
| yt_40_cost | REAL | YT(盐田) 40"运费+吊柜费 (7200) |
| yt_20_cost | REAL | YT 20"运费+吊柜费 (6000) |
| hk_10t_cost | REAL | HK10吨运费 (14900) |
| yt_10t_cost | REAL | YT10吨运费 (11500) |
| hk_5t_cost | REAL | HK5吨运费 (12500) |
| yt_5t_cost | REAL | YT5吨运费 (11000) |
| transport_pct | REAL | 运费占比 (0.48) |
| handling_pct | REAL | 吊柜费占比 (0.52) |

### MoldCost (模具费用 - Row 129~136)

| Field | Type | Description |
|-------|------|-------------|
| id | INTEGER PK | |
| version_id | INTEGER FK | → QuoteVersion |
| mold_cost_rmb | REAL | 模具费用 RMB |
| hardware_mold_cost_rmb | REAL | 五金模/夹具费用 RMB (10000) |
| paint_mold_cost_rmb | REAL | 喷油模具 RMB |
| total_mold_rmb | REAL | 模具总计 RMB |
| total_mold_usd | REAL | 模具总计 USD |
| customer_subsidy_usd | REAL | 客补贴模费美金 |
| amortization_qty | INTEGER | 分摊产品数量 (30000) |
| amortization_rmb | REAL | 模费分摊 RMB/pc |
| amortization_usd | REAL | 模费分摊 USD/pc |
| customer_quote_usd | REAL | 模价报客 TOTAL USD (45000) |

### ProductDimension (产品/纸箱尺寸 - Row 107~110)

| Field | Type | Description |
|-------|------|-------------|
| id | INTEGER PK | |
| version_id | INTEGER FK | → QuoteVersion |
| product_l_inch | REAL | 产品尺寸 L (20) |
| product_w_inch | REAL | 产品尺寸 W (10.5) |
| product_h_inch | REAL | 产品尺寸 H (11.5) |
| carton_l_inch | REAL | 纸箱尺寸 L (21.625) |
| carton_paper | TEXT | 纸箱纸质 (A=B) |
| carton_w_inch | REAL | 纸箱尺寸 W (20.75) |
| carton_h_inch | REAL | 纸箱尺寸 H (12.375) |
| carton_cuft | REAL | CU.FT (3.213) |
| carton_price | REAL | 箱价 (8.48) |
| pcs_per_carton | INTEGER | 数量 (2) |

## Data Flow

### Import Flow

```
Upload 本厂报价明细.xlsx
  → Server receives file
  → ExcelJS reads workbook
  → Auto-detect latest sheet by name pattern:
      - Match "报价明细-YYMMDD" format, pick highest date
      - Fallback: last sheet with "报价明细" prefix
  → Parse header area (R1~R16): product info, material prices, machine prices, exchange rates
  → Parse mold parts (R17~R37): until "合计:" row
  → Parse cost items (R40~R93): 人工, 五金, 电子, 包装, etc.
  → Parse summary (R94~R112): 包装合计, 运费, 码点, 找数, TOTAL
  → Parse mold costs (R129~R136)
  → Parse transport config (R141~R155)
  → Read 电子 sheet if present: electronic component details
  → Create Product (if new item_no) + QuoteVersion + all related records
  → Return version ID to frontend
```

### Calculation Engine

All calculations mirror the spreadsheet formulas:

```
Per MoldPart:
  material_cost = weight_g × unit_price_hkd_g
  molding_labor = machine_price / cavity_count / target_qty × sets_per_toy

Subtotals:
  进口料合计 = Σ material_cost (all parts)
  国内料合计 = Σ hardware items marked 国内
  啤工合计 = Σ molding_labor (all parts)
  装配人工 = labor_hkd × (assembly_count / assembly_divisor / target)
  包装人工 = labor_hkd × (packing_count / packing_divisor / target)

包装合计 = Σ all packaging + hardware + electronic + painting + labor items

Cost progression:
  出厂价 = 包装合计 + 附加税 + 模费补贴
  盐田40柜 = 出厂价 + 运费(48%) + 吊柜费(52%)  [for 40' container]
  盐田5吨车 = 出厂价 + 运费 + 吊柜费  [for 5-ton truck]

  码点后价 = cost × 码点(1.22325)
  找数后价 = 码点后价 ÷ 找数(0.98)
  TOTAL(HK$) = 找数后价
  TOTAL(USD) = TOTAL(HK$) × hkd_usd(0.1291)

  模费分摊(USD) = mold_total_usd / amortization_qty
  模价TOTAL(USD) = TOTAL(USD) + 模费分摊(USD)

Profit analysis:
  总成本 = 盐田40柜 price (before markup)
  毛利 = 码点后价 - 总成本
  毛利率 = 毛利 / 码点后价
  利润 = TOTAL(HK$) - 总成本
  利润率 = 利润 / TOTAL(HK$)
```

### Export Flow

```
User clicks "导出Excel"
  → Server loads TOMY template from templates/
  → Reads Vendor Quotation sheet:
      Fill header: Vendor, Item No., Item Desc., Quote Date, Quote Rev.
      A区: Body Cost = calculated from BodyCostBreakdown
      B区: Packaging items from PackagingItem
      C区: Inter-purchase parts from HardwareItem (if applicable)
      D区: Master Carton from ProductDimension
      E区: Transport from TransportConfig
      Cost Summary: calculated totals by MOQ × trade term
  → Reads Body Cost Breakdown sheet:
      Fill summary: Raw Material, Molding Labour, Purchase Parts, Decoration, Others
      Fill detail rows from MoldPart records
  → Preserve all original formatting (merged cells, fonts, borders, colors)
  → Stream xlsx file as download to browser
```

## Frontend Design

### Layout

Left sidebar (230px, dark theme) + Right content area:

**Sidebar:**
- System title
- Import / New buttons
- Search box
- Product list (expandable, shows versions underneath)
- Each version shows name + "最新" badge for latest

**Content Area (top to bottom):**
1. **Info bar**: Product info, status badge, Save/Export/Compare buttons
2. **Params panel** (collapsible): Exchange rates, markup %, labor cost, box price, tax point, markup point, payment divisor, surcharge %
3. **Two-level tab navigation**: Top level selects target sheet (Vendor Quotation / Body Cost Breakdown), second level selects section within that sheet
4. **Data table**: Editable table for current section with toolbar (add/delete rows, stats)
5. **Summary bar**: Real-time totals for 出厂价 / 盐田40柜 / 盐田5吨车 / TOTAL / 毛利率

### Tab Structure

The tabs are organized by **target output file structure**, not by source data category:

**Vendor Quotation Tabs:**

| Tab | VQ Section | Source from 报价明细 | Content |
|-----|-----------|---------------------|---------|
| A. Body Cost | Section A | Auto-calculated from Body Cost Breakdown | Body/Unit cost list, MOQ, Usage, Unit Cost HK$, Amount HK$. Read-only summary; detail editing is in Breakdown tabs |
| B. Packaging | Section B | R76~R93 (包装items) + R44~R45 (装配/包装人工) | PM No., Part Descriptions, Specifications, MOQ, Usage/Toy, Unit Cost HK$, Amount HK$, Packing Labour, Mark Up |
| C. Purchase Parts | Section C | R48~R70 (五金件) + R74~R75 (电子/PCBA) | Unit No., Descriptions, Inter Purchase Vendor, Usage, Unit Cost HK$, Handling %, Amount HK$ |
| D. Master Carton | Section D | R107~R112 (尺寸/箱价) + R89 (纸箱) | Dimension L×W×H, Paper, Case Pack, Unit Cost HK$, Amount HK$ |
| E. Transportation | Section E | R141~R155 (运费配置) | Port Location, Cu.Ft./Toy, Trans Cost Parameter, Ex-Factory/FOB FCL/FOB LCL costs |
| Cost Summary | Summary | Auto-calculated | MOQ(2.5K/5K/10K/15K) × Trade Term(Ex-Factory/FOB FCL/FOB LCL) matrix, HK$ and USD |

**Body Cost Breakdown Tabs:**

| Tab | Breakdown Section | Source from 报价明细 | Content |
|-----|------------------|---------------------|---------|
| Raw Material | Category A | R17~R37 (模具零件料价部分) | Part list with 料型, 料重, 料价HKD/g, material_cost. Sub Total + Mark Up = Amount HK$ |
| Molding Labour | Category B | R17~R37 (模具零件啤工部分) | Part list with 机型, 出模件数, 出模套数, 目标数, molding_labor. Sub Total + Mark Up = Amount HK$ |
| Purchase Parts | Category C | R48~R73 (五金/电镀/贴纸等外购件) | External purchase items with quantities and costs. Sub Total + Mark Up = Amount HK$ |
| Decoration | Category E1 | R46~R47 (喷油人工/油漆) + R129~R132 (喷油明细) | 夹/印/抹油/边/散枪 counts, labor HKD, paint HKD. Sub Total + Mark Up = Amount HK$ |
| Others | Category E4 | R44 (装配人工) + R90~R93 (辅料/夹具/围膜等) + R129~R136 (模具费用) | Assembly labor, accessories, tooling, mold costs. Sub Total + Mark Up = Amount HK$ |

**Key relationships:**
- Body Cost Breakdown tabs feed into VQ A. Body Cost (auto-summed)
- Each Breakdown section shows: Sub Total → Mark Up % → Amount HK$ → % to Body Cost
- VQ Cost Summary auto-calculates from all VQ sections (A+B+C+D+E)
  | + 模费分摊 | | | |
  | 模价TOTAL USD | | | |
- Profit analysis: ABS料价占比, 人工比例, 毛利/毛利率, 利润/利润率
- 减税分析: 各税点类别减税后的成本

### Interaction

- Double-click cell to edit (same as existing 出货明细系统)
- Enter to save, Escape to cancel, blur to auto-save
- Dropdown for 料型 (from material price table) and 机型 (from machine price table)
- Changing parameters triggers cascade recalculation across all tabs
- Bottom summary bar updates in real-time

## API Design

### Products
- `GET /api/products` — List all products
- `POST /api/products` — Create product
- `GET /api/products/:id` — Get product with versions
- `DELETE /api/products/:id` — Delete product and all versions

### Versions
- `GET /api/versions/:id` — Get full version data (params + all tabs)
- `PUT /api/versions/:id` — Update version (params, status)
- `DELETE /api/versions/:id` — Delete version
- `POST /api/versions/:id/duplicate` — Duplicate version

### Import/Export
- `POST /api/import` — Upload 本厂报价明细 Excel, returns new version
- `GET /api/export/:versionId` — Download Vendor Quotation Excel
- `POST /api/templates` — Upload TOMY template file

### Section Data (CRUD for each section)
- `GET /api/versions/:id/sections/:section` — List items for a section
- `POST /api/versions/:id/sections/:section` — Add item to section
- `PUT /api/sections/:section/:itemId` — Update item
- `DELETE /api/sections/:section/:itemId` — Delete item
- Section names: `mold-parts`, `hardware`, `electronics`, `painting`, `packaging`, `transport`, `mold-cost`, `dimensions`

### Calculation
- `GET /api/versions/:id/calculate` — Trigger full recalculation, return summary

## Template Mapping

The TOMY Vendor Quotation template has fixed cell positions. The export service maintains a mapping config:

### Vendor Quotation Sheet
| Cell | Content |
|------|---------|
| C2 | Vendor name |
| C3 | Item No. |
| C4 | Item Desc. |
| H2 | Prepared By |
| H3 | Quote Date |
| H4 | Quote Rev. |
| A10:H11+ | A区 Body/Unit rows |
| A22:H35 | B区 Packaging rows |
| A42:H43 | C区 Inter-purchase rows |
| A49:H51 | D区 Master Carton |
| A57:H58 | E区 Transport |
| A67:H74 | Cost Summary table |

### Body Cost Breakdown Sheet
| Cell | Content |
|------|---------|
| B7 | Body Descriptions |
| D14:F14 | Raw Material Cost (sub_total, markup, amount) |
| D15:F15 | Molding Labour Cost |
| D16:F16 | Purchase Parts Cost |
| D18:F18 | Decoration |
| D21:F21 | Others |
| F22 | TOTAL BODY COST |
| Row 27+ | Detail part list |

Note: Exact cell positions will be verified during implementation by reading the template file.

## Version Comparison

When comparing two versions:
- Side-by-side display of both versions
- Highlight cells where values differ
- Show delta (increase/decrease) with color coding (green = decrease, red = increase)
- Focus on key metrics: total cost, material cost, labor cost, profit margin

## Testing Strategy

- Unit tests for calculation engine (verify formulas match spreadsheet)
- Integration tests for import (parse known Excel → verify database records)
- Integration tests for export (generate Excel → verify cell values match)
- Manual testing with actual 47712 data files

## Migration / Data Files

- TOMY template stored in `server/templates/47712 Vendor Quotation R01 RR.xlsx`
- Sample data file: `47712 本厂报价明细20260310.xlsx` (for testing)
- SQLite database: `server/data/quotation.db`
