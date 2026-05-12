CREATE TABLE IF NOT EXISTS workshops (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER DEFAULT 0,
  color TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  quote_price REAL DEFAULT 0,
  remarks TEXT,
  deleted INTEGER DEFAULT 0,
  workshop_id INTEGER NOT NULL DEFAULT 2,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_products_code ON products(code);

CREATE TABLE IF NOT EXISTS product_processes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  part_name TEXT NOT NULL,
  technique TEXT,
  target_qty INTEGER DEFAULT 0,
  worker_count INTEGER DEFAULT 1,
  unit_wage REAL DEFAULT 0,
  calc_price REAL DEFAULT 0,
  paint_price REAL DEFAULT 0,
  total_price REAL DEFAULT 0,
  remarks TEXT,
  deleted INTEGER DEFAULT 0,
  FOREIGN KEY(product_id) REFERENCES products(id)
);
CREATE INDEX IF NOT EXISTS idx_processes_product ON product_processes(product_id);

CREATE TABLE IF NOT EXISTS lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  workshop_id INTEGER NOT NULL DEFAULT 2,
  UNIQUE(workshop_id, name)
);

CREATE TABLE IF NOT EXISTS dispatches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dispatch_date DATE NOT NULL,
  product_id INTEGER NOT NULL,
  product_process_id INTEGER NOT NULL,
  line_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  started_at DATETIME,
  completed_at DATETIME,
  FOREIGN KEY(product_id) REFERENCES products(id),
  FOREIGN KEY(product_process_id) REFERENCES product_processes(id),
  FOREIGN KEY(line_id) REFERENCES lines(id),
  UNIQUE(dispatch_date, product_process_id)
);
CREATE INDEX IF NOT EXISTS idx_dispatches_date ON dispatches(dispatch_date);
CREATE INDEX IF NOT EXISTS idx_dispatches_product ON dispatches(dispatch_date, product_id);

CREATE TABLE IF NOT EXISTS ledger_edits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ledger_date DATE NOT NULL,
  line_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  column_key TEXT NOT NULL,
  value TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(line_id) REFERENCES lines(id),
  FOREIGN KEY(product_id) REFERENCES products(id),
  UNIQUE(ledger_date, line_id, product_id, column_key)
);
CREATE INDEX IF NOT EXISTS idx_ledger_edits_date ON ledger_edits(ledger_date);

CREATE TABLE IF NOT EXISTS wage_standards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  technique TEXT NOT NULL,
  worker_count INTEGER NOT NULL,
  unit_wage REAL NOT NULL,
  workshop_id INTEGER NOT NULL DEFAULT 2,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(workshop_id, technique, worker_count)
);
CREATE INDEX IF NOT EXISTS idx_wage_standards_tech ON wage_standards(technique);

CREATE TABLE IF NOT EXISTS technique_line_defaults (
  workshop_id INTEGER NOT NULL DEFAULT 2,
  technique TEXT NOT NULL,
  line_id INTEGER,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(workshop_id, technique),
  FOREIGN KEY(line_id) REFERENCES lines(id)
);

CREATE TABLE IF NOT EXISTS production_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_name TEXT NOT NULL,
  product_id INTEGER NOT NULL,
  total_qty INTEGER NOT NULL,
  start_date DATE NOT NULL,
  remarks TEXT,
  deleted INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(product_id) REFERENCES products(id)
);
CREATE INDEX IF NOT EXISTS idx_orders_start_date ON production_orders(start_date);

CREATE TABLE IF NOT EXISTS order_schedule_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  product_process_id INTEGER NOT NULL,
  line_id INTEGER,
  qty INTEGER NOT NULL,
  daily_capacity INTEGER NOT NULL,
  actual_capacity INTEGER,
  est_days INTEGER NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  started_at DATETIME,
  completed_at DATETIME,
  FOREIGN KEY(order_id) REFERENCES production_orders(id),
  FOREIGN KEY(product_process_id) REFERENCES product_processes(id),
  FOREIGN KEY(line_id) REFERENCES lines(id),
  UNIQUE(order_id, product_process_id)
);
CREATE INDEX IF NOT EXISTS idx_schedule_order ON order_schedule_lines(order_id);

CREATE TABLE IF NOT EXISTS daily_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_date DATE NOT NULL,
  line_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  product_process_id INTEGER NOT NULL,
  produced_qty INTEGER NOT NULL,
  worker_count INTEGER NOT NULL,
  remarks TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(line_id) REFERENCES lines(id),
  FOREIGN KEY(product_id) REFERENCES products(id),
  FOREIGN KEY(product_process_id) REFERENCES product_processes(id),
  UNIQUE(record_date, line_id, product_process_id)
);
CREATE INDEX IF NOT EXISTS idx_daily_date ON daily_records(record_date);
CREATE INDEX IF NOT EXISTS idx_daily_date_line ON daily_records(record_date, line_id);
