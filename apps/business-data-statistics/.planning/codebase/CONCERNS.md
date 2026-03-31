# Codebase Concerns

**Analysis Date:** 2026-03-17

---

## Known Bugs (P0 — 不修不能用)

**BUG #1: 批量删除路由被 /:id 拦截 (P0)**
- Symptoms: `DELETE /api/:dept/records/batch` 报 PostgreSQL 错误 `无效的类型 integer 输入语法: "batch"`
- Files: `routes/records.js` 第 95-122 行
- Trigger: 任何批量删除操作
- Root cause: `DELETE /:dept/records/:id`（第 95 行）注册在 `DELETE /:dept/records/batch`（第 107 行）之前，Express 将字符串 "batch" 当作 `/:id` 的值
- Fix: 将 batch 路由移到 `/:id` 路由之前

**BUG #2: 数据表格车间列永远空白 (P0)**
- Symptoms: 数据表中"车间"列显示为空白
- Files: `public/js/app.js` 第 322 行
- Trigger: 加载任何部门的数据记录
- Root cause: 前端绑定 `prop="workshop"`，但后端 SQL 返回字段名为 `workshop_name`（`SELECT w.name as workshop_name`，位于 `routes/records.js` 第 25 行）
- Fix: 将 `prop="workshop"` 改为 `prop="workshop_name"`

**BUG #3: 车间管理 company 字段保存后丢失 (P0)**
- Symptoms: 新增/编辑车间时填写公司信息，保存后丢失
- Files: `routes/workshops.js` 第 19 行（POST）、第 27 行（PUT）
- Trigger: 保存任何车间记录
- Root cause: POST 解构 `const { name, region, department, sort_order } = req.body` 遗漏 `company`；PUT 同样遗漏
- Fix: 两处均补充 `company` 字段解构和 SQL 插入/更新

---

## Known Bugs (P1 — 功能缺陷)

**BUG #4: 数据锁定字段名不匹配 — 锁定可能失效 (P1)**
- Symptoms: 锁定操作执行后，`department` 列存入 NULL，锁定判断可能不生效
- Files: `public/js/app.js` 第 1375 行（`lockForm: { lock_month: '', dept: '' }`）；`routes/settings.js` 第 57 行（`const { department, lock_month } = req.body`）
- Trigger: 执行数据锁定操作
- Root cause: 前端发送字段名 `dept`，后端期望字段名 `department`，导致 `department` 解构为 `undefined` 存入 NULL
- Fix: 前端改为 `lockForm: { lock_month: '', department: '' }`，模板中 `v-model="lockForm.department"`

**BUG #5: 部门级汇总 SQL 只 SUM 共享字段，缺独有字段 (P1)**
- Symptoms: 数据表底部合计栏中，所有独有字段列的汇总数值为空
- Files: `routes/records.js` 第 124-160 行（`GET /:dept/summary`）
- Trigger: 查看任何部门的数据汇总
- Root cause: SQL 硬编码 SUM 了 15 个共享字段，未动态加入各部门的独有字段（如啤机 `machine_repair`, `mold_repair`；印喷 `repair_fee`, `auto_mold_fee`；装配 `actual_wage`, `workshop_repair` 等）
- Fix: 仿照 `routes/summary.js` 的 `getExpenseFields` 动态生成 SUM 表达式

**BUG #6: init.sql 的 workshops 表缺 company 列 (P1)**
- Symptoms: 用 init.sql 重建新数据库后，company 列丢失
- Files: `db/init.sql` 第 24-32 行
- Root cause: 生产库通过 ALTER TABLE 添加了 company 列，但未同步回 init.sql
- Fix: 在 workshops 建表语句中添加 `company VARCHAR(100)` 列

**BUG #7: 数据锁定表"锁定人"列显示数字 ID (P1)**
- Symptoms: 锁定人列显示 `1` 而非 `系统管理员`
- Files: `public/js/app.js` 第 1338 行（`prop="locked_by"`）；`routes/settings.js` 第 47 行（已返回 `locked_by_name`）
- Root cause: 前端绑定了 `locked_by`（数字 ID），后端实际返回了 `locked_by_name` 字段但未被使用
- Fix: 将 `prop="locked_by"` 改为 `prop="locked_by_name"`

---

## Known Bugs (P2 — 规范问题)

**BUG #8: 数据锁定部门下拉硬编码 (P2)**
- Files: `public/js/app.js` 第 1355-1359 行
- Issue: 3 个 `<el-option>` 硬编码，但 `data()` 中已引入 `ALL_DEPARTMENTS`（第 1376 行）未被模板使用
- Fix: 改为 `v-for="(label, key) in ALL_DEPARTMENTS" :key="key" :label="label" :value="key"` 动态渲染

**BUG #9: 用户管理部门下拉硬编码 (P2)**
- Files: `public/js/app.js` 第 963-967 行（新增对话框）、第 992-996 行（编辑对话框）
- Issue: 两处分别硬编码 3 个 `<el-option>`
- Fix: 同 BUG #8，改为从 `ALL_DEPARTMENTS` 动态生成

**BUG #10: 行内样式硬编码颜色值 (P2)**
- Files: `public/js/app.js` 第 340 行
- Issue: `style="... border:2px solid #7F41C0 ..."` 硬编码主色值，违反 CSS 规范
- Fix: 提取为 `theme.css` 中的 CSS 类，使用 `var(--primary)` 变量

**BUG #11: 3 条车间记录 department 为 NULL (P2)**
- Files: 数据库 `workshops` 表（id=17 华登、id=18 华康、id=19 华兴，河源厂区）
- Issue: department 字段为 NULL，虽不影响三工结余模块（这三个车间未分配到三工部门），但可能在未来扩展时引起混乱
- Fix: 确认河源厂区定位后，执行 `UPDATE workshops SET department = '...' WHERE id IN (17, 18, 19)`

---

## Security Considerations

**明文硬编码的默认凭证**
- Risk: 生产环境未配置 `.env` 时，使用已知的弱凭证运行
- Files: `db/postgres.js` 第 8 行（`password: 'postgres123'`）；`middleware/auth.js` 第 4 行（`JWT_SECRET: 'production-system-secret-key'`）；`routes/backup.js` 第 11 行（`dbPassword: 'postgres123'`）
- Current mitigation: 代码注释提示可通过 `process.env` 覆盖
- Recommendations: 创建 `.env` 文件存放生产凭证，`ecosystem.config.js` 通过 `env_file` 或 `env` 块注入；将 `.env` 加入 `.gitignore`

**CORS 完全开放**
- Risk: 允许任意来源发起跨域请求
- Files: `server.js` 第 10 行（`app.use(cors())`）
- Current mitigation: 内网环境，实际风险低
- Recommendations: 改为 `cors({ origin: 'http://内网IP:6001' })` 限制来源

**无登录频率限制**
- Risk: 暴力破解密码
- Files: `routes/auth.js`（无速率限制中间件）
- Current mitigation: 仅内网部署，暴露面有限
- Recommendations: 添加 `express-rate-limit`，同一 IP 5 分钟内限制 10 次登录尝试

**无 HTTP 安全头**
- Risk: 缺少 `X-Content-Type-Options`、`X-Frame-Options` 等安全头
- Files: `server.js`（无 helmet 中间件）
- Recommendations: 添加 `helmet` 包（`npm i helmet`，`app.use(helmet())`）

**单删操作缺少数据锁定检查**
- Risk: 录入员可以绕过月锁定直接删除单条记录
- Files: `routes/records.js` 第 96 行（`DELETE /:dept/records/:id` 无 `checkDataLock` 中间件）
- Current mitigation: 批量删除有权限检查（第 113 行）
- Recommendations: 在单删路由加上 `checkDataLock`，或在删除前查询 record 的 record_date 判断锁定状态

**模块权限中间件（modulePermission）未被使用**
- Risk: `authenticate` 中间件已导入但路由中所有 data endpoints 只做了身份认证，未做模块权限检查；录入员在未被授权模块的情况下仍可访问数据
- Files: `routes/records.js` 第 4 行（已 import 但路由注册中从未调用 `modulePermission`）；`routes/import-export.js`（同）
- Recommendations: 在 records/import-export 路由中加入 `modulePermission('balance')`

---

## Tech Debt

**前端 app.js 是超大单文件（1801 行）**
- Issue: 所有组件、全局常量、路由、初始化逻辑全部塞在一个文件中，无模块划分
- Files: `public/js/app.js`
- Impact: 修改任何组件都需要阅读整个文件，难以 diff，组件间状态共享容易产生意外副作用
- Fix approach: 技术上受限于 CDN 模式（无构建工具），短期无法拆分；长期建议引入 Vite 构建管道

**前端 DEPT_CONFIG 与后端 modules/balance/config.js 是两套独立定义**
- Issue: 字段增减时必须同步修改两处（前端 `app.js` 和后端 `modules/balance/config.js`），极易遗漏
- Files: `public/js/app.js` 第 6-85 行；`modules/balance/config.js`
- Impact: 已是历史上最高频 bug 来源（见 CLAUDE.md 第 7.3 条）
- Fix approach: 无构建工具时难以彻底解决；可考虑后端提供一个 `GET /api/config/dept-fields` 接口，前端启动时动态加载字段定义

**备份功能硬编码 PostgreSQL 路径（Windows only）**
- Issue: `PG_DUMP` 和 `PSQL` 硬编码为 `"C:/Program Files/PostgreSQL/17/bin/..."
- Files: `routes/backup.js` 第 10-11 行
- Impact: 迁移到不同主机或 PostgreSQL 版本时备份功能完全失效
- Fix approach: 改为通过 `process.env.PG_BIN_PATH || 'pg_dump'` 读取，依赖系统 PATH

**`execSync` 同步备份阻塞 Node.js 事件循环**
- Issue: 备份大数据库时使用同步 shell 命令，整个 Node 进程在此期间无法响应其他请求
- Files: `routes/backup.js` 第 19、38 行
- Impact: 备份期间系统对所有用户无响应
- Fix approach: 改用 `spawn` + Promise 包装实现异步执行

**`console.log` 调试代码残留在生产路由**
- Issue: 两条 `console.log` 记录导入行数和车间列表
- Files: `routes/import-export.js` 第 41、46 行
- Impact: 轻微，每次导入都向 PM2 日志写入数据，长期积累占用磁盘
- Fix approach: 删除或替换为结构化日志

**`asyncHandler` 统一返回 `err.message` 到客户端**
- Issue: 数据库错误的原始 `err.message` 直接暴露给前端
- Files: `utils/async-handler.js` 第 5 行；`routes/users.js` 第 37 行；`routes/settings.js` 第 65 行
- Impact: 数据库结构信息（表名、列名、约束名）可能泄漏给客户端
- Fix approach: 生产环境区分错误类型：已知业务错误返回友好消息，未知错误返回通用 "服务器内部错误"

---

## Fragile Areas

**routes/records.js — 部门汇总 SQL（第 130-152 行）**
- Files: `routes/records.js`
- Why fragile: SQL 手写了完整字段列表；每次 `modules/balance/config.js` 新增/删除字段，此 SQL 都需要手动同步（已导致 BUG #5）
- Safe modification: 仿照 `routes/summary.js` 使用 `getExpenseFields(dept)` 动态生成 SUM 表达式
- Test coverage: 没有针对汇总 API 的集成测试

**middleware/auth.js — checkDataLock（第 42-57 行）**
- Files: `middleware/auth.js`
- Why fragile: 锁定检查依赖 `req.body.record_date`；批量导入时多条记录跨月不会分别校验，只用第一条的 record_date；批量更新场景下若 PUT 的 record_date 与原记录不同也可能绕过锁定
- Safe modification: PUT 路由应同时检查旧记录的 record_date 和新传入的 record_date

**public/js/app.js — 超大单文件组件间依赖**
- Files: `public/js/app.js`
- Why fragile: 全局常量（`DEPT_CONFIG`, `ALL_DEPARTMENTS`, `SHARED_PEOPLE` 等）被多个组件直接引用，无封装边界；修改常量结构可能静默破坏多个组件
- Safe modification: 修改前必须 Read 完整文件；修改全局常量前用 Grep 搜索所有使用位置

---

## Test Coverage Gaps

**API 路由无集成测试**
- What's not tested: 所有 HTTP 端点（records CRUD、import、export、summary、settings、users、workshops）均无测试
- Files: `routes/records.js`, `routes/import-export.js`, `routes/summary.js`, `routes/settings.js`, `routes/users.js`, `routes/workshops.js`
- Risk: 路由级 bug（如 BUG #1 批量删除路由顺序）无法被自动检测
- Priority: High

**数据锁定逻辑无测试**
- What's not tested: `checkDataLock` 中间件的锁定判断、边界条件（锁定月份判断、跨月处理）
- Files: `middleware/auth.js`
- Risk: 锁定绕过风险，改动后无安全网
- Priority: High

**Excel 导入/导出无测试**
- What's not tested: `routes/import-export.js` 的列名清洗、日期解析、错误行处理、COLUMN_MAP 映射
- Files: `routes/import-export.js`
- Risk: 格式解析变化导致导入静默失败或数据错位
- Priority: Medium

**前端组件逻辑无测试**
- What's not tested: Vue 组件的计算逻辑、表单验证、API 调用流程
- Files: `public/js/app.js`
- Risk: 受限于无构建工具的环境，前端测试难以引入
- Priority: Low（架构限制，短期难以解决）

---

## Scaling Limits

**audit_logs 表无清理机制**
- Current capacity: 每次增删改均写入一条日志，含 old_value/new_value JSONB
- Limit: 按每年 15000 条业务记录估算（每条有 create+若干 update），年写入约 3-5 万条日志；无自动清理或分区，单表将持续增长
- Scaling path: 添加定期归档任务（每季度归档 > 1 年的日志）或设置最大保留条数

**单进程 Node.js，无水平扩展能力**
- Current capacity: `ecosystem.config.js` 配置 `instances: 1`，单进程服务所有请求
- Limit: 并发用户增加时 CPU 密集操作（Excel 导入、pg_dump）会阻塞主线程
- Scaling path: 短期：`instances: 'max'` 开启多进程；长期：将 Excel 处理和备份移到 Worker Thread

---

*Concerns audit: 2026-03-17*
