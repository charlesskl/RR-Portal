# Roadmap: 三工结余系统 — BUG修复与体验升级

**Project:** 三工结余系统 — BUG修复与体验升级
**Created:** 2026-03-17
**Milestone:** v1 — BUG修复与体验升级
**Granularity:** Standard

---

## Phases

- [ ] **Phase 1: BUG修复与基础稳定** - 修复全部12个已知缺陷，重构saveCell为乐观更新，建立稳定可靠的功能基线
- [ ] **Phase 2: 录入体验升级** - 实现快捷新增行、Tab键行内跳转、一键复制行三项高频效率功能
- [ ] **Phase 3: 数据准确性** - 实现字段级校验、异常高亮、字段级审计日志和月度对比视图
- [ ] **Phase 4: 导入导出增强** - 实现模板下载、导入预览和逐行错误报告
- [ ] **Phase 5: 系统管理增强与公式引擎** - 实现车间排序和用户可配置的公式计算引擎

---

## Phase Details

### Phase 1: BUG修复与基础稳定
**Goal**: 现有所有功能按设计正常工作，不存在数据显示错误、操作静默失败或数据保存丢失的问题
**Depends on**: Nothing (first phase)
**Requirements**: BUG-01, BUG-02, BUG-03, BUG-04, BUG-05, BUG-06, BUG-07, BUG-08, BUG-09, BUG-10, BUG-11, BUG-12
**Success Criteria** (what must be TRUE):
  1. 用户可以批量删除多行数据，操作不被系统错误拦截
  2. 明细表"车间"列正确显示车间名称（如"兴信A"），不再显示空白
  3. 统计组可以对指定月份执行锁定操作，锁定人列显示姓名而非数字ID
  4. Excel 导入后，数据立即在页面显示，刷新后仍然存在
  5. 车间管理中新建/编辑车间时，公司字段被正确保存
**Plans:** 4 plans

Plans:
- [ ] 01-00-PLAN.md — Wave 0: 创建 BUG 回归测试骨架（RED 状态失败断言）
- [ ] 01-01-PLAN.md — P0后端修复：路由顺序、workshops company字段、汇总SQL、安全中间件
- [ ] 01-02-PLAN.md — 前端修复：prop对齐、字段名修正、动态下拉、CSS变量
- [ ] 01-03-PLAN.md — BUG-11/12调查修复 + 回归测试补充 + 用户验证

### Phase 2: 录入体验升级
**Goal**: 录入员可以用键盘驱动的高效流程完成每日数据录入，单行数据的录入击键次数减少约60%
**Depends on**: Phase 1
**Requirements**: ENTRY-01, ENTRY-02, ENTRY-03
**Success Criteria** (what must be TRUE):
  1. 用户只填写日期和车间即可创建新数据行，其余字段在行内直接编辑
  2. 行内编辑时按 Tab 键自动跳到下一个可编辑字段，跳过产值/结余等计算列
  3. 用户可一键复制已有行的可编辑字段数据生成新行，原行数据不受影响
**Plans:** 1/2 plans executed

Plans:
- [ ] 02-01-PLAN.md — 测试骨架 + ENTRY-01 验证修复 + ENTRY-02 Tab 键行内跳转
- [ ] 02-02-PLAN.md — ENTRY-03 一键复制行 + 用户验证全部三项功能

### Phase 3: 数据准确性
**Goal**: 录入员在提交数据时能即时发现格式错误和异常值，统计组可以追溯每次字段级修改并对比月度数据
**Depends on**: Phase 2
**Requirements**: VALID-01, VALID-02, VALID-03, VALID-04
**Success Criteria** (what must be TRUE):
  1. 人数填入小数或产值填入负数时，单元格即时显示红色错误提示，无法保存
  2. 录入值偏离该车间历史均值超过阈值时，单元格标黄警告，但仍可保存提交
  3. 修改任意字段后，审计日志中可查看该次修改的字段名、修改前值和修改后值
  4. 用户可在明细表中切换查看某车间本月与上月数据的并排对比
**Plans**: TBD

### Phase 4: 导入导出增强
**Goal**: 录入员可以下载正确格式的模板进行填写，上传前可预览数据确认无误，导入失败时能精确定位错误行列
**Depends on**: Phase 3
**Requirements**: IMPEX-01, IMPEX-02, IMPEX-03
**Success Criteria** (what must be TRUE):
  1. 用户可按部门下载含正确表头的空白 Excel 模板用于离线填写
  2. 上传 Excel 后系统显示预览表格，用户点击"确认导入"后数据才正式写入数据库
  3. 导入含错误的文件时，系统列出每个错误的行号、列名和具体原因（如"第3行 人数列：必须为整数"）
**Plans**: TBD

### Phase 5: 系统管理增强与公式引擎
**Goal**: 管理员可以自由调整车间显示顺序，统计组可以通过界面配置各部门的费用计算规则而无需修改代码
**Depends on**: Phase 4
**Requirements**: ADMIN-01, ADMIN-02, ADMIN-03, ADMIN-04, ADMIN-05
**Success Criteria** (what must be TRUE):
  1. 管理员可通过拖拽或上下按钮调整车间列表的显示顺序，刷新后顺序保持不变
  2. 统计组可在公式设置窗口看到所有费用项，并为每项配置计算规则表达式
  3. 公式中可引用其他字段（如"人数 × 单价"）或填入固定值，保存后系统立即使用新公式计算
  4. 新录入或修改一条记录后，计算结果与公式设置窗口中配置的规则完全一致
**Plans**: TBD

---

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. BUG修复与基础稳定 | 0/4 | Planning complete | - |
| 2. 录入体验升级 | 1/2 | In Progress|  |
| 3. 数据准确性 | 0/? | Not started | - |
| 4. 导入导出增强 | 0/? | Not started | - |
| 5. 系统管理增强与公式引擎 | 0/? | Not started | - |

---

## Coverage

| Requirement | Phase | Status |
|-------------|-------|--------|
| BUG-01 | Phase 1 | Pending |
| BUG-02 | Phase 1 | Pending |
| BUG-03 | Phase 1 | Pending |
| BUG-04 | Phase 1 | Pending |
| BUG-05 | Phase 1 | Pending |
| BUG-06 | Phase 1 | Pending |
| BUG-07 | Phase 1 | Pending |
| BUG-08 | Phase 1 | Pending |
| BUG-09 | Phase 1 | Pending |
| BUG-10 | Phase 1 | Pending |
| BUG-11 | Phase 1 | Pending |
| BUG-12 | Phase 1 | Pending |
| ENTRY-01 | Phase 2 | Pending |
| ENTRY-02 | Phase 2 | Pending |
| ENTRY-03 | Phase 2 | Pending |
| VALID-01 | Phase 3 | Pending |
| VALID-02 | Phase 3 | Pending |
| VALID-03 | Phase 3 | Pending |
| VALID-04 | Phase 3 | Pending |
| IMPEX-01 | Phase 4 | Pending |
| IMPEX-02 | Phase 4 | Pending |
| IMPEX-03 | Phase 4 | Pending |
| ADMIN-01 | Phase 5 | Pending |
| ADMIN-02 | Phase 5 | Pending |
| ADMIN-03 | Phase 5 | Pending |
| ADMIN-04 | Phase 5 | Pending |
| ADMIN-05 | Phase 5 | Pending |

**Coverage: 27/27 requirements mapped**

---

*Created: 2026-03-17*
*Last updated: 2026-03-19 after Phase 2 planning — 2 plans in 2 waves*
