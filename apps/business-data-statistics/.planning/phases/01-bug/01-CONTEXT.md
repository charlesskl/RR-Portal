# Phase 1: BUG修复与基础稳定 - Context

**Gathered:** 2026-03-17
**Status:** Ready for planning

<domain>
## Phase Boundary

修复全部 12 个已知缺陷 + 2 个关联安全问题，建立稳定可靠的功能基线。所有现有功能按设计正常工作，不存在数据显示错误、操作静默失败或数据保存丢失的问题。

</domain>

<decisions>
## Implementation Decisions

### Excel 导入修复 (BUG-12)
- 已知现象：印喷部导入手动编辑的 Excel，提示成功但表格为空，刷新也看不到
- 根因需调查：重点排查 `import-export.js` 的 COLUMN_MAP 映射和 INSERT 语句
- 导入成功后交互：静默刷新表格（显示简短成功提示 + 自动重新加载数据列表）

### 关联安全修复（额外 2 项）
- 单条删除加数据锁定检查：在 `DELETE /:dept/records/:id` 路由添加 `checkDataLock` 中间件，与批量删除保持一致
- 启用 modulePermission 中间件：在 records 和 import-export 路由加上 `modulePermission('balance')`，确保录入员只能操作已授权模块

### 修复验证方式
- 用 Jest 写自动化测试，覆盖范围：BUG 回归测试 + 三个部门基础 CRUD
- 现有 print_records 的 18 条数据是测试数据，可删除，测试可自由操作数据库
- 按优先级分批运行测试：P0 修完跑一批、P1 修完跑一批、P2 修完跑一批
- 测试失败时 Claude 自动分析原因并修复，然后重新运行测试

### Claude's Discretion
- 12 个 BUG 的具体修复顺序（在同一优先级内）
- 测试用例的具体设计和断言方式
- BUG-12 根因调查的技术细节

</decisions>

<specifics>
## Specific Ideas

- 导入预览 + 逐行错误标注功能属于 Phase 4，但用户已有明确的设计偏好（见 Deferred Ideas）
- 用户希望每个 BUG 修复都有对应的回归测试，防止未来复发

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `asyncHandler` (utils/async-handler.js): 所有异步路由的错误处理包装器
- `checkDataLock` (middleware/auth.js): 数据锁定中间件，已在批量删除中使用，单删需补上
- `modulePermission` (middleware/auth.js): 模块权限中间件，已导入但未在路由中使用
- `DEPT_CONFIG` / `getAllInputFields` / `getExpenseFields` (modules/): 部门字段配置，BUG-05 修复需用到
- 现有 `tests/modules.test.js`: Jest 测试文件已存在，可扩展

### Established Patterns
- SQL 使用 `?` 占位符，`db/postgres.js` 自动转换为 `$N`
- 响应格式统一 `{ success: true/false, data/message }`
- 路由具体路径必须注册在通配 `/:id` 之前
- `parseFloat(value) || 0` 用于数值安全处理

### Integration Points
- `routes/records.js`: BUG-01 (路由顺序)、BUG-05 (汇总SQL)、单删锁定检查
- `routes/workshops.js`: BUG-03 (company字段)
- `routes/settings.js`: BUG-04 (锁定字段名)、BUG-07 (锁定人姓名)
- `routes/import-export.js`: BUG-12 (导入不显示)、modulePermission
- `public/js/app.js`: BUG-02, 04, 07, 08, 09, 10 (前端字段/样式修复)
- `db/init.sql`: BUG-06 (workshops表company列)
- 数据库: BUG-11 (河源车间department)

</code_context>

<deferred>
## Deferred Ideas

### Phase 4 — 导入预览设计偏好（用户已明确）
- 数据进库前先弹窗预览：显示成功几条、失败几条、一共几条
- 失败数据行显示在弹窗中
- 整行有问题的数据行：红色底色
- 部分错误的数据行：绿色底色
- 错误单元格：黄色底色

</deferred>

---

*Phase: 01-bug*
*Context gathered: 2026-03-17*
