const path = require('path');
// pkg 打包后 .env 在 exe 同级目录，开发模式在 server/ 目录
require('dotenv').config({
  path: process.pkg
    ? path.join(path.dirname(process.execPath), '.env')
    : path.join(__dirname, '.env'),
});

const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
const rateLimit = require('express-rate-limit');
const { authenticate } = require('./middleware/auth');

const app = express();

// 安全头
app.use(helmet({ contentSecurityPolicy: false }));

// CORS 限制
const corsOrigin = process.env.CORS_ORIGIN || 'http://localhost:3001';
app.use(cors({
  origin: corsOrigin === '*' ? true : corsOrigin,
  credentials: true,
}));

// 全局限流
app.use(rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000,
  max: parseInt(process.env.RATE_LIMIT_MAX) || 200,
  standardHeaders: true,
  legacyHeaders: false,
}));

app.use(express.json({ limit: '1mb' }));

// Health check endpoint (for Docker HEALTHCHECK and DevOps agent)
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// 认证路由（不需登录）
app.use('/api/auth', require('./routes/auth'));

// 其余 API 路由需要认证
app.use('/api', authenticate, require('./routes/zouhuo'));
app.use('/api/pricings', authenticate, require('./routes/pricing'));
app.use('/api/adoc', authenticate, require('./routes/adoc'));

// 托管前端打包文件（pkg 打包后从 exe 同级目录读取）
const clientDist = process.pkg
  ? path.join(path.dirname(process.execPath), 'client')
  : path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientDist));

// 前端路由回退（SPA）
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(clientDist, 'index.html'));
});

// 错误处理（含 multer 文件过大）
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    const maxMB = process.env.MAX_FILE_SIZE_MB || 50;
    return res.status(400).json({ message: `文件太大，最大支持 ${maxMB}MB` });
  }
  console.error(err.stack);
  res.status(500).json({ message: '服务器内部错误' });
});

const PORT = process.env.PORT || 80;
app.listen(PORT, '0.0.0.0', () => {
  const url = `http://localhost:${PORT}`;
  console.log(`走货明细服务启动: ${url}`);
  // pkg 打包后自动打开浏览器
  if (process.pkg) {
    const { exec } = require('child_process');
    exec(`start "" "${url}"`);
  }
});
