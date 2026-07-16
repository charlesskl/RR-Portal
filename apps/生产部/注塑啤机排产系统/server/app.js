const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

function loadLocalEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || match[1].startsWith('#')) continue;
    const key = match[1];
    if (Object.prototype.hasOwnProperty.call(process.env, key)) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadLocalEnv(path.join(__dirname, '..', '.env'));

const app = express();

// CORS: restrict to same-origin by default; override with CORS_ORIGIN env var
const corsOrigin = process.env.CORS_ORIGIN || false;
app.use(cors({ origin: corsOrigin }));
app.use(express.json({ limit: '10mb' }));

// 确保目录存在
const DATA_DIR = process.env.DATA_PATH || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const UPLOADS_DIR = path.join(DATA_DIR, '..', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// 初始化SQLite数据库
const { initDatabase } = require('./db/init');
initDatabase();

// 路由
app.use('/api/auth', require('./routes/auth'));
app.use('/api/machines', require('./routes/machines'));
app.use('/api/history', require('./routes/history'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/scheduling', require('./routes/scheduling'));
app.use('/api/export', require('./routes/export'));
app.use('/api/mold-targets', require('./routes/moldTargets'));
app.use('/api/outsource', require('./routes/outsource'));
app.use('/api/monthly-plans', require('./routes/monthlyPlans'));
app.use('/api/warehouse-orders', require('./routes/warehouseOrders'));

// 托管前端 (Docker 中从 client-dist 读取，本地从 client/dist)
const clientDist = fs.existsSync(path.join(__dirname, 'client-dist'))
  ? path.join(__dirname, 'client-dist')
  : path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientDist));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  const index = path.join(clientDist, 'index.html');
  if (fs.existsSync(index)) res.sendFile(index);
  else res.status(404).send('前端尚未构建，请先运行 npm run build');
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: '服务器内部错误', error: err.message });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`排机系统已启动: http://localhost:${PORT}`);
});
