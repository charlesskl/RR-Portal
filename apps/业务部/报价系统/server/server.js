// dotenv 只在本地有 .env 时才加载；容器部署里 env 变量由 docker-compose 注入。
try { require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') }); } catch (_) {}
const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDb } = require('./services/db');

const app = express();
const PORT = process.env.PORT || 3007;

initDb();

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// 健康检查（safe-redeploy.sh 会调这个）
app.get('/health', (_, res) => res.json({ ok: true, service: 'baojia' }));

// 静态资源
app.use(express.static(path.join(__dirname, '../client')));

// API
app.use('/api/products', require('./routes/products'));
app.use('/api/versions', require('./routes/versions'));
app.use('/api/import', require('./routes/import'));
app.use('/api/export', require('./routes/export'));
app.use('/api/reference', require('./routes/reference'));

// 统一错误处理，避免 Express 默认把 stack trace 回给客户端
app.use((err, req, res, _next) => {
  console.error(`[error] ${req.method} ${req.url}:`, err);
  const status = err.status || 500;
  res.status(status).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`baojia (报价系统) running on http://localhost:${PORT}`);
});
