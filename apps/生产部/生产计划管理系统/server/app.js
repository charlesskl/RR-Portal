require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDatabase } = require('./db/init');

initDatabase();

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// 请求日志：方法 / 路径 / 状态 / 耗时 / 响应字节，hang 时可看到最后一个请求
app.use((req, res, next) => {
  if (req.path === '/health' || req.path === '/api/health') return next();
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    const len = res.get('content-length') || '-';
    console.log(`${new Date().toISOString()} ${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms ${len}B`);
  });
  next();
});

// 请求超时：默认 60s，上传/导出/auto-assign 180s。超时返回 504，进程不会被永久卡住
app.use((req, res, next) => {
  const longRunning = req.path.startsWith('/api/upload')
    || req.path.startsWith('/api/export')
    || req.path === '/api/orders/auto-assign';
  const ms = longRunning ? 180_000 : 60_000;
  req.setTimeout(ms, () => {
    console.error(`${new Date().toISOString()} TIMEOUT ${req.method} ${req.originalUrl} after ${ms}ms`);
    if (!res.headersSent) {
      res.status(504).json({ error: 'Request timeout', path: req.originalUrl });
    } else {
      req.destroy();
    }
  });
  next();
});

app.use('/api/upload', require('./routes/upload'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/export', require('./routes/export'));
app.use('/api/summary', require('./routes/summary'));

app.get('/api/health', (req, res) => res.json({ status: 'ok', port: PORT }));
app.get('/health', (req, res) => res.json({ status: 'ok', port: PORT }));

const clientDist = process.env.CLIENT_DIST || path.join(__dirname, '../client/dist');
app.use(express.static(clientDist));
app.get('*', (req, res) => {
  const indexPath = path.join(clientDist, 'index.html');
  if (require('fs').existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.json({ message: 'Server running. Frontend not built yet.' });
  }
});

app.listen(PORT, () => {
  console.log(`生产计划管理系统运行在端口 ${PORT}`);
});
