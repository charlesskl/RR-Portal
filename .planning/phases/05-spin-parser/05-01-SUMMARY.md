---
phase: 05-spin-parser
plan: "01"
subsystem: excel-parser
tags: [spin, format-detection, parsing, excel]
dependency_graph:
  requires: []
  provides: [SPIN-format-detection, SPIN-product_no-extraction, SPIN-mold-parsing, SPIN-sewing-parsing]
  affects: [server/services/excel-parser.js, import pipeline]
tech_stack:
  added: []
  patterns: [dynamic-header-detection, format-branching]
key_files:
  modified:
    - server/services/excel-parser.js
decisions:
  - SPIN 格式识别通过检测 '装配' sheet Row 2 是否含 'SPIN' 文字实现，优先于毛绒公仔检测
  - SPIN 产品编号从 总表 sheet Row8 Col2 提取，格式为 "货号：#29090" → 正则提取数字
  - parseSewingDetails 改为动态检测 header 行（扫描前5行找 物料名称/裁片部位），兼容 plush（row=4）和 spin（row=3）
metrics:
  duration_minutes: 5
  completed_date: "2026-04-16T03:29:14Z"
  tasks_completed: 2
  files_modified: 1
---

# Phase 05 Plan 01: SPIN 解析引擎 Summary

SPIN 格式识别和完整解析链路，通过 '装配' sheet 检测区分 spin/plush/injection 三种格式，从 总表 sheet 提取产品编号，动态 header 检测支持不同起始行的车缝明细解析。

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | 添加 SPIN 格式识别和产品编号提取 | a6369c6 | server/services/excel-parser.js |
| 2 | 启用 SPIN 的 MoldPart 和车缝明细解析 | acad2c0 | server/services/excel-parser.js |

## Changes Made

### Task 1: SPIN 格式识别和产品编号提取

**detectFormat:** 在 plush 检测之前新增 SPIN 检测逻辑 — 查找名为 '装配' 的 sheet，扫描 Row 2 全行判断是否含 'SPIN' 文字，匹配则返回 `'spin'`。

**parseHeader:** 函数签名增加 `workbook` 参数。spin 格式时额外从 总表 sheet Row8 Col2 提取货号（正则 `/\d+/` 提取数字部分）。

**parseWorkbook:** 调用 parseHeader 时传入 workbook 参数。

### Task 2: MoldPart 和车缝明细解析启用

**moldStartRow:** 从二元条件改为三元：`spin=12, plush=17, injection=18`。

**sewingDetails:** 条件从 `format === 'plush'` 扩展为 `format === 'plush' || format === 'spin'`。

**parseSewingDetails:** 硬编码 `row=4` 改为动态检测 — 扫描前5行，找到含 '物料名称'（col B）或 '裁片部位'（col C）的行，以其下一行作为数据起始行。plush 默认保持 row=4，spin 的 header 在 row=2 则 dataStartRow=3。

**laborItems 扫描:** 条件从 `format === 'plush'` 扩展为 `format === 'plush' || format === 'spin'`。

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None - 所有解析逻辑已完整实现，无占位符。实际数据正确性需通过真实 SPIN Excel 文件导入验证（见 plan 中的 verification 命令）。

## Self-Check: PASSED

- server/services/excel-parser.js: FOUND and modified
- Commit a6369c6: FOUND
- Commit acad2c0: FOUND
