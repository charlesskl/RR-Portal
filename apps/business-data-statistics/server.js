const express = require('express');
const cors = require('cors');
const path = require('path');

// 启动时校验部门费用字段配置一致性
const { validateConfig } = require('./modules');
validateConfig();

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
// 共享模块（前后端共用的 formula-parser.js 等）
app.use('/shared', express.static(path.join(__dirname, 'shared')));

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// 路由注册
app.use('/api/auth', require('./routes/auth'));
app.use('/api', require('./routes/records'));
app.use('/api', require('./routes/import-export'));
app.use('/api/users', require('./routes/users'));
app.use('/api/workshops', require('./routes/workshops'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/audit-logs', require('./routes/audit-logs'));
app.use('/api/backup', require('./routes/backup'));
app.use('/api/summary', require('./routes/summary'));

// API 404
app.use('/api', (req, res) => {
  res.status(404).json({ success: false, message: 'API not found' });
});

// SPA fallback
app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 6001;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

module.exports = app;
