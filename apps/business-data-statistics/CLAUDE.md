# 三工结余系统 - 项目开发规则

## 1. 系统简介

生产经营数据统计系统，服务于工厂统计组和各部门录入员。系统管理啤机部、印喷部、装配部三个生产部门的日常数据，核心流程：录入员每天按车间录入产值、人数、各项费用 → 系统自动计算结余（产值减费用）→ 统计组查看汇总、导出 Excel 给管理层。

主要功能模块：
- **数据录入与编辑：** 三个部门独立的明细表，支持逐行录入、编辑、删除、批量删除
- **自动计算：** 结余 = 日产值 - 所有费用之和，结余比例 = 结余 / 日产值，部门独有计算字段（如开机率）
- **Excel 导入导出：** 按部门上传/下载 Excel，SheetJS 处理
- **三工汇总：** 跨部门汇总报表，按月、按区域（清溪/湖南）聚合
- **数据锁定：** 按月锁定已确认数据，防止误改
- **系统管理：** 用户管理（统计组/录入员两种角色）、车间管理、审计日志、数据备份

使用环境：公司内网，桌面浏览器，Chrome 为主。数据量约每年 15000 条。

**用户是编程新手，技术解释须通俗易懂。**

## 2. 技术栈

| 层级 | 技术 | 入口 |
|------|------|------|
| 后端 | Express 5 + Node.js | `server.js`，端口 6001 |
| 数据库 | PostgreSQL | `db/postgres.js` 连接池，`db/init.sql` 建表，占位符用 `?` 自动转 `$N` |
| 前端 | Vue 3 + Element Plus + Axios（均 CDN） | `public/js/app.js` 单文件约 2000+ 行 |
| Excel | SheetJS/xlsx | `routes/import-export.js` |
| 认证 | JWT | `middleware/auth.js`，默认管理员 `RRxing` / `admin123` |
| 测试 | Jest | `npm test` |
| 部署 | PM2 | `ecosystem.config.js`，`npm start` 启动（端口 6001） |

数据库：`localhost:5432`，库名 `production_system`，用户 `postgres`

## 3. 目录结构

```
server.js                      # Express 入口，路由注册
db/postgres.js                 # 数据库连接池
db/init.sql                    # ⚠️ 建表语句，必须与实际库结构一致
middleware/auth.js              # JWT 验证、角色检查、数据锁定
middleware/audit.js             # 操作日志
routes/records.js              # 数据 CRUD（/:dept/records）
routes/import-export.js        # Excel 导入导出
routes/summary.js              # 三工汇总
routes/settings.js             # 系统设置、数据锁定
routes/auth.js|users.js|workshops.js|audit-logs.js|backup.js
modules/balance/config.js      # ⚠️ 部门字段定义（共享+独有+费用+计算）
modules/balance/calc.js        # 结余计算逻辑
public/js/app.js               # ⚠️ 前端全部组件、路由、交互（2000+行单文件）
public/js/api.js               # API 封装（所有请求必须经过此文件）
public/css/theme.css           # ⚠️ CSS 变量、Element Plus 覆盖
```

## 4. 组织架构与车间配置（以数据库为准）

### 4.1 厂区与公司

| 厂区 | 公司 | 说明 |
|------|------|------|
| 清溪 | 兴信、华登、华嘉、登信、小部门 | 主厂区 |
| 湖南 | 邵阳华登、邵阳兴信 | 邵阳华登有三个部门，邵阳兴信只有车衣部 |
| 河源 | 华登、华康、华兴 | 暂无部门分配，未来扩展用 |

> **华登命名规则：** 默认"华登"指清溪厂区的华登A车间。其他厂区的华登加地区前缀，如"邵阳华登"。

### 4.2 三工结余模块的部门与车间

| 部门 | key | 数据表 | 车间（数据库 name） |
|------|-----|--------|-------------------|
| 啤机部 | `beer` | `beer_records` | 兴信A, 兴信B, 华登A, 邵阳华登 |
| 印喷部 | `print` | `print_records` | 兴信A, 华登A, 邵阳华登 |
| 装配部 | `assembly` | `assembly_records` | 兴信A, 兴信B, 华登A, 华嘉, 邵阳华登 |

区域分组：**清溪**（兴信A + 兴信B + 华登A + 华嘉）、**湖南**（邵阳华登）

> 华嘉仅属于装配部。邵阳是邵阳华登的简称（仅限三工结余模块）。

### 4.3 未来扩展部门（当前不实现）

数据库已有车间数据，但三工结余模块不使用：

| 部门 key | 名称 | 车间 |
|----------|------|------|
| `clothing` | 车衣部 | 华登B（清溪）、邵阳兴信（湖南） |
| `bags` | 胶袋部 | 小部门 |
| `blister` | 吸塑部 | 小部门 |
| `color_mixing` | 配色部 | 小部门 |
| `electronic` | 电子部 | 登信 |

## 5. 字段体系

每部门字段分类：共有输入字段 → 部门独有输入字段 → 共有费用字段 → 部门独有费用字段 → 计算字段

结余公式：`结余 = 日产值 - 所有费用字段之和`，`结余比例 = 结余 / 日产值`

角色：统计组（`stats`，全权限）、录入员（`entry`，按模块分配，受锁定限制）

## 6. API 路由

| 路径 | 功能 |
|------|------|
| `/api/auth` | 登录/登出 |
| `/api/:dept/records` | 部门数据 CRUD + 批量删除 |
| `/api/:dept/records/summary` | 部门级汇总 |
| `/api/:dept/import` · `/api/:dept/export` | Excel 导入/导出 |
| `/api/summary` | 三工汇总 |
| `/api/users` · `/api/workshops` · `/api/settings` | 系统管理 |
| `/api/audit-logs` · `/api/backup` | 审计日志、备份 |

## 7. ⚠️ 开发铁律

### 7.1 全栈完整性——禁止半成品

任何用户可见的功能，必须**前端 UI → API 调用 → 后端路由 → 数据库**全部实现。
- 禁止按钮事件只有 `console.log` 或 TODO
- 禁止后端返回硬编码假数据
- 禁止弹窗/表单打开后无法提交
- **开发顺序：** 数据库 → 后端路由（在 server.js 注册）→ api.js 封装 → 前端 UI

### 7.2 前后端字段名必须一一核对

此系统最高频的 bug 就是字段名不一致：
- 前端 `prop` / `v-model` 字段名 === 后端 SQL 返回字段名（**含 AS 别名**）
- 前端表单提交字段名 === 后端 `req.body` 解构字段名
- 后端 POST/PUT 必须接收前端发送的**所有字段**，不能遗漏

### 7.3 新增/修改字段必须同步 4 处

1. `db/init.sql` — 表结构
2. `modules/balance/config.js` — 字段分类配置
3. `routes/import-export.js` — Excel 列映射（COLUMN_MAP）
4. `public/js/app.js` — 前端字段定义

计算字段还需改 `modules/balance/calc.js`。

### 7.4 SQL 必须覆盖部门独有字段

写 SUM / GROUP BY 查询时，必须从 `modules/balance/config.js` 获取该部门完整字段列表，不能只写共享字段。

### 7.5 数据库变更双向同步

- ALTER TABLE 改了库 → 必须更新 `db/init.sql`
- 改了 init.sql → 告知用户需要执行的 ALTER TABLE
- 自检："用 init.sql 重建全新数据库，这个改动会丢失吗？"

### 7.6 Express 路由顺序

具体路径（`/batch`、`/summary`）必须注册在通配路径（`/:id`）**之前**。

### 7.7 前端配置不硬编码

部门列表、车间列表等必须从 `DEPT_CONFIG` / `ALL_DEPARTMENTS` 动态生成，禁止硬编码 `<el-option>`。

### 7.8 修改前端注意事项

- `app.js` 是超大单文件，组件间共享状态和方法，**修改前必须 Read 完整文件**
- 前端 `DEPT_CONFIG` 和后端 `modules/balance/config.js` 是**两套独立定义**，必须保持同步
- 所有 API 调用必须经过 `api.js` 封装，不允许组件内直接写 axios

## 8. CSS 规范

- 颜色修改优先改 `theme.css` 中的 CSS 变量，不硬编码
- 主色 `#7F41C0`（深晶紫），明细表头 `#3D8361`（橄榄绿）
- 完整颜色表见全局 `~/.claude/CLAUDE.md`
- 不删除已有 `!important` 覆盖；样式修改必须局部，修改前 Grep 搜索影响范围

## 9. 不做的功能（Out of Scope）

Claude 不应主动添加以下功能：
- 多工厂/多公司支持、移动端适配、国际化多语言
- 实时协作/WebSocket、数据可视化图表
- 工资计算/薪酬模块、自动邮件通知
- 三工结余以外的部门模块（车衣/胶袋/吸塑/配色/电子）
