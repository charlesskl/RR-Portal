# Phase 5: SPIN 解析引擎 - Research

**Researched:** 2026-04-16
**Domain:** Excel 解析 / 格式检测 / Node.js ExcelJS
**Confidence:** HIGH（基于直接阅读现有代码）

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SPIN-01 | 识别 SPIN 报价格式（主 sheet 含"报价明细"关键字，与毛绒公仔格式区分） | 现有 detectFormat() 仅检查 sheet 名称含"车缝明细"或"搪胶"；SPIN 也含"车缝明细"，因此需额外检测"装配" sheet 的 R2 是否含"SPIN" |
| SPIN-02 | 解析 SPIN 主 sheet 的 MoldPart 区域（料型、料重、机型、件数） | 现有 parseMoldParts() 用动态行定位（扫描含"模号"/"名称"的行），可直接复用；需验证 SPIN 主 sheet 列布局是否与毛绒公仔一致 |
| SPIN-03 | 解析 SPIN 车缝明细 sheet（布料名称、用量、物料价等） | 现有 parseSewingDetails() 直接读取名为"车缝明细"的 sheet，列映射 B=fabric_name C=position D=cut_pieces E=usage_amount F=material_price G=price H=markup I=total；需验证 SPIN 车缝明细列顺序是否相同 |
| SPIN-04 | 将 SPIN 解析数据正确存入现有数据库表 | import.js 已完整处理 moldParts 和 sewingDetails 的入库；format_type 字段已存在于 QuoteVersion；只需确保 parseWorkbook() 对 SPIN 返回 format_type='spin' |
</phase_requirements>

---

## Summary

SPIN 解析引擎本质上是在现有双格式（injection / plush）检测基础上增加第三个分支。当前
`detectFormat()` 用一条规则区分 plush 和 injection：sheet 名含"车缝明细"或"搪胶"则为 plush，
否则为 injection。由于 SPIN 文件也含"车缝明细" sheet，它会被错误地识别为 plush 格式。

修复方法是优先检查 SPIN 标志（"装配" sheet 的 R2 含文本"SPIN"），在 plush 判断之前插入该分支。

MoldPart 解析和 SewingDetail 解析逻辑已在 plush 格式中正常工作；SPIN 格式很可能共用相同的
列布局（因为来自同一厂内系统），因此最小化改动可以复用这两个 parser，仅需添加格式检测分支。

**Primary recommendation:** 在 detectFormat() 中加 SPIN 前置检查，然后在 parseWorkbook() 中
以 format_type='spin' 触发与 plush 相同的 rotocastItems + sewingDetails 解析路径，最后修改
导入逻辑中 format_type fallback 从 'injection' 改为实际值。

---

## Standard Stack

### Core（已存在，无需安装）

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| ExcelJS | 已安装（见 package.json） | 读取 .xlsx 文件，支持 richText/formula cell | 项目已用，成熟 API |
| better-sqlite3 | 已安装 | SQLite 同步 API | 项目已用 |
| Express | 已安装 | HTTP 路由 | 项目已用 |

无需安装新依赖。

---

## Architecture Patterns

### 现有解析流程

```
server/routes/import.js
  └─ parseWorkbook(filePath)               ← server/services/excel-parser.js
       ├─ detectLatestSheet(workbook)       → 选主 sheet（优先含"报价明细"）
       ├─ detectFormat(workbook)            → 'injection' | 'plush'  ← 需加 'spin'
       ├─ parseHeader(ws, format)
       ├─ parseMoldParts(ws, startRow)
       ├─ (if plush) parseRotocastItems(ws)
       ├─ (if plush) parseSewingDetails(workbook)
       └─ ...其他 parsers...
```

### Pattern 1: 格式检测优先级（修改 detectFormat）

**What:** SPIN 在 plush 之前检查，避免被"车缝明细" sheet 误判为 plush。

**When to use:** 每次 parseWorkbook() 调用时。

```javascript
// server/services/excel-parser.js — detectFormat()
function detectFormat(workbook) {
  const sheetNames = workbook.worksheets.map(ws => ws.name);

  // SPIN 优先检测：装配 sheet 的 R2 含 "SPIN"
  const assemblySheet = workbook.getWorksheet('装配');
  if (assemblySheet) {
    const r2 = strVal(assemblySheet.getCell(2, 18)); // R 列 = 第 18 列
    if (r2 && r2.includes('SPIN')) return 'spin';
  }

  // Plush 检测（原逻辑）
  const hasPlushIndicator = sheetNames.some(n =>
    n.includes('车缝明细') || n.includes('搪胶')
  );
  return hasPlushIndicator ? 'plush' : 'injection';
}
```

> **注意：** "R2" 在 Excel 是第 2 行、R 列（第 18 列）。需用实际文件验证具体列号。

### Pattern 2: parseWorkbook 中激活 SPIN 分支

**What:** 'spin' 格式与 'plush' 共享 sewingDetails + rotocastItems 解析路径。

```javascript
// parseWorkbook() 中
const moldStartRow = (format === 'plush' || format === 'spin') ? 17 : 18;
const rotocastItems = (format === 'plush' || format === 'spin') ? parseRotocastItems(ws) : [];
const sewingDetails = (format === 'plush' || format === 'spin') ? parseSewingDetails(workbook) : [];
```

### Pattern 3: import.js 中的 format_type fallback 修正

当前代码：
```javascript
data.format_type || 'injection'
```
这在 SPIN 格式下若 format_type 为 'spin' 时可以正常工作（不会 fallback）。无需改动 import.js，
只要 excel-parser.js 的 detectFormat() 正确返回 'spin' 即可。

### Anti-Patterns to Avoid

- **不要** 根据主 sheet 名称区分 SPIN 和 injection（两者都含"报价明细"），必须用辅助 sheet 特征。
- **不要** 跳过 detectFormat 直接在 parseWorkbook 里硬编码 sheet 名检查——保持现有分层。
- **不要** 假设 SPIN 车缝明细列布局与 plush 完全相同而不验证——需用真实文件核对列号。

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| 读取 merged cell 的值 | 自写合并格子追踪 | ExcelJS cellVal() richText/formula 处理（已有） | ExcelJS 自动处理合并格子读取 |
| SPIN sheet 名检测 | 复杂正则 | 直接字符串 includes('装配') + 检查 R2 | SPIN 装配 sheet 名固定 |
| 数据库插入 | 新的 insert 路径 | 复用 import.js 现有 insertMold/insertSew 事务 | MoldPart 和 SewingDetail 表结构不需改变 |

---

## Common Pitfalls

### Pitfall 1: "装配" sheet R2 的确切列号未知
**What goes wrong:** 代码写死第 18 列（R 列），但实际文件 SPIN 文字可能在不同列。
**Why it happens:** 研究时没有真实 SPIN Excel 文件可验证。
**How to avoid:** 首次调试时打印 `装配` sheet 第 2 行全部非空格子值，确认 SPIN 所在列后再固定。
**Warning signs:** detectFormat() 返回 'plush' 而非 'spin'。

### Pitfall 2: SPIN 主 sheet 的 MoldPart 起始行可能不是 17
**What goes wrong:** parseMoldParts(ws, 17) 跳过了真实数据行。
**Why it happens:** SPIN 文件头部行数可能不同。
**How to avoid:** parseMoldParts 已有动态行定位（扫描含"模号"/"名称"的行），优先依赖这个逻辑
而不是硬编码行号。

### Pitfall 3: 车缝明细 sheet 列顺序不同
**What goes wrong:** parseSewingDetails() 硬编码列 B=fabric, C=position, D=cut_pieces 等，
若 SPIN 版本列顺序不同则数据错位。
**Why it happens:** 不同客户格式的车缝明细 sheet 可能有结构差异。
**How to avoid:** 检查 SPIN 文件的车缝明细 header 行（通常 row 3 或 row 4），根据 header 动态
确定列位置，而非假设固定列号。

### Pitfall 4: 格式类型 'spin' 导致 import.js 中 fallback 被触发
**What goes wrong:** `data.format_type || 'injection'` 在 format_type='spin' 时正常（'spin' 是
truthy）。但若检测失败返回 undefined，仍会 fallback 为 'injection'。
**Why it happens:** 格式检测逻辑 bug。
**How to avoid:** 在 detectFormat() 末尾加日志输出，导入时打印检测到的 format_type 便于调试。

### Pitfall 5: 没有真实 SPIN 文件导致开发只能猜测列布局
**What goes wrong:** 所有列号都基于"类似毛绒公仔"的假设，实际可能不符。
**Why it happens:** 研究阶段项目目录内无 SPIN Excel 样本文件。
**How to avoid:** Wave 0 的第一个任务应是将真实 SPIN 报价明细文件放入项目，并用 Node.js 脚本
打印出各 sheet 的行列结构，再据此编写 parser。

---

## Runtime State Inventory

> 本阶段为新增 parser，不涉及重命名/迁移。

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | 现有 QuoteVersion.format_type 列默认值为 'injection' | 历史已导入记录不受影响；新导入 SPIN 记录将写入 'spin' |
| Live service config | 无 | — |
| OS-registered state | 无 | — |
| Secrets/env vars | 无 | — |
| Build artifacts | 无 | — |

---

## Environment Availability

> 本阶段为纯代码修改，依赖现有 Node.js 环境。

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | 运行 server | ✓ | 项目已运行 | — |
| ExcelJS | Excel 解析 | ✓ | 已安装 | — |
| better-sqlite3 | 数据库 | ✓ | 已安装 | — |
| 真实 SPIN Excel 样本文件 | 验证列布局 / 调试 | ✗ | — | 无替代——必须由用户提供 |

**Missing dependencies with no fallback:**
- 真实 SPIN 报价明细 Excel 文件：没有此文件，无法验证格式检测和列映射的正确性。这是 Wave 0 的前提条件。

---

## Key Implementation Details

### 1. detectFormat() 修改点（excel-parser.js，约第 57 行）

当前逻辑：检查任意 sheet 名是否含"车缝明细"或"搪胶"。
需改为：先检查"装配" sheet 第 2 行是否含"SPIN"文本，若是则返回 'spin'，否则继续原逻辑。

关键问题待验证：SPIN 文字在"装配" sheet 第 2 行的确切列号。

### 2. detectLatestSheet() 无需修改

SPIN 主 sheet 含"报价明细"，已在 mingxiCandidates 分支被正确选中。

### 3. parseWorkbook() 修改点（第 800-805 行附近）

将 `format === 'plush'` 条件改为 `format === 'plush' || format === 'spin'`，使 SPIN 格式也
触发 rotocastItems 和 sewingDetails 的解析。

若 SPIN 文件没有搪胶件（rotocastItems），parseRotocastItems() 会找不到"模号/名称/出数"的
header 行而返回空数组，这是安全行为。

### 4. parseSewingDetails() — 可能需要 SPIN 专版

现有函数从 row=4 开始扫描，按固定列读取。若 SPIN 车缝明细 header 在不同行或列顺序不同，
需要：
- 选项 A：在函数内用 format 参数条件分支
- 选项 B：提取独立的 parseSpinSewingDetails() 函数

推荐选项 B，保持现有毛绒公仔 parser 不变，降低回归风险。

### 5. 数据库 — 无需迁移

QuoteVersion.format_type 列已存在，且 import.js 已有完整的 moldParts 和 sewingDetails 入库
路径。format_type='spin' 是新的字符串值，不破坏任何现有记录。

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | 无（项目无测试框架） |
| Config file | 无 |
| Quick run command | 手动：启动 server，上传 SPIN Excel，检查返回 JSON |
| Full suite command | 同上 |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SPIN-01 | 上传 SPIN 文件后 format_type='spin' | 手动/smoke | curl -F file=@spin.xlsx http://localhost:3000/api/import | ❌ 需要样本文件 |
| SPIN-02 | 导入后 MoldPart 行数据与 Excel 一致 | 手动核对 | 查询 SQLite MoldPart 表 | ❌ 需要样本文件 |
| SPIN-03 | 导入后 SewingDetail 行数据与 Excel 一致 | 手动核对 | 查询 SQLite SewingDetail 表 | ❌ 需要样本文件 |
| SPIN-04 | QuoteVersion.format_type = 'spin' | 手动核对 | 查询 SQLite QuoteVersion 表 | ❌ 需要样本文件 |

### Wave 0 Gaps

- [ ] 获取真实 SPIN 报价明细 Excel（阻塞所有验证）
- [ ] 可选：编写一个 Node.js 探针脚本 `scripts/probe-spin.js`，打印 SPIN 文件所有 sheet 的
      行列结构，用于确认列号假设

---

## Open Questions

1. **"装配" sheet 中 SPIN 文本的确切列号**
   - What we know: 根据 additional_context，"装配 sheet R2 contains SPIN client name"；R 行是第 2 行，但"R"在 Excel 也可能指 R 列（第 18 列）
   - What's unclear: 是"第 2 行的某列含 SPIN"还是"第 18 列第 2 行"？
   - Recommendation: Wave 0 用探针脚本打印"装配" sheet 第 2 行所有非空格，确认后硬编码。

2. **SPIN 车缝明细 sheet 列顺序是否与毛绒公仔完全一致**
   - What we know: 两者都有布料名称、用量、物料价，但 SPIN 是不同客户格式
   - What's unclear: 具体列是否相同（B=fabric, C=position, D=cut_pieces, E=usage, F=material_price_rmb, ...）
   - Recommendation: 探针脚本打印车缝明细 header 行，再决定复用还是新建 parser 函数。

3. **SPIN 是否有搪胶件（rotocastItems）区域**
   - What we know: SPIN 是毛绒公仔产品，通常不含注塑搪胶件
   - What's unclear: 主 sheet 是否存在搪胶区域
   - Recommendation: 调用 parseRotocastItems() 是安全的（找不到 header 则返回 []），无需特殊处理。

---

## Sources

### Primary (HIGH confidence)
- 直接阅读 `server/services/excel-parser.js`（全文，843 行）
- 直接阅读 `server/routes/import.js`（全文，347 行）
- 直接阅读 `server/services/db.js`（全文，392 行）

### Secondary (MEDIUM confidence)
- `.planning/PROJECT.md`、`REQUIREMENTS.md`、`ROADMAP.md`、`STATE.md` — 项目决策和需求
- `additional_context` 中提供的 SPIN 文件结构描述

### Tertiary (LOW confidence)
- SPIN 列布局假设（"类似毛绒公仔"）— 未经真实文件验证，标记需要 Wave 0 确认

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — 直接读代码确认
- Architecture: HIGH — 基于完整代码理解，修改点明确
- 列布局假设: LOW — 无真实 SPIN 文件，依赖 additional_context 描述

**Research date:** 2026-04-16
**Valid until:** 稳定（直到 SPIN 文件结构变更）
