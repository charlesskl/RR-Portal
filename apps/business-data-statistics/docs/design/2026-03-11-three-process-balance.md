# 三工结余系统实施计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建生产经营数据系统的三工结余模块，含啤机/印喷/装配三部门数据录入、合计汇总、用户管理、系统设置。

**Architecture:** Express 后端 + PostgreSQL 数据库 + Vue 3 + Element Plus 前端单页应用。每个部门独立数据表，共有字段统一，独有字段各自扩展。JWT 认证，角色/模块权限中间件控制访问。

**Tech Stack:** Node.js, Express, PostgreSQL (pg driver), Vue 3 (CDN), Element Plus (CDN), SheetJS (xlsx), bcryptjs, jsonwebtoken

**Spec:** `docs/superpowers/specs/2026-03-11-three-process-balance-design.md`

---

## File Structure

```
production-system/
├── package.json
├── server.js                          # Express 入口，注册路由、中间件
├── db/
│   ├── postgres.js                    # pg 连接池 + 查询辅助函数
│   └── init.sql                       # 建表 DDL（所有表）
├── middleware/
│   ├── auth.js                        # JWT 验证、角色检查、模块权限
│   └── audit.js                       # 操作日志记录中间件
├── routes/
│   ├── auth.js                        # 登录/登出/当前用户
│   ├── users.js                       # 用户 CRUD + 模块授权
│   ├── records.js                     # 三部门数据 CRUD（参数化 :dept）
│   ├── import-export.js               # Excel 导入/导出
│   ├── summary.js                     # 三工汇总
│   ├── workshops.js                   # 车间管理 CRUD
│   ├── settings.js                    # 费用项、计算规则、数据锁定
│   ├── audit-logs.js                  # 操作日志查询
│   └── backup.js                      # 数据备份/恢复
├── utils/
│   ├── calc.js                        # 结余计算逻辑
│   └── dept-config.js                 # 三部门字段配置（表名、共有/独有字段映射）
├── public/
│   ├── index.html                     # SPA 入口
│   ├── css/
│   │   └── theme.css                  # 莫兰迪配色主题
│   └── js/
│       ├── api.js                     # axios 封装，请求拦截器
│       └── app.js                     # Vue 3 应用（所有页面组件）
└── tests/
    ├── setup.js                       # 测试环境初始化
    ├── auth.test.js
    ├── records.test.js
    ├── calc.test.js
    ├── users.test.js
    └── import-export.test.js
```

---

## Chunk 1: 项目初始化 + 数据库 + 认证

### Task 1: 项目脚手架

**Files:**
- Create: `production-system/package.json`
- Create: `production-system/server.js`
- Create: `production-system/db/postgres.js`

- [ ] **Step 1: 初始化项目目录和 package.json**

```bash
mkdir -p production-system && cd production-system
npm init -y
npm install express pg bcryptjs jsonwebtoken cors xlsx multer
npm install --save-dev jest
```

- [ ] **Step 2: 创建数据库连接模块 `db/postgres.js`**

```js
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'production_system',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});

// 查询辅助：支持 ? 占位符自动转 $N
function convertSql(sql) {
  let idx = 0;
  return sql.replace(/\?/g, () => `$${++idx}`);
}

async function query(sql, params = []) {
  const result = await pool.query(convertSql(sql), params);
  return result;
}

async function getOne(sql, params = []) {
  const result = await query(sql, params);
  return result.rows[0] || null;
}

async function getAll(sql, params = []) {
  const result = await query(sql, params);
  return result.rows;
}

module.exports = { pool, query, getOne, getAll };
```

- [ ] **Step 3: 创建 Express 入口 `server.js`（最小骨架）**

```js
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// 路由注册（后续逐步添加）
// app.use('/api/auth', require('./routes/auth'));

// SPA fallback
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api/')) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  } else {
    res.status(404).json({ success: false, message: 'API not found' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

module.exports = app;
```

- [ ] **Step 4: 验证服务器启动**

```bash
node server.js
# 浏览器访问 http://localhost:3000/api/health
# 预期: {"status":"ok","time":"..."}
```

- [ ] **Step 5: Commit**

```bash
git init && git add -A
git commit -m "chore: init project scaffold with express + pg"
```

---

### Task 2: 数据库建表

**Files:**
- Create: `production-system/db/init.sql`

- [ ] **Step 1: 编写完整建表 SQL `db/init.sql`**

```sql
-- 用户表
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(100) NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('stats', 'entry')),
  department VARCHAR(50),
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  batch_permission BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 用户模块权限
CREATE TABLE IF NOT EXISTS user_modules (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  module_name VARCHAR(50) NOT NULL,
  UNIQUE(user_id, module_name)
);

-- 车间表
CREATE TABLE IF NOT EXISTS workshops (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  region VARCHAR(50) NOT NULL,
  department VARCHAR(50) NOT NULL,
  sort_order INT DEFAULT 0,
  status VARCHAR(20) DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 费用项配置
CREATE TABLE IF NOT EXISTS expense_items (
  id SERIAL PRIMARY KEY,
  department VARCHAR(50) NOT NULL,
  field_name VARCHAR(100) NOT NULL,
  display_name VARCHAR(100) NOT NULL,
  sort_order INT DEFAULT 0,
  is_shared BOOLEAN DEFAULT false,
  is_calculated BOOLEAN DEFAULT false,
  enabled BOOLEAN DEFAULT true
);

-- 计算规则
CREATE TABLE IF NOT EXISTS calc_rules (
  id SERIAL PRIMARY KEY,
  department VARCHAR(50) NOT NULL,
  formula_type VARCHAR(50) NOT NULL,
  participating_fields TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 数据锁定
CREATE TABLE IF NOT EXISTS data_locks (
  id SERIAL PRIMARY KEY,
  department VARCHAR(50) NOT NULL,
  lock_month VARCHAR(7) NOT NULL,
  locked_by INT REFERENCES users(id),
  locked_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(department, lock_month)
);

-- 操作日志
CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id),
  user_name VARCHAR(100),
  action VARCHAR(50) NOT NULL,
  table_name VARCHAR(100),
  record_id INT,
  old_value JSONB,
  new_value JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 啤机部数据表
CREATE TABLE IF NOT EXISTS beer_records (
  id SERIAL PRIMARY KEY,
  record_date DATE NOT NULL,
  workshop_id INT REFERENCES workshops(id),
  -- 共有字段
  supervisor_count INT DEFAULT 0,
  worker_count INT DEFAULT 0,
  daily_output NUMERIC(14,2) DEFAULT 0,
  worker_wage NUMERIC(12,2) DEFAULT 0,
  supervisor_wage NUMERIC(12,2) DEFAULT 0,
  rent NUMERIC(12,2) DEFAULT 0,
  utility_fee NUMERIC(12,2) DEFAULT 0,
  tool_investment NUMERIC(12,2) DEFAULT 0,
  equipment NUMERIC(12,2) DEFAULT 0,
  renovation NUMERIC(12,2) DEFAULT 0,
  misc_fee NUMERIC(12,2) DEFAULT 0,
  shipping_fee NUMERIC(12,2) DEFAULT 0,
  social_insurance NUMERIC(12,2) DEFAULT 0,
  tax NUMERIC(12,2) DEFAULT 0,
  balance NUMERIC(14,2) DEFAULT 0,
  balance_ratio NUMERIC(8,4) DEFAULT 0,
  remark TEXT DEFAULT '',
  -- 啤机独有字段
  total_machines INT DEFAULT 0,
  running_machines INT DEFAULT 0,
  machine_rate NUMERIC(8,4) DEFAULT 0,
  misc_workers INT DEFAULT 0,
  gate_workers INT DEFAULT 0,
  run_hours NUMERIC(10,2) DEFAULT 0,
  output_tax_incl NUMERIC(14,2) DEFAULT 0,
  avg_output_per_machine NUMERIC(14,2) DEFAULT 0,
  misc_worker_wage NUMERIC(12,2) DEFAULT 0,
  wage_ratio NUMERIC(8,4) DEFAULT 0,
  machine_repair NUMERIC(12,2) DEFAULT 0,
  mold_repair NUMERIC(12,2) DEFAULT 0,
  mold_cost_ratio NUMERIC(8,4) DEFAULT 0,
  gate_processing_fee NUMERIC(12,2) DEFAULT 0,
  gate_cost_ratio NUMERIC(8,4) DEFAULT 0,
  assembly_gate_parts_fee NUMERIC(12,2) DEFAULT 0,
  recoverable_gate_fee NUMERIC(12,2) DEFAULT 0,
  material_supplement NUMERIC(12,2) DEFAULT 0,
  avg_balance_per_machine NUMERIC(14,2) DEFAULT 0,
  -- 元数据
  created_by INT,
  updated_by INT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 印喷部数据表
CREATE TABLE IF NOT EXISTS print_records (
  id SERIAL PRIMARY KEY,
  record_date DATE NOT NULL,
  workshop_id INT REFERENCES workshops(id),
  -- 共有字段
  supervisor_count INT DEFAULT 0,
  worker_count INT DEFAULT 0,
  daily_output NUMERIC(14,2) DEFAULT 0,
  worker_wage NUMERIC(12,2) DEFAULT 0,
  supervisor_wage NUMERIC(12,2) DEFAULT 0,
  rent NUMERIC(12,2) DEFAULT 0,
  utility_fee NUMERIC(12,2) DEFAULT 0,
  tool_investment NUMERIC(12,2) DEFAULT 0,
  equipment NUMERIC(12,2) DEFAULT 0,
  renovation NUMERIC(12,2) DEFAULT 0,
  misc_fee NUMERIC(12,2) DEFAULT 0,
  shipping_fee NUMERIC(12,2) DEFAULT 0,
  social_insurance NUMERIC(12,2) DEFAULT 0,
  tax NUMERIC(12,2) DEFAULT 0,
  balance NUMERIC(14,2) DEFAULT 0,
  balance_ratio NUMERIC(8,4) DEFAULT 0,
  remark TEXT DEFAULT '',
  -- 印喷独有字段
  pad_total_machines INT DEFAULT 0,
  pad_running_machines INT DEFAULT 0,
  pad_machine_rate NUMERIC(8,4) DEFAULT 0,
  spray_total_machines INT DEFAULT 0,
  spray_running_machines INT DEFAULT 0,
  spray_machine_rate NUMERIC(8,4) DEFAULT 0,
  misc_workers INT DEFAULT 0,
  work_hours NUMERIC(10,2) DEFAULT 0,
  total_hours NUMERIC(10,2) DEFAULT 0,
  output_tax_incl NUMERIC(14,2) DEFAULT 0,
  avg_output_per_worker NUMERIC(14,2) DEFAULT 0,
  subsidy NUMERIC(12,2) DEFAULT 0,
  wage_ratio NUMERIC(8,4) DEFAULT 0,
  materials NUMERIC(12,2) DEFAULT 0,
  repair_fee NUMERIC(12,2) DEFAULT 0,
  oil_water_amount NUMERIC(12,2) DEFAULT 0,
  no_output_wage NUMERIC(12,2) DEFAULT 0,
  recoverable_wage NUMERIC(12,2) DEFAULT 0,
  recoverable_indonesia_wage NUMERIC(12,2) DEFAULT 0,
  non_recoverable_tool_fee NUMERIC(12,2) DEFAULT 0,
  recoverable_tool_fee NUMERIC(12,2) DEFAULT 0,
  recoverable_paint NUMERIC(12,2) DEFAULT 0,
  dept_recoverable_wage NUMERIC(12,2) DEFAULT 0,
  assembly_wage_paid NUMERIC(12,2) DEFAULT 0,
  office_wage NUMERIC(12,2) DEFAULT 0,
  office_wage_ratio NUMERIC(8,4) DEFAULT 0,
  auto_mold_fee NUMERIC(12,2) DEFAULT 0,
  mold_fee_ratio NUMERIC(8,4) DEFAULT 0,
  hunan_mold_fee NUMERIC(12,2) DEFAULT 0,
  indonesia_mold_fee NUMERIC(12,2) DEFAULT 0,
  total_ratio NUMERIC(8,4) DEFAULT 0,
  -- 元数据
  created_by INT,
  updated_by INT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 装配部数据表
CREATE TABLE IF NOT EXISTS assembly_records (
  id SERIAL PRIMARY KEY,
  record_date DATE NOT NULL,
  workshop_id INT REFERENCES workshops(id),
  -- 共有字段
  supervisor_count INT DEFAULT 0,
  worker_count INT DEFAULT 0,
  daily_output NUMERIC(14,2) DEFAULT 0,
  worker_wage NUMERIC(12,2) DEFAULT 0,
  supervisor_wage NUMERIC(12,2) DEFAULT 0,
  rent NUMERIC(12,2) DEFAULT 0,
  utility_fee NUMERIC(12,2) DEFAULT 0,
  tool_investment NUMERIC(12,2) DEFAULT 0,
  equipment NUMERIC(12,2) DEFAULT 0,
  renovation NUMERIC(12,2) DEFAULT 0,
  misc_fee NUMERIC(12,2) DEFAULT 0,
  shipping_fee NUMERIC(12,2) DEFAULT 0,
  social_insurance NUMERIC(12,2) DEFAULT 0,
  tax NUMERIC(12,2) DEFAULT 0,
  balance NUMERIC(14,2) DEFAULT 0,
  balance_ratio NUMERIC(8,4) DEFAULT 0,
  remark TEXT DEFAULT '',
  -- 装配独有字段
  avg_output_per_worker NUMERIC(14,2) DEFAULT 0,
  planned_wage_tax NUMERIC(14,2) DEFAULT 0,
  actual_wage NUMERIC(14,2) DEFAULT 0,
  workshop_repair NUMERIC(12,2) DEFAULT 0,
  electrical_repair NUMERIC(12,2) DEFAULT 0,
  workshop_materials NUMERIC(12,2) DEFAULT 0,
  stretch_film NUMERIC(12,2) DEFAULT 0,
  supplement NUMERIC(12,2) DEFAULT 0,
  housing_subsidy NUMERIC(12,2) DEFAULT 0,
  recoverable_electricity NUMERIC(12,2) DEFAULT 0,
  tape NUMERIC(12,2) DEFAULT 0,
  balance_minus_tape NUMERIC(14,2) DEFAULT 0,
  balance_tape_ratio NUMERIC(8,4) DEFAULT 0,
  tool_invest_ratio NUMERIC(8,4) DEFAULT 0,
  borrowed_worker_wage NUMERIC(12,2) DEFAULT 0,
  borrowed_wage_ratio NUMERIC(8,4) DEFAULT 0,
  -- 元数据
  created_by INT,
  updated_by INT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 初始数据：默认管理员（密码: admin123）
INSERT INTO users (username, password_hash, name, role, batch_permission)
VALUES ('admin', '$2a$10$placeholder', '系统管理员', 'stats', true)
ON CONFLICT (username) DO NOTHING;

-- 初始车间数据
INSERT INTO workshops (name, region, department, sort_order) VALUES
  ('兴信A', '清溪', 'beer', 1),
  ('兴信B', '清溪', 'beer', 2),
  ('华登', '清溪', 'beer', 3),
  ('邵阳', '邵阳', 'beer', 4),
  ('兴信A', '清溪', 'print', 1),
  ('华登', '清溪', 'print', 2),
  ('邵阳', '邵阳', 'print', 3),
  ('兴信A', '清溪', 'assembly', 1),
  ('兴信B', '清溪', 'assembly', 2),
  ('华登', '清溪', 'assembly', 3),
  ('邵阳', '邵阳', 'assembly', 4)
ON CONFLICT DO NOTHING;

-- 索引
CREATE INDEX IF NOT EXISTS idx_beer_date ON beer_records(record_date);
CREATE INDEX IF NOT EXISTS idx_beer_workshop ON beer_records(workshop_id);
CREATE INDEX IF NOT EXISTS idx_print_date ON print_records(record_date);
CREATE INDEX IF NOT EXISTS idx_print_workshop ON print_records(workshop_id);
CREATE INDEX IF NOT EXISTS idx_assembly_date ON assembly_records(record_date);
CREATE INDEX IF NOT EXISTS idx_assembly_workshop ON assembly_records(workshop_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
```

- [ ] **Step 2: 执行建表**

```bash
createdb production_system  # 如果不存在
psql -d production_system -f db/init.sql
```

- [ ] **Step 3: Commit**

```bash
git add db/init.sql && git commit -m "feat: add database schema for all tables"
```

---

### Task 3: 认证模块

**Files:**
- Create: `production-system/middleware/auth.js`
- Create: `production-system/routes/auth.js`
- Modify: `production-system/server.js` (注册路由)

- [ ] **Step 1: 创建认证中间件 `middleware/auth.js`**

```js
const jwt = require('jsonwebtoken');
const { getOne, getAll } = require('../db/postgres');

const JWT_SECRET = process.env.JWT_SECRET || 'production-system-secret-key';
const JWT_EXPIRES = '24h';

// JWT 验证中间件
function authenticate(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ success: false, message: '未登录' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: '登录已过期' });
  }
}

// 角色检查：仅统计组
function requireStats(req, res, next) {
  if (req.user.role !== 'stats') {
    return res.status(403).json({ success: false, message: '权限不足' });
  }
  next();
}

// 模块权限检查
function modulePermission(moduleName) {
  return async (req, res, next) => {
    if (req.user.role === 'stats') return next(); // 统计组跳过
    const mod = await getOne(
      'SELECT 1 FROM user_modules WHERE user_id = ? AND module_name = ?',
      [req.user.id, moduleName]
    );
    if (!mod) return res.status(403).json({ success: false, message: '无模块权限' });
    next();
  };
}

// 数据锁定检查
async function checkDataLock(req, res, next) {
  if (req.user.role === 'stats') return next(); // 统计组不受锁定限制
  const { dept } = req.params;
  const recordDate = req.body.record_date || req.query.record_date;
  if (recordDate) {
    const month = recordDate.substring(0, 7);
    const lock = await getOne(
      'SELECT 1 FROM data_locks WHERE department = ? AND lock_month = ?',
      [dept, month]
    );
    if (lock) {
      return res.status(403).json({ success: false, message: `${month} 数据已锁定` });
    }
  }
  next();
}

function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, name: user.name, role: user.role, department: user.department },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
}

module.exports = { authenticate, requireStats, modulePermission, checkDataLock, signToken, JWT_SECRET };
```

- [ ] **Step 2: 创建认证路由 `routes/auth.js`**

```js
const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const { getOne, getAll } = require('../db/postgres');
const { authenticate, signToken } = require('../middleware/auth');

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, message: '请输入用户名和密码' });
    }
    const user = await getOne('SELECT * FROM users WHERE username = ? AND status = ?', [username, 'active']);
    if (!user) {
      return res.status(401).json({ success: false, message: '用户名或密码错误' });
    }
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ success: false, message: '用户名或密码错误' });
    }
    const modules = await getAll('SELECT module_name FROM user_modules WHERE user_id = ?', [user.id]);
    const token = signToken(user);
    res.json({
      success: true,
      token,
      user: {
        id: user.id, username: user.username, name: user.name,
        role: user.role, department: user.department,
        batch_permission: user.batch_permission,
        modules: modules.map(m => m.module_name)
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/auth/me
router.get('/me', authenticate, async (req, res) => {
  try {
    const user = await getOne('SELECT id, username, name, role, department, batch_permission, status FROM users WHERE id = ?', [req.user.id]);
    if (!user) return res.status(404).json({ success: false, message: '用户不存在' });
    const modules = await getAll('SELECT module_name FROM user_modules WHERE user_id = ?', [req.user.id]);
    res.json({ success: true, ...user, modules: modules.map(m => m.module_name) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
```

- [ ] **Step 3: 注册路由到 server.js**

在 `server.js` 的 `// 路由注册` 处添加：

```js
app.use('/api/auth', require('./routes/auth'));
```

- [ ] **Step 4: 生成管理员密码哈希并更新 init.sql**

```bash
node -e "const bcrypt=require('bcryptjs');bcrypt.hash('admin123',10).then(h=>console.log(h))"
```

用输出替换 `init.sql` 中的 `$2a$10$placeholder`。

- [ ] **Step 5: 测试登录**

```bash
# 重新执行 init.sql 更新密码
psql -d production_system -f db/init.sql
# 启动服务器后测试
curl -X POST http://localhost:3000/api/auth/login -H "Content-Type: application/json" -d '{"username":"admin","password":"admin123"}'
# 预期: {"success":true,"token":"...","user":{...}}
```

- [ ] **Step 6: Commit**

```bash
git add middleware/auth.js routes/auth.js server.js
git commit -m "feat: add JWT authentication with login endpoint"
```

---

### Task 4: 部门字段配置

**Files:**
- Create: `production-system/utils/dept-config.js`
- Create: `production-system/utils/calc.js`

- [ ] **Step 1: 创建部门配置 `utils/dept-config.js`**

此文件定义三部门的表名、共有字段、独有字段、哪些是计算字段。所有路由和前端都依赖此配置。

```js
// 共有字段（输入型）
const SHARED_INPUT_FIELDS = [
  'supervisor_count', 'worker_count', 'daily_output',
  'worker_wage', 'supervisor_wage', 'rent', 'utility_fee',
  'tool_investment', 'equipment', 'renovation', 'misc_fee',
  'shipping_fee', 'social_insurance', 'tax'
];

// 共有字段（计算型）
const SHARED_CALC_FIELDS = ['balance', 'balance_ratio'];

// 共有费用字段（参与结余计算的扣减项）
const SHARED_EXPENSE_FIELDS = [
  'worker_wage', 'supervisor_wage', 'rent', 'utility_fee',
  'tool_investment', 'equipment', 'renovation', 'misc_fee',
  'shipping_fee', 'social_insurance', 'tax'
];

// 部门配置
const DEPT_CONFIG = {
  beer: {
    tableName: 'beer_records',
    label: '啤机部',
    workshops: ['兴信A', '兴信B', '华登', '邵阳'],
    uniqueInputFields: [
      'total_machines', 'running_machines', 'misc_workers', 'gate_workers',
      'run_hours', 'output_tax_incl', 'misc_worker_wage',
      'machine_repair', 'mold_repair', 'gate_processing_fee',
      'assembly_gate_parts_fee', 'recoverable_gate_fee', 'material_supplement'
    ],
    uniqueCalcFields: [
      'machine_rate', 'avg_output_per_machine', 'wage_ratio',
      'mold_cost_ratio', 'gate_cost_ratio', 'avg_balance_per_machine'
    ],
    // 独有费用字段（也参与结余计算的扣减项）
    uniqueExpenseFields: [
      'misc_worker_wage', 'machine_repair', 'mold_repair',
      'gate_processing_fee', 'assembly_gate_parts_fee',
      'recoverable_gate_fee', 'material_supplement'
    ]
  },
  print: {
    tableName: 'print_records',
    label: '印喷部',
    workshops: ['兴信A', '华登', '邵阳'],
    uniqueInputFields: [
      'pad_total_machines', 'pad_running_machines',
      'spray_total_machines', 'spray_running_machines',
      'misc_workers', 'work_hours', 'total_hours', 'output_tax_incl',
      'subsidy', 'materials', 'repair_fee', 'oil_water_amount',
      'no_output_wage', 'recoverable_wage', 'recoverable_indonesia_wage',
      'non_recoverable_tool_fee', 'recoverable_tool_fee',
      'recoverable_paint', 'dept_recoverable_wage',
      'assembly_wage_paid', 'office_wage',
      'auto_mold_fee', 'hunan_mold_fee', 'indonesia_mold_fee'
    ],
    uniqueCalcFields: [
      'pad_machine_rate', 'spray_machine_rate', 'avg_output_per_worker',
      'wage_ratio', 'office_wage_ratio', 'mold_fee_ratio', 'total_ratio'
    ],
    uniqueExpenseFields: [
      'subsidy', 'materials', 'repair_fee', 'oil_water_amount',
      'no_output_wage', 'non_recoverable_tool_fee',
      'assembly_wage_paid', 'office_wage',
      'auto_mold_fee', 'hunan_mold_fee', 'indonesia_mold_fee'
    ]
  },
  assembly: {
    tableName: 'assembly_records',
    label: '装配部',
    workshops: ['兴信A', '兴信B', '华登', '邵阳'],
    uniqueInputFields: [
      'planned_wage_tax', 'actual_wage',
      'workshop_repair', 'electrical_repair', 'workshop_materials',
      'stretch_film', 'supplement', 'housing_subsidy',
      'recoverable_electricity', 'tape', 'borrowed_worker_wage'
    ],
    uniqueCalcFields: [
      'avg_output_per_worker', 'balance_minus_tape',
      'balance_tape_ratio', 'tool_invest_ratio', 'borrowed_wage_ratio'
    ],
    uniqueExpenseFields: [
      'actual_wage', 'workshop_repair', 'electrical_repair',
      'workshop_materials', 'stretch_film', 'supplement',
      'housing_subsidy', 'tape', 'borrowed_worker_wage'
    ]
  }
};

// 获取部门所有可写字段
function getAllInputFields(dept) {
  return [...SHARED_INPUT_FIELDS, ...DEPT_CONFIG[dept].uniqueInputFields, 'remark'];
}

// 获取部门所有字段（含计算字段）
function getAllFields(dept) {
  return [
    ...SHARED_INPUT_FIELDS, ...SHARED_CALC_FIELDS,
    ...DEPT_CONFIG[dept].uniqueInputFields,
    ...DEPT_CONFIG[dept].uniqueCalcFields,
    'remark'
  ];
}

// 获取所有费用字段（参与结余扣减）
function getExpenseFields(dept) {
  return [...SHARED_EXPENSE_FIELDS, ...DEPT_CONFIG[dept].uniqueExpenseFields];
}

module.exports = {
  DEPT_CONFIG, SHARED_INPUT_FIELDS, SHARED_CALC_FIELDS, SHARED_EXPENSE_FIELDS,
  getAllInputFields, getAllFields, getExpenseFields
};
```

- [ ] **Step 2: 创建结余计算逻辑 `utils/calc.js`**

```js
const { DEPT_CONFIG, SHARED_EXPENSE_FIELDS } = require('./dept-config');

// 计算结余及所有计算字段
function calculateRecord(dept, record) {
  const config = DEPT_CONFIG[dept];
  const r = { ...record };

  // 共有费用 + 独有费用 = 总扣减
  const allExpenses = [...SHARED_EXPENSE_FIELDS, ...config.uniqueExpenseFields];
  const totalExpense = allExpenses.reduce((sum, f) => sum + (parseFloat(r[f]) || 0), 0);

  // 结余金额
  r.balance = parseFloat(r.daily_output || 0) - totalExpense;

  // 结余%
  r.balance_ratio = r.daily_output > 0 ? r.balance / r.daily_output : 0;

  // 部门独有计算字段
  if (dept === 'beer') {
    r.machine_rate = r.total_machines > 0 ? r.running_machines / r.total_machines : 0;
    r.avg_output_per_machine = r.running_machines > 0 ? r.daily_output / r.running_machines : 0;
    const totalWage = (parseFloat(r.worker_wage) || 0) + (parseFloat(r.supervisor_wage) || 0) + (parseFloat(r.misc_worker_wage) || 0);
    r.wage_ratio = r.daily_output > 0 ? totalWage / r.daily_output : 0;
    r.mold_cost_ratio = r.daily_output > 0 ? (parseFloat(r.mold_repair) || 0) / r.daily_output : 0;
    r.gate_cost_ratio = r.daily_output > 0 ? (parseFloat(r.gate_processing_fee) || 0) / r.daily_output : 0;
    r.avg_balance_per_machine = r.running_machines > 0 ? r.balance / r.running_machines : 0;
  }

  if (dept === 'print') {
    r.pad_machine_rate = r.pad_total_machines > 0 ? r.pad_running_machines / r.pad_total_machines : 0;
    r.spray_machine_rate = r.spray_total_machines > 0 ? r.spray_running_machines / r.spray_total_machines : 0;
    r.avg_output_per_worker = r.worker_count > 0 ? r.daily_output / r.worker_count : 0;
    const totalWage = (parseFloat(r.worker_wage) || 0) + (parseFloat(r.supervisor_wage) || 0);
    r.wage_ratio = r.daily_output > 0 ? totalWage / r.daily_output : 0;
    r.office_wage_ratio = r.daily_output > 0 ? (parseFloat(r.office_wage) || 0) / r.daily_output : 0;
    r.mold_fee_ratio = r.daily_output > 0 ? (parseFloat(r.auto_mold_fee) || 0) / r.daily_output : 0;
    r.total_ratio = r.balance_ratio;
  }

  if (dept === 'assembly') {
    r.avg_output_per_worker = r.worker_count > 0 ? r.daily_output / r.worker_count : 0;
    r.balance_minus_tape = r.balance - (parseFloat(r.tape) || 0);
    r.balance_tape_ratio = r.planned_wage_tax > 0 ? r.balance_minus_tape / r.planned_wage_tax : 0;
    r.tool_invest_ratio = r.planned_wage_tax > 0 ? (parseFloat(r.tool_investment) || 0) / r.planned_wage_tax : 0;
    r.borrowed_wage_ratio = r.planned_wage_tax > 0 ? (parseFloat(r.borrowed_worker_wage) || 0) / r.planned_wage_tax : 0;
  }

  return r;
}

module.exports = { calculateRecord };
```

- [ ] **Step 3: 写计算逻辑测试 `tests/calc.test.js`**

```js
const { calculateRecord } = require('../utils/calc');

describe('calculateRecord', () => {
  test('beer: balance = output - all expenses', () => {
    const r = calculateRecord('beer', {
      daily_output: 50000,
      worker_wage: 6000, supervisor_wage: 2000, rent: 900, utility_fee: 7000,
      tool_investment: 0, equipment: 0, renovation: 0, misc_fee: 0,
      shipping_fee: 0, social_insurance: 263, tax: 809,
      misc_worker_wage: 3960, machine_repair: 1500, mold_repair: 1500,
      gate_processing_fee: 2750, assembly_gate_parts_fee: 0,
      recoverable_gate_fee: 0, material_supplement: 0,
      total_machines: 42, running_machines: 30
    });
    expect(r.balance).toBeCloseTo(50000 - 6000 - 2000 - 900 - 7000 - 263 - 809 - 3960 - 1500 - 1500 - 2750, 1);
    expect(r.balance_ratio).toBeCloseTo(r.balance / 50000, 4);
    expect(r.machine_rate).toBeCloseTo(30 / 42, 4);
  });

  test('assembly: balance_minus_tape', () => {
    const r = calculateRecord('assembly', {
      daily_output: 100000,
      worker_wage: 0, supervisor_wage: 10000, rent: 800, utility_fee: 1000,
      tool_investment: 900, equipment: 0, renovation: 0, misc_fee: 0,
      shipping_fee: 0, social_insurance: 900, tax: 1200,
      actual_wage: 20000, workshop_repair: 0, electrical_repair: 0,
      workshop_materials: 0, stretch_film: 0, supplement: 0,
      housing_subsidy: 0, tape: 300, borrowed_worker_wage: 0,
      planned_wage_tax: 30000, worker_count: 100
    });
    expect(r.balance_minus_tape).toBeCloseTo(r.balance - 300, 1);
    expect(r.avg_output_per_worker).toBeCloseTo(1000, 1);
  });
});
```

- [ ] **Step 4: 运行测试**

```bash
npx jest tests/calc.test.js --verbose
# 预期: 2 tests passed
```

- [ ] **Step 5: Commit**

```bash
git add utils/ tests/calc.test.js
git commit -m "feat: add department config and balance calculation logic"
```

---

## Chunk 2: 数据 CRUD + 导入导出

### Task 5: 数据记录 CRUD 路由

**Files:**
- Create: `production-system/routes/records.js`
- Create: `production-system/middleware/audit.js`
- Modify: `production-system/server.js`

- [ ] **Step 1: 创建审计日志中间件 `middleware/audit.js`**

```js
const { query } = require('../db/postgres');

async function logAction(userId, userName, action, tableName, recordId, oldValue, newValue) {
  await query(
    `INSERT INTO audit_logs (user_id, user_name, action, table_name, record_id, old_value, new_value)
     VALUES (?, ?, ?, ?, ?, ?::jsonb, ?::jsonb)`,
    [userId, userName, action, tableName, recordId,
     oldValue ? JSON.stringify(oldValue) : null,
     newValue ? JSON.stringify(newValue) : null]
  );
}

module.exports = { logAction };
```

- [ ] **Step 2: 创建数据路由 `routes/records.js`**

```js
const express = require('express');
const router = express.Router();
const { getAll, getOne, query } = require('../db/postgres');
const { authenticate, modulePermission, checkDataLock } = require('../middleware/auth');
const { logAction } = require('../middleware/audit');
const { DEPT_CONFIG, getAllInputFields } = require('../utils/dept-config');
const { calculateRecord } = require('../utils/calc');

// 验证部门参数
function validateDept(req, res, next) {
  const { dept } = req.params;
  if (!DEPT_CONFIG[dept]) {
    return res.status(400).json({ success: false, message: '无效部门' });
  }
  next();
}

// 部门模块名映射
const MODULE_MAP = { beer: 'beer', print: 'print', assembly: 'assembly' };

// GET /api/:dept/records
router.get('/:dept/records', authenticate, validateDept, async (req, res) => {
  try {
    const { dept } = req.params;
    const config = DEPT_CONFIG[dept];
    const { start_date, end_date, workshop_id } = req.query;

    let sql = `SELECT r.*, w.name as workshop_name, w.region
               FROM ${config.tableName} r
               LEFT JOIN workshops w ON r.workshop_id = w.id
               WHERE 1=1`;
    const params = [];

    if (start_date) { sql += ` AND r.record_date >= ?`; params.push(start_date); }
    if (end_date) { sql += ` AND r.record_date <= ?`; params.push(end_date); }
    if (workshop_id) { sql += ` AND r.workshop_id = ?`; params.push(workshop_id); }

    sql += ' ORDER BY r.record_date DESC, w.sort_order ASC';
    const records = await getAll(sql, params);
    res.json({ success: true, data: records });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/:dept/records
router.post('/:dept/records', authenticate, validateDept, checkDataLock, async (req, res) => {
  try {
    const { dept } = req.params;
    const config = DEPT_CONFIG[dept];
    const inputFields = getAllInputFields(dept);
    const records = Array.isArray(req.body) ? req.body : [req.body];
    const inserted = [];

    for (const raw of records) {
      const calculated = calculateRecord(dept, raw);
      const allFields = [...inputFields, ...config.uniqueCalcFields, 'balance', 'balance_ratio',
                         'record_date', 'workshop_id', 'created_by', 'updated_by'];
      calculated.created_by = req.user.id;
      calculated.updated_by = req.user.id;

      const validFields = allFields.filter(f => calculated[f] !== undefined);
      const values = validFields.map(f => calculated[f]);
      const placeholders = validFields.map(() => '?').join(', ');

      const result = await query(
        `INSERT INTO ${config.tableName} (${validFields.join(', ')}) VALUES (${placeholders}) RETURNING *`,
        values
      );
      inserted.push(result.rows[0]);
      await logAction(req.user.id, req.user.name, 'create', config.tableName, result.rows[0].id, null, result.rows[0]);
    }

    res.json({ success: true, data: inserted.length === 1 ? inserted[0] : inserted });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/:dept/records/:id
router.put('/:dept/records/:id', authenticate, validateDept, checkDataLock, async (req, res) => {
  try {
    const { dept, id } = req.params;
    const config = DEPT_CONFIG[dept];
    const old = await getOne(`SELECT * FROM ${config.tableName} WHERE id = ?`, [id]);
    if (!old) return res.status(404).json({ success: false, message: '记录不存在' });

    const merged = { ...old, ...req.body };
    const calculated = calculateRecord(dept, merged);
    calculated.updated_by = req.user.id;
    calculated.updated_at = new Date().toISOString();

    const inputFields = getAllInputFields(dept);
    const allUpdatable = [...inputFields, ...config.uniqueCalcFields, 'balance', 'balance_ratio',
                          'record_date', 'workshop_id', 'updated_by', 'updated_at'];
    const setClauses = allUpdatable.filter(f => calculated[f] !== undefined).map(f => `${f} = ?`);
    const values = allUpdatable.filter(f => calculated[f] !== undefined).map(f => calculated[f]);
    values.push(id);

    await query(`UPDATE ${config.tableName} SET ${setClauses.join(', ')} WHERE id = ?`, values);
    const updated = await getOne(`SELECT * FROM ${config.tableName} WHERE id = ?`, [id]);
    await logAction(req.user.id, req.user.name, 'update', config.tableName, id, old, updated);
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/:dept/records/:id
router.delete('/:dept/records/:id', authenticate, validateDept, async (req, res) => {
  try {
    const { dept, id } = req.params;
    const config = DEPT_CONFIG[dept];
    const old = await getOne(`SELECT * FROM ${config.tableName} WHERE id = ?`, [id]);
    if (!old) return res.status(404).json({ success: false, message: '记录不存在' });

    await query(`DELETE FROM ${config.tableName} WHERE id = ?`, [id]);
    await logAction(req.user.id, req.user.name, 'delete', config.tableName, id, old, null);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/:dept/records/batch
router.delete('/:dept/records/batch', authenticate, validateDept, async (req, res) => {
  try {
    const { dept } = req.params;
    const { ids } = req.body;
    if (!ids || !ids.length) return res.status(400).json({ success: false, message: '请选择记录' });

    // 检查批量权限
    if (req.user.role !== 'stats' && !req.user.batch_permission) {
      return res.status(403).json({ success: false, message: '无批量删除权限' });
    }

    const config = DEPT_CONFIG[dept];
    const placeholders = ids.map(() => '?').join(', ');
    await query(`DELETE FROM ${config.tableName} WHERE id IN (${placeholders})`, ids);
    await logAction(req.user.id, req.user.name, 'batch_delete', config.tableName, null, { ids }, null);
    res.json({ success: true, deleted: ids.length });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/:dept/summary
router.get('/:dept/summary', authenticate, validateDept, async (req, res) => {
  try {
    const { dept } = req.params;
    const config = DEPT_CONFIG[dept];
    const { start_date, end_date } = req.query;

    let sql = `SELECT w.name as workshop_name, w.region, w.id as workshop_id,
               SUM(r.supervisor_count) as supervisor_count,
               SUM(r.worker_count) as worker_count,
               SUM(r.daily_output) as daily_output,
               SUM(r.worker_wage) as worker_wage,
               SUM(r.supervisor_wage) as supervisor_wage,
               SUM(r.rent) as rent,
               SUM(r.utility_fee) as utility_fee,
               SUM(r.tool_investment) as tool_investment,
               SUM(r.equipment) as equipment,
               SUM(r.renovation) as renovation,
               SUM(r.misc_fee) as misc_fee,
               SUM(r.shipping_fee) as shipping_fee,
               SUM(r.social_insurance) as social_insurance,
               SUM(r.tax) as tax,
               SUM(r.balance) as balance
               FROM ${config.tableName} r
               LEFT JOIN workshops w ON r.workshop_id = w.id
               WHERE 1=1`;
    const params = [];
    if (start_date) { sql += ` AND r.record_date >= ?`; params.push(start_date); }
    if (end_date) { sql += ` AND r.record_date <= ?`; params.push(end_date); }
    sql += ` GROUP BY w.id, w.name, w.region, w.sort_order ORDER BY w.sort_order`;

    const rows = await getAll(sql, params);

    // 计算每行 balance_ratio
    rows.forEach(r => {
      r.balance_ratio = r.daily_output > 0 ? r.balance / r.daily_output : 0;
    });

    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
```

- [ ] **Step 3: 注册路由到 server.js**

```js
app.use('/api', require('./routes/records'));
```

- [ ] **Step 4: 测试 CRUD API**

```bash
# 获取token
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login -H "Content-Type: application/json" -d '{"username":"admin","password":"admin123"}' | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).token))")

# 创建记录
curl -X POST http://localhost:3000/api/beer/records -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"record_date":"2026-03-09","workshop_id":1,"daily_output":49064,"worker_wage":6658,"supervisor_wage":2395}'
# 预期: {"success":true,"data":{...,"balance":...}}

# 查询
curl "http://localhost:3000/api/beer/records?start_date=2026-03-01&end_date=2026-03-31" -H "Authorization: Bearer $TOKEN"
```

- [ ] **Step 5: Commit**

```bash
git add middleware/audit.js routes/records.js server.js
git commit -m "feat: add records CRUD with calculation and audit logging"
```

---

### Task 6: Excel 导入/导出

**Files:**
- Create: `production-system/routes/import-export.js`
- Modify: `production-system/server.js`

- [ ] **Step 1: 创建导入导出路由 `routes/import-export.js`**

```js
const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const router = express.Router();
const { getAll, query } = require('../db/postgres');
const { authenticate, checkDataLock } = require('../middleware/auth');
const { DEPT_CONFIG, getAllInputFields } = require('../utils/dept-config');
const { calculateRecord } = require('../utils/calc');
const { logAction } = require('../middleware/audit');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// 中文列名 → 英文字段名映射
const COLUMN_MAP = {
  '日期': 'record_date', '车间': 'workshop_name',
  '管工人数': 'supervisor_count', '员工人数': 'worker_count',
  '总产值/天': 'daily_output', '员工工资/天': 'worker_wage',
  '管工工资/天': 'supervisor_wage', '房租': 'rent',
  '水电费': 'utility_fee', '工具投资': 'tool_investment',
  '设备': 'equipment', '装修': 'renovation',
  '杂费': 'misc_fee', '运费': 'shipping_fee',
  '社保': 'social_insurance', '税收': 'tax', '备注': 'remark',
  // 啤机独有
  '总台数': 'total_machines', '开机台数': 'running_machines',
  '杂工人数': 'misc_workers', '批水口人数': 'gate_workers',
  '开机时间': 'run_hours', '总产值含税': 'output_tax_incl',
  '杂工工资/天': 'misc_worker_wage', '机器维修': 'machine_repair',
  '模具维修': 'mold_repair', '批水口加工费': 'gate_processing_fee',
  '装配帮啤机批水口配件费用': 'assembly_gate_parts_fee',
  '可回收外厂批水口加工费': 'recoverable_gate_fee',
  '原料补料': 'material_supplement',
  // 更多字段映射可按需补充...
};

// POST /api/:dept/import
router.post('/:dept/import', authenticate, upload.single('file'), async (req, res) => {
  try {
    const { dept } = req.params;
    const config = DEPT_CONFIG[dept];
    if (!req.file) return res.status(400).json({ success: false, message: '请上传文件' });

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet);

    // 获取所有车间，建 name→id 映射
    const workshops = await getAll('SELECT id, name FROM workshops WHERE department = ?', [dept]);
    const wsMap = {};
    workshops.forEach(w => { wsMap[w.name] = w.id; });

    const inputFields = getAllInputFields(dept);
    const inserted = [];
    const errors = [];

    for (let i = 0; i < rows.length; i++) {
      const raw = rows[i];
      const record = {};

      // 映射列名
      Object.keys(raw).forEach(key => {
        const mapped = COLUMN_MAP[key.trim()] || key.trim();
        record[mapped] = raw[key];
      });

      // 处理日期
      if (record.record_date instanceof Date) {
        record.record_date = record.record_date.toISOString().split('T')[0];
      }

      // 处理车间名→ID
      if (record.workshop_name) {
        record.workshop_id = wsMap[record.workshop_name];
        if (!record.workshop_id) {
          errors.push(`第 ${i + 2} 行：车间 "${record.workshop_name}" 不存在`);
          continue;
        }
      }

      // 计算
      const calculated = calculateRecord(dept, record);
      calculated.created_by = req.user.id;
      calculated.updated_by = req.user.id;

      const allFields = [...inputFields, ...config.uniqueCalcFields, 'balance', 'balance_ratio',
                         'record_date', 'workshop_id', 'created_by', 'updated_by'];
      const validFields = allFields.filter(f => calculated[f] !== undefined && calculated[f] !== '');
      const values = validFields.map(f => calculated[f]);
      const placeholders = validFields.map(() => '?').join(', ');

      try {
        const result = await query(
          `INSERT INTO ${config.tableName} (${validFields.join(', ')}) VALUES (${placeholders}) RETURNING id`,
          values
        );
        inserted.push(result.rows[0].id);
      } catch (e) {
        errors.push(`第 ${i + 2} 行：${e.message}`);
      }
    }

    await logAction(req.user.id, req.user.name, 'import', config.tableName, null, null, { count: inserted.length });
    res.json({ success: true, imported: inserted.length, errors });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/:dept/export
router.get('/:dept/export', authenticate, async (req, res) => {
  try {
    const { dept } = req.params;
    const config = DEPT_CONFIG[dept];
    const { start_date, end_date, workshop_id } = req.query;

    let sql = `SELECT r.*, w.name as workshop_name FROM ${config.tableName} r
               LEFT JOIN workshops w ON r.workshop_id = w.id WHERE 1=1`;
    const params = [];
    if (start_date) { sql += ` AND r.record_date >= ?`; params.push(start_date); }
    if (end_date) { sql += ` AND r.record_date <= ?`; params.push(end_date); }
    if (workshop_id) { sql += ` AND r.workshop_id = ?`; params.push(workshop_id); }
    sql += ' ORDER BY r.record_date DESC, w.sort_order ASC';

    const records = await getAll(sql, params);

    // 反向映射：英文→中文
    const reverseMap = {};
    Object.entries(COLUMN_MAP).forEach(([cn, en]) => { reverseMap[en] = cn; });

    const exportData = records.map(r => {
      const row = {};
      Object.keys(r).forEach(key => {
        const label = reverseMap[key] || key;
        if (!['id', 'workshop_id', 'created_by', 'updated_by', 'created_at', 'updated_at'].includes(key)) {
          row[label] = r[key];
        }
      });
      return row;
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(exportData);
    XLSX.utils.book_append_sheet(wb, ws, config.label);
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=${encodeURIComponent(config.label)}.xlsx`);
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
```

- [ ] **Step 2: 注册路由到 server.js**

```js
app.use('/api', require('./routes/import-export'));
```

- [ ] **Step 3: 测试导入导出**

```bash
# 导出测试
curl "http://localhost:3000/api/beer/export?start_date=2026-03-01&end_date=2026-03-31" -H "Authorization: Bearer $TOKEN" -o test-export.xlsx
# 预期: 下载 xlsx 文件
```

- [ ] **Step 4: Commit**

```bash
git add routes/import-export.js server.js
git commit -m "feat: add Excel import/export for department records"
```

---

## Chunk 3: 用户管理 + 系统设置

### Task 7: 用户管理路由

**Files:**
- Create: `production-system/routes/users.js`
- Modify: `production-system/server.js`

- [ ] **Step 1: 创建用户管理路由 `routes/users.js`**

```js
const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const { getAll, getOne, query } = require('../db/postgres');
const { authenticate, requireStats } = require('../middleware/auth');
const { logAction } = require('../middleware/audit');

// GET /api/users
router.get('/', authenticate, requireStats, async (req, res) => {
  try {
    const users = await getAll(`
      SELECT u.*, array_agg(um.module_name) FILTER (WHERE um.module_name IS NOT NULL) as modules
      FROM users u LEFT JOIN user_modules um ON u.id = um.user_id
      GROUP BY u.id ORDER BY u.id
    `);
    users.forEach(u => { delete u.password_hash; });
    res.json({ success: true, data: users });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/users
router.post('/', authenticate, requireStats, async (req, res) => {
  try {
    const { username, name, password, role, department, batch_permission } = req.body;
    if (!username || !name || !password) {
      return res.status(400).json({ success: false, message: '请填写必填项' });
    }
    const hash = await bcrypt.hash(password, 10);
    const result = await query(
      `INSERT INTO users (username, password_hash, name, role, department, batch_permission)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING id, username, name, role, department, batch_permission, status, created_at`,
      [username, hash, name, role || 'entry', department || null, batch_permission || false]
    );
    await logAction(req.user.id, req.user.name, 'create_user', 'users', result.rows[0].id, null, result.rows[0]);
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ success: false, message: '用户名已存在' });
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/users/:id
router.put('/:id', authenticate, requireStats, async (req, res) => {
  try {
    const { name, role, department, batch_permission } = req.body;
    const old = await getOne('SELECT * FROM users WHERE id = ?', [req.params.id]);
    if (!old) return res.status(404).json({ success: false, message: '用户不存在' });

    await query(
      'UPDATE users SET name = ?, role = ?, department = ?, batch_permission = ?, updated_at = NOW() WHERE id = ?',
      [name || old.name, role || old.role, department, batch_permission ?? old.batch_permission, req.params.id]
    );
    const updated = await getOne('SELECT id, username, name, role, department, batch_permission, status FROM users WHERE id = ?', [req.params.id]);
    await logAction(req.user.id, req.user.name, 'update_user', 'users', req.params.id, old, updated);
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/users/:id/status
router.put('/:id/status', authenticate, requireStats, async (req, res) => {
  try {
    const { status } = req.body;
    await query('UPDATE users SET status = ?, updated_at = NOW() WHERE id = ?', [status, req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/users/:id/password
router.put('/:id/password', authenticate, requireStats, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ success: false, message: '请输入新密码' });
    const hash = await bcrypt.hash(password, 10);
    await query('UPDATE users SET password_hash = ?, updated_at = NOW() WHERE id = ?', [hash, req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/users/:id/modules
router.get('/:id/modules', authenticate, requireStats, async (req, res) => {
  try {
    const modules = await getAll('SELECT module_name FROM user_modules WHERE user_id = ?', [req.params.id]);
    res.json({ success: true, data: modules.map(m => m.module_name) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/users/:id/modules
router.put('/:id/modules', authenticate, requireStats, async (req, res) => {
  try {
    const { modules } = req.body;
    await query('DELETE FROM user_modules WHERE user_id = ?', [req.params.id]);
    for (const mod of (modules || [])) {
      await query('INSERT INTO user_modules (user_id, module_name) VALUES (?, ?)', [req.params.id, mod]);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
```

- [ ] **Step 2: 注册路由**

```js
app.use('/api/users', require('./routes/users'));
```

- [ ] **Step 3: Commit**

```bash
git add routes/users.js server.js
git commit -m "feat: add user management CRUD with module permissions"
```

---

### Task 8: 系统设置路由（车间 + 费用项 + 锁定 + 日志 + 备份）

**Files:**
- Create: `production-system/routes/workshops.js`
- Create: `production-system/routes/settings.js`
- Create: `production-system/routes/audit-logs.js`
- Create: `production-system/routes/backup.js`
- Create: `production-system/routes/summary.js`
- Modify: `production-system/server.js`

- [ ] **Step 1: 创建车间管理路由 `routes/workshops.js`**

```js
const express = require('express');
const router = express.Router();
const { getAll, getOne, query } = require('../db/postgres');
const { authenticate, requireStats } = require('../middleware/auth');

router.get('/', authenticate, async (req, res) => {
  try {
    const { department } = req.query;
    let sql = 'SELECT * FROM workshops WHERE 1=1';
    const params = [];
    if (department) { sql += ' AND department = ?'; params.push(department); }
    sql += ' ORDER BY department, sort_order';
    const rows = await getAll(sql, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/', authenticate, requireStats, async (req, res) => {
  try {
    const { name, region, department, sort_order } = req.body;
    const result = await query(
      'INSERT INTO workshops (name, region, department, sort_order) VALUES (?, ?, ?, ?) RETURNING *',
      [name, region, department, sort_order || 0]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/:id', authenticate, requireStats, async (req, res) => {
  try {
    const { name, region, department, sort_order, status } = req.body;
    await query(
      'UPDATE workshops SET name = ?, region = ?, department = ?, sort_order = ?, status = ? WHERE id = ?',
      [name, region, department, sort_order, status || 'active', req.params.id]
    );
    const updated = await getOne('SELECT * FROM workshops WHERE id = ?', [req.params.id]);
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/:id', authenticate, requireStats, async (req, res) => {
  try {
    await query('DELETE FROM workshops WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
```

- [ ] **Step 2: 创建设置路由 `routes/settings.js`**（费用项 + 计算规则 + 数据锁定）

```js
const express = require('express');
const router = express.Router();
const { getAll, getOne, query } = require('../db/postgres');
const { authenticate, requireStats } = require('../middleware/auth');

// === 费用项管理 ===
router.get('/expense-items', authenticate, async (req, res) => {
  try {
    const { department } = req.query;
    let sql = 'SELECT * FROM expense_items WHERE 1=1';
    const params = [];
    if (department) { sql += ' AND department = ?'; params.push(department); }
    sql += ' ORDER BY department, sort_order';
    res.json({ success: true, data: await getAll(sql, params) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/expense-items/:id', authenticate, requireStats, async (req, res) => {
  try {
    const { display_name, sort_order, enabled } = req.body;
    await query(
      'UPDATE expense_items SET display_name = ?, sort_order = ?, enabled = ? WHERE id = ?',
      [display_name, sort_order, enabled, req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// === 计算规则 ===
router.get('/calc-rules', authenticate, async (req, res) => {
  try {
    const { department } = req.query;
    let sql = 'SELECT * FROM calc_rules WHERE 1=1';
    const params = [];
    if (department) { sql += ' AND department = ?'; params.push(department); }
    res.json({ success: true, data: await getAll(sql, params) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/calc-rules/:id', authenticate, requireStats, async (req, res) => {
  try {
    const { participating_fields } = req.body;
    await query(
      'UPDATE calc_rules SET participating_fields = ?, updated_at = NOW() WHERE id = ?',
      [participating_fields, req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// === 数据锁定 ===
router.get('/data-locks', authenticate, async (req, res) => {
  try {
    const locks = await getAll(`
      SELECT dl.*, u.name as locked_by_name FROM data_locks dl
      LEFT JOIN users u ON dl.locked_by = u.id
      ORDER BY dl.department, dl.lock_month DESC
    `);
    res.json({ success: true, data: locks });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/data-locks', authenticate, requireStats, async (req, res) => {
  try {
    const { department, lock_month } = req.body;
    const result = await query(
      'INSERT INTO data_locks (department, lock_month, locked_by) VALUES (?, ?, ?) RETURNING *',
      [department, lock_month, req.user.id]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ success: false, message: '该月已锁定' });
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/data-locks/:id', authenticate, requireStats, async (req, res) => {
  try {
    await query('DELETE FROM data_locks WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
```

- [ ] **Step 3: 创建审计日志路由 `routes/audit-logs.js`**

```js
const express = require('express');
const router = express.Router();
const { getAll } = require('../db/postgres');
const { authenticate, requireStats } = require('../middleware/auth');

router.get('/', authenticate, requireStats, async (req, res) => {
  try {
    const { start_date, end_date, user_id, action, limit: lim } = req.query;
    let sql = 'SELECT * FROM audit_logs WHERE 1=1';
    const params = [];
    if (start_date) { sql += ' AND created_at >= ?'; params.push(start_date); }
    if (end_date) { sql += ' AND created_at <= ?'; params.push(end_date + 'T23:59:59Z'); }
    if (user_id) { sql += ' AND user_id = ?'; params.push(user_id); }
    if (action) { sql += ' AND action = ?'; params.push(action); }
    sql += ` ORDER BY created_at DESC LIMIT ?`;
    params.push(parseInt(lim) || 200);
    res.json({ success: true, data: await getAll(sql, params) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
```

- [ ] **Step 4: 创建备份路由 `routes/backup.js`**

```js
const express = require('express');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const { authenticate, requireStats } = require('../middleware/auth');

const BACKUP_DIR = path.join(__dirname, '..', 'backups');

router.post('/', authenticate, requireStats, async (req, res) => {
  try {
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const filename = `backup_${new Date().toISOString().replace(/[:.]/g, '-')}.sql`;
    const filepath = path.join(BACKUP_DIR, filename);
    const dbName = process.env.DB_NAME || 'production_system';
    execSync(`pg_dump ${dbName} > "${filepath}"`);
    res.json({ success: true, filename, size: fs.statSync(filepath).size });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/list', authenticate, requireStats, async (req, res) => {
  try {
    if (!fs.existsSync(BACKUP_DIR)) return res.json({ success: true, data: [] });
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.endsWith('.sql'))
      .map(f => ({ filename: f, size: fs.statSync(path.join(BACKUP_DIR, f)).size, created: fs.statSync(path.join(BACKUP_DIR, f)).mtime }))
      .sort((a, b) => b.created - a.created);
    res.json({ success: true, data: files });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/restore', authenticate, requireStats, async (req, res) => {
  try {
    const { filename } = req.body;
    const filepath = path.join(BACKUP_DIR, filename);
    if (!fs.existsSync(filepath)) return res.status(404).json({ success: false, message: '备份文件不存在' });
    const dbName = process.env.DB_NAME || 'production_system';
    execSync(`psql ${dbName} < "${filepath}"`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
```

- [ ] **Step 5: 创建三工汇总路由 `routes/summary.js`**

```js
const express = require('express');
const router = express.Router();
const { getAll } = require('../db/postgres');
const { authenticate } = require('../middleware/auth');
const { DEPT_CONFIG } = require('../utils/dept-config');

// GET /api/summary/overview
router.get('/overview', authenticate, async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    const result = [];

    for (const [dept, config] of Object.entries(DEPT_CONFIG)) {
      let sql = `SELECT
        SUM(daily_output) as total_output,
        SUM(worker_wage + supervisor_wage) as total_wage,
        SUM(rent + utility_fee + tool_investment + equipment + renovation + misc_fee + shipping_fee + social_insurance + tax) as total_expense,
        SUM(balance) as total_balance
        FROM ${config.tableName} WHERE 1=1`;
      const params = [];
      if (start_date) { sql += ' AND record_date >= ?'; params.push(start_date); }
      if (end_date) { sql += ' AND record_date <= ?'; params.push(end_date); }

      const rows = await getAll(sql, params);
      const row = rows[0] || {};
      result.push({
        department: dept,
        label: config.label,
        total_output: parseFloat(row.total_output) || 0,
        total_wage: parseFloat(row.total_wage) || 0,
        total_expense: parseFloat(row.total_expense) || 0,
        total_balance: parseFloat(row.total_balance) || 0,
        balance_ratio: row.total_output > 0 ? row.total_balance / row.total_output : 0
      });
    }

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
```

- [ ] **Step 6: 注册所有路由到 server.js**

```js
app.use('/api/workshops', require('./routes/workshops'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/audit-logs', require('./routes/audit-logs'));
app.use('/api/backup', require('./routes/backup'));
app.use('/api/summary', require('./routes/summary'));
```

- [ ] **Step 7: Commit**

```bash
git add routes/ server.js
git commit -m "feat: add user management, workshops, settings, audit logs, backup, summary routes"
```

---

## Chunk 4: 前端 — HTML骨架 + CSS主题 + API层

### Task 9: HTML 入口 + CSS 主题

**Files:**
- Create: `production-system/public/index.html`
- Create: `production-system/public/css/theme.css`

- [ ] **Step 1: 创建 `public/index.html`**

Vue 3 + Element Plus CDN 引入，SPA 骨架。

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>生产经营数据系统</title>
  <link rel="stylesheet" href="https://unpkg.com/element-plus/dist/index.css">
  <link rel="stylesheet" href="/css/theme.css">
</head>
<body>
  <div id="app"></div>
  <script src="https://unpkg.com/vue@3/dist/vue.global.prod.js"></script>
  <script src="https://unpkg.com/element-plus"></script>
  <script src="https://unpkg.com/axios/dist/axios.min.js"></script>
  <script src="https://unpkg.com/xlsx/dist/xlsx.full.min.js"></script>
  <script src="/js/api.js"></script>
  <script src="/js/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: 创建 `public/css/theme.css`**

莫兰迪配色方案 + 布局样式。详细 CSS 包含：
- 根变量定义（主色/辅色/中性色）
- 导航栏样式
- 侧边栏样式（折叠/展开）
- 表格样式（表头紫色、结余列绿色、可编辑单元格黄色背景）
- 底部固定合计区样式
- 拖拽上传区样式
- Element Plus 主题覆盖
- 斑马纹、hover 效果等

（此文件较大，约300行CSS，实现时按 spec 配色方案实现）

- [ ] **Step 3: Commit**

```bash
git add public/
git commit -m "feat: add HTML entry and Morandi color theme CSS"
```

---

### Task 10: API 封装层

**Files:**
- Create: `production-system/public/js/api.js`

- [ ] **Step 1: 创建 `public/js/api.js`**

```js
// API 封装
const API = {
  token: localStorage.getItem('token'),
  baseURL: '/api',

  setToken(token) {
    this.token = token;
    if (token) localStorage.setItem('token', token);
    else localStorage.removeItem('token');
  },

  async request(method, url, data, options = {}) {
    const config = {
      method,
      url: this.baseURL + url,
      headers: { 'Content-Type': 'application/json' },
      ...options
    };
    if (this.token) config.headers.Authorization = `Bearer ${this.token}`;
    if (data && ['post', 'put', 'delete'].includes(method)) config.data = data;
    if (data && method === 'get') config.params = data;

    try {
      const res = await axios(config);
      return res.data;
    } catch (err) {
      if (err.response?.status === 401) {
        this.setToken(null);
        window.location.hash = '#/login';
      }
      throw err.response?.data || err;
    }
  },

  get(url, params) { return this.request('get', url, params); },
  post(url, data) { return this.request('post', url, data); },
  put(url, data) { return this.request('put', url, data); },
  del(url, data) { return this.request('delete', url, data); },

  // 文件上传
  async upload(url, file) {
    const formData = new FormData();
    formData.append('file', file);
    return this.request('post', url, formData, {
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'multipart/form-data' }
    });
  },

  // 文件下载
  async download(url, params, filename) {
    const config = {
      method: 'get', url: this.baseURL + url, params,
      responseType: 'blob',
      headers: { Authorization: `Bearer ${this.token}` }
    };
    const res = await axios(config);
    const blob = new Blob([res.data]);
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  }
};
```

- [ ] **Step 2: Commit**

```bash
git add public/js/api.js
git commit -m "feat: add API wrapper with auth and file upload/download"
```

---

## Chunk 5: 前端 — Vue 应用主体

### Task 11: Vue 应用框架 + 登录页 + 布局

**Files:**
- Create: `production-system/public/js/app.js`

- [ ] **Step 1: 创建 `public/js/app.js` 基础框架**

包含：路由系统、登录页组件、主布局组件（导航栏 + 侧边栏 + 主内容区）

关键组件列表：
- `LoginPage` — 登录表单
- `AppLayout` — 主布局（顶部导航 + 侧边栏 + router-view）
- `DeptRecordsPage` — 部门数据页（三部门复用，通过 dept 参数区分）
- `SummaryPage` — 三工汇总页
- `UserManagementPage` — 用户管理页
- `WorkshopSettingsPage` — 车间管理页
- `ExpenseItemsPage` — 费用项管理页
- `DataLocksPage` — 数据锁定页
- `AuditLogsPage` — 操作日志页
- `BackupPage` — 数据备份页

（此文件是前端核心，约2000-2500行，实现时逐步构建）

- [ ] **Step 2: 实现登录页**

登录表单：用户名 + 密码 + 登录按钮，登录后存 token 跳转主页。

- [ ] **Step 3: 实现主布局**

- 顶部紫色导航栏
- 左侧可折叠侧边栏（三工结余 > 啤机/印喷/装配/汇总 + 用户管理 + 系统设置）
- 面包屑
- 路由切换

- [ ] **Step 4: Commit**

```bash
git add public/js/app.js
git commit -m "feat: add Vue app with login page and main layout"
```

---

### Task 12: 部门数据页（核心页面）

**Files:**
- Modify: `production-system/public/js/app.js`

- [ ] **Step 1: 实现 DeptRecordsPage 组件**

包含：
- 拖拽上传区
- 工具栏（日期筛选 + 快捷按钮 + 搜索 + 操作按钮）
- 数据表格（Element Plus el-table，单元格可编辑）
- 底部固定合计表（带表头）

- [ ] **Step 2: 实现单元格编辑功能**

点击单元格进入编辑模式，失焦保存，可编辑字段浅黄色背景，计算字段绿色不可编辑。

- [ ] **Step 3: 实现底部合计计算**

前端根据筛选数据实时计算：各车间合计 → 清溪合计 → 邵阳合计 → 总合计。

- [ ] **Step 4: 实现日期筛选和快捷按钮**

默认近7天，快捷按钮切换，自定义日期范围。

- [ ] **Step 5: 实现拖拽上传和导出**

拖拽/点击上传 Excel，调用 import API；导出按钮调用 export API 下载文件。

- [ ] **Step 6: 实现新增行/删除行/批量删除**

- [ ] **Step 7: Commit**

```bash
git add public/js/app.js
git commit -m "feat: add department records page with editable table and summary footer"
```

---

### Task 13: 用户管理 + 系统设置前端页面

**Files:**
- Modify: `production-system/public/js/app.js`

- [ ] **Step 1: 实现 UserManagementPage**

用户列表表格 + 新增/编辑弹窗 + 模块授权弹窗 + 重置密码 + 禁用/启用

- [ ] **Step 2: 实现系统设置子页面**

- WorkshopSettingsPage：车间管理树形表格
- ExpenseItemsPage：费用项列表管理
- DataLocksPage：数据锁定按月列表
- AuditLogsPage：操作日志查询表
- BackupPage：备份/恢复

- [ ] **Step 3: 实现 SummaryPage**

三工汇总只读表格 + 筛选 + 导出

- [ ] **Step 4: Commit**

```bash
git add public/js/app.js
git commit -m "feat: add user management, settings, and summary pages"
```

---

## Chunk 6: 集成测试 + 收尾

### Task 14: 端到端验证

- [ ] **Step 1: 启动完整系统**

```bash
cd production-system
node server.js
# 浏览器访问 http://localhost:3000
```

- [ ] **Step 2: 验证登录流程**

admin/admin123 登录 → 跳转主页 → 侧边栏显示所有模块

- [ ] **Step 3: 验证数据录入**

啤机部 → 新增记录 → 填入数据 → 结余自动计算 → 保存成功

- [ ] **Step 4: 验证 Excel 导入导出**

导入原始 Excel 数据 → 验证数据正确导入 → 导出并对比

- [ ] **Step 5: 验证底部合计**

筛选近7天 → 合计表显示各车间/清溪/邵阳/总合计

- [ ] **Step 6: 验证用户权限**

创建录入员 → 授权啤机部 → 登录录入员 → 验证只能看到啤机部

- [ ] **Step 7: 验证数据锁定**

统计组锁定3月数据 → 录入员尝试修改 → 提示已锁定

- [ ] **Step 8: Final commit**

```bash
git add -A && git commit -m "feat: complete three-process balance system v1.0"
```
