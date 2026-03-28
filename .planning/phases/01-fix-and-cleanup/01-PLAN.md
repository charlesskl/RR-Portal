---
phase: 1
plan: 1
title: "提交已有改动并验证 Raw Material 提取和产品编号识别"
wave: 1
depends_on: []
requirements: [FIX-01, FIX-02, CLEAN-01]
files_modified:
  - server/routes/import.js
  - server/services/excel-parser.js
  - client/js/header-info.js
  - client/js/app.js
  - client/css/style.css
  - client/index.html
  - server/services/db.js
  - server/routes/versions.js
  - server/routes/products.js
  - server/services/excel-exporter.js
autonomous: true
---

# Plan 01: 提交已有改动并验证修复

## Objective

将当前 21 个未提交文件分组提交，确保 FIX-01（Raw Material 自动提取）、FIX-02（产品编号识别）的代码改动已正确包含，验证功能正常。

## Tasks

<task id="1">
<title>审查并提交 FIX-01 和 FIX-02 的修复代码</title>
<read_first>
- server/routes/import.js
- server/services/excel-parser.js
</read_first>
<action>
确认 import.js 中 RawMaterial 插入逻辑：
1. 从 moldParts 按 material 分组，累加 weight_g（不乘 sets_per_toy）
2. 价格从 moldPart.unit_price_hkd_g * 1000 得到 HK$/KG

确认 excel-parser.js 中：
1. detectLatestSheet fallback 优先选含"报价"的 sheet
2. parseWorkbook 中 product_no 兜底逻辑：B1 超过 30 字符或含"明细表"时从其他 sheet 补取

git add server/routes/import.js server/services/excel-parser.js
git commit -m "fix: Raw Material auto-extraction from MoldPart and product number detection"
</action>
<acceptance_criteria>
- server/routes/import.js 包含 `const weight = parseFloat(mp.weight_g) || 0;`（不含 sets_per_toy）
- server/routes/import.js 包含 `INSERT INTO RawMaterial`
- server/services/excel-parser.js 包含 `const quoteCandidates = sheets.filter(n => n.includes('报价'))`
- server/services/excel-parser.js 包含 `header.product_no.includes('明细表')`
- git log 显示 commit 包含这两个文件
</acceptance_criteria>
</task>

<task id="2">
<title>提交前端增强功能（header-info、tab 优化、样式）</title>
<read_first>
- client/js/header-info.js
- client/js/app.js
- client/css/style.css
- client/index.html
</read_first>
<action>
git add client/js/header-info.js client/js/app.js client/css/style.css client/index.html client/js/api.js
git add client/js/tabs/bd-decoration.js client/js/tabs/bd-material.js client/js/tabs/bd-molding.js
git add client/js/tabs/bd-others.js client/js/tabs/bd-purchase.js client/js/tabs/vq-body-cost.js
git add client/js/tabs/vq-carton.js client/js/tabs/vq-packaging.js client/js/tabs/vq-purchase.js
git add client/js/tabs/vq-summary.js client/js/tabs/vq-transport.js
git commit -m "feat: header info panel, tab refinements, and UI enhancements"
</action>
<acceptance_criteria>
- client/js/header-info.js 存在于 git tracked files
- git log 显示 commit 包含 client/ 下的文件
- git status 不再显示 client/ 下的 modified 文件
</acceptance_criteria>
</task>

<task id="3">
<title>提交后端增强功能（db migration、routes、exporter）</title>
<read_first>
- server/services/db.js
- server/routes/versions.js
- server/routes/products.js
- server/services/excel-exporter.js
</read_first>
<action>
git add server/services/db.js server/routes/versions.js server/routes/products.js server/services/excel-exporter.js
git commit -m "feat: db migrations for header fields, improved routes and export logic"
</action>
<acceptance_criteria>
- git log 显示 commit 包含 server/ 下的 4 个文件
- git status 不再显示 server/ 下的 modified 文件（除 import.js 和 excel-parser.js 已在 task 1 提交）
</acceptance_criteria>
</task>

<task id="4">
<title>验证导入功能：47712 注塑产品</title>
<read_first>
- server/routes/import.js
- server/services/excel-parser.js
</read_first>
<action>
运行验证脚本，确认：
1. 删除旧数据，重新导入 47712 报价明细
2. 检查 Product.item_no = '47712'
3. 检查 RawMaterial 有 4 行：ABS(1778g), PVC(430g), PC(70g), PP(145g)，均有价格
4. 检查 MoldPart 有 20 行

node -e "
const {getDb} = require('./server/services/db');
const {parseWorkbook} = require('./server/services/excel-parser');
// Verify parse output
(async () => {
  const data = await parseWorkbook('47712 本厂报价明细20260310 （电子加价改内部码点）.xlsx');
  console.log('product_no:', data.product.product_no);
  console.log('moldParts:', data.moldParts.length);
  // Verify raw material extraction logic
  const matMap = new Map();
  for (const mp of data.moldParts) {
    if (!mp.material) continue;
    const key = mp.material.trim();
    const existing = matMap.get(key);
    if (existing) { existing.weight += (mp.weight_g || 0); }
    else { matMap.set(key, { weight: mp.weight_g || 0, price: mp.unit_price_hkd_g }); }
  }
  for (const [name, {weight, price}] of matMap) {
    console.log(name, 'weight:', weight, 'price_per_kg:', price ? price*1000 : null);
  }
})();
"
</action>
<acceptance_criteria>
- product_no 输出 `47712`
- moldParts 输出 `20`
- ABS weight 输出 `1778`
- 所有 4 种材料均有 price_per_kg 值（非 null）
</acceptance_criteria>
</task>

<task id="5">
<title>验证导入功能：L21014 毛绒公仔产品编号识别</title>
<read_first>
- server/services/excel-parser.js
</read_first>
<action>
node -e "
const {parseWorkbook} = require('./server/services/excel-parser');
(async () => {
  const data = await parseWorkbook('L21014毛绒公仔报价2026.03.25.xlsx');
  console.log('product_no:', data.product.product_no);
  console.log('sheetName:', data.sheetName);
  console.log('moldParts:', data.moldParts.length);
})();
"
</action>
<acceptance_criteria>
- product_no 输出包含 `L21014`
- sheetName 输出包含 `报价`（不是 `车缝明细`）
</acceptance_criteria>
</task>

## Verification

- `git status` 显示 working tree clean（除 .planning/ 和 untracked db 文件外）
- `git log --oneline -5` 显示 3 个新 commit
- Task 4 和 Task 5 验证脚本均通过

## must_haves

- FIX-01: Raw Material 从 MoldPart 自动提取，weight 不乘 sets_per_toy
- FIX-02: 产品编号从主报价 sheet B1 提取
- CLEAN-01: 21 个未提交文件已 commit
