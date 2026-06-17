const path = require('path');
const express = require('express');
const cookieSession = require('cookie-session');

// 生产环境必须显式设置 SESSION_SECRET：否则会用默认密钥，任何人可伪造登录
if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
  console.error('[fatal] 生产环境必须设置 SESSION_SECRET（生成：openssl rand -hex 32）；缺失会用默认密钥导致可伪造登录，拒绝启动。');
  process.exit(1);
}

require('./db'); // ensure schema + seed

const app = express();
// 反代(Caddy/nginx)在前面终止 TLS，按 X-Forwarded-Proto 识别 https，secure cookie 才生效
app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));
app.use(cookieSession({
  name: 'iq_sess',
  keys: [process.env.SESSION_SECRET || 'change-me-in-prod'],
  maxAge: 12 * 60 * 60 * 1000,
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',  // 生产(HTTPS)下仅经加密连接发送；本地 http 开发不受影响
}));

// 健康检查（门户状态点 + 容器 healthcheck 用；无需鉴权）
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/quotes', require('./routes/quotes'));
app.use('/api/quotes', require('./routes/export')); // GET /:id/export
app.use('/api/sections', require('./routes/sections'));
app.use('/api/reviews', require('./routes/reviews'));
app.use('/api/uploads', require('./routes/uploads'));
app.use('/api/refs', require('./routes/refs'));
app.use('/api/admin', require('./routes/admin'));

// nosniff：即使有人上传内容为 HTML/SVG 但扩展名被强制成图片，浏览器也不会嗅探成可执行类型
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
  setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
}));
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// 全局错误处理：路由内抛出的同步异常(含 DB 错误)在此兜底，避免拖垮进程
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[error]', req.method, req.originalUrl, err);
  if (res.headersSent) return;
  const msg = String(err.message || '');
  if (msg.includes('UNIQUE')) return res.status(409).json({ error: '数据已存在（唯一约束冲突）' });
  res.status(500).json({ error: '服务器内部错误' });
});

// 进程级兜底：未处理的 Promise rejection 不应静默/崩溃
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

const PORT = process.env.PORT || 3211;
app.listen(PORT, () => console.log(`内部报价系统 listening on http://localhost:${PORT}`));

# 2026-06-17 诊断部署触发（捕获启动日志）
