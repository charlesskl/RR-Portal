# 新产品开发进度表系统 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a web-based product development schedule tracking system as a Standalone Node.js plugin for RR-Portal, replacing Excel-based manual tracking.

**Architecture:** Express server with JSON file storage, serving static HTML/JS/CSS pages. All CRUD via REST API. No auth required. Bootstrap 5 UI with inline editing.

**Tech Stack:** Node.js 20, Express 4, multer (image upload), uuid, xlsx (export), Bootstrap 5, vanilla JS

**Spec:** `docs/plans/2026-03-17-dev-progress-design.md`

---

## File Structure

```
plugins/新产品开发进度表/
├── Dockerfile
├── .dockerignore
├── .gitignore
├── package.json
├── server.js               # Express app, all API routes, data I/O, write queue
├── data/
│   └── data.json           # Persistent data (auto-created on first run)
├── uploads/                # Product images (bind mount)
├── public/
│   ├── index.html          # Main page — project list with inline edit
│   ├── stats.html          # Summary statistics page
│   ├── settings.html       # Config management page
│   ├── style.css           # Shared styles
│   ├── projects.js         # Main page logic
│   ├── stats.js            # Stats page logic
│   └── settings.js         # Settings page logic
├── .env.example
└── 更新新产品开发进度.bat
```

---

## Task 1: Project scaffolding + server foundation

**Files:**
- Create: `plugins/新产品开发进度表/package.json`
- Create: `plugins/新产品开发进度表/server.js`
- Create: `plugins/新产品开发进度表/.env.example`
- Create: `plugins/新产品开发进度表/.gitignore`
- Create: `plugins/新产品开发进度表/.dockerignore`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "dev-progress-system",
  "version": "1.0.0",
  "description": "新产品开发进度表系统",
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "multer": "^1.4.5-lts.1",
    "uuid": "^9.0.0",
    "xlsx": "^0.18.5"
  }
}
```

- [ ] **Step 2: Create .env.example**

```
PORT=3000
DATA_PATH=/app/data
APP_PREFIX=/dev-progress
```

- [ ] **Step 3: Create .gitignore**

```
node_modules/
data/data.json
data/data.json.bak
uploads/
.env
```

- [ ] **Step 4: Create .dockerignore**

```
node_modules/
data/
uploads/
.env
.git
```

- [ ] **Step 5: Create server.js — core framework**

Write the Express server with:
- Environment variable reading (`PORT`, `DATA_PATH`)
- `APP_PREFIX` is handled by nginx (strips `/dev-progress/` prefix before forwarding). Server routes do NOT include prefix. For local dev without nginx, access directly via `http://localhost:3000/`.
- Data file initialization (auto-create `data.json` with default workshops/customers/supervisors if missing)
- Write queue (Promise chain) to serialize all write operations
- `saveData()` function: backup to `.bak` before writing
- `loadData()` function: read and parse JSON
- Static file serving from `public/`
- Upload directory: `app.use('/uploads', express.static(path.join(DATA_PATH, '..', 'uploads')))` — so frontend can access images via `<img src="uploads/xxx.jpg">`
- Global error handler middleware: catch errors, return `{ error: "message" }` with appropriate status code
- `GET /health` endpoint returning `{ status: "ok" }`
- Listen on PORT

Default data structure on init:
```json
{
  "workshops": ["兴信A", "兴信B", "华登"],
  "customers": ["ZURU", "JAZWARES", "Moose", "TOMY", "Tigerhead", "Zanzoon(嘉苏)", "AZAD", "Brybelly +Entertoymen", "Lifelines", "ToyMonster", "Cepia", "Tikino", "Sky Castle", "Masterkidz", "John Adams", "智海鑫", "PWP(多美）", "CareFocus"],
  "supervisors": ["易东存", "段新辉", "蒙海欢", "唐海林", "万志勇", "章发东", "王玉国", "甘勇辉", "刘际维"],
  "projects": []
}
```

- [ ] **Step 6: Install dependencies**

Run: `cd plugins/新产品开发进度表 && npm install`

- [ ] **Step 7: Test server starts and health check works**

Run: `cd plugins/新产品开发进度表 && node -e "const app = require('./server'); setTimeout(() => process.exit(0), 1000)"`
Or start server and `curl http://localhost:3000/health`
Expected: `{"status":"ok"}`

- [ ] **Step 8: Commit**

```bash
git add plugins/新产品开发进度表/package.json plugins/新产品开发进度表/package-lock.json plugins/新产品开发进度表/server.js plugins/新产品开发进度表/.env.example plugins/新产品开发进度表/.gitignore plugins/新产品开发进度表/.dockerignore
git commit -m "feat(新产品开发进度表): scaffold project with Express server and data init"
```

---

## Task 2: Project CRUD API

**Files:**
- Modify: `plugins/新产品开发进度表/server.js`

- [ ] **Step 1: Add GET /api/projects**

Query params: `workshop`, `customer`, `supervisor`, `keyword` (searches product_name, engineer, remarks)
Returns filtered project array from data.projects.

- [ ] **Step 2: Add POST /api/projects**

Accepts JSON body with all project fields (except id, created_at, updated_at).
Generates UUID id, sets created_at/updated_at to now.
Validates required fields: workshop, product_name.
Pushes to data.projects, saves via write queue.
Returns created project.

- [ ] **Step 3: Add PUT /api/projects/:id**

Accepts partial JSON body, merges into existing project.
Updates `updated_at`.
Returns 404 if id not found.
Saves via write queue.

- [ ] **Step 4: Add DELETE /api/projects/:id**

Removes project by id. Returns 404 if not found. Saves via write queue.

- [ ] **Step 5: Add DELETE /api/projects/batch**

Accepts `{ ids: [...] }` body. Removes all matching projects. Saves via write queue.

- [ ] **Step 6: Test all CRUD endpoints manually**

Start server, use curl:
```bash
# Create
curl -X POST http://localhost:3000/api/projects -H "Content-Type: application/json" -d '{"workshop":"兴信A","supervisor":"段新辉","engineer":"关芬乐","customer":"ZURU","product_name":"测试产品","schedule":{}}'

# List
curl http://localhost:3000/api/projects

# Update (use id from create response)
curl -X PUT http://localhost:3000/api/projects/<id> -H "Content-Type: application/json" -d '{"remarks":"测试备注"}'

# Delete
curl -X DELETE http://localhost:3000/api/projects/<id>
```

- [ ] **Step 7: Commit**

```bash
git add plugins/新产品开发进度表/server.js
git commit -m "feat(新产品开发进度表): add project CRUD API endpoints"
```

---

## Task 3: Image upload API

**Files:**
- Modify: `plugins/新产品开发进度表/server.js`

- [ ] **Step 1: Configure multer**

At top of server.js, configure multer:
- Storage: disk, destination = `uploads/` directory (use `DATA_PATH/../uploads` or dedicated `UPLOAD_PATH`)
- Filename: `{project_id}_{timestamp}.{ext}`
- File filter: only allow `image/jpeg`, `image/png`, `image/webp`
- Size limit: 5MB

- [ ] **Step 2: Add POST /api/projects/:id/image**

- Validate project exists (404 if not)
- Accept single file upload via multer
- Delete old image file if project already has one
- Update project's `product_image` field to new path
- Save via write queue
- Return updated project

- [ ] **Step 3: Test image upload**

```bash
curl -X POST http://localhost:3000/api/projects/<id>/image -F "image=@test.jpg"
```
Expected: project returned with `product_image` set.

- [ ] **Step 4: Commit**

```bash
git add plugins/新产品开发进度表/server.js
git commit -m "feat(新产品开发进度表): add image upload endpoint with type/size validation"
```

---

## Task 4: Config API + Excel export API

**Files:**
- Modify: `plugins/新产品开发进度表/server.js`

- [ ] **Step 1: Add GET /api/config**

Returns `{ workshops, customers, supervisors }` from data.

- [ ] **Step 2: Add PUT /api/config**

Accepts `{ workshops?, customers?, supervisors? }`. Merges into data, saves via write queue. Validates arrays of strings.

- [ ] **Step 3: Add POST /api/import**

Accepts JSON array of project objects (parsed by frontend from Excel). For each:
- Generate UUID id
- Set created_at/updated_at
- Push to data.projects
Save via write queue. Return count of imported projects.

- [ ] **Step 4: Add GET /api/export**

Query params: `workshop`, `customer`, `supervisor` (same as GET /api/projects).
Build XLSX workbook using `xlsx` library:
- Column headers matching Excel original: 序号(自动生成行号), 厂区, 主管, 跟进工程师, 客户, 产品名称, 工模套数, 年龄等级, 预计总数量, 货价(USD), 退税码点, 开发时间, FS, EP, FEP, PP, 塑胶物料BOM, 采购物料BOM, PO1走货日期, PO1走货数量, 是否外发湖南, 备注
- Set response headers: `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `Content-Disposition: attachment; filename="新产品开发进度表.xlsx"`
- Send buffer

- [ ] **Step 5: Add GET /api/stats**

Calculate and return:
```json
{
  "byWorkshop": { "兴信A": { "total": 5, "stages": { "dev_start": 2, "fs": 1, ... } } },
  "byCustomer": { "ZURU": { "total": 10, "completed": 3, "inProgress": 5, "delayed": 2 } },
  "bySupervisor": { "段新辉": { "total": 4, "completed": 1 } },
  "overview": { "total": 20, "completed": 5, "inProgress": 10, "delayed": 3, "upcoming": [ ... ] }
}
```
Use the progress logic from spec section 5 to determine stage statuses.

- [ ] **Step 6: Test all endpoints**

```bash
curl http://localhost:3000/api/config
curl -X PUT http://localhost:3000/api/config -H "Content-Type: application/json" -d '{"workshops":["兴信A","兴信B","华登","新车间"]}'
curl http://localhost:3000/api/stats
curl "http://localhost:3000/api/export?workshop=兴信A" --output test.xlsx
```

- [ ] **Step 7: Commit**

```bash
git add plugins/新产品开发进度表/server.js
git commit -m "feat(新产品开发进度表): add config, import, export, and stats API endpoints"
```

---

## Task 5: Main page — project list with inline editing

**Files:**
- Create: `plugins/新产品开发进度表/public/index.html`
- Create: `plugins/新产品开发进度表/public/style.css`
- Create: `plugins/新产品开发进度表/public/projects.js`

- [ ] **Step 1: Create style.css**

Shared styles for all pages:
- Progress colors: `.stage-none` (gray #e9ecef), `.stage-active` (yellow #fff3cd), `.stage-done` (green #d1e7dd), `.stage-delayed` (red #f8d7da)
- Table styles: compact rows, sticky header, hover highlight
- Thumbnail: `.thumb-img` max 40px height
- Inline edit: `.editable` cursor pointer, `.editing` input/select styling
- Responsive: horizontal scroll for wide table on mobile
- Navbar consistent with other plugins

- [ ] **Step 2: Create index.html**

HTML structure:
- Navbar with links: 项目列表(active), 汇总统计, 设置
- Filter bar: 车间 dropdown, 客户 dropdown, 主管 dropdown, keyword search input, 搜索 button, 清除 button
- Action bar: 添加项目 button, Excel导入 button (with hidden file input), Excel导出 button, 批量删除 button
- Import preview modal (Bootstrap modal): shows parsed data table, confirm/cancel buttons
- Add/edit project modal: form with all fields
- Main table with columns: 序号, 厂区, 主管, 跟进工程师, 客户, 产品名称, 图片, 工模套数, 年龄等级, 预计数量, 货价, 退税码点, 开发时间, FS, EP, FEP, PP, 塑胶BOM, 采购BOM, PO1日期, PO1数量, 外发湖南, 备注, 操作
- Include Bootstrap 5 CSS/JS from vendor files (copy from existing plugins)
- Include xlsx.js via CDN or vendor
- Include `projects.js`

- [ ] **Step 3: Create projects.js — data loading and rendering**

Functions:
- `loadConfig()` — fetch `/api/config`, populate filter dropdowns
- `loadProjects()` — fetch `/api/projects` with current filters, render table
- `renderTable(projects)` — build table rows, apply progress colors to schedule cells
- `getStageStatus(project, stageKey)` — implement spec section 5 progress logic
- `extractLastDate(text)` — regex extract last date from EP/PP free text
- Auto-load on page ready

- [ ] **Step 4: Add inline editing to projects.js**

Functions:
- Click on editable cell → replace with `<input>` or `<select>`
- On blur or Enter → `PUT /api/projects/:id` with changed field
- On Escape → cancel edit
- Schedule fields: show as text, click to edit
- Dropdown fields (workshop, customer, supervisor, outsource_hunan): show `<select>` with options from config

- [ ] **Step 5: Add project CRUD UI to projects.js**

Functions:
- `showAddModal()` — open modal with empty form
- `submitProject(formData)` — POST `/api/projects`
- `deleteProject(id)` — confirm dialog → DELETE `/api/projects/:id`
- `toggleBatchSelect()` — checkbox per row, batch delete button
- Image upload: click thumbnail area → file input → POST `/api/projects/:id/image`
- After any mutation, reload project list

- [ ] **Step 6: Add Excel import to projects.js**

Functions:
- `handleImportFile(file)` — read file with FileReader, parse with XLSX.read()
- `parseExcelData(workbook)` — iterate sheets, map rows to project objects matching data model. Column mapping:
  - Col A (厂区) → workshop
  - Col C (跟进工程师) → engineer
  - Col E (客户) → customer
  - Col F (产品名称) → product_name
  - Col H (工模套数) → mold_sets
  - Col I (年龄等级) → age_grade
  - Col J (预计总数量) → estimated_qty
  - Col K (货价) → unit_price_usd
  - Col L (退税码点) → tax_rebate
  - Col M-T → schedule fields
  - Col V (是否外发湖南) → outsource_hunan
  - Col W (备注) → remarks
  - Sheet name → can be used to infer workshop or supervisor
- Skip header rows (row 0 = title, row 1 = headers) and footer rows (备注 row)
- `showImportPreview(projects)` — display in modal table
- `confirmImport(projects)` — POST `/api/import`

- [ ] **Step 7: Add Excel export to projects.js**

Function:
- `exportExcel()` — build URL with current filter params, `window.location.href = url`

- [ ] **Step 8: Test main page end-to-end**

Start server, open `http://localhost:3000/` in browser:
- Verify filters populate and work
- Add a project via modal
- Edit a field inline
- Upload an image
- Import the sample Excel file
- Export to Excel
- Delete a project

- [ ] **Step 9: Commit**

```bash
git add plugins/新产品开发进度表/public/index.html plugins/新产品开发进度表/public/style.css plugins/新产品开发进度表/public/projects.js
git commit -m "feat(新产品开发进度表): add main page with project list, inline edit, import/export"
```

---

## Task 6: Statistics page

**Files:**
- Create: `plugins/新产品开发进度表/public/stats.html`
- Create: `plugins/新产品开发进度表/public/stats.js`

- [ ] **Step 1: Create stats.html**

HTML structure:
- Same navbar as index.html (汇总统计 active)
- 4 sections with cards:
  1. 按车间汇总 — table showing each workshop's project count and stage distribution
  2. 按客户汇总 — table showing each customer's project count and status breakdown
  3. 按主管汇总 — table showing each supervisor's project count and completion rate
  4. 整体看板 — summary cards (total, completed, in progress, delayed) + delayed projects list with red highlight + upcoming (7 days) list with orange highlight
- Include Bootstrap 5, style.css, stats.js

- [ ] **Step 2: Create stats.js**

Functions:
- `loadStats()` — fetch `/api/stats`
- `renderWorkshopStats(data)` — build workshop summary table
- `renderCustomerStats(data)` — build customer summary table
- `renderSupervisorStats(data)` — build supervisor summary table
- `renderOverview(data)` — build overview cards + delayed/upcoming lists
- Auto-load on page ready

- [ ] **Step 3: Test statistics page**

Open `http://localhost:3000/stats.html`, verify all sections render with data.

- [ ] **Step 4: Commit**

```bash
git add plugins/新产品开发进度表/public/stats.html plugins/新产品开发进度表/public/stats.js
git commit -m "feat(新产品开发进度表): add statistics page with multi-dimension summaries"
```

---

## Task 7: Settings page

**Files:**
- Create: `plugins/新产品开发进度表/public/settings.html`
- Create: `plugins/新产品开发进度表/public/settings.js`

- [ ] **Step 1: Create settings.html**

HTML structure:
- Same navbar (设置 active)
- 3 sections, each a Bootstrap card:
  1. 车间管理 — list of workshops with delete button per item, input + add button
  2. 客户管理 — same pattern
  3. 主管管理 — same pattern

- [ ] **Step 2: Create settings.js**

Functions:
- `loadConfig()` — fetch `/api/config`
- `renderList(type, items, containerId)` — render editable list with delete buttons
- `addItem(type, value)` — add to local array, PUT `/api/config`
- `removeItem(type, index)` — confirm, remove from array, PUT `/api/config`
- Auto-load on page ready

- [ ] **Step 3: Test settings page**

Open `http://localhost:3000/settings.html`:
- Add a new workshop
- Delete a customer
- Verify changes persist after page refresh

- [ ] **Step 4: Commit**

```bash
git add plugins/新产品开发进度表/public/settings.html plugins/新产品开发进度表/public/settings.js
git commit -m "feat(新产品开发进度表): add settings page for workshop/customer/supervisor management"
```

---

## Task 8: Dockerfile + Docker Compose integration

**Files:**
- Create: `plugins/新产品开发进度表/Dockerfile`
- Create: `plugins/新产品开发进度表/更新新产品开发进度.bat`
- Modify: docker-compose file (local deployment)

- [ ] **Step 1: Create Dockerfile**

```dockerfile
FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache wget

COPY package.json package-lock.json ./
RUN npm ci --production

COPY server.js ./
COPY public/ ./public/

RUN mkdir -p data uploads

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1

CMD ["node", "server.js"]
```

- [ ] **Step 2: Create 更新新产品开发进度.bat**

```batch
@echo off
chcp 65001 >nul
echo 正在更新新产品开发进度表系统...
cd /d "%~dp0"
cd ..\..
docker compose build dev-progress
docker compose up -d dev-progress
docker compose restart nginx
echo 更新完成！
pause
```

- [ ] **Step 3: Create docker-compose file for local deployment**

Create `plugins/新产品开发进度表/docker-compose.prod.yml` (same pattern as `plugins/schedule-system/docker-compose.prod.yml`). Also add the service to the root `docker-compose.cloud.yml` if deploying to cloud, or keep it local-only for now.
```yaml
dev-progress:
  build:
    context: ./plugins/新产品开发进度表
    dockerfile: Dockerfile
  ports:
    - "3003:3000"
  volumes:
    - "./plugins/新产品开发进度表/data:/app/data"
    - "./plugins/新产品开发进度表/uploads:/app/uploads"
  environment:
    - PORT=3000
    - DATA_PATH=/app/data
    - APP_PREFIX=/dev-progress
  restart: unless-stopped
  healthcheck:
    test: ["CMD", "wget", "-qO-", "http://127.0.0.1:3000/health"]
    interval: 30s
    timeout: 5s
    start_period: 10s
    retries: 3
  networks:
    - platform-net
```

- [ ] **Step 4: Update nginx config**

Modify `nginx/nginx.conf` (or `nginx/nginx.cloud.conf` if cloud deployment). Add upstream and location block for dev-progress:
```nginx
upstream dev-progress {
    server dev-progress:3000;
}

location /dev-progress/ {
    proxy_pass http://dev-progress/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Script-Name /dev-progress;
    client_max_body_size 10M;
}
```

- [ ] **Step 5: Build and test in Docker**

```bash
docker compose up -d --build dev-progress
docker compose logs dev-progress
docker compose restart nginx
```
Open `http://localhost/dev-progress/` and verify all pages work.

- [ ] **Step 6: Commit**

```bash
git add plugins/新产品开发进度表/Dockerfile plugins/新产品开发进度表/更新新产品开发进度.bat
# Also add modified docker-compose and nginx config files
git commit -m "feat(新产品开发进度表): add Dockerfile, docker-compose, and nginx config"
```

---

## Task 9: Import sample data + final verification

**Files:**
- No new files

- [ ] **Step 1: Import the sample Excel file**

Use the system to import `C:\Users\Hufan\Desktop\清溪新产品开发进度表-段新辉2026-3-6（五)(1).xlsx`:
- Open main page
- Click Excel导入
- Select the file
- Verify preview shows correct data
- Confirm import

- [ ] **Step 2: Verify all features end-to-end**

Checklist:
- [ ] Project list renders with imported data
- [ ] Filters work (workshop, customer, supervisor)
- [ ] Inline editing works and persists
- [ ] Add new project works
- [ ] Delete project works
- [ ] Image upload works
- [ ] Excel export produces valid file
- [ ] Stats page shows correct summaries
- [ ] Settings page allows config changes
- [ ] Progress colors display correctly
- [ ] Data persists after server restart

- [ ] **Step 3: Update CLAUDE.md plugin registry**

Add entry to the plugin registry table:
```
| 新产品开发进度表 | 新产品开发进度表 | Engineering | Standalone (Node.js) | — |
```

- [ ] **Step 4: Final commit**

```bash
git add CLAUDE.md
git commit -m "docs: add 新产品开发进度表 to plugin registry"
```
