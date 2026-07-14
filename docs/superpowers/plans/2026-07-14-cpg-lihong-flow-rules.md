# 利鸿出入库规则 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让利鸿页面与真实 PCBA 台账一致，并保证利鸿旧表导入导出可无损往返且不会重复。

**Architecture:** 保留内部 `issue`/`semi_finished` 类型以兼容历史数据，仅在利鸿部门映射为“领料/半成品出库”。为半成品明细增加三个结构化字段，导入、数据库和导出贯通；利鸿导出保持真实文件的三张工作表。

**Tech Stack:** Python 3.12、FastAPI、SQLite、openpyxl、原生 JavaScript、pytest

## Global Constraints

- 只修改 `apps/PMC跟仓管/加工管理`，鸿亚和其他部门行为保持不变。
- Excel 工作表名称和列顺序以用户提供的真实文件为准。
- 所有生产代码变更必须先有失败测试。

---

### Task 1: 固化利鸿页面和 API 语义

**Files:**
- Modify: `apps/PMC跟仓管/加工管理/tests/test_static_entry_subpages.py`
- Modify: `apps/PMC跟仓管/加工管理/tests/test_api_records.py`
- Modify: `apps/PMC跟仓管/加工管理/pcba/static/app.js`
- Modify: `apps/PMC跟仓管/加工管理/pcba/main.py`

**Interfaces:**
- Consumes: `entryTypeOptionsForDepartment()`、`typeLabel()`、`_validate_record()`
- Produces: 利鸿只允许 `issue` 和 `semi_finished`，后者显示为“半成品出库”

- [ ] **Step 1: 写页面和 API 失败测试**
- [ ] **Step 2: 运行定向测试并确认因旧语义失败**
- [ ] **Step 3: 最小修改前后端类型映射与校验**
- [ ] **Step 4: 运行定向测试并确认通过**

### Task 2: 固化并修复 Excel 闭环

**Files:**
- Modify: `apps/PMC跟仓管/加工管理/tests/test_import_export.py`
- Modify: `apps/PMC跟仓管/加工管理/tests/test_db.py`
- Modify: `apps/PMC跟仓管/加工管理/pcba/db.py`
- Modify: `apps/PMC跟仓管/加工管理/pcba/main.py`

**Interfaces:**
- Consumes: `_parse_legacy_outsource_workbook()`、`_outsource_pcba_export_workbook()`、`_record_duplicate_id()`
- Produces: `RecordIn.contract_no`、`RecordIn.item_no`、`RecordIn.product_name` 及对应 SQLite 字段

- [ ] **Step 1: 写结构化字段和导入导出闭环失败测试**
- [ ] **Step 2: 运行测试并确认字段丢失或重复导入失败**
- [ ] **Step 3: 添加幂等数据库迁移并贯通导入、去重、查询、导出**
- [ ] **Step 4: 限制利鸿导出为真实文件的三张表**
- [ ] **Step 5: 运行定向测试并确认通过**

### Task 3: 全量验证与交付

**Files:**
- Verify: `apps/PMC跟仓管/加工管理`

**Interfaces:**
- Consumes: Task 1 和 Task 2 的完整行为
- Produces: 可提交的利鸿规则修复分支

- [ ] **Step 1: 运行加工管理完整 pytest**
- [ ] **Step 2: 运行 `node --check pcba/static/app.js`**
- [ ] **Step 3: 运行 `git diff --check` 并审查精确变更**
- [ ] **Step 4: 只暂存目标文件并提交**
