-- 用户表
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(100) NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('stats', 'management', 'entry')),
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
  department VARCHAR(50),
  company VARCHAR(100),
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

-- 字段注册表（config.js 的数据库版本）
CREATE TABLE IF NOT EXISTS field_registry (
  id SERIAL PRIMARY KEY,
  module VARCHAR(50) NOT NULL,
  department VARCHAR(50) NOT NULL DEFAULT '_shared',
  field_key VARCHAR(100) NOT NULL,
  field_label VARCHAR(100) NOT NULL,
  field_type VARCHAR(20) NOT NULL,
  data_type VARCHAR(20) DEFAULT 'number',
  aliases TEXT,
  importable BOOLEAN DEFAULT true,
  sort_order INT DEFAULT 0,
  UNIQUE(module, department, field_key)
);

-- 字段标签/分组表
CREATE TABLE IF NOT EXISTS field_tags (
  id SERIAL PRIMARY KEY,
  module VARCHAR(50) NOT NULL,
  department VARCHAR(50) NOT NULL DEFAULT '_shared',
  field_key VARCHAR(100) NOT NULL,
  tag VARCHAR(50) NOT NULL,
  UNIQUE(module, department, field_key, tag)
);

-- 公式配置主表（替代 calc_rules）
CREATE TABLE IF NOT EXISTS formula_configs (
  id SERIAL PRIMARY KEY,
  module VARCHAR(50) NOT NULL,
  department VARCHAR(50) NOT NULL,
  field_key VARCHAR(100) NOT NULL,
  field_label VARCHAR(100) NOT NULL,
  formula_text TEXT NOT NULL,
  display_format VARCHAR(20) DEFAULT 'number',
  decimal_places INT DEFAULT 2,
  sort_order INT DEFAULT 0,
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(module, department, field_key)
);

-- 公式常量（按月生效，向后延续）
CREATE TABLE IF NOT EXISTS formula_constants (
  id SERIAL PRIMARY KEY,
  module VARCHAR(50) NOT NULL,
  name VARCHAR(100) NOT NULL,
  label VARCHAR(100) NOT NULL,
  value NUMERIC(14,6) NOT NULL,
  effective_month VARCHAR(7) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(module, name, effective_month)
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
  materials NUMERIC(12,2) DEFAULT 0,
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
  hunan_mold_ratio NUMERIC(8,4) DEFAULT 0,
  indonesia_mold_ratio NUMERIC(8,4) DEFAULT 0,
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
  workshop_tool_investment NUMERIC(12,2) DEFAULT 0,
  hunan_social_insurance NUMERIC(12,2) DEFAULT 0,
  hunan_tax NUMERIC(12,2) DEFAULT 0,
  fixture_tool_investment NUMERIC(12,2) DEFAULT 0,
  -- 元数据
  created_by INT,
  updated_by INT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 初始数据：默认管理员（密码: admin123）
INSERT INTO users (username, password_hash, name, role, batch_permission)
VALUES ('RRxing', '$2b$10$ze7gVY5.pNxvkkm2mlJI9efDNtKHHj5XBMmZl71vNSC.zLL8y1qie', '系统管理员', 'stats', true)
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
CREATE INDEX IF NOT EXISTS idx_field_registry_module ON field_registry(module, department);
CREATE INDEX IF NOT EXISTS idx_field_tags_module ON field_tags(module, department);
CREATE INDEX IF NOT EXISTS idx_formula_configs_module ON formula_configs(module, department);
