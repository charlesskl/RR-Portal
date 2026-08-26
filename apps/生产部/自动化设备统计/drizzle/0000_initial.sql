CREATE TABLE IF NOT EXISTS equipment (id INTEGER PRIMARY KEY AUTOINCREMENT, factory TEXT NOT NULL, workshop TEXT NOT NULL, name TEXT NOT NULL, quantity INTEGER NOT NULL, unit_price REAL NOT NULL, investment REAL NOT NULL, ma_order REAL NOT NULL DEFAULT 0, production_orders REAL NOT NULL DEFAULT 0, saved_cost REAL NOT NULL DEFAULT 0, balance REAL NOT NULL DEFAULT 0, unit_saving REAL NOT NULL DEFAULT 0, updated_at TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS idx_equipment_scope_name ON equipment(factory, workshop, name);
CREATE TABLE IF NOT EXISTS production_records (id INTEGER PRIMARY KEY AUTOINCREMENT, production_date TEXT NOT NULL, factory TEXT NOT NULL, workshop TEXT NOT NULL, equipment_name TEXT NOT NULL, production_line TEXT NOT NULL DEFAULT '', production_quantity INTEGER NOT NULL, operator TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_production_records_scope_date ON production_records(factory, workshop, production_date);
CREATE TABLE IF NOT EXISTS app_users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, account TEXT NOT NULL UNIQUE, role TEXT NOT NULL, department TEXT NOT NULL, workshop TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1);

INSERT OR IGNORE INTO equipment (factory,workshop,name,quantity,unit_price,investment,ma_order,production_orders,saved_cost,balance,unit_saving,updated_at) VALUES
('兴信B','装配','视觉贴标机',51,43089,252.59,8660,4813.52,683.04,358.20,0.1419,'2026-08-15'),
('兴信B','装配','NFC检测机',1,12000,1.38,0,7.2,0.05,-1.38,0.007,'2026-08-15'),
('兴信A','装配','视觉贴标机-单机',2,32000,7.36,1324,41.52,1.79,-5.57,0.043,'2026-08-15'),
('兴信A','装配','称重机',15,18800,32.41,22141,4235.53,21.18,-11.24,0.005,'2026-08-15'),
('兴信A','喷油','UV蜘蛛手',4,33000,15.17,700,505.52,48.02,32.85,0.095,'2026-08-15'),
('华登','喷油','6轴喷油机器人',1,68000,7.82,500,259.56,16.87,9.06,0.065,'2026-08-15'),
('华嘉','装配','富格乐飞机盒拆盒机',3,68500,23.62,0,255,20.91,-2.71,0.082,'2026-08-15'),
('华嘉','装配','富格乐飞机盒贴标机',5,36800,21.15,0,353.28,17.31,-3.84,0.049,'2026-08-15'),
('湖南','装配','自动拆盒粘胶装盒封盒装卡片一体机',1,206000,23.68,0,12.11,2.06,-21.62,0.17,'2026-08-15'),
('湖南','装配','半自动四方形贴标机',2,14000,3.22,0,52.87,13.66,10.44,0.2583,'2026-08-15'),
('河源','装配','套标+收缩一体机',1,95000,10.92,0,0,0,-10.92,0.17,'2026-08-15'),
('河源','装配','立式包装机',2,32500,3.74,0,0,0,-3.74,0.04,'2026-08-15'),
('河源','装配','半自动圆形贴标机',2,2500,0.29,0,0,0,-0.29,0.06,'2026-08-15'),
('河源','装配','点胶机',2,33000,3.79,0,0,0,-3.79,0.34,'2026-08-15');

INSERT OR IGNORE INTO production_records (id,production_date,factory,workshop,equipment_name,production_line,production_quantity,operator,note,created_at) VALUES
(1,'2026-08-15','华嘉','装配','富格乐飞机盒贴标机','2号机',18600,'部门负责人','日常产量上报','2026-08-15T08:00:00Z'),
(2,'2026-08-15','湖南','装配','半自动四方形贴标机','1号线',12400,'部门负责人','SkyCastle四方盒','2026-08-15T08:00:00Z'),
(3,'2026-08-14','兴信B','装配','NFC检测机','1号线',30000,'部门负责人','数据已同步','2026-08-14T08:00:00Z');
