const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// 确保目录存在
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// 初始化SQLite数据库
const { initDatabase } = require('./db/init');
initDatabase();

// 路由
app.use('/api/machines', require('./routes/machines'));
app.use('/api/history', require('./routes/history'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/scheduling', require('./routes/scheduling'));
app.use('/api/export', require('./routes/export'));
app.use('/api/mold-targets', require('./routes/moldTargets'));

// 托管前端
const clientDist = path.join(__dirname, '..', 'client', 'dist');
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

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`排机系统已启动: http://localhost:${PORT}`);
});
