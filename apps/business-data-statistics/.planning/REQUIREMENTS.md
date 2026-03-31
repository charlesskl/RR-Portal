# Requirements: 三工结余系统 — BUG修复与体验升级

**Defined:** 2026-03-17
**Core Value:** 录入员能高效、准确地录入每日生产数据，统计组能快速获取可靠的汇总报表交给管理层

## v1 Requirements

Requirements for this milestone. Each maps to roadmap phases.

### Bug Fixes — 路由与字段

- [ ] **BUG-01**: 批量删除路由 `/batch` 不被 `/:id` 拦截（路由顺序修正）
- [ ] **BUG-02**: 明细表车间列正确显示车间名称（prop 对齐 workshop_name）
- [ ] **BUG-03**: 车间管理 POST/PUT 正确接收并保存 company 字段
- [ ] **BUG-04**: 数据锁定前端字段名与后端一致（dept → department）
- [ ] **BUG-05**: 部门汇总 SQL 覆盖所有独有字段的 SUM
- [ ] **BUG-06**: init.sql workshops 表包含 company 列
- [ ] **BUG-07**: 锁定人列显示姓名而非数字 ID（prop 对齐 locked_by_name）

### Bug Fixes — 前端规范

- [ ] **BUG-08**: 数据锁定部门下拉使用 ALL_DEPARTMENTS 动态生成
- [ ] **BUG-09**: 用户管理部门下拉使用 ALL_DEPARTMENTS 动态生成
- [ ] **BUG-10**: 编辑框边框颜色使用 CSS 变量而非 inline 硬编码
- [ ] **BUG-11**: 修正 3 个河源车间 department 为 NULL 的数据

### Bug Fixes — 导入显示

- [ ] **BUG-12**: Excel 导入成功后数据在页面正确显示（刷新也能看到）

### 录入效率

- [x] **ENTRY-01**: 用户只填日期+车间即可生成新数据行，其余字段在行内编辑
- [x] **ENTRY-02**: 行内编辑时按 Tab 键自动跳到下一个可编辑字段（跳过计算列）
- [ ] **ENTRY-03**: 用户可一键复制已有行的可编辑字段数据为新行

### 数据准确性

- [ ] **VALID-01**: 系统对关键字段执行输入校验（人数为整数、产值非负等），不合规时显示错误提示
- [ ] **VALID-02**: 录入值偏离该车间历史均值超过阈值时，单元格标黄警告（允许提交）
- [ ] **VALID-03**: 每次修改记录时，审计日志保存字段级变更详情（字段名、旧值、新值）
- [ ] **VALID-04**: 用户可查看同一车间本月与上月数据的对比视图

### 导入导出

- [ ] **IMPEX-01**: 用户可下载带表头格式的空 Excel 模板（按部门生成）
- [ ] **IMPEX-02**: Excel 上传后先显示预览数据，用户确认后才正式导入
- [ ] **IMPEX-03**: 导入失败时，系统显示逐行错误报告（哪行哪列、具体原因）

### 系统管理

- [ ] **ADMIN-01**: 车间管理支持手动拖拽（或上下按钮）调整显示顺序
- [ ] **ADMIN-02**: 公式设置窗口：所有费用项可在前端界面配置计算规则
- [ ] **ADMIN-03**: 公式支持引用其他字段计算（如：某费用 = 人数 × 单价）
- [ ] **ADMIN-04**: 公式支持固定值和查表取值（如：每人30元）
- [ ] **ADMIN-05**: 公式配置后直接在系统运行，无需修改代码

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### 录入增强

- **ENTRY-V2-01**: 批量填充 — 选中多个单元格一次填入相同值
- **ENTRY-V2-02**: 常用数据模板 — 保存车间常用数据为模板

### 导出增强

- **IMPEX-V2-01**: 导出格式可选 — 支持多种导出模板供管理层选择

## Out of Scope

| Feature | Reason |
|---------|--------|
| Excel 式单元格拖拽填充 | CDN 单文件架构下实现过于复杂 |
| 实时同步 / 乐观锁 | 各录入员管各自车间，不需要 |
| 可视化公式拖拽构建器 | 文本表达式+字段引用已够用 |
| 每次按键自动保存 | 行失焦时保存更可靠 |
| 图表可视化 | 管理层看 Excel，不看系统仪表盘 |
| 移动端适配 | 内网桌面系统 |
| 三工结余以外的部门模块 | 未来单独规划 |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

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
| ENTRY-01 | Phase 2 | Complete |
| ENTRY-02 | Phase 2 | Complete |
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

**Coverage:**
- v1 requirements: 27 total
- Mapped to phases: 27
- Unmapped: 0

---
*Requirements defined: 2026-03-17*
*Last updated: 2026-03-17 after roadmap creation — all 27 requirements mapped*
